/**
 * Journey choice (#721). A journey costs its estimated movement time plus
 * BOARDING_PENALTY_MIN for every boarding, and the cheapest wins; then fewer
 * boardings, less walking and less distance. Movement time leaves out every wait,
 * and no timetable or headway is published to estimate one, so the penalty stands
 * for the wait and the change: a journey with one more boarding wins only when it
 * is at least that much faster, and one bus still beats two that save less (#664).
 *
 * #664 put boardings first whatever the time. The journeys it passed over could be
 * far faster: two buses in 67 minutes over three boardings in 25. Choosing by cost
 * is the same as taking the fastest journey for each number of boardings and
 * keeping the one with the lowest minutes plus penalty, done in one search.
 *
 * A ride continues only along consecutive positions of the same direction, or past
 * a misplaced stop by the leg that skips it (graph.ts).
 * A metro ride is a ride like any other (#689): boarding a train or the metro's
 * express bus counts once, as boarding a bus does, and so does changing trains.
 * One walking edge (at most WALK_RADIUS_KM) is allowed between rides or at either
 * end; walking edges cannot chain into an unbounded shortcut. A directly walkable
 * destination is returned as a separate short walking journey.
 *
 * A journey can also start or end at a point, a named place or the person's location
 * (#720): it walks from the point to any stop or station near it, or from one to the
 * point (access.ts), and those walks count like any other. One search starts from all
 * the stops near the origin and ends at any of those near the destination, so which
 * stops a journey uses is chosen by the same rule as the rest of it. When walking the
 * whole way costs no more than every journey that rides, the answer is the walk.
 */
import type { TransitGraph } from "./graph";
import type { GraphEdge, JourneyPoint, LatLng, RouteResult, RouteSegment, StopDetail } from "./types";
import { DESTINATION_POINT_ID, isJourneyPoint, ORIGIN_POINT_ID, WALKING_EDGE_BUS_ID, WALKING_EDGE_BUS_NUMBER } from "./types";
import { haversine, WALK_RADIUS_KM, walkMinutes } from "./geo";
import { joinLegs } from "./shape";
import { accessWalks, type AccessGraph, type AccessOptions } from "./access";

/** Minutes a boarding costs on top of the movement time it brings (#721). */
export const BOARDING_PENALTY_MIN = 15;

/**
 * What the search reads of a graph. getEdges may hand back the graph's own edge
 * objects or copies of them, as a wrapper that adds or decorates edges may: the
 * search knows a ride's position by its edge's kind, rideId and toSequence, never by
 * the object, and those three must name one position of one ride, at one stop. Every
 * leg that arrives there leads on alike, so the search keeps the cheapest: a leg past
 * a misplaced stop arrives where the leg after the stop does (graph.ts). A graph whose
 * edges are numbered once built (numberRidePositions, as graph.ts does) is searched
 * fastest.
 */
type RoutingGraph = Pick<TransitGraph, "getEdges" | "getStopInfo">;
type Cost = readonly [cost: number, boardings: number, walkingKm: number, distanceKm: number, minutes: number];
// Every state is a number. A walk's is its stop and whether the journey has boarded
// yet. A ride's is the position it arrived at, numbered by its edge's kind, rideId and
// toSequence. Building and hashing that name for every edge tried was most of a
// search's time, so the graph keeps each of its own edges' numbers on the edge, where
// a copy does not take it (#721). Keyed by the edge object instead, a graph that
// copied its edges never pruned a ride, and 1343 → 3642 ran out of memory.
type StateKey = number;
type RideEdge = Exclude<GraphEdge, { kind: "walk" }>;
const walkedTo = (stopId: number, boarded: boolean) => stopId * 4 + (boarded ? 1 : 2);
const startAt = (stopId: number) => stopId * 4 + 3;
const positions = new Map<string, number>();
function rodeTo(edge: RideEdge): StateKey {
  const name = `${edge.kind}:${edge.rideId}:${edge.toSequence}`;
  let position = positions.get(name);
  // Multiples of 4, which no walk's number is.
  if (position === undefined) positions.set(name, (position = positions.size * 4));
  return position;
}
const POSITION = Symbol("ride position");
type Numbered = RideEdge & { readonly [POSITION]?: StateKey };

/**
 * Keeps each ride edge's state number on the edge, for a graph that is built once and
 * searched many times. The property is not enumerable, so a spread or Object.assign
 * copy goes without it and is numbered by its own fields, even when they changed.
 */
