/**
 * How the planner's searches compare names: the stop and bus pickers in the browser and
 * the place search on the server (#720). One function, so a name folds the same on both
 * sides and in scripts/bus/build_places_json.py's fold(), which dedupes places with it.
 */

/**
 * Let a phone's Latin keyboard find Azerbaijani names, including dotted İ. AYNA's stop
 * names also type the Cyrillic ә for ə (216 of them, "Kotal qәs."), so it folds the same.
 * Cyrillic stays, for the places' Russian names.
 */
export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("az")
    .replace(/[əә]/g, "e").replace(/ı/g, "i")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9а-я]+/g, " ").trim();
}
