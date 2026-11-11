/**
 * Transit graph — weighted directed multigraph of stops and metro stations.
 *
 * Bus edges retain direction and consecutive route positions, including loops.
 * Walking connections are rebuilt with a spatial grid from the same stop data.
 * The metro (metro.ts) adds its stations, its rides and the walks to them (#689).
 */
import { GraphEdge, StopDetail, Bus, BusStop, LatLng, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER, isMetroStation } from "./types";
import { haversine, isBakuCoordinate } from "./geo";
import { queryStopDetails, queryBuses, queryBusStops, queryRouteShapes } from "./db";
import { computeWalkingEdges } from "./walking";
import { collapseRepeatedSequence } from "./sequence";
import { legPaths } from "./shape";
import { metroNetwork } from "./metro";
import { numberRidePositions } from "./routing";

export class TransitGraph {
  private adjacency: Map<number, GraphEdge[]> = new Map();
  private stopInfo: Map<number, StopDetail> = new Map();
  private busInfo: Map<number, Bus> = new Map();
  private built = false;

  isBuilt(): boolean {
    return this.built;
  }

  getStopInfo(stopId: number): StopDetail | undefined {
    return this.stopInfo.get(stopId);
  }

  getAllStops(): StopDetail[] {
    return Array.from(this.stopInfo.values());
  }

  getBusInfo(busId: number): Bus | undefined {
    return this.busInfo.get(busId);
  }

  getEdges(stopId: number): GraphEdge[] {
    return this.adjacency.get(stopId) || [];
  }

  getAllStopIds(): number[] {
    return Array.from(this.adjacency.keys());
  }

