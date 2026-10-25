/**
 * Bus route planner types — ported from the best_route_finding project.
 * Baku public-transit topology planner (which buses and metro trains to take +
 * walking transfers).
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

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
  sequence_order: number;
}

/** Lightweight bus row for the line-viewer picker (number + endpoints + length). */
export interface BusLite {
  id: number;
  number: string;
  first_point: string;
  last_point: string;
  route_length: number;
  duration_minuts: number;
}

/** A stop along a single bus line (travel order), with coordinates for the map. */
export interface BusLineStop {
  id: number;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  is_transport_hub: boolean;
}

/** Full trajectory of one bus line in one direction — metadata + ordered stops +
 *  optional road-shaped geometry. `coordinates` may be empty; the map then draws
 *  a stop-to-stop line instead (graceful fallback). */
export interface BusLineDetail {
  busId: number;
  number: string;
  carrier: string;
  first_point: string;
  last_point: string;
  route_length: number;
  duration_minuts: number;
  tariff_str: string;
  /** The direction actually returned (may differ from the request if it had no stops). */
  direction: number;
  /** direction_type_id values this bus has (for the Gediş/Qayıdış toggle). */
  availableDirections: number[];
  stops: BusLineStop[];
  coordinates: Array<{ latitude: number; longitude: number }>;
}

/** A straight-line walking connection of at most 300 m. */
export interface WalkingEdge {
  from_stop_id: number;
  to_stop_id: number;
  distance_km: number;
  time_min: number;
}

interface EdgeInfo {
  toStopId: number;
  busId: number;
  busNumber: string;
  distance: number;
  time: number;
  fromStopName: string;
  toStopName: string;
}

/** A point as [latitude, longitude]. */
export type LatLng = [number, number];

/** A metro line as the operator names and colours it (#689). */
export interface MetroLine {
  name: string;
  color: string;
}

export type GraphEdge = EdgeInfo & (
  | {
      kind: "bus"; rideId: string; direction: number; fromSequence: number; toSequence: number; headsign: string;
      /** The road to the next stop, from AYNA's recorded line where it fits the stops (shape.ts). */
      path?: LatLng[];
    }
  | {
      /** A metro train, or the express bus the metro runs where its trains do not (metro.ts). */
      kind: "metro"; rideId: string; fromSequence: number; toSequence: number; headsign: string;
      line: MetroLine; vehicle: "train" | "bus";
      /** The track to the next station, from OpenStreetMap; none for the bus. */
      path?: LatLng[];
    }
  | {
      kind: "walk";
      /** A walk to or from a metro station, by the exit nearest the stop (metro.ts). */
      path?: LatLng[];
    }
);

export interface RouteSegment {
  busId: number;
  busNumber: string;
  /** What carries the rider: a bus (AYNA's, or the metro's express bus), a metro train,
   *  or their feet (#689). */
  mode: "bus" | "metro" | "walk";
  /** The metro line of a train, or of the express bus that stands in for its trains. */
  line?: MetroLine;
  direction: number | null;
  headsign: string | null;
  stops: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  distance: number;
  time: number;
  /** The ride along the road or the track, straight between stops where a leg has
   *  none; a walk to or from a metro station by its exit. Absent for any other walk,
   *  and for a ride none of whose legs has a road. */
  path?: LatLng[];
}

export interface RouteResult {
  segments: RouteSegment[];
  totalDistance: number;
  totalTime: number;
  totalTransfers: number;
  totalStops: number;
}

// Special bus ID indicating a walking transfer (not a bus ride)
export const WALKING_EDGE_BUS_ID = -1;
export const WALKING_EDGE_BUS_NUMBER = "walk";
// Bus ID of a ride the metro runs, train or express bus: it has no AYNA bus (#689).
export const METRO_RIDE_BUS_ID = -2;
// Graph ids of metro stations start above every AYNA stop id (3,841 in the snapshot).
export const METRO_STATION_ID_BASE = 1_000_000;
export const isMetroStation = (stopId: number) => stopId >= METRO_STATION_ID_BASE;
