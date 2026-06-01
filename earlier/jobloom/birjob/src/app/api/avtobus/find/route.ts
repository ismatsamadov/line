import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/lib/busroute/graph";
import { findRoutes } from "@/lib/busroute/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { fromStopId, toStopId } = await request.json();

    if (!fromStopId || !toStopId) {
      return NextResponse.json({ error: "Başlanğıc və təyinat dayanacağı seçilməlidir" }, { status: 400 });
    }
    if (fromStopId === toStopId) {
      return NextResponse.json({ error: "Başlanğıc və təyinat fərqli olmalıdır" }, { status: 400 });
    }

    const graph = await getGraph();
    const fromStop = graph.getStopInfo(fromStopId);
    const toStop = graph.getStopInfo(toStopId);

    if (!fromStop) return NextResponse.json({ error: "Başlanğıc dayanacağı tapılmadı" }, { status: 404 });
    if (!toStop) return NextResponse.json({ error: "Təyinat dayanacağı tapılmadı" }, { status: 404 });

    // Single best route. k=1 short-circuits Yen's loop — one Dijkstra runs.
    const routes = findRoutes(graph, fromStopId, toStopId, "balanced", 1);
    if (routes.length === 0) {
      return NextResponse.json({ error: "Bu dayanacaqlar arasında marşrut tapılmadı" }, { status: 404 });
    }

    return NextResponse.json({
      from: { id: fromStop.id, name: fromStop.name },
      to: { id: toStop.id, name: toStop.name },
      route: routes[0],
    });
  } catch (error) {
    console.error("[avtobus] find failed:", error);
    return NextResponse.json({ error: "Marşrut hesablanmadı" }, { status: 500 });
  }
}