  async build(): Promise<void> {
    if (this.built) return;

    const [stopDetails, buses, busStops, shapes] = await Promise.all([
      queryStopDetails(),
      queryBuses(),
      queryBusStops(),
      loadShapes(),
    ]);
    // Each bus's recorded lines, its own direction's first when a ride looks them up.
    const linesOfBus = new Map<number, Array<[string, LatLng[]]>>();
    for (const [key, line] of shapes) {
      const busId = parseInt(key.split(":")[0]);
      linesOfBus.set(busId, [...(linesOfBus.get(busId) ?? []), [key, line]]);
    }
    let roadLegs = 0;

    for (const stop of stopDetails) {
      if (isBakuCoordinate(stop.latitude, stop.longitude)) this.stopInfo.set(stop.id, stop);
    }
    for (const bus of buses) this.busInfo.set(bus.id, bus);

    // Group bus_stops by (bus_id, direction_type_id)
    const groupedStops = new Map<string, BusStop[]>();
    for (const bs of busStops) {
      const key = `${bs.bus_id}:${bs.direction_type_id}`;
      if (!groupedStops.has(key)) groupedStops.set(key, []);
      groupedStops.get(key)!.push(bs);
    }

    // Bus edges from consecutive stops on each route.
    for (const [key, stops] of groupedStops.entries()) {
      const busId = parseInt(key.split(":")[0]);
      const bus = this.busInfo.get(busId);
      if (!bus) continue;

      // Row IDs are not travel order. Use the same cumulative-distance order
      // as the line viewer, with stable tie-breaks for co-located stop entries.
      stops.sort((a, b) => a.total_distance - b.total_distance || a.bus_stop_id - b.bus_stop_id || a.id - b.id);
      // A list stored twice over must not ride from its terminus back to its start.
      const ordered = collapseRepeatedSequence(stops, (s) => s.stop_id);

      // A leg's time is the line's duration shared out by the legs' straight-line
      // length (#721). AYNA's duration is its route length at one speed (1.66
      // minutes a kilometre on the median line, never above 1.67), so the source
      // itself has a bus keep a steady pace. Shared out equally per leg instead, a
      // 6.5 km leg of 553 took 2.65 minutes (147 km/h), 497 short legs were slower
      // than walking, and the search chose buses for those artifacts. The upstream
      // API has no per-leg timings — deterministic, good enough for ranking, NOT a
      // live ETA.
      const duration = Number.isFinite(bus.duration_minuts) && bus.duration_minuts > 0 ? bus.duration_minuts : 30;
      const points = ordered.map((s): LatLng | undefined => {
        const c = this.stopInfo.get(s.stop_id);
        return c ? [c.latitude, c.longitude] : undefined;
      });
      const lengths = points.slice(1).map((to, i) => {
        const from = points[i];
        return from && to ? haversine(from[0], from[1], to[0], to[1]) : null;
      });

      // The road for each leg, from the bus's recorded lines matched to these stops
      // (shape.ts). It draws the ride; routing reads it only to tell a misplaced stop.
      const busLines = linesOfBus.get(busId) ?? [];
      const lines = [...busLines.filter(([k]) => k === key), ...busLines.filter(([k]) => k !== key)].map(([, line]) => line);
      const legs = lines.length ? legPaths(points, lines) : [];

      const measured = measuredLength(points, lengths, legs);
      // A line whose legs have no length at all (one stop listed over and over)
      // has nothing to share by, and keeps equal shares.
      const legTime = (length: number) => measured > 0 ? duration * length / measured : duration / Math.max(lengths.length, 1);

      for (let i = 0; i < ordered.length - 1; i++) {
        const fromStop = ordered[i];
        const toStop = ordered[i + 1];
        // A stop without valid coordinates breaks its legs; no edge bridges it.
        const distance = lengths[i];
        if (distance === null) continue;

        const edge: GraphEdge = {
          kind: "bus",
          rideId: key,
          direction: fromStop.direction_type_id,
          fromSequence: i,
          toSequence: i + 1,
          headsign: ordered[ordered.length - 1].stop_name,
          toStopId: toStop.stop_id,
          busId: bus.id,
          busNumber: bus.number,
          distance,
          time: legTime(distance),
          fromStopName: fromStop.stop_name,
          toStopName: toStop.stop_name,
          ...(legs[i] ? { path: legs[i] } : {}),
        };
        if (legs[i]) roadLegs++;

        if (!this.adjacency.has(fromStop.stop_id)) this.adjacency.set(fromStop.stop_id, []);
        this.adjacency.get(fromStop.stop_id)!.push(edge);
      }
    }

    // Ensure every stop has an adjacency entry.
    for (const stop of this.stopInfo.values()) {
      if (!this.adjacency.has(stop.id)) this.adjacency.set(stop.id, []);
    }

    // The stored walking table was generated by the order-dependent filter.
    // Recompute in memory so deployment repairs connectivity without DB writes.
    const walking = computeWalkingEdges(this.getAllStops());
    let walkingEdges = 0;
    for (const w of walking) {
      const from = this.stopInfo.get(w.from_stop_id);
      const to = this.stopInfo.get(w.to_stop_id);
      if (!from || !to) continue;
      if (!this.adjacency.has(w.from_stop_id)) this.adjacency.set(w.from_stop_id, []);
      this.adjacency.get(w.from_stop_id)!.push({
        kind: "walk",
        toStopId: w.to_stop_id,
        busId: WALKING_EDGE_BUS_ID,
        busNumber: WALKING_EDGE_BUS_NUMBER,
        distance: w.distance_km,
        time: w.time_min,
        fromStopName: from.name,
        toStopName: to.name,
      });
      walkingEdges++;
    }

    const metroEdges = this.addMetro();
    // Each ride leg's number in the search, kept on the edge (routing.ts).
    for (const edges of this.adjacency.values()) numberRidePositions(edges);

    this.built = true;
    const totalEdges = Array.from(this.adjacency.values()).reduce((s, e) => s + e.length, 0);
    console.log(`[busroute] graph built: ${this.adjacency.size} nodes, ${totalEdges} edges (${walkingEdges} walking, ${roadLegs} bus legs on the road, ${metroEdges} metro)`);
  }

