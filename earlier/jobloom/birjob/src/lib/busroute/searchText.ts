/**
 * How the planner's searches compare names: the stop and bus pickers in the browser and
 * the place search on the server (#720). One function, so a name folds the same on both
 * sides and in scripts/bus/build_places_json.py's fold(), which dedupes places with it.
 */

/**
 * Let a phone's Latin keyboard find Azerbaijani names, including dotted İ. AYNA's stop
 * names also type the Cyrillic ә for ə (216 of them, "Kotal qәs."), so it folds the same.
 * Cyrillic stays, for the places' Russian names. An apostrophe joins its word rather than
 * splitting it, so that "papa johns" finds Papa John's; no stop name has one. The code
 * writes its letters as escapes, so that a look-alike cannot hide among them: ə (U+0259)
 * and the Cyrillic ә (U+04D9), the dotless ı (U+0131), the marks NFD takes off a letter
 * (U+0300 to U+036F), the apostrophes ´ ʼ ‘ ’ (U+00B4, U+02BC, U+2018, U+2019) and the
 * Cyrillic а to я (U+0430 to U+044F).
 */
export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("az")
    .replace(/[\u0259\u04d9]/g, "e").replace(/\u0131/g, "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['`\u00b4\u02bc\u2018\u2019]/g, "")
    .replace(/[^a-z0-9\u0430-\u044f]+/g, " ").trim();
}
