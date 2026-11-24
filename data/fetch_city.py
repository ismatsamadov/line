#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""
Download what another city needs into data/cities/<city>/, and write its settings file,
cities/<city>.toml, so that measure.py and redesign.py run on it:

  gtfs.zip                                  the city's GTFS feed
  kontur_population_<XX>_20231101.gpkg      Kontur's population grid for its country, cut to the
                                            box of the feed's served stops plus 5 km
                                            (busnet.population.cut_gpkg), which the model reads
                                            to 2 km
  osm_education.json, osm_health.json, osm_shopping.json, osm_offices.json, osm_transport.json
                                            places people go, from OpenStreetMap, in the box of
                                            the feed's served stops plus 2 km: from the Overpass
                                            API as for Baku, or with --osm geofabrik cut out of
                                            Geofabrik's extract of the city's region (CITIES) or
                                            country (osm_pbf.places), which does not depend on
                                            Overpass servers being up

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
  python3 data/fetch_city.py penang --osm geofabrik --osm-cache DIR # keep extracts for cities sharing one
"""

import argparse
import gzip
import io
import json
import shutil
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
from busnet.population import cut_gpkg, stops_bbox                              # noqa: E402

KONTUR = "https://geodata-eu-central-1-kontur-public.s3.amazonaws.com/kontur_datasets/kontur_population_{}_20231101.gpkg.gz"
CUT_KM = 5.0                     # the population grid is kept to the served stops plus this
# The Mobility Database's copy of a feed it lists, for feeds whose own address wants a key or
# would not answer from here on 21 November 2026.
MDB = "https://files.mobilitydatabase.org/{}/latest.zip"
# Each city: its feed, its country (for the population grid) and, where a smaller extract than
# the country's holds it, the Geofabrik region for --osm geofabrik. data/SOURCES.md has each
# feed's publisher, date and licence; all allow redistribution with credit.
CITIES = {
    # Rīgas satiksme's timetable for October 2026 on Latvia's open data portal (CC0 1.0),
    # dataset "Maršrutu saraksti Rīgas Satiksme sabiedriskajam transportam".
    "riga": {"feed": "https://data.gov.lv/dati/dataset/6d78358a-0095-4ce3-b119-6cde5d0ac54f/resource/"
                     "2e3e9182-f294-48e5-a133-b45cec6ceda4/download/marsrutusaraksti10_2026.zip",
             "country": "LV"},
    # ZTM Gdańsk, from Gdańsk's open data portal (CC0 1.0).
    "gdansk": {"feed": MDB.format("mdb-2093"), "country": "PL", "region": "pomorskie"},
    # Cardiff Bus, from the Bus Open Data Service (Open Government Licence v3.0).
    "cardiff": {"feed": MDB.format("mdb-1931"), "country": "GB", "region": "wales"},
    # Dublin Bus, from the National Transport Authority (CC BY 4.0).
    "dublin": {"feed": MDB.format("mdb-2635"), "country": "IE", "region": "ireland-and-northern-ireland"},
    # AMAT Palermo, from the city's open data portal (CC BY 4.0; the tram's data CC BY-SA 4.0).
    "palermo": {"feed": MDB.format("mdb-2373"), "country": "IT", "region": "isole"},
    # Kyivpastrans, Kyiv's municipal operator (CC BY 4.0).
    "kyiv": {"feed": MDB.format("mdb-3230"), "country": "UA"},
    # Sofia Urban Mobility Center, under Sofia Municipality's terms for mobility data (CC BY 4.0).
    "sofia": {"feed": MDB.format("mdb-2848"), "country": "BG"},
    # EMT València, from the city's open data portal (CC BY 4.0).
    "valencia": {"feed": MDB.format("mdb-795"), "country": "ES", "region": "valencia"},
    # STAR, Rennes Métropole's network, from transport.data.gouv.fr (ODbL 1.0).
    "rennes": {"feed": MDB.format("tdg-83281"), "country": "FR", "region": "bretagne"},
    # TAG, the Grenoble area's network (SMMAG), from transport.data.gouv.fr (ODbL 1.0).
    "grenoble": {"feed": MDB.format("tdg-83459"), "country": "FR", "region": "rhone-alpes"},
    # Linkki, Jyväskylä's network, from Waltti (CC BY 4.0).
    "jyvaskyla": {"feed": MDB.format("mdb-867"), "country": "FI"},
    # Halifax Transit (Open Government Licence – Halifax).
    "halifax": {"feed": MDB.format("mdb-734"), "country": "CA", "region": "nova-scotia"},
    # Réseau de transport de la Capitale, Québec City, from Données Québec (CC BY 4.0).
    "quebec": {"feed": MDB.format("mdb-757"), "country": "CA", "region": "quebec"},
    # Capital Metro, Austin, from the Texas Open Data Portal (CapMetro's open data licence).
    "austin": {"feed": MDB.format("mdb-150"), "country": "US", "region": "us/texas"},
    # Trujillo's routes from the city transport authority's OMUS platform, built from OpenStreetMap
    # by the Trufi Association (GPL-3.0 repository; the map data ODbL).
    "trujillo": {"feed": MDB.format("mdb-2200"), "country": "PE"},
    # Prasarana's Rapid Bus networks and BAS.MY Melaka, from Malaysia's GTFS Static API (CC BY 4.0).
    "kuala_lumpur": {"feed": MDB.format("tld-6767"), "country": "MY", "region": "malaysia-singapore-brunei"},
    "penang": {"feed": MDB.format("tld-6770"), "country": "MY", "region": "malaysia-singapore-brunei"},
    "melaka": {"feed": "https://api.data.gov.my/gtfs-static/mybas-melaka", "country": "MY",
               "region": "malaysia-singapore-brunei"},
    # Sendai City Transportation Bureau's buses, from the Public Transportation Open Data Center (CC BY 4.0).
    "sendai": {"feed": MDB.format("odpt-SendaiMunicipal-bus_realtime_information"), "country": "JP",
               "region": "tohoku"},
    # Tosaden Kotsu's buses in Kōchi, from Japan's GTFS data repository (CC BY 4.0).
    "kochi": {"feed": MDB.format("jbda-tosaden-kotsu-GTFS-Tosadentraffic_Regularbus"), "country": "JP",
              "region": "shikoku"},
    # Metro Christchurch, Environment Canterbury (CC BY 4.0).
    "christchurch": {"feed": MDB.format("mdb-1313"), "country": "NZ"},
    # Translink Queensland's regional networks, from Queensland's open data portal (CC BY 4.0).
    "cairns": {"feed": "https://gtfsrt.api.translink.com.au/GTFS/CNS_GTFS.zip", "country": "AU",
               "region": "queensland"},
    "townsville": {"feed": "https://gtfsrt.api.translink.com.au/GTFS/TSV_GTFS.zip", "country": "AU",
                   "region": "queensland"},
    # Anbessa and Sheger city buses, mapped by AddisMapTransit in 2022-2024 with DigitalTransport4Africa
    # (ODbL 1.0); the buses-only file, without the minibus taxis.
    "addis_ababa": {"feed": "https://gitlab.com/digitaltransport/data/africa/addis-ababa/-/raw/master/"
                            "Addis%20Ababa%20GTFS_2023/et-addisababa-bus.zip", "country": "ET"},
    # Accra's trotro lines, mapped for Accra Mobility (Accra Metropolitan Assembly and AFD) (ODbL 1.0).
    "accra": {"feed": MDB.format("mdb-881"), "country": "GH"},
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


def geofabrik(country, region=None):
    """The address of a region's extract, or else the country's, from Geofabrik's index of them."""
    for f in json.loads(fetch_external.fetch(GEOFABRIK_INDEX))["features"]:
        p = f["properties"]
        if (p["id"] == region if region else country in p.get("iso3166-1:alpha2", [])) and p.get("urls", {}).get("pbf"):
            return p["urls"]["pbf"]
    raise RuntimeError(f"Geofabrik's index has no extract for {region or country}")


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
                    help="where the destinations come from: the Overpass API, or the extract of the city's region "
                         "or country from Geofabrik (with --refresh, all five from it)")
    ap.add_argument("--osm-cache", metavar="DIR",
                    help="with --osm geofabrik, keep the extract in DIR, and use one already there")
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
            gz = fetch_external.fetch(KONTUR.format(country), timeout=1800)
            with tempfile.TemporaryDirectory() as tmp:
                whole = Path(tmp) / gpkg.name
                with gzip.open(io.BytesIO(gz)) as src, open(whole, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                gpkg.unlink(missing_ok=True)
                kept = cut_gpkg(whole, gpkg, stops_bbox(net, margin_km=CUT_KM))
            print(f"  wrote {gpkg.relative_to(ROOT)}: the {kept:,} cells within {CUT_KM:g} km of the served "
                  f"stops' box ({gpkg.stat().st_size / 1024:,.0f} KB)")
        except RuntimeError as e:
            failed.append(f"{gpkg.name}: {e}")

    missing = [name for name in DESTINATIONS if args.refresh or not (folder / name).exists()]
    if missing and args.osm == "geofabrik":
        try:
            extract = geofabrik(country, known.get("region"))
            with tempfile.TemporaryDirectory() as tmp:
                keep = Path(args.osm_cache).expanduser() if args.osm_cache else Path(tmp)
                keep.mkdir(parents=True, exist_ok=True)
                pbf = keep / extract.rsplit("/", 1)[1]
                if pbf.exists():
                    print(f"osm: {pbf}")
                else:
                    print(f"osm: {extract}")
                    pbf.write_bytes(fetch_external.fetch(extract, timeout=3600))
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
