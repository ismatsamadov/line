"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Bus, ArrowDownUp, LocateFixed, Search, Map as MapIcon, ListOrdered, Hand, Route, ArrowRight, MapPin, Info, RotateCcw, ChevronRight } from "lucide-react";
import SupportCTA from "@/components/SupportCTA";
import type { StopDetail, RouteResult, BusLite, BusLineDetail } from "@/lib/busroute/types";
import type { JourneyBikeParking } from "@/lib/busroute/bike";
import type { PlaceMatch } from "@/lib/busroute/places";
import { ACCESS_RADIUS_KM } from "@/lib/busroute/access";
import { isBakuCoordinate } from "@/lib/busroute/geo";
import JourneyView from "./JourneyView";
import Picker, { type PickerItem } from "./Picker";
import { coarsePoint, nearestStop, searchBuses, suggestEnds } from "./search";
import { usePlaceSearch } from "./usePlaceSearch";
import { movementMinutes } from "./journeyFormatting";
import type { MapPlace } from "./BusMap";
import { END_COLORS, PLACE_PIN_PATH } from "./mapMarks";

const BusMap = dynamic(() => import("./BusMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-gray-100 text-sm text-gray-400">Xəritə yüklənir…</div>,
});

/**
 * A named place, or the person's location (id HERE), chosen as the start or the
 * destination (#720). The journey is asked for from or to the point itself, and the
 * server walks it to whichever stops near it make the journey cheapest, counting the walk.
 */
interface ChosenPlace { id: string; name: string; label: string; latitude: number; longitude: number }
type Point = { latitude: number; longitude: number };
type EndItem = PickerItem & { stop?: StopDetail; place?: PlaceMatch };

const HERE = "here";
const HERE_NAME = "Sizin yeriniz";

const metres = (km: number) => Math.round(km * 1000);
const stopDetail = (stop: StopDetail) => stop.code ? `Dayanacaq · Kod: ${stop.code}` : "Avtobus dayanacağı";

// A stop's name for the place texts; the reference data has stops without one.
const stopName = (stop: StopDetail) => stop.name.trim() || (stop.code ? `kodu ${stop.code}` : "adsız dayanacaq");
/** The walk from a place to the stop that stands for it, distance first: on a phone the
 *  line is cut at the end, and the stop's name matters least. */
const stopNote = (stop: StopDetail, km: number) => `dayanacağa ${metres(km)} m: ${stopName(stop)}`;

/** The stop nearest a point within a journey's walk from it (ACCESS_RADIUS_KM), among
 *  the stops with a name: the snapshot's 385 nameless stops are the ones no bus serves,
 *  which the planner never walks a place to either (#720). */
const servedStopNear = (named: StopDetail[], point: Point) => nearestStop(named, point.latitude, point.longitude, ACCESS_RADIUS_KM);

/** A place in the list: the other name that found it, its kind, and the stop nearest it
 *  within a journey's walk, so a chain's branches can be told apart. */
function placeDetail(place: PlaceMatch, near: ReturnType<typeof servedStopNear>): string {
  const stop = near ? stopNote(near.stop, near.distance) : `${metres(ACCESS_RADIUS_KM)} m-də dayanacaq yoxdur`;
  return [place.alias && `«${place.alias}»`, place.label, stop].filter(Boolean).join(" · ");
}

/** The point sent for a chosen place, or the stop's id (POST /api/avtobus/find). */
const journeyEnd = (side: "from" | "to", place: ChosenPlace | null, stop: StopDetail | null) => place
  ? { [side]: { latitude: place.latitude, longitude: place.longitude, name: place.name } }
  : { [`${side}StopId`]: stop?.id };