export function numberRidePositions(edges: Iterable<GraphEdge>): void {
  for (const edge of edges) if (edge.kind !== "walk") Object.defineProperty(edge, POSITION, { value: rodeTo(edge) });
}
interface Label {
  key: StateKey;
  stopId: number;
  cost: Cost;
  previous: Label | null;
  edge: GraphEdge | null;
  boarded: boolean;
}

function compare(a: Cost, b: Cost): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

class PriorityQueue {
  private heap: Label[] = [];

  push(item: Label) {
    this.heap.push(item);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (compare(this.heap[parent].cost, item.cost) <= 0) break;
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = item;
  }

  pop(): Label | undefined {
    const top = this.heap[0], last = this.heap.pop();
    if (!last || this.heap.length === 0) return top;
    let i = 0;
    while (2 * i + 1 < this.heap.length) {
      let child = 2 * i + 1;
      if (child + 1 < this.heap.length && compare(this.heap[child + 1].cost, this.heap[child].cost) < 0) child++;
      if (compare(last.cost, this.heap[child].cost) <= 0) break;
      this.heap[i] = this.heap[child];
      i = child;
    }
    this.heap[i] = last;
    return top;
  }
}

function reconstruct(graph: RoutingGraph, destination: Label): RouteResult {
  const path: Label[] = [];
  for (let label = destination; label.previous; label = label.previous) path.push(label);
  path.reverse();
  const segments: RouteSegment[] = [];
  // What each segment is drawn through: the stops its legs join, and each leg's road.
  const drawn: Array<{ stops: LatLng[]; legs: Array<LatLng[] | undefined> }> = [];
  for (const label of path) {
    const edge = label.edge!;
    const from = graph.getStopInfo(label.previous!.stopId)!;
    const to = graph.getStopInfo(label.stopId)!;
    let segment = segments[segments.length - 1];
    if (!segment || label.boarded || edge.kind === "walk") {
      segment = {
        busId: edge.busId, busNumber: edge.busNumber,
        mode: edge.kind === "walk" ? "walk" : edge.kind === "metro" && edge.vehicle === "train" ? "metro" : "bus",
        ...(edge.kind === "metro" ? { line: edge.line } : {}),
        direction: edge.kind === "bus" ? edge.direction : null,
        headsign: edge.kind === "walk" ? null : edge.headsign,
        stops: [{ id: from.id, name: edge.fromStopName || from.name, latitude: from.latitude, longitude: from.longitude }],
        distance: 0, time: 0,
      };
      segments.push(segment);
      drawn.push({ stops: [[from.latitude, from.longitude]], legs: [] });
    }
    // A leg past a misplaced stop (graph.ts) lists the stop among those the ride
    // passes, as its line does, but is not drawn out to where the stop is stored, and
    // the stop says so, for the map to leave its marker out too (#743).
    if (edge.kind === "bus" && edge.passes) {
      const passed = graph.getStopInfo(edge.passes.id)!;
      segment.stops.push({ id: passed.id, name: edge.passes.name || passed.name, latitude: passed.latitude, longitude: passed.longitude, misplaced: true });
    }
    segment.stops.push({ id: to.id, name: edge.toStopName || to.name, latitude: to.latitude, longitude: to.longitude });
    segment.distance += edge.distance;
    segment.time += edge.time;
    drawn[drawn.length - 1].stops.push([to.latitude, to.longitude]);
    drawn[drawn.length - 1].legs.push(edge.path);
  }
  // A ride is drawn along the road or the track where its legs have one (shape.ts,
  // metro.ts), a walk to or from a metro station by its exit, any other walk straight.
  segments.forEach((segment, i) => {
    const road = joinLegs(drawn[i].stops, drawn[i].legs);
    if (road) segment.path = road;
  });
  let totalStops = 0, lastStopId: number | null = null;
  for (const segment of segments) if (segment.mode !== "walk") {
    for (const stop of segment.stops) {
      if (stop.id !== lastStopId) totalStops++;
      lastStopId = stop.id;
    }
  }
  return {
    segments,
    totalDistance: Math.round(destination.cost[3] * 100) / 100,
    totalTime: Math.round(destination.cost[4] * 10) / 10,
    totalTransfers: Math.max(0, destination.cost[1] - 1),
    totalStops,
  };
}

/**
 * The cheapest journey from any of the starting labels to `target` that boards
 * at least once, or null when none costs less than `bound`. Starting labels carry
 * their own cost.
 */
