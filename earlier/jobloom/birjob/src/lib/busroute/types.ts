/**
 * Bus route planner types — ported from the best_route_finding project.
 * Baku public-transit topology planner (which buses to take + walking transfers).
 */

export interface StopDetail {
  id: number;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  is_transport_hub: boolean;
}

export interface Bus {
  id: number;
  carrier: string;
  number: string;
  first_point: string;
  last_point: string;
  route_length: number;
  tariff: number;
  tariff_str: string;
  region_id: number;
  working_zone_type_id: number;
  duration_minuts: number;
}

export interface BusStop {
  id: number;
  bus_stop_id: number;
  bus_id: number;
  stop_id: number;
  stop_code: string;
  stop_name: string;
  total_distance: number;
  intermediate_distance: number | null;
  direction_type_id: number;
}

export interface RouteRecord {
  id: number;
  code: string;
  destination: string;
  bus_id: number;
  direction_type_id: number;
}

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
  sequence_order: number;
}

/** Precomputed ≤300 m walking transfer (loaded from bus_walking_edges). */
export interface WalkingEdge {
  from_stop_id: number;
  to_stop_id: number;
  distance_km: number;
  time_min: number;
}

export interface GraphEdge {
  toStopId: number;
  busId: number;
  busNumber: string;
  distance: number;
  time: number;
  fromStopName: string;
  toStopName: string;
}

export interface RouteSegment {
  busId: number;
  busNumber: string;
  stops: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  distance: number;
  time: number;
}

export interface RouteResult {
  segments: RouteSegment[];
  totalDistance: number;
  totalTime: number;
  totalTransfers: number;
  totalStops: number;
}

export type OptimizationMode = "shortest" | "fastest" | "balanced";

// Special bus ID indicating a walking transfer (not a bus ride)
export const WALKING_EDGE_BUS_ID = -1;
export const WALKING_EDGE_BUS_NUMBER = "walk";
