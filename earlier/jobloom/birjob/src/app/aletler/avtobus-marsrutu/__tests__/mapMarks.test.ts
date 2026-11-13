import { describe, expect, it } from 'vitest';
import type { BusLineStop, RouteResult, RouteSegment } from '@/lib/busroute/types';
import { markedLineStops, markedStopIds } from '../mapMarks';

const at = (id: number, misplaced?: true): RouteSegment['stops'][number] =>
  ({ id, name: `Stop ${id}`, latitude: 40.4 + id / 1000, longitude: 49.8, ...(misplaced ? { misplaced } : {}) });
const ride = (...stops: RouteSegment['stops']): RouteSegment =>
  ({ busId: 10, busNumber: '10', mode: 'bus', direction: 2, headsign: 'T', stops, distance: 1, time: 1 });
const route = (...segments: RouteSegment[]) => ({ segments, totalDistance: 1, totalTime: 1, totalTransfers: 0, totalStops: 1 }) as RouteResult;

describe('markedStopIds (#743)', () => {
  it('marks every stop a journey lists but a misplaced one it rides past', () => {
    // As 537's second direction past 3841: listed, but stored 2.4 km off the drawn ride.
    expect([...markedStopIds(route(ride(at(1635), at(3841, true), at(1421), at(2046))))]).toEqual([1635, 1421, 2046]);
  });

  it('keeps the marker of a misplaced stop the journey also goes to, where it is stored', () => {
    // Passed on one ride, boarded on the next: the journey does go where it is stored.
    const passedThenBoarded = route(ride(at(1), at(3, true), at(4)), { ...ride(at(4), at(5)), busId: 20 }, { ...ride(at(5), at(3)), busId: 30 });
    expect(markedStopIds(passedThenBoarded).has(3)).toBe(true);
  });
});

const lineStop = (id: number, misplaced?: true): BusLineStop =>
  ({ id, code: String(id), name: `Stop ${id}`, latitude: 40.4 + id / 1000, longitude: 49.8, is_transport_hub: false, ...(misplaced ? { misplaced } : {}) });

describe('markedLineStops (#743)', () => {
  it('marks the stops between the two ends, but a misplaced one the line runs past', () => {
    // As 537's second direction: 3841, its second stop, stored 2.4 km off the line.
    const stops = [lineStop(1635), lineStop(3841, true), lineStop(1421), lineStop(2046), lineStop(2486)];
    expect(markedLineStops({ stops }).map((stop) => stop.id)).toEqual([1421, 2046]);
    // Unflagged, every stop between the ends has its dot.
    expect(markedLineStops({ stops: stops.map(({ misplaced: _, ...stop }) => stop) }).map((stop) => stop.id)).toEqual([3841, 1421, 2046]);
  });

  it('leaves the ends to their pins, and a line of one or two stops without dots', () => {
    expect(markedLineStops({ stops: [] })).toEqual([]);
    expect(markedLineStops({ stops: [lineStop(1)] })).toEqual([]);
    expect(markedLineStops({ stops: [lineStop(1), lineStop(2)] })).toEqual([]);
  });
});
