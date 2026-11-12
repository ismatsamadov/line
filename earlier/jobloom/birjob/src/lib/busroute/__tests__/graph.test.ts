import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, busStop, stop } from './fixtures';
import { isMetroStation, METRO_STATION_ID_BASE } from '../types';
import { haversine } from '../geo';

const db = vi.hoisted(() => ({
  queryStopDetails: vi.fn(), queryBuses: vi.fn(), queryBusStops: vi.fn(), queryWalkingEdges: vi.fn(), queryRouteShapes: vi.fn(),
}));
vi.mock('../db', () => db);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(3)]);
  db.queryBuses.mockResolvedValue([bus(10)]);
  db.queryBusStops.mockResolvedValue([busStop(10, 1, 0), busStop(10, 2, 1), busStop(10, 3, 2)]);
  db.queryRouteShapes.mockResolvedValue(new Map());
});
afterEach(() => vi.restoreAllMocks());

describe('transit graph', () => {
  it('uses cumulative distance for travel order and keeps direction/position identity', async () => {
    db.queryBusStops.mockResolvedValue([
      { ...busStop(10, 1, 30), total_distance: 0 }, { ...busStop(10, 2, 10), total_distance: 1 },
      { ...busStop(10, 3, 20), total_distance: 2 }, busStop(10, 3, 0, 2), busStop(10, 2, 1, 2),
    ]);
    const { getGraph } = await import('../graph');
    const g = await getGraph();
    expect(g.getEdges(1)).toContainEqual(expect.objectContaining({ toStopId: 2, kind: 'bus', rideId: '10:1', direction: 1, fromSequence: 0, toSequence: 1, headsign: 'Stop 3' }));
    expect(g.getEdges(2)).toContainEqual(expect.objectContaining({ toStopId: 3, fromSequence: 1, toSequence: 2 }));
    expect(g.getEdges(3)).toContainEqual(expect.objectContaining({ toStopId: 2, direction: 2, rideId: '10:2' }));
  });

  it('keeps repeated stops instead of turning a loop into a shortcut', async () => {
    db.queryBusStops.mockResolvedValue([busStop(10, 1, 0), busStop(10, 2, 1), busStop(10, 1, 2), busStop(10, 3, 3)]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getEdges(1).flatMap(e => e.kind === 'bus' ? [e.fromSequence] : [])).toEqual([0, 2]);
  });

  it('rides one copy of a stop list stored twice over, never terminus to start (#685)', async () => {
    // 120A's shape: every row at one total_distance, so travel order is copy after copy.
    db.queryBusStops.mockResolvedValue([1, 2, 3, 1, 2, 3].map((s, i) => ({ ...busStop(10, s, i), total_distance: 23.4 })));
    const g = await (await import('../graph')).getGraph();
    const rides = (id: number) => g.getEdges(id).filter(e => e.kind === 'bus');
    expect(rides(3)).toEqual([]);
    // The line's 30 minutes spread over one copy's two legs, not five.
    expect(rides(1)).toEqual([expect.objectContaining({ toStopId: 2, fromSequence: 0, toSequence: 1, headsign: 'Stop 3', time: expect.closeTo(15, 9) })]);
    expect(rides(2)).toEqual([expect.objectContaining({ toStopId: 3, fromSequence: 1, toSequence: 2, time: expect.closeTo(15, 9) })]);
  });

  it("shares a line's duration by the length of its legs, not equally (#721)", async () => {
    // Stops 1, 2 and 4 sit on 40.01, 40.02 and 40.04 N: a leg of 1.1 km, then one of 2.2 km.
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(4)]);
    db.queryBusStops.mockResolvedValue([busStop(10, 1, 0), busStop(10, 2, 1), busStop(10, 4, 2)]);
    const g = await (await import('../graph')).getGraph();
    const leg = (id: number) => g.getEdges(id).find(e => e.kind === 'bus')!;
    expect(leg(1).time).toBeCloseTo(10, 9);
    expect(leg(2).time).toBeCloseTo(20, 9);
    // The bus keeps one pace: the minutes follow the kilometres.
    expect(leg(1).time / leg(1).distance).toBeCloseTo(leg(2).time / leg(2).distance, 9);
  });

  it('keeps equal shares for a line whose stops all stand in one place', async () => {
    db.queryStopDetails.mockResolvedValue([stop(1, 40.01), stop(2, 40.01), stop(3, 40.01)]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getEdges(1).find(e => e.kind === 'bus')).toMatchObject({ distance: 0, time: 15 });
    expect(g.getEdges(2).find(e => e.kind === 'bus')).toMatchObject({ distance: 0, time: 15 });
  });

  it("counts a missing stop's stretch at the straight line, so the rest of the line keeps its pace (#721)", async () => {
    // Stop 3 has no coordinates: its two legs are broken, but the bus still covers 2 to 4.
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(4), stop(5)]);
    db.queryBusStops.mockResolvedValue([1, 2, 3, 4, 5].map((s, i) => busStop(10, s, i)));
    const g = await (await import('../graph')).getGraph();
    const leg = (id: number) => g.getEdges(id).find(e => e.kind === 'bus');
    // 1.1 km legs either side of a 2.2 km gap: 30 minutes for 4.4 km.
    expect(leg(1)?.time).toBeCloseTo(7.5, 9);
    expect(leg(4)?.time).toBeCloseTo(7.5, 9);
    expect(leg(2)).toBeUndefined();
  });

  describe('a stop that sticks out of its ride (#721)', () => {
    // Stops 1-5 every 556 m up 49° E, but stop 3 stands 2 km east of the road: its two
    // legs run 4.15 km where the road runs 1.11 km.
    const stops = [stop(1, 40.005), stop(2, 40.01), stop(3, 40.015, 49.0235), stop(4, 40.02), stop(5, 40.025)];
    const road: [number, number][] = [[40.005, 49], [40.01, 49], [40.015, 49], [40.02, 49], [40.025, 49]];
    const built = async (line?: [number, number][], order = [1, 2, 3, 4, 5]) => {
      db.queryStopDetails.mockResolvedValue(stops);
      db.queryBusStops.mockResolvedValue(order.map((s, i) => busStop(10, s, i)));
      db.queryRouteShapes.mockResolvedValue(new Map(line ? [['10:1', line]] : []));
      return (await import('../graph')).getGraph();
    };
    // A stop's stored leg on, never the leg past a misplaced stop.
    const stored = (g: Awaited<ReturnType<typeof built>>, id: number, sequence?: number) =>
      g.getEdges(id).find(e => e.kind === 'bus' && !e.passes && (sequence === undefined || e.fromSequence === sequence))!;
    const past = (g: Awaited<ReturnType<typeof built>>, id: number) => g.getEdges(id).find(e => e.kind === 'bus' && e.passes);
    const km = (a: number, b: number) => haversine(stops[a - 1].latitude, stops[a - 1].longitude, stops[b - 1].latitude, stops[b - 1].longitude);
    // The line's 30 minutes cover 0.56 + 1.11 + 0.56 km, as if stop 3 stood on the road.
    const pace = 30 / (km(1, 2) + km(2, 4) + km(4, 5));

    it('counts as the straight line between its neighbours when the recorded line passes it by', async () => {
      const g = await built(road);
      expect(stored(g, 1).time).toBeCloseTo(pace * km(1, 2), 9);
      expect(stored(g, 4).time).toBeCloseTo(pace * km(4, 5), 9);
      // The stop stays where it is stored, with its walks, so its legs keep their
      // lengths and take the way there at that pace: boarding or alighting at it is
      // never a jump of 2 km for the price of 0.5.
      expect(stored(g, 2)).toMatchObject({ distance: expect.closeTo(km(2, 3), 9), time: expect.closeTo(pace * km(2, 3), 9) });
      expect(stored(g, 3)).toMatchObject({ distance: expect.closeTo(km(3, 4), 9), time: expect.closeTo(pace * km(3, 4), 9) });
    });

    it('is ridden past by the straight line between its neighbours, at the same pace', async () => {
      const g = await built(road);
      // One more leg, 2 to 4, at the position the leg from 3 reaches: a ride that stays
      // on does not pay the 4.15 km out to where stop 3 is stored and back.
      expect(past(g, 2)).toMatchObject({
        kind: 'bus', rideId: '10:1', fromSequence: 1, toSequence: 3, toStopId: 4, passes: { id: 3, name: 'Stop 3' },
        distance: expect.closeTo(km(2, 4), 9), time: expect.closeTo(pace * km(2, 4), 9),
        path: [[40.01, 49], [40.02, 49]],
      });
      expect(g.getEdges(1).concat(g.getEdges(3), g.getEdges(4)).some(e => e.kind === 'bus' && e.passes)).toBe(false);
    });

    it('takes the line its own duration end to end, and still charges the way to the stop', async () => {
      const g = await built(road);
      const { findRoute } = await import('../routing');
      const through = findRoute(g, 1, 5)!;
      expect(through.segments).toHaveLength(1);
      expect(through.segments[0].time).toBeCloseTo(30, 9);
      expect(through.segments[0].distance).toBeCloseTo(km(1, 2) + km(2, 4) + km(4, 5), 9);
      // The ride still names the stop it passes, as the line lists it, and counts it,
      // but is drawn straight past it, not out to where it is stored.
      expect(through.segments[0].stops.map(s => s.id)).toEqual([1, 2, 3, 4, 5]);
      expect(through.totalStops).toBe(5);
      expect(through.segments[0].path).toEqual([[40.005, 49], [40.01, 49], [40.02, 49], [40.025, 49]]);
      // Boarding or alighting at it costs its stored leg, more than the whole line.
      expect(findRoute(g, 3, 5)!.segments[0].time).toBeCloseTo(pace * (km(3, 4) + km(4, 5)), 9);
      expect(findRoute(g, 1, 3)!.segments[0].time).toBeCloseTo(pace * (km(1, 2) + km(2, 3)), 9);
      expect(findRoute(g, 1, 3)!.segments[0].time).toBeGreaterThan(30);
    });

    it('keeps a spur out to it and back at its stored length; only a ride past it takes the nothing between its ends', async () => {
      const g = await built(road, [1, 2, 3, 2, 4]);
      // From 2 out to 3 and back to 2 is no way at all in a straight line.
      const pace = 30 / (km(1, 2) + km(2, 4));
      expect(stored(g, 2, 1)).toMatchObject({ toStopId: 3, distance: expect.closeTo(km(2, 3), 9), time: expect.closeTo(pace * km(2, 3), 9) });
      expect(stored(g, 3, 2)).toMatchObject({ toStopId: 2, distance: expect.closeTo(km(2, 3), 9), time: expect.closeTo(pace * km(2, 3), 9) });
      expect(stored(g, 2, 3).time).toBeCloseTo(pace * km(2, 4), 9);
      expect(past(g, 2)).toMatchObject({ fromSequence: 1, toSequence: 3, toStopId: 2, distance: 0, time: 0, passes: { id: 3 } });
      const { findRoute } = await import('../routing');
      expect(findRoute(g, 1, 3)!.segments[0].time).toBeCloseTo(pace * (km(1, 2) + km(2, 3)), 9);
    });

    it('keeps its legs when the recorded line goes out to it, or when there is no line to tell', async () => {
      const byLength = 30 / (km(1, 2) + km(2, 3) + km(3, 4) + km(4, 5));
      const onLine = await built([road[0], road[1], [40.015, 49.0235], road[3], road[4]]);
      expect(stored(onLine, 1).time).toBeCloseTo(byLength * km(1, 2), 9);
      expect(past(onLine, 2)).toBeUndefined();
      vi.resetModules();
      const noLine = await built();
      expect(stored(noLine, 1).time).toBeCloseTo(byLength * km(1, 2), 9);
      expect(past(noLine, 2)).toBeUndefined();
    });
  });

  it('gives each leg its stretch of the recorded line (#685)', async () => {
    // Stops 1-3 sit on 40.01, 40.02, 40.03 N along 49 E; the line bends east between 1 and 2.
    db.queryRouteShapes.mockResolvedValue(new Map([['10:1', [[40.01, 49], [40.015, 49.001], [40.02, 49], [40.03, 49]]]]));
    const g = await (await import('../graph')).getGraph();
    const leg = (id: number) => g.getEdges(id).find(e => e.kind === 'bus');
    expect(leg(1)).toMatchObject({ toStopId: 2, path: [[40.01, 49], [40.015, 49.001], [40.02, 49]] });
    expect(leg(2)).toMatchObject({ toStopId: 3, path: [[40.02, 49], [40.03, 49]] });
  });

  it('still routes, straight between stops, when the recorded lines fail to load', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.queryRouteShapes.mockRejectedValue(new Error('lines unavailable'));
    const g = await (await import('../graph')).getGraph();
    expect(g.isBuilt()).toBe(true);
    expect(g.getEdges(1)).toContainEqual(expect.objectContaining({ kind: 'bus', toStopId: 2 }));
    expect(g.getEdges(1).some(e => e.kind === 'bus' && e.path)).toBe(false);
    expect(quiet).toHaveBeenCalled();
  });

  it('does not bridge a leg with a missing stop', async () => {
    db.queryStopDetails.mockResolvedValue([stop(1), stop(3)]);
    db.queryBuses.mockResolvedValue([{ ...bus(10), duration_minuts: -1 }]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getEdges(1)).toEqual([]);
    expect(g.getEdges(3)).toEqual([]);
  });

  it('keeps invalid coordinates out and uses positive fallback movement times', async () => {
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(3, NaN)]);
    db.queryBuses.mockResolvedValue([{ ...bus(10), duration_minuts: -1 }]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getStopInfo(3)).toBeUndefined();
    expect(g.getEdges(1)[0].time).toBeGreaterThan(0);
    expect(Number.isFinite(g.getEdges(1)[0].time)).toBe(true);
    expect(g.getEdges(2)).toEqual([]);
  });

  it('rejects world-valid points outside the Baku network without bridging their route legs', async () => {
    // The pre-migration latitude of route 517 was world-valid, in the Indian Ocean.
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2, 4.05, 49.8), stop(3)]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getStopInfo(2)).toBeUndefined();
    expect(g.getEdges(1)).toEqual([]);
    expect(g.getEdges(3)).toEqual([]);
  });

  it("walks from Azərbaycan Hava Yolları to the 28 May hub, 355 m away (#721)", async () => {
    // Stops 1343 and 105 as AYNA places them, and a stop 449 m east of 1343 and 416 m
    // from 105, beyond a walk from either.
    db.queryStopDetails.mockResolvedValue([stop(1343, 40.376582, 49.848714), stop(105, 40.37937, 49.850749), stop(7, 40.376582, 49.854015)]);
    db.queryBusStops.mockResolvedValue([]);
    const g = await (await import('../graph')).getGraph();
    const walks = (id: number) => g.getEdges(id).filter(e => e.kind === 'walk' && !isMetroStation(e.toStopId));
    expect(walks(1343)).toEqual([expect.objectContaining({ toStopId: 105, distance: expect.closeTo(0.355, 3) })]);
    expect(walks(105).map(e => e.toStopId)).toEqual([1343]);
    expect(walks(7)).toEqual([]);
  });

  it('rebuilds walking connectivity without reading the legacy precomputed table', async () => {
    db.queryStopDetails.mockResolvedValue([stop(1, 40), stop(2, 40.001)]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getEdges(1)).toContainEqual(expect.objectContaining({ kind: 'walk', toStopId: 2 }));
    expect(g.getEdges(2)).toContainEqual(expect.objectContaining({ kind: 'walk', toStopId: 1 }));
    expect(db.queryWalkingEdges).not.toHaveBeenCalled();
  });

  it('adds the metro: its stations, its rides, and walks to a station from the stops by its exits (#689)', async () => {
    // A stop 50 m north of Koroğlu's exit at 40.421699, 49.916555 (metro.json).
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(3), stop(4, 40.422149, 49.916555)]);
    const g = await (await import('../graph')).getGraph();
    const stations = g.getAllStops().filter(s => isMetroStation(s.id));
    expect(stations).toHaveLength(27);
    const koroglu = stations.find(s => s.name === 'Koroğlu')!;
    expect(g.getEdges(4)).toContainEqual(expect.objectContaining({ kind: 'walk', toStopId: koroglu.id }));
    expect(g.getEdges(koroglu.id)).toContainEqual(expect.objectContaining({ kind: 'walk', toStopId: 4 }));
    expect(g.getEdges(koroglu.id).filter(e => e.kind === 'metro')).toHaveLength(2);
    // The bus network itself is as it was.
    expect(g.getEdges(1)).toEqual([expect.objectContaining({ kind: 'bus', toStopId: 2 })]);
  });

  it('routes by bus alone, and says so, when the metro cannot be added', async () => {
    vi.doMock('../metro', () => ({ metroNetwork: () => { throw new Error('metro.json unreadable'); } }));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const g = await (await import('../graph')).getGraph();
      expect(g.isBuilt()).toBe(true);
      expect(g.getAllStops().some(s => isMetroStation(s.id))).toBe(false);
      expect(g.getEdges(1)).toContainEqual(expect.objectContaining({ kind: 'bus', toStopId: 2 }));
      expect(quiet).toHaveBeenCalledWith(expect.stringContaining('metro not added'), expect.any(Error));
    } finally {
      vi.doUnmock('../metro');
    }
  });

  it('leaves the metro out rather than give a station the id of a stop', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.queryStopDetails.mockResolvedValue([stop(1), stop(2), stop(3), stop(METRO_STATION_ID_BASE + 1, 40.5)]);
    const g = await (await import('../graph')).getGraph();
    expect(g.getStopInfo(METRO_STATION_ID_BASE + 1)?.name).toBe(`Stop ${METRO_STATION_ID_BASE + 1}`);
    expect(g.getAllStops().filter(s => isMetroStation(s.id))).toHaveLength(1);
    expect(quiet).toHaveBeenCalled();
  });

  it('shares an in-flight build and never resolves a partial graph', async () => {
    let release!: (stops: ReturnType<typeof stop>[]) => void;
    db.queryStopDetails.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { getGraph } = await import('../graph');
    const first = getGraph(), second = getGraph();
    let resolved = false;
    void second.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(db.queryStopDetails).toHaveBeenCalledTimes(1);
    release([stop(1), stop(2), stop(3)]);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.isBuilt()).toBe(true);
  });

  it('retries with a fresh graph after a database failure', async () => {
    db.queryStopDetails.mockRejectedValueOnce(new Error('temporary outage'));
    const { getGraph } = await import('../graph');
    await expect(getGraph()).rejects.toThrow('temporary outage');
    const g = await getGraph();
    expect(g.isBuilt()).toBe(true);
    expect(g.getEdges(1)).toHaveLength(1);
    expect(db.queryStopDetails).toHaveBeenCalledTimes(2);
  });
});
