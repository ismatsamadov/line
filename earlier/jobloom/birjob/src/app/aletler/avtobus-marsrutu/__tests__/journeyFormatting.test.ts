import { describe, expect, it } from 'vitest';
import type { RouteSegment } from '@/lib/busroute/types';
import { movementMinutes, travelledStopCount } from '../journeyFormatting';

describe('passenger journey quantities', () => {
  it('does not display positive walking or movement time as zero minutes', () => {
    expect(movementMinutes(0.3)).toBe(1);
    expect(movementMinutes(0.01)).toBe(1);
    expect(movementMinutes(0)).toBe(0);
    expect(movementMinutes(5.6)).toBe(6);
  });

  it('counts stops travelled after boarding, including a later return to the same stop', () => {
    const stop = (id: number) => ({ id, name: `Stop ${id}`, latitude: 40.4, longitude: 49.8 });
    const ride: RouteSegment = { busId: 1, busNumber: '88', mode: 'bus', direction: 1, headsign: 'Terminus', distance: 1, time: 4, stops: [stop(1), stop(2)] };
    expect(travelledStopCount(ride)).toBe(1);
    expect(travelledStopCount({ ...ride, stops: [stop(1), stop(2), stop(1)] })).toBe(2);
    expect(travelledStopCount({ ...ride, mode: 'metro', stops: [stop(1), stop(2), stop(3)] })).toBe(2);
    expect(travelledStopCount({ ...ride, stops: [] })).toBe(0);
  });
});
