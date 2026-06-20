import 'server-only';
import { prisma } from '@/lib/prisma';
import { unstable_cache } from 'next/cache';

/**
 * Baku bus-route reads for the /avtobus SEO pages (#298). Backed by the bus.*
 * tables ported from Ayna open transport data (same source the
 * /aletler/avtobus-marsrutu planner uses). These pages target the exact
 * "<N> nömrəli avtobus" search demand (Google Trends AZ) that the planner —
 * an A→B tool — doesn't capture.
 */

export interface BusRoute {
  id: number;
  number: string;
  carrier: string;
  first_point: string;
  last_point: string;
  route_length: number;
  tariff_str: string;
  duration_minuts: number;
}

export interface BusStopRow {
  stop_name: string;
  direction_type_id: number;
  total_distance: number;
}

/** All distinct bus numbers (for the index + generateStaticParams). Numeric
 *  sort so "2" comes before "20", "125". */
const _getAllBusNumbersCached = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.bus_buses.findMany({ select: { number: true } });
    const nums = [...new Set(rows.map(r => r.number.trim()).filter(Boolean))];
    return nums.sort((a, b) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    });
  },
  ['bus-numbers'],
  { revalidate: 86400 },
);

/** Graceful degradation: try/catch OUTSIDE the cache so a transient DB error
 *  degrades the index to empty (not a 500) — and keeps generateStaticParams
 *  building safely — without caching the failure. */
export async function getAllBusNumbers(): Promise<string[]> {
  try {
    return await _getAllBusNumbersCached();
  } catch (err) {
    console.error('[getAllBusNumbers]', err instanceof Error ? err.message : err);
    return [];
  }
}

const _getBusByNumberCached = unstable_cache(
  async (number: string): Promise<BusRoute | null> => {
    const n = number.trim();
    if (!n) return null;
    // Case-insensitive: the DB stores letter-suffix routes upper-case ("88A",
    // "150E", "E1") but people search/link them lower-case ("88a", "150e",
    // "e1"). Without this, /avtobus/88a would 404 even though 88A exists.
    const b = await prisma.bus_buses.findFirst({
      where: { number: { equals: n, mode: 'insensitive' } },
      select: {
        id: true, number: true, carrier: true, first_point: true, last_point: true,
        route_length: true, tariff_str: true, duration_minuts: true,
      },
    });
    if (!b) return null;
    return {
      id: b.id,
      number: b.number.trim(),
      carrier: b.carrier.trim(),
      first_point: b.first_point.trim(),
      last_point: b.last_point.trim(),
      route_length: b.route_length,
      tariff_str: b.tariff_str.trim(),
      duration_minuts: b.duration_minuts,
    };
  },
  ['bus-by-number'],
  { revalidate: 86400 },
);

/** Graceful degradation: try/catch OUTSIDE the cache, FALLBACK null so a
 *  transient DB error degrades the route page to a 404 (caller notFound()s on
 *  null) rather than a 500 — and the failure isn't cached. */
export async function getBusByNumber(number: string): Promise<BusRoute | null> {
  try {
    return await _getBusByNumberCached(number);
  } catch (err) {
    console.error(`[getBusByNumber] ${number}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Ordered stops for a bus, grouped by direction. Returns the stop names for
 *  the primary direction (the one with the most stops — i.e. the full route),
 *  in travel order. */
const _getBusStopsCached = unstable_cache(
  async (busId: number): Promise<string[]> => {
    const rows = await prisma.bus_bus_stops.findMany({
      where: { bus_id: busId },
      select: { stop_name: true, direction_type_id: true, total_distance: true },
      orderBy: [{ direction_type_id: 'asc' }, { total_distance: 'asc' }],
    });
    if (rows.length === 0) return [];
    // Pick the direction with the most stops (the canonical full route).
    const byDir = new Map<number, BusStopRow[]>();
    for (const r of rows) {
      const arr = byDir.get(r.direction_type_id) ?? [];
      arr.push(r);
      byDir.set(r.direction_type_id, arr);
    }
    let best: BusStopRow[] = [];
    for (const arr of byDir.values()) if (arr.length > best.length) best = arr;
    // De-dupe consecutive identical names (data sometimes repeats a hub stop).
    const out: string[] = [];
    for (const r of best) {
      const name = r.stop_name.trim();
      if (name && name !== out[out.length - 1]) out.push(name);
    }
    return out;
  },
  ['bus-stops'],
  { revalidate: 86400 },
);

/** Graceful degradation: try/catch OUTSIDE the cache so a transient DB error
 *  renders the route page with no stop list (not a 500) without caching it. */
export async function getBusStops(busId: number): Promise<string[]> {
  try {
    return await _getBusStopsCached(busId);
  } catch (err) {
    console.error(`[getBusStops] ${busId}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
