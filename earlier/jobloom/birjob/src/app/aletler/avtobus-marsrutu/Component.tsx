"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Bus, ArrowDownUp, LocateFixed, Search, X, Footprints, Map as MapIcon, ListOrdered, Hand } from "lucide-react";
import type { StopDetail, RouteResult } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";
import { haversine } from "@/lib/busroute/geo";

const BusMap = dynamic(() => import("./BusMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-400">Xəritə yüklənir…</div>,
});

const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

function StopPicker({
  label, placeholder, stops, selected, onSelect, dotClass, active = false, onActivate,
}: {
  label: string; placeholder: string; stops: StopDetail[];
  selected: StopDetail | null; onSelect: (s: StopDetail | null) => void; dotClass: string;
  /** True when this field is the current map-tap target — gets a highlight ring. */
  active?: boolean; onActivate?: () => void;
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
        <button
          type="button"
          onClick={onActivate}
          className={`flex w-full items-center justify-between rounded-xl border bg-gray-50 px-3 py-3 text-left transition ${active ? "border-orange-400 ring-2 ring-orange-200" : "border-gray-200"}`}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-gray-900">{selected.name}</span>
            {selected.code ? <span className="text-xs text-gray-400">{selected.code}</span> : null}
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onSelect(null); setQuery(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onSelect(null); setQuery(""); } }}
            aria-label="Seçimi sil"
            className="ml-2 shrink-0 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </span>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            inputMode="search"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(true); onActivate?.(); }}
            placeholder={placeholder}
            className={`w-full rounded-xl border bg-white py-3 pl-9 pr-3 text-sm shadow-sm focus:border-orange-400 focus:ring-orange-400 ${active ? "border-orange-400 ring-2 ring-orange-200" : "border-gray-200"}`}
          />
          {open && filtered.length > 0 && (
            <div className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  // Select on click (a real tap) — NOT touchend. touchend fires
                  // even when the touch started here and then dragged to scroll
                  // the list, which used to auto-select a stop mid-scroll. click
                  // isn't dispatched after a scroll/drag, so this is scroll-safe.
                  // Safe from the outside-click handler since the dropdown lives
                  // inside this picker's ref (so it isn't pre-closed).
                  onClick={() => { onSelect(s); setQuery(""); setOpen(false); }}
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

type PickTarget = "from" | "to";

export default function Component() {
  const [stops, setStops] = useState<StopDetail[]>([]);
  const [fromStop, setFromStop] = useState<StopDetail | null>(null);
  const [toStop, setToStop] = useState<StopDetail | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  // Which field a map tap fills next ("from" first). Drives the pick-mode banner.
  const [pickTarget, setPickTarget] = useState<PickTarget>("from");
  // Mobile: one of the two panes is shown at a time (lg shows both side-by-side).
  const [mobileTab, setMobileTab] = useState<"panel" | "map">("panel");

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
      setMobileTab("panel"); // show the step-by-step result on mobile
    } catch {
      setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      setLoading(false);
    }
  }, [fromStop, toStop]);

  // Set a stop from the search dropdown, then advance the active target so the
  // next map tap / search naturally fills the OTHER field.
  const selectFrom = useCallback((s: StopDetail | null) => {
    setFromStop(s); setRoute(null); if (s) setPickTarget("to");
  }, []);
  const selectTo = useCallback((s: StopDetail | null) => {
    setToStop(s); setRoute(null); if (s) setPickTarget("from");
  }, []);

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
          setPickTarget("to");
        }
        setLocating(false);
      },
      () => { setError("Məkan alınmadı. İcazəni yoxlayın."); setLocating(false); },
      // Standard accuracy is plenty for "nearest stop" and avoids the GPS-grade
      // provider that makes Chrome/macOS retry (and spam kCLErrorLocationUnknown
      // to the console) when it can't get a precise fix on a desktop. A cached
      // fix up to 5 min old is fine and skips a fresh CoreLocation query.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }, [stops]);

  const handleSwap = useCallback(() => {
    setFromStop(toStop); setToStop(fromStop); setRoute(null);
  }, [fromStop, toStop]);

  // A map tap (on a marker OR snapped from empty map) fills the ACTIVE field,
  // then advances to the other one — so the user always knows what a tap does.
  const handleMapClick = useCallback((stop: StopDetail) => {
    setRoute(null);
    if (pickTarget === "from") {
      setFromStop(stop);
      setPickTarget(toStop ? "from" : "to");
    } else {
      setToStop(stop);
      setPickTarget("from");
    }
  }, [pickTarget, toStop]);

  // Both stops chosen → find automatically (no extra tap). Route stays cleared
  // until both are set again, so this can't loop.
  useEffect(() => {
    if (fromStop && toStop && !route && !loading) handleFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromStop, toStop]);

  const TabBtn = ({ id, icon, children }: { id: "panel" | "map"; icon: ReactNode; children: ReactNode }) => (
    <button
      onClick={() => setMobileTab(id)}
      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${mobileTab === id ? "bg-white text-orange-700 shadow-sm" : "text-gray-500"}`}
    >
      {icon}{children}
    </button>
  );

  return (
    <div>
      {/* Mobile pane switcher (lg shows both panes, so it's hidden there) */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 lg:hidden">
        <TabBtn id="panel" icon={<ListOrdered className="h-4 w-4" />}>Axtarış</TabBtn>
        <TabBtn id="map" icon={<MapIcon className="h-4 w-4" />}>Xəritə</TabBtn>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-4">
        {/* Controls / results pane */}
        <div className={`${mobileTab === "panel" ? "block" : "hidden"} space-y-3 lg:block`}>
          <button
            onClick={handleLocate}
            disabled={locating || stops.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
          >
            <LocateFixed className="h-4 w-4" />
            {locating ? "Məkan tapılır…" : "Yaxınımdakı dayanacaqdan başla"}
          </button>

          <StopPicker label="Haradan" placeholder="Başlanğıc dayanacağı axtar…" stops={stops} selected={fromStop} onSelect={selectFrom} dotClass="bg-green-600" active={pickTarget === "from"} onActivate={() => setPickTarget("from")} />

          <div className="flex justify-center">
            <button onClick={handleSwap} title="Dayanacaqları dəyiş" aria-label="Dayanacaqları dəyiş" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition hover:bg-gray-50">
              <ArrowDownUp className="h-4 w-4" />
            </button>
          </div>

          <StopPicker label="Hara" placeholder="Təyinat dayanacağı axtar…" stops={stops} selected={toStop} onSelect={selectTo} dotClass="bg-red-600" active={pickTarget === "to"} onActivate={() => setPickTarget("to")} />

          <button
            onClick={handleFind}
            disabled={!fromStop || !toStop || loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
          >
            {loading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Marşrut axtarılır…</>
                     : <><Bus className="h-4 w-4" /> Marşrutu tap</>}
          </button>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {route && (
            <>
              <button
                onClick={() => setMobileTab("map")}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 lg:hidden"
              >
                <MapIcon className="h-4 w-4" /> Nəticəni xəritədə gör
              </button>
              <JourneyView route={route} />
            </>
          )}
          {!route && !error && (
            <p className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
              <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Dayanacağın adını bilmirsiniz? «Xəritə»yə keçin və istədiyiniz yerə toxunun — ən yaxın dayanacaq avtomatik seçilir.
            </p>
          )}
        </div>

        {/* Map pane */}
        <div className={`${mobileTab === "map" ? "block" : "hidden"} lg:block`}>
          {/* Pick-mode banner — tells the user exactly what a map tap will do */}
          {!route ? (
            <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 p-2.5">
              <div className="mb-2 flex items-start gap-1.5 text-xs text-gray-600">
                <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
                <span>Xəritədə dayanacağa <strong>toxun</strong>, ya da boş yerə toxun — <strong>ən yaxın</strong> dayanacaq seçilir.</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPickTarget("from")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${pickTarget === "from" ? "border-green-500 bg-white text-green-700 ring-2 ring-green-200" : "border-gray-200 bg-white/60 text-gray-500"}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-600" />
                  Başlanğıc{fromStop ? " ✓" : ""}
                </button>
                <button
                  onClick={() => setPickTarget("to")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${pickTarget === "to" ? "border-red-500 bg-white text-red-700 ring-2 ring-red-200" : "border-gray-200 bg-white/60 text-gray-500"}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" />
                  Təyinat{toStop ? " ✓" : ""}
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-2.5">
              <span className="flex items-center gap-1.5 text-xs text-gray-600"><Bus className="h-3.5 w-3.5 text-orange-500" /> Marşrut xəritədə göstərilir.</span>
              <button
                onClick={() => { setRoute(null); setToStop(null); setPickTarget("to"); }}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Təyinatı dəyiş
              </button>
            </div>
          )}

          <div className="h-[64vh] min-h-[380px] overflow-hidden rounded-2xl border border-gray-200 lg:h-[600px]">
            <BusMap
              stops={stops}
              fromStop={fromStop}
              toStop={toStop}
              route={route}
              userLocation={userLocation}
              onStopClick={handleMapClick}
              isVisible={mobileTab === "map"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
