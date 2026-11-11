import type { BusLite, StopDetail } from "@/lib/busroute/types";
import type { PlaceMatch } from "@/lib/busroute/places";
import { haversine } from "@/lib/busroute/geo";
import { ACCESS_RADIUS_KM } from "@/lib/busroute/access";
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

/** Everyday kinds of place, the ones places.ts weighs 4 or less: there are many of each,
 *  and their names are often a district's or a station's ("Gənclik" is two cafés). */
export const EVERYDAY_PLACES: ReadonlySet<string> = new Set([
  "supermarket", "restaurant", "school", "worship", "residential", "cafe", "kindergarten", "post_office", "bank", "office", "shop",
]);

/** Where journeys most often start and end, few of each: places.ts's HUBS. Such a place
 *  comes before a stop that matches as well (#720). */
export const HUB_PLACES: ReadonlySet<string> = new Set(["metro", "rail", "airport", "bus_station", "mall"]);

/**
 * How well an earlier answer's place matches a newer query, on the stops' scale (rank():
 * 0 its name or other name itself, 1 the start of one, 2 every word in them, a hub's 2
 * counting as 1 as on the server), then 3 for a looser match: every word in its names and
 * kind, or the query without its spaces in a name without its ("28ma" in 28 Mall).
 * Infinity when it no longer matches. The search answers each query with its own ranks;
 * this ranks the places carried over while it is asked (usePlaceSearch).
 */
export function placeRank(query: string, place: Pick<PlaceMatch, "name" | "alias" | "label" | "category">): number {
  const q = normalizeSearch(query);
  const names = [place.name, place.alias ?? ""].map(normalizeSearch).filter(Boolean);
  const matched = rank(q, place.name, place.alias ?? "");
  if (matched < Infinity) return matched === 2 && HUB_PLACES.has(place.category) ? 1 : matched;
  if (q.split(" ").every(word => `${names.join(" ")} ${normalizeSearch(place.label)}`.includes(word))) return 3;
  const compact = q.replaceAll(" ", "");
  const joined = names.map(name => name.replaceAll(" ", ""));
  if (joined.includes(compact)) return 0;
  if (joined.some(name => name.startsWith(compact))) return 1;
  return compact.length >= 4 && joined.some(name => name.includes(compact)) ? 3 : Infinity;
}

/**
 * A start or destination picker's list (#720): the stops and the places that match, the
 * better matches first whichever they are. A place of an everyday kind ranks one step
 * below its match, so a café named exactly what was typed comes after a stop, a metro
 * station or a mall whose name starts with it; typing "gənclik" listed two cafés above
 * Gənclik m/st. A place's looser matches count with a stop's loosest. Among equal
 * matches a station, an airport, a bus station or a mall comes first (HUB_PLACES), then
 * a stop, then a place of another kind, then an everyday one, each in its own order. A
 * place no journey can reach (`reachable`) comes after all of them. An empty query
 * offers the transport hubs, as before places.
 */
export function suggestEnds(stops: StopDetail[], query: string, places: PlaceMatch[],
  reachable: (place: PlaceMatch) => boolean = () => true): EndSuggestion[] {
  if (!normalizeSearch(query)) return searchStops(stops, query).map(stop => ({ kind: "stop", stop, rank: 0 }));
  const everyday = (found: EndSuggestion) => found.kind === "place" && EVERYDAY_PLACES.has(found.place.category);
  const order = (found: EndSuggestion) => found.kind === "stop" ? 0
    : HUB_PLACES.has(found.place.category) ? -1 : everyday(found) ? 2 : 1;
  const dead = (found: EndSuggestion) => Number(found.kind === "place" && !reachable(found.place));
  const found: EndSuggestion[] = [
    ...rankStops(stops, query).map(({ stop, rank }): EndSuggestion => ({ kind: "stop", stop, rank })),
    ...places.map((place): EndSuggestion => ({
      kind: "place", place, rank: Math.min(place.rank + (EVERYDAY_PLACES.has(place.category) ? 1 : 0), 2),
    })),
  ];
  return found.sort((a, b) => dead(a) - dead(b) || a.rank - b.rank || order(a) - order(b));
}

/** The rows a picker has shown for one query, in the order shown. */
export interface ShownRows<T> {
  query: string;
  rows: T[];
}

/**
 * The rows to show for `query`: `fresh` as it is for a new query, but for the query
 * already on screen every row shown stays where it is and rows that arrive later go
 * below them (#720). The places answer a moment after the stops, and merged into them
 * they pushed the shown rows down under the finger about to tap one: on a phone the
 * first row turned from the stop "Gənclik küç. 120" into a café. The next keystroke
 * orders the list afresh.
 */
export function keepShownRows<T extends { key: string }>(shown: ShownRows<T> | null, query: string, fresh: T[]): ShownRows<T> {
  if (!shown || shown.query !== query) return { query, rows: fresh };
  const latest = new Map(fresh.map(row => [row.key, row]));
  const rows = shown.rows.map(row => latest.get(row.key) ?? row);
  const kept = new Set(rows.map(row => row.key));
  return { query, rows: [...rows, ...fresh.filter(row => !kept.has(row.key))] };
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

export function nearestStop(stops: StopDetail[], lat: number, lng: number, radiusKm = NEARBY_STOP_RADIUS_KM, { named = false } = {}) {
  let stop: StopDetail | null = null;
  let distance = Infinity;
  for (const candidate of stops) {
    if (named && !candidate.name.trim()) continue;
    const d = haversine(lat, lng, candidate.latitude, candidate.longitude);
    if (d < distance) { stop = candidate; distance = d; }
  }
  return stop && distance <= radiusKm ? { stop, distance } : null;
}

/** The stop with a name nearest a place within the walk a journey takes from it, which
 *  the place's row names. The snapshot's 385 nameless stops are the ones no bus serves,
 *  which the planner never walks a place to either (#720). */
export const placeStopNear = (stops: StopDetail[], place: { latitude: number; longitude: number }) =>
  nearestStop(stops, place.latitude, place.longitude, ACCESS_RADIUS_KM, { named: true });

/** A point to two decimals, about 1 km: how near the person's location the place search
 *  may be told it is, since its address reaches caches, logs and error reports (#720). */
export const coarsePoint = (point: { latitude: number; longitude: number }) => ({
  latitude: Math.round(point.latitude * 100) / 100, longitude: Math.round(point.longitude * 100) / 100,
});
