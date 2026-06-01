import { NextResponse } from "next/server";
import { getDataLastUpdated } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lastUpdated = await getDataLastUpdated();
    return NextResponse.json({ lastUpdated });
  } catch {
    return NextResponse.json({ lastUpdated: null });
  }
}
