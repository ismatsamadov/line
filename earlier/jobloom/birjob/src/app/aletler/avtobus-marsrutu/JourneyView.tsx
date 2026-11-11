import { ArrowRight, Bike, Bus, ChevronDown, Footprints, Info, MapPin, TrainFront } from "lucide-react";
import type { RouteResult, RouteSegment } from "@/lib/busroute/types";
import type { JourneyBikeParking } from "@/lib/busroute/bike";
import { isJourneyPoint, isMetroStation } from "@/lib/busroute/types";
import { segmentColors } from "./segmentColors";
import { movementMinutes, travelledStopCount, walkLength } from "./journeyFormatting";

/** A stop by name, a metro station as "<name> metrosu" so a walk says where it goes. */
const placeName = (stop: RouteSegment["stops"][number] | undefined) =>
  stop && (isMetroStation(stop.id) ? `${stop.name} metrosu` : stop.name);

/** One end of a walk: the journey's own place or location with a pin, as the map marks it (#720). */
function WalkEnd({ stop }: { stop: RouteSegment["stops"][number] | undefined }) {
  if (!stop || !isJourneyPoint(stop.id)) return <>{placeName(stop)}</>;
  return <span className="font-semibold text-gray-800"><MapPin aria-hidden="true" className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" />{stop.name}</span>;
}

