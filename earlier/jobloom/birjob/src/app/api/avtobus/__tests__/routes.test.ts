/**
 * Route-handler tests for the planner's list endpoints:
 *   GET /api/avtobus/stops — every stop, for the pickers and the map
 *   GET /api/avtobus/buses — the picker list
 *   GET /api/avtobus/line  — one line's full trajectory (+ input validation)
 * The DB layer is mocked; these assert the routes' validation, error branches and caching,
 * through the real NextRequest and NextResponse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { queryBusLine: vi.fn(), listBusesLite: vi.fn(), listStopsForGeo: vi.fn() },
}));
vi.mock('@/lib/busroute/db', () => dbMock);

import { GET as lineGET } from '../line/route';
import { GET as busesGET } from '../buses/route';
import { GET as stopsGET } from '../stops/route';
import { entityTag, noneMatch } from '@/lib/busroute/listResponse';

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://www.birjob.com/api/avtobus/${path}`, { headers });
const lineReq = (qs: string) => request(`line${qs}`);

const SAMPLE_LINE = {
  busId: 1, number: '1', carrier: 'BakuBus', first_point: 'A', last_point: 'B',
  route_length: 25.8, duration_minuts: 43, tariff_str: '0.50 AZN',
  direction: 1, availableDirections: [1, 2],
  stops: [{ id: 10, code: '', name: 'A', latitude: 40.4, longitude: 49.8, is_transport_hub: false }],
  coordinates: [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.41, longitude: 49.81 }],
};
const STOPS = [{ id: 1, code: '1', name: 'A', latitude: 40.4, longitude: 49.8, is_transport_hub: false }];
const BUSES = [{ id: 1, number: '1', first_point: 'A', last_point: 'B', route_length: 25.8, duration_minuts: 43 }];

beforeEach(() => vi.clearAllMocks());

describe('GET /api/avtobus/line', () => {
  it('400 when busId is missing (no DB call)', async () => {
    const res = await lineGET(lineReq(''));
    expect(res.status).toBe(400);
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('400 when busId is non-numeric', async () => {
    const res = await lineGET(lineReq('?busId=abc'));
    expect(res.status).toBe(400);
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('404 when the line does not exist', async () => {
    dbMock.queryBusLine.mockResolvedValue(null);
    const res = await lineGET(lineReq('?busId=99999'));
    expect(res.status).toBe(404);
  });

  it('200 with the line and defaults the direction to 1', async () => {
    dbMock.queryBusLine.mockResolvedValue(SAMPLE_LINE);
    const res = await lineGET(lineReq('?busId=1'));
    expect(res.status).toBe(200);
    expect((await res.json()).line.number).toBe('1');
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(1, 1);
  });

  it('passes the requested direction through', async () => {
    dbMock.queryBusLine.mockResolvedValue({ ...SAMPLE_LINE, direction: 2 });
    await lineGET(lineReq('?busId=1&direction=2'));
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(1, 2);
  });

  it('400 when the direction is not 1 or 2 (no DB call)', async () => {
    // The data has directions 1 and 2 only; anything else used to be read as 1.
    for (const direction of ['xyz', '3', '0', '1junk', '']) {
      const res = await lineGET(lineReq(`?busId=1&direction=${direction}`));
      expect(res.status, direction).toBe(400);
    }
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('400 for a busId parseInt would have read as a number (no DB call)', async () => {
    // #685: parseInt took "1junk" and "1.5" as 1, and passed ids past int4 to Prisma.
    for (const busId of ['1junk', '1.5', '-1', '0', '01', '1e3', '%201', '2147483648', '99999999999']) {
      const res = await lineGET(lineReq(`?busId=${busId}`));
      expect(res.status, busId).toBe(400);
    }
    expect(dbMock.queryBusLine).not.toHaveBeenCalled();
  });

  it('accepts the largest PostgreSQL integer as a busId', async () => {
    dbMock.queryBusLine.mockResolvedValue(null);
    const res = await lineGET(lineReq('?busId=2147483647&direction=2'));
    expect(res.status).toBe(404);
    expect(dbMock.queryBusLine).toHaveBeenCalledWith(2147483647, 2);
  });

  it('500 (not a throw) when the query fails — graceful degradation', async () => {
    dbMock.queryBusLine.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await lineGET(lineReq('?busId=1'));
      expect(res.status).toBe(500);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('GET /api/avtobus/buses', () => {
  it('200 with the bus list', async () => {
    dbMock.listBusesLite.mockResolvedValue(BUSES);
    const res = await busesGET(request('buses'));
    expect(res.status).toBe(200);
    expect((await res.json()).buses).toHaveLength(1);
  });

  it('500 (not a throw) when the query fails — graceful degradation', async () => {
    dbMock.listBusesLite.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await busesGET(request('buses'));
      expect(res.status).toBe(500);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('GET /api/avtobus/stops', () => {
  it('200 with every stop', async () => {
    dbMock.listStopsForGeo.mockResolvedValue(STOPS);
    const res = await stopsGET(request('stops'));
    expect(res.status).toBe(200);
    expect((await res.json()).stops).toHaveLength(1);
  });

  it('500 (not a throw) when the query fails — graceful degradation', async () => {
    dbMock.listStopsForGeo.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await stopsGET(request('stops'));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBeTruthy();
      // An error is not a list: no tag, so nothing keeps it as one.
      expect(res.headers.get('etag')).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });
});

// The three lists sent s-maxage with stale-while-revalidate and no max-age: Cloudflare
// keeps nothing under /api/, and the browser showed its copy once more after a deploy
// changed the list. They are checked before every use instead (#743).
describe.each([
  { name: 'stops', get: (headers?: Record<string, string>) => stopsGET(request('stops', headers)),
    serve: (version: string) => dbMock.listStopsForGeo.mockResolvedValue([{ ...STOPS[0], name: version }]) },
  { name: 'buses', get: (headers?: Record<string, string>) => busesGET(request('buses', headers)),
    serve: (version: string) => dbMock.listBusesLite.mockResolvedValue([{ ...BUSES[0], last_point: version }]) },
  { name: 'line', get: (headers?: Record<string, string>) => lineGET(request('line?busId=1', headers)),
    serve: (version: string) => dbMock.queryBusLine.mockResolvedValue({ ...SAMPLE_LINE, last_point: version }) },
])('GET /api/avtobus/$name, checked before every use (#743)', ({ get, serve }) => {
  it('sends the list with no-cache and a weak tag hashed from its body', async () => {
    serve('v1');
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(res.headers.get('etag')).toBe(entityTag(body));
    // Weak: Caddy appends its encoding only to a strong tag, and Cloudflare keeps a weak one.
    expect(res.headers.get('etag')).toMatch(/^W\/"[A-Za-z0-9_-]{43}"$/);
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('answers 304 with no body while the browser holds the list, whatever the way back did to the tag', async () => {
    serve('v1');
    const tag = (await get()).headers.get('etag')!;
    const opaque = tag.slice(2);
    // As sent, strong, with Caddy's encoding still on it as an older Caddy leaves it on a
    // weakened strong tag, in a list, or *.
    const sentBack = [tag, opaque, `W/${opaque.slice(0, -1)}-gzip"`, `${opaque.slice(0, -1)}-zstd"`, `"other", ${tag}`, ` W/"other" ,${tag} `, '*'];
    for (const header of sentBack) {
      const res = await get({ 'If-None-Match': header });
      expect(res.status, header).toBe(304);
      expect(await res.text(), header).toBe('');
      expect(res.headers.get('etag'), header).toBe(tag);
      expect(res.headers.get('cache-control'), header).toBe('no-cache');
    }
  });

  it('sends the new list when it changed, as after a deploy that changes it', async () => {
    serve('v1');
    const kept = (await get()).headers.get('etag')!;
    serve('v2');
    const res = await get({ 'If-None-Match': kept });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).not.toBe(kept);
    expect(JSON.stringify(await res.json())).toContain('v2');
    // A tag that only looks like it, and an empty header, are no match either.
    for (const header of [kept.slice(0, -2) + '"', `"${kept}"`, '']) {
      expect((await get({ 'If-None-Match': header })).status, header).toBe(200);
    }
  });
});

describe('noneMatch', () => {
  it('compares weakly, over a list, and matches * to any list', () => {
    expect(noneMatch(null, '"a"')).toBe(false);
    expect(noneMatch('"a"', '"a"')).toBe(true);
    expect(noneMatch('W/"a"', '"a"')).toBe(true);
    expect(noneMatch('"b", W/"a"', '"a"')).toBe(true);
    expect(noneMatch('"b"', '"a"')).toBe(false);
    expect(noneMatch('*', '"a"')).toBe(true);
  });

  it("takes a tag back with Caddy's encoding still on it, and nothing else", () => {
    // Caddy up to v2.11.7 leaves its suffix on a tag Cloudflare marked W/ (#743).
    expect(noneMatch('W/"a-gzip"', 'W/"a"')).toBe(true);
    expect(noneMatch('"a-zstd"', 'W/"a"')).toBe(true);
    expect(noneMatch('"a-br"', 'W/"a"')).toBe(false);
    expect(noneMatch('"b-gzip"', 'W/"a"')).toBe(false);
    expect(noneMatch('W/"a-gzip-gzip"', 'W/"a"')).toBe(false);
    // A tag that ends that way itself still matches as sent.
    expect(noneMatch('W/"a-gzip"', 'W/"a-gzip"')).toBe(true);
  });
});
