import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/lib/busroute/graph";
import { z } from "zod";
import { parseJsonBody } from "@/lib/apiValidate";
import { findJourney, type JourneyEnd } from "@/lib/busroute/routing";
import { ACCESS_RADIUS_KM } from "@/lib/busroute/access";
import { isBakuCoordinate } from "@/lib/busroute/geo";
import { journeyBikeParking, type JourneyBikeParking } from "@/lib/busroute/bike";
import type { RouteResult } from "@/lib/busroute/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StopId = z.number().int().positive().max(2_147_483_647);
// A named place or the person's location (#720), inside the bus network's area, with the
// name the journey shows for it. The name only goes back to the page as text.
const Point = z.object({
  latitude: z.number(),
  longitude: z.number(),
  name: z.string().trim().min(1).max(200).optional(),
}).refine((point) => isBakuCoordinate(point.latitude, point.longitude));
// Each end is a stop, as every request was before #720, or a point: exactly one of the two.
const Body = z.object({
  fromStopId: StopId.optional(),
  toStopId: StopId.optional(),
  from: Point.optional(),
  to: Point.optional(),
}).refine((body) => (body.fromStopId === undefined) !== (body.from === undefined)
  && (body.toStopId === undefined) !== (body.to === undefined));

const ORIGIN_NAME = "Başlanğıc nöqtəsi";
const DESTINATION_NAME = "Təyinat nöqtəsi";

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, Body);
    if ('response' in parsed) {
      return NextResponse.json({ error: "Başlanğıc və təyinatı düzgün seçin" }, { status: 400 });
    }
    const { fromStopId, toStopId, from, to } = parsed.data;
    const samePoint = from && to && from.latitude === to.latitude && from.longitude === to.longitude;
    if ((fromStopId !== undefined && fromStopId === toStopId) || samePoint) {
      return NextResponse.json({ error: "Başlanğıc və təyinat fərqli olmalıdır" }, { status: 400 });
    }
    const origin: JourneyEnd = from ? { ...from, name: from.name ?? ORIGIN_NAME } : { stopId: fromStopId! };
    const destination: JourneyEnd = to ? { ...to, name: to.name ?? DESTINATION_NAME } : { stopId: toStopId! };

    const graph = await getGraph();
    const fromStop = fromStopId === undefined ? null : graph.getStopInfo(fromStopId);
    const toStop = toStopId === undefined ? null : graph.getStopInfo(toStopId);
    if (fromStop === undefined) return NextResponse.json({ error: "Başlanğıc dayanacağı tapılmadı" }, { status: 404 });
    if (toStop === undefined) return NextResponse.json({ error: "Təyinat dayanacağı tapılmadı" }, { status: 404 });

    const { route, stranded, alternative, alternativeCostsNoMore } = findJourney(graph, origin, destination);
    if (!route) {
      // A point with nothing to board or leave near it gets told so, by its name.
      const end = stranded === "origin" ? origin : stranded === "destination" ? destination : null;
      const error = end && "name" in end
        ? `«${end.name}» yaxınlığında ${Math.round(ACCESS_RADIUS_KM * 1000)} metrədək dayanacaq və ya metro stansiyası tapılmadı. Yaxındakı dayanacağı adla və ya xəritədən seçin.`
        : from || to ? "Bu yerlər arasında marşrut tapılmadı" : "Bu dayanacaqlar arasında marşrut tapılmadı";
      return NextResponse.json({ error }, { status: 404 });
    }

    // The bicycle racks beside the journey's first boarding and last alighting (#692).
    // A fault there must not cost the journey: it is sent without them.
    const racks = (journey: RouteResult): JourneyBikeParking | null => {
      try {
        return journeyBikeParking(journey);
      } catch (error) {
        console.error("[avtobus] bike parking not added:", error);
        return null;
      }
    };
    const bikeParking = racks(route);

    const end = (stop: { id: number; name: string } | null, point: JourneyEnd) => stop
      ? { id: stop.id, name: stop.name }
      : "name" in point ? { name: point.name, latitude: point.latitude, longitude: point.longitude } : null;
    return NextResponse.json({
      from: end(fromStop, origin),
      to: end(toStop, destination),
      route,
      bikeParking,
      // The walk beside a journey that rides, or the ride beside the walk, when the other
      // is worth weighing (#743); the page shows the two side by side. `costsNoMore`:
      // between two stops the walk can cost no more than the ride, and then the page calls
      // neither recommended.
      alternative: alternative
        ? { route: alternative, bikeParking: racks(alternative), costsNoMore: alternativeCostsNoMore === true }
        : null,
    });
  } catch (error) {
    console.error("[avtobus] find failed:", error);
    return NextResponse.json({ error: "Marşrut hesablanmadı" }, { status: 500 });
  }
}
