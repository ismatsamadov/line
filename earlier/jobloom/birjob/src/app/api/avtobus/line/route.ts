import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryBusLine } from "@/lib/busroute/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A positive PostgreSQL integer, written as digits only: parseInt read "1junk" and
// "1.5" as 1 and handed ids past int4 to Prisma, which threw (#685). The data has
// directions 1 and 2 only, and no direction means 1.
const BusId = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).refine((n) => n <= 2_147_483_647);
const Direction = z.enum(["1", "2"]).transform(Number);

// Full trajectory of one bus line + direction: metadata, ordered stops, the
// directions that exist (for the Gediş/Qayıdış toggle), and road-shaped geometry
// when present. Supersedes the old /geometry endpoint (which returned coords only
// and was never wired into the UI).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const busId = BusId.safeParse(searchParams.get("busId") ?? "");
    if (!busId.success) {
      return NextResponse.json({ error: "busId tələb olunur" }, { status: 400 });
    }
    const direction = Direction.safeParse(searchParams.get("direction") ?? "1");
    if (!direction.success) {
      return NextResponse.json({ error: "İstiqamət düzgün deyil" }, { status: 400 });
    }
    const line = await queryBusLine(busId.data, direction.data);
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
