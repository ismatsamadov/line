import { describe, expect, it } from 'vitest';
import { haversine } from '../geo';
import { joinLegs, legPaths } from '../shape';
import type { LatLng } from '../types';

/** A street along one latitude, a point every 0.002° of longitude (about 170 m), as
 *  AYNA records a route line. */
const street = (lat: number, from: number, to: number): LatLng[] => {
  const points: LatLng[] = [];
  for (let lng = from; lng <= to + 1e-9; lng += 0.002) points.push([lat, Number(lng.toFixed(6))]);
  return points;
};
const km = (path: LatLng[]) => path.reduce((sum, p, i) => i ? sum + haversine(path[i - 1][0], path[i - 1][1], p[0], p[1]) : 0, 0);

// Three stops 50 m north of a street on latitude 40.40.
const stops: LatLng[] = [[40.40045, 49.801], [40.40045, 49.821], [40.40045, 49.841]];
const line = street(40.40, 49.80, 49.86);

describe('legPaths (#685)', () => {
  it('runs each leg along the line, from the foot of one stop to the next', () => {
    const legs = legPaths(stops, [line]);
    expect(legs).toHaveLength(2);
    expect(legs[0]![0][1]).toBeCloseTo(49.801, 4);
    expect(legs[0]![legs[0]!.length - 1][1]).toBeCloseTo(49.821, 4);
    expect(legs[0]).toContainEqual([40.40, 49.81]);
    expect(legs[1]![legs[1]!.length - 1][1]).toBeCloseTo(49.841, 4);
  });

  it('reads a line stored backwards in travel order', () => {
    const legs = legPaths(stops, [[...line].reverse()]);
    expect(legs[0]![0][1]).toBeCloseTo(49.801, 4);
    expect(legs[0]![legs[0]!.length - 1][1]).toBeCloseTo(49.821, 4);
  });

  it("takes the bus's other line when its own does not fit, as for 521's swapped one", () => {
    const swapped = line.map(([lat, lng]): LatLng => [lng, lat]);
    expect(legPaths(stops, [swapped])).toEqual([undefined, undefined]);
    expect(legPaths(stops, [swapped, line]).every(Boolean)).toBe(true);
  });

  it('keeps its own line on a tie unless another fits clearly closer, as a misfiled one does', () => {
    const own = street(40.3999, 49.80, 49.86);       // 61 m from the stops
    const slightly = street(40.4000, 49.80, 49.86);  // 50 m: not under 70% of 61
    expect(legPaths(stops, [own, slightly]).every((leg) => leg?.every(([lat]) => lat === 40.3999))).toBe(true);
    const clearly = street(40.4004, 49.80, 49.86);   // 5 m
    expect(legPaths(stops, [own, clearly]).every((leg) => leg?.every(([lat]) => lat === 40.4004))).toBe(true);
  });

  it('gives no road to two stops apart that meet at one point of the line, repeated or not', () => {
    // The line repeats its middle point, as 5,927 of the snapshot's segments do.
    const repeated: LatLng[] = [[40.40, 49.80], [40.40, 49.81], [40.40, 49.81], [40.40, 49.82]];
    expect(legPaths([[40.4002, 49.81], [40.3998, 49.81]], [repeated])).toEqual([undefined]);
  });

  it('gives no road to a leg across a jump in the line', () => {
    const broken = [...street(40.40, 49.80, 49.82), ...street(40.40, 49.90, 49.92)]; // 6.8 km straight
    const legs = legPaths([[40.40045, 49.801], [40.40045, 49.811], [40.40045, 49.911]], [broken]);
    expect(legs[0]).toBeDefined();
    expect(legs[1]).toBeUndefined();
  });

  it('keeps the stops in travel order around a loop', () => {
    // Out east along 40.400, up to 40.402 and back west: a stop between the two
    // streets belongs to the pass the travel order puts it on.
    const loop = [...street(40.400, 49.80, 49.84), ...street(40.402, 49.80, 49.84).reverse()];
    const legs = legPaths([[40.4002, 49.81], [40.4002, 49.83], [40.4018, 49.81]], [loop]);
    expect(legs[0]!.every(([lat]) => lat === 40.400)).toBe(true);
    expect(legs[1]).toContainEqual([40.400, 49.84]);
    expect(legs[1]).toContainEqual([40.402, 49.84]);
  });

  it('places a terminus past a loop without stops, not before it (114A)', () => {
    // The line starts at the terminus, loops 5.7 km away and back, then sets off: the
    // terminus stands by both ends of the loop.
    const loop: LatLng[] = [...street(40.400, 49.80, 49.83), ...street(40.403, 49.80, 49.83).reverse(), [40.4004, 49.80]];
    const legs = legPaths([[40.4002, 49.8001], [40.4006, 49.82]], [[...loop, ...street(40.4004, 49.802, 49.86)]]);
    expect(km(legs[0]!)).toBeLessThan(2.5);
  });

  it('leaves both legs of a stop without coordinates straight', () => {
    expect(legPaths([stops[0], undefined, stops[2]], [line])).toEqual([undefined, undefined]);
  });
});

describe('joinLegs', () => {
  it('joins the roads, straight to the next stop where a leg has none', () => {
    const legs = legPaths(stops, [street(40.40, 49.80, 49.825)]); // the line ends before the last stop
    expect(legs[1]).toBeUndefined();
    const path = joinLegs(stops, legs)!;
    expect(path.slice(0, legs[0]!.length)).toEqual(legs[0]);
    expect(path.slice(-2)).toEqual([stops[1], stops[2]]);
  });

  it('is undefined when no leg has a road, so the stops are joined as before', () => {
    expect(joinLegs(stops, [undefined, undefined])).toBeUndefined();
  });
});