function cheapest(graph: RoutingGraph, starts: readonly Label[], target: number, bound = Infinity): Label | null {
  const best = new Map<StateKey, Label>();
  const queue = new PriorityQueue();
  for (const start of starts) {
    const previous = best.get(start.key);
    if (previous && compare(previous.cost, start.cost) <= 0) continue;
    best.set(start.key, start);
    queue.push(start);
  }

  let current: Label | undefined;
  while ((current = queue.pop())) {
    // Queue entries hold immutable labels; an improved label makes the old
    // entry stale, even if it was enqueued before the improvement.
    if (best.get(current.key) !== current) continue;
    // Labels leave the queue cheapest first, so nothing left costs less (#720).
    if (current.cost[0] >= bound) return null;
    if (current.stopId === target && current.cost[1] > 0) return current;

    for (const edge of graph.getEdges(current.stopId)) {
      const walking = edge.kind === "walk";
      // A walk from or to the journey's own point is held to the radius its stops
      // were found within instead (access.ts).
      if (walking && (current.edge?.kind === "walk"
        || (edge.distance > WALK_RADIUS_KM && !isJourneyPoint(current.stopId) && !isJourneyPoint(edge.toStopId)))) continue;
      const last = current.edge;
      const continuesRide = edge.kind !== "walk" && last !== null && last.kind !== "walk" && last.kind === edge.kind
        && last.rideId === edge.rideId && last.toSequence === edge.fromSequence;
      const boarded = !walking && !continuesRide;
      const cost: Cost = [
        current.cost[0] + edge.time + (boarded ? BOARDING_PENALTY_MIN : 0),
        current.cost[1] + Number(boarded),
        current.cost[2] + (walking ? edge.distance : 0), current.cost[3] + edge.distance,
        current.cost[4] + edge.time,
      ];
      const key = edge.kind === "walk" ? walkedTo(edge.toStopId, cost[1] > 0) : (edge as Numbered)[POSITION] ?? rodeTo(edge);
      const previous = best.get(key);
      if (previous && compare(previous.cost, cost) <= 0) continue;
      const next: Label = { key, stopId: edge.toStopId, cost, previous: current, edge, boarded };
      best.set(key, next);
      queue.push(next);
    }
  }
  return null;
}

export function findRoute(graph: RoutingGraph, source: number, target: number): RouteResult | null {
  if (source === target || !graph.getStopInfo(source) || !graph.getStopInfo(target)) return null;
  const start: Label = { key: startAt(source), stopId: source, cost: [0, 0, 0, 0, 0], previous: null, edge: null, boarded: false };

  // This short walking option never comes from a chain of transfer edges. It costs
  // less than any boarding, so it is the cheapest journey whenever it exists.
  const walk = graph.getEdges(source).find(e => e.kind === "walk" && e.toStopId === target && e.distance <= WALK_RADIUS_KM);
  if (walk) return reconstruct(graph, {
    key: walkedTo(target, false), stopId: target, previous: start, edge: walk, boarded: false,
    cost: [walk.time, 0, walk.distance, walk.distance, walk.time],
  });

  const destination = cheapest(graph, [start], target);
  return destination && reconstruct(graph, destination);
}

/** Where a journey starts or ends: a stop or station by its id, or a point (#720). */
export type JourneyEnd = { stopId: number } | JourneyPoint;
export type JourneyGraph = RoutingGraph & AccessGraph;

// The walk the whole way, which boards nothing and so wins a tie with any journey that
// rides. It is offered against a journey that rides when it takes no more than
// MAX_WALK_INSTEAD_MIN, about 1.7 km in a straight line, and costs no more. Up to
// MAX_WALK_ONLY_KM in a straight line (35 minutes) it is offered when nothing rides
// there, or when the journey that rides takes as long or longer before any wait: three
// buses in 102 minutes were the answer over a walk of 34 (#720). Otherwise a journey
// that rides is the answer even when its boardings cost more: 15 minutes a boarding is
// an allowance for the wait, not a measured one, and too rough to send someone on a
// long walk instead. Without a limit, on random place pairs the walk was the cheaper in
// 17 of 120 pairs more than 3 km apart, as walks of 41 to 63 minutes reckoned in a
// straight line (docs/bus-routing.md).
export const MAX_WALK_INSTEAD_MIN = 30;
export const MAX_WALK_ONLY_KM = 2;

export interface JourneyOptions extends AccessOptions {
  walkOnlyKm?: number;
  walkInsteadMin?: number;
}

export interface Journey {
  route: RouteResult | null;
  /** The end with no stop or station within a walk, when that is why there is no route. */
  stranded?: "origin" | "destination";
}

