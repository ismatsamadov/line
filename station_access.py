# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Compare access to served bus stops around each named Baku metro station.

Use the same split Kontur grid and pedestrian graph as the citywide walking
check. Station coordinates define 1 km study circles, not district boundaries.
Nearby circles can overlap; their populations must not be added together.
Run python3 station_access.py to rebuild output/station_access.csv.
"""

import csv
from pathlib import Path

from busnet.geo import haversine_m
from busnet.graph import StopIndex
from busnet.inputs import load_inputs
from busnet.tables import write_csv
from busnet.walking import load_walk_network

ROOT = Path(__file__).resolve().parent
AREA_M = 1000
STOP_M = 400


def main():
    inputs = load_inputs(ROOT, ROOT / "busnet.toml", split=True)
    stops = [inputs.network.stops[s] for s in inputs.network.served_stop_ids()]
    index = StopIndex(stops)
    with (ROOT / "data/metro/stations.csv").open(encoding="utf-8-sig", newline="") as src:
        stations = list(csv.DictReader(src))

    areas = {}
    for station in stations:
        lat, lon = float(station["lat"]), float(station["lon"])
        areas[station["station"]] = [
            zone for zone in inputs.zones if haversine_m(lat, lon, *zone[:2]) <= AREA_M
        ]

    points = sorted({(lat, lon) for zones in areas.values() for lat, lon, _ in zones})
    graph, _ = load_walk_network(inputs.data["walk_network"])
    walks = graph.walk_distances(points, [(s.lat, s.lon) for s in stops], cutoff=STOP_M)
    walk_near = {point for point, distance in zip(points, walks) if distance <= STOP_M}
    line_near = {point for point in points if index.nearest(*point, max_m=STOP_M)}

    rows = []
    for station, zones in areas.items():
        total = sum(pop for _, _, pop in zones)
        by_line = sum(pop for lat, lon, pop in zones if (lat, lon) in line_near)
        by_walk = sum(pop for lat, lon, pop in zones if (lat, lon) in walk_near)
        missed = sum(pop for lat, lon, pop in zones
                     if (lat, lon) in line_near and (lat, lon) not in walk_near)
        rows.append(dict(station=station, area_radius_m=AREA_M, stop_distance_m=STOP_M,
                         population=total, near_by_line=by_line, near_by_walk=by_walk,
                         near_by_line_only=missed, share_by_line=by_line / total if total else None,
                         share_by_walk=by_walk / total if total else None))
    write_csv(ROOT / "output/station_access.csv", rows)


if __name__ == "__main__":
    main()
