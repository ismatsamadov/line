import type { BusLineDetail, RouteResult } from "@/lib/busroute/types";

/** A chosen end: a stop, a named place or the person's location (#720). */
type End = { latitude: number; longitude: number };

/** What the map fits its view to, most relevant first. */
export interface FitTargets {
  route: RouteResult | null;
  line: BusLineDetail | null;
  from: End | null;
  to: End | null;
}

/** The two Leaflet map methods a fit uses. Kept apart from Leaflet, which needs a
 *  browser, so the rules below run in the unit tests. */
export interface FitMap {
  fitBounds(bounds: [number, number][], options: FitPadding): unknown;
  setView(center: [number, number], zoom: number): unknown;
}

type FitPadding = { padding: [number, number] } | { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] };

// A chosen stop's, place's or location's label stands above its marker, a place's above
// a pin 36 px tall (#720), so a view of the ends keeps room at the top for the label
// and the layer switch in the corner: with 50 px all round, an end near the top had its
// label under the switch.
const ENDS_PADDING: FitPadding = { paddingTopLeft: [50, 110], paddingBottomRight: [50, 40] };

/** Fit the view to the most relevant features. */
export function fitFeatures(map: FitMap, { route, line, from, to }: FitTargets): void {
  if (route) {
    // The road a ride follows can bend beyond its stops, so the fit takes it in, and a
    // walk from or to a place has the place as its first or last stop (#720).
    const coords: [number, number][] = [];
    for (const seg of route.segments) {
      for (const point of seg.path ?? seg.stops.map((s): [number, number] => [s.latitude, s.longitude])) coords.push(point);
    }
    if (coords.length) map.fitBounds(coords, ENDS_PADDING);
  } else if (line) {
    const coords: [number, number][] = line.coordinates.length >= 2
      ? line.coordinates.map((c) => [c.latitude, c.longitude])
      : line.stops.map((s) => [s.latitude, s.longitude]);
    if (coords.length) map.fitBounds(coords, { padding: [50, 50] });
  } else if (from && to) {
    map.fitBounds([[from.latitude, from.longitude], [to.latitude, to.longitude]], ENDS_PADDING);
  } else if (from) {
    map.setView([from.latitude, from.longitude], 15);
  }
}

/**
 * Whether a Leaflet resize took the map from no size to a real one. On a phone the
 * map mounts in the hidden tab, where Leaflet measures it as 0×0, and a fit made
 * then lands at maximum zoom on the journey's middle (#685): its padding exceeds
 * the size, the scale goes negative and the zoom comes out as Infinity, clamped to
 * the maximum. Refit on this resize only; an ordinary window resize keeps the view.
 */
export function sizedFromZero(event: { oldSize: { x: number; y: number } }): boolean {
  return event.oldSize.x === 0 || event.oldSize.y === 0;
}
