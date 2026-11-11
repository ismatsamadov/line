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
 * A ride continues only along consecutive positions of the same direction.
 * A metro ride is a ride like any other (#689): boarding a train or the metro's
 * express bus counts once, as boarding a bus does, and so does changing trains.
 * One walking edge (at most WALK_RADIUS_KM) is allowed between rides or at either
 * end; walking edges cannot chain into an unbounded shortcut. A directly walkable
 * destination is returned as a separate short walking journey.
 */
import type { TransitGraph } from "./graph";
import type { GraphEdge, LatLng, RouteResult, RouteSegment } from "./types";
import { WALK_RADIUS_KM } from "./geo";
import { joinLegs } from "./shape";

/** Minutes a boarding costs on top of the movement time it brings (#721). */
export const BOARDING_PENALTY_MIN = 15;

type RoutingGraph = Pick<TransitGraph, "getEdges" | "getStopInfo">;
type Cost = readonly [cost: number, boardings: number, walkingKm: number, distanceKm: number, minutes: number];
interface Label {
  key: string;
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
  const legs: Array<Array<LatLng[] | undefined>> = [];
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
      legs.push([]);
    }
    segment.stops.push({ id: to.id, name: edge.toStopName || to.name, latitude: to.latitude, longitude: to.longitude });
    segment.distance += edge.distance;
    segment.time += edge.time;
    legs[legs.length - 1].push(edge.path);
  }
  // A ride is drawn along the road or the track where its legs have one (shape.ts,
  // metro.ts), a walk to or from a metro station by its exit, any other walk straight.
  segments.forEach((segment, i) => {
    const road = joinLegs(segment.stops.map((s): LatLng => [s.latitude, s.longitude]), legs[i]);
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
 * at least once. Starting labels carry their own cost, so a search could also
 * begin with several walks to nearby stops.
 */
function cheapest(graph: RoutingGraph, starts: readonly Label[], target: number): Label | null {
  const best = new Map<string, Label>();
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
    if (current.stopId === target && current.cost[1] > 0) return current;

    for (const edge of graph.getEdges(current.stopId)) {
      const walking = edge.kind === "walk";
      if (walking && (current.edge?.kind === "walk" || edge.distance > WALK_RADIUS_KM)) continue;
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
      const key = edge.kind === "walk"
        ? `${edge.toStopId}:walk:${cost[1] > 0 ? "boarded" : "start"}`
        : `${edge.toStopId}:${edge.kind}:${edge.rideId}:${edge.toSequence}`;
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
  const start: Label = { key: `${source}:start`, stopId: source, cost: [0, 0, 0, 0, 0], previous: null, edge: null, boarded: false };

  // This short walking option never comes from a chain of transfer edges. It costs
  // less than any boarding, so it is the cheapest journey whenever it exists.
  const walk = graph.getEdges(source).find(e => e.kind === "walk" && e.toStopId === target && e.distance <= WALK_RADIUS_KM);
  if (walk) return reconstruct(graph, {
    key: `${target}:walk`, stopId: target, previous: start, edge: walk, boarded: false,
    cost: [walk.time, 0, walk.distance, walk.distance, walk.time],
  });

  const destination = cheapest(graph, [start], target);
  return destination && reconstruct(graph, destination);
}
