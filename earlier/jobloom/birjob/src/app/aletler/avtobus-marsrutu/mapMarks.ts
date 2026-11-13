/**
 * How the map marks a journey: its ends, shared with the legend under it so the two
 * always look alike, and which of its stops get a marker. Kept out of BusMap.tsx, which
 * the page loads apart (Leaflet), so the legend does not pull the map into the page's own
 * chunk, and so the tests can read the rules without a browser.
 */
import type { BusLineDetail, BusLineStop, RouteResult } from "@/lib/busroute/types";

/** The start's green and the destination's red, as the pickers' dots show them. */
export const END_COLORS = { from: "#16a34a", to: "#dc2626" } as const;

/** A map pin 28 × 36, its tip at the bottom: a chosen place (#720). */
export const PLACE_PIN_PATH = "M14 1.5C7.1 1.5 1.5 6.9 1.5 13.7 1.5 23 14 34.5 14 34.5S26.5 23 26.5 13.7C26.5 6.9 20.9 1.5 14 1.5z";

/**
 * The stops a found journey marks: every stop its segments list, but a misplaced one it
 * only rides past (#743). The data stores those off the ride, which is drawn straight
 * past them: 3841 2.4 km from 537's and 3095 2.0 km from 536's. A stop the journey also
 * boards, leaves or walks to keeps its marker where it is stored, since the journey goes
 * there.
 */
export function markedStopIds(route: RouteResult): Set<number> {
  const ids = new Set<number>();
  for (const segment of route.segments) for (const stop of segment.stops) if (!stop.misplaced) ids.add(stop.id);
  return ids;
}

/**
 * The stops the line viewer marks with a dot: those between the line's two ends, which
 * have pins of their own, but a misplaced one (#743). The line runs straight past it
 * (queryBusLine in db.ts), so a dot where the data stores it would stand off the line.
 */
export function markedLineStops(line: Pick<BusLineDetail, "stops">): BusLineStop[] {
  return line.stops.filter((stop, i) => i > 0 && i < line.stops.length - 1 && !stop.misplaced);
}
