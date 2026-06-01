"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { StopDetail, RouteResult } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";

const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
const DEFAULT_ZOOM = 12;
// Distinct bold colours per bus segment (not blue — avoids clashing with stops).
const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

function dot(bg: string, size = 22): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size + 6, size + 6],
    iconAnchor: [(size + 6) / 2, (size + 6) / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  });
}
const StartIcon = dot("#16a34a");
const EndIcon = dot("#dc2626");
const TransferIcon = dot("#f59e0b", 18);

export interface BusMapProps {
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  userLocation: { lat: number; lng: number } | null;
  onStopClick: (stop: StopDetail) => void;
  isVisible?: boolean;
}

function InvalidateSize({ isVisible }: { isVisible?: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (isVisible) {
      const t = setTimeout(() => map.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [map, isVisible]);
  return null;
}

function FitBounds({ fromStop, toStop, route }: { fromStop: StopDetail | null; toStop: StopDetail | null; route: RouteResult | null }) {
  const map = useMap();
  useEffect(() => {
    if (route) {
      const coords: [number, number][] = [];
      for (const seg of route.segments) for (const s of seg.stops) coords.push([s.latitude, s.longitude]);
      if (coords.length) map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    } else if (fromStop && toStop) {
      map.fitBounds(L.latLngBounds([[fromStop.latitude, fromStop.longitude], [toStop.latitude, toStop.longitude]]), { padding: [50, 50] });
    } else if (fromStop) {
      map.setView([fromStop.latitude, fromStop.longitude], 15);
    }
  }, [map, fromStop, toStop, route]);
  return null;
}

export default function BusMap({ stops, fromStop, toStop, route, userLocation, onStopClick, isVisible }: BusMapProps) {
  const segmentPolylines = useMemo(() => {
    if (!route) return [];
    let busColorIdx = 0;
    return route.segments.map((seg) => {
      const isWalking = seg.busId === WALKING_EDGE_BUS_ID;
      const coords: [number, number][] = seg.stops.map((s) => [s.latitude, s.longitude]);
      const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
      if (!isWalking) busColorIdx++;
      return { coords, color, isWalking };
    });
  }, [route]);

  const transferPoints = useMemo(() => {
    if (!route || route.segments.length <= 1) return [];
    const pts: Array<{ lat: number; lng: number; name: string }> = [];
    const busSegs = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
    for (let i = 0; i < busSegs.length - 1; i++) {
      const last = busSegs[i].stops[busSegs[i].stops.length - 1];
      pts.push({ lat: last.latitude, lng: last.longitude, name: last.name });
    }
    return pts;
  }, [route]);

  const routeStopIds = useMemo(() => {
    const ids = new Set<number>();
    if (route) for (const seg of route.segments) for (const s of seg.stops) ids.add(s.id);
    return ids;
  }, [route]);

  // When a route is shown, render only the on-route stops (perf: 3,400+ markers
  // otherwise). With no route, show all stops so the user can tap to pick.
  const visibleStops = useMemo(
    () => (route ? stops.filter((s) => routeStopIds.has(s.id)) : stops),
    [stops, route, routeStopIds]
  );

  return (
    <MapContainer center={BAKU_CENTER} zoom={DEFAULT_ZOOM} className="w-full h-full" zoomControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <InvalidateSize isVisible={isVisible} />
      <FitBounds fromStop={fromStop} toStop={toStop} route={route} />

      {visibleStops.map((stop) => {
        if (fromStop?.id === stop.id || toStop?.id === stop.id) return null;
        const onRoute = routeStopIds.has(stop.id);
        return (
          <CircleMarker
            key={stop.id}
            center={[stop.latitude, stop.longitude]}
            radius={onRoute ? 7 : stop.is_transport_hub ? 6 : 4}
            pathOptions={{
              color: "white",
              fillColor: onRoute ? "#0f172a" : stop.is_transport_hub ? "#f59e0b" : "#64748b",
              fillOpacity: onRoute ? 1 : 0.7,
              weight: onRoute ? 2 : 1.2,
            }}
            eventHandlers={{ click: () => onStopClick(stop) }}
          >
            <Popup>
              <strong>{stop.name}</strong>
              {stop.code ? <div style={{ fontSize: 12, color: "#64748b" }}>Kod: {stop.code}</div> : null}
              <button
                onClick={() => onStopClick(stop)}
                style={{ marginTop: 8, fontSize: 12, background: "#ea580c", color: "white", padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}
              >
                Seç
              </button>
            </Popup>
          </CircleMarker>
        );
      })}

      {segmentPolylines.map((seg, idx) => (
        <Polyline
          key={idx}
          positions={seg.coords}
          pathOptions={{
            color: seg.color,
            weight: seg.isWalking ? 5 : 7,
            opacity: seg.isWalking ? 0.7 : 0.9,
            lineCap: "round",
            lineJoin: "round",
            dashArray: seg.isWalking ? "8, 12" : undefined,
          }}
        />
      ))}

      {transferPoints.map((tp, idx) => (
        <Marker key={`t-${idx}`} position={[tp.lat, tp.lng]} icon={TransferIcon}>
          <Popup><strong>Dəyişmə:</strong> {tp.name}</Popup>
        </Marker>
      ))}

      {fromStop && (
        <Marker position={[fromStop.latitude, fromStop.longitude]} icon={StartIcon}>
          <Popup><strong>Başlanğıc:</strong> {fromStop.name}</Popup>
        </Marker>
      )}
      {toStop && (
        <Marker position={[toStop.latitude, toStop.longitude]} icon={EndIcon}>
          <Popup><strong>Təyinat:</strong> {toStop.name}</Popup>
        </Marker>
      )}
      {userLocation && (
        <CircleMarker center={[userLocation.lat, userLocation.lng]} radius={9}
          pathOptions={{ color: "#4f46e5", fillColor: "#6366f1", fillOpacity: 0.85, weight: 3 }}>
          <Popup>Sizin yeriniz</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