  /**
   * The metro's stations and edges (#689), all or none. It is read from a file in
   * the repository, not queried, but a fault in it must not take every search down
   * with it: the planner then routes by bus alone, and only a console error says so.
   */
  private addMetro(): number {
    try {
      const busStops = this.getAllStops();
      const clash = busStops.find((s) => isMetroStation(s.id));
      if (clash) throw new Error(`stop ${clash.id} is in the range kept for metro stations`);
      const metro = metroNetwork(busStops);
      for (const station of metro.stations) {
        this.stopInfo.set(station.id, station);
        this.adjacency.set(station.id, []);
      }
      for (const { from, edge } of metro.edges) this.adjacency.get(from)!.push(edge);
      return metro.edges.length;
    } catch (error) {
      console.error("[busroute] metro not added; routing by bus only:", error);
      return 0;
    }
  }
}

// A stop sticks out of its ride when its two legs run more than MISPLACED_RATIO times
// the straight line between the stops either side, and over MISPLACED_KM longer.
const MISPLACED_RATIO = 3;
const MISPLACED_KM = 1;

/**
 * The length a ride's duration is shared over, its legs' straight lines (#721), except
 * where the data puts a stop in the wrong place. One such stop would otherwise set the
 * pace of its whole line: 537's second direction ran 19% fast because two of its legs
 * ran 4.7 km out of the way.
 *
 * A run of stops without coordinates breaks its legs, but the bus still covers that
 * stretch, so it counts as the straight line between the stops either side.
 *
 * A stop that sticks out of its ride while the recorded line passes it by, though it
 * runs on through the legs beyond, is taken to be misplaced: its two legs count as the
 * straight line between the stops either side. Only the total changes. The stop stays
 * where it is stored, with its walks, so its legs keep their lengths and take their
 * time at the line's pace: reaching it costs the way there, never a jump. On the
 * snapshot that is stop 3841 of 537, 1.1 km from both its lines, and 536's row "28 May
 * küçəsi 222", which points at stop 3095, C.Cavadov küç. 72A, elsewhere on the route.
 * The buses that do go out of their way to a stop, as 145 does to Binəqədi Gənclər
 * Şəhərciyi, have it on their recorded line, and their legs count in full.
 */
function measuredLength(points: Array<LatLng | undefined>, lengths: Array<number | null>, legs: Array<LatLng[] | undefined>): number {
  let measured = lengths.reduce<number>((sum, length) => sum + (length ?? 0), 0);
  for (let k = 1; k < lengths.length; k++) {
    const into = lengths[k - 1], out = lengths[k];
    if (into === null || out === null || legs[k - 1] || legs[k]) continue;
    const beyond = [k - 2, k + 1].filter((i) => i >= 0 && i < lengths.length);
    if (!beyond.length || !beyond.every((i) => legs[i])) continue;
    const before = points[k - 1]!, after = points[k + 1]!;
    const direct = haversine(before[0], before[1], after[0], after[1]);
    if (into + out <= MISPLACED_RATIO * direct || into + out - direct <= MISPLACED_KM) continue;
    measured -= into + out - direct;
  }
  let last = -1;
  points.forEach((point, i) => {
    if (!point) return;
    if (last >= 0 && i - last > 1) measured += haversine(points[last]![0], points[last]![1], point[0], point[1]);
    last = i;
  });
  return measured;
}

/**
 * The recorded route lines, or none. They draw rides along the road and tell a
 * misplaced stop (measuredLength), so a failed read logs and leaves every ride straight
 * between its stops, timed as stored, instead of failing the graph and, with it,
 * every search.
 */
async function loadShapes(): Promise<Map<string, LatLng[]>> {
  try {
    return (await queryRouteShapes()) ?? new Map();
  } catch (error) {
    console.error("[busroute] route lines not loaded; rides are drawn straight between stops:", error);
    return new Map();
  }
}

// Share initialization, never an unfinished graph. A failed load must be
// retryable on the next request rather than poisoning this process until restart.
let graphPromise: Promise<TransitGraph> | null = null;

export async function getGraph(): Promise<TransitGraph> {
  if (!graphPromise) {
    const graph = new TransitGraph();
    graphPromise = graph.build().then(() => graph).catch(error => {
      graphPromise = null;
      throw error;
    });
  }
  return graphPromise;
}
