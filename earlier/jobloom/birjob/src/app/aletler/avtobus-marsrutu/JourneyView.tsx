import { Footprints } from "lucide-react";
import type { RouteResult } from "@/lib/busroute/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/busroute/types";

const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#dd2b0f"];

export default function JourneyView({ route }: { route: RouteResult }) {
  const first = route.segments[0]?.stops[0];
  const lastSeg = route.segments[route.segments.length - 1];
  const last = lastSeg?.stops[lastSeg.stops.length - 1];
  const busCount = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID).length;
  let busColorIdx = 0;

  return (
    <section aria-label="Marşrut nəticəsi" className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{route.totalDistance.toFixed(1)}</div>
          <div className="text-xs text-gray-400">km</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{Math.round(route.totalTime)}</div>
          <div className="text-xs text-gray-500">dəq hərəkət (təxmini)</div>
        </div>
        <div className="rounded-xl bg-gray-50 py-2">
          <div className="text-lg font-extrabold text-gray-900">{busCount === 0 ? "Piyada" : `${busCount} avtobus`}</div>
          <div className="text-xs text-gray-500">{busCount === 0 ? "qısa məsafə" : route.totalTransfers === 0 ? "dəyişmə yox" : `${route.totalTransfers} dəyişmə`}</div>
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">Avtobus gözləmə vaxtı daxil deyil. Məsafələr dayanacaqlar arasında düz xətt üzrə təxmin edilir.</p>

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
                  <div className="min-w-0 text-sm text-gray-600">
                    <span className="flex items-center gap-2"><Footprints className="h-4 w-4 shrink-0" />Piyada {Math.round(seg.time)} dəq ({meters} m)</span>
                    <p className="mt-1 break-words text-xs">{seg.stops[0]?.name} → {seg.stops[seg.stops.length - 1]?.name}</p>
                  </div>
                ) : (
                  <div className="min-w-0 text-sm">
                    <span className="font-bold" style={{ color }}>Avtobus {seg.busNumber}</span>
                    <span className="ml-1 text-gray-500">· {seg.stops.length} dayanacaq · {seg.distance.toFixed(1)} km · {Math.round(seg.time)} dəq</span>
                    {seg.headsign && <p className="mt-1 break-words text-xs text-gray-600">İstiqamət: {seg.headsign}</p>}
                    <p className="mt-1 break-words text-xs text-gray-600">{seg.stops[0]?.name} → {seg.stops[seg.stops.length - 1]?.name}</p>
                  </div>
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
    </section>
  );
}

