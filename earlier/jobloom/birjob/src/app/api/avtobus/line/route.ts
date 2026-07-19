import { NextRequest, NextResponse } from "next/server";
import { queryBusLine } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Full trajectory of one bus line + direction: metadata, ordered stops, the
// directions that exist (for the Gediş/Qayıdış toggle), and road-shaped geometry
// when present. Supersedes the old /geometry endpoint (which returned coords only
// and was never wired into the UI).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busId = parseInt(searchParams.get("busId") || "", 10);
    const direction = parseInt(searchParams.get("direction") || "1", 10);
    if (!busId) {
      return NextResponse.json({ error: "busId tələb olunur" }, { status: 400 });
    }
    const line = await queryBusLine(busId, Number.isFinite(direction) ? direction : 1);
    if (!line) {
      return NextResponse.json({ error: "Avtobus tapılmadı" }, { status: 404 });
    }
    return NextResponse.json({ line }, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    console.error("[avtobus] line failed:", error);
    return NextResponse.json({ error: "Marşrut yüklənmədi" }, { status: 500 });
  }
}
