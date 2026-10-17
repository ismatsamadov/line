/**
 * Minimum-boardings routing (#664). Labels compare lexicographically:
 * boardings, estimated movement time, walking distance, total distance.
 * A finite transfer penalty cannot guarantee that one bus beats two.
 *
 * A ride continues only along consecutive positions of the same direction.
 * One walking edge (at most 300 m) is allowed between rides or at either end;
 * walking edges cannot chain into an unbounded shortcut. A directly walkable
 * destination is returned as a separate short walking journey.
 */
import type { TransitGraph } from "./graph";
import type { GraphEdge, RouteResult, RouteSegment } from "./types";
import { WALKING_EDGE_BUS_ID } from "./types";
import { WALK_RADIUS_KM } from "./geo";

type RoutingGraph = Pick<TransitGraph, "getEdges" | "getStopInfo">;
type Cost = readonly [boardings: number, minutes: number, walkingKm: number, distanceKm: number];
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
  for (const label of path) {
    const edge = label.edge!;
    const from = graph.getStopInfo(label.previous!.stopId)!;
    const to = graph.getStopInfo(label.stopId)!;
    let segment = segments[segments.length - 1];
    if (!segment || label.boarded || edge.kind === "walk") {
      segment = {
        busId: edge.busId, busNumber: edge.busNumber,
        direction: edge.kind === "bus" ? edge.direction : null,
        headsign: edge.kind === "bus" ? edge.headsign : null,
        stops: [{ id: from.id, name: edge.fromStopName || from.name, latitude: from.latitude, longitude: from.longitude }],
        distance: 0, time: 0,
      };
      segments.push(segment);
    }
    segment.stops.push({ id: to.id, name: edge.toStopName || to.name, latitude: to.latitude, longitude: to.longitude });
    segment.distance += edge.distance;
    segment.time += edge.time;
  }
  let totalStops = 0, lastStopId: number | null = null;
  for (const segment of segments) if (segment.busId !== WALKING_EDGE_BUS_ID) {
    for (const stop of segment.stops) {
      if (stop.id !== lastStopId) totalStops++;
      lastStopId = stop.id;
    }
  }
  return {
    segments,
    totalDistance: Math.round(destination.cost[3] * 100) / 100,
    totalTime: Math.round(destination.cost[1] * 10) / 10,
    totalTransfers: Math.max(0, destination.cost[0] - 1),
    totalStops,
  };
}

export function findRoute(graph: RoutingGraph, source: number, target: number): RouteResult | null {
  if (source === target || !graph.getStopInfo(source) || !graph.getStopInfo(target)) return null;
  const start: Label = { key: `${source}:start`, stopId: source, cost: [0, 0, 0, 0], previous: null, edge: null, boarded: false };
  const best = new Map<string, Label>([[start.key, start]]);
  const queue = new PriorityQueue();
  queue.push(start);

  // This short walking option never comes from a chain of transfer edges.
  const walk = graph.getEdges(source).find(e => e.kind === "walk" && e.toStopId === target && e.distance <= WALK_RADIUS_KM);
  if (walk) return reconstruct(graph, {
    key: `${target}:walk`, stopId: target, previous: start, edge: walk, boarded: false,
    cost: [0, walk.time, walk.distance, walk.distance],
  });

  let current: Label | undefined;
  while ((current = queue.pop())) {
    // Queue entries hold immutable labels; an improved label makes the old
    // entry stale, even if it was enqueued before the improvement.
    if (best.get(current.key) !== current) continue;
    if (current.stopId === target && current.cost[0] > 0) return reconstruct(graph, current);

    for (const edge of graph.getEdges(current.stopId)) {
      const walking = edge.kind === "walk";
      if (walking && (current.edge?.kind === "walk" || edge.distance > WALK_RADIUS_KM)) continue;
      const continuesRide = edge.kind === "bus" && current.edge?.kind === "bus"
        && current.edge.rideId === edge.rideId && current.edge.toSequence === edge.fromSequence;
      const boarded = !walking && !continuesRide;
      const cost: Cost = [
        current.cost[0] + Number(boarded), current.cost[1] + edge.time,
        current.cost[2] + (walking ? edge.distance : 0), current.cost[3] + edge.distance,
      ];
      const key = edge.kind === "bus"
        ? `${edge.toStopId}:bus:${edge.rideId}:${edge.toSequence}`
        : `${edge.toStopId}:walk:${cost[0] > 0 ? "boarded" : "start"}`;
      const previous = best.get(key);
      if (previous && compare(previous.cost, cost) <= 0) continue;
      const next: Label = { key, stopId: edge.toStopId, cost, previous: current, edge, boarded };
      best.set(key, next);
      queue.push(next);
    }
  }
  return null;
}
