import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceMatch } from "@/lib/busroute/places";
import { normalizeSearch } from "./search";

// Wait for a pause in typing before asking: a request per keystroke would be mostly
// thrown away.
const DEBOUNCE_MS = 250;

interface Answer {
  key: string;
  query: string;
  places: PlaceMatch[];
  degraded: boolean;
}

export interface PlaceSearch {
  /** The places for what is typed, or, while those load, the last answer's places that
   *  still match it, so the list does not empty and refill on every keystroke. */
  places: PlaceMatch[];
  pending: boolean;
  /** The search failed or answered degraded: the picker says places are missing. */
  degraded: boolean;
}

/** Whether a place from an earlier answer still matches every word of the query. */
function stillMatches(place: PlaceMatch, words: string[]): boolean {
  const text = normalizeSearch(`${place.name} ${place.alias ?? ""} ${place.label}`);
  return words.every(word => text.includes(word));
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
    if (q.length < 2) return { places: [], pending: false, degraded: false };
    if (answer?.key === key) return { places: answer.places, pending: false, degraded: answer.degraded };
    const words = q.split(" ");
    const carried = answer && !answer.degraded && q.startsWith(answer.query)
      ? answer.places.filter(place => stillMatches(place, words)) : [];
    return { places: carried, pending: true, degraded: false };
  }, [q, key, answer]);
}
