#!/usr/bin/env python3
"""
Put every city of the world pilot in one table: each measured and redesigned from its own GTFS
feed with the same settings, so that the cities compare like for like.

Reads each city's results, output/cities/<city>/network.json (measure.py) and
output/cities/<city>/redesign/summary.json (redesign.py), and writes to ./output/world/
(or --out):
  cities.csv      one row a city: its network today, and what the redesign is worth with the
                  same buses and with fewer buses that keep today's trip times
  summary.json    the same rows, the totals over the cities, and the middle and range of the
                  measures that do not add up, such as minutes per trip

Baku is in it as read from its own feed (cities/baku.toml), not from AYNA's snapshot with
BakuBus's counts, which is Baku's own study (busnet.toml). Every saving is a model estimate:
apart from Baku's, no city's demand rests on counts (docs/world.md).

With --run, measure.py and redesign.py run first for every city whose results are missing
(or, with --force, for all), several at a time.

Standard library only. Usage (from the repository root):
  python3 world.py                   # gather the results in output/cities/
  python3 world.py --run --jobs 4    # run the cities without results first
"""

import argparse
import csv
import json
import statistics
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# (folder under cities/ and output/cities/, name, country, continent), by continent and name.
WORLD = [
    ("accra", "Accra", "GH", "Africa"),
    ("addis_ababa", "Addis Ababa", "ET", "Africa"),
    ("austin", "Austin", "US", "Americas"),
    ("halifax", "Halifax", "CA", "Americas"),
    ("quebec", "Québec City", "CA", "Americas"),
    ("trujillo", "Trujillo", "PE", "Americas"),
    ("baku", "Baku", "AZ", "Asia"),
    ("kochi", "Kōchi", "JP", "Asia"),
    ("kuala_lumpur", "Kuala Lumpur", "MY", "Asia"),
    ("melaka", "Melaka", "MY", "Asia"),
    ("penang", "Penang", "MY", "Asia"),
    ("sendai", "Sendai", "JP", "Asia"),
    ("cardiff", "Cardiff", "GB", "Europe"),
    ("dublin", "Dublin", "IE", "Europe"),
    ("gdansk", "Gdańsk", "PL", "Europe"),
    ("grenoble", "Grenoble", "FR", "Europe"),
    ("jyvaskyla", "Jyväskylä", "FI", "Europe"),
    ("kyiv", "Kyiv", "UA", "Europe"),
    ("palermo", "Palermo", "IT", "Europe"),
    ("rennes", "Rennes", "FR", "Europe"),
    ("riga", "Riga", "LV", "Europe"),
    ("sofia", "Sofia", "BG", "Europe"),
    ("valencia", "Valencia", "ES", "Europe"),
    ("cairns", "Cairns", "AU", "Oceania"),
    ("christchurch", "Christchurch", "NZ", "Oceania"),
    ("townsville", "Townsville", "AU", "Oceania"),
]
CAPPED = "Average door-to-door trip, impossible trips counted at 120 min"
POSSIBLE = "Average door-to-door trip, possible trips only"
# Columns that add up over cities; the rest are given as middle and range.
TOTALS = ("routes", "stops", "people_in_area", "people_within_400m", "buses", "bus_hours", "bus_km",
          "fuel_l", "co2_t", "routes_after", "fewer_buses", "buses_saved", "bus_hours_saved", "bus_km_saved",
          "fuel_l_saved", "co2_t_saved", "same_buses_fuel_l_change")
SPREAD = ("door_to_door_min", "share_trips_possible", "share_within_400m", "minutes_saved",
          "minutes_saved_possible_trips", "riders_hours_saved_per_100k_journeys", "share_of_buses_needed")


def run_city(city, force):
    """measure.py and redesign.py for one city, unless its results are there; the seconds taken."""
    out = ROOT / "output" / "cities" / city
    start = time.time()
    for script, target in (("measure.py", out), ("redesign.py", out / "redesign")):
        if force or not (target / ("summary.json" if script == "redesign.py" else "network.json")).exists():
            done = subprocess.run([sys.executable, str(ROOT / script), "--config", str(ROOT / "cities" / f"{city}.toml"),
                                   "--out", str(target)], cwd=ROOT, capture_output=True, text=True)
            if done.returncode:
                raise RuntimeError(f"{city}: {script} exited {done.returncode}\n{done.stderr[-2000:]}")
    return time.time() - start


