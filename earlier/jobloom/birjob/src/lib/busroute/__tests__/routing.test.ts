import { describe, expect, it } from 'vitest';
import { findRoute } from '../routing';
import type { GraphEdge } from '../types';
import { graph, ride, walk } from './fixtures';

const busIds = (route: ReturnType<typeof findRoute>) => route?.segments.filter(s => s.busId !== -1).map(s => s.busId);

describe('minimum-boardings routing (#664)', () => {
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
    expect(findRoute(graph({ 1: [walk(2, 0.31)] }), 1, 2)).toBeNull();
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

  it('agrees with independent boarding rounds across generated networks', () => {
    let seed = 664;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let network = 0; network < 30; network++) {
      const lines = Array.from({ length: 5 }, () => Array.from({ length: 3 + random(3) }, () => 1 + random(6)));
      const edges: Record<number, GraphEdge[]> = {};
      lines.forEach((line, i) => line.slice(0, -1).forEach((from, seq) => {
        (edges[from] ??= []).push(ride(line[seq + 1], i + 1, 1 + random(30), 1, seq));
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
  });
});
