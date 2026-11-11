/**
 * How the map marks a journey's ends, shared with the legend under it so the two always
 * look alike. Kept out of BusMap.tsx, which the page loads apart (Leaflet), so the
 * legend does not pull the map into the page's own chunk.
 */

/** The start's green and the destination's red, as the pickers' dots show them. */
export const END_COLORS = { from: "#16a34a", to: "#dc2626" } as const;

/** A map pin 28 × 36, its tip at the bottom: a chosen place (#720). */
export const PLACE_PIN_PATH = "M14 1.5C7.1 1.5 1.5 6.9 1.5 13.7 1.5 23 14 34.5 14 34.5S26.5 23 26.5 13.7C26.5 6.9 20.9 1.5 14 1.5z";
