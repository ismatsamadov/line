import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { graph, ride, train, walk } from '@/lib/busroute/__tests__/fixtures';

const { getGraph, journeyBikeParking } = vi.hoisted(() => ({ getGraph: vi.fn(), journeyBikeParking: vi.fn() }));
vi.mock('@/lib/busroute/graph', () => ({ getGraph }));
// The real racks, through a spy a test can make fail (#692).
vi.mock('@/lib/busroute/bike', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/busroute/bike')>();
  journeyBikeParking.mockImplementation(actual.journeyBikeParking);
  return { ...actual, journeyBikeParking };
});
import { POST } from '../find/route';

const request = (body: unknown) => new NextRequest('https://www.birjob.com/api/avtobus/find', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  getGraph.mockResolvedValue(graph({ 1: [ride(3, 10, 100), ride(2, 20)], 2: [ride(3, 30)] }));
});

describe('POST /api/avtobus/find', () => {
  it('returns the minimum-boardings itinerary through the real routing engine', async () => {
    const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from.id).toBe(1);
    expect(body.to.id).toBe(3);
    expect(body.route.totalTransfers).toBe(0);
    expect(body.route.segments).toHaveLength(1);
    expect(body.route.segments[0]).toMatchObject({ busId: 10, direction: 1, headsign: 'Terminus 10/1' });
  });

  it.each([{}, null, [], { fromStopId: '1', toStopId: 3 }, { fromStopId: -1, toStopId: 3 },
    { fromStopId: 0, toStopId: 3 }, { fromStopId: 1.5, toStopId: 3 }, { fromStopId: 1e30, toStopId: 3 }])('rejects malformed IDs before loading any graph: %j', async body => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
    expect(getGraph).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and identical stops with a recoverable 400', async () => {
    const malformed = await POST(new NextRequest('https://www.birjob.com/api/avtobus/find', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    expect(typeof (await malformed.json()).error).toBe('string');
    expect((await POST(request({ fromStopId: 1, toStopId: 1 }))).status).toBe(400);
    expect(getGraph).not.toHaveBeenCalled();
  });

  it.each([{ fromStopId: 99, toStopId: 3 }, { fromStopId: 1, toStopId: 99 }])('returns 404 for unknown stops: %j', async body => {
    expect((await POST(request(body))).status).toBe(404);
  });

  it('returns a clear no-route error, or a bounded walking-only option', async () => {
    getGraph.mockResolvedValueOnce(graph({ 1: [], 3: [] }));
    expect((await POST(request({ fromStopId: 1, toStopId: 3 }))).status).toBe(404);
    getGraph.mockResolvedValueOnce(graph({ 1: [walk(3)] }));
    const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
    expect(res.status).toBe(200);
    expect((await res.json()).route.segments[0].busId).toBe(-1);
  });

  it('returns a metro ride with its mode and line (#689)', async () => {
    getGraph.mockResolvedValueOnce(graph({ 1: [walk(30)], 30: [train(31, 1, 5)], 31: [walk(3)] }));
    const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
    expect(res.status).toBe(200);
    const { route } = await res.json();
    expect(route.segments.map((s: { mode: string }) => s.mode)).toEqual(['walk', 'metro', 'walk']);
    expect(route.segments[1]).toMatchObject({ busId: -2, busNumber: 'Qırmızı xətt', line: { name: 'Qırmızı xətt', color: '#FF0000' } });
    expect(route.totalTransfers).toBe(0);
  });

  it('sends the bicycle racks beside the journey (#692)', async () => {
    const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
    const body = await res.json();
    expect(journeyBikeParking).toHaveBeenCalledWith(body.route);
    // The fixture's stops lie at 49° E, west of Baku and of every rack.
    expect(body.bikeParking).toBeNull();
    const rack = { stop: { id: 1, name: 'Stop 1', latitude: 40.01, longitude: 49 }, parking: { name: 'MPV-1-2', latitude: 40.0101, longitude: 49, distance: 0.011 } };
    journeyBikeParking.mockReturnValueOnce({ boarding: rack, alighting: null });
    expect((await (await POST(request({ fromStopId: 1, toStopId: 3 }))).json()).bikeParking).toEqual({ boarding: rack, alighting: null });
  });

  it('still returns the journey when its racks cannot be worked out (#692)', async () => {
    journeyBikeParking.mockImplementationOnce(() => { throw new Error('bike.json unreadable'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.route.segments).toHaveLength(1);
      expect(body.bikeParking).toBeNull();
      expect(log).toHaveBeenCalledWith('[avtobus] bike parking not added:', expect.any(Error));
    } finally { log.mockRestore(); }
  });

  it('returns an actionable error instead of throwing a database exception', async () => {
    getGraph.mockRejectedValueOnce(new Error('database unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Marşrut hesablanmadı');
    } finally { log.mockRestore(); }
  });
});
