#!/usr/bin/env python3
"""
Write src/lib/busroute/metro.json, the Baku Metro the bus planner routes on (#689).

The data comes from the open-data study of Baku's bus network
(github.com/ismatsamadov/route_efficiency), which collected the metro from the
operator's own API, OpenStreetMap and opendata.az and builds it into data/metro/ with
its data/build_metro.py. This reads, from a checkout of that repository:

  data/metro/stations.csv          the stations: line and coordinates (OpenStreetMap)
  data/metro/run_times.csv         every train service both ways, timed by the operator's
                                   journey planner, with the track distance between stations
  data/metro/route_stops.csv       OpenStreetMap's route variants, stops in order
  data/metro/routes.geojson        their tracks
  data/external/opendata/metro_exits.csv
                                   the operator's exits (opendata.az, CC BY)
  data/external/metro_api/line_*.json
                                   each line's name and colour as the operator gives them

    python3 scripts/bus/build_metro_json.py ../router_algorithm

Standard library only. What it decides, so that the planner does not have to:

- A ride is what a passenger stays on. The operator's planner starts a new leg where a
  passenger changes: at a wait in one station, and for the express bus that runs
  between Nizami and 28 May while no trains do. A wait it shows in one direction only is
  not a change, because a train that runs through a station one way runs back through
  it. On 25 October 2026 that is the wait at Avtovağzal on the way to Xocəsən, whose
  trains run through from Xocəsən, so that ride runs from 8 Noyabr to Xocəsən. The
  shuttle beyond Əhmədli, which the planner changes onto both ways, stays a ride.
- A ride's times are running times. The planner's waits are left out, as the bus
  planner leaves out every wait.
- A leg's track is the stretch between its two stations of an OpenStreetMap route
  variant that runs from one to the other. The express bus has none.
"""

import csv
import io
import json
import math
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent.parent / "src" / "lib" / "busroute" / "metro.json"
EARTH_RADIUS_KM = 6371.0
# The operator's line colours, which build_metro.py also keys its line names on.
LINE_OF_COLOUR = {"#FF0000": "red", "#41A317": "green", "#870AE0": "purple"}
# OpenStreetMap's line refs in stations.csv; 2B is the green line's branch.
LINE_OF_REF = {"1": "red", "2": "green", "2B": "green", "3": "purple"}
# A box around Baku and Absheron: a station outside it is a broken coordinate (#685).
BAKU = ((40.2, 40.7), (49.5, 50.4))


