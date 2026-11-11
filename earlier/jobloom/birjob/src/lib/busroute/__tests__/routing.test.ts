import { describe, expect, it } from 'vitest';
import { findRoute } from '../routing';
import { WALK_RADIUS_KM } from '../geo';
import type { GraphEdge } from '../types';
import { graph, RED, ride, train, walk } from './fixtures';

const busIds = (route: ReturnType<typeof findRoute>) => route?.segments.filter(s => s.busId !== -1).map(s => s.busId);

describe('minimum-boardings routing (#664)', () => {
  it("draws a ride along its legs' road, straight to the next stop where a leg has none (#685)", () => {
    const road: [number, number][] = [[40.01, 49], [40.015, 49.001], [40.02, 49]];
    const g = graph({ 1: [{ ...ride(2, 10, 1, 1, 0), path: road } as GraphEdge], 2: [ride(3, 10, 1, 1, 1)] });
    const [segment] = findRoute(g, 1, 3)!.segments;
    expect(segment.path).toEqual([...road, [40.03, 49]]);
    // Without any road the ride keeps no path, and the map joins its stops as before.
    expect(findRoute(graph({ 1: [ride(2, 10, 1, 1, 0)], 2: [ride(3, 10, 1, 1, 1)] }), 1, 3)!.segments[0].path).toBeUndefined();
  });

  it('always chooses one bus over a much faster two-bus journey', () => {
    const g = graph({ 1: [ride(3, 10, 1_000_000, 1_000), ride(2, 20)], 2: [ride(3, 30)] });
    const route = findRoute(g, 1, 3)!;
    expect(busIds(route)).toEqual([10]);
    expect(route.totalTransfers).toBe(0);
  });

  it('chooses two buses over three when no direct bus exists', () => {
    const g = graph({ 1: [ride(2, 10, 100), ride(4, 30)], 2: [ride(5, 20, 100)], 4: [ride(6, 40)], 6: [ride(5, 50)] });
    expect(busIds(findRoute(g, 1, 5))).toEqual([10, 20]);
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
    expect(busIds(findRoute(graph({ 1: [...g.getEdges(1), ride(3, 20, 50)], 2: g.getEdges(2) }), 1, 3))).toEqual([20]);
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

  it('agrees with independent boarding rounds across generated networks', () => agreesWithRounds(664, () => ride));

  it('agrees with them when some of the lines are metro lines (#689)', () => agreesWithRounds(689, (i) => (i % 2 ? train : ride)));
});

/** Round n boards one more line from any stop reachable in round n-1, then rides forward
 *  through that line: no Dijkstra, no costs. Line i's legs are made by make(i). */
function agreesWithRounds(start: number, make: (i: number) => typeof ride | typeof train) {
    let seed = start;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let network = 0; network < 30; network++) {
      const lines = Array.from({ length: 5 }, () => Array.from({ length: 3 + random(3) }, () => 1 + random(6)));
      const edges: Record<number, GraphEdge[]> = {};
      lines.forEach((line, i) => line.slice(0, -1).forEach((from, seq) => {
        (edges[from] ??= []).push(make(i)(line[seq + 1], i + 1, 1 + random(30), 1, seq));
      }));
      const g = graph(edges, [1, 2, 3, 4, 5, 6]);
      for (let from = 1; from <= 6; from++) for (let to = 1; to <= 6; to++) {
        if (from === to) continue;
        // Round n boards one more bus from any stop reachable in round n-1,
        // then rides forward through that line. No Dijkstra/cost implementation.
        let reached = new Set([from]), expected: number | null = null;
        for (let n = 1; n <= 6; n++) {
          const next = new Set(reached);
          for (const line of lines) for (let i = 0; i < line.length; i++) {
            if (reached.has(line[i])) for (const id of line.slice(i + 1)) next.add(id);
          }
          if (next.has(to)) { expected = n; break; }
          if (next.size === reached.size) break;
          reached = next;
        }
        const route = findRoute(g, from, to);
        expect(route ? busIds(route)!.length : null, JSON.stringify({ network, from, to, lines })).toBe(expected);
        if (route) {
          expect(route.segments[0].stops[0].id).toBe(from);
          expect(route.segments.at(-1)!.stops.at(-1)!.id).toBe(to);
        }
      }
    }
}

describe('the metro in minimum-boardings routing (#689)', () => {
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

  it('still takes one bus over a much faster bus and train (#664)', () => {
    const g = graph({ 1: [ride(2, 10, 60), ride(3, 20, 5)], 3: [walk(30)], 30: [train(31, 1, 3)], 31: [walk(2)] });
    expect(modes(findRoute(g, 1, 2))).toEqual(['bus']);
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
