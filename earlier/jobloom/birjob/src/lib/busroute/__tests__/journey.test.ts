import { describe, expect, it } from 'vitest';
import { findJourney, findRoute, MAX_WALK_INSTEAD_MIN, MAX_WALK_ONLY_KM } from '../routing';
import { ACCESS_RADIUS_KM, accessWalks } from '../access';
import { haversine, WALK_DETOUR, WALK_RADIUS_KM, walkMinutes } from '../geo';
import { DESTINATION_POINT_ID, ORIGIN_POINT_ID, type LatLng } from '../types';
import { graph, ride, train, walk } from './fixtures';

// Points on one meridian, `km` north of 40.3° N, 49.8° E: inside Baku, where the
// planner's area is, and easy to measure.
const KM_PER_DEGREE = haversine(40, 49.8, 41, 49.8);
const north = (km: number): LatLng => [40.3 + km / KM_PER_DEGREE, 49.8];
const point = (km: number, name: string) => ({ latitude: north(km)[0], longitude: north(km)[1], name });
const ids = (route: { segments: Array<{ stops: Array<{ id: number }> }> } | null) => route?.segments.map(s => s.stops.map(p => p.id));
const modes = (route: { segments: Array<{ mode: string }> } | null) => route?.segments.map(s => s.mode);

describe('accessWalks: the stops and stations a point walks to (#720)', () => {
  // 1 boards, 2 is only alighted at, 3 is beyond the radius, 4 no line stops at.
  const g = graph({ 1: [ride(5, 10)], 3: [ride(2, 20)] }, [1, 2, 3, 4, 5], {
    at: { 1: north(0.1), 2: north(0.3), 3: north(1.2), 4: north(0.05), 5: north(9) },
  });
  const O = point(0, 'O');

  it('keeps the stops a ride leaves from at the origin, and those a ride reaches at the destination', () => {
    expect(accessWalks(g, O, 'origin').map(w => w.stopId)).toEqual([1]);
    expect(accessWalks(g, O, 'destination').map(w => w.stopId)).toEqual([2]);
    expect(accessWalks(g, O, 'origin')[0].distance).toBeCloseTo(0.1, 9);
  });

  it('takes a stop at exactly the radius, and none beyond it', () => {
    const exactly = haversine(...north(0), ...north(0.1));
    expect(accessWalks(g, O, 'origin', { radiusKm: exactly }).map(w => w.stopId)).toEqual([1]);
    expect(accessWalks(g, O, 'origin', { radiusKm: exactly - 1e-12 })).toEqual([]);
  });

  it('takes the nearest first, within the radius and up to the limit', () => {
    expect(ACCESS_RADIUS_KM).toBe(1);
    expect(accessWalks(g, O, 'origin', { radiusKm: 1.3 }).map(w => w.stopId)).toEqual([1, 3]);
    expect(accessWalks(g, O, 'origin', { radiusKm: 1.3, limit: 1 }).map(w => w.stopId)).toEqual([1]);
    expect(accessWalks(g, point(5, 'far'), 'origin')).toEqual([]);
  });

  it('measures a walk to a metro station to its nearest exit', () => {
    const exit: LatLng = [north(0.3)[0], 49.8001];
    const metro = graph({ 1_000_001: [train(1_000_002, 1)] }, undefined, {
      at: { 1_000_001: north(0.6), 1_000_002: north(5) }, exits: { 1_000_001: [[north(0.9)[0], 49.8], exit] },
    });
    const [station] = accessWalks(metro, point(0, 'O'), 'origin');
    expect(station).toEqual({ stopId: 1_000_001, distance: haversine(...north(0), ...exit), exit });
  });
});

