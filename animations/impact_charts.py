# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Build the two README charts from the published Baku result tables.

Run python3 animations/impact_charts.py from the repository root. The annual scenario
uses 250 equivalent weekdays at 1.10 AZN per diesel-equivalent litre (Azerbaijan
Tariff Council retail benchmark effective 1 January 2026, linked in README).
"""

import csv
from pathlib import Path

from draw import Canvas, Gif

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "output"
W, H = 900, 410
PAPER, INK, MUTED = "#f5f2e9", "#123932", "#49665e"
RULE, GREEN, BLUE, GOLD = "#c4d1c5", "#007857", "#336989", "#e7ad43"
DAYS, PRICE = 250, 1.10


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as src:
        return list(csv.DictReader(src))


def page(section, title, source):
    canvas = Canvas(W, H, PAPER)
    canvas.rect(0, 0, W, 6, GREEN)
    canvas.text(34, 39, "LINE   /   BAKU", 14, GREEN)
    canvas.text(W - 34, 39, section, 14, MUTED, align="right")
    canvas.text(34, 95, title, 32, INK)
    canvas.line([(34, 365), (W - 34, 365)], 1, RULE)
    canvas.text(34, 390, source, 12, MUTED)
    return canvas


def fuel_value():
    data = rows(OUTPUT / "redesign" / "impact.csv")
    savings = {row["measure"]: -float(row["fewer_buses_change"]) for row in data}
    litres, tonnes = savings["Fuel a day"], savings["CO2 a day"]
    base = page("OPERATING SCENARIO", "What is a weekday of fuel worth?",
                "Modelled smaller fleet  /  Baku impact table  /  Diesel retail benchmark, Jan 2026")
    base.text(34, 133, f"{litres:,.0f} L per weekday  ×  {PRICE:.2f} AZN per litre", 18, MUTED)
    base.text(34, 202, "GROSS FUEL VALUE", 14, GREEN)
    base.text(492, 202, "TAILPIPE CO2 AVOIDED", 14, GREEN)
    gif = Gif(W, H)
    for day in [1, *range(10, DAYS + 1, 10)]:
        frame = base.copy()
        frame.text(34, 273, f"{litres * PRICE * day:,.0f} AZN", 40, INK)
        frame.text(492, 273, f"{tonnes * day:,.0f} t", 46, INK)
        frame.line([(35, 311), (865, 311)], 5, RULE)
        end = 35 + 830 * day / DAYS
        frame.line([(35, 311), (end, 311)], 6, GREEN)
        frame.disc(end, 311, 6, GOLD)
        frame.text(34, 344, f"{day} equivalent weekday" + ("s" if day != 1 else ""), 16, INK)
        frame.text(865, 344, f"{DAYS}-day illustration", 16, MUTED, align="right")
        gif.add(frame, 420 if day == DAYS else 160 if day == 1 else 12)
    gif.write(HERE / "fuel-value.gif")


def walking_access():
    data = rows(OUTPUT / "robustness" / "coverage_walk.csv")
    base = page("ACCESS TO BUS STOPS", "How far is the walk to a stop?",
                "Share of study-area residents  /  Kontur Population  /  (c) OpenStreetMap contributors  /  AYNA")
    base.text(34, 134, "Residents within the same distance by two measures", 18, MUTED)
    gif = Gif(W, H)
    for row in data:
        frame = base.copy()
        radius = int(row["radius_m"])
        frame.text(34, 194, f"{radius:,} m", 45, INK)
        frame.text(35, 223, "distance to stop", 15, MUTED)
        for y, field, label, color in [(178, "share_line", "Straight line", BLUE),
                                       (247, "share_walk", "Walk on mapped streets", GREEN)]:
            share = float(row[field])
            frame.text(320, y, label, 17, INK)
            frame.text(864, y, f"{share:.1%}", 19, color, align="right")
            frame.rect(320, y + 12, 864, y + 27, RULE)
            frame.rect(320, y + 12, 320 + share * 544, y + 27, color)
        gap = float(row["population_within_line_not_walk"])
        frame.text(34, 336, f"{gap:,.0f} people have a longer walk than the radius suggests.", 19, INK)
        gif.add(frame, 420 if radius == 400 else 230)
    gif.write(HERE / "walking-access.gif")


if __name__ == "__main__":
    fuel_value()
    walking_access()
