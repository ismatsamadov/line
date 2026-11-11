"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { StopDetail, RouteResult, BusLineDetail } from "@/lib/busroute/types";
import { isMetroStation } from "@/lib/busroute/types";
import { BIKE, type JourneyBikeParking } from "@/lib/busroute/bike";
import { escapeXml } from "@/lib/escapeXml";
import { nearestStop } from "./search";
import { isLeafletAnimating, cancelZoomAnimation } from "@/lib/leafletAnimation";
import { fitFeatures, sizedFromZero, type FitTargets } from "./mapFit";
import { segmentColors } from "./segmentColors";

const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
const DEFAULT_ZOOM = 12;
// Single line-viewer trajectory — blue, distinct from the route colours + the
// orange stop clusters so "this whole bus line" reads at a glance.
const LINE_COLOR = "#2563eb";
// Backstop for a redraw deferred behind an animation: Leaflet's own timers end a
// zoom animation within 250ms and drain the cluster queue within ~300ms, so this
// only ever fires if an event was missed — a late redraw beats a lost one.
const ANIM_SETTLE_MS = 700;
// One empty list, so a map with no places does not redraw on every render.
const NO_PLACES: MapPlace[] = [];
// Bicycle lanes and racks (#692): a dotted green, apart from every route line, which is
// solid, and from the walk, which is dashed grey. Racks show from this zoom on, where
// they stop crowding each other (the median gap between two is 260 m).
const BIKE_COLOR = "#15803d";
const BIKE_PARKING_MIN_ZOOM = 14;
const BIKE_LAYER_NAME = "Velosiped zolaqları";
const BIKE_ATTRIBUTION = 'Velosiped: <a href="https://opendata.az/@azerbaycan-yerustu-neqliyyat-agentliyi">AYNA, opendata.az</a>';
// The tiles, the metro's stations and track and the named places (#720) are all
// OpenStreetMap's, credited as its contributors ask, in the page's language.
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> iştirakçıları';

/** A named place, or the person's location (`here`), chosen as the start or the
 *  destination (#720). A found journey walks from it or to it. */
export interface MapPlace {
  end: "from" | "to";
  name: string;
  latitude: number;
  longitude: number;
  here?: boolean;
}

export interface BusMapProps {
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  /** Line-viewer mode: draw one bus line's full trajectory (takes precedence over browse). */
  line: BusLineDetail | null;
  /** Called with the chosen stop — from a marker tap OR a snap from empty map. */
  onStopClick: (stop: StopDetail) => void;
  isVisible?: boolean;
  onMiss?: () => void;
  /** The racks beside the found route's first boarding and last alighting (#692). */
  bikeParking?: JourneyBikeParking | null;
  /** The places, or the person's location, chosen as the start or the destination (#720). */
  places?: MapPlace[];
}

/** Big, finger-friendly pin for start/destination/transfer (divIcon → no image deps). */
function pinIcon(bg: string, size = 24): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8) / 2, (size + 8) / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:3px solid white;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
  });
}

/**
 * Stop marker: a small coloured dot inside a LARGE transparent hit box so it's
 * tappable on mobile (≈30px target vs the old 4px dot). Hubs are bigger/amber.
 */
function stopIcon(isHub: boolean): L.DivIcon {
  const box = 30;
  const d = isHub ? 16 : 12;
  const bg = isHub ? "#f59e0b" : "#475569";
  return L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${box}px;height:${box}px"><div style="width:${d}px;height:${d}px;border-radius:9999px;background:${bg};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div></div>`,
  });
}

/** A metro station on a found route: an "M" in its line's colour, in the same hit box. */
function stationIcon(color: string): L.DivIcon {
  const box = 30;
  const d = 18;
  return L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${box}px;height:${box}px"><div style="width:${d}px;height:${d}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:700 10px/14px sans-serif;text-align:center">M</div></div>`,
  });
}

/** A bicycle rack the step list names: a "P" in the lanes' green, in the same hit box. */
function bikeParkingIcon(): L.DivIcon {
  const box = 30;
  const d = 18;
  return L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${box}px;height:${box}px"><div style="width:${d}px;height:${d}px;border-radius:4px;background:${BIKE_COLOR};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:700 10px/14px sans-serif;text-align:center">P</div></div>`,
  });
}

