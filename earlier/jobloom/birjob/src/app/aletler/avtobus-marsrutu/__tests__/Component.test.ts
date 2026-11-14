/**
 * The planner's own state (#720): what it asks /api/avtobus/find for once two ends are
 * chosen, where a map tap goes, what the place search is told of the person's location,
 * and how the location is asked for. The pickers and the map are stand-ins whose props
 * the tests call, as a tap or a choice in the browser would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { mountComponent, defaultExport, type FoundElement } from '@/test/clientComponent';
import type { PlaceSearch } from '../usePlaceSearch';
import * as access from '@/lib/busroute/access';
import * as geo from '@/lib/busroute/geo';
import * as placeMatch from '@/lib/busroute/placeMatch';
import type { PlaceMatch } from '@/lib/busroute/places';
import type { BusLineDetail, BusLite, StopDetail } from '@/lib/busroute/types';
import * as search from '../search';
import * as journeyFormatting from '../journeyFormatting';
import * as mapMarks from '../mapMarks';

const FILE = fileURLToPath(new URL('../Component.tsx', import.meta.url));
const Stub = () => null;
const BusMap = () => null;
const JourneyView = () => null;
const JourneyChoice = () => null;
const icons = new Proxy({}, { get: () => Stub });

const stop = (id: number, name: string, latitude: number, longitude: number): StopDetail =>
  ({ id, code: String(id), name, latitude, longitude, is_transport_hub: false });
const STOPS = [stop(1, 'Gənclik m/st', 40.4, 49.85), stop(2, 'Sahil m/st', 40.37, 49.84)];
const mall: PlaceMatch = { id: 'w674677959', name: 'Gənclik Mall', category: 'mall', label: 'Ticarət mərkəzi', latitude: 40.39989, longitude: 49.85283, rank: 0 };
const library: PlaceMatch = { id: 'n1', name: 'Kitabxana', category: 'culture', label: 'Mədəniyyət mərkəzi', latitude: 40.3753, longitude: 49.8331, rank: 0 };

let bodies: unknown[];
let position: { latitude: number; longitude: number; accuracy: number };
// What each request for the location asked the browser for.
let asked: PositionOptions[];
let placeSearch: PlaceSearch;

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const Picker = () => null;
const imports = {
  'next/dynamic': defaultExport(() => BusMap),
  'lucide-react': icons,
  '@/components/SupportCTA': defaultExport(Stub),
  '@/lib/busroute/access': access,
  '@/lib/busroute/geo': geo,
  '@/lib/busroute/placeMatch': placeMatch,
  './JourneyView': defaultExport(JourneyView),
  './JourneyChoice': defaultExport(JourneyChoice),
  './Picker': defaultExport(Picker),
  './search': search,
  './usePlaceSearch': { usePlaceSearch: () => placeSearch },
  './journeyFormatting': journeyFormatting,
  './mapMarks': mapMarks,
};

function planner() {
  const view = mountComponent<Record<string, never>>(FILE, imports);
  const render = async () => { view.render({}); await flush(); view.render({}); };
  const end = (label: string) => view.find(el => el.props.label === label)[0].props;
  const map = () => view.find(el => el.type === BusMap)[0].props;
  const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
    : typeof node === 'string' ? node : (node as FoundElement | null)?.props ? text((node as FoundElement).props.children) : '';
  const button = (label: string) => view.find(el => el.type === 'button' && text(el.props.children).includes(label))[0].props;
  const alert = () => view.find(el => el.props.role === 'alert').map(el => text(el.props.children)).join(' ');
  return { view, render, end, map, button, alert };
}

beforeEach(() => {
  bodies = [];
  asked = [];
  position = { latitude: 40.377134, longitude: 49.854137, accuracy: 25 };
  placeSearch = { places: [], pending: false, degraded: false, holding: false };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: (p: unknown) => void, _fail: unknown, options: PositionOptions) => {
    asked.push(options);
    ok({ coords: position });
  } } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    if (url === '/api/avtobus/stops') return { ok: true, json: async () => ({ stops: STOPS }) };
    bodies.push(JSON.parse(init!.body!));
    return { ok: true, json: async () => ({ route: { segments: [], totalDistance: 0, totalTime: 0, totalTransfers: 0, totalStops: 0 }, bikeParking: null }) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('the planner (#720)', () => {
  it('asks for a journey from a chosen place as a point, and to a chosen stop by its id', async () => {
    const p = planner();
    await p.render();
    p.end('Haradan').onSelectPlace(mall);
    await p.render();
    p.end('Hara').onSelectStop(STOPS[1]);
    await p.render();
    expect(bodies.at(-1)).toEqual({ from: { latitude: 40.39989, longitude: 49.85283, name: 'Gənclik Mall' }, toStopId: 2 });
    p.end('Hara').onSelectPlace(library);
    await p.render();
    expect(bodies.at(-1)).toEqual({ from: { latitude: 40.39989, longitude: 49.85283, name: 'Gənclik Mall' }, to: { latitude: 40.3753, longitude: 49.8331, name: 'Kitabxana' } });
  });

  it('keeps map taps on the start once a destination place is chosen', async () => {
    const p = planner();
    await p.render();
    p.end('Hara').onSelectPlace(library);
    await p.render();
    p.map().onStopClick(STOPS[0]);
    await p.render();
    // The second tap changes the start again; the destination stays the place.
    p.map().onStopClick(STOPS[1]);
    await p.render();
    expect(bodies.at(-1)).toEqual({ fromStopId: 2, to: { latitude: 40.3753, longitude: 49.8331, name: 'Kitabxana' } });
  });

  it('tells the place search where the person is only to about 1 km', async () => {
    const p = planner();
    await p.render();
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(p.end('Haradan').place).toMatchObject({ name: 'Sizin yeriniz', latitude: 40.377134, longitude: 49.854137 });
    // The destination picker ranks its places by the start, sent in the search's address.
    expect(p.end('Hara').near).toEqual({ latitude: 40.38, longitude: 49.85 });
    // A journey from the location is asked for from its own point, in the request's body.
    p.end('Hara').onSelectPlace(library);
    await p.render();
    expect(bodies.at(-1)).toMatchObject({ from: { latitude: 40.377134, longitude: 49.854137, name: 'Sizin yeriniz' } });
  });

  it('does not start from a location less sure than the walk to a first stop', async () => {
    position = { ...position, accuracy: 1500 };
    const p = planner();
    await p.render();
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(p.end('Haradan').place).toBeNull();
    expect(p.alert()).toContain('±1.5 km dəqiqliklə');
    // Sure to 1 km exactly, as far as a place's walk to its first stop, it is used.
    position = { ...position, accuracy: 1000.5 };
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(p.end('Haradan').place).toBeNull();
    position = { ...position, accuracy: 1000 };
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(p.end('Haradan').place).toMatchObject({ name: 'Sizin yeriniz', label: 'Məkan dəqiqliyi ±1000 m' });
  });

  it('asks for a fresh fix from the GPS once a rough one was refused, and quickly again after', async () => {
    position = { ...position, accuracy: 1500 };
    const p = planner();
    await p.render();
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(asked).toEqual([{ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }]);
    // Asked the same way, the browser hands the same rough fix back for a minute.
    position = { ...position, accuracy: 30 };
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(asked[1]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    expect(p.end('Haradan').place).toMatchObject({ name: 'Sizin yeriniz' });
    p.button('Olduğum yerdən başla').onClick();
    await p.render();
    expect(asked[2]).toEqual(asked[0]);
  });

  it('swaps the ends with the button named for it', async () => {
    const p = planner();
    await p.render();
    p.end('Haradan').onSelectPlace(mall);
    await p.render();
    p.end('Hara').onSelectStop(STOPS[1]);
    await p.render();
    expect(p.button('Yerləri dəyiş')).toMatchObject({ title: 'Yerləri dəyiş', 'aria-label': 'Yerləri dəyiş' });
    p.button('Yerləri dəyiş').onClick();
    await p.render();
    expect(bodies.at(-1)).toEqual({ fromStopId: 2, to: { latitude: 40.39989, longitude: 49.85283, name: 'Gənclik Mall' } });
  });
});

describe('the stop, bus and line lists (#743)', () => {
  const BUS: BusLite = { id: 7, number: '7', first_point: 'A', last_point: 'B', route_length: 10, duration_minuts: 30 };
  const LINE: BusLineDetail = {
    busId: 7, number: '7', carrier: '', first_point: 'A', last_point: 'B', route_length: 10, duration_minuts: 30,
    tariff_str: '', direction: 1, availableDirections: [1], stops: STOPS, coordinates: [],
  };

  it('are checked with the server before any copy the browser kept is used', async () => {
    // The routes answer a current copy with a 304. A copy a browser kept under the old
    // header, s-maxage with stale-while-revalidate, has no tag: asked for with no-cache, it
    // is fetched afresh rather than shown once more after a deploy changed the list.
    const asks: Array<[string, unknown]> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      asks.push([url, init]);
      if (url === '/api/avtobus/stops') return { ok: true, json: async () => ({ stops: STOPS }) };
      if (url === '/api/avtobus/buses') return { ok: true, json: async () => ({ buses: [BUS] }) };
      return { ok: true, json: async () => ({ line: LINE }) };
    }));
    const p = planner();
    await p.render();
    p.button('Xətti göstər').onClick();
    await p.render();
    p.view.find(el => Array.isArray(el.props.buses))[0].props.onSelect(BUS);
    await p.render();
    expect(asks).toEqual([
      ['/api/avtobus/stops', { cache: 'no-cache' }],
      ['/api/avtobus/buses', { cache: 'no-cache' }],
      ['/api/avtobus/line?busId=7&direction=1', { cache: 'no-cache' }],
    ]);
  });
});

describe('a start or destination picker (#720)', () => {
  const endPicker = () => {
    const view = mountComponent<Record<string, unknown>>(FILE, imports, 'EndPicker');
    const props = { label: 'Haradan', stops: STOPS, selected: null, place: null, onSelectStop() {}, onSelectPlace() {},
      active: true, onActivate() {}, loading: false, near: null };
    const search = (query: string) => {
      view.render(props);
      return (view.find(el => el.type === Picker)[0].props.searchItems(query) as Array<{ key: string }>).map(item => item.key);
    };
    return { search };
  };

  it("lists nothing while a new query's places are held for, then ranks them in with the stops", () => {
    const { search } = endPicker();
    placeSearch = { places: [], pending: true, degraded: false, holding: true };
    expect(search('gənclik')).toEqual([]);
    placeSearch = { places: [mall], pending: false, degraded: false, holding: false };
    expect(search('gənclik')).toEqual(['pw674677959', 's1']);
  });
});

describe('a street as a start or destination (#743)', () => {
  const nizami: PlaceMatch = { id: 'w25403734', name: 'Nizami küçəsi / Bakı', category: 'street', label: 'Küçə',
    latitude: 40.37396, longitude: 49.84404, length: 3.2, rank: 1 };
  const sabir: PlaceMatch = { id: 'w299568692', name: 'Sabir küçəsi / Saray', category: 'street', label: 'Küçə',
    latitude: 40.52679, longitude: 49.71485, length: 0.4, rank: 1 };

  it("says a street's stop is measured from its middle, with a long street's length", () => {
    const view = mountComponent<Record<string, unknown>>(FILE, imports, 'EndPicker');
    placeSearch = { places: [nizami, sabir], pending: false, degraded: false, holding: false };
    view.render({ label: 'Hara', stops: STOPS, selected: null, place: null, onSelectStop() {}, onSelectPlace() {},
      active: true, onActivate() {}, loading: false, near: null });
    const items = view.find(el => el.type === Picker)[0].props.searchItems('küçəsi') as Array<{ key: string; detail: string }>;
    expect(items.map(item => [item.key, item.detail])).toEqual([
      ['pw25403734', expect.stringMatching(/^Küçə, 3\.2 km · ortasından dayanacağa \d+ m: Sahil m\/st$/)],
      // Nothing within a journey's walk of its middle: listed last, and says so.
      ['pw299568692', 'Küçə · ortasından 1000 m-də dayanacaq yoxdur'],
    ]);
  });

  it('asks for a journey to a street\'s middle, and the chosen end says it is the middle', async () => {
    const p = planner();
    await p.render();
    p.end('Haradan').onSelectStop(STOPS[0]);
    await p.render();
    p.end('Hara').onSelectPlace(nizami);
    await p.render();
    expect(bodies.at(-1)).toEqual({ fromStopId: 1, to: { latitude: 40.37396, longitude: 49.84404, name: 'Nizami küçəsi / Bakı' } });
    expect(p.end('Hara').place).toMatchObject({ name: 'Nizami küçəsi / Bakı', label: 'Küçə, 3.2 km · orta nöqtəsi götürülür' });
    // A short street does not tell its length; a place's label is its kind, as before.
    p.end('Haradan').onSelectPlace(sabir);
    await p.render();
    expect(p.end('Haradan').place).toMatchObject({ label: 'Küçə · orta nöqtəsi götürülür' });
    p.end('Haradan').onSelectPlace(mall);
    await p.render();
    expect(p.end('Haradan').place).toMatchObject({ label: 'Ticarət mərkəzi' });
  });
});

describe('the walk and the ride side by side (#743)', () => {
  const journey = (minutes: number, mode: 'walk' | 'bus') => ({
    segments: [{ mode, stops: [] }], totalDistance: 1.2, totalTime: minutes, totalTransfers: 0, totalStops: 0,
  });
  const RIDE = journey(9, 'bus'), WALK = journey(21, 'walk');
  const RACKS = { boarding: null, alighting: null };
  const answer = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/avtobus/stops'
    ? { ok: true, json: async () => ({ stops: STOPS }) } : { ok: true, json: async () => body }));

  async function found(body: unknown) {
    answer(body);
    const p = planner();
    await p.render();
    p.end('Haradan').onSelectStop(STOPS[0]);
    await p.render();
    p.end('Hara').onSelectStop(STOPS[1]);
    await p.render();
    const shown = () => ({
      view: p.view.find(el => el.type === JourneyView)[0]?.props,
      choice: p.view.find(el => el.type === JourneyChoice)[0]?.props,
      map: p.map(),
    });
    return { p, shown };
  }

  it('shows the planner\'s answer, and the other on a press, in the steps and on the map', async () => {
    const { p, shown } = await found({ route: RIDE, bikeParking: null, alternative: { route: WALK, bikeParking: RACKS } });
    expect(shown().choice).toMatchObject({ route: RIDE, alternative: WALK, shown: 'route' });
    expect(shown().view).toMatchObject({ route: RIDE, bikeParking: null, recommended: true });
    expect(shown().map).toMatchObject({ route: RIDE, bikeParking: null });
    shown().choice.onShow('alternative');
    await p.render();
    expect(shown().view).toMatchObject({ route: WALK, bikeParking: RACKS, recommended: false });
    expect(shown().map).toMatchObject({ route: WALK, bikeParking: RACKS });
    // A new answer is shown as the planner's again.
    p.button('Yenidən hesabla').onClick();
    await p.render();
    expect(shown().choice).toMatchObject({ shown: 'route' });
    expect(shown().view).toMatchObject({ route: RIDE, recommended: true });
  });

  it('calls neither recommended where the walk between two stops costs no more than their ride', async () => {
    const { p, shown } = await found({ route: RIDE, bikeParking: null, alternative: { route: WALK, bikeParking: null, costsNoMore: true } });
    expect(shown().view).toMatchObject({ route: RIDE, recommended: null });
    shown().choice.onShow('alternative');
    await p.render();
    expect(shown().view).toMatchObject({ route: WALK, recommended: null });
  });

  it('shows one answer as before when nothing stands beside it', async () => {
    const { shown } = await found({ route: RIDE, bikeParking: null, alternative: null });
    expect(shown().choice).toBeUndefined();
    expect(shown().view).toEqual({ route: RIDE, bikeParking: null });
    const { shown: older } = await found({ route: WALK, bikeParking: null });
    expect(older().choice).toBeUndefined();
    expect(older().view).toEqual({ route: WALK, bikeParking: null });
  });
});

describe('a point tapped on the map (#743)', () => {
  it('starts or ends the journey at the point itself, filling the field a stop\'s tap would', async () => {
    const p = planner();
    await p.render();
    // The first tap is the start; a stop at 40.4, 49.85 is 111 m north of it.
    p.map().onPointClick(40.399, 49.850004);
    await p.render();
    expect(p.end('Haradan').place).toEqual({
      id: 'map:40.399,49.85', name: 'Xəritədə seçilən nöqtə', label: 'Xəritədən · dayanacağa 111 m: Gənclik m/st',
      latitude: 40.399, longitude: 49.85,
    });
    // The next is the destination, and the journey is asked for between the two points.
    p.map().onPointClick(40.371234567, 49.84);
    await p.render();
    // Without names: the journey calls them by their ends, so two tapped points read apart.
    expect(bodies.at(-1)).toEqual({ from: { latitude: 40.399, longitude: 49.85 }, to: { latitude: 40.37123, longitude: 49.84 } });
    const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' ? node
      : (node as { props?: { children?: unknown } } | null)?.props ? text((node as { props: { children?: unknown } }).props.children) : '';
    expect(p.view.find(el => el.type === 'span' && text(el.props.children).includes('Başlanğıc nöqtəsi → Təyinat nöqtəsi'))).toHaveLength(1);
    // With a destination chosen, a tap changes the start, as a stop's tap does.
    p.map().onPointClick(40.4, 49.86);
    await p.render();
    expect(bodies.at(-1)).toMatchObject({ from: { latitude: 40.4, longitude: 49.86 }, to: { latitude: 40.37123 } });
    // A stop handed over by a marker's tap is still a stop. That a marker keeps its tap
    // from the map is Leaflet's doing, checked in the browser.
    p.map().onStopClick(STOPS[0]);
    await p.render();
    expect(bodies.at(-1)).toMatchObject({ fromStopId: 1, to: { latitude: 40.37123 } });
  });

  it('refuses a point outside the network\'s area, and says so', async () => {
    const p = planner();
    await p.render();
    p.map().onPointClick(41.5, 48.0);
    await p.render();
    expect(p.end('Haradan').place).toBeNull();
    expect(p.view.find(el => el.props.role === 'status' && /kənardadır/.test(String(el.props.children)))).toHaveLength(1);
  });

  it('tells the place search where a tapped point is only to about 1 km, as for the location', async () => {
    const p = planner();
    await p.render();
    p.map().onPointClick(40.377134, 49.854137);
    await p.render();
    expect(p.end('Hara').near).toEqual({ latitude: 40.38, longitude: 49.85 });
  });

  it('takes no point before the stops are in, whose nearest its label names', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const p = planner();
    await p.render();
    expect(p.map().onPointClick).toBeUndefined();
  });

  it('takes no point while a line is shown', async () => {
    const p = planner();
    await p.render();
    p.button('Xətti göstər').onClick();
    await p.render();
    expect(p.map().onPointClick).toBeUndefined();
  });
});
