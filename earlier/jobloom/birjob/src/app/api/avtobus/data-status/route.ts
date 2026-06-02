import { NextResponse } from "next/server";
import { getDataLastUpdated } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lastUpdated = await getDataLastUpdated();
    return NextResponse.json({ lastUpdated }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch {
    return NextResponse.json({ lastUpdated: null });
  }
}
