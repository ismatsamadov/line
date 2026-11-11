/**
 * The walks between a journey's own point, a named place or the person's location
 * (#720), and the stops and metro stations around it: where the journey can board
 * first, and where it can alight last. The search (routing.ts) starts from all of them
 * at once, each with its walk's minutes, and ends at any of them with the walk on, so
 * the stop a journey uses is chosen with the rest of the journey, not taken as the
 * nearest.
 *
 * A walk is measured as every other walk in the planner is (walking.ts, metro.ts): in a
 * straight line, to a station's nearest exit by which it is drawn, and timed with its
 * streets reckoned in (walkMinutes in geo.ts).
 */
import { haversine, MIN_KM_PER_DEGREE_LAT, MIN_KM_PER_DEGREE_LON } from "./geo";
import type { TransitGraph } from "./graph";
import type { LatLng } from "./types";

// How far a journey walks from its point to its first stop or station, or from its
// last one to its point: 1 km in a straight line, about 17 minutes on its streets. The
// location button took the nearest stop within 600 m instead, and the journey could
// walk on from there, 400 m more; within 1 km every such journey is one walk, so none
// of them is lost. 96% of the places in places.json have a stop or station that close,
// against 91% within 600 m.
export const ACCESS_RADIUS_KM = 1;
// The most stops and stations a search starts from, or ends at, at each point, the
// nearest first. No place has more than 63 within 1 km, so for a place the limit leaves
// nothing out; any other point in the area has at most 65, and only a few (4 of 53,360
// points on a grid over the network), which loses at most their farthest stop or two.
// A search took as long with every stop as with the nearest 12, so the limit only
// bounds a request's work if the stops or the radius grow. docs/bus-routing.md has the
// numbers behind both choices.
export const ACCESS_STOP_LIMIT = 64;

export type AccessGraph = Pick<TransitGraph, "getAllStops" | "getEdges" | "getStationExits">;

export interface AccessWalk {
  stopId: number;
  /** In a straight line, in km: to a station's nearest exit. */
  distance: number;
  /** The exit a walk to or from a station goes by. */
  exit?: LatLng;
}

export interface AccessOptions {
  radiusKm?: number;
  limit?: number;
}

/** A stop or station a ride leaves from or arrives at, and where a walk to it ends: the
 *  stop itself, or a station's exits. */
interface Served {
  id: number;
  points: LatLng[];
  station: boolean;
  boards: boolean;
  alights: boolean;
}

// Built once per graph, which a process keeps until it restarts (graph.ts).
const servedByGraph = new WeakMap<AccessGraph, Served[]>();

/** The stops and stations some ride serves; a stop no line stops at is no use at an end. */
function served(graph: AccessGraph): Served[] {
  let found = servedByGraph.get(graph);
  if (!found) {
    const stops = graph.getAllStops();
    const alights = new Set<number>();
    for (const stop of stops) for (const edge of graph.getEdges(stop.id)) if (edge.kind !== "walk") alights.add(edge.toStopId);
    found = stops.flatMap((stop): Served[] => {
      const boards = graph.getEdges(stop.id).some((edge) => edge.kind !== "walk");
      if (!boards && !alights.has(stop.id)) return [];
      const exits = graph.getStationExits(stop.id);
      return [{ id: stop.id, points: exits ?? [[stop.latitude, stop.longitude]], station: !!exits, boards, alights: alights.has(stop.id) }];
    });
    servedByGraph.set(graph, found);
  }
  return found;
}

/**
 * The stops and stations within `radiusKm` of a point that a journey can board at, from
 * its origin, or alight at, for its destination, nearest first and at most `limit` of
 * them.
 */
export function accessWalks(
  graph: AccessGraph, point: { latitude: number; longitude: number }, end: "origin" | "destination",
  { radiusKm = ACCESS_RADIUS_KM, limit = ACCESS_STOP_LIMIT }: AccessOptions = {},
): AccessWalk[] {
  // A stop outside this box is further than the radius anywhere in the network's area.
  const latMargin = radiusKm / MIN_KM_PER_DEGREE_LAT, lonMargin = radiusKm / MIN_KM_PER_DEGREE_LON;
  const near = (p: LatLng) => Math.abs(p[0] - point.latitude) <= latMargin && Math.abs(p[1] - point.longitude) <= lonMargin;
  const walks: AccessWalk[] = [];
  for (const stop of served(graph)) {
    if (!(end === "origin" ? stop.boards : stop.alights)) continue;
    let distance = Infinity, exit: LatLng | undefined;
    for (const p of stop.points) {
      if (!near(p)) continue;
      const d = haversine(point.latitude, point.longitude, p[0], p[1]);
      if (d < distance) { distance = d; exit = stop.station ? p : undefined; }
    }
    if (distance <= radiusKm) walks.push({ stopId: stop.id, distance, ...(exit ? { exit } : {}) });
  }
  return walks.sort((a, b) => a.distance - b.distance || a.stopId - b.stopId).slice(0, limit);
}
