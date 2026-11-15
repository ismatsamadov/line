import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bus / Transit-Tool Usage (bonus, thin by nature). Two honest parts:
 *  - DATASET composition (static): the bus.* schema is a periodic Ayna import with
 *    NO usage timeline (bus_buses.created_at is bulk-import time; the other tables
 *    have no timestamp). So dataset metrics are point-in-time tiles, never a trend.
 *  - PLANNER usage: the route-planner page's lifetime view count in
 *    website.page_views (exact path /aletler/avtobus-marsrutu), still upserted by
 *    /api/views. The old /avtobus/<N> SEO pages were deleted 2026-07-19 (301'd), so
 *    there is NO per-route view breakdown to build — don't fabricate one from
 *    decaying paths.
 * The windowed planner usage (views per day, visitors, by country and by device)
 * read website.web_event_logs, which has had no writer since event logging was
 * switched off on 2026-08-29. It was removed on 2026-11-15, and with it the window:
 * nothing left here is windowed.
 * Aggregate-only. Cached 5-min, requireAdmin, degrades to empty.
 */

const PLANNER_PATH = '/aletler/avtobus-marsrutu';

interface CarrierRow { carrier: string; lines: number }
interface BusTransit {
  dataset: { lines: number; stops: number; hubs: number; carriers: number; avgLength: number; avgDuration: number; coords: number; routesGeo: number };
  carriers: CarrierRow[];
  views: { lifetime: number };
}

const EMPTY: BusTransit = {
  dataset: { lines: 0, stops: 0, hubs: 0, carriers: 0, avgLength: 0, avgDuration: 0, coords: 0, routesGeo: 0 },
  carriers: [],
  views: { lifetime: 0 },
};

const _fetch = unstable_cache(
  async (): Promise<BusTransit> => {
    const [ds, carrierRows, lifetimeRow] = await Promise.all([
      prisma.$queryRaw<[{ lines: bigint; stops: bigint; hubs: bigint; carriers: bigint; avg_len: number; avg_dur: number; coords: bigint; routes_geo: bigint }]>`
        SELECT (SELECT COUNT(*) FROM bus.bus_buses)::bigint AS lines,
               (SELECT COUNT(*) FROM bus.bus_stop_details)::bigint AS stops,
               (SELECT COUNT(*) FROM bus.bus_stop_details WHERE is_transport_hub)::bigint AS hubs,
               (SELECT COUNT(DISTINCT carrier) FROM bus.bus_buses)::bigint AS carriers,
               (SELECT COALESCE(AVG(route_length), 0) FROM bus.bus_buses WHERE route_length > 0)::float8 AS avg_len,
               (SELECT COALESCE(AVG(duration_minuts), 0) FROM bus.bus_buses WHERE duration_minuts > 0)::float8 AS avg_dur,
               (SELECT COUNT(*) FROM bus.bus_route_coordinates)::bigint AS coords,
               (SELECT COUNT(DISTINCT route_id) FROM bus.bus_route_coordinates)::bigint AS routes_geo
      `,
      prisma.$queryRaw<{ carrier: string; lines: bigint }[]>`
        SELECT COALESCE(NULLIF(carrier, ''), '(naməlum)') AS carrier, COUNT(*)::bigint AS lines
        FROM bus.bus_buses GROUP BY 1 ORDER BY lines DESC LIMIT 12
      `,
      prisma.$queryRaw<{ view_count: number }[]>`
        SELECT view_count FROM website.page_views WHERE path = ${PLANNER_PATH} LIMIT 1
      `,
    ]);

    const d = ds[0];
    return {
      dataset: {
        lines: Number(d?.lines ?? 0),
        stops: Number(d?.stops ?? 0),
        hubs: Number(d?.hubs ?? 0),
        carriers: Number(d?.carriers ?? 0),
        avgLength: Number(d?.avg_len ?? 0),
        avgDuration: Number(d?.avg_dur ?? 0),
        coords: Number(d?.coords ?? 0),
        routesGeo: Number(d?.routes_geo ?? 0),
      },
      carriers: carrierRows.map(r => ({ carrier: r.carrier, lines: Number(r.lines) })),
      views: {
        lifetime: Number(lifetimeRow[0]?.view_count ?? 0),
      },
    };
  },
  ['admin-bus-transit'],
  { revalidate: 300 },
);

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard) return guard;

  try {
    return NextResponse.json(await _fetch());
  } catch (error) {
    console.error('Admin bus-transit error:', error);
    return NextResponse.json(EMPTY);
  }
}
