#!/usr/bin/env python3
"""
Download what another city needs into data/cities/<city>/, and write its settings file,
cities/<city>.toml, so that measure.py and redesign.py run on it:

  gtfs.zip                                  the city's GTFS feed
  kontur_population_<XX>_20231101.gpkg      Kontur's population grid for its country
  osm_education.json, osm_health.json, osm_shopping.json, osm_offices.json, osm_transport.json
                                            places people go, from OpenStreetMap, in the box of
                                            the feed's served stops plus 2 km: from the Overpass
                                            API as for Baku, or with --osm geofabrik cut out of the
                                            country's extract from Geofabrik (osm_pbf.places), which
                                            does not depend on Overpass servers being up

The settings file names those files, sets service_hours to the hours of service the
feed's timetable shows, and resets what busnet.toml sets for Baku alone. It is written only
when missing, so changes made to it by hand are kept: protecting a route the model cannot
judge, for one. CITIES lists the cities in the
repository with their sources (data/SOURCES.md has their licences); another city needs
--feed and --country.

Standard library only. Usage (from the repository root):
  python3 data/fetch_city.py riga                                   # download what is missing
  python3 data/fetch_city.py riga --refresh                         # download everything again
  python3 data/fetch_city.py my_city --feed URL --country XX        # a city not in CITIES
  python3 data/fetch_city.py riga --osm geofabrik                   # the destinations from Geofabrik
"""

import argparse
import gzip
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "data"))

import fetch_external                                                           # noqa: E402
import osm_pbf                                                                  # noqa: E402
from busnet.assumptions import Assumptions                                      # noqa: E402
from busnet.gtfs import read_gtfs                                               # noqa: E402
from busnet.population import stops_bbox                                        # noqa: E402

KONTUR = "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_{}_20231101.gpkg.gz"
CITIES = {
    # Rīgas satiksme's timetable for October 2026 on Latvia's open data portal (CC0 1.0),
    # dataset "Maršrutu saraksti Rīgas Satiksme sabiedriskajam transportam".
    "riga": {"feed": "https://data.gov.lv/dati/dataset/6d78358a-0095-4ce3-b119-6cde5d0ac54f/resource/"
                     "2e3e9182-f294-48e5-a133-b45cec6ceda4/download/marsrutusaraksti10_2026.zip",
             "country": "LV"},
}
DESTINATIONS = ["osm_education.json", "osm_health.json", "osm_shopping.json", "osm_offices.json", "osm_transport.json"]
# The same five as tests on a place's tags, for a country extract: the Overpass queries of
# fetch_external.OSM_QUERIES, which also take relations; an extract's relations are skipped.
KINDS = {
    "osm_education.json": lambda t: t.get("amenity") in ("school", "university", "college", "kindergarten"),
    "osm_health.json": lambda t: t.get("amenity") in ("hospital", "clinic"),
    "osm_shopping.json": lambda t: t.get("shop") in ("mall", "supermarket", "department_store")
                                   or t.get("amenity") == "marketplace",
    "osm_offices.json": lambda t: "office" in t or t.get("amenity") in ("townhall", "courthouse"),
    "osm_transport.json": lambda t: t.get("railway") == "station" or t.get("amenity") == "bus_station",
}
GEOFABRIK_INDEX = "https://download.geofabrik.de/index-v1-nogeom.json"


def geofabrik(country):
    """The address of a country's extract, from Geofabrik's index of them."""
    for f in json.loads(fetch_external.fetch(GEOFABRIK_INDEX))["features"]:
        p = f["properties"]
        if country in p.get("iso3166-1:alpha2", []) and p.get("urls", {}).get("pbf"):
            return p["urls"]["pbf"]
    raise RuntimeError(f"Geofabrik's index has no extract for {country}")


