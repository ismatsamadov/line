"use client";

import { Bus, Footprints } from "lucide-react";
import type { RouteResult } from "@/lib/busroute/types";
import { choiceDetail, onFoot } from "./journeyFormatting";

/** Which of the two answers is shown: the planner's own, or the one beside it (#743). */
export type Shown = "route" | "alternative";

/**
 * The journey that rides and the walk the whole way, side by side (#743), when the
 * planner has an answer and the other one is worth weighing (findJourney's
 * `alternative`). The planner's answer comes first and is shown until the other is
 * chosen; the steps and the map follow the one pressed.
 */
export default function JourneyChoice({ route, alternative, shown, onShow }: {
  route: RouteResult; alternative: RouteResult; shown: Shown; onShow: (shown: Shown) => void;
}) {
  return (
    <div role="group" aria-label="Nəqliyyatla və ya piyada" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
      {([["route", route], ["alternative", alternative]] as const).map(([key, option]) => {
        const walking = onFoot(option);
        const pressed = shown === key;
        return (
          <button key={key} type="button" aria-pressed={pressed} onClick={() => onShow(key)}
            className={`min-h-11 min-w-0 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 ${pressed ? "bg-white shadow-sm" : "hover:bg-white/60"}`}>
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${pressed ? "text-orange-700" : "text-gray-600"}`}>
              {walking ? <Footprints aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Bus aria-hidden="true" className="h-4 w-4 shrink-0" />}
              <span className="truncate">{walking ? "Piyada" : "Nəqliyyatla"}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-gray-600">{choiceDetail(option)}</span>
          </button>
        );
      })}
    </div>
  );
}
