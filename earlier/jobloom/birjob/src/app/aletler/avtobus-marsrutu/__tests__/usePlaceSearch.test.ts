/**
 * usePlaceSearch (#720): what the start and destination pickers ask the place search for,
 * and when. Run with a stand-in React holding one mounted picker: state persists across
 * renders, an effect reruns when its dependencies change and its cleanup runs first (the
 * hook aborts a superseded request there), and a render repeats while an effect sets
 * state. src/test/clientComponent.ts does the same for whole components, without cleanups.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceMatch } from '@/lib/busroute/places';
import type { PlaceSearch } from '../usePlaceSearch';
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
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: unknown) => { if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }];
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
// Answers whether or not the request was aborted: a response can be read before the
// abort lands, and the hook must drop it all the same.
const fetchMock = vi.fn((url: string) => {
  const query = new URL(url, 'https://www.birjob.com').searchParams.get('q')!;
  const answer = answers.get(query) ?? (async () => ({ places: [] }));
  return answer().then((body) => ({ ok: true, json: async () => body }));
});
const asked = () => fetchMock.mock.calls.map(([url]) => url);
// Let the pause pass and the answer arrive.
const settle = async (ms = 250) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: number) => clearTimeout(t) });
  vi.stubGlobal('fetch', fetchMock);
  answers = new Map([['genclik', async () => ({ places: GENCLIK })]]);
  fetchMock.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('usePlaceSearch (#720)', () => {
  it('asks nothing under two letters, and once typing pauses', async () => {
    const render = mountHook();
    expect(render('g')).toEqual({ places: [], pending: false, degraded: false });
    await settle(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(render('Gənclik')).toEqual({ places: [], pending: true, degraded: false });
    await settle(249);
    expect(fetchMock).not.toHaveBeenCalled();
    await settle(1);
    expect(asked()).toEqual(['/api/avtobus/places?q=genclik']);
    expect(render('Gənclik')).toEqual({ places: GENCLIK, pending: false, degraded: false });
  });

  it('keeps each answer for the session, and sends the other end of the journey', async () => {
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
    expect(render('gənclik ma')).toEqual({ places: [GENCLIK[1]], pending: true, degraded: false });
    // Another query entirely shows none of them.
    expect(render('bravo')).toEqual({ places: [], pending: true, degraded: false });
  });

  it('drops an answer for a query that has since changed', async () => {
    let late!: (body: unknown) => void;
    answers.set('nizami', () => new Promise((resolve) => { late = resolve; }));
    const render = mountHook();
    render('nizami');
    await settle();
    expect(render('nizami k')).toEqual({ places: [], pending: true, degraded: false });
    // Kept, it would show as a match carried over until the new answer comes.
    late({ places: [place('w9', 'Nizami Kinoteatrı', 'Teatr və kino')] });
    await settle(0);
    expect(render('nizami k')).toEqual({ places: [], pending: true, degraded: false });
    await settle();
    expect(render('nizami k')).toEqual({ places: [], pending: false, degraded: false });
    // It was right for its own query: going back to that one asks nothing.
    expect(render('nizami').places).toMatchObject([{ id: 'w9' }]);
    expect(asked().filter((url) => url.endsWith('q=nizami'))).toHaveLength(1);
  });

  it('says places are missing when the search fails, and asks again next time', async () => {
    answers.set('bravo', async () => { throw new TypeError('Failed to fetch'); });
    const render = mountHook();
    render('bravo'); await settle();
    expect(render('bravo')).toEqual({ places: [], pending: false, degraded: true });
    answers.set('bravo', async () => ({ places: [], degraded: true }));
    render('bravoo'); await settle(); render('bravoo');
    render('bravo'); await settle();
    expect(asked().filter((url) => url.endsWith('q=bravo'))).toHaveLength(2); // not kept
    expect(render('bravo')).toEqual({ places: [], pending: false, degraded: true });
  });

  it('sends at most the 100 characters the route accepts', async () => {
    const render = mountHook();
    render('a'.repeat(140)); await settle();
    expect(asked()).toEqual([`/api/avtobus/places?q=${'a'.repeat(100)}`]);
  });
});
