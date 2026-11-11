import type { BusLite, StopDetail } from "@/lib/busroute/types";
import type { PlaceMatch } from "@/lib/busroute/places";
import { haversine } from "@/lib/busroute/geo";
import { normalizeSearch } from "@/lib/busroute/searchText";

// The folding the place search on the server uses too (#720).
export { normalizeSearch };

function rank(query: string, name: string, code: string): number {
  const label = normalizeSearch(name), key = normalizeSearch(code);
  if (label === query || key === query) return 0;
  if (label.startsWith(query) || key.startsWith(query)) return 1;
  return query.split(" ").every(word => `${label} ${key}`.includes(word)) ? 2 : Infinity;
}

/** Stops matching a query, best first, each with its rank: 0 the name or code itself,
 *  1 the start of it, 2 every word somewhere in it. */
export function rankStops(stops: StopDetail[], query: string): Array<{ stop: StopDetail; rank: number }> {
  const q = normalizeSearch(query);
  if (!q) return [];
  return stops.map(stop => ({ stop, rank: rank(q, stop.name, stop.code) }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.stop.name.localeCompare(b.stop.name, "az") || a.stop.id - b.stop.id)
    .slice(0, 25);
}

export function searchStops(stops: StopDetail[], query: string): StopDetail[] {
  if (!normalizeSearch(query)) return stops.filter(stop => stop.is_transport_hub).slice(0, 12);
  return rankStops(stops, query).map(item => item.stop);
}

export type EndSuggestion =
  | { kind: "stop"; stop: StopDetail; rank: number }
  | { kind: "place"; place: PlaceMatch; rank: number };

/**
 * A start or destination picker's list (#720): the stops and the places that match, the
 * better matches first whichever they are, and a stop before a place that matches as
 * well. A place's looser matches count with a stop's loosest. An empty query offers the
 * transport hubs, as before places.
 */
export function suggestEnds(stops: StopDetail[], query: string, places: PlaceMatch[]): EndSuggestion[] {
  if (!normalizeSearch(query)) return searchStops(stops, query).map(stop => ({ kind: "stop", stop, rank: 0 }));
  const found: EndSuggestion[] = [
    ...rankStops(stops, query).map(({ stop, rank }): EndSuggestion => ({ kind: "stop", stop, rank })),
    ...places.map((place): EndSuggestion => ({ kind: "place", place, rank: Math.min(place.rank, 2) })),
  ];
  return found.sort((a, b) => a.rank - b.rank);
}

export function searchBuses(buses: BusLite[], query: string): BusLite[] {
  const q = normalizeSearch(query);
  return buses.map(bus => ({ bus, rank: q ? rank(q, `${bus.first_point} ${bus.last_point}`, bus.number) : 0 }))
    .filter(item => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank || a.bus.number.localeCompare(b.bus.number, "az", { numeric: true }))
    .slice(0, 40).map(item => item.bus);
}

// Do not silently call a stop across town "nearby". Shared with map snapping.
export const NEARBY_STOP_RADIUS_KM = 0.6;

export function nearestStop(stops: StopDetail[], lat: number, lng: number) {
  let stop: StopDetail | null = null;
  let distance = Infinity;
  for (const candidate of stops) {
    const d = haversine(lat, lng, candidate.latitude, candidate.longitude);
    if (d < distance) { stop = candidate; distance = d; }
  }
  return stop && distance <= NEARBY_STOP_RADIUS_KM ? { stop, distance } : null;
}
