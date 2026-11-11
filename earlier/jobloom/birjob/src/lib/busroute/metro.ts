/**
 * The Baku Metro in the planner (#689): its stations as graph nodes, a ride along
 * every service, walks between a station and the bus stops near its exits, and walks
 * within the two interchanges.
 *
 * metro.json is written by scripts/bus/build_metro_json.py from the metro tables of
 * the open-data study of the bus network (github.com/ismatsamadov/route_efficiency,
 * data/metro/): the operator's journey planner timed every service on 25 October
 * 2026, OpenStreetMap gives the stations and the track, and opendata.az the
 * operator's exits. The script decides what a ride is: a passenger changes where the
 * operator's planner changes both ways, at Əhmədli onto the shuttle to Həzi Aslanov,
 * and at Nizami and 28 May onto the express bus that runs between them while no
 * trains do.
 *
 * A ride's time is the trains' running time. Like every bus wait, the wait for a
 * train and the minutes inside a station (escalators, passages) are not counted. A
 * walk to a station is measured from the stop to the station's nearest exit, and is
 * held to the same limit as any other walk (WALK_RADIUS_KM).
 */
import { z } from "zod";
import metroJson from "./metro.json";
import { haversine, MIN_KM_PER_DEGREE_LAT, MIN_KM_PER_DEGREE_LON, WALK_RADIUS_KM, walkMinutes } from "./geo";
import type { GraphEdge, LatLng, StopDetail } from "./types";
import { METRO_RIDE_BUS_ID, METRO_STATION_ID_BASE, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER } from "./types";

const Point = z.tuple([z.number(), z.number()]);
export const MetroData = z.object({
  lines: z.record(z.string(), z.object({ name: z.string(), color: z.string() })),
  stations: z.array(z.object({
    name: z.string(), line: z.string(), latitude: z.number(), longitude: z.number(), exits: z.array(Point),
  })),
  rides: z.array(z.object({
    line: z.string(), vehicle: z.enum(["train", "bus"]), name: z.string().nullable(),
    stations: z.array(z.string()).min(2), seconds: z.array(z.number().positive()),
    km: z.array(z.number().positive().nullable()), paths: z.array(z.array(Point).nullable()),
  })),
});
export type MetroData = z.infer<typeof MetroData>;

export interface MetroNetwork {
  stations: StopDetail[];
  /** Each station's exits by its id, or the station's own point where none is recorded:
   *  a walk to a station, from a stop or from a place (#720), is measured to the nearest. */
  exits: Map<number, LatLng[]>;
  /** Each edge with the node it leaves from. */
  edges: Array<{ from: number; edge: GraphEdge }>;
}

// These margins hold every point within a walk of an exit, anywhere in the network's
// area. Only the stops inside a station's box are measured.
const LAT_MARGIN = WALK_RADIUS_KM / MIN_KM_PER_DEGREE_LAT, LON_MARGIN = WALK_RADIUS_KM / MIN_KM_PER_DEGREE_LON;

/** The metro's stations and edges, joined to the bus network's stops by walks. */
export function metroNetwork(busStops: StopDetail[], raw: unknown = metroJson): MetroNetwork {
  const data = MetroData.parse(raw);
  const stations: StopDetail[] = data.stations.map((s, i) => ({
    id: METRO_STATION_ID_BASE + i + 1, code: "", name: s.name,
    latitude: s.latitude, longitude: s.longitude, is_transport_hub: true,
  }));
  const byName = new Map(stations.map((s) => [s.name, s]));
  const edges: MetroNetwork["edges"] = [];
  const walk = (from: StopDetail, to: StopDetail, distance: number, path?: LatLng[]) => edges.push({
    from: from.id,
    edge: {
      kind: "walk", toStopId: to.id, busId: WALKING_EDGE_BUS_ID, busNumber: WALKING_EDGE_BUS_NUMBER,
      distance, time: walkMinutes(distance), fromStopName: from.name, toStopName: to.name,
      ...(path ? { path } : {}),
    },
  });

  data.rides.forEach((ride, r) => {
    const line = data.lines[ride.line];
    const at = ride.stations.map((name) => byName.get(name));
    const legs = at.length - 1;
    if (!line || at.some((s) => !s) || ride.seconds.length !== legs || ride.km.length !== legs || ride.paths.length !== legs) {
      throw new Error(`metro ride ${r} (${ride.stations.join(" → ")}) does not fit its line and stations`);
    }
    const headsign = ride.stations[legs];
    for (let i = 0; i < legs; i++) {
      const from = at[i]!, to = at[i + 1]!, path = ride.paths[i];
      edges.push({
        from: from.id,
        edge: {
          kind: "metro", rideId: `metro:${r}`, fromSequence: i, toSequence: i + 1, headsign, line, vehicle: ride.vehicle,
          toStopId: to.id, busId: METRO_RIDE_BUS_ID, busNumber: ride.vehicle === "bus" && ride.name ? ride.name : line.name,
          distance: ride.km[i] ?? haversine(from.latitude, from.longitude, to.latitude, to.longitude),
          time: ride.seconds[i] / 60, fromStopName: from.name, toStopName: to.name,
          ...(path ? { path } : {}),
        },
      });
    }
  });

  // The stops within a walk of a station's exits, measured to the nearest exit and
  // drawn by it.
  const exitsOf = new Map<number, LatLng[]>();
  data.stations.forEach((s, i) => {
    const station = stations[i];
    const exits: LatLng[] = s.exits.length ? s.exits : [[s.latitude, s.longitude]];
    exitsOf.set(station.id, exits);
    const lats = exits.map((e) => e[0]), lngs = exits.map((e) => e[1]);
    const south = Math.min(...lats) - LAT_MARGIN, north = Math.max(...lats) + LAT_MARGIN;
    const west = Math.min(...lngs) - LON_MARGIN, east = Math.max(...lngs) + LON_MARGIN;
    for (const stop of busStops) {
      if (stop.latitude < south || stop.latitude > north || stop.longitude < west || stop.longitude > east) continue;
      let exit = exits[0], distance = Infinity;
      for (const e of exits) {
        const d = haversine(stop.latitude, stop.longitude, e[0], e[1]);
        if (d < distance) { distance = d; exit = e; }
      }
      if (distance > WALK_RADIUS_KM) continue;
      const atStop: LatLng = [stop.latitude, stop.longitude], atStation: LatLng = [station.latitude, station.longitude];
      walk(stop, station, distance, [atStop, exit, atStation]);
      walk(station, stop, distance, [atStation, exit, atStop]);
    }
  });

  // Stations within a walk of each other are one interchange: 28 May and Cəfər
  // Cabbarlı, Memar Əcəmi and Memar Əcəmi-2.
  for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
    const a = stations[i], b = stations[j];
    const distance = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
    if (distance > WALK_RADIUS_KM) continue;
    walk(a, b, distance);
    walk(b, a, distance);
  }
  return { stations, exits: exitsOf, edges };
}
