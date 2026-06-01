"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { Bus, MapPin, ArrowDownUp, LocateFixed, Search, X, Footprints } from "lucide-react";
import type { StopDetail, RouteResult } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";
import { haversine } from "@/lib/busroute/geo";

const BusMap = dynamic(() => import("./BusMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-400">Xəritə yüklənir…</div>,
});

const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

function StopPicker({
  label, placeholder, stops, selected, onSelect, dotClass,
}: {
  label: string; placeholder: string; stops: StopDetail[];
  selected: StopDetail | null; onSelect: (s: StopDetail | null) => void; dotClass: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stops
      .filter((s) => s.name.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, stops]);

  useEffect(() => {
    function onOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, []);

  return (
    <div ref={ref}>
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />
        {label}
      </div>
      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-gray-900">{selected.name}</span>
            {selected.code ? <span className="text-xs text-gray-400">{selected.code}</span> : null}
          </span>
          <button onClick={() => { onSelect(null); setQuery(""); }} aria-label="Seçimi sil" className="ml-2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            inputMode="search"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm focus:border-orange-400 focus:ring-orange-400"
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={(e) => { e.preventDefault(); onSelect(s); setQuery(""); setOpen(false); }}
                  onTouchEnd={(e) => { e.preventDefault(); onSelect(s); setQuery(""); setOpen(false); }}
                  className="block w-full px-3 py-2 text-left hover:bg-orange-50"
                >
                  <span className="block truncate text-sm text-gray-800">{s.name}</span>
                  {s.code ? <span className="text-xs text-gray-400">{s.code}</span> : null}
                </button>
              ))}
            </div>
          )}
          {open && query.trim() && filtered.length === 0 && (
            <div className="absolute z-[1000] mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 shadow-lg">
              «{query}» üzrə dayanacaq tapılmadı
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JourneyView({ route }: { route: RouteResult }) {
  const first = route.segments[0]?.stops[0];
  const lastSeg = route.segments[route.segments.length - 1];
  const last = lastSeg?.stops[lastSeg.stops.length - 1];
  const busCount = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID).length;
  let busColorIdx = 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{route.totalDistance.toFixed(1)}</div>
          <div className="text-xs text-gray-400">km</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{Math.round(route.totalTime)}</div>
          <div className="text-xs text-gray-400">dəq (təxmini)</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{busCount === 1 ? "Birbaşa" : `${busCount} avtobus`}</div>
          <div className="text-xs text-gray-400">{route.totalTransfers === 0 ? "dəyişmə yox" : `${route.totalTransfers} dəyişmə`}</div>
        </div>
      </div>

      <ol className="space-y-2">
        <li className="flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-green-600" />
          <span className="font-medium text-gray-900">{first?.name}</span>
          <span className="text-xs text-gray-400">— Başlanğıc</span>
        </li>

        {route.segments.map((seg, idx) => {
          const isWalking = seg.busId === WALKING_EDGE_BUS_ID;
          const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
          if (!isWalking) busColorIdx++;
          const meters = Math.round(seg.distance * 1000);
          const nextIsBus = idx < route.segments.length - 1 && route.segments[idx + 1].busId !== WALKING_EDGE_BUS_ID;
          return (
            <li key={idx}>
              <div className="ml-1.5 flex items-start gap-3 border-l-2 py-1 pl-4" style={{ borderColor: color }}>
                {isWalking ? (
                  <span className="flex items-center gap-2 text-sm text-gray-600">
                    <Footprints className="h-4 w-4" />
                    Piyada {Math.round(seg.time)} dəq ({meters} m)
                  </span>
                ) : (
                  <span className="text-sm">
                    <span className="font-bold" style={{ color }}>Avtobus {seg.busNumber}</span>
                    <span className="ml-1 text-gray-500">· {seg.stops.length} dayanacaq · {seg.distance.toFixed(1)} km · {Math.round(seg.time)} dəq</span>
                  </span>
                )}
              </div>
              {!isWalking && nextIsBus && (
                <div className="flex items-center gap-2 py-1 text-sm">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-amber-500" />
                  <span className="text-gray-700">{seg.stops[seg.stops.length - 1]?.name}</span>
                  <span className="text-xs text-amber-600">— {route.segments[idx + 1]?.busNumber} avtobusuna dəyiş</span>
                </div>
              )}
            </li>
          );
        })}

        <li className="flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-red-600" />
          <span className="font-medium text-gray-900">{last?.name}</span>
          <span className="text-xs text-gray-400">— Təyinat</span>
        </li>
      </ol>
    </div>
  );
}

