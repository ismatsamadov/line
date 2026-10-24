import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  bus_buses: { findUnique: vi.fn() },
  bus_bus_stops: { findMany: vi.fn() },
  bus_stop_details: { findMany: vi.fn() },
  bus_routes: { findFirst: vi.fn() },
  bus_route_coordinates: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { queryBusLine } from '../db';

const detail = (id: number) => ({ id, code: null, name: `Stop ${id}`, latitude: 40.4, longitude: 49.8, is_transport_hub: false });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.bus_buses.findUnique.mockResolvedValue({
    id: 160, number: '120A ', carrier: '', first_point: 'A ', last_point: 'B ',
    route_length: 23.4, duration_minuts: 39, tariff_str: '',
  });
  prisma.bus_routes.findFirst.mockResolvedValue(null);
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

  it('keeps a loop that returns to its first stop', async () => {
    const loop = [1, 2, 3, 1];
    prisma.bus_bus_stops.findMany
      .mockResolvedValueOnce([{ direction_type_id: 1 }])
      .mockResolvedValueOnce(loop.map((stop_id, i) => ({ stop_id, total_distance: i })));
    prisma.bus_stop_details.findMany.mockResolvedValue([1, 2, 3].map(detail));

    const line = await queryBusLine(7, 1);
    expect(line?.stops.map((s) => s.id)).toEqual(loop);
  });
});
