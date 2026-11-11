/**
 * How a place's names match what a person typed, both folded with normalizeSearch (#720).
 * The place search ranks with these on the server (places.ts), and the pickers rank with
 * them the places they carry over from an earlier answer while a newer query is asked
 * (search.ts's placeRank), so that a carried place stands where its own answer puts it.
 */
import { normalizeSearch } from "./searchText";

// Where journeys most often start and end, and few of each: a name whose words start with
// the query's counts as one that starts with it. Strictly by match, "nerimanov" listed
// eight courts, offices and a park whose names start with Nərimanov, and not the station
// Nəriman Nərimanov, whose second word it is. A looser match does not step up: "vağzal"
// inside "Avtovağzal" is no reason to list the bus station above the sea terminal. Nor
// does a match on the district the mappers add after " / ": "8 km" is not a mall's name
// for "Lotos Ticarət Mərkəzi / 8-ci km".
export const HUBS: ReadonlySet<string> = new Set(["metro", "rail", "airport", "bus_station", "mall"]);

/** Every query word starts one of the words. */
export const startsWords = (queryWords: string[], words: string[]) => queryWords.every((q) => words.some((w) => w.startsWith(q)));

/** A name's own words, folded: those before the " / " after which mappers add a district. */
export const ownWords = (name: string) => normalizeSearch(name.split(" / ")[0]).split(" ");

/** How well one folded name matches the folded query: 0 the name itself, 1 its start, 2
 *  each query word the start of one of its words. */
export function rankName(query: string, queryWords: string[], name: string, words: string[]): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return startsWords(queryWords, words) ? 2 : Infinity;
}

/** The looser match: each query word starts a word of the name or of the category, or,
 *  four letters or more, sits anywhere in the name. */
export function matchesLoosely(queryWords: string[], name: string, words: string[], labelWords: string[]): boolean {
  return queryWords.every((q) => words.some((w) => w.startsWith(q)) || labelWords.some((w) => w.startsWith(q))
    || (q.length >= 4 && name.includes(q)));
}

/** How well a name with its spaces taken out matches the query taken so: as the name
 *  itself, its start, or, four letters or more, somewhere in it. */
export function rankCompact(query: string, name: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return query.length >= 4 && name.includes(query) ? 3 : Infinity;
}

/** A match's rank: a hub's 2 counts as 1 when the query's words start the matched name's
 *  own words (HUBS). */
export const stepUp = (matched: number, category: string, queryWords: string[], own: string[]) =>
  matched === 2 && HUBS.has(category) && startsWords(queryWords, own) ? 1 : matched;