export default function Component() {
  const [stops, setStops] = useState<StopDetail[]>([]);
  const [fromStop, setFromStop] = useState<StopDetail | null>(null);
  const [toStop, setToStop] = useState<StopDetail | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    fetch("/api/avtobus/stops")
      .then((r) => r.json())
      .then((d) => setStops(d.stops || []))
      .catch(() => setError("Dayanacaqlar yüklənmədi. Yenidən cəhd edin."));
  }, []);

  const handleFind = useCallback(async () => {
    if (!fromStop || !toStop) return;
    setLoading(true); setError(null); setRoute(null);
    try {
      const res = await fetch("/api/avtobus/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStopId: fromStop.id, toStopId: toStop.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Marşrut tapılmadı"); return; }
      setRoute(data.route);
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setLoading(false);
    }
  }, [fromStop, toStop]);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) { setError("Brauzeriniz məkanı dəstəkləmir."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUserLocation({ lat, lng });
        if (stops.length) {
          let nearest = stops[0];
          let min = Infinity;
          for (const s of stops) {
            const d = haversine(lat, lng, s.latitude, s.longitude);
            if (d < min) { min = d; nearest = s; }
          }
          setFromStop(nearest);
        }
        setLocating(false);
      },
      () => { setError("Məkan alınmadı. İcazəni yoxlayın."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [stops]);

  const handleSwap = useCallback(() => {
    setFromStop(toStop); setToStop(fromStop); setRoute(null);
  }, [fromStop, toStop]);

  const handleMapClick = useCallback((stop: StopDetail) => {
    if (!fromStop) {
      setFromStop(stop);
    } else if (!toStop) {
      setToStop(stop);
    } else {
      setFromStop(stop);
      setToStop(null);
      setRoute(null);
    }
  }, [fromStop, toStop]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      {/* Controls */}
      <div className="space-y-3">
        <button
          onClick={handleLocate}
          disabled={locating || stops.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
        >
          <LocateFixed className="h-4 w-4" />
          {locating ? "Məkan tapılır…" : "Yaxınımdakı dayanacaqdan başla"}
        </button>

        <StopPicker label="Haradan" placeholder="Başlanğıc dayanacağı axtar…" stops={stops} selected={fromStop} onSelect={setFromStop} dotClass="bg-green-600" />

        <div className="flex justify-center">
          <button onClick={handleSwap} title="Dayanacaqları dəyiş" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-50">
            <ArrowDownUp className="h-4 w-4" />
          </button>
        </div>

        <StopPicker label="Hara" placeholder="Təyinat dayanacağı axtar…" stops={stops} selected={toStop} onSelect={setToStop} dotClass="bg-red-600" />

        <button
          onClick={handleFind}
          disabled={!fromStop || !toStop || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Marşrut axtarılır…</>
                   : <><Bus className="h-4 w-4" /> Marşrutu tap</>}
        </button>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {route && <JourneyView route={route} />}
        {!route && !error && (
          <p className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Xəritədən dayanacağa toxunaraq da seçə bilərsiniz. Vaxt təxminidir (cədvəl/real-vaxt deyil).
          </p>
        )}
      </div>

      {/* Map */}
      <div className="h-[60vh] min-h-[360px] overflow-hidden rounded-2xl border border-gray-200 lg:h-[640px]">
        <BusMap
          stops={stops}
          fromStop={fromStop}
          toStop={toStop}
          route={route}
          userLocation={userLocation}
          onStopClick={handleMapClick}
          isVisible
        />
      </div>
    </div>
  );
}
