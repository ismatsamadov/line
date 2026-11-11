/**
 * The planner's own state (#720): what it asks /api/avtobus/find for once two ends are
 * chosen, where a map tap goes, and what the place search is told of the person's
 * location. The pickers and the map are stand-ins whose props the tests call, as a tap
 * or a choice in the browser would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { mountComponent, defaultExport, type FoundElement } from '@/test/clientComponent';
import * as access from '@/lib/busroute/access';
import * as geo from '@/lib/busroute/geo';
import type { PlaceMatch } from '@/lib/busroute/places';
import type { StopDetail } from '@/lib/busroute/types';
import * as search from '../search';
import * as journeyFormatting from '../journeyFormatting';
import * as mapMarks from '../mapMarks';

const FILE = fileURLToPath(new URL('../Component.tsx', import.meta.url));
const Stub = () => null;
const BusMap = () => null;
const icons = new Proxy({}, { get: () => Stub });

const stop = (id: number, name: string, latitude: number, longitude: number): StopDetail =>
  ({ id, code: String(id), name, latitude, longitude, is_transport_hub: false });
const STOPS = [stop(1, 'Gənclik m/st', 40.4, 49.85), stop(2, 'Sahil m/st', 40.37, 49.84)];
const mall: PlaceMatch = { id: 'w674677959', name: 'Gənclik Mall', category: 'mall', label: 'Ticarət mərkəzi', latitude: 40.39989, longitude: 49.85283, rank: 0 };
const library: PlaceMatch = { id: 'n1', name: 'Kitabxana', category: 'culture', label: 'Mədəniyyət mərkəzi', latitude: 40.3753, longitude: 49.8331, rank: 0 };

let bodies: unknown[];
let position: { latitude: number; longitude: number; accuracy: number };

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function planner() {
  const view = mountComponent<Record<string, never>>(FILE, {
    'next/dynamic': defaultExport(() => BusMap),
    'lucide-react': icons,
    '@/components/SupportCTA': defaultExport(Stub),
    '@/lib/busroute/access': access,
    '@/lib/busroute/geo': geo,
    './JourneyView': defaultExport(Stub),
    './Picker': defaultExport(Stub),
    './search': search,
    './usePlaceSearch': { usePlaceSearch: () => ({ places: [], pending: false, degraded: false, holding: false }) },
    './journeyFormatting': journeyFormatting,
    './mapMarks': mapMarks,
  });
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
  position = { latitude: 40.377134, longitude: 49.854137, accuracy: 25 };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: position }) } });
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
});
