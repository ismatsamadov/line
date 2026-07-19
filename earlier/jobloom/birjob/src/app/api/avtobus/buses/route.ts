import { NextResponse } from "next/server";
import { listBusesLite } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All Baku bus lines (id, number, endpoints, length) — feeds the line-viewer
// picker. Whole-dataset response that only changes on a manual re-import, so it
// caches hard at the edge (repeat loads hit the CDN, not Postgres).
export async function GET() {
  try {
    const buses = await listBusesLite();
    return NextResponse.json({ buses }, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (error) {
    console.error("[avtobus] buses failed:", error);
    return NextResponse.json({ error: "Avtobuslar yüklənmədi" }, { status: 500 });
  }
}
