/**
 * Nearby-stop connections, rebuilt from the reference coordinates at graph
 * load. A spatial grid avoids comparing every pair; legacy precomputed rows
 * omitted useful links based on route membership and input order (#664).
 */
import { haversine, WALK_RADIUS_KM, WALK_SPEED_KMH } from "./geo";
import { StopDetail, WalkingEdge } from "./types";

export function computeWalkingEdges(
  stops: StopDetail[]
): WalkingEdge[] {
  const edges: WalkingEdge[] = [];
  const cells = new Map<string, StopDetail[]>();
  // These cells cover more than 300 m at Baku's latitude. Inspecting the eight
  // neighbors cannot miss a pair inside the radius, including cell boundaries.
  const latCell = 0.004, lonCell = 0.005;
  for (const a of stops) {
    const x = Math.floor(a.latitude / latCell), y = Math.floor(a.longitude / lonCell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const b of cells.get(`${x + dx}:${y + dy}`) ?? []) {
        const dist = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
        if (dist > WALK_RADIUS_KM) continue;
        const walkTime = (dist / WALK_SPEED_KMH) * 60; // minutes
        edges.push({ from_stop_id: a.id, to_stop_id: b.id, distance_km: dist, time_min: walkTime });
        edges.push({ from_stop_id: b.id, to_stop_id: a.id, distance_km: dist, time_min: walkTime });
      }
    }
    const key = `${x}:${y}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(a);
  }
  return edges;
}
