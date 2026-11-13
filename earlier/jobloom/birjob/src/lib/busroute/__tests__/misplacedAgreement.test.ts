/**
 * The line viewer and the planner tell the same misplaced stops (#743). The real graph
 * (graph.ts) and the real line viewer (queryBusLine in db.ts) read the same tables, served
 * by a stand-in for Prisma that answers the queries both send. For each ride the viewer
 * must flag exactly the stops the graph adds a leg past. Before, the viewer asked
 * misplacedStops of its own list, which drops a stop with no valid coordinates and lists a
 * stop stored twice in a row once, and so flagged a stop the graph does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Args = { where?: Record<string, unknown>; orderBy?: Row | Row[]; distinct?: string[] };

const { tables, prisma } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const matches = (row: Row, where: Record<string, unknown> = {}) => Object.entries(where).every(([key, wanted]) =>
    wanted !== null && typeof wanted === 'object' && 'in' in wanted ? (wanted as { in: unknown[] }).in.includes(row[key]) : row[key] === wanted);
  const table = (name: string) => ({
    findMany: async ({ where, orderBy, distinct }: Args = {}) => {
      const order = [orderBy ?? []].flat() as Row[];
      const rows = tables[name].filter((row) => matches(row, where)).sort((a, b) => {
        for (const step of order) for (const [key, way] of Object.entries(step)) {
          const by = (a[key] as number) - (b[key] as number);
          if (by) return way === 'desc' ? -by : by;
        }
        return 0;
      });
      const seen = new Set<string>();
      return distinct ? rows.filter((row) => {
        const key = distinct.map((field) => row[field]).join(':');
        return !seen.has(key) && !!seen.add(key);
      }) : rows;
    },
    findUnique: async ({ where }: Args) => tables[name].find((row) => matches(row, where)) ?? null,
  });
  const names = ['bus_stop_details', 'bus_buses', 'bus_bus_stops', 'bus_routes', 'bus_route_coordinates'];
  return { tables, prisma: Object.fromEntries(names.map((name) => [name, table(name)])) };
});
vi.mock('@/lib/prisma', () => ({ prisma }));

// As in graph.test.ts: stops 1-5 every 556 m up 49° E, but stop 3 stored 2 km east of the
// road, which the recorded line runs straight along. Stop 6 is stored at the latitude of
// #685's broken rows, outside the area; stop 9 has no record at all.
const AT: Record<number, [number, number]> = {
  1: [40.005, 49], 2: [40.01, 49], 3: [40.015, 49.0235], 4: [40.02, 49], 5: [40.025, 49], 6: [4.05, 49],
};
const ROAD: Array<[number, number]> = [[40.005, 49], [40.01, 49], [40.015, 49], [40.02, 49], [40.025, 49]];

function ride(order: number[]) {
  tables.bus_stop_details = Object.entries(AT).map(([id, [latitude, longitude]]) => ({
    id: Number(id), code: id, name: `Stop ${id}`, latitude, longitude, is_transport_hub: false,
  }));
  tables.bus_buses = [{
    id: 10, carrier: '', number: '10', first_point: 'A', last_point: 'B', route_length: 10, tariff: 0, tariff_str: '',
    region_id: 1, working_zone_type_id: 1, duration_minuts: 30,
  }];
  tables.bus_bus_stops = order.map((stop_id, i) => ({
    id: 100 + i, bus_stop_id: i, bus_id: 10, stop_id, stop_code: '', stop_name: `Stop ${stop_id}`,
    total_distance: i, intermediate_distance: 1, direction_type_id: 1,
  }));
  tables.bus_routes = [{ id: 7, code: '', destination: '', bus_id: 10, direction_type_id: 1 }];
  tables.bus_route_coordinates = ROAD.map(([latitude, longitude], i) => ({ id: i, route_id: 7, latitude, longitude, sequence_order: i }));
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('the line viewer flags the stops the planner rides past (#743)', () => {
  it.each([
    ['a stop off the line', [1, 2, 3, 4, 5], [3]],
    ['the same with its neighbour listed twice in a row', [1, 2, 2, 3, 4, 5], [3]],
    ['a stop off the line listed twice in a row', [1, 2, 3, 3, 4, 5], []],
    ['a stop off the line beside one stored outside the area', [1, 2, 3, 6, 4, 5], []],
    ['a stop off the line beside one with no record', [1, 2, 3, 9, 4, 5], []],
  ])('%s', async (_, order, misplaced) => {
    ride(order);
    const { getGraph } = await import('../graph');
    const { queryBusLine } = await import('../db');
    const graph = await getGraph();
    const passed = graph.getAllStopIds().flatMap((id) => graph.getEdges(id))
      .flatMap((edge) => edge.kind === 'bus' && edge.passes ? [edge.passes.id] : []);
    const line = (await queryBusLine(10, 1))!;
    expect(passed).toEqual(misplaced);
    expect(line.stops.filter((stop) => stop.misplaced).map((stop) => stop.id)).toEqual(misplaced);
    // Drawn as journeys ride it: straight past a flagged stop, out to an unflagged one.
    const drawn = line.coordinates.map((c) => [c.latitude, c.longitude]);
    expect(drawn.some(([, longitude]) => longitude > 49.01)).toBe(misplaced.length === 0);
  });
});
