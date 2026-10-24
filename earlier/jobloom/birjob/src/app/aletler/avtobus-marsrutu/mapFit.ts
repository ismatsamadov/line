import type { BusLineDetail, RouteResult, StopDetail } from "@/lib/busroute/types";

/** What the map fits its view to, most relevant first. */
export interface FitTargets {
  route: RouteResult | null;
  line: BusLineDetail | null;
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
}

/** The two Leaflet map methods a fit uses. Kept apart from Leaflet, which needs a
 *  browser, so the rules below run in the unit tests. */
export interface FitMap {
  fitBounds(bounds: [number, number][], options: { padding: [number, number] }): unknown;
  setView(center: [number, number], zoom: number): unknown;
}

/** Fit the view to the most relevant features. */
export function fitFeatures(map: FitMap, { route, line, fromStop, toStop }: FitTargets): void {
  if (route) {
    // The road a ride follows can bend beyond its stops, so the fit takes it in.
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
  } else if (fromStop && toStop) {
    map.fitBounds([[fromStop.latitude, fromStop.longitude], [toStop.latitude, toStop.longitude]], { padding: [60, 60] });
  } else if (fromStop) {
    map.setView([fromStop.latitude, fromStop.longitude], 15);
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
