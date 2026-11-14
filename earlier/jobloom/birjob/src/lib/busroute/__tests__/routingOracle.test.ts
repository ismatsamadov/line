import { describe, expect, it } from 'vitest';
import { BOARDING_PENALTY_MIN, findJourney, findRoute, MAX_WALK_INSTEAD_MIN, MAX_WALK_ONLY_KM } from '../routing';
import { ACCESS_RADIUS_KM } from '../access';
import { haversine } from '../geo';
import type { GraphEdge, LatLng } from '../types';
import { graph, ride, train, walk } from './fixtures';

type Cost = [minutes: number, walking: number, distance: number];
type Line = { stops: number[]; legs: GraphEdge[] };
const compare = (a: Cost, b: Cost) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function keep(best: Map<number, Cost>, id: number, cost: Cost) {
  const previous = best.get(id);
  if (!previous || compare(cost, previous) < 0) best.set(id, cost);
}

/** A different model from the production edge/state Dijkstra: in round n, board
 * any line once, ride any contiguous stretch, then optionally walk once. Every
 * round adds exactly one boarding, so round n holds the best journey with n
 * boardings, compared on all three costs, including origin walks. The journey to
 * choose is the round with the lowest minutes plus n boarding penalties (#721),
 * the earliest on a tie. */
function rounds(lines: Line[], walks: Map<number, GraphEdge[]>, from: number, to: number) {
  const withWalk = (arrivals: Map<number, Cost>) => {
    const result = new Map(arrivals);
    for (const [at, cost] of arrivals) for (const edge of walks.get(at) ?? []) {
      keep(result, edge.toStopId, [cost[0] + edge.time, cost[1] + edge.distance, cost[2] + edge.distance]);
    }
    return result;
  };
  let previous = withWalk(new Map([[from, [0, 0, 0] as Cost]]));
  if (previous.has(to)) return { boardings: 0, cost: previous.get(to)! };
  const seen = new Set(previous.keys());
  let best: { boardings: number; cost: Cost } | null = null;
  const score = (journey: { boardings: number; cost: Cost }) => journey.cost[0] + journey.boardings * BOARDING_PENALTY_MIN;
  // A journey with n boardings costs at least n penalties, so later rounds cannot win.
  for (let boardings = 1; !best || boardings * BOARDING_PENALTY_MIN <= score(best); boardings++) {
    const arrivals = new Map<number, Cost>();
    for (const line of lines) for (let i = 0; i < line.legs.length; i++) {
      const start = previous.get(line.stops[i]);
      if (!start) continue;
      let minutes = start[0], distance = start[2];
      for (let j = i; j < line.legs.length; j++) {
        minutes += line.legs[j].time;
        distance += line.legs[j].distance;
        keep(arrivals, line.stops[j + 1], [minutes, start[1], distance]);
      }
    }
    previous = withWalk(arrivals);
    // A round that reaches no stop the earlier rounds missed never will.
    if (!best && [...previous.keys()].every(id => seen.has(id))) break;
    for (const id of previous.keys()) seen.add(id);
    const arrival = previous.get(to);
    if (arrival && (!best || score({ boardings, cost: arrival }) < score(best))) best = { boardings, cost: arrival };
  }
  return best;
}

/** The same rounds between two points (#720). Round one boards at a stop the origin
 * walks to, at that walk's cost and with no other walk before it; a journey ends with
 * a ride to a stop the destination is walked to from, and that walk, never a walk
 * before it. Walking the whole way is the answer within MAX_WALK_INSTEAD_MIN when it
 * costs no more than the cheapest round, and within MAX_WALK_ONLY_KM when no round
 * reaches the destination or the cheapest takes no fewer minutes. */