/** The journey's point as a stop of its route, so reconstruct() can name and place it. */
const pointStop = (point: JourneyPoint, id: number): StopDetail => ({
  id, code: "", name: point.name, latitude: point.latitude, longitude: point.longitude, is_transport_hub: false,
});

/** A walk drawn in a straight line, or by a station's exit as metro.ts draws one, and
 *  timed with its streets reckoned in (walkMinutes). */
const walkEdge = (from: StopDetail, to: StopDetail, distance: number, exit?: LatLng): GraphEdge => ({
  kind: "walk", toStopId: to.id, busId: WALKING_EDGE_BUS_ID, busNumber: WALKING_EDGE_BUS_NUMBER,
  distance, time: walkMinutes(distance), fromStopName: from.name, toStopName: to.name,
  ...(exit ? { path: [[from.latitude, from.longitude], exit, [to.latitude, to.longitude]] } : {}),
});

/**
 * The journey between two ends, either of which may be a point (#720). Between two
 * stops it is findRoute's. A point joins the graph as a node with walks to the stops
 * near it, or with walks to it from the stops near it, and one search chooses among
 * them all.
 */
export function findJourney(graph: JourneyGraph, from: JourneyEnd, to: JourneyEnd, options: JourneyOptions = {}): Journey {
  if ("stopId" in from && "stopId" in to) return { route: findRoute(graph, from.stopId, to.stopId) };
  const origin = "stopId" in from ? graph.getStopInfo(from.stopId) : pointStop(from, ORIGIN_POINT_ID);
  const destination = "stopId" in to ? graph.getStopInfo(to.stopId) : pointStop(to, DESTINATION_POINT_ID);
  if (!origin || !destination) return { route: null };
  const points = new Map([origin, destination].filter((end) => isJourneyPoint(end.id)).map((end) => [end.id, end]));
  const edges = new Map<number, GraphEdge[]>();
  const withPoints: RoutingGraph = {
    getStopInfo: (id) => points.get(id) ?? graph.getStopInfo(id),
    getEdges: (id) => edges.get(id) ?? graph.getEdges(id),
  };

  // The whole way on foot: offered within MAX_WALK_ONLY_KM when nothing rides or the
  // ride is no faster, and against a cheaper journey that rides within MAX_WALK_INSTEAD_MIN.
  const km = haversine(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
  const minutes = walkMinutes(km);
  const walkable = km <= (options.walkOnlyKm ?? MAX_WALK_ONLY_KM);
  const competes = walkable && minutes <= (options.walkInsteadMin ?? MAX_WALK_INSTEAD_MIN);
  const start: Label = { key: startAt(origin.id), stopId: origin.id, cost: [0, 0, 0, 0, 0], previous: null, edge: null, boarded: false };
  const walkOnly = () => reconstruct(withPoints, {
    key: walkedTo(destination.id, false), stopId: destination.id, previous: start,
    edge: walkEdge(origin, destination, km), boarded: false, cost: [minutes, 0, km, km, minutes],
  });
  // Every journey that rides pays for a boarding, so a shorter walk needs no search.
  if (competes && minutes <= BOARDING_PENALTY_MIN) return { route: walkOnly() };

  const away = "stopId" in from ? null : accessWalks(graph, from, "origin", options);
  const home = "stopId" in to ? null : accessWalks(graph, to, "destination", options);
  // A point with no stop or station within its walk: no journey can ride from it or to
  // it, so nothing is searched (#743). With none near the destination, the search from
  // the origin settled every stop it could reach before finding that out.
  if (away?.length === 0 || home?.length === 0) {
    return walkable ? { route: walkOnly() } : { route: null, stranded: away?.length === 0 ? "origin" : "destination" };
  }
  if (away) edges.set(origin.id, away.map((walk) => walkEdge(origin, graph.getStopInfo(walk.stopId)!, walk.distance, walk.exit)));
  for (const walk of home ?? []) {
    const stop = graph.getStopInfo(walk.stopId)!;
    edges.set(stop.id, [...graph.getEdges(stop.id), walkEdge(stop, destination, walk.distance, walk.exit)]);
  }
  const found = cheapest(withPoints, [start], destination.id, competes ? minutes : Infinity);
  // Up to MAX_WALK_ONLY_KM a ride no faster than the walk, before any wait, never wins.
  // Within MAX_WALK_INSTEAD_MIN the bound has already let only a cheaper one through.
  if (found && !(walkable && found.cost[4] >= minutes)) return { route: reconstruct(withPoints, found) };
  return { route: walkable ? walkOnly() : null };
}