/** A start or destination: a stop, a named place, or the person's location. */
function EndPicker({ label, stops, selected, place, onSelectStop, onSelectPlace, active, onActivate, loading, near }: {
  label: string; stops: StopDetail[]; selected: StopDetail | null; place: ChosenPlace | null;
  onSelectStop: (stop: StopDetail | null) => void; onSelectPlace: (place: PlaceMatch) => void;
  active: boolean; onActivate: () => void; loading: boolean; near: Point | null;
}) {
  const [query, setQuery] = useState("");
  const places = usePlaceSearch(query, near);
  const named = useMemo(() => stops.filter(stop => stop.name.trim()), [stops]);
  const search = useCallback((q: string): EndItem[] => {
    // A new query's list waits, briefly, for its places (usePlaceSearch's holding): shown
    // first, the stops could not move for them afterwards, and "gənclik" listed its
    // station thirteenth, under the streets named after it.
    if (places.holding) return [];
    // A place with no stop within a journey's walk can only be walked to, so it is listed
    // after every place a journey can reach, and says why.
    const nearby = new Map(places.places.map(place => [place.id, servedStopNear(named, place)]));
    return suggestEnds(stops, q, places.places, place => !!nearby.get(place.id)).map((found): EndItem => found.kind === "stop"
      ? { key: `s${found.stop.id}`, name: found.stop.name, detail: stopDetail(found.stop), kind: "stop", stop: found.stop }
      : { key: `p${found.place.id}`, name: found.place.name, detail: placeDetail(found.place, nearby.get(found.place.id) ?? null), kind: "place", place: found.place });
  }, [stops, named, places.places, places.holding]);
  const shown: PickerItem | null = place
    ? { key: `p${place.id}`, name: place.name, detail: place.label, kind: place.id === HERE ? "here" : "place" }
    : selected ? { key: `s${selected.id}`, name: selected.name, detail: stopDetail(selected), kind: "stop" } : null;
  // Wherever places are listed, their data is credited (ODbL); a failed search says so.
  const footer = places.degraded
    ? <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-amber-800">Məkan axtarışı hazırda işləmir. Dayanacaqları adı və ya kodu ilə axtara bilərsiniz.</p>
    : places.places.length > 0
      ? <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">Məkanlar: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">© OpenStreetMap iştirakçıları</a></p>
      : null;
  return <Picker<EndItem> label={label} placeholder="Dayanacaq, məkan və ya kod…" searchItems={search} selected={shown}
    onSelect={item => item?.place ? onSelectPlace(item.place) : onSelectStop(item?.stop ?? null)}
    onQueryChange={setQuery} pending={places.pending} footer={footer}
    {...{ active, onActivate, loading }} emptyHint="Əsas dayanacaqlar · dayanacaq və ya məkan adı yazın"
    icon={<span className={`h-2.5 w-2.5 rounded-full ${label === "Haradan" ? "bg-green-600" : "bg-red-600"}`} />} />;
}

function BusPicker({ buses, selected, onSelect, loading }: {
  buses: BusLite[]; selected: BusLite | null; onSelect: (bus: BusLite | null) => void; loading: boolean;
}) {
  const search = useCallback((query: string) => searchBuses(buses, query).map(bus => ({
    key: String(bus.id), name: `${bus.first_point} → ${bus.last_point}`, detail: "Avtobus xətti", badge: bus.number, bus,
  })), [buses]);
  return <Picker label="Avtobus nömrəsi" placeholder="Məsələn: 88, H1 və ya son dayanacaq" searchItems={search}
    selected={selected ? { key: String(selected.id), name: `${selected.first_point} → ${selected.last_point}`, detail: "Xətti dəyişmək üçün toxunun", badge: selected.number } : null}
    onSelect={item => onSelect(item?.bus ?? null)} loading={loading}
    emptyHint="Avtobuslar · nömrə və ya son dayanacaqla axtarın" icon={<Bus className="h-4 w-4 text-blue-600" />} />;
}

