'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Bus } from 'lucide-react';
import FrozenSeriesNote from './FrozenSeriesNote';
import { adminFetch } from '@/lib/adminFetch';

/**
 * Bus / Transit-Tool Usage (bonus) over /api/admin/bus-transit. Two honest parts:
 * the bus.* DATASET composition (static import — no usage timeline) and the
 * route-planner PAGE-VIEW trend (the only real usage signal). No per-route view
 * breakdown exists (the /avtobus/<N> pages were removed). Aggregate-only.
 */

interface DailyRow { day: string; views: number }
interface DimRow { key: string; visitors: number }
interface CarrierRow { carrier: string; lines: number }
interface BusTransit {
  /** #599: false when in-house event logging is off. The CUMULATIVE figures
   *  on this panel are still written and stay accurate; only the windowed
   *  series is frozen. Absent on an older cached response, so callers test
   *  `=== false`. */
  eventLoggingEnabled?: boolean;
  windowDays: number;
  dataset: { lines: number; stops: number; hubs: number; carriers: number; avgLength: number; avgDuration: number; coords: number; routesGeo: number; walkEdges: number };
  carriers: CarrierRow[];
  views: { window: number; visitors: number; lifetime: number };
  daily: DailyRow[];
  byCountry: DimRow[];
  byDevice: DimRow[];
}

const n = (x: number) => x.toLocaleString('en-US');
const WINDOWS = [7, 30, 90] as const;

