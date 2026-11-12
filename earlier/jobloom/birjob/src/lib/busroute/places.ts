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
import { matchesLoosely, ownWords, rankCompact, rankName, stepUp } from "./placeMatch";

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
   *  a word found inside it, or the category's name ("gənclik metro"). A station's, an
   *  airport's or a mall's 2 counts as 1 (placeMatch.ts's HUBS). */
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
  /** Every name folded with its spaces taken out, for a query typed without them. */
  compact: string[];
  /** Every name's words before the mappers' " / " and the place after it. */
  ownWords: string[][];
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
      compact: names.map((n) => n.replaceAll(" ", "")),
      ownWords: [name, ...others].map(ownWords),
      weight: (WEIGHT[category] ?? 0) + (notable ? NOTABLE : 0),
    };
  });
  return { entries };
}

/**
 * The best places for what a person typed: exact names, then names that start with it,
 * then names whose words start with its words in any order, then looser matches, a
 * station, an airport or a mall whose words start with them counting as starting with it
 * (placeMatch.ts). A query that matches nothing is tried again without its spaces against names
 * without theirs, so that "28mall" and "parkbulvar" find 28 Mall and Park Bulvar. Among
 * equal matches a match on the shown name comes before one on another name, then the
 * category's weight, then the better match before that step, then, given `near`, the
 * nearer place: 91 supermarkets are named "Bravo", and the one near the other end of the
 * journey is the likelier one. A query that folds to under two letters finds nothing.
 */
export function searchPlaces(
  index: PlaceIndex, query: string,
  { near, limit = PLACE_SEARCH_LIMIT }: { near?: { latitude: number; longitude: number }; limit?: number } = {},
): PlaceMatch[] {
  const q = normalizeSearch(query);
  if (q.length < 2) return [];
  const queryWords = q.split(" ");
  const found: Array<{ entry: Entry; rank: number; matched: number; which: number; distance: number }> = [];
  const add = (entry: Entry, matched: number, which: number) => {
    const rank = stepUp(matched, entry.place.category, queryWords, entry.ownWords[which]);
    const distance = near ? haversine(near.latitude, near.longitude, entry.place.latitude, entry.place.longitude) : 0;
    found.push({ entry, rank, matched, which, distance });
  };
  for (const entry of index.entries) {
    if (!queryWords.every((w) => entry.haystack.includes(w))) continue;
    let rank = Infinity, which = 0;
    for (let i = 0; i < entry.names.length && rank > 0; i++) {
      const r = rankName(q, queryWords, entry.names[i], entry.words[i]);
      if (r < rank) { rank = r; which = i; }
    }
    if (rank === Infinity) {
      which = entry.names.findIndex((name, i) => matchesLoosely(queryWords, name, entry.words[i], entry.labelWords));
      if (which < 0) continue;
      rank = 3;
    }
    add(entry, rank, which);
  }
  if (found.length === 0) {
    const compact = q.replaceAll(" ", "");
    for (const entry of index.entries) {
      let rank = Infinity, which = 0;
      for (let i = 0; i < entry.compact.length && rank > 0; i++) {
        const r = rankCompact(compact, entry.compact[i]);
        if (r < rank) { rank = r; which = i; }
      }
      if (rank < Infinity) add(entry, rank, which);
    }
  }
  found.sort((a, b) => a.rank - b.rank || Number(a.which > 0) - Number(b.which > 0)
    || b.entry.weight - a.entry.weight || a.matched - b.matched || a.distance - b.distance
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
