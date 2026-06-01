/**
 * Walking-transfer edge computation (≤300 m between bus-served stops).
 *
 * This is the O(n²) pass that the original project ran at graph-build time.
 * Here it's factored out so it can be run ONCE offline by the import script
 * (scripts/bus/import.ts) and stored in `bus.bus_walking_edges`. The graph then
 * just loads the rows — no n² work on a serverless cold start. Kept as a
 * fallback in graph.build() for the case where the table hasn't been populated.
 */
import { haversine, WALK_RADIUS_KM, WALK_SPEED_KMH } from "./geo";
import { StopDetail, BusStop, WalkingEdge } from "./types";

export function computeWalkingEdges(
  stops: StopDetail[],
  busStops: BusStop[]
): WalkingEdge[] {
  const edges: WalkingEdge[] = [];

  // Which buses serve each stop.
  const stopBuses = new Map<number, Set<number>>();
  for (const bs of busStops) {
    if (!stopBuses.has(bs.stop_id)) stopBuses.set(bs.stop_id, new Set());
    stopBuses.get(bs.stop_id)!.add(bs.bus_id);
  }

  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    const busesA = stopBuses.get(a.id);

    for (let j = i + 1; j < stops.length; j++) {
      const b = stops[j];

      // Cheap bounding-box prefilter before haversine (0.3 km ≈ 0.003°).
      if (Math.abs(a.latitude - b.latitude) > 0.004) continue;
      if (Math.abs(a.longitude - b.longitude) > 0.005) continue;

      const dist = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
      if (dist > WALK_RADIUS_KM) continue;

      // Both stops must be bus-served, and B must expose a route A lacks
      // (otherwise the walk is redundant — stay on the bus).
      const busesB = stopBuses.get(b.id);
      if (!busesA || busesA.size === 0 || !busesB || busesB.size === 0) continue;
      let hasDifferentBus = false;
      for (const bus of busesB) {
        if (!busesA.has(bus)) {
          hasDifferentBus = true;
          break;
        }
      }
      if (!hasDifferentBus) continue;

      const walkTime = (dist / WALK_SPEED_KMH) * 60; // minutes

      // Bidirectional.
      edges.push({ from_stop_id: a.id, to_stop_id: b.id, distance_km: dist, time_min: walkTime });
      edges.push({ from_stop_id: b.id, to_stop_id: a.id, distance_km: dist, time_min: walkTime });
    }
  }

  return edges;
}