export default function BusTransitPanel() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [d, setD] = useState<BusTransit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (w: number) => {
    setLoading(true);
    try {
      const r = await adminFetch(`/api/admin/bus-transit?window=${w}`);
      if (!r.ok) { setError('Failed to load bus transit'); return; }
      setD(await r.json());
      setError(null);
    } catch {
      setError('Network error loading bus transit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(windowDays); }, [load, windowDays]);
  useEffect(() => {
    const cb = () => load(windowDays);
    window.addEventListener('admin:refresh', cb);
    return () => window.removeEventListener('admin:refresh', cb);
  }, [load, windowDays]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2"><Bus className="h-4 w-4 text-orange-400" /> Avtobus Alət</h2>
          <p className="text-xs text-gray-500 mt-0.5">Transit dataset composition + route-planner page usage.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center bg-gray-800 border border-gray-700 rounded-lg p-0.5 text-xs">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setWindowDays(w)}
                className={`px-3 py-1.5 rounded-md font-medium ${windowDays === w ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-100'}`}>{w}d</button>
            ))}
          </div>
          <button onClick={() => load(windowDays)} disabled={loading} className="text-xs text-gray-400 hover:text-gray-100 inline-flex items-center gap-1">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-300">{error}</div>}

      {!d && !error ? (
        <div className="text-gray-500 text-sm py-12 text-center"><RefreshCw className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
      ) : d && (
        <>
          <section className="rounded-xl border border-gray-700 bg-gray-900 p-4">
            <h3 className="text-sm font-bold text-gray-100 mb-3">Dataset composition <span className="text-[10px] font-normal text-gray-500">(static — periodic Ayna import)</span></h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile label="Bus lines" value={n(d.dataset.lines)} emphasis />
              <Tile label="Stops" value={n(d.dataset.stops)} sub={`${n(d.dataset.hubs)} hubs`} />
              <Tile label="Carriers" value={n(d.dataset.carriers)} />
              <Tile label="Avg length" value={`${d.dataset.avgLength.toFixed(1)} km`} />
              <Tile label="Avg duration" value={`${Math.round(d.dataset.avgDuration)} dəq`} />
              <Tile label="Routes w/ geo" value={n(d.dataset.routesGeo)} sub={`${n(d.dataset.coords)} points`} />
            </div>
          </section>

          {/* #599 — the note said "The planner-usage trend" and sat in the header,
              where it disclaimed the dataset composition above (bus.*, a periodic
              Ayna import, entirely live) and did not reach the two tiles it should
              have. Planner views and Visitors are the SAME query as the trend:
              /api/admin/bus-transit counts them from website.web_event_logs
              (event='page_view', path='/aletler/avtobus-marsrutu'), which has had no
              writer since the 2026-08-29 event-logging retirement. "Lifetime views"
              beside them is website.page_views, still upserted by /api/views, and
              stays a live headline.
              Emphasis is conditional for the same reason the note exists: a frozen 0
              must not be painted like a measurement. Flip EVENT_LOGGING_ENABLED back
              to true in src/lib/eventLogging.ts and both the number and its styling
              are correct again with no other change. */}
          {d.eventLoggingEnabled === false && (
            <FrozenSeriesNote what={`The “Planner views (${windowDays}d)” and “Visitors” tiles below, and the views/day trend under them`} />
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label={`Planner views (${windowDays}d)`} value={n(d.views.window)} emphasis={d.eventLoggingEnabled !== false} />
            <Tile label="Visitors" value={n(d.views.visitors)} />
            <Tile label="Lifetime views" value={n(d.views.lifetime)} sub="all-time" />
            <Tile label="Walking edges" value={n(d.dataset.walkEdges)} sub="≤300m transfers" />
          </div>

          <MiniBars title={`Route-planner views / day (${windowDays}d)`} rows={d.daily} windowDays={windowDays} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <DimList title="Carriers" rows={d.carriers.map(c => ({ key: c.carrier, visitors: c.lines }))} unit="lines" />
            {/* The two planner breakdowns are dropped while logging is off rather
                than captioned. Both are GROUP BY over the same dead
                website.web_event_logs rows, so they rendered "No data." — which
                reads as a measured result (incidents §1.5) when it is the absence
                of a writer. A country or device split of zero rows has no honest
                reading: there is no number to qualify, so there is nothing a note
                could rescue. Carriers is bus.bus_buses and is live, so it stays.
                `!== false`, not truthiness: the field is absent on an older cached
                response and must not blank a live breakdown. */}
            {d.eventLoggingEnabled !== false && (
              <>
                <DimList title="Planner — by country" rows={d.byCountry} unit="visitors" />
                <DimList title="Planner — by device" rows={d.byDevice} unit="visitors" />
              </>
            )}
          </div>

          <p className="text-[11px] text-gray-600 italic">
            The bus.* dataset is a periodic import (no per-view history), so composition figures are point-in-time tiles, not a trend. The only usage signal is route-planner page views (<span className="font-mono">/aletler/avtobus-marsrutu</span>), client-side & bot-filtered → a lower bound. There is no per-route view breakdown (the individual bus-number pages were retired).
          </p>
        </>
      )}
    </div>
  );
}

function DimList({ title, rows, unit }: { title: string; rows: { key: string; visitors: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map(r => r.visitors));
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900 p-4">
      <h3 className="text-sm font-bold text-gray-100 mb-3">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-gray-500 italic">No data.</p> : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.key} className="text-sm">
              <div className="flex items-center justify-between gap-3 mb-0.5">
                <span className="min-w-0 truncate text-gray-300 text-xs">{r.key}</span>
                <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">{n(r.visitors)} {unit}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div className="h-full bg-orange-500/70 rounded-full" style={{ width: `${(r.visitors / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MiniBars({ title, rows, windowDays }: { title: string; rows: DailyRow[]; windowDays: number }) {
  const max = Math.max(1, ...rows.map(r => r.views));
  const total = rows.reduce((s, r) => s + r.views, 0);
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900 p-4">
      <h3 className="text-sm font-bold text-gray-100 mb-3">{title}</h3>
      {total === 0 ? (
        <p className="text-xs text-gray-500 italic">No planner views in this window.</p>
      ) : (
        <>
          <div className="flex items-end gap-px h-28" role="img" aria-label={title}>
            {rows.map(r => (
              <div key={r.day} className="flex-1 min-w-0 flex flex-col justify-end h-full" title={`${r.day}: ${n(r.views)} views`}>
                <div className="bg-orange-500/70 rounded-t-sm" style={{ height: `${(r.views / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mt-1.5">
            <span>{rows[0]?.day}</span>
            <span>{n(total)} over {windowDays}d</span>
            <span>{rows[rows.length - 1]?.day}</span>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub, emphasis }: { label: string; value: string; sub?: string; emphasis?: boolean }) {
  const ring = emphasis ? 'border-orange-700/50 bg-orange-900/15' : 'border-gray-700 bg-gray-900';
  const txt = emphasis ? 'text-orange-300' : 'text-gray-100';
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className={`text-2xl font-extrabold mt-1 tabular-nums ${txt}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