function roundsBetweenPoints(lines: Line[], walks: Map<number, GraphEdge[]>, access: Map<number, Cost>, egress: Map<number, Cost>, onFoot: Cost) {
  const withWalk = (arrivals: Map<number, Cost>) => {
    const result = new Map(arrivals);
    for (const [at, cost] of arrivals) for (const edge of walks.get(at) ?? []) {
      keep(result, edge.toStopId, [cost[0] + edge.time, cost[1] + edge.distance, cost[2] + edge.distance]);
    }
    return result;
  };
  let previous = new Map(access);
  let best: { boardings: number; cost: Cost } | null = null;
  const score = (journey: { boardings: number; cost: Cost }) => journey.cost[0] + journey.boardings * BOARDING_PENALTY_MIN;
  // Six stops, each reached by a ride or by a walk: a journey with the fewest boardings
  // to anywhere boards at most twelve times.
  for (let boardings = 1; best ? boardings * BOARDING_PENALTY_MIN <= score(best) : boardings <= 12; boardings++) {
    const arrivals = new Map<number, Cost>();
    for (const line of lines) for (let i = 0; i < line.legs.length; i++) {
      const start = previous.get(line.stops[i]);
      if (!start) continue;
      let minutes = start[0], distance = start[2];
      for (let j = i; j < line.legs.length; j++) {
        minutes += line.legs[j].time;
        distance += line.legs[j].distance;
        keep(arrivals, line.stops[j + 1], [minutes, start[1], distance]);
      }
    }
    const ends = new Map<number, Cost>();
    for (const [id, walk] of egress) {
      const ride = arrivals.get(id);
      if (ride) keep(ends, 0, [ride[0] + walk[0], ride[1] + walk[1], ride[2] + walk[2]]);
    }
    const arrival = ends.get(0);
    if (arrival && (!best || score({ boardings, cost: arrival }) < score(best))) best = { boardings, cost: arrival };
    previous = withWalk(arrivals);
  }
  const [minutes, km] = onFoot;
  if (km > MAX_WALK_ONLY_KM) return best;
  if (!best || best.cost[0] >= minutes) return { boardings: 0, cost: onFoot };
  return minutes <= MAX_WALK_INSTEAD_MIN && minutes <= score(best) ? { boardings: 0, cost: onFoot } : best;
}

/** The fewest boardings that reach `to` at all: rounds without costs. */
function fewestBoardings(lines: Line[], walks: Map<number, GraphEdge[]>, from: number, to: number) {
  const onFoot = (stops: Set<number>) => new Set([...stops, ...[...stops].flatMap(id => (walks.get(id) ?? []).map(e => e.toStopId))]);
  let reached = onFoot(new Set([from]));
  for (let boardings = 1; ; boardings++) {
    const next = new Set<number>();
    for (const line of lines) line.stops.forEach((stop, i) => {
      if (reached.has(stop)) for (const id of line.stops.slice(i + 1)) next.add(id);
    });
    const after = onFoot(next);
    if (after.has(to)) return boardings;
    if ([...after].every(id => reached.has(id))) return null;
    reached = new Set([...reached, ...after]);
  }
}

