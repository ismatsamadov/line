'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Bus } from 'lucide-react';
import { adminFetch } from '@/lib/adminFetch';

/**
 * Bus / Transit-Tool Usage (bonus) over /api/admin/bus-transit. Two honest parts:
 * the bus.* DATASET composition (static import — no usage timeline) and the
 * route planner's lifetime page views. No per-route view breakdown exists (the
 * /avtobus/<N> pages were removed). Aggregate-only. The windowed planner usage
 * (views per day, visitors, by country and by device) read website.web_event_logs,
 * which has had no writer since 2026-08-29; it was removed on 2026-11-15, and with
 * it the 7/30/90-day toggle, which had nothing left to change.
 */

interface CarrierRow { carrier: string; lines: number }
interface BusTransit {
  dataset: { lines: number; stops: number; hubs: number; carriers: number; avgLength: number; avgDuration: number; coords: number; routesGeo: number };
  carriers: CarrierRow[];
  views: { lifetime: number };
}

const n = (x: number) => x.toLocaleString('en-US');

export default function BusTransitPanel() {
  const [d, setD] = useState<BusTransit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch('/api/admin/bus-transit');
      if (!r.ok) { setError('Failed to load bus transit'); return; }
      setD(await r.json());
      setError(null);
    } catch {
      setError('Network error loading bus transit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const cb = () => load();
    window.addEventListener('admin:refresh', cb);
    return () => window.removeEventListener('admin:refresh', cb);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2"><Bus className="h-4 w-4 text-orange-400" /> Avtobus Alət</h2>
          <p className="text-xs text-gray-500 mt-0.5">Transit dataset composition + route-planner page views.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => load()} disabled={loading} className="text-xs text-gray-400 hover:text-gray-100 inline-flex items-center gap-1">
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Tile label="Lifetime views" value={n(d.views.lifetime)} sub="all-time" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <DimList title="Carriers" rows={d.carriers.map(c => ({ key: c.carrier, visitors: c.lines }))} unit="lines" />
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
