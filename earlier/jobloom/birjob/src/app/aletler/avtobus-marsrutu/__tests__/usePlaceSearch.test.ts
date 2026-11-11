/**
 * usePlaceSearch (#720): what the start and destination pickers ask the place search for,
 * and when, and what the list shows meanwhile. Run with a stand-in React holding one
 * mounted picker: state persists across renders, an effect reruns when its dependencies
 * change and its cleanup runs first (the hook drops a request not yet sent there), and a
 * render repeats while an effect sets state. src/test/clientComponent.ts does the same for
 * whole components, without cleanups.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceMatch } from '@/lib/busroute/places';
import { HOLD_MS, type PlaceSearch } from '../usePlaceSearch';
import * as search from '../search';

const FILE = fileURLToPath(new URL('../usePlaceSearch.ts', import.meta.url));
type Near = { latitude: number; longitude: number } | null;

function mountHook() {
  const { outputText } = ts.transpileModule(readFileSync(FILE, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const slots: unknown[] = [];
  const cleanups = new Map<number, () => void>();
  let cursor = 0, dirty = false, effects: Array<() => void> = [];
  const same = (a: unknown[] | undefined, b: unknown[]) => !!a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [slots[i], (next: unknown) => {
        const value = typeof next === 'function' ? (next as (current: unknown) => unknown)(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(make: () => unknown, deps: unknown[]) {
      const i = cursor++;
      const memo = slots[i] as { deps: unknown[]; value: unknown } | undefined;
      if (memo && same(memo.deps, deps)) return memo.value;
      slots[i] = { deps, value: make() };
      return (slots[i] as { value: unknown }).value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const i = cursor++;
      if (same(slots[i] as unknown[] | undefined, deps)) return;
      slots[i] = deps;
      effects.push(() => {
        cleanups.get(i)?.();
        const cleanup = effect();
        if (cleanup) cleanups.set(i, cleanup); else cleanups.delete(i);
      });
    },
  };
  const load = (name: string) => {
    if (name === 'react') return react;
    if (name === './search') return search;
    throw new Error(`usePlaceSearch imports ${name}`);
  };
  const loaded = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', outputText)(load, loaded, loaded.exports);
  // Called as a render would call it, which is not a component: hence not use…, which
  // the hooks lint would hold to a component's rules.
  const renderHook = loaded.exports.usePlaceSearch as (query: string, near: Near) => PlaceSearch;
  return (query: string, near: Near = null): PlaceSearch => {
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0;
      effects = [];
      const result = renderHook(query, near);
      dirty = false;
      for (const effect of effects) effect();
      if (!dirty) return result;
    }
    throw new Error('the render did not settle');
  };
}

const place = (id: string, name: string, label = 'Ticarət mərkəzi'): PlaceMatch =>
  ({ id, name, category: 'mall', label, latitude: 40.4, longitude: 49.85, rank: 1 });
const GENCLIK = [place('n1', 'Gənclik', 'Metro stansiyası'), place('w2', 'Gənclik Mall')];

let answers: Map<string, () => Promise<unknown>>;
// Answers every request it is sent, at once unless a test holds the answer back.
const fetchMock = vi.fn((url: string) => {
  const query = new URL(url, 'https://www.birjob.com').searchParams.get('q')!;
  const answer = answers.get(query) ?? (async () => ({ places: [] }));
  return answer().then((body) => ({ ok: true, json: async () => body }));
});
const asked = () => fetchMock.mock.calls.map(([url]) => url);
const queries = () => asked().map((url) => new URL(url, 'https://www.birjob.com').searchParams.get('q'));
// Let time pass and the answers due arrive.
const settle = async (ms = 250) => { await vi.advanceTimersByTimeAsync(ms); };
const never = () => new Promise(() => {});
// Types `text` from its second letter on, a key every `ms`, and what the list had at each.
async function typeOut(render: (query: string) => PlaceSearch, text: string, ms = 120) {
  const seen: PlaceSearch[] = [];
  for (let n = 2; n <= text.length; n++) {
    seen.push(render(text.slice(0, n)));
    await settle(ms);
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: number) => clearTimeout(t) });
  vi.stubGlobal('fetch', fetchMock);
  answers = new Map([['genclik', async () => ({ places: GENCLIK })]]);
  fetchMock.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('usePlaceSearch (#720)', () => {
  it('asks nothing under two letters, and at once from two', async () => {
    const render = mountHook();
    expect(render('g')).toEqual({ places: [], pending: false, degraded: false, holding: false });
    await settle(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(render('Gənclik')).toEqual({ places: [], pending: true, degraded: false, holding: true });
    await settle(0);
    expect(asked()).toEqual(['/api/avtobus/places?q=genclik']);
    expect(render('Gənclik')).toEqual({ places: GENCLIK, pending: false, degraded: false, holding: false });
  });

  it('asks at most once every 250 ms while typing, for what is typed then, and last for what was typed last', async () => {
    const render = mountHook();
    // "gənclik mall" a key every 120 ms: eleven queries, and the space adds none.
    await typeOut(render, 'gənclik mall');
    await settle(1000);
    expect(queries()).toEqual(['ge', 'genc', 'gencli', 'genclik', 'genclik ma', 'genclik mall']);
  });

  it('keeps each answer while the picker is on the page, and sends the other end of the journey', async () => {
    const render = mountHook();
    render('gənclik'); await settle(); render('gənclik');
    render('28'); await settle(); render('28');
    expect(render('gənclik').places).toBe(GENCLIK); // from memory, at once
    await settle(1000);
    expect(asked()).toEqual(['/api/avtobus/places?q=genclik', '/api/avtobus/places?q=28']);
    render('gənclik', { latitude: 40.40012, longitude: 49.85278 });
    await settle();
    expect(asked().at(-1)).toBe('/api/avtobus/places?q=genclik&near=40.400%2C49.853');
  });

  it('shows the last places that still match while a longer query is asked', async () => {
    const render = mountHook();
    render('gənclik'); await settle(); render('gənclik');
    // "Gənclik" (the metro) has no word starting "ma"; the mall stays until its answer comes.
    expect(render('gənclik ma')).toEqual({ places: [GENCLIK[1]], pending: true, degraded: false, holding: false });
    // Another query entirely shows none of them, and its list waits for its own.
    expect(render('bravo')).toEqual({ places: [], pending: true, degraded: false, holding: true });
  });

  it('ranks the places it carries over for the longer query, as the search would', async () => {
    answers.set('gen', async () => ({ places: GENCLIK }));
    const render = mountHook();
    render('gən'); await settle(); render('gən');
    // Both started "gən"; "gənclik" is the station's whole name and the start of the mall's.
    expect(render('gənclik').places.map((p) => [p.id, p.rank])).toEqual([['n1', 0], ['w2', 1]]);
    // A query typed without its space still carries 28 Mall.
    answers.set('28', async () => ({ places: [place('w5', '28 Mall')] }));
    render('28'); await settle(); render('28');
    expect(render('28ma').places.map((p) => [p.id, p.rank])).toEqual([['w5', 1]]);
  });

  it('lists the places that came while typing for the query typed after them, ranked for it', async () => {
    for (const query of ['genc', 'gencli']) answers.set(query, async () => ({ places: GENCLIK }));
    answers.set('genclik', never);
    const render = mountHook();
    const seen = await typeOut(render, 'gənclik');
    // "gənc"'s answer came 250 ms in, before "gəncl" was typed: no keystroke after it waits.
    expect(seen.map((s) => s.holding)).toEqual([true, true, true, false, false, false]);
    expect(render('gənclik')).toEqual({
      places: [{ ...GENCLIK[0], rank: 0 }, { ...GENCLIK[1], rank: 1 }], pending: true, degraded: false, holding: false,
    });
  });

  it('carries the places of a longer query back to a shorter one, as a letter is taken back', async () => {
    answers.set('genclik ma', async () => ({ places: [GENCLIK[1]] }));
    answers.set('genclik m', never);
    const render = mountHook();
    render('gənclik ma'); await settle(); render('gənclik ma');
    expect(render('gənclik m')).toEqual({ places: [GENCLIK[1]], pending: true, degraded: false, holding: false });
    // Typed back further, past what it still matches, it has nothing to stand in.
    answers.set('ge', never);
    expect(render('gə').places).toEqual([GENCLIK[1]].map((p) => ({ ...p, rank: 1 })));
  });

  it("holds a new query's list for its places, at most until HOLD_MS after the keystroke", async () => {
    answers.set('koroglu', never);
    const render = mountHook();
    expect(render('koroğlu').holding).toBe(true);
    await settle(HOLD_MS - 1);
    expect(render('koroğlu').holding).toBe(true);
    await settle(1);
    expect(render('koroğlu')).toEqual({ places: [], pending: true, degraded: false, holding: false });
  });

  it('holds the list once a burst of typing, from its first keystroke, not again at each', async () => {
    for (const query of ['ko', 'kor', 'koro', 'korog', 'korogl', 'koroglu']) answers.set(query, never);
    const render = mountHook();
    // A key every 120 ms: held from "ko", at 0 ms, until HOLD_MS (550 ms) after it, and no
    // longer, though no place has come; restarted at each key it held until typing stopped.
    const seen = await typeOut(render, 'koroğlu');
    expect(seen.map((s) => s.holding)).toEqual([true, true, true, true, true, false]);
    expect(render('koroğlu').holding).toBe(false);
    // Once the places for what is typed come, the next keystroke may wait again.
    answers.set('bravo', async () => ({ places: [] }));
    answers.set('bravo k', never);
    render('bravo'); await settle(); render('bravo');
    expect(render('bravo k').holding).toBe(true);
    await settle(HOLD_MS);
    expect(render('bravo k').holding).toBe(false);
  });

  it("never shows an answer that comes after its query changed as the newer query's own", async () => {
    let late!: (body: unknown) => void;
    answers.set('nizami', () => new Promise((resolve) => { late = resolve; }));
    answers.set('nizami t', never);
    const render = mountHook();
    render('nizami');
    await settle();
    render('nizami k');
    await settle();
    expect(render('nizami k')).toEqual({ places: [], pending: false, degraded: false, holding: false });
    late({ places: [place('w9', 'Nizami Kinoteatrı', 'Teatr və kino')] });
    await settle(0);
    // "nizami k" keeps its own answer.
    expect(render('nizami k')).toEqual({ places: [], pending: false, degraded: false, holding: false });
    // A query still waiting for its own has the late answer stand in, ranked for it: "t"
    // starts a word of its kind, Teatr və kino, a looser match.
    expect(render('nizami t')).toMatchObject({ places: [{ id: 'w9', rank: 3 }], pending: true, holding: false });
    // It was right for its own query: going back to that one asks nothing.
    expect(render('nizami').places).toMatchObject([{ id: 'w9' }]);
    expect(asked().filter((url) => url.endsWith('q=nizami'))).toHaveLength(1);
  });

  it('says places are missing when the search fails, and asks again next time', async () => {
    answers.set('bravo', async () => { throw new TypeError('Failed to fetch'); });
    const render = mountHook();
    render('bravo'); await settle();
    expect(render('bravo')).toEqual({ places: [], pending: false, degraded: true, holding: false });
    answers.set('bravo', async () => ({ places: [], degraded: true }));
    render('bravoo'); await settle(); render('bravoo');
    // Typed again, it is asked again, and is pending meanwhile.
    expect(render('bravo')).toMatchObject({ pending: true, degraded: false });
    await settle();
    expect(asked().filter((url) => url.endsWith('q=bravo'))).toHaveLength(2); // not kept
    expect(render('bravo')).toEqual({ places: [], pending: false, degraded: true, holding: false });
  });

  it('sends at most the 100 characters the route accepts', async () => {
    const render = mountHook();
    render('a'.repeat(140)); await settle();
    expect(asked()).toEqual([`/api/avtobus/places?q=${'a'.repeat(100)}`]);
  });
});