describe('a journey from and to a point (#720)', () => {
  // Stop 1 is 100 m from the origin, stop 2 500 m; stop 3 is 100 m from the destination
  // and stop 4 is on the way, too far from either point to walk to.
  const at = { 1: north(0.1), 2: north(0.5), 3: north(5.1), 4: north(3) };
  const O = point(0, 'Gənclik Mall'), D = point(5.2, 'Kitabxana');

  it('boards where the whole journey is cheapest, not at the nearest stop', () => {
    // From 1: two buses, 20 minutes. From 2: one bus of 15 minutes, 400 m more on foot.
    const g = graph({ 1: [ride(4, 10, 10)], 4: [ride(3, 20, 10)], 2: [ride(3, 30, 15)] }, undefined, { at });
    const { route } = findJourney(g, O, D);
    expect(ids(route)).toEqual([[ORIGIN_POINT_ID, 2], [2, 3], [3, DESTINATION_POINT_ID]]);
    expect(modes(route)).toEqual(['walk', 'bus', 'walk']);
    // The walks count: 500 m and 100 m, 8.7 and 1.7 minutes on their streets, and their
    // straight-line distance.
    expect(route).toMatchObject({ totalTime: 25.4, totalDistance: 1.6, totalTransfers: 0, totalStops: 2 });
    expect(route!.segments[0]).toMatchObject({ distance: expect.closeTo(0.5, 9), time: expect.closeTo(8.67, 2) });
    expect(route!.segments[0].stops[0]).toEqual({ id: ORIGIN_POINT_ID, name: 'Gənclik Mall', latitude: O.latitude, longitude: O.longitude });
    expect(route!.segments[2].stops[1]).toEqual({ id: DESTINATION_POINT_ID, name: 'Kitabxana', latitude: D.latitude, longitude: D.longitude });
    // The nearest stop's two buses win once the direct bus is slow enough: 53.5 against 65.4.
    const slow = graph({ 1: [ride(4, 10, 10)], 4: [ride(3, 20, 10)], 2: [ride(3, 30, 40)] }, undefined, { at });
    expect(ids(findJourney(slow, O, D).route)).toEqual([[ORIGIN_POINT_ID, 1], [1, 4], [4, 3], [3, DESTINATION_POINT_ID]]);
  });

  it('starts at a stop and ends at a point, or the other way round', () => {
    const g = graph({ 2: [ride(3, 30, 15)] }, undefined, { at });
    expect(ids(findJourney(g, { stopId: 2 }, D).route)).toEqual([[2, 3], [3, DESTINATION_POINT_ID]]);
    expect(ids(findJourney(g, O, { stopId: 3 }).route)).toEqual([[ORIGIN_POINT_ID, 2], [2, 3]]);
  });

  it('routes between two stops exactly as findRoute does', () => {
    const g = graph({ 1: [ride(4, 10, 10), walk(2, 0.4)], 4: [ride(3, 20, 10)], 2: [ride(3, 30, 15)] }, undefined, { at });
    expect(findJourney(g, { stopId: 1 }, { stopId: 3 })).toEqual({ route: findRoute(g, 1, 3) });
  });

  it('walks up to the radius to a stop, further than a walk between two stops', () => {
    const g = graph({ 1: [ride(3, 10)] }, undefined, { at: { ...at, 1: north(0.9) } });
    const { route } = findJourney(g, O, D);
    expect(ids(route)).toEqual([[ORIGIN_POINT_ID, 1], [1, 3], [3, DESTINATION_POINT_ID]]);
    expect(route!.segments[0].distance).toBeGreaterThan(WALK_RADIUS_KM);
  });

  it('never walks on from the stop it walked to, or to the stop it walks from', () => {
    // Stop 5, beyond the radius, is a walk from stop 1 and has the only bus on.
    const onward = graph({ 1: [ride(9, 10), walk(5, 0.3)], 5: [ride(3, 20)] }, undefined, {
      at: { ...at, 1: north(0.9), 5: north(1.2), 9: north(20) },
    });
    expect(findJourney(onward, O, D)).toEqual({ route: null });
    // Stop 6, beyond the radius of the destination, is a walk from stop 7 near it.
    const before = graph({ 2: [ride(6, 10)], 6: [walk(7, 0.3)], 8: [ride(7, 30)] }, undefined, {
      at: { ...at, 6: north(4), 7: north(4.3), 8: north(30) },
    });
    expect(findJourney(before, O, D)).toEqual({ route: null });
  });

  it('walks to a metro station by its exit, and from one by its exit', () => {
    const exitIn: LatLng = [north(0.3)[0], 49.8001], exitOut: LatLng = [north(5.05)[0], 49.8001];
    const g = graph({ 1_000_001: [train(1_000_002, 1, 8)] }, undefined, {
      at: { 1_000_001: north(0.6), 1_000_002: north(4.8) }, exits: { 1_000_001: [exitIn], 1_000_002: [exitOut] },
    });
    const { route } = findJourney(g, O, D);
    expect(modes(route)).toEqual(['walk', 'metro', 'walk']);
    expect(route!.segments[0].path).toEqual([north(0), exitIn, north(0.6)]);
    expect(route!.segments[0].distance).toBeCloseTo(haversine(...north(0), ...exitIn), 9);
    expect(route!.segments[2].path).toEqual([north(4.8), exitOut, north(5.2)]);
  });
});

