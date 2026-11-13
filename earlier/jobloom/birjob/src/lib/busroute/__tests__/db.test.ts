import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  bus_buses: { findUnique: vi.fn() },
  bus_bus_stops: { findMany: vi.fn() },
  bus_stop_details: { findMany: vi.fn() },
  bus_routes: { findMany: vi.fn() },
  bus_route_coordinates: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { listStopsForGeo, queryBusLine } from '../db';

const detail = (id: number) => ({ id, code: null, name: `Stop ${id}`, latitude: 40.4, longitude: 49.8, is_transport_hub: false });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.bus_buses.findUnique.mockResolvedValue({
    id: 160, number: '120A ', carrier: '', first_point: 'A ', last_point: 'B ',
    route_length: 23.4, duration_minuts: 39, tariff_str: '',
  });
  prisma.bus_routes.findMany.mockResolvedValue([]);
  prisma.bus_route_coordinates.findMany.mockResolvedValue([]);
});

describe('queryBusLine', () => {
  it('lists one copy of a stop list the snapshot stores twice over (#685)', async () => {
    const copy = [1880, 1345, 1367, 1200];
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }, { direction_type_id: 2 }])
      .mockResolvedValueOnce([...copy, ...copy].map((stop_id) => ({ stop_id, total_distance: 23.4 })));
    prisma.bus_stop_details.findMany.mockResolvedValue(copy.map(detail));

    const line = await queryBusLine(160, 1);
    expect(line?.stops.map((s) => s.id)).toEqual(copy);
    expect(line?.availableDirections).toEqual([1, 2]);
  });

  it('draws the line along the road matched to its stops, never a recorded line as stored (#685)', async () => {
    // Three stops 50 m north of a street on 40.40. Direction 1's recorded line has
    // latitude and longitude swapped, as 521's second direction does; direction 2's
    // runs the same street the other way.
    const stops = [{ id: 1, lng: 49.801 }, { id: 2, lng: 49.821 }, { id: 3, lng: 49.841 }];
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }, { direction_type_id: 2 }])
      .mockResolvedValueOnce(stops.map(({ id }, i) => ({ stop_id: id, total_distance: i })));
    prisma.bus_stop_details.findMany.mockResolvedValue(stops.map(({ id, lng }) => ({ ...detail(id), latitude: 40.40045, longitude: lng })));
    prisma.bus_routes.findMany.mockResolvedValue([{ id: 7, direction_type_id: 1 }, { id: 8, direction_type_id: 2 }]);
    const street = Array.from({ length: 31 }, (_, i) => 49.80 + i * 0.002);
    prisma.bus_route_coordinates.findMany.mockResolvedValue([
      ...street.map((lng) => ({ route_id: 7, latitude: lng, longitude: 40.40 })),
      ...[...street].reverse().map((lng) => ({ route_id: 8, latitude: 40.40, longitude: lng })),
    ]);

    const line = await queryBusLine(7, 1);
    const coordinates = line!.coordinates;
    expect(coordinates[0].latitude).toBeCloseTo(40.40, 6);
    expect(coordinates[0].longitude).toBeCloseTo(49.801, 4);
    expect(coordinates[coordinates.length - 1].longitude).toBeCloseTo(49.841, 4);
    expect(coordinates.every((c) => c.latitude > 40 && c.latitude < 41)).toBe(true);
  });

  it('has no coordinates when no recorded line fits, so the map joins the stops', async () => {
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }])
      .mockResolvedValueOnce([{ stop_id: 1, total_distance: 0 }, { stop_id: 2, total_distance: 1 }]);
    prisma.bus_stop_details.findMany.mockResolvedValue([{ ...detail(1), longitude: 49.80 }, { ...detail(2), longitude: 49.81 }]);
    prisma.bus_routes.findMany.mockResolvedValue([{ id: 7, direction_type_id: 1 }]);
    prisma.bus_route_coordinates.findMany.mockResolvedValue([
      { route_id: 7, latitude: 49.80, longitude: 40.4 }, { route_id: 7, latitude: 49.81, longitude: 40.4 },
    ]);

    expect((await queryBusLine(7, 1))?.coordinates).toEqual([]);
  });

  describe('a stop the data puts off its line (#743)', () => {
    // As in graph.test.ts: stops 1-5 every 556 m up 49° E, but stop 3 stored 2 km east of
    // the road, which the recorded line runs straight along.
    const at: Record<number, [number, number]> = {
      1: [40.005, 49], 2: [40.01, 49], 3: [40.015, 49.0235], 4: [40.02, 49], 5: [40.025, 49],
    };
    const road: Array<[number, number]> = [[40.005, 49], [40.01, 49], [40.015, 49], [40.02, 49], [40.025, 49]];
    const viewed = async (line: Array<[number, number]>) => {
      prisma.bus_bus_stops.findMany
        .mockResolvedValueOnce([{ direction_type_id: 1 }])
        .mockResolvedValueOnce([1, 2, 3, 4, 5].map((stop_id, i) => ({ stop_id, total_distance: i })));
      prisma.bus_stop_details.findMany.mockResolvedValue([1, 2, 3, 4, 5].map((id) => ({ ...detail(id), latitude: at[id][0], longitude: at[id][1] })));
      prisma.bus_routes.findMany.mockResolvedValue(line.length ? [{ id: 7, direction_type_id: 1 }] : []);
      prisma.bus_route_coordinates.findMany.mockResolvedValue(line.map(([latitude, longitude]) => ({ route_id: 7, latitude, longitude })));
      return (await queryBusLine(7, 1))!;
    };

    it('lists it, flagged, and draws the line straight past it, not out to it and back', async () => {
      const line = await viewed(road);
      expect(line.stops.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
      expect(line.stops.map((s) => s.misplaced ?? false)).toEqual([false, false, true, false, false]);
      // Where it is stored stays in the list, for whoever reads it.
      expect(line.stops[2]).toMatchObject({ latitude: 40.015, longitude: 49.0235 });
      expect(line.coordinates.map((c) => [c.latitude, c.longitude])).toEqual([[40.005, 49], [40.01, 49], [40.02, 49], [40.025, 49]]);
    });

    it('is not flagged when the recorded line goes out to it, or when there is no line to tell', async () => {
      const detour = await viewed([road[0], road[1], at[3], road[3], road[4]]);
      expect(detour.stops.some((s) => s.misplaced)).toBe(false);
      expect(detour.coordinates).toContainEqual({ latitude: 40.015, longitude: 49.0235 });
      const none = await viewed([]);
      expect(none.stops.some((s) => s.misplaced)).toBe(false);
      expect(none.coordinates).toEqual([]);
    });
  });

  it('keeps a loop that returns to its first stop', async () => {
    const loop = [1, 2, 3, 1];
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }])
      .mockResolvedValueOnce(loop.map((stop_id, i) => ({ stop_id, total_distance: i })));
    prisma.bus_stop_details.findMany.mockResolvedValue([1, 2, 3].map(detail));

    const line = await queryBusLine(7, 1);
    expect(line?.stops.map((s) => s.id)).toEqual(loop);
  });

  it('still returns the ordered stops when optional road geometry cannot load', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }])
      .mockResolvedValueOnce([{ stop_id: 1 }, { stop_id: 2 }]);
    prisma.bus_stop_details.findMany.mockResolvedValue([detail(1), detail(2)]);
    prisma.bus_routes.findMany.mockRejectedValueOnce(new Error('geometry unavailable'));
    try {
      const line = await queryBusLine(160, 1);
      expect(line?.stops.map((s) => s.id)).toEqual([1, 2]);
      expect(line?.coordinates).toEqual([]);
      expect(quiet).toHaveBeenCalledWith(expect.stringContaining('line geometry not loaded'), expect.any(Error));
    } finally {
      quiet.mockRestore();
    }
  });

  it('keeps corrupt out-of-area points out of the picker and the line map', async () => {
    const details = [detail(1), { ...detail(2), latitude: 4.05 }, { ...detail(3), longitude: NaN }];
    prisma.bus_stop_details.findMany.mockResolvedValue(details);
    expect((await listStopsForGeo()).map((s) => s.id)).toEqual([1]);
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }])
      .mockResolvedValueOnce(details.map((d) => ({ stop_id: d.id })));
    expect((await queryBusLine(160, 1))?.stops.map((s) => s.id)).toEqual([1]);
  });
});
