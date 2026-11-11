import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceMatch } from "@/lib/busroute/places";
import { normalizeSearch, placeRank } from "./search";

// While a person types, at most one request every THROTTLE_MS, the first at once. Asked
// only once typing paused, the places for the query typed last came after its stops were
// listed, and went below them however well they matched; the answers that come while
// typing stand in for the queries typed after them, ranked for each (placeRank), until
// that query's own answer comes.
const THROTTLE_MS = 250;
// How long a list waits for places when nothing stands in for them, at most, from the
// keystroke that began the wait: one request's wait and then 300 ms for its answer. The
// wait is once per burst of typing, until the places for what is typed come, not once per
// keystroke: restarted at each one, it kept the list empty while anyone typed fast.
export const HOLD_MS = THROTTLE_MS + 300;

interface Answer {
  query: string;
  places: PlaceMatch[];
}

export interface PlaceSearch {
  /** The places for what is typed, or, while those load, an earlier answer's places that
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
 * GET /api/avtobus/places. Each answer is kept while the picker is on the page, by its
 * query and `near`, so going back to a query asks nothing, and only the answer for what
 * is typed is ever shown as its own: one that comes after its query changed only stands
 * in for a later one. `near` is the journey's other end: the nearer of equally good
 * places first.
 */
export function usePlaceSearch(query: string, near: { latitude: number; longitude: number } | null): PlaceSearch {
  const q = normalizeSearch(query);
  // To about 100 m, so a few metres do not ask again.
  const nearParam = near ? `${near.latitude.toFixed(3)},${near.longitude.toFixed(3)}` : "";
  const key = `${q}|${nearParam}`;
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(() => new Map());
  // The query whose search failed, while it is the one typed.
  const [failed, setFailed] = useState<string | null>(null);
  // Whether the list has stopped waiting for places, this burst of typing.
  const [released, setReleased] = useState(false);
  // Queries asked for and not failed: answered, or on their way.
  const asked = useRef(new Set<string>());
  const sentAt = useRef(-Infinity);
  const typed = useRef(key);
  // Aborted when the picker goes, with any request still on its way.
  const gone = useRef<AbortSignal | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    gone.current = controller.signal;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    typed.current = key;
    if (q.length < 2) return;
    // Typed again after its search failed: asked again, and pending meanwhile.
    setFailed((current) => (current === key ? null : current));
    if (asked.current.has(key)) return;
    const timer = window.setTimeout(async () => {
      asked.current.add(key);
      sentAt.current = Date.now();
      const signal = gone.current;
      try {
        // The folded query, as the server folds it anyway; the route refuses over 100 characters.
        const params = new URLSearchParams({ q: q.slice(0, 100) });
        if (nearParam) params.set("near", nearParam);
        const response = await fetch(`/api/avtobus/places?${params}`, { signal: signal ?? undefined });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.places) || data.degraded === true) throw new Error("places");
        setAnswers((previous) => new Map(previous).set(key, { query: q, places: data.places as PlaceMatch[] }));
      } catch {
        asked.current.delete(key);
        if (!signal?.aborted && typed.current === key) setFailed(key);
      }
    }, Math.max(0, sentAt.current + THROTTLE_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [key, q, nearParam]);

  const waiting = q.length >= 2 && !answers.has(key) && failed !== key;
  useEffect(() => {
    if (!waiting) return;
    const hold = window.setTimeout(() => setReleased(true), HOLD_MS);
    return () => { window.clearTimeout(hold); setReleased(false); };
  }, [waiting]);

  // What stands in while this query's own answer is on its way: the answer for the longest
  // query this one starts with, else for the shortest one that starts with this one, as
  // when a letter is taken back.
  const standIn = useMemo(() => {
    let shorter: Answer | null = null, longer: Answer | null = null;
    for (const answer of answers.values()) {
      if (q.startsWith(answer.query)) {
        if (!shorter || answer.query.length >= shorter.query.length) shorter = answer;
      } else if (answer.query.startsWith(q) && (!longer || answer.query.length <= longer.query.length)) longer = answer;
    }
    return shorter ?? longer;
  }, [answers, q]);

  return useMemo((): PlaceSearch => {
    if (q.length < 2) return { places: [], pending: false, degraded: false, holding: false };
    const answer = answers.get(key);
    if (answer) return { places: answer.places, pending: false, degraded: false, holding: false };
    if (failed === key) return { places: [], pending: false, degraded: true, holding: false };
    // Ranked for this query as the stops are: carried over with their old ranks, the
    // station Gənclik stayed a mere start of "gən" when "gənclik" was its whole name.
    const carried = (standIn?.places ?? []).map(place => ({ ...place, rank: placeRank(q, place) })).filter(place => place.rank < Infinity);
    return { places: carried, pending: true, degraded: false, holding: carried.length === 0 && !released };
  }, [q, key, answers, failed, standIn, released]);
}