/**
 * Baku's bicycle lanes, with its racks in a group of their own that the map adds once
 * zoomed in (#692). Neither takes a tap on the map: a lane is not interactive at all,
 * and a rack shows its name without the tap going on to choose the nearest stop.
 */
function bikeLayers(): { lanes: L.LayerGroup; racks: L.LayerGroup } {
  const lanes = L.layerGroup([], { attribution: BIKE_ATTRIBUTION });
  for (const lane of BIKE.lanes) {
    L.polyline(lane.path, {
      color: BIKE_COLOR, weight: 4, opacity: 0.9, dashArray: "1, 7", lineCap: "round", lineJoin: "round", interactive: false,
    }).addTo(lanes);
  }
  const racks = L.layerGroup();
  for (const rack of BIKE.parking) {
    L.circleMarker([rack.latitude, rack.longitude], {
      radius: 5, color: "#ffffff", weight: 2, fillColor: BIKE_COLOR, fillOpacity: 1, bubblingMouseEvents: false,
    }).bindTooltip(`Velosiped parkinqi · ${rack.name}`, { direction: "top", offset: [0, -4] }).addTo(racks);
  }
  return { lanes, racks };
}

/** A chosen place: a map pin in its end's colour, its tip on the place, apart from the
 *  round stops and the square bicycle racks it often stands beside (#720). */
function placeIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 35],
    tooltipAnchor: [0, -30],
    html: `<svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))"><path d="M14 1.5C7.1 1.5 1.5 6.9 1.5 13.7 1.5 23 14 34.5 14 34.5S26.5 23 26.5 13.7C26.5 6.9 20.9 1.5 14 1.5z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="14" cy="13.5" r="4.5" fill="#fff"/></svg>`,
  });
}

/** Branded cluster bubble with the child count (replaces markercluster default). */
function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = count < 10 ? 34 : count < 100 ? 40 : 48;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:rgba(234,88,12,.92);color:#fff;font-weight:700;font-size:13px;border:3px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.35)">${count}</div>`,
  });
}

interface DrawArgs {
  map: L.Map;
  cluster: L.MarkerClusterGroup;
  overlay: L.LayerGroup;
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  line: BusLineDetail | null;
  onStopClick: (stop: StopDetail) => void;
  bikeParking: JourneyBikeParking | null;
  places: MapPlace[];
}

/**
 * Rebuild every marker/polyline for the current props and fit the view.
 *
 * Only ever called through the redraw effect below, which serialises it against
 * Leaflet's animations — never call it directly from an event handler.
 */