export default function JourneyView({ route, bikeParking = null }: { route: RouteResult; bikeParking?: JourneyBikeParking | null }) {
  const colors = segmentColors(route);
  const rides = route.segments.filter(segment => segment.mode !== "walk");
  const walkOnly = rides.length === 0;
  const walkingDistance = route.segments.reduce((total, segment) => total + (segment.mode === "walk" ? segment.distance : 0), 0);
  const byMetro = route.segments.some(segment => segment.line);

  return (
    <section aria-label="Marşrut nəticəsi" className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-gray-900">{walkOnly ? "Piyada gedə bilərsiniz" : "Marşrutunuz hazırdır"}</h2>
          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">{walkOnly ? "Qısa məsafə" : "Tövsiyə olunan"}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-extrabold tracking-tight text-gray-900">≈ {movementMinutes(route.totalTime)}</span>
          <span className="text-sm font-medium text-gray-600">dəq hərəkət</span>
          <span className="text-xs text-gray-500">· {route.totalDistance.toFixed(1)} km</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-gray-700">
          <span>{walkOnly ? "Nəqliyyata minmədən" : route.totalTransfers === 0 ? "Dəyişmə yoxdur" : `${route.totalTransfers} dəyişmə`}</span>
          {walkingDistance > 0 && <span className="inline-flex items-center gap-1"><Footprints aria-hidden="true" className="h-3.5 w-3.5" />{walkLength(walkingDistance)} piyada</span>}
        </div>
        {!walkOnly && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Nəqliyyat ardıcıllığı">
            {route.segments.map((segment, index) => (
              <span key={index} className="inline-flex items-center gap-1.5">
                {index > 0 && <ArrowRight aria-hidden="true" className="h-3 w-3 text-gray-400" />}
                <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold" style={{ color: colors[index] }}>
                  {segment.mode === "walk" ? <><Footprints aria-hidden="true" className="h-3.5 w-3.5" />{walkLength(segment.distance)}</>
                    : segment.mode === "metro" ? <><TrainFront aria-hidden="true" className="h-3.5 w-3.5" />{segment.busNumber}</>
                    : <><Bus aria-hidden="true" className="h-3.5 w-3.5" />{segment.busNumber}</>}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <ol className="space-y-4 p-4 sm:p-5" aria-label="Addım-addım yol təlimatı">
        {route.segments.map((segment, index) => {
          const from = segment.stops[0];
          const to = segment.stops[segment.stops.length - 1];
          const stopCount = travelledStopCount(segment);
          const intermediateStops = segment.stops.slice(1, -1);
          const color = colors[index];
          const next = route.segments[index + 1];
          const rideName = segment.mode === "metro" ? `Metro · ${segment.busNumber}` : `${segment.line ? "Ekspres avtobus" : "Avtobus"} ${segment.busNumber}`;
          return (
            <li key={index} className="flex gap-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{index + 1}</span>
              <div className="min-w-0 flex-1 border-l-2 pl-3" style={{ borderColor: color }}>
                {segment.mode === "walk" ? (
                  <>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-gray-900"><Footprints aria-hidden="true" className="h-4 w-4" />Piyada gedin <span className="text-xs font-normal text-gray-600">≈ {movementMinutes(segment.time)} dəq · {walkLength(segment.distance)}</span></p>
                    <p className="mt-1 break-words text-sm text-gray-600"><WalkEnd stop={from} /> → <WalkEnd stop={to} /></p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">Məsafə düz xətt üzrə təxminidir; piyada keçidini yoxlayın.</p>
                  </>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold" style={{ color }}>
                      {segment.mode === "metro" ? <TrainFront aria-hidden="true" className="h-4 w-4" /> : <Bus aria-hidden="true" className="h-4 w-4" />}
                      {rideName}
                    </p>
                    {segment.headsign && <p className="mt-1 break-words text-xs font-medium text-gray-600">{segment.headsign} istiqamətində</p>}
                    {segment.line && segment.mode === "bus" && <p className="mt-1 text-xs leading-relaxed text-amber-800">İstinad məlumatında bu hissədə qatarı ekspres avtobus əvəz edir.</p>}
                    <p className="mt-3 break-words text-sm text-gray-900"><span className="mr-1 font-semibold">Minin:</span> {placeName(from)}</p>
                    <p className="mt-1 text-xs text-gray-600">{stopCount} {segment.mode === "metro" ? "stansiya" : "dayanacaq"} gedin · ≈ {movementMinutes(segment.time)} dəq · {segment.distance.toFixed(1)} km</p>
                    {intermediateStops.length > 0 && (
                      <details className="group mt-2 text-xs text-gray-600">
                        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 font-medium text-gray-700 hover:text-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 [&::-webkit-details-marker]:hidden">
                          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />{intermediateStops.length} aralıq {segment.mode === "metro" ? "stansiyanı" : "dayanacağı"} göstər
                        </summary>
                        <ol className="mb-2 ml-1.5 space-y-2 border-l border-gray-200 py-1 pl-3">
                          {intermediateStops.map((stop, stopIndex) => <li key={`${stop.id}-${stopIndex}`} className="break-words">{placeName(stop)}</li>)}
                        </ol>
                      </details>
                    )}
                    <p className="mt-2 break-words text-sm text-gray-900"><span className="mr-1 font-semibold">Düşün:</span> {placeName(to)}</p>
                    {next && next.mode !== "walk" && <p className="mt-2 text-xs font-medium text-amber-800">Burada {next.mode === "metro" ? `${next.busNumber} qatarına` : `${next.busNumber} avtobusuna`} dəyişin.</p>}
                  </>
                )}
                {index === route.segments.length - 1 && <p className="mt-3 text-xs font-semibold text-green-700">Təyinat: {placeName(to)}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The racks beside the first boarding and the last alighting (#692): AYNA's
          parking places, for a rider who cycles to the bus or the metro. */}
      {bikeParking && (
        <div role="group" aria-label="Velosiped parkinqi" className="border-t border-gray-100 px-4 py-3 sm:px-5">
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900"><Bike aria-hidden="true" className="h-4 w-4 text-green-700" />Velosiped parkinqi</p>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {([["Minmə yeri", bikeParking.boarding], ["Düşmə yeri", bikeParking.alighting]] as const).map(([label, end]) => end && (
              <li key={label} className="break-words"><span className="font-semibold">{label}, {placeName(end.stop)}:</span> {end.parking.name} · ≈&nbsp;{Math.round(end.parking.distance * 1000)}&nbsp;m</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-500">Dayanacağa velosipedlə gəlirsinizsə, onu bu parkinqdə saxlaya bilərsiniz. Məsafə düz xətt üzrə təxminidir; parkinq xəritədə «P» ilə göstərilir. Mənbə: AYNA, opendata.az.</p>
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600 sm:px-5">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{walkOnly ? "Piyada yol düz xətt üzrə təxmin edilir; real yolu və keçid imkanını xəritədə yoxlayın." : `Vaxt təxminidir. Gözləmə, cədvəl və tıxac daxil deyil.${byMetro ? " Metro daxilində keçid və eskalator vaxtı da daxil deyil." : ""} Avtobus və piyada məsafələri düz xətt üzrə hesablanır.`}</p>
      </div>
    </section>
  );
}
