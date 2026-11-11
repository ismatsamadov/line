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
  fitBounds(bounds: [number, number][], options: { padding: [number, number] }): unknown;
  setView(center: [number, number], zoom: number): unknown;
}

/** Fit the view to the most relevant features. */
export function fitFeatures(map: FitMap, { route, line, from, to }: FitTargets): void {
  if (route) {
    // The road a ride follows can bend beyond its stops, so the fit takes it in, and a
    // walk from or to a place has the place as its first or last stop (#720).
    const coords: [number, number][] = [];
    for (const seg of route.segments) {
      for (const point of seg.path ?? seg.stops.map((s): [number, number] => [s.latitude, s.longitude])) coords.push(point);
    }
    if (coords.length) map.fitBounds(coords, { padding: [50, 50] });
  } else if (line) {
    const coords: [number, number][] = line.coordinates.length >= 2
      ? line.coordinates.map((c) => [c.latitude, c.longitude])
      : line.stops.map((s) => [s.latitude, s.longitude]);
    if (coords.length) map.fitBounds(coords, { padding: [50, 50] });
  } else if (from && to) {
    map.fitBounds([[from.latitude, from.longitude], [to.latitude, to.longitude]], { padding: [60, 60] });
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
