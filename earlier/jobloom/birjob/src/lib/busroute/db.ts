/**
 * Postgres/Prisma data-access layer for the bus route planner.
 *
 * Tables in the `bus` schema are a static reference snapshot. The crawler and
 * import script were retired; these functions only read the retained data.
 */
import { prisma } from "@/lib/prisma";
import type { StopDetail, Bus, BusStop, BusLite, BusLineDetail, BusLineStop, LatLng } from "./types";
import { collapseRepeatedSequence } from "./sequence";
import { joinLegs, legPaths } from "./shape";

export async function queryStopDetails(): Promise<StopDetail[]> {
  const rows = await prisma.bus_stop_details.findMany({ orderBy: { id: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    is_transport_hub: r.is_transport_hub,
  }));
}

export async function queryBuses(): Promise<Bus[]> {
  const rows = await prisma.bus_buses.findMany({ orderBy: { id: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    carrier: r.carrier,
    number: r.number,
    first_point: r.first_point,
    last_point: r.last_point,
    route_length: r.route_length,
    tariff: r.tariff,
    tariff_str: r.tariff_str,
    region_id: r.region_id,
    working_zone_type_id: r.working_zone_type_id,
    duration_minuts: r.duration_minuts,
  }));
}

export async function queryBusStops(): Promise<BusStop[]> {
  const rows = await prisma.bus_bus_stops.findMany({
    orderBy: [{ bus_id: "asc" }, { direction_type_id: "asc" }, { bus_stop_id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    bus_stop_id: r.bus_stop_id,
    bus_id: r.bus_id,
    stop_id: r.stop_id,
    stop_code: r.stop_code,
    stop_name: r.stop_name,
    total_distance: r.total_distance,
    intermediate_distance: r.intermediate_distance,
    direction_type_id: r.direction_type_id,
  }));
}

/** Recorded route lines by route id, points in sequence order. */
function linesByRoute(points: Array<{ route_id: number; latitude: number; longitude: number }>): Map<number, LatLng[]> {
  const lines = new Map<number, LatLng[]>();
  for (const p of points) {
    const line = lines.get(p.route_id);
    if (line) line.push([p.latitude, p.longitude]);
    else lines.set(p.route_id, [[p.latitude, p.longitude]]);
  }
  return lines;
}

/** Every recorded route line, keyed `${bus_id}:${direction_type_id}` like the graph's
 *  rides. About 109,000 points for 398 lines; the graph reads them once per process. */
export async function queryRouteShapes(): Promise<Map<string, LatLng[]>> {
  const [routes, points] = await Promise.all([
    prisma.bus_routes.findMany({ select: { id: true, bus_id: true, direction_type_id: true } }),
    prisma.bus_route_coordinates.findMany({
      select: { route_id: true, latitude: true, longitude: true },
      orderBy: [{ route_id: "asc" }, { sequence_order: "asc" }],
    }),
  ]);
  const lines = linesByRoute(points);
  const shapes = new Map<string, LatLng[]>();
  for (const r of routes) {
    const line = lines.get(r.id);
    if (line) shapes.set(`${r.bus_id}:${r.direction_type_id}`, line);
  }
  return shapes;
}

/** One bus's recorded lines by direction. */
async function queryBusLines(busId: number): Promise<Map<number, LatLng[]>> {
  const routes = await prisma.bus_routes.findMany({
    where: { bus_id: busId },
    select: { id: true, direction_type_id: true },
  });
  const lines = linesByRoute(await prisma.bus_route_coordinates.findMany({
    where: { route_id: { in: routes.map((r) => r.id) } },
    select: { route_id: true, latitude: true, longitude: true },
    orderBy: [{ route_id: "asc" }, { sequence_order: "asc" }],
  }));
  const byDirection = new Map<number, LatLng[]>();
  for (const r of routes) {
    const line = lines.get(r.id);
    if (line) byDirection.set(r.direction_type_id, line);
  }
  return byDirection;
}

export async function getDataLastUpdated(): Promise<string | null> {
  const agg = await prisma.bus_buses.aggregate({ _max: { created_at: true } });
  return agg._max.created_at ? agg._max.created_at.toISOString() : null;
}

/** Lightweight list for nearest-stop (GPS) lookups. */
export async function listStopsForGeo() {
  const rows = await prisma.bus_stop_details.findMany({
    select: { id: true, code: true, name: true, latitude: true, longitude: true, is_transport_hub: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    is_transport_hub: r.is_transport_hub,
  }));
}

/** Lightweight list of buses (number + endpoints + length) for the line-viewer
 *  picker. Whole-dataset, changes only on a manual re-import. Excludes buses that
 *  have no stops in bus_bus_stops (a few defunct rows exist, e.g. №539) so the
 *  picker never offers a line the viewer can't draw. */
export async function listBusesLite(): Promise<BusLite[]> {
  const [rows, withStops] = await Promise.all([
    prisma.bus_buses.findMany({
      select: { id: true, number: true, first_point: true, last_point: true, route_length: true, duration_minuts: true },
    }),
    prisma.bus_bus_stops.findMany({ select: { bus_id: true }, distinct: ["bus_id"] }),
  ]);
  const hasStops = new Set(withStops.map((r) => r.bus_id));
  return rows
    .filter((r) => hasStops.has(r.id))
    .map((r) => ({
      id: r.id,
      number: r.number.trim(),
      first_point: r.first_point.trim(),
      last_point: r.last_point.trim(),
      route_length: r.route_length,
      duration_minuts: r.duration_minuts,
    }));
}

/**
 * Full trajectory of one bus line in one direction: metadata, the ordered stops
 * (travel order = cumulative distance asc, mirroring lib/bus.ts getBusStops),
 * the directions this bus has (for the Gediş/Qayıdış toggle), and the road it
 * follows. Stops come from bus_bus_stops (always populated) joined to
 * bus_stop_details for coordinates; the road is bus_route_coordinates matched to
 * those stops (shape.ts), and empty when nothing fits, so the caller falls back to
 * a stop-to-stop line.
 */
export async function queryBusLine(
  busId: number,
  directionTypeId: number,
): Promise<BusLineDetail | null> {
  const bus = await prisma.bus_buses.findUnique({ where: { id: busId } });
  if (!bus) return null;

  // Directions this bus actually has (drives the Gediş/Qayıdış toggle).
  const dirRows = await prisma.bus_bus_stops.findMany({
    where: { bus_id: busId },
    select: { direction_type_id: true },
    distinct: ["direction_type_id"],
    orderBy: { direction_type_id: "asc" },
  });
  const availableDirections = dirRows.map((d) => d.direction_type_id);
  // Fall back to the first available direction if the requested one has no stops.
  const direction = availableDirections.includes(directionTypeId)
    ? directionTypeId
    : availableDirections[0] ?? directionTypeId;

  // Ordered stops for this direction (travel order = cumulative distance asc),
  // one copy of a list the snapshot stores twice over, as the planner's graph uses.
  const stopRows = collapseRepeatedSequence(await prisma.bus_bus_stops.findMany({
    where: { bus_id: busId, direction_type_id: direction },
    select: { stop_id: true, total_distance: true },
    orderBy: [{ total_distance: "asc" }, { bus_stop_id: "asc" }, { id: "asc" }],
  }), (r) => r.stop_id);
  const stopIds = [...new Set(stopRows.map((r) => r.stop_id))];
  const details = await prisma.bus_stop_details.findMany({
    where: { id: { in: stopIds } },
    select: { id: true, code: true, name: true, latitude: true, longitude: true, is_transport_hub: true },
  });
  const detailById = new Map(details.map((d) => [d.id, d]));
  const stops: BusLineStop[] = [];
  for (const r of stopRows) {
    const d = detailById.get(r.stop_id);
    if (!d) continue;
    // De-dupe consecutive identical stops (data sometimes repeats a hub).
    if (stops.length && stops[stops.length - 1].id === d.id) continue;
    stops.push({
      id: d.id, code: d.code ?? "", name: d.name,
      latitude: d.latitude, longitude: d.longitude,
      is_transport_hub: d.is_transport_hub,
    });
  }

  // The road the line follows, matched to its stops the way the planner's rides
  // are (#685): a recorded line can be broken, misfiled or backwards (521's second
  // direction is stored as longitude, latitude), so it is never drawn as stored.
  // Empty when no leg has a road; the map then joins the stops.
  const lines = await queryBusLines(busId);
  const own = lines.get(direction);
  const others = [...lines].filter(([d]) => d !== direction).map(([, line]) => line);
  const points = stops.map((s): LatLng => [s.latitude, s.longitude]);
  const path = joinLegs(points, legPaths(points, own ? [own, ...others] : others)) ?? [];
  const coordinates = path.map(([latitude, longitude]) => ({ latitude, longitude }));

  return {
    busId: bus.id,
    number: bus.number.trim(),
    carrier: bus.carrier,
    first_point: bus.first_point.trim(),
    last_point: bus.last_point.trim(),
    route_length: bus.route_length,
    duration_minuts: bus.duration_minuts,
    tariff_str: bus.tariff_str,
    direction,
    availableDirections,
    stops,
    coordinates,
  };
}