describe('routing against an independent boarding-round cost oracle', () => {
  it('agrees on boardings, movement time, walking and distance with loops, buses, metro and walking interchanges', () => {
    let seed = 20261026, chosenMoreThanFewest = 0;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let network = 0; network < 30; network++) {
      const edges: Record<number, GraphEdge[]> = {};
      const lines = Array.from({ length: 4 }, (_, i): Line => {
        const stops = Array.from({ length: 3 + random(3) }, () => 1 + random(6));
        const legs = stops.slice(1).map((to, sequence) => (i % 2 ? train : ride)(to, i + 1, 1 + random(30), 1 + random(5), sequence));
        legs.forEach((leg, sequence) => (edges[stops[sequence]] ??= []).push(leg));
        return { stops, legs };
      });
      const walks = new Map<number, GraphEdge[]>();
      for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) {
        if (random(5) !== 0) continue;
        // Binary-exact lengths make equal-cost tie cases independent of addition order.
        const distance = random(2) ? 0.125 : 0.25;
        for (const [from, to] of [[a, b], [b, a]]) {
          const edge = walk(to, distance);
          (edges[from] ??= []).push(edge);
          walks.set(from, [...(walks.get(from) ?? []), edge]);
        }
      }
      const g = graph(edges, [1, 2, 3, 4, 5, 6]);
      for (let from = 1; from <= 6; from++) for (let to = 1; to <= 6; to++) {
        if (from === to) continue;
        const expected = rounds(lines, walks, from, to);
        const actual = findRoute(g, from, to);
        const context = JSON.stringify({ network, from, to, lines: lines.map(l => l.stops) });
        expect(Boolean(actual), context).toBe(Boolean(expected));
        if (!actual || !expected) continue;
        const boardings = actual.segments.filter(s => s.mode !== 'walk').length;
        const walking = actual.segments.filter(s => s.mode === 'walk').reduce((sum, s) => sum + s.distance, 0);
        expect(boardings, context).toBe(expected.boardings);
        expect(actual.totalTransfers, context).toBe(Math.max(0, boardings - 1));
        expect(actual.totalTime, context).toBeCloseTo(Math.round(expected.cost[0] * 10) / 10, 8);
        expect(walking, context).toBeCloseTo(expected.cost[1], 8);
        expect(actual.totalDistance, context).toBeCloseTo(Math.round(expected.cost[2] * 100) / 100, 8);
        expect(actual.segments[0].stops[0].id, context).toBe(from);
        expect(actual.segments.at(-1)!.stops.at(-1)!.id, context).toBe(to);
        for (let i = 1; i < actual.segments.length; i++) {
          expect(actual.segments[i - 1].stops.at(-1)!.id, context).toBe(actual.segments[i].stops[0].id);
          expect(actual.segments[i].mode === 'walk' && actual.segments[i - 1].mode === 'walk', context).toBe(false);
        }
        if (boardings > fewestBoardings(lines, walks, from, to)!) chosenMoreThanFewest++;
      }
    }
    // The generated trips exercise the penalty, not only the fewest boardings.
    expect(chosenMoreThanFewest).toBeGreaterThan(10);
  });
});

