/**
 * Postgres/Prisma data-access layer for the bus route planner.
 *
 * Replaces the source project's better-sqlite3 layer. Tables live in the `bus`
 * schema (see prisma/schema.prisma + prisma/migrations/add_bus_route_tables.sql),
 * loaded once into BirJob's Postgres by scripts/bus/import.ts. Functions keep
 * the original `async` query-* signatures so the ported engine is unchanged.
 */
import { prisma } from "@/lib/prisma";
import type { StopDetail, Bus, BusStop, RouteCoordinate, WalkingEdge, BusLite, BusLineDetail, BusLineStop } from "./types";

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

export async function queryWalkingEdges(): Promise<WalkingEdge[]> {
  const rows = await prisma.bus_walking_edges.findMany();
  return rows.map((r) => ({
    from_stop_id: r.from_stop_id,
    to_stop_id: r.to_stop_id,
    distance_km: r.distance_km,
    time_min: r.time_min,
  }));
}

export async function queryRouteCoordinates(routeId: number): Promise<RouteCoordinate[]> {
  const rows = await prisma.bus_route_coordinates.findMany({
    where: { route_id: routeId },
    orderBy: { sequence_order: "asc" },
  });
  return rows.map((r) => ({
    latitude: r.latitude,
    longitude: r.longitude,
    sequence_order: r.sequence_order,
  }));
}

export async function queryRoutesByBusAndDirection(
  busId: number,
  directionTypeId: number
): Promise<number | null> {
  const row = await prisma.bus_routes.findFirst({
    where: { bus_id: busId, direction_type_id: directionTypeId },
    select: { id: true },
  });
  return row ? row.id : null;
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
 * the directions this bus has (for the Gediş/Qayıdış toggle), and the
 * road-shaped route geometry when present. Stops come from bus_bus_stops (always
 * populated) joined to bus_stop_details for coordinates; the geometry from
 * bus_route_coordinates is optional — the caller falls back to a stop-to-stop
 * line when it's empty.
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

  // Ordered stops for this direction (travel order = cumulative distance asc).
  const stopRows = await prisma.bus_bus_stops.findMany({
    where: { bus_id: busId, direction_type_id: direction },
    select: { stop_id: true, total_distance: true },
    orderBy: { total_distance: "asc" },
  });
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

  // Road-shaped geometry for this direction (optional — may be empty).
  let coordinates: Array<{ latitude: number; longitude: number }> = [];
  const routeId = await queryRoutesByBusAndDirection(busId, direction);
  if (routeId) {
    const coords = await queryRouteCoordinates(routeId);
    coordinates = coords.map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
  }

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
