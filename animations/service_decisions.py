# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Animate the route frequency tradeoff and the walking-access gap in the README.
Run python3 animations/service_decisions.py. Uses only the committed Baku inputs.
"""

import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from busnet.geo import PROJ, haversine_m
from busnet.graph import StopIndex
from busnet.inputs import load_inputs
from busnet.walking import load_walk_network
from draw import Canvas, Gif
from impact_charts import BLUE, GREEN, INK, MUTED, PAPER, RULE, rows
from station_access import AREA_M, STOP_M

W = 900
RUST = "#a84d2f"


def departure_clock():
    routes = {r["route"]: r for r in rows(ROOT / "output/redesign/routes.csv")}
    base = Canvas(W, 425, PAPER)
    base.text(30, 35, "BAKU   /   TWO HOURS OF SERVICE", 14, GREEN)
    base.text(30, 85, "Where does the next bus go?", 31, INK)
    base.text(30, 116, "Each mark is a departure. Both plans start at minute zero.", 15, MUTED)
    left, right, minutes = 326, 854, 120
    lines = []
    for route, top in [("595", 165), ("54", 270)]:
        base.text(30, top, "Route " + route, 22, INK)
        for offset, label, field, colour in [(4, "Today", "headway_min_before", BLUE),
                                             (43, "Redesign", "headway_min_after", RUST)]:
            y = top + offset
            interval = float(routes[route][field])
            base.text(left - 18, y + 3, label, 14, MUTED, align="right")
            base.line([(left, y), (right, y)], 1, RULE)
            marks = [k * interval for k in range(math.floor(minutes / interval) + 1)]
            for t in marks:
                x = left + (right - left) * t / minutes
                base.line([(x, y - 9), (x, y + 9)], 3, RULE)
            lines.append((y, colour, marks))
        base.text(30, top + 32, f"{float(routes[route]['headway_min_before']):.0f} to "
                  f"{float(routes[route]['headway_min_after']):.0f} min", 15, MUTED)
    for t in range(0, minutes + 1, 30):
        base.text(left + (right - left)*t/minutes, 355, f"{t} min", 13, MUTED, align="center")
    base.text(30, 400, "Simulated even spacing  /  Counted demand on 595, estimated on 54", 14, MUTED)
    gif = Gif(W, base.h)
    for now in range(0, minutes + 1, 2):
        c = base.copy()
        cursor = left + (right - left)*now/minutes
        c.line([(cursor, 139), (cursor, 328)], 1, MUTED)
        for y, colour, marks in lines:
            for t in marks:
                if t <= now:
                    x = left + (right - left)*t/minutes
                    c.line([(x, y - 9), (x, y + 9)], 4, colour)
                    if now - t < 3:
                        c.disc(x, y, 6, colour)
        c.text(right, 35, f"Minute {now:03d}", 16, INK, align="right")
        gif.add(c, 320 if now == minutes else 50 if now == 0 else 9)
    gif.write(HERE / "departure-clock.gif")


def walking_maps():
    station = next(r for r in rows(ROOT / "data/metro/stations.csv") if r["station"] == "Gənclik")
    centre = float(station["lat"]), float(station["lon"])
    cx, cy = PROJ.to_xy(*centre)
    inputs = load_inputs(ROOT, ROOT / "busnet.toml", split=True)
    stops = [inputs.network.stops[k] for k in inputs.network.served_stop_ids()]
    zones = [z for z in inputs.zones if haversine_m(*centre, *z[:2]) <= AREA_M]
    points = [(lat, lon) for lat, lon, _ in zones]
    index = StopIndex(stops)
    line = [hit[0] if (hit := index.nearest(*pt, max_m=STOP_M)) else math.inf for pt in points]
    graph, _ = load_walk_network(inputs.data["walk_network"])
    walks = graph.walk_distances(points, [(s.lat, s.lon) for s in stops], cutoff=STOP_M)
    population = sum(z[2] for z in zones)
    base = Canvas(W, 533, PAPER)
    base.text(28, 35, "BAKU   /   NEIGHBOURHOOD ACCESS", 14, GREEN)
    base.text(28, 86, "The same homes, two different maps", 28, INK)
    base.text(28, 118, "Population within 1 km of Ganjlik metro  /  distance to any served bus stop", 14, MUTED)
    scale = 0.127
    mid_y = 313
    # Clip at a square slightly outside the 1 km study circle. The map depicts
    # the walkable network only.
    def offset(x, y):
        return (x-cx)*scale, (cy-y)*scale

    centers = [221, 679]
    for x in centers:
        base.rect(x-172, mid_y-133, x+172, mid_y+133, "#e5ebe2")
    streets = base.mask()
    for u, v in zip(graph.eu, graph.ev):
        dx, dy = offset(graph.xs[u], graph.ys[u])
        ex, ey = offset(graph.xs[v], graph.ys[v])
        if max(abs(dx), abs(ex)) <= 170 and max(abs(dy), abs(ey)) <= 131:
            for x in centers:
                streets.segment(x+dx, mid_y+dy, x+ex, mid_y+ey, 0.48)
    base.paint(streets, "#bccac2")
    for x, title in zip(centers, ["STRAIGHT LINE", "MAPPED WALK"]):
        base.text(x, 161, title, 17, INK, align="center")
        ring = [(x+AREA_M*scale*math.cos(a*math.pi/90), mid_y+AREA_M*scale*math.sin(a*math.pi/90))
                for a in range(181)]
        base.line(ring, 1, MUTED)
    base.text(28, 511, "Dots are population samples  /  Kontur, AYNA, (c) OpenStreetMap contributors", 13, MUTED)
    coords = [offset(*PROJ.to_xy(*p)) for p in points]
    gif = Gif(W, base.h)
    for radius in range(0, STOP_M + 1, 10):
        c = base.copy()
        c.text(871, 35, f"Within {radius} m", 16, INK, align="right")
        for x, distances, colour in zip(centers, (line, walks), (BLUE, GREEN)):
            covered = 0
            for (dx, dy), (_, _, people), distance in zip(coords, zones, distances):
                reached = distance <= radius
                if reached:
                    covered += people
                c.disc(x+dx, mid_y+dy, 4.1, colour if reached else "#89938d")
            c.text(x, 475, f"{covered/population:.0%} of residents", 22, colour, align="center")
        gif.add(c, 420 if radius == STOP_M else 70 if radius == 0 else 10)
    gif.write(HERE / "ganjlik-walk.gif")


if __name__ == "__main__":
    departure_clock()
    walking_maps()
