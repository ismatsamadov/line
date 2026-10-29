import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/lib/busroute/graph";
import { z } from "zod";
import { parseJsonBody } from "@/lib/apiValidate";
import { findRoute } from "@/lib/busroute/routing";
import { journeyBikeParking, type JourneyBikeParking } from "@/lib/busroute/bike";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ fromStopId: z.number().int().positive().max(2_147_483_647), toStopId: z.number().int().positive().max(2_147_483_647) });

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, Body);
    if ('response' in parsed) {
      return NextResponse.json({ error: "Başlanğıc və təyinat dayanacaqlarını düzgün seçin" }, { status: 400 });
    }
    const { fromStopId, toStopId } = parsed.data;
    if (fromStopId === toStopId) {
      return NextResponse.json({ error: "Başlanğıc və təyinat fərqli olmalıdır" }, { status: 400 });
    }

    const graph = await getGraph();
    const fromStop = graph.getStopInfo(fromStopId);
    const toStop = graph.getStopInfo(toStopId);

    if (!fromStop) return NextResponse.json({ error: "Başlanğıc dayanacağı tapılmadı" }, { status: 404 });
    if (!toStop) return NextResponse.json({ error: "Təyinat dayanacağı tapılmadı" }, { status: 404 });

    const route = findRoute(graph, fromStopId, toStopId);
    if (!route) {
      return NextResponse.json({ error: "Bu dayanacaqlar arasında marşrut tapılmadı" }, { status: 404 });
    }

    // The bicycle racks beside the journey's first boarding and last alighting (#692).
    // A fault there must not cost the journey: it is sent without them.
    let bikeParking: JourneyBikeParking | null = null;
    try {
      bikeParking = journeyBikeParking(route);
    } catch (error) {
      console.error("[avtobus] bike parking not added:", error);
    }

    return NextResponse.json({
      from: { id: fromStop.id, name: fromStop.name },
      to: { id: toStop.id, name: toStop.name },
      route,
      bikeParking,
    });
  } catch (error) {
    console.error("[avtobus] find failed:", error);
    return NextResponse.json({ error: "Marşrut hesablanmadı" }, { status: 500 });
  }
}
