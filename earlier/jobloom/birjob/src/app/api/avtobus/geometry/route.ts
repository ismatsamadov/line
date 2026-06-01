import { NextRequest, NextResponse } from "next/server";
import { queryRouteCoordinates, queryRoutesByBusAndDirection } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Road-following polyline for a (bus, direction). Not used by the journey map
// yet (it draws stop-to-stop lines); exposed for a future geometry overlay.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busId = parseInt(searchParams.get("busId") || "");
    const direction = parseInt(searchParams.get("direction") || "1");
    if (isNaN(busId)) {
      return NextResponse.json({ error: "busId tələb olunur" }, { status: 400 });
    }
    const routeId = await queryRoutesByBusAndDirection(busId, direction);
    if (!routeId) return NextResponse.json({ error: "Marşrut tapılmadı" }, { status: 404 });
    const coordinates = await queryRouteCoordinates(routeId);
    return NextResponse.json({ routeId, coordinates });
  } catch (error) {
    console.error("[avtobus] geometry failed:", error);
    return NextResponse.json({ error: "Marşrut həndəsəsi alınmadı" }, { status: 500 });
  }
}
