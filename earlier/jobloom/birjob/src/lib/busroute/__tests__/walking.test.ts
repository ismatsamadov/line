import { describe, expect, it } from 'vitest';
import { computeWalkingEdges } from '../walking';
import { haversine, isBakuCoordinate, MIN_KM_PER_DEGREE_LAT, MIN_KM_PER_DEGREE_LON, WALK_RADIUS_KM } from '../geo';
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

  // The cells are sized for the shortest degrees in the network's area, so a pair within
  // a walk is never more than one cell apart. Sized for 90 km a degree of longitude, the
  // grid dropped 4 of the snapshot's 8,295 pairs, and the dense samples below still
  // passed: none of their pairs straddles two cell edges (#721).
  it('sizes its cells for the shortest degrees anywhere in the network area', () => {
    expect(isBakuCoordinate(41.5, 49.8)).toBe(true);
    expect(isBakuCoordinate(41.51, 49.8)).toBe(false);
    expect(MIN_KM_PER_DEGREE_LON).toBeLessThanOrEqual(haversine(41.5, 49, 41.5, 50));
    expect(MIN_KM_PER_DEGREE_LAT).toBeLessThanOrEqual(haversine(39.5, 49.8, 40.5, 49.8));
    // A walk due east at the northern edge, from every offset across a cell.
    const degrees = WALK_RADIUS_KM * 0.9999 / haversine(41.5, 49, 41.5, 50);
    for (let k = 0; k < 100; k++) {
      const west = 49.8 + k * degrees / 50;
      expect(keys(computeWalkingEdges([stop(1, 41.5, west), stop(2, 41.5, west + degrees)]))).toEqual(['1:2', '2:1']);
    }
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