describe('journeys between points against the same oracle (#720)', () => {
  it('agrees on the stops walked to and from, the boardings, the times, walking the whole way and what stands beside it', () => {
    let seed = 20261111, otherThanNearest = 0, onFoot = 0, rides = 0, slowerRide = 0, walkBesideRide = 0, rideBesideWalk = 0;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    // Stops and points along a strip 7.5 km long and 400 m wide, so a point has a stop
    // or two within a walk and the walk the whole way is sometimes within its limit.
    const somewhere = (): LatLng => [40.3 + random(675) / 10000, 49.8 + random(50) / 10000];
    // On its streets: 1.3 times the straight line, at 4.5 km/h.
    const walkCost = (km: number): Cost => [((km * 1.3) / 4.5) * 60, km, km];
    for (let network = 0; network < 40; network++) {
      const edges: Record<number, GraphEdge[]> = {};
      const lines = Array.from({ length: 4 }, (_, i): Line => {
        const stops = Array.from({ length: 3 + random(3) }, () => 1 + random(6));
        const legs = stops.slice(1).map((to, sequence) => (i % 2 ? train : ride)(to, i + 1, 1 + random(30), 1 + random(5), sequence));
        legs.forEach((leg, sequence) => (edges[stops[sequence]] ??= []).push(leg));
        return { stops, legs };
      });
      const walks = new Map<number, GraphEdge[]>();
      for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) {
        if (random(5) !== 0) continue;
        const distance = random(2) ? 0.125 : 0.25;
        for (const [from, to] of [[a, b], [b, a]]) {
          const edge = walk(to, distance);
          (edges[from] ??= []).push(edge);
          walks.set(from, [...(walks.get(from) ?? []), edge]);
        }
      }
      const at: Record<number, LatLng> = {};
      for (let id = 1; id <= 6; id++) at[id] = somewhere();
      const g = graph(edges, [1, 2, 3, 4, 5, 6], { at });
      for (let trip = 0; trip < 15; trip++) {
        const [oLat, oLng] = somewhere(), [dLat, dLng] = somewhere();
        const O = { latitude: oLat, longitude: oLng, name: 'O' }, D = { latitude: dLat, longitude: dLng, name: 'D' };
        // The walks to and from the points, found here and not by accessWalks: every stop
        // within the radius, served or not (a stop no line serves is a dead end anyway).
        const within = (lat: number, lng: number) => new Map([1, 2, 3, 4, 5, 6]
          .map(id => [id, haversine(lat, lng, ...at[id])] as const).filter(([, km]) => km <= ACCESS_RADIUS_KM)
          .map(([id, km]) => [id, walkCost(km)]));
        const away = within(oLat, oLng), home = within(dLat, dLng);
        const expected = roundsBetweenPoints(lines, walks, away, home, walkCost(haversine(oLat, oLng, dLat, dLng)));
        const journey = findJourney(g, O, D);
        const actual = journey.route;
        const context = JSON.stringify({ network, trip, O, D, lines: lines.map(l => l.stops), at });
        expect(Boolean(actual), context).toBe(Boolean(expected));
        if (!actual || !expected) {
          expect(journey.alternative, context).toBeUndefined();
          continue;
        }
        const boardings = actual.segments.filter(s => s.mode !== 'walk').length;
        const walking = actual.segments.filter(s => s.mode === 'walk').reduce((sum, s) => sum + s.distance, 0);
        expect(boardings, context).toBe(expected.boardings);
        expect(actual.totalTime, context).toBeCloseTo(Math.round(expected.cost[0] * 10) / 10, 8);
        expect(walking, context).toBeCloseTo(expected.cost[1], 8);
        expect(actual.totalDistance, context).toBeCloseTo(Math.round(expected.cost[2] * 100) / 100, 8);
        expect(actual.segments[0].stops[0].id, context).toBe(-1);
        expect(actual.segments.at(-1)!.stops.at(-1)!.id, context).toBe(-2);
        for (let i = 1; i < actual.segments.length; i++) {
          expect(actual.segments[i - 1].stops.at(-1)!.id, context).toBe(actual.segments[i].stops[0].id);
          expect(actual.segments[i].mode === 'walk' && actual.segments[i - 1].mode === 'walk', context).toBe(false);
        }
        // What stands beside it (#743), by the same oracle: the walk beside a journey that
        // rides while the walk competes with one, and the cheapest journey that rides beside
        // the walk when that is faster before any wait, the walk taking more than a boarding.
        const km = haversine(oLat, oLng, dLat, dLng), onFootMinutes = walkCost(km)[0];
        const ridden = roundsBetweenPoints(lines, walks, away, home, [Infinity, Infinity, Infinity]);
        const beside = journey.alternative;
        if (boardings > 0) {
          expect(Boolean(beside), context).toBe(km <= MAX_WALK_ONLY_KM && onFootMinutes <= MAX_WALK_INSTEAD_MIN);
          if (beside) {
            walkBesideRide++;
            expect(beside.segments.map(s => s.mode), context).toEqual(['walk']);
            expect(beside.totalTime, context).toBeCloseTo(Math.round(onFootMinutes * 10) / 10, 8);
          }
        } else {
          expect(Boolean(beside), context).toBe(onFootMinutes > BOARDING_PENALTY_MIN && !!ridden && ridden.cost[0] < onFootMinutes);
          if (beside) {
            rideBesideWalk++;
            expect(beside.segments.filter(s => s.mode !== 'walk').length, context).toBe(ridden!.boardings);
            expect(beside.totalTime, context).toBeCloseTo(Math.round(ridden!.cost[0] * 10) / 10, 8);
          }
        }
        if (boardings === 0) {
          onFoot++;
          // Past half an hour on foot, a walk chosen over a journey that rides: a slower one.
          if (expected.cost[0] > MAX_WALK_INSTEAD_MIN && ridden) slowerRide++;
        } else {
          rides++;
          const boardable = [...away].filter(([id]) => (edges[id] ?? []).some(e => e.kind !== 'walk')).sort((a, b) => a[1][0] - b[1][0]);
          if (actual.segments[1].stops[0].id !== boardable[0][0]) otherThanNearest++;
        }
      }
    }
    // The trips exercise the choice among several stops and the walk the whole way.
    expect(rides).toBeGreaterThan(100);
    expect(onFoot).toBeGreaterThan(50);
    expect(otherThanNearest).toBeGreaterThan(10);
    expect(slowerRide).toBeGreaterThan(0);
    // Both kinds come up (2 and 15 here), the walk beside a ride seldom, as on the snapshot
    // (24 of 2,000 random pairs, against 544 the other way).
    expect(walkBesideRide).toBeGreaterThan(0);
    expect(rideBesideWalk).toBeGreaterThan(5);
  });
});
