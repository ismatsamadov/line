import { NextRequest, NextResponse } from "next/server";
import { listBusesLite } from "@/lib/busroute/db";
import { listResponse } from "@/lib/busroute/listResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All Baku bus lines (id, number, endpoints, length) — feeds the line-viewer
// picker. Validated before every use, as the stop list is (listResponse.ts, #743).
export async function GET(request: NextRequest) {
  try {
    return listResponse(request, { buses: await listBusesLite() });
  } catch (error) {
    console.error("[avtobus] buses failed:", error);
    return NextResponse.json({ error: "Avtobuslar yüklənmədi" }, { status: 500 });
  }
}