function drawFeatures({ map, cluster, overlay, stops, fromStop, toStop, route, line, onStopClick, bikeParking, places }: DrawArgs): void {
  cluster.clearLayers();
  overlay.clearLayers();

  const routeStopIds = new Set<number>();
  if (route) for (const seg of route.segments) for (const s of seg.stops) routeStopIds.add(s.id);

  if (route) {
    // Route mode: no clustering — show only the on-route stops, plainly.
    // Pull the full StopDetail from `stops` (route segment stops are a lighter
    // shape) so a tap can re-select a real stop.
    for (const stop of stops) {
      if (!routeStopIds.has(stop.id) || fromStop?.id === stop.id || toStop?.id === stop.id) continue;
      L.marker([stop.latitude, stop.longitude], { icon: stopIcon(stop.is_transport_hub), keyboard: false })
        .bindTooltip(stop.name, { direction: "top", offset: [0, -6] })
        .on("click", () => onStopClick(stop))
        .addTo(overlay);
    }

    // Route polylines in the step list's colours (segmentColors), dashed walking. A
    // ride follows the road or the track where the planner matched one (seg.path);
    // otherwise stop to stop. A metro train gets a dark casing, so it reads apart from
    // a bus in a similar colour (#689).
    const colors = segmentColors(route);
    route.segments.forEach((seg, i) => {
      const isWalking = seg.mode === "walk";
      const coords = seg.path ?? seg.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
      if (seg.mode === "metro") {
        L.polyline(coords, { color: "#111827", weight: 11, opacity: 0.6, lineCap: "round", lineJoin: "round" }).addTo(overlay);
      }
      L.polyline(coords, {
        color: colors[i], weight: isWalking ? 5 : 7, opacity: isWalking ? 0.7 : 0.9,
        lineCap: "round", lineJoin: "round", dashArray: isWalking ? "8, 12" : undefined,
      }).addTo(overlay);
    });
    // Metro stations, which are not among the bus stops above, in the colour of a
    // train that calls there; one the express bus alone reaches stays dark.
    const stationColor = new Map<number, string>();
    for (const seg of route.segments) if (seg.mode === "metro" && seg.line) for (const s of seg.stops) stationColor.set(s.id, seg.line.color);
    const drawn = new Set<number>();
    for (const seg of route.segments) for (const s of seg.stops) {
      if (!isMetroStation(s.id) || drawn.has(s.id)) continue;
      drawn.add(s.id);
      L.marker([s.latitude, s.longitude], { icon: stationIcon(stationColor.get(s.id) ?? "#111827"), keyboard: false })
        .bindTooltip(`${s.name} metrosu`, { direction: "top", offset: [0, -6] })
        .addTo(overlay);
    }
    // The racks the step list names (#692), at every zoom, unlike the rest.
    const racks = new Set<string>();
    for (const end of [bikeParking?.boarding, bikeParking?.alighting]) {
      if (!end || racks.has(end.parking.name)) continue;
      racks.add(end.parking.name);
      L.marker([end.parking.latitude, end.parking.longitude], { icon: bikeParkingIcon(), keyboard: false })
        .bindTooltip(`Velosiped parkinqi · ${end.parking.name}`, { direction: "top", offset: [0, -6] })
        .addTo(overlay);
    }
    // Transfer markers between rides.
    const rides = route.segments.filter((s) => s.mode !== "walk");
    for (let i = 0; i < rides.length - 1; i++) {
      const last = rides[i].stops[rides[i].stops.length - 1];
      L.marker([last.latitude, last.longitude], { icon: pinIcon("#f59e0b", 20) })
        .bindTooltip(`Dəyişmə: ${last.name}`, { direction: "top", offset: [0, -10] })
        .addTo(overlay);
    }
  } else if (line) {
    // Line-viewer mode: draw one bus line's full trajectory + every stop on it.
    // Middle stops as small dots (endpoints get green/red pins below).
    line.stops.forEach((stop, i) => {
      if (i === 0 || i === line.stops.length - 1) return;
      L.marker([stop.latitude, stop.longitude], { icon: stopIcon(stop.is_transport_hub), keyboard: false })
        .bindTooltip(stop.name, { direction: "top", offset: [0, -6] })
        .addTo(overlay);
    });

    // Trajectory polyline: prefer the road-shaped geometry; fall back to a
    // stop-to-stop line when the geometry table has no rows for this route.
    const geo = line.coordinates.length >= 2
      ? line.coordinates.map((c) => [c.latitude, c.longitude] as [number, number])
      : line.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
    if (geo.length >= 2) {
      L.polyline(geo, {
        color: LINE_COLOR, weight: 6, opacity: 0.85, lineCap: "round", lineJoin: "round",
      }).addTo(overlay);
    }

    // Endpoint pins — start of the line (green) and terminus (red).
    const first = line.stops[0];
    const last = line.stops[line.stops.length - 1];
    if (first) {
      L.marker([first.latitude, first.longitude], { icon: pinIcon("#16a34a", 24) })
        .bindTooltip(first.name, { permanent: true, direction: "top", offset: [0, -12], className: "stop-label stop-label-from" })
        .addTo(overlay);
    }
    if (last && last.id !== first?.id) {
      L.marker([last.latitude, last.longitude], { icon: pinIcon("#dc2626", 24) })
        .bindTooltip(last.name, { permanent: true, direction: "top", offset: [0, -12], className: "stop-label stop-label-to" })
        .addTo(overlay);
    }
  } else {
    // Browse mode: cluster every stop. Names show on hover/tap (permanent for
    // hubs once declustered) so stops are distinguishable without a click.
    for (const stop of stops) {
      if (fromStop?.id === stop.id || toStop?.id === stop.id) continue;
      const marker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon(stop.is_transport_hub), keyboard: false });
      marker.bindTooltip(stop.name, stop.is_transport_hub
        ? { permanent: true, direction: "top", offset: [0, -8], className: "stop-label" }
        : { direction: "top", offset: [0, -6] });
      marker.on("click", () => onStopClick(stop));
      cluster.addLayer(marker);
    }
  }

  // Selected start / destination — big always-visible pins (never clustered).
  if (fromStop) {
    L.marker([fromStop.latitude, fromStop.longitude], { icon: pinIcon("#16a34a", 26) })
      .bindTooltip(`Başlanğıc: ${fromStop.name}`, { permanent: true, direction: "top", offset: [0, -12], className: "stop-label stop-label-from" })
      .addTo(overlay);
  }
  if (toStop) {
    L.marker([toStop.latitude, toStop.longitude], { icon: pinIcon("#dc2626", 26) })
      .bindTooltip(`Təyinat: ${toStop.name}`, { permanent: true, direction: "top", offset: [0, -12], className: "stop-label stop-label-to" })
      .addTo(overlay);
  }
  // A chosen place, a pin in its end's colour, or the person's location, a blue dot,
  // labelled like a chosen stop (#720). A found journey's walk from or to it is drawn
  // with the route, dashed as every walk is. Leaflet reads a tooltip as HTML and a
  // place's name is OpenStreetMap's, so it is escaped.
  for (const place of places) {
    const from = place.end === "from";
    const marker = place.here
      ? L.circleMarker([place.latitude, place.longitude], { radius: 9, color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.85, weight: 3 })
      : L.marker([place.latitude, place.longitude], { icon: placeIcon(from ? "#16a34a" : "#dc2626"), keyboard: false });
    marker.bindTooltip(`${from ? "Başlanğıc" : "Təyinat"}: ${escapeXml(place.name)}`, {
      permanent: true, direction: "top", offset: [0, place.here ? -12 : -4], className: `stop-label ${from ? "stop-label-from" : "stop-label-to"}`,
    }).addTo(overlay);
  }

  fitFeatures(map, fitTargets(route, line, fromStop, toStop, places));
}

