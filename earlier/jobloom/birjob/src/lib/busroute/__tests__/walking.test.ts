import { describe, expect, it } from 'vitest';
import { computeWalkingEdges } from '../walking';
import { haversine, WALK_RADIUS_KM } from '../geo';
import { stop } from './fixtures';

const keys = (edges: ReturnType<typeof computeWalkingEdges>) => edges.map(e => `${e.from_stop_id}:${e.to_stop_id}`).sort();
describe('walking connections', () => {
  it('does not depend on stop order or route membership', () => {
    const stops = [stop(1, 40), stop(2, 40.001), stop(3, 40.002)];
    expect(keys(computeWalkingEdges(stops))).toEqual(keys(computeWalkingEdges([...stops].reverse())));
    expect(keys(computeWalkingEdges(stops))).toEqual(['1:2', '1:3', '2:1', '2:3', '3:1', '3:2']);
  });

  it('connects across cell boundaries and excludes stops beyond a walk', () => {
    const edges = computeWalkingEdges([stop(1, 40.00399, 49.00499), stop(2, 40.00401, 49.00501), stop(3, 40.02)]);
    expect(keys(edges)).toEqual(['1:2', '2:1']);
    expect(edges[0].distance_km).toBeGreaterThan(0);
    expect(edges[0].time_min).toBeCloseTo(edges[0].distance_km / 4.5 * 60);
  });

  // Also at the network's northern edge (41.5° N), where a degree of longitude is
  // shortest and a grid cell narrowest.
  it.each([40.3, 41.47])('matches an exhaustive geographic oracle for a dense sample at %s° N', (latitude) => {
    const stops = Array.from({ length: 120 }, (_, i) => stop(i, latitude + (i * 37 % 120) * 0.0002, 49.8 + (i * 19 % 120) * 0.0002));
    const expected: string[] = [];
    for (const a of stops) for (const b of stops) if (a.id !== b.id
      && haversine(a.latitude, a.longitude, b.latitude, b.longitude) <= WALK_RADIUS_KM) expected.push(`${a.id}:${b.id}`);
    expect(keys(computeWalkingEdges(stops))).toEqual(expected.sort());
  });
});
