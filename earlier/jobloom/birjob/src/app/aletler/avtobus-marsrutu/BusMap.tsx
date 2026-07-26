"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { StopDetail, RouteResult, BusLineDetail } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";
import { haversine } from "@/lib/busroute/geo";

const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
const DEFAULT_ZOOM = 12;
const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];
// Single line-viewer trajectory — blue, distinct from the route colours + the
// orange stop clusters so "this whole bus line" reads at a glance.
const LINE_COLOR = "#2563eb";
// A click on empty map snaps to the nearest stop only within this radius (km),
// so a tap far from any stop doesn't silently grab something across town.
const SNAP_RADIUS_KM = 0.6;

export interface BusMapProps {
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  /** Line-viewer mode: draw one bus line's full trajectory (takes precedence over browse). */
  line: BusLineDetail | null;
  userLocation: { lat: number; lng: number } | null;
  /** Called with the chosen stop — from a marker tap OR a snap from empty map. */
  onStopClick: (stop: StopDetail) => void;
  isVisible?: boolean;
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

/**
 * Raw-Leaflet map (no react-leaflet) with marker clustering. react-leaflet v4's
 * MapContainer double-initialises under StrictMode/Fast Refresh; driving Leaflet
 * directly with a guarded init + map.remove() cleanup is StrictMode-safe.
 *
 * The ~3,400 stops are clustered (leaflet.markercluster) so the city view shows
 * a handful of count bubbles instead of an unreadable carpet of dots; zooming in
 * splits them into individually tappable, name-labelled stops. Tapping empty map
 * snaps to the nearest stop, so users never need a pixel-perfect hit.
 */
export default function BusMap({ stops, fromStop, toStop, route, line, userLocation, onStopClick, isVisible }: BusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  // Latest props read inside Leaflet event handlers without forcing a redraw.
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  // Init once (guarded + cleaned up so StrictMode's double-mount is safe).
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true }).setView(BAKU_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

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

    // Tap on EMPTY map → snap to nearest stop (within SNAP_RADIUS_KM).
    map.on("click", (e: L.LeafletMouseEvent) => {
      const all = stopsRef.current;
      let best: StopDetail | null = null;
      let min = Infinity;
      for (const s of all) {
        const dist = haversine(e.latlng.lat, e.latlng.lng, s.latitude, s.longitude);
        if (dist < min) { min = dist; best = s; }
      }
      if (best && min <= SNAP_RADIUS_KM) clickRef.current(best);
    });

    clusterRef.current = cluster;
    overlayRef.current = overlay;
    mapRef.current = map;
    return () => {
      // stop() BEFORE remove() — BIRJOB-G. map.remove() tears the panes down but
      // does NOT cancel an in-flight zoom animation, so a queued
      // _onZoomTransitionEnd can still fire once afterwards and read
      // _leaflet_pos off the pane that no longer exists ("Cannot read properties
      // of undefined (reading '_leaflet_pos')"). Every frame in that report is
      // inside leaflet-src.js, none of ours — the cleanup was already correct,
      // it just needed the animation halted first. stop() aborts any running
      // pan/zoom so the callback never runs.
      map.stop();
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

  // Redraw markers + route whenever inputs change.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const overlay = overlayRef.current;
    if (!map || !cluster || !overlay) return;
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
          .on("click", () => clickRef.current(stop))
          .addTo(overlay);
      }

      // Route polylines (stop-to-stop), distinct colour per bus, dashed walking.
      let busColorIdx = 0;
      for (const seg of route.segments) {
        const isWalking = seg.busId === WALKING_EDGE_BUS_ID;
        const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
        if (!isWalking) busColorIdx++;
        const coords = seg.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
        L.polyline(coords, {
          color, weight: isWalking ? 5 : 7, opacity: isWalking ? 0.7 : 0.9,
          lineCap: "round", lineJoin: "round", dashArray: isWalking ? "8, 12" : undefined,
        }).addTo(overlay);
      }
      // Transfer markers between bus segments.
      const busSegs = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
      for (let i = 0; i < busSegs.length - 1; i++) {
        const last = busSegs[i].stops[busSegs[i].stops.length - 1];
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
        marker.on("click", () => clickRef.current(stop));
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
    if (userLocation) {
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 9, color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.85, weight: 3,
      }).bindTooltip("Sizin yeriniz", { direction: "top" }).addTo(overlay);
    }

    // Fit the view to the most relevant features.
    if (route) {
      const coords: [number, number][] = [];
      for (const seg of route.segments) for (const s of seg.stops) coords.push([s.latitude, s.longitude]);
      if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    } else if (line) {
      const coords: [number, number][] = line.coordinates.length >= 2
        ? line.coordinates.map((c) => [c.latitude, c.longitude])
        : line.stops.map((s) => [s.latitude, s.longitude]);
      if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    } else if (fromStop && toStop) {
      map.fitBounds(L.latLngBounds([[fromStop.latitude, fromStop.longitude], [toStop.latitude, toStop.longitude]]), { padding: [60, 60] });
    } else if (fromStop) {
      map.setView([fromStop.latitude, fromStop.longitude], 15);
    }
  }, [stops, fromStop, toStop, route, line, userLocation]);

  return <div ref={containerRef} className="h-full w-full" />;
}
