/**
 * Postgres/Prisma data-access layer for the bus route planner.
 *
 * Replaces the source project's better-sqlite3 layer. Tables live in the `bus`
 * schema (see prisma/schema.prisma + prisma/migrations/add_bus_route_tables.sql),
 * loaded once into BirJob's Postgres by scripts/bus/import.ts. Functions keep
 * the original `async` query-* signatures so the ported engine is unchanged.
 */
import { prisma } from "@/lib/prisma";
import type { StopDetail, Bus, BusStop, RouteCoordinate, WalkingEdge } from "./types";

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

/** Stop search for the picker (matches name or code, case-insensitive). */
export async function searchStops(q: string, limit = 20) {
  const term = q.trim();
  if (!term) return [];
  const rows = await prisma.bus_stop_details.findMany({
    where: {
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { code: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, code: true, name: true, latitude: true, longitude: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code ?? "",
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
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

export async function getStopById(id: number) {
  const r = await prisma.bus_stop_details.findUnique({ where: { id } });
  if (!r) return null;
  return { id: r.id, code: r.code ?? "", name: r.name, latitude: r.latitude, longitude: r.longitude };
}
