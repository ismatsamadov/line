import { describe, expect, it } from 'vitest';
import { BOARDING_PENALTY_MIN, findRoute, numberRidePositions } from '../routing';
import { WALK_RADIUS_KM, walkMinutes } from '../geo';
import type { GraphEdge } from '../types';
import { graph, RED, ride, train, walk } from './fixtures';

const busIds = (route: ReturnType<typeof findRoute>) => route?.segments.filter(s => s.busId !== -1).map(s => s.busId);

describe('journey choice: minutes plus a boarding penalty (#664, #721)', () => {
  it("draws a ride along its legs' road, straight to the next stop where a leg has none (#685)", () => {
    const road: [number, number][] = [[40.01, 49], [40.015, 49.001], [40.02, 49]];
    const g = graph({ 1: [{ ...ride(2, 10, 1, 1, 0), path: road } as GraphEdge], 2: [ride(3, 10, 1, 1, 1)] });
    const [segment] = findRoute(g, 1, 3)!.segments;
    expect(segment.path).toEqual([...road, [40.03, 49]]);
    // Without any road the ride keeps no path, and the map joins its stops as before.
    expect(findRoute(graph({ 1: [ride(2, 10, 1, 1, 0)], 2: [ride(3, 10, 1, 1, 1)] }), 1, 3)!.segments[0].path).toBeUndefined();
  });

  it('keeps one bus over two that save less than a boarding', () => {
    // One bus: 20 + 15 = 35. Two buses: 6 + 2 × 15 = 36.
    expect(BOARDING_PENALTY_MIN).toBe(15);
    const g = graph({ 1: [ride(3, 10, 20), ride(2, 20, 3)], 2: [ride(3, 30, 3)] });
    const route = findRoute(g, 1, 3)!;
    expect(busIds(route)).toEqual([10]);
    expect(route.totalTransfers).toBe(0);
    expect(route.totalTime).toBe(20);
  });

  it('takes two buses when they save more than a boarding (#721)', () => {
    // One bus: 40 + 15 = 55. Two buses: 6 + 30 = 36. #664 took the 40-minute bus.
    const route = findRoute(graph({ 1: [ride(3, 10, 40), ride(2, 20, 3)], 2: [ride(3, 30, 3)] }), 1, 3)!;
    expect(busIds(route)).toEqual([20, 30]);
    expect(route.totalTransfers).toBe(1);
    expect(route.totalTime).toBe(6);
  });

  it('settles an exact tie between one bus and two on fewer boardings', () => {
    // 21 + 15 = 6 + 30.
    expect(busIds(findRoute(graph({ 1: [ride(3, 10, 21), ride(2, 20, 3)], 2: [ride(3, 30, 3)] }), 1, 3))).toEqual([10]);
  });

  it('chooses two buses over three unless the third boarding saves more than its penalty', () => {
    // Two buses: 10 + 30 = 40. Three: 3 + 45 = 48.
    const g = graph({ 1: [ride(2, 10, 5), ride(4, 30)], 2: [ride(5, 20, 5)], 4: [ride(6, 40)], 6: [ride(5, 50)] });
    expect(busIds(findRoute(g, 1, 5))).toEqual([10, 20]);
    // Two buses: 40 + 30 = 70 now.
    const slow = graph({ 1: [ride(2, 10, 20), ride(4, 30)], 2: [ride(5, 20, 20)], 4: [ride(6, 40)], 6: [ride(5, 50)] });
    expect(busIds(findRoute(slow, 1, 5))).toEqual([30, 40, 50]);
  });

  it('breaks equal-boardings ties by estimated movement time', () => {
    const g = graph({ 1: [ride(3, 10, 10, 1), ride(3, 20, 2, 5)] });
    expect(busIds(findRoute(g, 1, 3))).toEqual([20]);
  });

  it('prefers less walking when boardings and movement time tie', () => {
    const foot = walk(2);
    const g = graph({ 1: [foot, ride(3, 10, foot.time + 1)], 2: [ride(3, 20)] });
    expect(busIds(findRoute(g, 1, 3))).toEqual([10]);
  });

  it('uses total distance as the final tie-breaker', () => {
    expect(busIds(findRoute(graph({ 1: [ride(3, 10, 5, 10), ride(3, 20, 5, 1)] }), 1, 3))).toEqual([20]);
  });

  it('counts the first boarding after an origin walk once', () => {
    const route = findRoute(graph({ 1: [walk(2)], 2: [ride(3, 10)] }), 1, 3)!;
    expect(busIds(route)).toEqual([10]);
    expect(route.totalTransfers).toBe(0);
    expect(route.totalTime).toBeCloseTo(3.7);
    expect(route.segments.map(s => s.stops.map(p => p.id))).toEqual([[1, 2], [2, 3]]);
  });

  it('counts a walking interchange once and keeps both distinct transfer stops', () => {
    const route = findRoute(graph({ 1: [ride(2, 10)], 2: [walk(3)], 3: [ride(4, 20)] }), 1, 4)!;
    expect(route.totalTransfers).toBe(1);
    expect(route.totalStops).toBe(4);
    expect(route.totalTime).toBeCloseTo(4.7);
    expect(busIds(route)).toEqual([10, 20]);
  });

  it('does not chain walking edges to manufacture a one-bus shortcut', () => {
    const g = graph({ 1: [walk(2), ride(5, 10)], 2: [walk(3)], 3: [ride(4, 30)], 5: [ride(4, 20)] });
    expect(busIds(findRoute(g, 1, 4))).toEqual([10, 20]);
    expect(findRoute(graph({ 1: [walk(2)], 2: [walk(3)], 3: [ride(4, 30)] }), 1, 4)).toBeNull();
  });

  it('offers a short walking-only journey separately and rejects oversized walk edges', () => {
    const route = findRoute(graph({ 1: [walk(2), ride(2, 10)] }), 1, 2)!;
    expect(busIds(route)).toEqual([]);
    expect(route.totalTransfers).toBe(0);
    expect(route.totalStops).toBe(0);
    expect(findRoute(graph({ 1: [walk(2, WALK_RADIUS_KM + 0.01)] }), 1, 2)).toBeNull();
    // The longest walk, 6.9 minutes on its streets, costs less than one boarding, so a walk
    // alone is always the cheapest journey.
    expect(walkMinutes(WALK_RADIUS_KM)).toBeLessThan(BOARDING_PENALTY_MIN);
  });

  it('walks up to the limit to the first bus, and no further (#721)', () => {
    // As from Azərbaycan Hava Yolları to the 28 May hub, 355 m away.
    const route = findRoute(graph({ 1: [walk(2, 0.355)], 2: [ride(3, 10)] }), 1, 3)!;
    expect(route.segments.map(s => s.mode)).toEqual(['walk', 'bus']);
    expect(findRoute(graph({ 1: [walk(2, WALK_RADIUS_KM + 0.001)], 2: [ride(3, 10)] }), 1, 3)).toBeNull();
  });

  it('counts changing direction on the same bus number as another boarding', () => {
    const g = graph({ 1: [ride(2, 10)], 2: [ride(3, 10, 1, 1, 0, 2)] });
    const route = findRoute(g, 1, 3)!;
    expect(route.totalTransfers).toBe(1);
    expect(route.segments.map(s => s.direction)).toEqual([1, 2]);
    // A direct 10-minute bus (25) beats riding 10 back the other way (2 + 30); as one ride it would not (17).
    expect(busIds(findRoute(graph({ 1: [...g.getEdges(1), ride(3, 20, 10)], 2: g.getEdges(2) }), 1, 3))).toEqual([20]);
  });

  it('stays through a loop instead of jumping to a later occurrence of the same stop', () => {
    const g = graph({
      1: [ride(2, 10)], 2: [ride(3, 10, 1, 1, 1), ride(4, 10, 1, 1, 3)],
      3: [ride(2, 10, 1, 1, 2)],
    });
    const route = findRoute(g, 1, 4)!;
    expect(route.totalTransfers).toBe(0);
    expect(route.segments[0].stops.map(s => s.id)).toEqual([1, 2, 3, 2, 4]);
    expect(route.totalStops).toBe(5);
  });

  it('returns null for missing, identical and unreachable stops, including zero-cost walking cycles', () => {
    const g = graph({ 1: [walk(2, 0)], 2: [walk(1, 0)], 3: [] });
    expect(findRoute(g, 1, 3)).toBeNull();
    expect(findRoute(g, 1, 99)).toBeNull();
    expect(findRoute(g, 1, 1)).toBeNull();
  });

  it('keeps the complete origin and destination when multiple routes branch midway', () => {
    const g = graph({ 1: [ride(2, 10)], 2: [ride(4, 10, 1, 1, 1), ride(3, 20)], 3: [ride(4, 20, 1, 1, 1)] });
    const route = findRoute(g, 1, 4)!;
    expect(route.segments[0].stops[0].id).toBe(1);
    expect(route.segments.at(-1)!.stops.at(-1)!.id).toBe(4);
  });

  it('knows a ride by its position, not its edge object, so a graph may hand back copies (#721)', () => {
    // As a wrapper that adds or decorates edges might: fresh copies on every call. Keyed
    // by the edge object, a ride never met its earlier state again; 1343 → 3642 ran out
    // of memory that way. Each network is searched as built, then with its edges
    // numbered as graph.ts numbers its own, which a copy goes without.
    let seed = 721;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let network = 0; network < 20; network++) {
      const edges: Record<number, GraphEdge[]> = {};
      for (let line = 1; line <= 6; line++) {
        const stops = Array.from({ length: 4 + random(4) }, () => 1 + random(8));
        stops.slice(1).forEach((to, seq) => (edges[stops[seq]] ??= []).push(ride(to, line, 1 + random(20), 1, seq)));
      }
      for (let id = 1; id <= 8; id++) (edges[id] ??= []).push(walk(id % 8 + 1));
      const own = graph(edges, [1, 2, 3, 4, 5, 6, 7, 8]);
      let settled = 0;
      const counted = (copies: boolean) => ({
        getStopInfo: own.getStopInfo,
        getEdges: (id: number) => { settled++; return copies ? own.getEdges(id).map(e => ({ ...e })) : own.getEdges(id); },
      });
      // A state is settled once at most: a ride's position, a stop walked to before or
      // after boarding, or the start; findRoute reads the origin's edges once more.
      const states = Object.values(edges).flat().filter(e => e.kind !== 'walk').length + 2 * 8 + 1;
      const unnumbered = new Map<string, ReturnType<typeof findRoute>>();
      for (const numbered of [false, true]) {
        if (numbered) Object.values(edges).forEach(numberRidePositions);
        for (let from = 1; from <= 8; from++) for (let to = 1; to <= 8; to++) {
          if (from === to) continue;
          settled = 0;
          const expected = findRoute(counted(false), from, to);
          const byOwnEdges = settled;
          settled = 0;
          expect(findRoute(counted(true), from, to)).toEqual(expected);
          expect(settled).toBe(byOwnEdges);
          expect(settled).toBeLessThanOrEqual(states + 1);
          if (numbered) expect(expected).toEqual(unnumbered.get(`${from}:${to}`));
          else unnumbered.set(`${from}:${to}`, expected);
        }
      }
    }
  });

  it('agrees with independent boarding rounds across generated networks', () => agreesWithRounds(664, () => ride));

  it('agrees with them when some of the lines are metro lines (#689)', () => agreesWithRounds(689, (i) => (i % 2 ? train : ride)));
});

