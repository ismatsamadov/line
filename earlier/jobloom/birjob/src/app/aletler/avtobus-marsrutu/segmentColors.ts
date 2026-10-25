import type { RouteResult } from "@/lib/busroute/types";

const BUS_COLORS = ["#e11d48", "#7c3aed", "#059669", "#dd2b0f"];
export const WALK_COLOR = "#64748b";

/**
 * Each segment's colour, the same on the map and in the step list: a metro train
 * takes its line's colour (#689), each bus the next colour of the bus palette, and a
 * walk grey.
 */
export function segmentColors(route: RouteResult): string[] {
  let bus = 0;
  return route.segments.map((s) =>
    s.mode === "walk" ? WALK_COLOR
      : s.mode === "metro" && s.line ? s.line.color
      : BUS_COLORS[bus++ % BUS_COLORS.length]);
}
