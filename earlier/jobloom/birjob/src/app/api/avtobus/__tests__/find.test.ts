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
  // One bus of 10 minutes, or two of 1 minute each: 10 + 15 against 2 + 2 × 15.
  getGraph.mockResolvedValue(graph({ 1: [ride(3, 10, 10), ride(2, 20)], 2: [ride(3, 30)] }));
});

describe('POST /api/avtobus/find', () => {
  it('returns the chosen itinerary through the real routing engine', async () => {
    const res = await POST(request({ fromStopId: 1, toStopId: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from.id).toBe(1);
    expect(body.to.id).toBe(3);
    expect(body.route.totalTransfers).toBe(0);
    expect(body.route.segments).toHaveLength(1);
    expect(body.route.segments[0]).toMatchObject({ busId: 10, direction: 1, headsign: 'Terminus 10/1' });
  });

  it('returns two buses where they save more than a boarding over one (#721)', async () => {
    // One bus of 100 minutes, which #664 returned, against two of 1 minute each.
    getGraph.mockResolvedValueOnce(graph({ 1: [ride(3, 10, 100), ride(2, 20)], 2: [ride(3, 30)] }));
    const { route } = await (await POST(request({ fromStopId: 1, toStopId: 3 }))).json();
    expect(route.segments.map((s: { busId: number }) => s.busId)).toEqual([20, 30]);
    expect(route).toMatchObject({ totalTransfers: 1, totalTime: 2 });
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

  // Stop k of the fixture stands at 40 + k/100° N on 49° E: these points are 55 m from
  // stops 1 and 3, 2.3 km apart, further than a walk the whole way (#720).
  const mall = { latitude: 40.0095, longitude: 49, name: 'Gənclik Mall' };
  const library = { latitude: 40.0305, longitude: 49, name: 'Kitabxana' };

  it('routes from a place to a place, counting the walks to and from them (#720)', async () => {
    const res = await POST(request({ from: mall, to: library }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toEqual(mall);
    expect(body.to).toEqual(library);
    const { route } = body;
    expect(route.segments.map((s: { mode: string }) => s.mode)).toEqual(['walk', 'bus', 'walk']);
    expect(route.segments[0].stops).toEqual([
      { id: -1, name: 'Gənclik Mall', latitude: 40.0095, longitude: 49 }, expect.objectContaining({ id: 1 }),
    ]);
    expect(route.segments[2].stops.at(-1)).toEqual({ id: -2, name: 'Kitabxana', latitude: 40.0305, longitude: 49 });
    // 56 m each way, timed on its streets (1.3 times the straight line at 4.5 km/h), and
    // the 10-minute bus.
    expect(route.segments[0].distance).toBeCloseTo(0.0556, 3);
    expect(route.segments[0].time).toBeCloseTo(0.964, 3);
    expect(route).toMatchObject({ totalTime: 11.9, totalDistance: 1.11, totalTransfers: 0 });
  });

  it('routes between a stop and a place either way, and names a nameless point (#720)', async () => {
    const toPlace = await (await POST(request({ fromStopId: 1, to: library }))).json();
    expect(toPlace.from).toEqual({ id: 1, name: 'Stop 1' });
    expect(toPlace.route.segments.map((s: { stops: Array<{ id: number }> }) => s.stops.map(p => p.id))).toEqual([[1, 3], [3, -2]]);
    const fromHere = await (await POST(request({ from: { latitude: 40.0095, longitude: 49 }, toStopId: 3 }))).json();
    expect(fromHere.from).toEqual({ name: 'Başlanğıc nöqtəsi', latitude: 40.0095, longitude: 49 });
    expect(fromHere.route.segments[0].stops[0]).toMatchObject({ id: -1, name: 'Başlanğıc nöqtəsi' });
  });

  it('walks the whole way between two places a short walk apart (#720)', async () => {
    const { route, bikeParking } = await (await POST(request({ from: mall, to: { ...library, latitude: 40.0155 } }))).json();
    expect(route.segments).toHaveLength(1);
    expect(route.segments[0]).toMatchObject({ mode: 'walk', distance: expect.closeTo(0.667, 3) });
    expect(route.segments[0].stops.map((s: { id: number }) => s.id)).toEqual([-1, -2]);
    expect(bikeParking).toBeNull();
  });

  it.each([
    { from: { latitude: '40.01', longitude: 49 }, toStopId: 3 },
    { from: { latitude: 41.6, longitude: 49 }, toStopId: 3 },
    { from: { latitude: 40.01, longitude: 51.2 }, toStopId: 3 },
    { from: { latitude: 40.01, longitude: 49 }, fromStopId: 1, toStopId: 3 },
    { toStopId: 3 },
    { from: { latitude: 40.01, longitude: 49, name: 'x'.repeat(201) }, toStopId: 3 },
    { from: { latitude: 40.01, longitude: 49, name: '   ' }, toStopId: 3 },
    { from: { latitude: 40.01, longitude: 49 }, to: { latitude: 40.01, longitude: 49 } },
  ])('rejects a malformed or out-of-area point before loading any graph: %j', async body => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe('string');
    expect(getGraph).not.toHaveBeenCalled();
  });

  it('sends the walk beside a journey that rides, and the ride beside the walk, when either is worth weighing (#743)', async () => {
    const steps = (route: { segments: Array<{ mode: string; stops: Array<{ id: number }> }> }) =>
      route.segments.map((s) => `${s.mode} ${s.stops.map((p) => p.id).join('-')}`);
    // Stops 1 and 2, 1.1 km apart, 19 minutes on foot: the bus of 1 minute is the answer,
    // and the walk between them stands beside it, with no racks, as a walk has none.
    const stops = await (await POST(request({ fromStopId: 1, toStopId: 2 }))).json();
    expect(steps(stops.route)).toEqual(['bus 1-2']);
    expect(stops.alternative).toEqual({ route: expect.objectContaining({ totalTransfers: 0 }), bikeParking: null, costsNoMore: false });
    expect(steps(stops.alternative.route)).toEqual(['walk 1-2']);
    // A bus of 5 minutes costs 20 with its boarding, more than the walk's 19: the answer
    // stays the bus, as between two stops it is, and the walk is said to cost no more.
    getGraph.mockResolvedValueOnce(graph({ 1: [ride(2, 20, 5)] }));
    const dearer = await (await POST(request({ fromStopId: 1, toStopId: 2 }))).json();
    expect(steps(dearer.route)).toEqual(['bus 1-2']);
    expect(dearer.alternative).toMatchObject({ costsNoMore: true });
    // 2.2 km apart, 38 minutes on foot: nothing beside the bus.
    expect((await (await POST(request({ fromStopId: 1, toStopId: 3 }))).json()).alternative).toBeNull();
    // From the mall to a point 1.3 km on, 23 minutes on foot: the bus of 1 minute is the
    // answer with the walk beside it ...
    const near = { latitude: 40.0215, longitude: 49, name: 'Poçt' };
    const rides = await (await POST(request({ from: mall, to: near }))).json();
    expect(steps(rides.route)).toEqual(['walk -1-1', 'bus 1-2', 'walk 2--2']);
    expect(steps(rides.alternative.route)).toEqual(['walk -1--2']);
    // ... and a bus of 8 minutes, 26.9 with its boarding, loses to the walk, and stands
    // beside it, 11.9 minutes before its wait, with its racks worked out as the answer's are.
    getGraph.mockResolvedValueOnce(graph({ 1: [ride(2, 20, 8)] }));
    const walks = await (await POST(request({ from: mall, to: near }))).json();
    expect(steps(walks.route)).toEqual(['walk -1--2']);
    expect(steps(walks.alternative.route)).toEqual(['walk -1-1', 'bus 1-2', 'walk 2--2']);
    expect(walks.alternative.bikeParking).toBeNull();
    expect(journeyBikeParking).toHaveBeenCalledWith(walks.alternative.route);
  });

  it('says which place has no stop within a walk, by its name (#720)', async () => {
    const res = await POST(request({ from: { latitude: 40.2, longitude: 49, name: 'Uzaq bağ' }, toStopId: 3 }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/^«Uzaq bağ» yaxınlığında 1000 metrədək dayanacaq/);
  });

  it('says when no journey joins two places (#720)', async () => {
    getGraph.mockResolvedValueOnce(graph({ 1: [ride(2, 10)], 4: [ride(3, 20)] }));
    const res = await POST(request({ from: mall, to: library }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Bu yerlər arasında marşrut tapılmadı');
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
