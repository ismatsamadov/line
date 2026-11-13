import { NextRequest, NextResponse } from "next/server";
import { listStopsForGeo } from "@/lib/busroute/db";
import { listResponse } from "@/lib/busroute/listResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All Baku stops (id, code, name, coords) — feeds the picker, the map markers,
// and the client-side nearest-stop computation.
export async function GET(request: NextRequest) {
  try {
    // Asked for before every use, answered 304 while the browser's copy is still the
    // list, so no list outlives a deploy that changes it (listResponse.ts, #743).
    return listResponse(request, { stops: await listStopsForGeo() });
  } catch (error) {
    console.error("[avtobus] stops failed:", error);
    return NextResponse.json({ error: "Dayanacaqlar yüklənmədi" }, { status: 500 });
  }
}