def km(a, b):
    """Great-circle distance in km between two (lat, lon) points."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def read_rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def exits_by_station(path):
    """{station: [(lat, lon), ...]} from the operator's exits file, spelt as stations.csv.

    The same reading as build_metro.py's operator_stations(): the file's Azerbaijani
    column turned "28 May" into the date 28.05.2026, so a date falls back to the English
    name, and "Memar Əcəmi 2" takes the hyphen the station table uses."""
    raw = path.read_text(encoding="utf-8-sig")
    rows = list(csv.reader(io.StringIO(raw), delimiter=";" if raw.count(";") > raw.count(",") else ","))[1:]
    out = {}
    for row in rows:
        az, en = row[0].strip(), row[1].strip()
        name = en if re.fullmatch(r"\d\d\.\d\d\.\d{4}.*", az) else re.sub(r" 2$", "-2", az)
        out.setdefault(name, []).append((int(row[2]) / 1e6, int(row[3]) / 1e6))
    return out


def legs_of(rows):
    """The legs of one direction of a service, and the stations where it changes.

    A leg is [vehicle, name, stations, seconds, km]; seconds[i] and km[i] run from
    stations[i] to stations[i + 1]."""
    legs, changes = [], set()
    for r in rows:
        by, station = r["by"], r["station"]
        seconds = int(r["s_from_previous"])
        distance = float(r["km_from_previous"]) if r["km_from_previous"] else None
        if by == "start":
            legs.append(["train", None, [station], [], []])
        elif by == "train":
            if legs[-1][0] != "train":  # the train after a bus leaves where the bus stopped
                legs.append(["train", None, [legs[-1][2][-1]], [], []])
            legs[-1][2].append(station)
            legs[-1][3].append(seconds)
            legs[-1][4].append(distance)
        elif by == "wait":
            changes.add(station)
            legs.append(["train", None, [station], [], []])
        elif by.startswith("bus "):
            previous = legs[-1][2][-1]
            changes.update((previous, station))
            legs.append(["bus", by[4:], [previous, station], [seconds], [distance]])
        else:
            raise SystemExit(f"run_times.csv: unknown step {by!r} at {station}")
    return [leg for leg in legs if len(leg[2]) > 1], changes


def rides_of(run_times):
    """Every ride, from each service's two directions, in the file's order."""
    directions = {}
    for r in run_times:
        directions.setdefault((r["service"], r["direction"]), []).append(r)
    by_service = {}
    for service, direction in directions:
        by_service.setdefault(service, []).append(direction)
    rides = []
    for (service, direction), rows in directions.items():
        assert rows == sorted(rows, key=lambda r: int(r["seq"])), (service, direction)
        (back,) = [d for d in by_service[service] if d != direction]
        legs, _ = legs_of(rows)
        _, changes_back = legs_of(directions[(service, back)])
        merged = [legs[0]]
        for leg in legs[1:]:
            last = merged[-1]
            if last[0] == leg[0] == "train" and last[2][-1] == leg[2][0] and leg[2][0] not in changes_back:
                last[2] += leg[2][1:]
                last[3] += leg[3]
                last[4] += leg[4]
            else:
                merged.append(leg)
        for vehicle, name, stations, seconds, distances in merged:
            rides.append({"line": rows[0]["line"], "vehicle": vehicle, "name": name,
                          "stations": stations, "seconds": seconds, "km": distances})
    return rides


def chainage(point, line):
    """Distance in km along `line` to the point on it closest to `point`, and how far off it.

    The foot of the point is found on a flat projection, plenty over a few hundred
    metres; the distance along adds up the same great-circle steps cut() walks."""
    kx = math.radians(1) * EARTH_RADIUS_KM * math.cos(math.radians(point[0]))
    ky = math.radians(1) * EARTH_RADIUS_KM
    px, py = point[1] * kx, point[0] * ky
    best, run = (float("inf"), 0.0), 0.0
    for a, b in zip(line, line[1:]):
        ax, ay, bx, by = a[1] * kx, a[0] * ky, b[1] * kx, b[0] * ky
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        off = math.hypot(px - ax - t * dx, py - ay - t * dy)
        if off < best[0]:
            best = (off, run + t * km(a, b))
        run += km(a, b)
    return best[1], best[0]


def cut(line, start, end):
    """The stretch of `line` between two chainages, start < end, its ends interpolated."""
    def at(target):
        run = 0.0
        for a, b in zip(line, line[1:]):
            step = km(a, b)
            if run + step >= target or b is line[-1]:
                t = 0.0 if step == 0 else max(0.0, min(1.0, (target - run) / step))
                return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            run += step
        return line[-1]
    points, run = [at(start)], 0.0
    for a, b in zip(line, line[1:]):
        run += km(a, b)
        if start < run < end:
            points.append(b)
    points.append(at(end))
    return [[round(lat, 6), round(lon, 6)] for lat, lon in points]


def tracks(root, coords):
    """{(from, to): track} for every pair of consecutive stops of a route variant."""
    stops = {}
    for r in read_rows(root / "data/metro/route_stops.csv"):
        stops.setdefault(r["route"], []).append(r["station"])
    features = json.loads((root / "data/metro/routes.geojson").read_text(encoding="utf-8"))["features"]
    out = {}
    for feature in sorted(features, key=lambda f: f["properties"]["route"]):
        line = [(lat, lon) for lon, lat in feature["geometry"]["coordinates"]]
        names = stops[str(feature["properties"]["route"])]
        for a, b in zip(names, names[1:]):
            if (a, b) in out:
                continue
            (start, off_a), (end, off_b) = chainage(coords[a], line), chainage(coords[b], line)
            assert off_a < 0.15 and off_b < 0.15, f"{a} or {b} is off its track in route {feature['properties']['route']}"
            if start < end:
                out[(a, b)] = cut(line, start, end)
    return out


def main(argv):
    if len(argv) != 2:
        raise SystemExit("usage: python3 scripts/bus/build_metro_json.py <checkout of route_efficiency>")
    root = Path(argv[1]).resolve()
    stations = read_rows(root / "data/metro/stations.csv")
    exits = exits_by_station(root / "data/external/opendata/metro_exits.csv")
    coords = {s["station"]: (float(s["lat"]), float(s["lon"])) for s in stations}
    assert set(exits) == set(coords), sorted(set(exits) ^ set(coords))
    for name, (lat, lon) in coords.items():
        assert BAKU[0][0] < lat < BAKU[0][1] and BAKU[1][0] < lon < BAKU[1][1], f"{name} is outside Baku"
        for e in exits[name]:
            assert km(coords[name], e) < 0.5, f"an exit of {name} is {km(coords[name], e):.2f} km away"

    lines = {}
    for path in sorted((root / "data/external/metro_api").glob("line_*.json")):
        line = json.loads(path.read_text(encoding="utf-8"))
        lines[LINE_OF_COLOUR[line["lineColor"].upper()]] = {"name": line["lineName"], "color": line["lineColor"].upper()}

    rides = rides_of(read_rows(root / "data/metro/run_times.csv"))
    track = tracks(root, coords)
    straight = []
    for ride in rides:
        assert ride["line"] in lines and set(ride["stations"]) <= set(coords), ride
        assert all(s > 0 for s in ride["seconds"]), ride
        ride["paths"] = [track.get((a, b)) if ride["vehicle"] == "train" else None
                         for a, b in zip(ride["stations"], ride["stations"][1:])]
        straight += [f"{a} → {b}" for (a, b), p in zip(zip(ride["stations"], ride["stations"][1:]), ride["paths"])
                     if p is None and ride["vehicle"] == "train"]

    commit = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    osm = json.loads((root / "data/external/osm/osm_metro_routes.json").read_text(encoding="utf-8"))
    read = json.loads(next((root / "data/external/metro_api/journeys").glob("*.json")).read_text(encoding="utf-8"))
    source = {
        "repository": "https://github.com/ismatsamadov/route_efficiency",
        "commit": commit,
        "metro_api_read": read["lines"][0]["stations"][0]["arrivalTimeDatetime"][:10],
        "openstreetmap": osm["osm3s"]["timestamp_osm_base"],
        "attribution": "Running times and exits: Bakı Metropoliteni (exits via opendata.az, CC BY). "
                       "Station coordinates and track: © OpenStreetMap contributors, ODbL.",
    }
    stations_out = [{"name": s["station"], "line": LINE_OF_REF[s["lines"]],
                     "latitude": coords[s["station"]][0], "longitude": coords[s["station"]][1],
                     "exits": [[lat, lon] for lat, lon in exits[s["station"]]]} for s in stations]

    def rows(items):
        return "[\n" + ",\n".join("  " + json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items) + "\n]"
    OUT.write_text("{\n" + ",\n".join([
        f'"source": {json.dumps(source, ensure_ascii=False)}',
        f'"lines": {json.dumps(lines, ensure_ascii=False)}',
        f'"stations": {rows(stations_out)}',
        f'"rides": {rows(rides)}',
    ]) + "\n}\n", encoding="utf-8")
    print(f"Wrote {len(stations_out)} stations and {len(rides)} rides "
          f"({sum(len(r['seconds']) for r in rides)} legs) to {OUT}"
          + (f"; no track for {', '.join(straight)}" if straight else ""))


if __name__ == "__main__":
    main(sys.argv)
