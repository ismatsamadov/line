import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceMatch } from "@/lib/busroute/places";
import { normalizeSearch, placeRank } from "./search";

// Wait for a pause in typing before asking: a request per keystroke would be mostly
// thrown away.
const DEBOUNCE_MS = 250;
// How long a new query's list waits for its places, from the keystroke, when no earlier
// answer has any for it: the pause above and then 300 ms for the answer.
export const HOLD_MS = DEBOUNCE_MS + 300;

interface Answer {
  key: string;
  query: string;
  places: PlaceMatch[];
  degraded: boolean;
}

export interface PlaceSearch {
  /** The places for what is typed, or, while those load, the last answer's places that
   *  still match it, ranked for it, so the list does not empty and refill on every
   *  keystroke. */
  places: PlaceMatch[];
  pending: boolean;
  /** The search failed or answered degraded: the picker says places are missing. */
  degraded: boolean;
  /** The places for what is typed are on their way and nothing earlier stands in for
   *  them: the list waits for them, up to HOLD_MS, so that they are ranked into it rather
   *  than added under the rows it showed first (#720). */
  holding: boolean;
}

/**
 * Named places for what is typed in a start or destination picker (#720), from
 * GET /api/avtobus/places. Asked once typing pauses; each answer is kept for the
 * session, so going back to a query asks nothing; an answer for an older query is
 * dropped. `near` is the journey's other end: the nearer of equally good places first.
 */
export function usePlaceSearch(query: string, near: { latitude: number; longitude: number } | null): PlaceSearch {
  const q = normalizeSearch(query);
  // To about 100 m, so a few metres do not ask again.
  const nearParam = near ? `${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : "";
  const key = `${q}|${nearParam}`;
  const cache = useRef<Map<string, Answer>>(new Map());
  const [answer, setAnswer] = useState<Answer | null>(null);
  // The query whose list stopped waiting for its places.
  const [released, setReleased] = useState<string | null>(null);

  useEffect(() => {
    if (q.length < 2) return;
    const hold = window.setTimeout(() => setReleased(key), HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [key, q]);

  useEffect(() => {
    if (q.length < 2) return;
    const cached = cache.current.get(key);
    if (cached) { setAnswer(cached); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        // The folded query, as the server folds it anyway; the route refuses over 100 characters.
        const params = new URLSearchParams({ q: q.slice(0, 100) });
        if (nearParam) params.set("near", nearParam);
        const response = await fetch(`/api/avtobus/places?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.places)) throw new Error("places");
        const next = { key, query: q, places: data.places as PlaceMatch[], degraded: data.degraded === true };
        if (!next.degraded) cache.current.set(key, next);
        // Read before the abort landed: right for its query, but that is no longer the one
        // typed, and set now it could replace the newer query's answer.
        if (!controller.signal.aborted) setAnswer(next);
      } catch {
        if (!controller.signal.aborted) setAnswer({ key, query: q, places: [], degraded: true });
      }
    }, DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, q, nearParam]);

  return useMemo((): PlaceSearch => {
    if (q.length < 2) return { places: [], pending: false, degraded: false, holding: false };
    if (answer?.key === key) return { places: answer.places, pending: false, degraded: answer.degraded, holding: false };
    // An earlier answer's places that still match, ranked for this query as the stops
    // are: carried over with their old ranks, the station Gənclik stayed a mere start of
    // "gən" when "gənclik" was its whole name.
    const carried = answer && !answer.degraded && q.startsWith(answer.query)
      ? answer.places.map(place => ({ ...place, rank: placeRank(q, place) })).filter(place => place.rank < Infinity) : [];
    return { places: carried, pending: true, degraded: false, holding: carried.length === 0 && released !== key };
  }, [q, key, answer, released]);
}
