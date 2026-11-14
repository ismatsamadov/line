import type { RouteResult, RouteSegment } from '@/lib/busroute/types';

/** A positive movement duration must not look instantaneous after rounding. */
export const movementMinutes = (value: number) => value > 0 ? Math.max(1, Math.round(value)) : 0;

/** The boarding stop is present in the itinerary, but is not a stop travelled. */
export const travelledStopCount = (segment: RouteSegment) => Math.max(0, segment.stops.length - 1);

/** A walk's length: metres under a kilometre, kilometres from there, since a walk from
 *  or to a place runs up to 1 km and a walk the whole way up to 2 (#720). */
export const walkLength = (km: number) => Math.round(km * 1000) < 1000 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

/** Whether a journey goes the whole way on foot (#743). */
export const onFoot = (route: RouteResult) => route.segments.every((segment) => segment.mode === "walk");

/** What the walk or the ride says under its name where the two stand side by side
 *  (#743): a walk's minutes are all of it, and a ride's leave the wait out, which the
 *  walk does not have, so it says so. */
export const choiceDetail = (route: RouteResult) => onFoot(route)
  ? `≈ ${movementMinutes(route.totalTime)} dəq · ${walkLength(route.totalDistance)}`
  : `≈ ${movementMinutes(route.totalTime)} dəq + gözləmə`;
