import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isBakuCoordinate } from "@/lib/busroute/geo";
import { getPlaceIndex, searchPlaces } from "@/lib/busroute/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What a person typed, at most 100 characters, and optionally where the other end of
// the journey is ("40.40930,49.86710"), which puts the nearer of equally good places
// first. A query that folds to under two letters finds nothing without searching.
const Coordinates = z.string().regex(/^-?\d{1,3}(\.\d{1,7})?,-?\d{1,3}(\.\d{1,7})?$/)
  .transform((value) => value.split(",").map(Number))
  .refine(([latitude, longitude]) => isBakuCoordinate(latitude, longitude))
  .transform(([latitude, longitude]) => ({ latitude, longitude }));
const Query = z.object({ q: z.string().trim().min(1).max(100), near: Coordinates.optional() });

// Named places for the start and destination pickers (#720), from the OpenStreetMap
// snapshot in places.json, searched in memory: the index is built once per process.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = Query.safeParse({ q: searchParams.get("q") ?? "", near: searchParams.get("near") ?? undefined });
  if (!query.success) {
    return NextResponse.json({ places: [], error: "Axtarış sözü düzgün deyil" }, { status: 400 });
  }
  try {
    const places = searchPlaces(await getPlaceIndex(), query.data.q, { near: query.data.near });
    // Never kept, so no answer outlives a deploy that changes places.json. The stop and
    // bus lists' s-maxage with stale-while-revalidate, sent at first, let Chrome keep an
    // answer and show it once more after the data changed, for up to a week: the airport
    // at its old point. A search takes under 2 ms here, and the pickers keep each answer
    // while the page is open.
    return NextResponse.json({ places }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Degrades open, and says so: the pickers still offer every stop, and the page tells
    // the person places could not be searched. Never cached, so the next search retries.
    console.error("[avtobus] places failed:", error);
    return NextResponse.json({ places: [], degraded: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
