/**
 * GET /api/avtobus/places (#720): the place search behind the start and destination
 * pickers. The index is a small fixture through the real search, and a spy a test can
 * make fail; the real data has its own suite (src/lib/busroute/__tests__/places.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getPlaceIndex } = vi.hoisted(() => ({ getPlaceIndex: vi.fn() }));
vi.mock('@/lib/busroute/places', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/busroute/places')>();
  return { ...actual, getPlaceIndex };
});
import { buildPlaceIndex } from '@/lib/busroute/places';
import { GET } from '../places/route';

const INDEX = buildPlaceIndex({
  labels: { mall: 'Ticarət mərkəzi', supermarket: 'Supermarket', metro: 'Metro stansiyası' },
  places: [
    ['w2', 'Gənclik Mall', 'mall', 40.401, 49.852, 1, ['Ganjlik Mall']],
    ['n1', 'Gənclik', 'metro', 40.4, 49.851, 1, ['Ganjlik']],
    ['n4', 'Bravo', 'supermarket', 40.4, 49.8, 0, []],
    ['n5', 'Bravo', 'supermarket', 40.4, 49.9, 0, []],
  ],
});
const get = (query: string) => GET(new NextRequest(`https://www.birjob.com/api/avtobus/places${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  getPlaceIndex.mockResolvedValue(INDEX);
});

describe('GET /api/avtobus/places', () => {
  it('answers the best places for what was typed, with their labels and coordinates', async () => {
    const res = await get('?q=g%C9%99nclik');
    expect(res.status).toBe(200);
    // Not kept by a browser or the edge: an answer from before a deploy that changes
    // places.json was shown once more, for up to a week, under stale-while-revalidate.
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { places } = await res.json();
    expect(places).toEqual([
      { id: 'n1', name: 'Gənclik', category: 'metro', label: 'Metro stansiyası', latitude: 40.4, longitude: 49.851, rank: 0 },
      { id: 'w2', name: 'Gənclik Mall', category: 'mall', label: 'Ticarət mərkəzi', latitude: 40.401, longitude: 49.852, rank: 1 },
    ]);
    expect((await (await get('?q=ganjlik+mall')).json()).places).toMatchObject([{ id: 'w2', alias: 'Ganjlik Mall' }]);
  });

  it('answers a street with its length, where its middle is (#743)', async () => {
    getPlaceIndex.mockResolvedValueOnce(buildPlaceIndex({
      labels: { street: 'Küçə' },
      places: [['w25403734', 'Nizami küçəsi / Bakı', 'street', 40.37396, 49.84404, 1, ['Торговая'], 3.2]],
    }));
    const { places } = await (await get('?q=nizami+k%C3%BC%C3%A7%C9%99si')).json();
    expect(places).toEqual([{ id: 'w25403734', name: 'Nizami küçəsi / Bakı', category: 'street', label: 'Küçə',
      latitude: 40.37396, longitude: 49.84404, length: 3.2, rank: 1 }]);
  });

  it('puts the place nearer the other end of the journey first among equals', async () => {
    const ids = async (query: string) => (await (await get(query)).json()).places.map((p: { id: string }) => p.id);
    expect(await ids('?q=bravo')).toEqual(['n4', 'n5']);
    expect(await ids('?q=bravo&near=40.4,49.9')).toEqual(['n5', 'n4']);
  });

  it('finds nothing for a query under two letters, without an error', async () => {
    const res = await get('?q=g');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [] });
  });

  it.each(['', '?q=', '?q=%20%20', `?q=${'a'.repeat(101)}`, '?q=bravo&near=40.4', '?q=bravo&near=abc,49.8',
    '?q=bravo&near=4.05,49.8', '?q=bravo&near=40.4,49.8,1'])('400 before searching: %s', async (query) => {
    // 4.05 is #685's broken latitude: a point outside the network is no place to start from.
    const res = await get(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.places).toEqual([]);
    expect(typeof body.error).toBe('string');
    expect(getPlaceIndex).not.toHaveBeenCalled();
  });

  it('degrades to no places, says so and is not cached, when the index cannot be built', async () => {
    getPlaceIndex.mockRejectedValueOnce(new Error('places.json unreadable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await get('?q=bravo');
      expect(res.status).toBe(200); // the page goes on with its stops
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ places: [], degraded: true });
      expect(log).toHaveBeenCalledWith('[avtobus] places failed:', expect.any(Error));
    } finally { log.mockRestore(); }
    // The next search is answered again.
    expect((await (await get('?q=bravo')).json()).places).toHaveLength(2);
  });
});