def settings(city, folder, country, hours):
    rel = Path("..") / folder.relative_to(ROOT)
    files = ",\n".join(f'    "{rel / name}"' for name in DESTINATIONS)
    return f'''# Settings for {city.replace("_", " ").title()}, read from its GTFS feed (python3 data/fetch_city.py {city} wrote this file;
# edit it freely, the script does not overwrite it). Every setting not named here keeps its
# default in busnet/assumptions.py, as for Baku; see docs/configuration.md.
#   python3 measure.py --config cities/{city}.toml --out output/cities/{city}
#   python3 redesign.py --config cities/{city}.toml --out output/cities/{city}/redesign

[data]
gtfs = "{rel / 'gtfs.zip'}"
population = "{rel / f'kontur_population_{country}_20231101.gpkg'}"
destinations = [
{files},
]

[service]
service_hours = {hours:<21}# the hours of service the feed's timetable shows (measure.py reports them)
headway_from_ridership = false       # no counts in the format of BakuBus's
reference_fleet = 0                  # buses in daily service, if known

[redesign]
redesign_protected_routes = []       # route numbers the search must leave as they are
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("city", help="a name for the city: the folder under data/cities/ and the settings file's name")
    ap.add_argument("--feed", help="the GTFS feed's address; for the cities in CITIES, the address listed there")
    ap.add_argument("--country", help="the country's two-letter ISO code, for Kontur's population grid")
    ap.add_argument("--refresh", action="store_true", help="download files that already exist too")
    ap.add_argument("--osm", choices=["overpass", "geofabrik"], default="overpass",
                    help="where the destinations come from: the Overpass API, or the country's extract from "
                         "Geofabrik (with --refresh, all five from it)")
    args = ap.parse_args()
    known = CITIES.get(args.city, {})
    url, country = args.feed or known.get("feed"), (args.country or known.get("country") or "").upper()
    if not url or len(country) != 2:
        sys.exit(f"{args.city} is not in CITIES: give --feed and --country")
    folder = ROOT / "data" / "cities" / args.city
    failed = []

    feed = folder / "gtfs.zip"
    if args.refresh or not feed.exists():
        print(f"feed: {url}")
        fetch_external.save(feed, fetch_external.fetch(url))
    net, table = read_gtfs(feed, Assumptions())
    s = table.summary
    print(f"  {s['routes_running']} bus routes on {s['weekday']} {s['day']}; hours of service {s['service_from']} "
          f"to {s['service_to']}")
    south, north, west, east = stops_bbox(net)               # the served stops plus 2 km
    box = f"{south:.3f},{west:.3f},{north:.3f},{east:.3f}"

    gpkg = folder / f"kontur_population_{country}_20231101.gpkg"
    if args.refresh or not gpkg.exists():
        print(f"population: {KONTUR.format(country)}")
        try:
            fetch_external.save(gpkg, gzip.decompress(fetch_external.fetch(KONTUR.format(country), timeout=900)))
        except RuntimeError as e:
            failed.append(f"{gpkg.name}: {e}")

    missing = [name for name in DESTINATIONS if args.refresh or not (folder / name).exists()]
    if missing and args.osm == "geofabrik":
        try:
            extract = geofabrik(country)
            with tempfile.TemporaryDirectory() as tmp:
                pbf = Path(tmp) / extract.rsplit("/", 1)[1]
                print(f"osm: {extract}")
                pbf.write_bytes(fetch_external.fetch(extract, timeout=1800))
                found = osm_pbf.places(pbf, box, {name: KINDS[name] for name in missing})
            for name in missing:
                fetch_external.save(folder / name, json.dumps(found[name], ensure_ascii=False).encode("utf-8"))
        except (RuntimeError, ValueError) as e:
            failed.append(f"destinations from Geofabrik: {e}")
    queries = dict(fetch_external.OSM_QUERIES)
    for name in missing if args.osm == "overpass" else []:
        print(f"osm: {name} in {box}")
        try:
            query = queries[f"osm/{name}"].replace(fetch_external.BBOX, box)
            fetch_external.save(folder / name, fetch_external.overpass(query, timeout=240, tries=1))   # a small box
        except RuntimeError as e:
            failed.append(f"{name}: {e} (--osm geofabrik takes them from the country's extract instead)")
        time.sleep(2)

    toml = ROOT / "cities" / f"{args.city}.toml"
    if not toml.exists():
        toml.parent.mkdir(exist_ok=True)
        toml.write_text(settings(args.city, folder, country, s["hours_of_service"]), encoding="utf-8")
        print(f"wrote {toml.relative_to(ROOT)}")
    if failed:
        print("\nFailed (run again later):\n  " + "\n  ".join(failed))
    else:
        print(f"\nAll inputs present. Next:\n  python3 measure.py --config cities/{args.city}.toml --out output/cities/{args.city}")


if __name__ == "__main__":
    main()
