/**
 * The named places the planner's search offers as a start or a destination (#720):
 * malls, restaurants, universities, hospitals, markets, hotels, parks, offices, metro
 * stations, settlements, each in one of a fixed set of categories with an Azerbaijani label.
 *
 * places.json is written by scripts/bus/build_places_json.py from one OpenStreetMap
 * snapshot read through the Overpass API (its date and query are in the file), so the
 * data is © OpenStreetMap contributors under the ODbL and is credited wherever a place
 * is shown. Google's place data cannot be used: its terms forbid storing it and showing
 * it on a map that is not Google's. The file is read here, on the server, and
 * GET /api/avtobus/places sends at most eight places per search; it never goes to the
 * browser whole.
 */
import "server-only";
import { z } from "zod";
import { haversine } from "./geo";
import { normalizeSearch } from "./searchText";

/** [id, name, category, latitude, longitude, notable, other names], as the file's
 *  "fields" say. The id is OpenStreetMap's: n, w or r and the number. */
const Row = z.tuple([
  z.string().regex(/^[nwr][1-9]\d*$/), z.string().min(1), z.string(), z.number(), z.number(),
  z.union([z.literal(0), z.literal(1)]), z.array(z.string().min(1)),
]);
export const PlacesData = z.object({
  labels: z.record(z.string(), z.string().min(1)),
  places: z.array(Row),
});

export interface Place {
  id: string;
  name: string;
  category: string;
  /** The category as the planner shows it, in Azerbaijani ("Ticarət mərkəzi"). */
  label: string;
  latitude: number;
  longitude: number;
}

export interface PlaceMatch extends Place {
  /** 0 the name itself, 1 the start of it, 2 the start of each of its words, 3 looser:
   *  a word found inside it, or the category's name ("gənclik metro"). */
  rank: number;
  /** The other name that matched, when the one shown did not ("Ganjlik Mall"). */
  alias?: string;
}

// The places a search should put first among equally good matches: a metro station
// before a supermarket of the same name. A feature with a Wikidata entry is better known
// and gets NOTABLE more.
const WEIGHT: Record<string, number> = {
  metro: 9, airport: 9, mall: 8, rail: 7, bus_station: 7, market: 7, university: 7, hospital: 7,
  square: 7, settlement: 7, port: 6, park: 6, sight: 6, museum: 6, theatre: 6, hotel: 5,
  college: 5, clinic: 5, government: 5, embassy: 5, culture: 5, sport: 5, fun: 5, beach: 5,
  area: 5, supermarket: 4, restaurant: 4, school: 4, worship: 4, residential: 4, cafe: 3,
  kindergarten: 3, post_office: 3, bank: 3, office: 3, shop: 3,
};
const NOTABLE = 2;
export const PLACE_SEARCH_LIMIT = 8;

interface Entry {
  place: Place;
  /** The others' spelling as written, for `alias`. */
  others: string[];
  /** Every name folded, the shown one first, with each one's words. */
  names: string[];
  words: string[][];
  labelWords: string[];
  /** All of the above in one string: a query word missing from it cannot match. */
  haystack: string;
  weight: number;
}

export interface PlaceIndex {
  entries: Entry[];
}

/** Check places.json's shape and fold every name once, for searchPlaces. */
export function buildPlaceIndex(raw: unknown): PlaceIndex {
  const data = PlacesData.parse(raw);
  const entries = data.places.map(([id, name, category, latitude, longitude, notable, others]): Entry => {
    const label = data.labels[category];
    if (!label) throw new Error(`place ${id} has the unknown category ${category}`);
    const names = [name, ...others].map(normalizeSearch);
    const labelWords = normalizeSearch(label).split(" ");
    return {
      place: { id, name, category, label, latitude, longitude },
      others, names, words: names.map((n) => n.split(" ")), labelWords,
      haystack: `${names.join(" ")} ${labelWords.join(" ")}`,
      weight: (WEIGHT[category] ?? 0) + (notable ? NOTABLE : 0),
    };
  });
  return { entries };
}

/** How well one folded name matches the folded query: 0 to 2 as PlaceMatch.rank says. */
function rankName(query: string, queryWords: string[], name: string, words: string[]): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return queryWords.every((q) => words.some((w) => w.startsWith(q))) ? 2 : Infinity;
}

/** The looser match: each query word starts a word of the name or of the category, or,
 *  four letters or more, sits anywhere in the name. */
function rankLoosely(queryWords: string[], name: string, words: string[], labelWords: string[]): boolean {
  return queryWords.every((q) => words.some((w) => w.startsWith(q)) || labelWords.some((w) => w.startsWith(q))
    || (q.length >= 4 && name.includes(q)));
}

/**
 * The best places for what a person typed: exact names, then names that start with it,
 * then names whose words start with its words in any order, then looser matches. Among
 * equal matches a match on the shown name comes before one on another name, then the
 * category's weight, then, given `near`, the nearer place: "Bravo" has 98 branches, and
 * the one near the other end of the journey is the likelier one. A query that folds to
 * under two letters finds nothing.
 */
export function searchPlaces(
  index: PlaceIndex, query: string,
  { near, limit = PLACE_SEARCH_LIMIT }: { near?: { latitude: number; longitude: number }; limit?: number } = {},
): PlaceMatch[] {
  const q = normalizeSearch(query);
  if (q.length < 2) return [];
  const queryWords = q.split(" ");
  const found: Array<{ entry: Entry; rank: number; which: number; distance: number }> = [];
  for (const entry of index.entries) {
    if (!queryWords.every((w) => entry.haystack.includes(w))) continue;
    let rank = Infinity, which = 0;
    for (let i = 0; i < entry.names.length && rank > 0; i++) {
      const r = rankName(q, queryWords, entry.names[i], entry.words[i]);
      if (r < rank) { rank = r; which = i; }
    }
    if (rank === Infinity) {
      which = entry.names.findIndex((name, i) => rankLoosely(queryWords, name, entry.words[i], entry.labelWords));
      if (which < 0) continue;
      rank = 3;
    }
    const distance = near ? haversine(near.latitude, near.longitude, entry.place.latitude, entry.place.longitude) : 0;
    found.push({ entry, rank, which, distance });
  }
  found.sort((a, b) => a.rank - b.rank || Number(a.which > 0) - Number(b.which > 0)
    || b.entry.weight - a.entry.weight || a.distance - b.distance
    || a.entry.place.name.length - b.entry.place.name.length
    || a.entry.place.name.localeCompare(b.entry.place.name, "az") || a.entry.place.id.localeCompare(b.entry.place.id));
  return found.slice(0, limit).map(({ entry, rank, which }) => ({
    ...entry.place, rank, ...(which > 0 ? { alias: entry.others[which - 1] } : {}),
  }));
}

// Built once per process, on the first search. A failure is not kept: the next search
// tries again, as getGraph() does.
let indexPromise: Promise<PlaceIndex> | null = null;

export function getPlaceIndex(): Promise<PlaceIndex> {
  if (!indexPromise) {
    indexPromise = import("./places.json").then((module) => buildPlaceIndex(module.default)).catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}
