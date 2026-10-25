import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { isEventLoggingEnabled } from '@/lib/eventLogging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bus / Transit-Tool Usage (bonus, thin by nature). Two honest parts:
 *  - DATASET composition (static): the bus.* schema is a periodic Ayna import with
 *    NO usage timeline (bus_buses.created_at is bulk-import time; the other tables
 *    have no timestamp). So dataset metrics are point-in-time tiles, never a trend.
 *  - PLANNER usage (windowed): the only real usage signal is web_event_logs
 *    page_view rows for the route-planner page (exact path /aletler/avtobus-marsrutu).
 *    The old /avtobus/<N> SEO pages were deleted 2026-07-19 (301'd), so there is NO
 *    per-route view breakdown to build — don't fabricate one from decaying paths.
 * Aggregate-only. Cached 5-min, requireAdmin, degrades to empty.
 */

const PLANNER_PATH = '/aletler/avtobus-marsrutu';

interface DailyRow { day: string; views: number }
interface DimRow { key: string; visitors: number }
interface CarrierRow { carrier: string; lines: number }
interface BusTransit {
  windowDays: number;
  dataset: { lines: number; stops: number; hubs: number; carriers: number; avgLength: number; avgDuration: number; coords: number; routesGeo: number };
  carriers: CarrierRow[];
  views: { window: number; visitors: number; lifetime: number };
  daily: DailyRow[];
  byCountry: DimRow[];
  byDevice: DimRow[];
}

const EMPTY = (windowDays: number): BusTransit => ({
  windowDays,
  dataset: { lines: 0, stops: 0, hubs: 0, carriers: 0, avgLength: 0, avgDuration: 0, coords: 0, routesGeo: 0 },
  carriers: [],
  views: { window: 0, visitors: 0, lifetime: 0 },
  daily: [], byCountry: [], byDevice: [],
});

const _fetch = unstable_cache(
  async (windowDays: number): Promise<BusTransit> => {
    const since = new Date(Date.now() - (windowDays - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const [ds, carrierRows, viewsRow, lifetimeRow, dailyRows, byCountry, byDevice] = await Promise.all([
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
      prisma.$queryRaw<[{ total: bigint; visitors: bigint }]>`
        SELECT COUNT(*)::bigint AS total, COUNT(DISTINCT anonymous_id)::bigint AS visitors
        FROM website.web_event_logs
        WHERE created_at >= ${since} AND is_bot = FALSE AND event = 'page_view' AND path = ${PLANNER_PATH}
      `,
      prisma.$queryRaw<{ view_count: number }[]>`
        SELECT view_count FROM website.page_views WHERE path = ${PLANNER_PATH} LIMIT 1
      `,
      prisma.$queryRaw<{ day: Date; c: bigint }[]>`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS c
        FROM website.web_event_logs
        WHERE created_at >= ${since} AND is_bot = FALSE AND event = 'page_view' AND path = ${PLANNER_PATH}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<{ key: string; visitors: bigint }[]>`
        SELECT COALESCE(NULLIF(country, ''), '(naməlum)') AS key, COUNT(DISTINCT anonymous_id)::bigint AS visitors
        FROM website.web_event_logs
        WHERE created_at >= ${since} AND is_bot = FALSE AND event = 'page_view' AND path = ${PLANNER_PATH}
        GROUP BY 1 ORDER BY visitors DESC LIMIT 8
      `,
      prisma.$queryRaw<{ key: string; visitors: bigint }[]>`
        SELECT COALESCE(NULLIF(device, ''), '(naməlum)') AS key, COUNT(DISTINCT anonymous_id)::bigint AS visitors
        FROM website.web_event_logs
        WHERE created_at >= ${since} AND is_bot = FALSE AND event = 'page_view' AND path = ${PLANNER_PATH}
        GROUP BY 1 ORDER BY visitors DESC
      `,
    ]);

    const byDay = new Map(dailyRows.map(r => [r.day.toISOString().slice(0, 10), Number(r.c)]));
    const daily: DailyRow[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      daily.push({ day: key, views: byDay.get(key) ?? 0 });
    }

    const d = ds[0];
    const map = (rows: { key: string; visitors: bigint }[]): DimRow[] => rows.map(r => ({ key: r.key, visitors: Number(r.visitors) }));
    return {
      windowDays,
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
        window: Number(viewsRow[0]?.total ?? 0),
        visitors: Number(viewsRow[0]?.visitors ?? 0),
        lifetime: Number(lifetimeRow[0]?.view_count ?? 0),
      },
      daily,
      byCountry: map(byCountry),
      byDevice: map(byDevice),
    };
  },
  ['admin-bus-transit'],
  { revalidate: 300 },
);

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (guard) return guard;

  const raw = Number(new URL(request.url).searchParams.get('window'));
  const windowDays = raw === 7 || raw === 90 ? raw : 30;

  try {
    // #599 — THIS PANEL IS HALF-ALIVE, so unlike behavior/geo-device/attribution
    // it is NOT short-circuited: its cumulative counters are still being
    // written and are worth showing. Only the WINDOWED series below comes from
    // website.web_event_logs, which has had no writer since 2026-08-29.
    //
    // The split is the one this route's own header already draws. /api/track
    // fires a logEvent() that is swallowed, but its after() block was never
    // gated and keeps incrementing job_state.view_count/click_count,
    // blog_post.view_count and ad_banner.click_count — so the lifetime numbers
    // grew while the timestamped rows stopped. Half of every chart here updates
    // and half is frozen, with nothing on screen saying which, which is the most
    // misleading shape of the three (incidents §1.5).
    //
    // So: report the flag and let the panel caption the dead half. Deliberately
    // NOT zeroing or hiding the live half — that would throw away real data to
    // tidy up a label.
    return NextResponse.json({ ...(await _fetch(windowDays)), eventLoggingEnabled: isEventLoggingEnabled() });
  } catch (error) {
    console.error('Admin bus-transit error:', error);
    return NextResponse.json({ ...EMPTY(windowDays), eventLoggingEnabled: isEventLoggingEnabled() });
  }
}
