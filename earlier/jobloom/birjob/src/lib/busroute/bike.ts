/**
 * Baku's bicycle lanes and bicycle parking (#692): drawn on the planner's map, and the
 * racks nearest a journey's first boarding and last alighting named beside it.
 *
 * bike.json is written by scripts/bus/build_bike_json.py from AYNA's two open datasets
 * on opendata.az (CC0): the existing lanes, published on 24 September 2026, and 185
 * parking places, published on 4 May 2026. The parking places are racks. The dataset says where they are and
 * nothing else (no bicycles, no hire, no use counts), so nothing here routes by
 * bicycle: a rider who cycles to the bus or the metro is told where to leave it.
 */
import bikeJson from "./bike.json";
import { haversine, WALK_RADIUS_KM } from "./geo";
import type { LatLng, RouteResult, RouteSegment } from "./types";

export interface BikeLane {
  street: string;
  path: LatLng[];
}

export interface BikeParking {
  name: string;
  latitude: number;
  longitude: number;
}

export interface BikeData {
  lanes: BikeLane[];
  parking: BikeParking[];
}

/** bike.json as the script writes it, its points as [latitude, longitude] pairs;
 *  bike.test.ts checks its shape and its places. */
export const BIKE: BikeData = {
  lanes: bikeJson.lanes.map((lane) => ({ street: lane.street, path: lane.path.map((point): LatLng => [point[0], point[1]]) })),
  parking: bikeJson.parking,
};

/** A rack within a walk of a stop or station, `distance` in km in a straight line. */
export interface NearbyBikeParking extends BikeParking {
  distance: number;
}

/** The rack nearest a point, if one is within a walk (WALK_RADIUS_KM, as every walk here). */
export function nearestBikeParking(
  latitude: number, longitude: number, parking: readonly BikeParking[] = BIKE.parking,
): NearbyBikeParking | null {
  let nearest: NearbyBikeParking | null = null;
  for (const rack of parking) {
    const distance = haversine(latitude, longitude, rack.latitude, rack.longitude);
    if (distance <= WALK_RADIUS_KM && (!nearest || distance < nearest.distance)) nearest = { ...rack, distance };
  }
  return nearest;
}

type JourneyStop = RouteSegment["stops"][number];

/** The rack beside one end of a journey's rides. */
export interface BikeParkingAtStop {
  stop: JourneyStop;
  parking: NearbyBikeParking;
}

export interface JourneyBikeParking {
  boarding: BikeParkingAtStop | null;
  alighting: BikeParkingAtStop | null;
}

/**
 * The racks nearest where the first ride starts and where the last one ends: where a
 * rider who cycles to the bus or the metro leaves the bicycle, or finds it again. A walk
 * at either end is not counted, since the bicycle takes its place. Null for a journey
 * on foot, or when neither end has a rack within a walk.
 */
export function journeyBikeParking(route: RouteResult, parking: readonly BikeParking[] = BIKE.parking): JourneyBikeParking | null {
  const rides = route.segments.filter((segment) => segment.mode !== "walk");
  if (!rides.length) return null;
  const at = (stop: JourneyStop | undefined): BikeParkingAtStop | null => {
    const rack = stop ? nearestBikeParking(stop.latitude, stop.longitude, parking) : null;
    return stop && rack ? { stop, parking: rack } : null;
  };
  const last = rides[rides.length - 1];
  const ends: JourneyBikeParking = { boarding: at(rides[0].stops[0]), alighting: at(last.stops[last.stops.length - 1]) };
  return ends.boarding || ends.alighting ? ends : null;
}
