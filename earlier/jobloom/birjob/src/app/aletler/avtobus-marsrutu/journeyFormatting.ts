import type { RouteSegment } from '@/lib/busroute/types';

/** A positive movement duration must not look instantaneous after rounding. */
export const movementMinutes = (value: number) => value > 0 ? Math.max(1, Math.round(value)) : 0;

/** The boarding stop is present in the itinerary, but is not a stop travelled. */
export const travelledStopCount = (segment: RouteSegment) => Math.max(0, segment.stops.length - 1);
