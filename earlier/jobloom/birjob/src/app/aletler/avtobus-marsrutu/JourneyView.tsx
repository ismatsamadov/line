import { Footprints, TrainFront } from "lucide-react";
import type { RouteResult, RouteSegment } from "@/lib/busroute/types";
import { isMetroStation } from "@/lib/busroute/types";
import { segmentColors } from "./segmentColors";

/** A stop by name, a metro station as "<name> metrosu" so a walk says where it goes. */
const placeName = (stop: RouteSegment["stops"][number] | undefined) =>
  stop && (isMetroStation(stop.id) ? `${stop.name} metrosu` : stop.name);

/** What to board next, after a change without a walk. */
function changeTo(next: RouteSegment): string {
  if (next.mode === "metro") return next.headsign ? `${next.headsign} istiqamətində qatara dəyiş` : "qatara dəyiş";
  if (next.line) return `${next.busNumber} ekspres avtobusuna dəyiş`;
  return `${next.busNumber} avtobusuna dəyiş`;
}

export default function JourneyView({ route }: { route: RouteResult }) {
  const first = route.segments[0]?.stops[0];
  const lastSeg = route.segments[route.segments.length - 1];
  const last = lastSeg?.stops[lastSeg.stops.length - 1];
  const colors = segmentColors(route);
  const busCount = route.segments.filter((s) => s.mode === "bus").length;
  const byTrain = route.segments.some((s) => s.mode === "metro");
  const walkOnly = busCount === 0 && !byTrain;
  const rides = walkOnly ? "Piyada" : busCount === 0 ? "Metro" : byTrain ? `${busCount} avtobus + metro` : `${busCount} avtobus`;
  // A train or the metro's express bus: its times are the operator's, not AYNA's.
  const byMetro = route.segments.some((s) => s.line);

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
          <div className="text-lg font-extrabold text-gray-900">{rides}</div>
          <div className="text-xs text-gray-500">{walkOnly ? "qısa məsafə" : route.totalTransfers === 0 ? "dəyişmə yox" : `${route.totalTransfers} dəyişmə`}</div>
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        {byMetro
          ? "Gözləmə vaxtı daxil deyil. Metro vaxtları Bakı Metropoliteninin öz planlayıcısındandır; avtobus məsafələri dayanacaqlar arasında düz xətt üzrə təxmin edilir."
          : "Avtobus gözləmə vaxtı daxil deyil. Məsafələr dayanacaqlar arasında düz xətt üzrə təxmin edilir."}
      </p>

      <ol className="space-y-2">
        <li className="flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-green-600" />
          <span className="font-medium text-gray-900">{placeName(first)}</span>
          <span className="text-xs text-gray-400">— Başlanğıc</span>
        </li>

        {route.segments.map((seg, idx) => {
          const color = colors[idx];
          const meters = Math.round(seg.distance * 1000);
          const next = route.segments[idx + 1];
          const from = seg.stops[0], to = seg.stops[seg.stops.length - 1];
          return (
            <li key={idx}>
              <div className="ml-1.5 flex items-start gap-3 border-l-2 py-1 pl-4" style={{ borderColor: color }}>
                {seg.mode === "walk" ? (
                  <div className="min-w-0 text-sm text-gray-600">
                    <span className="flex items-center gap-2"><Footprints className="h-4 w-4 shrink-0" />Piyada {Math.round(seg.time)} dəq ({meters} m)</span>
                    <p className="mt-1 break-words text-xs">{placeName(from)} → {placeName(to)}</p>
                  </div>
                ) : seg.mode === "metro" ? (
                  <div className="min-w-0 text-sm">
                    <span className="inline-flex items-center gap-1 font-bold" style={{ color }}><TrainFront className="h-4 w-4 shrink-0" />Metro · {seg.busNumber}</span>
                    <span className="ml-1 text-gray-500">· {seg.stops.length} stansiya · {seg.distance.toFixed(1)} km · {Math.round(seg.time)} dəq</span>
                    {seg.headsign && <p className="mt-1 break-words text-xs text-gray-600">İstiqamət: {seg.headsign}</p>}
                    <p className="mt-1 break-words text-xs text-gray-600">{from?.name} → {to?.name}</p>
                  </div>
                ) : (
                  <div className="min-w-0 text-sm">
                    <span className="font-bold" style={{ color }}>{seg.line ? "Ekspres avtobus" : "Avtobus"} {seg.busNumber}</span>
                    <span className="ml-1 text-gray-500">· {seg.stops.length} dayanacaq · {seg.distance.toFixed(1)} km · {Math.round(seg.time)} dəq</span>
                    {seg.line
                      ? <p className="mt-1 break-words text-xs text-gray-600">Bu hissədə qatar işləmir: metronun ekspres avtobusu</p>
                      : seg.headsign && <p className="mt-1 break-words text-xs text-gray-600">İstiqamət: {seg.headsign}</p>}
                    <p className="mt-1 break-words text-xs text-gray-600">{placeName(from)} → {placeName(to)}</p>
                  </div>
                )}
              </div>
              {seg.mode !== "walk" && next && next.mode !== "walk" && (
                <div className="flex items-center gap-2 py-1 text-sm">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-amber-500" />
                  <span className="text-gray-700">{placeName(to)}</span>
                  <span className="text-xs text-amber-600">— {changeTo(next)}</span>
                </div>
              )}
            </li>
          );
        })}

        <li className="flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-red-600" />
          <span className="font-medium text-gray-900">{placeName(last)}</span>
          <span className="text-xs text-gray-400">— Təyinat</span>
        </li>
      </ol>
    </section>
  );
}
