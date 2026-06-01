/**
 * Transit graph — weighted directed multigraph of stops.
 *
 * Bus edges connect consecutive stops on each (bus, direction); walking edges
 * connect nearby stops. Ported from best_route_finding, with one change: the
 * O(n²) walking-edge pass is replaced by loading the precomputed
 * `bus.bus_walking_edges` table (with an in-process compute fallback) so a
 * serverless cold start doesn't recompute 12M stop pairs.
 */
import { GraphEdge, StopDetail, Bus, BusStop, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER } from "./types";
import { haversine } from "./geo";
import { queryStopDetails, queryBuses, queryBusStops, queryWalkingEdges } from "./db";
import { computeWalkingEdges } from "./walking";

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

    const [stopDetails, buses, busStops] = await Promise.all([
      queryStopDetails(),
      queryBuses(),
      queryBusStops(),
    ]);

    for (const stop of stopDetails) this.stopInfo.set(stop.id, stop);
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

      stops.sort((a, b) => a.bus_stop_id - b.bus_stop_id);

      // Per-segment time = route duration spread evenly across hops. The
      // upstream API has no per-leg timings — deterministic, good enough for
      // ranking, NOT a live ETA.
      const segmentCount = Math.max(stops.length - 1, 1);
      const segmentTime = (bus.duration_minuts || 30) / segmentCount;

      for (let i = 0; i < stops.length - 1; i++) {
        const fromStop = stops[i];
        const toStop = stops[i + 1];
        const fromCoords = this.stopInfo.get(fromStop.stop_id);
        const toCoords = this.stopInfo.get(toStop.stop_id);
        if (!fromCoords || !toCoords) continue;

        const distance = haversine(
          fromCoords.latitude, fromCoords.longitude,
          toCoords.latitude, toCoords.longitude
        );

        const edge: GraphEdge = {
          toStopId: toStop.stop_id,
          busId: bus.id,
          busNumber: bus.number,
          distance,
          time: segmentTime,
          fromStopName: fromStop.stop_name,
          toStopName: toStop.stop_name,
        };

        if (!this.adjacency.has(fromStop.stop_id)) this.adjacency.set(fromStop.stop_id, []);
        this.adjacency.get(fromStop.stop_id)!.push(edge);
      }
    }

    // Ensure every stop has an adjacency entry.
    for (const stop of stopDetails) {
      if (!this.adjacency.has(stop.id)) this.adjacency.set(stop.id, []);
    }

    // Walking edges: prefer the precomputed table; fall back to computing.
    let walking = await queryWalkingEdges();
    if (walking.length === 0) {
      console.warn("[busroute] bus_walking_edges empty — computing in-process (run scripts/bus/import.ts to precompute).");
      walking = computeWalkingEdges(stopDetails, busStops);
    }
    let walkingEdges = 0;
    for (const w of walking) {
      const from = this.stopInfo.get(w.from_stop_id);
      const to = this.stopInfo.get(w.to_stop_id);
      if (!from || !to) continue;
      if (!this.adjacency.has(w.from_stop_id)) this.adjacency.set(w.from_stop_id, []);
      this.adjacency.get(w.from_stop_id)!.push({
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

    this.built = true;
    const totalEdges = Array.from(this.adjacency.values()).reduce((s, e) => s + e.length, 0);
    console.log(`[busroute] graph built: ${this.adjacency.size} nodes, ${totalEdges} edges (${walkingEdges} walking)`);
  }
}

// Singleton cached at module level (survives within a warm server instance).
let graphInstance: TransitGraph | null = null;

export async function getGraph(): Promise<TransitGraph> {
  if (!graphInstance) {
    graphInstance = new TransitGraph();
    await graphInstance.build();
  }
  return graphInstance;
}