/** The view's targets: a chosen place stands where it is, not at a stop near it (#720). */
function fitTargets(route: RouteResult | null, line: BusLineDetail | null, fromStop: StopDetail | null, toStop: StopDetail | null, places: MapPlace[]): FitTargets {
  return {
    route, line,
    from: places.find((place) => place.end === "from") ?? fromStop,
    to: places.find((place) => place.end === "to") ?? toStop,
  };
}

/**
 * Raw-Leaflet map (no react-leaflet) with marker clustering. react-leaflet v4's
 * MapContainer double-initialises under StrictMode/Fast Refresh; driving Leaflet
 * directly with a guarded init + map.remove() cleanup is StrictMode-safe.
 *
 * The ~3,400 stops are clustered (leaflet.markercluster) so the city view shows
 * a handful of count bubbles instead of an unreadable carpet of dots; zooming in
 * splits them into individually tappable, name-labelled stops. Tapping empty map
 * snaps to the nearest stop, so users never need a pixel-perfect hit.
 *
 * Leaflet — not React — owns every node inside the container div, which is why it
 * is rendered with no JSX children: React must never reconcile the panes. The
 * flip side of that contract is that a React re-render must not mutate those
 * layers while Leaflet is mid-animation either; see the redraw effect.
 */
export default function BusMap({ stops, fromStop, toStop, route, line, onStopClick, isVisible, onMiss, bikeParking = null, places = NO_PLACES }: BusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  // Latest props read inside Leaflet event handlers without forcing a redraw.
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;
  const missRef = useRef(onMiss);
  missRef.current = onMiss;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const fitRef = useRef<FitTargets>(fitTargets(route, line, fromStop, toStop, places));
  fitRef.current = fitTargets(route, line, fromStop, toStop, places);

  // Init once (guarded + cleaned up so StrictMode's double-mount is safe).
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true }).setView(BAKU_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM_ATTRIBUTION }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      disableClusteringAtZoom: 16,
      iconCreateFunction: clusterIcon,
    });
    cluster.addTo(map);
    const overlay = L.layerGroup().addTo(map);

    // The bicycle lanes (#692), on unless switched off in the corner; their racks join
    // them from BIKE_PARKING_MIN_ZOOM on. Added once: no redraw touches them.
    const bike = bikeLayers();
    // Every vector shares one canvas, painted in the order the layers were added, so
    // lanes switched back on would paint over the found route until the next redraw.
    bike.lanes.on("add", () => bike.lanes.eachLayer((layer) => {
      if (layer instanceof L.Polyline) layer.bringToBack();
    }));
    bike.lanes.addTo(map);
    L.control.layers(undefined, { [BIKE_LAYER_NAME]: bike.lanes }, { collapsed: false }).addTo(map);
    const showRacks = () => {
      if (map.getZoom() >= BIKE_PARKING_MIN_ZOOM) bike.lanes.addLayer(bike.racks);
      else bike.lanes.removeLayer(bike.racks);
    };
    map.on("zoomend", showRacks);
    showRacks();

    // Tap on empty map → use the same 600 m radius as location selection.
    map.on("click", (e: L.LeafletMouseEvent) => {
      const nearest = nearestStop(stopsRef.current, e.latlng.lat, e.latlng.lng);
      if (nearest) clickRef.current(nearest.stop);
      else missRef.current?.();
    });

    // A fit made while the map sat 0×0 in the phone's hidden tab is redone once the
    // map has a size (#685; sizedFromZero has the why).
    map.on("resize", (e: L.ResizeEvent) => {
      if (sizedFromZero(e)) fitFeatures(map, fitRef.current);
    });

    clusterRef.current = cluster;
    overlayRef.current = overlay;
    mapRef.current = map;
    return () => {
      // BIRJOB-G: cancel the zoom animation BEFORE remove(), or the 250ms
      // transition-end fallback Leaflet armed fires against a torn-down map and
      // reads `_leaflet_pos` off the deleted map pane. map.stop() (tried first)
      // cannot do this — remove() already calls _stop() internally and _stop()
      // only cancels pan/flyTo. Full reasoning in cancelZoomAnimation().
      cancelZoomAnimation(map);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Map can mount hidden (mobile tab) — recompute size when it becomes visible.
  useEffect(() => {
    if (isVisible && mapRef.current) {
      const t = setTimeout(() => mapRef.current?.invalidateSize(), 80);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  // Redraw markers + route whenever inputs change — but NOT while Leaflet is
  // animating. A tap on a stop marker or a cluster starts a zoom animation and
  // (via onStopClick) a React state update in the same tick, so this effect can
  // otherwise land inside the animation window: clearLayers() then rips DOM out
  // from under elements Leaflet is still transforming, and the fitBounds() at the
  // end is silently swallowed by _tryAnimatedZoom. Deferring to the animation's
  // own end event keeps every mutation inside a quiescent map, and is why the
  // effect now waits instead of mutating immediately.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const overlay = overlayRef.current;
    if (!map || !cluster || !overlay) return;

    let drawn = false;
    let backstop: ReturnType<typeof setTimeout> | undefined;

    // Arrow functions (not declarations) so TS keeps the null-narrowing above;
    // they reference each other only at call time, after all three exist.
    const detach = () => {
      if (backstop !== undefined) clearTimeout(backstop);
      backstop = undefined;
      map.off("zoomend", onSettle);
      cluster.off("animationend", onSettle);
    };

    const draw = () => {
      if (drawn) return;
      drawn = true;
      detach();
      drawFeatures({
        map, cluster, overlay,
        stops, fromStop, toStop, route, line, bikeParking, places,
        onStopClick: (stop) => clickRef.current(stop),
      });
    };

    // Re-check on every animation end: a map zoomend typically *starts* the
    // cluster split/merge animation, so the first settle event is often not the
    // last one. Both flags clear on Leaflet's own timers, so this can't hang.
    const onSettle = () => {
      if (!isLeafletAnimating(map, cluster)) draw();
    };

    if (isLeafletAnimating(map, cluster)) {
      map.on("zoomend", onSettle);
      cluster.on("animationend", onSettle);
      backstop = setTimeout(draw, ANIM_SETTLE_MS);
    } else {
      draw();
    }

    // Unmount / superseded props: drop the pending redraw entirely (the next
    // effect run redraws from the newer props anyway).
    return () => {
      drawn = true;
      detach();
    };
  }, [stops, fromStop, toStop, route, line, bikeParking, places]);

  return <div ref={containerRef} className="h-full w-full" role="region" aria-label="Bakı dayanacaqları və marşrut xəritəsi" />;
}
