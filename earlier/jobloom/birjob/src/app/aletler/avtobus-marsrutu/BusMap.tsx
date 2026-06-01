"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StopDetail, RouteResult } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";

const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
const DEFAULT_ZOOM = 12;
const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

export interface BusMapProps {
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  userLocation: { lat: number; lng: number } | null;
  onStopClick: (stop: StopDetail) => void;
  isVisible?: boolean;
}

function pinIcon(bg: string, size = 22): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  });
}

/**
 * Raw-Leaflet map (no react-leaflet). react-leaflet v4's MapContainer
 * double-initialises the container under React 18 StrictMode / Fast Refresh
 * ("Map container is already initialized"). Driving Leaflet directly with a
 * guarded init + map.remove() cleanup is StrictMode-safe and lets us use a
 * canvas renderer for the ~3,400 stop markers (smooth on mobile).
 */
export default function BusMap({ stops, fromStop, toStop, route, userLocation, onStopClick, isVisible }: BusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Latest onStopClick without forcing a redraw when its identity changes.
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;

  // Init once (guarded + cleaned up so StrictMode's double-mount is safe).
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { preferCanvas: true, zoomControl: true }).setView(BAKU_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Map can mount hidden (mobile tab) — recompute size when it becomes visible.
  useEffect(() => {
    if (isVisible && mapRef.current) {
      const t = setTimeout(() => mapRef.current?.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  // Redraw markers + route whenever inputs change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const routeStopIds = new Set<number>();
    if (route) for (const seg of route.segments) for (const s of seg.stops) routeStopIds.add(s.id);

    // Stop markers — all stops when no route, only on-route stops otherwise.
    const visibleStops = route ? stops.filter((s) => routeStopIds.has(s.id)) : stops;
    for (const stop of visibleStops) {
      if (fromStop?.id === stop.id || toStop?.id === stop.id) continue;
      const onRoute = routeStopIds.has(stop.id);
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: onRoute ? 7 : stop.is_transport_hub ? 6 : 4,
        color: "white",
        fillColor: onRoute ? "#0f172a" : stop.is_transport_hub ? "#f59e0b" : "#64748b",
        fillOpacity: onRoute ? 1 : 0.7,
        weight: onRoute ? 2 : 1.2,
      });
      marker.bindPopup(
        `<strong>${stop.name}</strong>${stop.code ? `<div style="font-size:12px;color:#64748b">Kod: ${stop.code}</div>` : ""}`
      );
      marker.on("click", () => clickRef.current(stop));
      marker.addTo(layer);
    }

    // Route polylines (stop-to-stop), distinct colour per bus, dashed for walking.
    if (route) {
      let busColorIdx = 0;
      for (const seg of route.segments) {
        const isWalking = seg.busId === WALKING_EDGE_BUS_ID;
        const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
        if (!isWalking) busColorIdx++;
        const coords = seg.stops.map((s) => [s.latitude, s.longitude] as [number, number]);
        L.polyline(coords, {
          color,
          weight: isWalking ? 5 : 7,
          opacity: isWalking ? 0.7 : 0.9,
          lineCap: "round",
          lineJoin: "round",
          dashArray: isWalking ? "8, 12" : undefined,
        }).addTo(layer);
      }
      // Transfer markers between bus segments.
      const busSegs = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
      for (let i = 0; i < busSegs.length - 1; i++) {
        const last = busSegs[i].stops[busSegs[i].stops.length - 1];
        L.marker([last.latitude, last.longitude], { icon: pinIcon("#f59e0b", 18) })
          .bindPopup(`<strong>Dəyişmə:</strong> ${last.name}`)
          .addTo(layer);
      }
    }

    if (fromStop) {
      L.marker([fromStop.latitude, fromStop.longitude], { icon: pinIcon("#16a34a") })
        .bindPopup(`<strong>Başlanğıc:</strong> ${fromStop.name}`).addTo(layer);
    }
    if (toStop) {
      L.marker([toStop.latitude, toStop.longitude], { icon: pinIcon("#dc2626") })
        .bindPopup(`<strong>Təyinat:</strong> ${toStop.name}`).addTo(layer);
    }
    if (userLocation) {
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 9, color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.85, weight: 3,
      }).bindPopup("Sizin yeriniz").addTo(layer);
    }

    // Fit the view to the most relevant features.
    if (route) {
      const coords: [number, number][] = [];
      for (const seg of route.segments) for (const s of seg.stops) coords.push([s.latitude, s.longitude]);
      if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    } else if (fromStop && toStop) {
      map.fitBounds(L.latLngBounds([[fromStop.latitude, fromStop.longitude], [toStop.latitude, toStop.longitude]]), { padding: [50, 50] });
    } else if (fromStop) {
      map.setView([fromStop.latitude, fromStop.longitude], 15);
    }
  }, [stops, fromStop, toStop, route, userLocation]);

  return <div ref={containerRef} className="h-full w-full" />;
}
