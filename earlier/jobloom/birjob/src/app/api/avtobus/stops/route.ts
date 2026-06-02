import { NextResponse } from "next/server";
import { listStopsForGeo } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All Baku stops (id, code, name, coords) — feeds the picker, the map markers,
// and the client-side nearest-stop computation.
export async function GET() {
  try {
    const stops = await listStopsForGeo();
    // Whole-dataset response that only changes on a manual re-import — cache
    // hard at the edge so scrapers/repeat loads hit the CDN, not Postgres.
    return NextResponse.json({ stops }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (error) {
    console.error("[avtobus] stops failed:", error);
    return NextResponse.json({ error: "Dayanacaqlar yüklənmədi" }, { status: 500 });
  }
}
