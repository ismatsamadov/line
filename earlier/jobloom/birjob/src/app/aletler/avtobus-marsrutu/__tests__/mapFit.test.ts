import { describe, expect, it, vi } from 'vitest';
import type { BusLineDetail, RouteResult, StopDetail } from '@/lib/busroute/types';
import { fitFeatures, sizedFromZero, type FitTargets } from '../mapFit';

const stop = (id: number, latitude: number, longitude: number): StopDetail => ({
  id, code: '', name: `Stop ${id}`, latitude, longitude, is_transport_hub: false,
});
const fakeMap = () => ({ fitBounds: vi.fn(), setView: vi.fn() });
const none: FitTargets = { route: null, line: null, fromStop: null, toStop: null };

describe('sizedFromZero', () => {
  it('is true only for the resize that gives a 0×0 map its first size (#685)', () => {
    expect(sizedFromZero({ oldSize: { x: 0, y: 0 } })).toBe(true);
    expect(sizedFromZero({ oldSize: { x: 0, y: 640 } })).toBe(true);
    expect(sizedFromZero({ oldSize: { x: 390, y: 0 } })).toBe(true);
    // An ordinary window resize keeps whatever view the rider has panned to.
    expect(sizedFromZero({ oldSize: { x: 390, y: 640 } })).toBe(false);
  });
});

describe('fitFeatures', () => {
  it("fits a found route to every stop of every segment", () => {
    const map = fakeMap();
    const route = {
      segments: [
        { stops: [stop(1, 40.40, 49.80), stop(2, 40.41, 49.81)] },
        { stops: [stop(2, 40.41, 49.81), stop(3, 40.45, 49.90)] },
      ],
    } as unknown as RouteResult;
    fitFeatures(map, { ...none, route, fromStop: stop(1, 40.40, 49.80), toStop: stop(3, 40.45, 49.90) });
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[40.40, 49.80], [40.41, 49.81], [40.41, 49.81], [40.45, 49.90]], { padding: [50, 50] });
    expect(map.setView).not.toHaveBeenCalled();
  });

  it('takes in the road a ride follows, which can bend beyond its stops (#685)', () => {
    const map = fakeMap();
    const route = {
      segments: [{ stops: [stop(1, 40.40, 49.80), stop(2, 40.41, 49.80)], path: [[40.40, 49.80], [40.405, 49.83], [40.41, 49.80]] }],
    } as unknown as RouteResult;
    fitFeatures(map, { ...none, route });
    expect(map.fitBounds).toHaveBeenCalledWith([[40.40, 49.80], [40.405, 49.83], [40.41, 49.80]], { padding: [50, 50] });
  });

  it('fits a line to its road shape, or to its stops when it has none', () => {
    const shaped = fakeMap();
    const coordinates = [{ latitude: 40.4, longitude: 49.8 }, { latitude: 40.5, longitude: 49.9 }];
    fitFeatures(shaped, { ...none, line: { coordinates, stops: [stop(1, 40, 49)] } as unknown as BusLineDetail });
    expect(shaped.fitBounds).toHaveBeenCalledWith([[40.4, 49.8], [40.5, 49.9]], { padding: [50, 50] });

    const bare = fakeMap();
    fitFeatures(bare, { ...none, line: { coordinates: [], stops: [stop(1, 40, 49), stop(2, 41, 50)] } as unknown as BusLineDetail });
    expect(bare.fitBounds).toHaveBeenCalledWith([[40, 49], [41, 50]], { padding: [50, 50] });
  });

  it('fits both chosen stops before a route arrives, and centres on a single one', () => {
    const both = fakeMap();
    fitFeatures(both, { ...none, fromStop: stop(1, 40.4, 49.8), toStop: stop(2, 40.5, 49.9) });
    expect(both.fitBounds).toHaveBeenCalledWith([[40.4, 49.8], [40.5, 49.9]], { padding: [60, 60] });

    const one = fakeMap();
    fitFeatures(one, { ...none, fromStop: stop(1, 40.4, 49.8) });
    expect(one.setView).toHaveBeenCalledWith([40.4, 49.8], 15);
  });

  it('leaves the view alone with nothing chosen', () => {
    const map = fakeMap();
    fitFeatures(map, none);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).not.toHaveBeenCalled();
  });
});
