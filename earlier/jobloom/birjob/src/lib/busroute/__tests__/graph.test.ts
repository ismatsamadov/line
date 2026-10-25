import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, busStop, stop } from './fixtures';
import { isMetroStation, METRO_STATION_ID_BASE } from '../types';

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
    expect(rides(1)).toEqual([expect.objectContaining({ toStopId: 2, fromSequence: 0, toSequence: 1, headsign: 'Stop 3', time: 15 })]);
    expect(rides(2)).toEqual([expect.objectContaining({ toStopId: 3, fromSequence: 1, toSequence: 2, time: 15 })]);
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