def city_row(city, name, country, continent):
    folder = ROOT / "output" / "cities" / city
    net = json.loads((folder / "network.json").read_text(encoding="utf-8"))
    red = json.loads((folder / "redesign" / "summary.json").read_text(encoding="utf-8"))
    n, day = net["network"], net["timetable"]
    acc, ops = n["accessibility"], n["operations"]
    impact = {r["measure"]: r for r in red["impact"]}

    def saved(measure):                          # what the fewer-buses option saves
        return -impact[measure]["fewer_buses_change"]

    return {
        "city": city, "name": name, "country": country, "continent": continent,
        "service_day": day["day"], "hours_of_service": day["hours_of_service"],
        "routes": n["routes_with_stops"], "stops": n["served_stops"],
        "people_in_area": n["population_in_study_area"], "people_within_400m": n["population_within_coverage_radius"],
        "share_within_400m": n["share_population_covered"],
        "door_to_door_min": acc["mean_door_to_door_min"], "share_trips_possible": acc["share_reachable"],
        "buses": ops["fleet"], "bus_hours": ops["bus_hours_per_day"], "bus_km": ops["bus_km_per_day"],
        "fuel_l": ops["fuel_l_per_day"], "co2_t": ops["co2_t_per_day"],
        "changes": sum(red["changes"].values()), "routes_after": red["routes_after"],
        "minutes_saved": -impact[CAPPED]["same_buses_change"],
        "minutes_saved_possible_trips": -impact[POSSIBLE]["same_buses_change"],
        "riders_hours_saved_per_100k_journeys": -impact["Riders' time per 100,000 journeys"]["same_buses_change"],
        "same_buses_fuel_l_change": impact["Fuel a day"]["same_buses_change"],
        "fewer_buses": impact["Buses in service"]["fewer_buses"],
        "share_of_buses_needed": red["share_of_fleet_for_todays_travel_time"]["independent_check"],
        "buses_saved": saved("Buses in service"), "bus_hours_saved": saved("Bus-hours a day"),
        "bus_km_saved": saved("Bus-km a day"), "fuel_l_saved": saved("Fuel a day"), "co2_t_saved": saved("CO2 a day"),
        "feed": net["inputs"]["gtfs"],
    }


def summarise(rows):
    total = {k: sum(r[k] for r in rows) for k in TOTALS}
    total["share_of_buses_saved"] = total["buses_saved"] / total["buses"]
    total["share_of_fuel_saved"] = total["fuel_l_saved"] / total["fuel_l"]
    weights = [r["people_in_area"] for r in rows]

    def spread(k):
        values = [r[k] for r in rows]
        return {"median": statistics.median(values), "min": min(values), "max": max(values),
                "mean_weighted_by_people_in_area": sum(v * w for v, w in zip(values, weights)) / sum(weights)}

    by_continent = {}
    for r in rows:
        c = by_continent.setdefault(r["continent"], {"cities": 0, "buses": 0, "buses_saved": 0, "fuel_l_saved": 0.0,
                                                     "co2_t_saved": 0.0})
        c["cities"] += 1
        for k in ("buses", "buses_saved", "fuel_l_saved", "co2_t_saved"):
            c[k] += r[k]
    return {"cities": len(rows), "total": total, "spread": {k: spread(k) for k in SPREAD},
            "by_continent": by_continent, "rows": rows}


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "output" / "world"))
    ap.add_argument("--run", action="store_true", help="run measure.py and redesign.py first for cities without results")
    ap.add_argument("--force", action="store_true", help="with --run, run every city again")
    ap.add_argument("--jobs", type=int, default=2, help="with --run, cities at a time")
    args = ap.parse_args()
    if args.run:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            for (city, *_), secs in zip(WORLD, pool.map(lambda c: run_city(c[0], args.force), WORLD)):
                print(f"  {city}: {secs:,.0f} s")
    rows = [city_row(*c) for c in WORLD]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "cities.csv", rows)
    s = summarise(rows)
    (out / "summary.json").write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    t = s["total"]
    print(f"{s['cities']} cities, {t['routes']:,} routes, {t['buses']:,} buses today. With the same buses the "
          f"average trip is {s['spread']['minutes_saved']['median']:.2f} min shorter in the middle city "
          f"({s['spread']['minutes_saved']['min']:.2f} to {s['spread']['minutes_saved']['max']:.2f}). With trip "
          f"times kept, {t['buses_saved']:,} fewer buses ({t['share_of_buses_saved']:.0%}) save "
          f"{t['bus_hours_saved']:,.0f} bus-hours, {t['fuel_l_saved']:,.0f} L of fuel and "
          f"{t['co2_t_saved']:,.1f} t of CO2 a day")
    print(f"Wrote {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")


if __name__ == "__main__":
    main()