/** Round n boards one more line at any stop reached in round n-1 and rides it forward,
 *  keeping the fewest minutes to each stop: no Dijkstra and no labels. The journey to
 *  choose is the round whose minutes plus n penalties are lowest, the earliest on a
 *  tie. Line i's legs are made by make(i), with whole minutes so ties are exact. */
function agreesWithRounds(start: number, make: (i: number) => typeof ride | typeof train) {
    let seed = start;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    let chosenMoreThanFewest = 0;
    for (let network = 0; network < 30; network++) {
      const lines = Array.from({ length: 5 }, () => Array.from({ length: 3 + random(3) }, () => 1 + random(6)));
      const times = lines.map(line => line.slice(1).map(() => 1 + random(30)));
      const edges: Record<number, GraphEdge[]> = {};
      lines.forEach((line, i) => line.slice(0, -1).forEach((from, seq) => {
        (edges[from] ??= []).push(make(i)(line[seq + 1], i + 1, times[i][seq], 1, seq));
      }));
      const g = graph(edges, [1, 2, 3, 4, 5, 6]);
      for (let from = 1; from <= 6; from++) for (let to = 1; to <= 6; to++) {
        if (from === to) continue;
        let reached = new Map([[from, 0]]);
        const seen = new Set([from]);
        let expected: { boardings: number; minutes: number } | null = null, fewest: number | null = null;
        // A journey with n boardings costs at least n penalties, so later rounds cannot win.
        for (let n = 1; !expected || n * BOARDING_PENALTY_MIN <= expected.minutes + expected.boardings * BOARDING_PENALTY_MIN; n++) {
          const next = new Map<number, number>();
          lines.forEach((line, i) => line.forEach((stop, board) => {
            const at = reached.get(stop);
            if (at === undefined) return;
            let minutes = at;
            for (let j = board + 1; j < line.length; j++) {
              minutes += times[i][j - 1];
              if (minutes < (next.get(line[j]) ?? Infinity)) next.set(line[j], minutes);
            }
          }));
          // A round that reaches no stop the earlier rounds missed never will: the
          // destination is out of reach.
          if (!expected && [...next.keys()].every(id => seen.has(id))) break;
          for (const id of next.keys()) seen.add(id);
          const arrival = next.get(to);
          if (arrival !== undefined) {
            fewest ??= n;
            if (!expected || arrival + n * BOARDING_PENALTY_MIN < expected.minutes + expected.boardings * BOARDING_PENALTY_MIN) {
              expected = { boardings: n, minutes: arrival };
            }
          }
          reached = next;
        }
        const route = findRoute(g, from, to);
        const context = JSON.stringify({ network, from, to, lines, times });
        expect(route ? busIds(route)!.length : null, context).toBe(expected?.boardings ?? null);
        if (route) {
          expect(route.totalTime, context).toBe(expected!.minutes);
          expect(route.segments[0].stops[0].id).toBe(from);
          expect(route.segments.at(-1)!.stops.at(-1)!.id).toBe(to);
          if (expected!.boardings > fewest!) chosenMoreThanFewest++;
        }
      }
    }
    // The generated networks exercise the penalty, not only the fewest boardings.
    expect(chosenMoreThanFewest).toBeGreaterThan(10);
}