describe('walking the whole way (#720)', () => {
  // Stop 1 is 50 m from the origin and stop 2 50 m from the destination, 1.5 km on.
  const near = (minutes: number, km = 1.5) => graph({ 1: [ride(2, 10, minutes)] }, undefined, { at: { 1: north(0.05), 2: north(km - 0.05) } });
  const O = point(0, 'O');

  it('times every walk on its streets, 1.3 times its straight line at 4.5 km/h', () => {
    expect(WALK_DETOUR).toBe(1.3);
    expect(walkMinutes(1.5)).toBeCloseTo(26, 9);
  });

  it('walks when that costs no more than every journey that rides', () => {
    // On foot 26 minutes; the bus 0.9 + 9 + 0.9 minutes and a boarding, 25.7.
    expect(modes(findJourney(near(9), O, point(1.5, 'D')).route)).toEqual(['walk', 'bus', 'walk']);
    // A bus of 10 minutes costs 26.7.
    const { route } = findJourney(near(10), O, point(1.5, 'D'));
    expect(ids(route)).toEqual([[ORIGIN_POINT_ID, DESTINATION_POINT_ID]]);
    expect(route).toMatchObject({ totalTime: 26, totalDistance: 1.5, totalTransfers: 0, totalStops: 0 });
    expect(route!.segments[0]).toMatchObject({ mode: 'walk', busId: -1 });
    expect(route!.segments[0].path).toBeUndefined();
  });

  it('walks on a tie with a journey that rides', () => {
    // The stops stand on the points, so the journey that rides costs its bus and a
    // boarding exactly: the walk's 26 minutes, to the last bit.
    const walk = walkMinutes(haversine(...north(0), ...north(1.5)));
    const tie = graph({ 1: [ride(2, 10, walk - 15)] }, undefined, { at: { 1: north(0), 2: north(1.5) } });
    expect(walk - 15 + 15).toBe(walk);
    const { route } = findJourney(tie, O, point(1.5, 'D'));
    expect(modes(route)).toEqual(['walk']);
    expect(route!.totalTime).toBe(26);
  });

  it('walks without searching when the walk costs less than a boarding', () => {
    const g = near(0, 1.2);
    const searched: number[] = [];
    const spy = { ...g, getEdges: (id: number) => { searched.push(id); return g.getEdges(id); } };
    // Which stops serve a ride is worked out once per graph; the search is what is left.
    accessWalks(spy, O, 'origin');
    searched.length = 0;
    // 850 m takes 14.7 minutes on foot: no journey that rides can cost less.
    expect(walkMinutes(0.85)).toBeLessThan(15);
    expect(modes(findJourney(spy, O, point(0.85, 'D')).route)).toEqual(['walk']);
    expect(searched).toEqual([]);
    // 880 m takes 15.3, more than a boarding: the bus is weighed, and loses at 16.5.
    expect(modes(findJourney(spy, O, point(0.88, 'D')).route)).toEqual(['walk']);
    expect(searched).toContain(1);
  });

  it('walks where nothing rides or the ride is slower, up to its limit, and past half an hour loses to a faster ride', () => {
    expect(MAX_WALK_ONLY_KM).toBe(2);
    expect(MAX_WALK_INSTEAD_MIN).toBe(30);
    const none = graph({}, []);
    expect(modes(findJourney(none, O, point(1.9, 'D')).route)).toEqual(['walk']);
    expect(findJourney(none, O, point(2.1, 'D'))).toEqual({ route: null, stranded: 'origin' });
    // 1.9 km takes 32.9 minutes on foot. A bus of 20 minutes, 21.7 with its walks, is
    // faster before its wait, and is the answer though it costs 36.7 with its boarding.
    expect(modes(findJourney(near(20, 1.9), O, point(1.9, 'D')).route)).toEqual(['walk', 'bus', 'walk']);
    expect(modes(findJourney(near(20, 1.9), O, point(1.9, 'D'), { walkInsteadMin: 33 }).route)).toEqual(['walk']);
    // A bus of 40 minutes is slower than the walk even before its wait.
    expect(modes(findJourney(near(40, 1.9), O, point(1.9, 'D')).route)).toEqual(['walk']);
    // Beyond 2 km the bus is the answer however slow.
    expect(modes(findJourney(near(40, 2.5), O, point(2.5, 'D')).route)).toEqual(['walk', 'bus', 'walk']);
  });

  it('walks rather than ride three buses for longer than the walk takes', () => {
    // As from 40.59678, 49.66272 to 40.57931, 49.66120: on foot 33.8 minutes, and the
    // journey that rides took three buses and 102.1.
    const D = point(1.95, 'D');
    const g = graph({ 1: [ride(3, 1, 30)], 3: [ride(4, 2, 30)], 4: [ride(2, 3, 40)] }, undefined, {
      at: { 1: north(0.05), 2: north(1.9), 3: north(5), 4: north(-3) },
    });
    expect(walkMinutes(haversine(...north(0), ...north(1.95)))).toBeCloseTo(33.8, 1);
    const rides = findJourney(g, O, D, { walkOnlyKm: 0 }).route;
    expect(modes(rides)).toEqual(['walk', 'bus', 'bus', 'bus', 'walk']);
    expect(rides!.totalTime).toBeCloseTo(101.7, 9);
    expect(modes(findJourney(g, O, D).route)).toEqual(['walk']);
  });

  it('holds the walk the whole way to its limits, inclusive', () => {
    // At exactly the distance or the minutes a walk is allowed, it is offered.
    const km = haversine(...north(0), ...north(1.9));
    const none = graph({}, []);
    expect(modes(findJourney(none, O, point(1.9, 'D'), { walkOnlyKm: km }).route)).toEqual(['walk']);
    expect(findJourney(none, O, point(1.9, 'D'), { walkOnlyKm: km - 1e-9 }).route).toBeNull();
    const fast = near(20, 1.9);
    expect(modes(findJourney(fast, O, point(1.9, 'D'), { walkInsteadMin: walkMinutes(km) }).route)).toEqual(['walk']);
    expect(modes(findJourney(fast, O, point(1.9, 'D'), { walkInsteadMin: walkMinutes(km) - 1e-9 }).route)).toEqual(['walk', 'bus', 'walk']);
    // Past half an hour a ride exactly as fast as the walk loses to it, and one a hair
    // faster wins. The stops stand on the points, so the ride takes its bus's minutes.
    const onPoints = (minutes: number) => graph({ 1: [ride(2, 10, minutes)] }, undefined, { at: { 1: north(0), 2: north(1.9) } });
    expect(modes(findJourney(onPoints(walkMinutes(km)), O, point(1.9, 'D')).route)).toEqual(['walk']);
    expect(modes(findJourney(onPoints(walkMinutes(km) - 1e-9), O, point(1.9, 'D')).route)).toEqual(['walk', 'bus', 'walk']);
  });

  it('says which end has no stop within a walk, and nothing when the stops are not connected', () => {
    const g = graph({ 1: [ride(2, 10)], 2: [ride(9, 20)], 8: [ride(1, 30)] }, undefined, {
      at: { 1: north(0.1), 2: north(5), 8: north(-20), 9: north(30) },
    });
    expect(findJourney(g, O, point(9, 'D'))).toEqual({ route: null, stranded: 'destination' });
    expect(findJourney(g, point(-3, 'O'), point(5.1, 'D'))).toEqual({ route: null, stranded: 'origin' });
    // Both ends have a stop, but no ride goes from the one to the other.
    expect(findJourney(g, point(5.1, 'O'), point(0, 'D'))).toEqual({ route: null });
  });

  it('answers an end with no stop within a walk without searching (#743)', () => {
    // The network above: from stop 1, 100 m from O, a ride reaches 2 and then 9.
    const g = graph({ 1: [ride(2, 10)], 2: [ride(9, 20)], 8: [ride(1, 30)] }, undefined, {
      at: { 1: north(0.1), 2: north(5), 8: north(-20), 9: north(30) },
    });
    const searched: number[] = [];
    const spy = { ...g, getEdges: (id: number) => { searched.push(id); return g.getEdges(id); } };
    // Which stops serve a ride is worked out once per graph; the search is what is left.
    accessWalks(spy, O, 'origin');
    searched.length = 0;
    // The answers the search gave, from a point or a stop, to a point or a stop. With no
    // stop near the destination it searched from the origin through every stop it could
    // reach first.
    expect(findJourney(spy, O, point(9, 'D'))).toEqual({ route: null, stranded: 'destination' });
    expect(findJourney(spy, { stopId: 1 }, point(9, 'D'))).toEqual({ route: null, stranded: 'destination' });
    expect(findJourney(spy, point(-3, 'O'), point(5.1, 'D'))).toEqual({ route: null, stranded: 'origin' });
    expect(findJourney(spy, point(-3, 'O'), { stopId: 2 })).toEqual({ route: null, stranded: 'origin' });
    expect(findJourney(spy, point(-3, 'O'), point(9, 'D'))).toEqual({ route: null, stranded: 'origin' });
    // Within the walk the whole way, the walk: 1.7 km takes 29.5 minutes on foot.
    expect(walkMinutes(1.7)).toBeGreaterThan(15);
    expect(ids(findJourney(spy, O, point(1.7, 'D')).route)).toEqual([[ORIGIN_POINT_ID, DESTINATION_POINT_ID]]);
    expect(ids(findJourney(spy, point(8.2, 'O'), point(9.9, 'D')).route)).toEqual([[ORIGIN_POINT_ID, DESTINATION_POINT_ID]]);
    expect(searched).toEqual([]);
    // With a stop at each end, the search runs.
    expect(modes(findJourney(spy, O, point(5.1, 'D')).route)).toEqual(['walk', 'bus', 'walk']);
    expect(searched).toContain(1);
  });

  it('puts the walk beside a journey that rides, when the walk takes half an hour or less (#743)', () => {
    // On foot 26 minutes; the bus 0.9 + 9 + 0.9 and a boarding costs 25.7, and is the answer.
    const journey = findJourney(near(9), O, point(1.5, 'D'));
    expect(modes(journey.route)).toEqual(['walk', 'bus', 'walk']);
    expect(ids(journey.alternative ?? null)).toEqual([[ORIGIN_POINT_ID, DESTINATION_POINT_ID]]);
    expect(journey.alternative).toMatchObject({ totalTime: 26, totalDistance: 1.5, totalTransfers: 0 });
    // 1.9 km takes 32.9 minutes on foot, more than half an hour: the faster bus alone.
    const far = findJourney(near(20, 1.9), O, point(1.9, 'D'));
    expect(modes(far.route)).toEqual(['walk', 'bus', 'walk']);
    expect(far).not.toHaveProperty('alternative');
  });

  it('puts the cheapest journey that rides beside the walk, when it is faster before any wait (#743)', () => {
    // A bus of 10 minutes costs 26.7 with its boarding, against the walk's 26: the walk is
    // the answer, and the bus, 11.7 minutes before its wait, stands beside it.
    const journey = findJourney(near(10), O, point(1.5, 'D'));
    expect(modes(journey.route)).toEqual(['walk']);
    expect(modes(journey.alternative ?? null)).toEqual(['walk', 'bus', 'walk']);
    expect(journey.alternative!.totalTime).toBe(11.7);
    // A bus no faster than the walk, even before its wait, is no alternative.
    expect(walkMinutes(0.05) * 2 + 25).toBeGreaterThan(26);
    expect(findJourney(near(25), O, point(1.5, 'D'))).not.toHaveProperty('alternative');
    expect(findJourney(near(40, 1.9), O, point(1.9, 'D'))).not.toHaveProperty('alternative');
    // Nor is there one where nothing rides.
    expect(findJourney(graph({}, []), O, point(1.9, 'D'))).not.toHaveProperty('alternative');
  });

  it('puts nothing beside a walk of a quarter of an hour or less, which no journey that rides can beat (#743)', () => {
    expect(walkMinutes(0.85)).toBeLessThan(15);
    expect(findJourney(near(0, 1.2), O, point(0.85, 'D'))).toEqual({ route: expect.anything() });
  });

  it('on one bus line, walks or rides by the rule for the walk, on every walk around the half hour (#743)', () => {
    // The search no longer stops at the walk's cost. On networks of several lines the
    // answers are checked against an independent oracle (routingOracle.test.ts).
    for (const km of [0.9, 1.2, 1.5, 1.7, 1.73, 1.8, 1.95]) {
      for (const minutes of [0, 5, 9, 10, 12, 20, 25, 40]) {
        const walk = walkMinutes(haversine(...north(0), ...north(km)));
        const ride = walkMinutes(0.05) * 2 + minutes;
        const competes = walk <= MAX_WALK_INSTEAD_MIN;
        const expected = competes ? (ride + 15 < walk ? 'ride' : 'walk') : (ride < walk ? 'ride' : 'walk');
        const got = modes(findJourney(near(minutes, km), O, point(km, 'D')).route);
        expect(got?.length === 1 ? 'walk' : 'ride', `${km} km, a bus of ${minutes} minutes`).toBe(walk <= 15 ? 'walk' : expected);
      }
    }
  });

  it('between two stops, puts the walk between them beside the ride when they are a short walk apart (#743)', () => {
    const between = (km: number) => graph({ 1: [ride(2, 10, 5)] }, undefined, { at: { 1: north(0), 2: north(km) } });
    const short = findJourney(between(1.2), { stopId: 1 }, { stopId: 2 });
    // The answer is findRoute's as ever.
    expect(short.route).toEqual(findRoute(between(1.2), 1, 2));
    expect(ids(short.alternative ?? null)).toEqual([[1, 2]]);
    expect(short.alternative).toMatchObject({ totalTime: walkMinutes(1.2), totalTransfers: 0 });
    expect(short.alternative!.segments[0]).toMatchObject({ mode: 'walk', busId: -1 });
    // The bus costs 5 minutes and a boarding, 20, and the walk of 1.2 km 20.8: the ride is
    // the cheaper. 600 m apart, the walk of 10.4 minutes costs less than the ride, which
    // findRoute still answers with, walking only within 400 m; the page then calls neither
    // recommended.
    expect(short).not.toHaveProperty('alternativeCostsNoMore');
    const nearer = findJourney(between(0.6), { stopId: 1 }, { stopId: 2 });
    expect(modes(nearer.route)).toEqual(['bus']);
    expect(nearer).toMatchObject({ alternative: { totalTime: walkMinutes(0.6) }, alternativeCostsNoMore: true });
    // 3 km apart, the walk takes 52 minutes; 300 m apart, the walk is the answer.
    expect(findJourney(between(3), { stopId: 1 }, { stopId: 2 })).not.toHaveProperty('alternative');
    const close = graph({ 1: [ride(2, 10, 5), walk(2, 0.3)] }, undefined, { at: { 1: north(0), 2: north(0.3) } });
    const walked = findJourney(close, { stopId: 1 }, { stopId: 2 });
    expect(modes(walked.route)).toEqual(['walk']);
    expect(walked).not.toHaveProperty('alternative');
  });

  it('keeps an end walk within the radius it was found in', () => {
    const edge = findJourney(near(3), O, point(1.5, 'D')).route!.segments[0];
    expect(edge.distance).toBeLessThanOrEqual(ACCESS_RADIUS_KM);
    const tooFar = graph({ 1: [ride(2, 10)] }, undefined, { at: { 1: north(1.01), 2: north(5) } });
    expect(findJourney(tooFar, O, point(5.1, 'D'))).toEqual({ route: null, stranded: 'origin' });
  });
});
