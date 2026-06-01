import { NextResponse } from "next/server";
import { listStopsForGeo } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All Baku stops (id, code, name, coords) — feeds the picker, the map markers,
// and the client-side nearest-stop computation.
export async function GET() {
  try {
    const stops = await listStopsForGeo();
    return NextResponse.json({ stops });
  } catch (error) {
    console.error("[avtobus] stops failed:", error);
    return NextResponse.json({ error: "Dayanacaqlar yüklənmədi" }, { status: 500 });
  }
}
