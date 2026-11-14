import type { BusLite, StopDetail } from "@/lib/busroute/types";
import type { PlaceMatch } from "@/lib/busroute/places";
import { haversine } from "@/lib/busroute/geo";
import { ACCESS_RADIUS_KM } from "@/lib/busroute/access";
import { normalizeSearch } from "@/lib/busroute/searchText";
import { exactName, HUBS, matchesLoosely, matchRank, ownWords, rankCompact, rankName, STREET } from "@/lib/busroute/placeMatch";

// The folding the place search on the server uses too (#720).
export { normalizeSearch };

/** A street long enough for its length to be told (#743). A journey to a street goes to
 *  its middle, and every part of a street up to 1 km long is within 500 m of that, well
 *  inside the 1 km a journey walks from a place; a longer one's middle can be far from
 *  where one is going, and its length says so. */
export const LONG_STREET_KM = 1;

/** What kind of place a row or a chosen end says it is: its category's label, with a
 *  long street's length ("Küçə, 3.2 km"). */
export function placeKind(place: Pick<PlaceMatch, "category" | "label" | "length">): string {
  if (place.category !== STREET || place.length === undefined || place.length < LONG_STREET_KM) return place.label;
  return `${place.label}, ${place.length < 10 ? place.length.toFixed(1) : Math.round(place.length)} km`;
}

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

/** Where journeys most often start and end, few of each: the place search's HUBS. Such a
 *  place comes before a stop that matches as well (#720). */
export const HUB_PLACES: ReadonlySet<string> = HUBS;

/**
 * How well an earlier answer's place matches a newer query, ranked as the place search
 * ranks it (placeMatch.ts): 0 its name or the other name it has itself, 1 the start of
 * one, 2 each word the start of one of its words, a hub's 2 counting as 1, 3 a looser
 * match. Infinity when it no longer matches. The search answers each query with its own
 * ranks; this ranks the places carried over while it is asked (usePlaceSearch). The
 * server tries a query without its spaces ("28ma" for 28 Mall) only when no place matches
 * it with them; a carried place is tried so whenever it does not itself.
 */
export function placeRank(query: string, place: Pick<PlaceMatch, "name" | "alias" | "label" | "category">): number {
  const q = normalizeSearch(query);
  const queryWords = q.split(" ");
  const shown = [place.name, ...(place.alias ? [place.alias] : [])];
  const names = shown.map(normalizeSearch);
  const words = names.map(name => name.split(" "));
  let matched = Infinity, which = 0;
  for (let i = 0; i < names.length && matched > 0; i++) {
    const r = rankName(q, queryWords, names[i], words[i], exactName(shown[i], place.category));
    if (r < matched) { matched = r; which = i; }
  }
  if (matched < Infinity) return matchRank(matched, place.category, queryWords, ownWords(shown[which]));
  const labelWords = normalizeSearch(place.label).split(" ");
  if (names.some((name, i) => matchesLoosely(queryWords, name, words[i], labelWords))) return 3;
  const compact = Math.min(...names.map(name => rankCompact(q.replaceAll(" ", ""), name.replaceAll(" ", ""))));
  return compact < Infinity ? matchRank(compact, place.category, queryWords, []) : compact;
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
 *  may be told it is, since its address reaches logs and error reports (#720). */
export const coarsePoint = (point: { latitude: number; longitude: number }) => ({
  latitude: Math.round(point.latitude * 100) / 100, longitude: Math.round(point.longitude * 100) / 100,
});