/** Line summary: number, endpoints, stats, and the full ordered stop list. */
function LineSummary({ line }: { line: BusLineDetail }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-blue-600 px-2.5 py-1 text-sm font-extrabold text-white">{line.number}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-medium text-gray-800">
          {line.stops[0]?.name ?? line.first_point} <ArrowRight className="h-3.5 w-3.5 text-gray-400" /> {line.stops[line.stops.length - 1]?.name ?? line.last_point}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{line.stops.length}</div>
          <div className="text-xs text-gray-400">dayanacaq</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{line.route_length || "—"}</div>
          <div className="text-xs text-gray-400">km</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{line.duration_minuts || "—"}</div>
          <div className="text-xs text-gray-400">dəq (tam)</div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-gray-500">Tam xətt üçün təxmini hərəkət vaxtı. Gözləmə və tıxac daxil deyil.</p>

      {line.stops.length > 0 && (
        <ol className="mt-4 space-y-0">
          {line.stops.map((s, i) => {
            const isFirst = i === 0, isLast = i === line.stops.length - 1;
            return (
              <li key={`${s.id}-${i}`} className="flex items-start gap-3">
                <span className="flex flex-col items-center self-stretch">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white ${isFirst ? "bg-green-600" : isLast ? "bg-red-600" : "bg-blue-500"}`} style={{ boxShadow: "0 0 0 1px rgb(203 213 225)" }} />
                  {!isLast && <span className="w-0.5 flex-1 bg-blue-200" />}
                </span>
                <span className={`pb-3 text-sm ${isFirst || isLast ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                  {s.name}
                  {isFirst && <span className="ml-1 text-xs font-normal text-green-600">— Başlanğıc</span>}
                  {isLast && <span className="ml-1 text-xs font-normal text-red-600">— Son</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

type PickTarget = "from" | "to";
type PlannerMode = "route" | "line";
type MobileTab = "panel" | "map";

/**
 * Mobile pane switcher button. Module scope on purpose — declared inside
 * Component() it would be a new function identity on every render, so React would
 * unmount and re-mount both buttons on every keystroke, fetch and map tap instead
 * of updating them in place.
 */
function TabBtn({ id, icon, active, onSelect, children }: {
  id: MobileTab; icon: ReactNode; active: boolean;
  onSelect: (id: MobileTab) => void; children: ReactNode;
}) {
  return (
    <button
      type="button" aria-pressed={active} onClick={() => onSelect(id)}
      className={`flex items-center justify-center gap-1.5 min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition ${active ? "bg-white text-orange-700 shadow-sm" : "text-gray-500"}`}
    >
      {icon}{children}
    </button>
  );
}

export default function Component() {
  const [stops, setStops] = useState<StopDetail[]>([]);
  const [stopsLoading, setStopsLoading] = useState(true);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const locationReqRef = useRef(0);
  const [fromStop, setFromStop] = useState<StopDetail | null>(null);
  const [toStop, setToStop] = useState<StopDetail | null>(null);
  // A named place or the person's location chosen instead of a stop (#720): an end is
  // one or the other, never both.
  const [fromPlace, setFromPlace] = useState<ChosenPlace | null>(null);
  const [toPlace, setToPlace] = useState<ChosenPlace | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  // The racks beside the route's first boarding and last alighting (#692).
  const [bikeParking, setBikeParking] = useState<JourneyBikeParking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeReqRef = useRef(0);
  const [locating, setLocating] = useState(false);
  // Which field a map tap fills next ("from" first). Drives the pick-mode banner.
  const [pickTarget, setPickTarget] = useState<PickTarget>("from");
  // Mobile: one of the two panes is shown at a time (lg shows both side-by-side).
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [mapRequested, setMapRequested] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("panel");
  const resultRef = useRef<HTMLDivElement>(null);
  // Two modes: point-to-point route finder (default) OR view one bus line's full trajectory.
  const [mode, setMode] = useState<PlannerMode>("route");

  // Line-viewer state (lazy — buses load only when the user enters line mode).
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [busesLoading, setBusesLoading] = useState(false);
  const [lineBus, setLineBus] = useState<BusLite | null>(null);
  const [line, setLine] = useState<BusLineDetail | null>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  // Monotonic request id — a resolving fetch only writes state if it's still the
  // latest (so clearing/switching the bus mid-load can't resurrect a stale line).
  const lineReqRef = useRef(0);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const loadDesktopMap = () => { if (desktop.matches) setMapRequested(true); };
    loadDesktopMap();
    desktop.addEventListener("change", loadDesktopMap);
    return () => desktop.removeEventListener("change", loadDesktopMap);
  }, []);

  useEffect(() => {
    if (mobileTab === "map") setMapRequested(true);
  }, [mobileTab]);

  useEffect(() => {
    if (!route || window.matchMedia("(min-width: 1024px)").matches) return;
    resultRef.current?.scrollIntoView({
      block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [route]);

  const clearRoute = useCallback(() => {
    routeReqRef.current++;
    locationReqRef.current++;
    setLocating(false);
    setRoute(null); setBikeParking(null); setLoading(false); setError(null);
  }, []);

  const loadStops = useCallback(async () => {
    setStopsLoading(true); setStopsError(null);
    try {
      const response = await fetch("/api/avtobus/stops");
      if (!response.ok) throw new Error("stops");
      const data = await response.json();
      if (!Array.isArray(data.stops) || !data.stops.length) throw new Error("empty stops");
      setStops(data.stops);
    } catch {
      setStopsError("Dayanacaqlar yüklənmədi. İnternet bağlantınızı yoxlayıb yenidən cəhd edin.");
    } finally { setStopsLoading(false); }
  }, []);

  useEffect(() => { void loadStops(); }, [loadStops]);

  const handleFind = useCallback(async () => {
    if (!(fromStop || fromPlace) || !(toStop || toPlace)) return;
    if (fromPlace && toPlace ? fromPlace.id === toPlace.id : !fromPlace && !toPlace && fromStop?.id === toStop?.id) {
      setError("Başlanğıc və təyinat eynidir. Başqa təyinat seçin.");
      return;
    }
    const requestId = ++routeReqRef.current;
    setLoading(true); setError(null); setRoute(null); setBikeParking(null);
    try {
      // A place or the person's location goes as its point, and the journey's walks from
      // it and to it are counted (#720).
      const res = await fetch("/api/avtobus/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...journeyEnd("from", fromPlace, fromStop), ...journeyEnd("to", toPlace, toStop) }),
      });
      const data = await res.json();
      if (requestId !== routeReqRef.current) return;
      if (!res.ok) { setError(data.error || "Marşrut tapılmadı"); return; }
      setRoute(data.route);
      setBikeParking(data.bikeParking ?? null);
      setMobileTab("panel"); // show the step-by-step result on mobile
    } catch {
      if (requestId === routeReqRef.current) setError("Şəbəkə xətası. Yenidən cəhd edin.");
    } finally {
      if (requestId === routeReqRef.current) setLoading(false);
    }
  }, [fromStop, toStop, fromPlace, toPlace]);

  // Set a stop from the search dropdown, then advance the active target so the
  // next map tap / search naturally fills the OTHER field.
  const selectFrom = useCallback((s: StopDetail | null) => {
    clearRoute(); setFromPlace(null); setFromStop(s); if (s) setPickTarget("to");
  }, [clearRoute]);
  const selectTo = useCallback((s: StopDetail | null) => {
    clearRoute(); setToPlace(null); setToStop(s); if (s) setPickTarget("from");
  }, [clearRoute]);

  // A named place, or the person's location, is an end of its own: the journey walks
  // from it or to it, to whichever stops suit the journey (#720).
  const choosePlace = useCallback((end: PickTarget, place: ChosenPlace) => {
    clearRoute();
    if (end === "from") { setFromStop(null); setFromPlace(place); setPickTarget("to"); }
    else { setToStop(null); setToPlace(place); setPickTarget("from"); }
  }, [clearRoute]);
  const choosePlaceMatch = useCallback((end: PickTarget, { id, name, label, latitude, longitude }: PlaceMatch) => {
    choosePlace(end, { id, name, label, latitude, longitude });
  }, [choosePlace]);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) { setError("Brauzeriniz məkanı dəstəkləmir. Dayanacağı adla və ya xəritədən seçin."); return; }
    const requestId = ++locationReqRef.current;
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (requestId !== locationReqRef.current) return;
        const { latitude, longitude, accuracy } = pos.coords;
        setLocating(false);
        // The planner routes only inside the bus network's area, as the server checks too.
        if (!isBakuCoordinate(latitude, longitude)) {
          setError("Olduğunuz yer Bakı və ətrafının avtobus şəbəkəsindən kənardadır. Başlanğıcı adla və ya xəritədən seçin.");
          return;
        }
        // A position from Wi-Fi or the network can be kilometres out. Less sure than the
        // walk a journey takes to its first stop, it could start the journey at the wrong
        // stops while timing their walks to the minute, so it is not used.
        if (!(accuracy <= ACCESS_RADIUS_KM * 1000)) {
          setError(`Brauzer yerinizi yalnız təxminən ±${(accuracy / 1000).toFixed(1)} km dəqiqliklə verdi; bu, yaxındakı dayanacağı seçmək üçün azdır. GPS-i yandırıb yenidən cəhd edin, ya da başlanğıcı adla və ya xəritədən seçin.`);
          return;
        }
        choosePlace("from", { id: HERE, name: HERE_NAME, label: `Məkan dəqiqliyi ±${Math.round(accuracy)} m`, latitude, longitude });
      },
      failure => {
        if (requestId !== locationReqRef.current) return;
        setError(failure.code === 1 ? "Məkan icazəsi verilmədi. Dayanacağı adla və ya xəritədən seçə bilərsiniz." : "Məkan alınmadı. Yenidən cəhd edin və ya dayanacağı özünüz seçin.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }, [choosePlace]);

  const handleSwap = useCallback(() => {
    clearRoute();
    setFromStop(toStop); setToStop(fromStop); setFromPlace(toPlace); setToPlace(fromPlace);
  }, [fromStop, toStop, fromPlace, toPlace, clearRoute]);

  // A map tap (on a marker OR snapped from empty map) fills the ACTIVE field,
  // then advances to the other one — so the user always knows what a tap does.
  const handleMapClick = useCallback((stop: StopDetail) => {
    setMapNotice(null); clearRoute();
    if (pickTarget === "from") {
      setFromPlace(null);
      setFromStop(stop);
      // A destination already chosen, a stop or a place, keeps the next tap on the start.
      setPickTarget(toStop || toPlace ? "from" : "to");
    } else {
      setToPlace(null);
      setToStop(stop);
      setPickTarget("from");
    }
  }, [pickTarget, toStop, toPlace, clearRoute]);

  // Each picker's places put the ones nearer the journey's other end first (#720). The
  // search sends that point in its address, which caches, logs and error reports keep, so
  // the person's location goes only to about 1 km (coarsePoint).
  const rankingPoint = (place: ChosenPlace | null, stop: StopDetail | null): Point | null =>
    place?.id === HERE ? coarsePoint(place) : place ?? stop;
  const fromPoint = useMemo(() => rankingPoint(fromPlace, fromStop), [fromPlace, fromStop]);
  const toPoint = useMemo(() => rankingPoint(toPlace, toStop), [toPlace, toStop]);
  // The chosen places, and the person's location, on the map.
  const mapPlaces = useMemo((): MapPlace[] => ([["from", fromPlace], ["to", toPlace]] as const).flatMap(([end, place]) => place
    ? [{ end, name: place.name, latitude: place.latitude, longitude: place.longitude, here: place.id === HERE }] : []), [fromPlace, toPlace]);

  // Start once per selection/mode change. Result/loading changes are not
  // dependencies, so failures cannot trigger automatic retry loops.
  useEffect(() => {
    if ((fromStop || fromPlace) && (toStop || toPlace) && mode === "route") void handleFind();
  }, [fromStop, toStop, fromPlace, toPlace, mode, handleFind]);

  // ── Line-viewer handlers ──────────────────────────────────────────────────
  const [lineDirection, setLineDirection] = useState(1);
  const fetchLine = useCallback(async (busId: number, direction: number) => {
    const reqId = ++lineReqRef.current;
    setLineDirection(direction); setLineLoading(true); setLineError(null);
    try {
      const res = await fetch(`/api/avtobus/line?busId=${busId}&direction=${direction}`);
      const data = await res.json();
      if (lineReqRef.current !== reqId) return; // superseded (cleared/switched)
      if (!res.ok) { setLineError(data.error || "Xətt tapılmadı"); setLine(null); return; }
      setLine(data.line); setLineDirection(data.line.direction);
      setMobileTab("panel");
    } catch {
      if (lineReqRef.current !== reqId) return;
      setLineError("Şəbəkə xətası. Yenidən cəhd edin.");
      setLine(null);
    } finally {
      if (lineReqRef.current === reqId) setLineLoading(false);
    }
  }, []);

  const selectLineBus = useCallback((b: BusLite | null) => {
    setLineBus(b); setLine(null); setLineError(null);
    if (b) {
      fetchLine(b.id, 1); // default to Gediş (direction 1)
    } else {
      lineReqRef.current++; // invalidate any in-flight load so it can't resurrect the line
      setLineLoading(false);
    }
  }, [fetchLine]);

  const changeLineDirection = useCallback((dir: number) => {
    if (lineBus) fetchLine(lineBus.id, dir);
  }, [lineBus, fetchLine]);

  const loadBuses = useCallback(async () => {
    setBusesLoading(true); setLineError(null);
    try {
      const response = await fetch("/api/avtobus/buses");
      if (!response.ok) throw new Error("buses");
      const data = await response.json();
      if (!Array.isArray(data.buses) || !data.buses.length) throw new Error("empty buses");
      setBuses(data.buses);
    } catch { setLineError("Avtobuslar yüklənmədi. Yenidən cəhd edin."); }
    finally { setBusesLoading(false); }
  }, []);

  const enterMode = useCallback((nextMode: PlannerMode) => {
    if (nextMode === mode) return;
    clearRoute();
    lineReqRef.current++; // Leaving line mode must also invalidate its pending response.
    setLineLoading(false);
    setMode(nextMode); setMobileTab("panel");
    if (nextMode === "line") {
      if (!buses.length && !busesLoading) void loadBuses();
      else if (lineBus && !line) void fetchLine(lineBus.id, lineDirection);
    }
  }, [mode, buses.length, busesLoading, clearRoute, loadBuses, lineBus, line, lineDirection, fetchLine]);

  return (
    <div id="marsrut-planlayici" className="scroll-mt-24">
      {/* Mode switch — always visible: point-to-point route finder vs. view a whole line. */}
      <div className="mb-4 grid max-w-md grid-cols-2 gap-1 rounded-2xl border border-gray-200 bg-white p-1.5" role="group" aria-label="Alət rejimi">
        <button
          aria-pressed={mode === "route"} onClick={() => enterMode("route")}
          className={`flex items-center justify-center gap-1.5 min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition ${mode === "route" ? "bg-white text-orange-700 shadow-sm" : "text-gray-500"}`}
        >
          <Search className="h-4 w-4" /> Marşrut tap
        </button>
        <button
          aria-pressed={mode === "line"} onClick={() => enterMode("line")}
          className={`flex items-center justify-center gap-1.5 min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition ${mode === "line" ? "bg-white text-blue-700 shadow-sm" : "text-gray-500"}`}
        >
          <Route className="h-4 w-4" /> Xətti göstər
        </button>
      </div>

      {/* Mobile pane switcher (lg shows both panes, so it's hidden there) */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 lg:hidden">
        <TabBtn id="panel" icon={<ListOrdered className="h-4 w-4" />} active={mobileTab === "panel"} onSelect={setMobileTab}>{mode === "line" ? "Xətt" : "Axtarış"}</TabBtn>
        <TabBtn id="map" icon={<MapIcon className="h-4 w-4" />} active={mobileTab === "map"} onSelect={setMobileTab}>Xəritə</TabBtn>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)] lg:items-start lg:gap-5">
        {/* Controls / results pane */}
        <div className={`${mobileTab === "panel" ? "block" : "hidden"} min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 lg:block`}>
          {mode === "route" ? (
            <>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Hara gedirsiniz?</h2>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">Avtobus və metro ilə ən əlverişli yol. Dayanacaq və ya məkan seçin: ticarət mərkəzi, universitet, xəstəxana, metro.</p>
              </div>
              {stopsError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p>{stopsError}</p>
                <button onClick={loadStops} disabled={stopsLoading} className="mt-2 flex min-h-11 items-center gap-2 font-semibold underline"><RotateCcw className="h-4 w-4" /> Yenidən yüklə</button>
              </div>}
              <button
                onClick={handleLocate}
                disabled={locating || stops.length === 0}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 py-2.5 text-sm font-semibold text-orange-800 transition hover:bg-orange-100 disabled:opacity-50"
              >
                <LocateFixed className="h-4 w-4" />
                {locating ? "Məkan tapılır…" : "Olduğum yerdən başla"}
              </button>

              <EndPicker label="Haradan" loading={stopsLoading || !!stopsError} stops={stops} selected={fromStop} place={fromPlace} near={toPoint}
                onSelectStop={selectFrom} onSelectPlace={place => choosePlaceMatch("from", place)} active={pickTarget === "from"} onActivate={() => setPickTarget("from")} />

              <div className="-my-1 flex justify-end">
                <button onClick={handleSwap} title="Dayanacaqları dəyiş" aria-label="Dayanacaqları dəyiş" disabled={!fromStop && !toStop && !fromPlace && !toPlace} className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
                  <ArrowDownUp className="h-4 w-4" /> Yerləri dəyiş
                </button>
              </div>

              <EndPicker label="Hara" loading={stopsLoading || !!stopsError} stops={stops} selected={toStop} place={toPlace} near={fromPoint}
                onSelectStop={selectTo} onSelectPlace={place => choosePlaceMatch("to", place)} active={pickTarget === "to"} onActivate={() => setPickTarget("to")} />

              <button
                onClick={handleFind}
                disabled={!(fromStop || fromPlace) || !(toStop || toPlace) || loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
              >
                {loading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Marşrut axtarılır…</>
                         : <><Bus className="h-4 w-4" /> {route ? "Yenidən hesabla" : "Marşrutu tap"}</>}
              </button>

              {error && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                  <SupportCTA variant="inline" className="mt-1 block" />
                </div>
              )}
              <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Vaxt təxminidir. Gözləmə və tıxac daxil deyil.</p>
              <div role="status" aria-live="polite" className="sr-only">{loading ? "Marşrut axtarılır" : route ? "Marşrut hazırdır. Addımlar aşağıda göstərilir." : ""}</div>
              {route && (
                <div ref={resultRef} className="scroll-mt-24 space-y-3">
                  <button
                    onClick={() => setMobileTab("map")}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 lg:hidden"
                  >
                    <MapIcon className="h-4 w-4" /> Nəticəni xəritədə gör
                  </button>
                  <JourneyView route={route} bikeParking={bikeParking} />
                </div>
              )}
              {!route && !error && !loading && (
                <p className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
                  <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Dayanacağın adını bilmirsiniz? Getdiyiniz yerin adını yazın (məsələn, «Gənclik Mall»), ya da «Xəritə»yə keçib istədiyiniz yerə toxunun — ən yaxın dayanacaq avtomatik seçilir.
                </p>
              )}
            </>
          ) : (
            <>
              <div><h2 className="text-lg font-bold text-gray-900">Avtobus hara gedir?</h2><p className="mt-1 text-xs leading-relaxed text-gray-500">Xətti seçin, dayanacaqları və hər iki istiqaməti görün.</p></div>
              <BusPicker buses={buses} selected={lineBus} onSelect={selectLineBus} loading={busesLoading} />

              {/* Gediş / Qayıdış toggle — only when the line has two directions. */}
              {line && line.availableDirections.length > 1 && (
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                  {line.availableDirections.slice(0, 2).map((d, i) => (
                    <button
                      key={d}
                      aria-pressed={line.direction === d} onClick={() => changeLineDirection(d)}
                      disabled={lineLoading}
                      className={`min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition disabled:opacity-60 ${line.direction === d ? "bg-white text-blue-700 shadow-sm" : "text-gray-500"}`}
                    >
                      {i === 0 ? "Gediş" : "Qayıdış"}
                    </button>
                  ))}
                </div>
              )}

              {lineError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {lineError}
                  <button onClick={() => lineBus ? fetchLine(lineBus.id, lineDirection) : loadBuses()} disabled={lineLoading || busesLoading} className="mt-2 flex min-h-11 items-center gap-2 font-semibold underline"><RotateCcw className="h-4 w-4" /> Yenidən cəhd et</button>
                  <SupportCTA variant="inline" className="mt-1 block" />
                </div>
              )}
              {lineLoading && (
                <div role="status" className="flex items-center justify-center gap-2 rounded-xl bg-gray-50 py-4 text-sm text-gray-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" /> Xətt yüklənir…
                </div>
              )}
              {line && !lineLoading && line.stops.length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Bu xətt üçün marşrut məlumatı mövcud deyil.
                </div>
              )}
              {line && !lineLoading && line.stops.length > 0 && (
                <>
                  <button
                    onClick={() => setMobileTab("map")}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 lg:hidden"
                  >
                    <MapIcon className="h-4 w-4" /> Marşrutu xəritədə gör
                  </button>
                  <LineSummary line={line} />
                </>
              )}
              {!line && !lineLoading && !lineError && (
                <p className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Avtobus nömrəsini seçin — həmin xəttin bütün marşrutu (gediş/qayıdış) və dayanacaqları xəritədə göstərilir.
                </p>
              )}
            </>
          )}
        </div>

        {/* Map pane */}
        <div className={`${mobileTab === "map" ? "block" : "hidden"} min-w-0 lg:sticky lg:top-24 lg:block`}>
          {/* Line mode: a simple info banner (no map-tap picking here). */}
          {mode === "line" ? (
            <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-xs text-gray-600">
              <Route className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              {line
                ? <span><strong className="text-blue-700">{line.number}</strong> xətti — {line.stops[0]?.name ?? line.first_point} → {line.stops[line.stops.length - 1]?.name ?? line.last_point} · {line.stops.length} dayanacaq</span>
                : <span>Avtobus nömrəsini seçin — xəttin bütün marşrutu xəritədə görünəcək.</span>}
            </div>
          ) : !route ? (
            <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 p-2.5">
              <div className="mb-2 flex items-start gap-1.5 text-xs text-gray-600">
                <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
                <span>Xəritədə dayanacağa <strong>toxun</strong>, ya da boş yerə toxun — <strong>ən yaxın</strong> dayanacaq seçilir.</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  aria-pressed={pickTarget === "from"} onClick={() => setPickTarget("from")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${pickTarget === "from" ? "border-green-500 bg-white text-green-700 ring-2 ring-green-200" : "border-gray-200 bg-white/60 text-gray-500"}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-600" />
                  <span className="min-w-0 truncate">{fromPlace?.name ?? fromStop?.name ?? "Başlanğıc seç"}</span>
                </button>
                <button
                  aria-pressed={pickTarget === "to"} onClick={() => setPickTarget("to")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${pickTarget === "to" ? "border-red-500 bg-white text-red-700 ring-2 ring-red-200" : "border-gray-200 bg-white/60 text-gray-500"}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" />
                  <span className="min-w-0 truncate">{toPlace?.name ?? toStop?.name ?? "Təyinat seç"}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-2.5">
              <span className="min-w-0 text-xs text-gray-700"><strong className="block text-sm text-gray-900">≈ {movementMinutes(route.totalTime)} dəq hərəkət</strong>{route.totalTransfers === 0 ? "Dəyişmə yoxdur" : `${route.totalTransfers} dəyişmə`} · {fromPlace?.name ?? fromStop?.name} → {toPlace?.name ?? toStop?.name}</span>
              <button
                onClick={() => { clearRoute(); setToStop(null); setToPlace(null); setPickTarget("to"); }}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                Təyinatı dəyiş
              </button>
            </div>
          )}

          {mapNotice && mode === "route" && <p role="status" className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{mapNotice}</p>}
          <div className="relative isolate h-[60vh] min-h-[360px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 shadow-sm lg:h-[580px]">
            {mapRequested && <BusMap
              stops={stops}
              fromStop={mode === "line" ? null : fromStop}
              toStop={mode === "line" ? null : toStop}
              route={mode === "line" ? null : route}
              line={mode === "line" ? line : null}
              places={mode === "line" ? undefined : mapPlaces}
              onStopClick={mode === "line" ? () => {} : handleMapClick}
              isVisible={mobileTab === "map"}
              bikeParking={mode === "line" ? null : bikeParking}
              onMiss={mode === "route" ? () => setMapNotice("Bu nöqtədən 600 metr yaxınlıqda dayanacaq yoxdur. Dayanacaq işarəsinə toxunun və ya xəritədə başqa yer seçin.") : undefined}
            />}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-600" />Başlanğıc</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-600" />Təyinat</span><span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-gray-500" />Piyada</span><span className="flex items-center gap-1.5"><span className="w-4 border-t-[3px] border-dotted border-green-700" />Velosiped zolağı</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-green-700 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />Velosiped parkinqi</span>{mode === "route" && mapPlaces.some(place => !place.here) && <span className="flex items-center gap-1">{mapPlaces.filter(place => !place.here).map(place => <svg key={place.end} aria-hidden="true" width="10" height="13" viewBox="0 0 28 36"><path d={PLACE_PIN_PATH} fill={END_COLORS[place.end]} stroke="#fff" strokeWidth="2.5" /><circle cx="14" cy="13.5" r="4.5" fill="#fff" /></svg>)}Seçilən məkan</span>}{mode === "route" && mapPlaces.some(place => place.here) && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-indigo-600 bg-indigo-500" />Sizin yeriniz</span>}</p>
          <button onClick={() => setMobileTab("panel")} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 lg:hidden"><ListOrdered className="h-4 w-4" />{route ? "Marşrut addımlarına bax" : "Dayanacaq seçiminə qayıt"}<ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