describe('the metro in journey choice (#689)', () => {
  const modes = (route: ReturnType<typeof findRoute>) => route?.segments.map(s => s.mode);

  it('rides a train through its stations as one boarding, and counts a change of train as another', () => {
    // Walk to station 10, ride metro:1 to 12, change there to metro:2 (as at Əhmədli), walk off.
    const g = graph({ 1: [walk(10)], 10: [train(11, 1)], 11: [train(12, 1, 1, 1, 1)], 12: [train(13, 2)], 13: [walk(2)] });
    const route = findRoute(g, 1, 2)!;
    expect(modes(route)).toEqual(['walk', 'metro', 'metro', 'walk']);
    expect(route.totalTransfers).toBe(1);
    expect(route.segments[1].stops.map(s => s.id)).toEqual([10, 11, 12]);
    expect(route.segments[1]).toMatchObject({ busId: -2, busNumber: 'Qırmızı xətt', line: RED, headsign: 'Terminus metro:1', direction: null });
    // Stations count like stops, the change at 12 once.
    expect(route.totalStops).toBe(4);
  });

  it('takes a bus and a train over one bus only when they save more than a boarding (#721)', () => {
    // A bus and a train: 5 + 2.7 + 3 + 2.7 + 2 × 15 = 43.3. One bus: 60 + 15 = 75, which #664 kept.
    const g = (minutes: number) => graph({ 1: [ride(2, 10, minutes), ride(3, 20, 5)], 3: [walk(30)], 30: [train(31, 1, 3)], 31: [walk(2)] });
    expect(modes(findRoute(g(60), 1, 2))).toEqual(['bus', 'walk', 'metro', 'walk']);
    // One bus of 25 minutes: 40.
    expect(modes(findRoute(g(25), 1, 2))).toEqual(['bus']);
  });

  it('takes the train over a bus with as many boardings when the train is faster', () => {
    const g = graph({ 1: [ride(2, 10, 30), walk(30)], 30: [train(31, 1, 8)], 31: [walk(2)] });
    const route = findRoute(g, 1, 2)!;
    expect(modes(route)).toEqual(['walk', 'metro', 'walk']);
    expect(route.totalTransfers).toBe(0);
    expect(modes(findRoute(graph({ 1: [ride(2, 10, 5), walk(30)], 30: [train(31, 1, 8)], 31: [walk(2)] }), 1, 2))).toEqual(['bus']);
  });

  it('changes line by one walk between two stations, never by a second walk in a row', () => {
    // 30 and 40 are one interchange, as 28 May and Cəfər Cabbarlı are.
    const route = findRoute(graph({ 1: [walk(20)], 20: [train(30, 1)], 30: [walk(40, 0.04)], 40: [train(41, 2)], 41: [walk(2)] }), 1, 2)!;
    expect(modes(route)).toEqual(['walk', 'metro', 'walk', 'metro', 'walk']);
    expect(route.totalTransfers).toBe(1);
    // A walk to one station cannot go on to the next on foot.
    expect(findRoute(graph({ 1: [walk(30)], 30: [walk(40, 0.04)], 40: [train(41, 2)], 41: [walk(2)] }), 1, 2)).toBeNull();
  });

  it('shows the express bus as a bus, with the metro line it stands in for', () => {
    const express = { ...train(31, 3, 3), vehicle: 'bus', busNumber: 'M1/M2' } as GraphEdge;
    const route = findRoute(graph({ 1: [walk(30)], 30: [express], 31: [walk(2)] }), 1, 2)!;
    expect(route.segments[1]).toMatchObject({ mode: 'bus', busId: -2, busNumber: 'M1/M2', line: RED });
  });

  it('draws a walk to a station by its exit, and every other walk straight', () => {
    const byExit: [number, number][] = [[40.01, 49], [40.0105, 49.0004], [40.3, 49]];
    const route = findRoute(graph({ 1: [{ ...walk(30), path: byExit } as GraphEdge], 30: [train(31, 1)], 31: [walk(2)] }), 1, 2)!;
    expect(route.segments[0].path).toEqual(byExit);
    expect(route.segments[2].path).toBeUndefined();
  });
});
