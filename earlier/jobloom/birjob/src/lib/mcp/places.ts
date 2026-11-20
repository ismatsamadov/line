/**
 * The place an assistant names, as the board's city filter (#797).
 *
 * The board filters by a slug from src/lib/cities.ts (?city=baki), matched the way the
 * city landings match (buildCityCondition). An assistant writes what its user wrote:
 * "Bakı", "Baku", "Baki", "Баку", "Sumgait". Each is read here into that slug, or into
 * an answer the assistant can act on, never into a silently ignored filter: an unknown
 * place would list the whole board under the user's city.
 */
import { CITIES } from '@/lib/cities';
import { normalizeSearchQuery } from '@/lib/sqlNormalize';
import type { ForeignCountry } from '@/lib/boardCountries';

/** English and Russian names of the places people ask for most, normalised the way
 *  normalizeSearchQuery reads a query. The Azerbaijani names and the slugs need no entry:
 *  every city's slug, label and search terms are read below. Every value is a CITIES
 *  slug (places.test.ts). */
export const EXONYMS: Readonly<Record<string, string>> = {
  baku: 'baki', баку: 'baki',
  ganja: 'gence', ganca: 'gence', гянджа: 'gence',
  sumgait: 'sumqayit', sumgayit: 'sumqayit', сумгаит: 'sumqayit', сумгайыт: 'sumqayit',
  lankaran: 'lenkeran', lenkoran: 'lenkeran', ленкорань: 'lenkeran',
  mingachevir: 'mingechevir', mingechaur: 'mingechevir', мингечевир: 'mingechevir',
  nakhchivan: 'naxchivan', nakhichevan: 'naxchivan', нахчыван: 'naxchivan', нахичевань: 'naxchivan',
  shaki: 'sheki', шеки: 'sheki',
  khankendi: 'xankendi', ханкенди: 'xankendi',
  yevlakh: 'yevlax', евлах: 'yevlax',
  karabakh: 'qarabag', karabagh: 'qarabag', карабах: 'qarabag',
  khirdalan: 'absheron', апшерон: 'absheron',
  guba: 'quba', куба: 'quba',
  gabala: 'qebele', qabala: 'qebele', габала: 'qebele',
  shamakhi: 'shamaxi', шемаха: 'shamaxi',
  zagatala: 'zaqatala', закатала: 'zaqatala',
  khachmaz: 'xachmaz', хачмаз: 'xachmaz',
  shamkir: 'shemkir', шамкир: 'shemkir',
  шуша: 'shusha',
  ширван: 'shirvan',
  нафталан: 'naftalan',
};

/** Every key below is compared normalised, as the input is: normalizeSearchQuery strips
 *  marks, so the Russian й reads as и and "район" as "раион". */
const normalisedSet = (words: string[]) => new Set(words.map(normalizeSearchQuery));

/** Names that mean the whole of Azerbaijan, which is the board's default: no city. */
const WHOLE_COUNTRY = normalisedSet(['azerbaijan', 'azərbaycan', 'azarbaijan', 'азербайджан']);

/** The board's other markets' cities, which the city filter (Azerbaijan's) cannot take:
 *  the country filter lists their jobs. */
const FOREIGN_CITIES: ReadonlyMap<string, ForeignCountry> = new Map(Object.entries({
  tashkent: 'UZ', toshkent: 'UZ', ташкент: 'UZ', samarkand: 'UZ', samarqand: 'UZ',
  almaty: 'KZ', astana: 'KZ', алматы: 'KZ', астана: 'KZ',
  istanbul: 'TR', ankara: 'TR', izmir: 'TR', стамбул: 'TR',
  tbilisi: 'GE', batumi: 'GE', тбилиси: 'GE',
  bishkek: 'KG', бишкек: 'KG',
} as Record<string, ForeignCountry>).map(([name, country]) => [normalizeSearchQuery(name), country]));

/** Words around a place's name that are not the name: "Bakı şəhəri", "Quba rayonu",
 *  "Baku city". */
const PLACE_WORDS = normalisedSet(['city', 'town', 'district', 'region', 'şəhər', 'şəhəri', 'rayon', 'rayonu', 'qəsəbəsi', 'gorod', 'город', 'район']);

const SLUG_BY_NAME: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  const put = (name: string, slug: string) => {
    const key = normalizeSearchQuery(name);
    if (key && !map.has(key)) map.set(key, slug);
  };
  // Slugs and labels first, then a city's own search terms (Xırdalan is Abşeron's), so a
  // term two places share (Gəncə is a city and a member of Gəncə-Qazax) keeps the city.
  for (const c of CITIES) { put(c.slug, c.slug); put(c.label, c.slug); }
  for (const c of CITIES) if (c.group !== 'region') for (const t of c.searchTerms) put(t, c.slug);
  for (const [name, slug] of Object.entries(EXONYMS)) put(name, slug);
  return map;
})();

export type PlaceReading =
  | { kind: 'city'; slug: string; label: string }
  | { kind: 'country-wide' }
  | { kind: 'foreign'; country: ForeignCountry }
  | { kind: 'unknown' };

/** What a place the assistant passed means to the board. */
export function readPlace(raw: string): PlaceReading {
  const words = raw.split(/[\s,.;/]+/).filter((w) => w && !PLACE_WORDS.has(normalizeSearchQuery(w)));
  // "Baku, Azerbaijan": the country beside a place is the place's, not a second filter.
  const named = words.length > 1 ? words.filter((w) => !WHOLE_COUNTRY.has(normalizeSearchQuery(w))) : words;
  const key = normalizeSearchQuery(named.join(' '));
  if (!key) return { kind: 'unknown' };
  if (WHOLE_COUNTRY.has(key)) return { kind: 'country-wide' };
  const slug = SLUG_BY_NAME.get(key);
  const city = slug ? CITIES.find((c) => c.slug === slug) : undefined;
  if (city) return { kind: 'city', slug: city.slug, label: city.label };
  const foreign = FOREIGN_CITIES.get(key);
  if (foreign) return { kind: 'foreign', country: foreign };
  return { kind: 'unknown' };
}

/** A few places for an error message, in the dropdown's order. */
export function examplePlaces(): string {
  return CITIES.filter((c) => c.group === 'republic').slice(0, 6).map((c) => `${c.label} (${c.slug})`).join(', ');
}
