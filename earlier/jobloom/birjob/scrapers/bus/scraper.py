#!/usr/bin/env python3
"""
AYNA (ayna.gov.az) Baku bus scraper -> Neon Postgres (schema `bus`).

Pulls Baku's public-transit dataset from the AYNA map API and refreshes the bus.*
tables that power /avtobus (per-route SEO pages, src/lib/bus.ts) and
/aletler/avtobus-marsrutu (the A->B journey planner, src/lib/busroute/*). Those
tables were loaded once by hand (scripts/bus/import.ts, never committed to this
repo); this scraper makes the "Məlumat ... dövri olaraq yenilənir" ("periodically
updated") promise the UI already makes actually true.

AYNA API (public JSON, no auth):
  GET /api/bus/getBusList        -> [{id, number}, ...]   (~209 routes)
  GET /api/bus/getBusById?id=N   -> route detail: metadata + stops[] + routes[](geometry)
Stop names/codes/coords come from each route's stop objects, so /stop/getAll
(coords only, no names) is not needed.

Fully decoupled from the website (same rule as the other scrapers): never calls a
birjob endpoint, shares no secret beyond DATABASE_URL. The website only ever reads
bus.*; it never writes it.

Write strategy (ONE transaction, atomic — readers see old data until commit):
  - bus_stop_details, bus_buses, bus_routes : UPSERT by stable id. The live
    front-end joins on these ids (and caches for 24h / holds a warm graph
    singleton), so keeping ids stable avoids churn.
  - bus_bus_stops, bus_route_coordinates, bus_walking_edges : full rebuild
    (SERIAL pk, joined by bus_id/route_id/stop_id) — DELETE-all + reinsert.
  - bus_buses.created_at is bumped to now() so getDataLastUpdated() reports the
    real freshness of the data.

Run:
  pip install -r scrapers/bus/requirements.txt
  python3 scrapers/bus/scraper.py            # reads DATABASE_URL from .env.local or env
  python3 scrapers/bus/scraper.py --dry-run  # fetch + parse only, no DB
  python3 scrapers/bus/scraper.py --limit 5  # (with --dry-run) only fetch N routes
"""
import os
import re
import sys
import json
import time
import math
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# repo root (this file is repo_root/scrapers/bus/scraper.py). Chained dirname —
# NEVER parents[N] (the image runs this flat in /app).
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

API = "https://map-api.ayna.gov.az/api"
HEADERS = {
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (compatible; BirJob-BusBot/1.0; +https://birjob.com)",
}
DRY = "--dry-run" in sys.argv

WALK_MAX_M = 300.0      # ≤300 m transfers (matches the schema comment + graph engine)
WALK_SPEED_KMH = 5.0    # walking speed -> time_min


def _arg_int(flag, default):
    if flag in sys.argv:
        try:
            return int(sys.argv[sys.argv.index(flag) + 1])
        except (IndexError, ValueError):
            pass
    return default


LIMIT = _arg_int("--limit", 0)  # 0 = all routes

# Prisma-only DSN params that psycopg2's parser rejects (this script shares
# DATABASE_URL with the Next.js/Prisma app). Kept in sync with the other
# scrapers' _strip_prisma_params rather than imported (areas stay independent).
_PRISMA_ONLY_PARAMS = {
    "pgbouncer", "connection_limit", "pool_timeout", "schema",
    "connect_timeout", "socket_timeout", "statement_cache_size",
}


def _strip_prisma_params(database_url):
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    parts = urlsplit(database_url)
    if not parts.query:
        return database_url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k not in _PRISMA_ONLY_PARAMS]
    return urlunsplit(parts._replace(query=urlencode(kept)))


def load_env():
    p = os.path.join(ROOT, ".env.local")
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2)


load_env()


def fnum(v):
    """float or None (also filters NaN)."""
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def fint(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return default


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def fetch(path, tries=4):
    req = Request(f"{API}{path}", headers=HEADERS)
    for attempt in range(tries):
        try:
            with urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, ValueError) as e:
            if attempt == tries - 1:
                raise
            print(f"    retry {attempt + 1}/{tries} for {path}: {e}")
            time.sleep(1.5 * (attempt + 1))
    return None


def parse_bus_detail(d):
    """Pure transform: one getBusById payload -> (bus_row, stop_details, bus_stops,
    routes, coords). No network/DB, so it's unit-testable.

    Returns:
      bus_row: dict for bus.bus_buses
      stop_details: list of dicts for bus.bus_stop_details (only stops with coords)
      bus_stops: list of dicts for bus.bus_bus_stops (one per stop-on-route)
      routes: list of dicts for bus.bus_routes (one per direction)
      coords: list of dicts for bus.bus_route_coordinates (route polyline points)
    """
    bid = fint(d.get("id"), None)
    bus_row = {
        "id": bid,
        "carrier": d.get("carrier") or "",
        "number": str(d.get("number") if d.get("number") is not None else bid),
        "first_point": d.get("firstPoint") or "",
        "last_point": d.get("lastPoint") or "",
        "route_length": fnum(d.get("routLength")) or 0.0,
        "tariff": fint(d.get("tariff")),
        "tariff_str": d.get("tariffStr") or "",
        "region_id": fint(d.get("regionId")),
        "working_zone_type_id": fint(d.get("workingZoneTypeId")),
        "duration_minuts": fint(d.get("durationMinuts")),
    }

    stop_details, bus_stops = [], []
    for s in d.get("stops") or []:
        st = s.get("stop") or {}
        sid = fint(s.get("stopId") if s.get("stopId") is not None else st.get("id"), None)
        bus_stops.append({
            "bus_stop_id": fint(s.get("id")),       # ordering key within a (bus, direction)
            "bus_id": bid,
            "stop_id": sid,
            "stop_code": s.get("stopCode") or "",
            "stop_name": s.get("stopName") or st.get("name") or "",
            "total_distance": fnum(s.get("totalDistance")) or 0.0,
            "intermediate_distance": fnum(s.get("intermediateDistance")),
            "direction_type_id": fint(s.get("directionTypeId")),
        })
        lat, lng = fnum(st.get("latitude")), fnum(st.get("longitude"))
        if sid is not None and lat is not None and lng is not None:
            stop_details.append({
                "id": sid,
                "code": st.get("code"),
                "name": st.get("name") or s.get("stopName") or f"Dayanacaq {sid}",
                "latitude": lat,
                "longitude": lng,
                "is_transport_hub": bool(st.get("isTransportHub")),
            })

    routes, coords = [], []
    for rt in d.get("routes") or []:
        rid = fint(rt.get("id"), None)
        if rid is None:
            continue
        routes.append({
            "id": rid,
            "code": rt.get("code") or "",
            "destination": rt.get("destination") or "",
            "bus_id": bid,
            "direction_type_id": fint(rt.get("directionTypeId")),
        })
        for seq, pt in enumerate(rt.get("flowCoordinates") or []):
            la, ln = fnum(pt.get("lat")), fnum(pt.get("lng"))
            if la is not None and ln is not None:
                coords.append({"route_id": rid, "latitude": la, "longitude": ln, "sequence_order": seq})

    return bus_row, stop_details, bus_stops, routes, coords


def compute_walking_edges(stops):
    """≤300 m walking transfers between stops, as directed edges (a->b AND b->a).
    Spatial-grid binned so it's ~O(n) instead of O(n²) over ~3-4k stops.

    stops: iterable of dicts with id/latitude/longitude. Returns list of dicts for
    bus.bus_walking_edges.
    """
    pts = [(s["id"], s["latitude"], s["longitude"]) for s in stops
           if s.get("latitude") is not None and s.get("longitude") is not None]
    if not pts:
        return []
    # Cell size ~ WALK_MAX_M so any pair within range is in the same or an adjacent
    # cell. Latitude: 1 deg ≈ 111.32 km. Longitude shrinks by cos(lat); use the
    # dataset's mean latitude (Baku ~40.4°) for the lng cell.
    mean_lat = sum(p[1] for p in pts) / len(pts)
    cell_lat = WALK_MAX_M / 111_320.0
    cell_lng = WALK_MAX_M / (111_320.0 * max(0.1, math.cos(math.radians(mean_lat))))

    grid = {}
    for pid, lat, lng in pts:
        key = (int(lat / cell_lat), int(lng / cell_lng))
        grid.setdefault(key, []).append((pid, lat, lng))

    max_km = WALK_MAX_M / 1000.0
    edges = []
    for (gx, gy), cell in grid.items():
        # Compare each stop against stops in this + the 8 neighbouring cells.
        neighbours = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                neighbours.extend(grid.get((gx + dx, gy + dy), ()))
        for pid, lat, lng in cell:
            for oid, olat, olng in neighbours:
                if oid <= pid:      # unordered pair once (also skips self)
                    continue
                dkm = haversine_km(lat, lng, olat, olng)
                if dkm <= max_km:
                    tmin = dkm / WALK_SPEED_KMH * 60.0
                    edges.append({"from_stop_id": pid, "to_stop_id": oid, "distance_km": dkm, "time_min": tmin})
                    edges.append({"from_stop_id": oid, "to_stop_id": pid, "distance_km": dkm, "time_min": tmin})
    return edges


def scrape():
    bus_list = fetch("/bus/getBusList") or []
    if LIMIT > 0:
        bus_list = bus_list[:LIMIT]
    total = len(bus_list)
    print(f"  {total} routes in getBusList")

    buses, bus_stops, routes, coords = [], [], [], []
    stops = {}   # stop id -> stop_detail dict (deduped across routes)
    for i, b in enumerate(bus_list, 1):
        bid = b.get("id")
        if bid is None:
            continue
        d = fetch(f"/bus/getBusById?id={bid}")
        if not d:
            continue
        bus_row, stop_details, bstops, rts, crds = parse_bus_detail(d)
        if bus_row["id"] is None:
            continue
        buses.append(bus_row)
        bus_stops.extend(bstops)
        routes.extend(rts)
        coords.extend(crds)
        for sd in stop_details:
            stops.setdefault(sd["id"], sd)
        time.sleep(0.1)  # polite to the gov API
        if i % 25 == 0 or i == total:
            print(f"  {i}/{total} routes  ({len(stops)} stops, {len(coords)} coord pts)")

    stop_list = list(stops.values())
    print("  computing walking edges ...")
    walking = compute_walking_edges(stop_list)
    return buses, stop_list, bus_stops, routes, coords, walking


def _write(buses, stops, bus_stops, routes, coords, walking):
    DB = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")
    if not DB:
        sys.exit("DATABASE_URL not set (and no --dry-run).")
    DB = _strip_prisma_params(DB)
    import psycopg2
    from psycopg2.extras import execute_values
    conn = psycopg2.connect(DB)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(open(SCHEMA_SQL).read())

        execute_values(cur, """
            INSERT INTO bus.bus_stop_details (id, code, name, latitude, longitude, is_transport_hub) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
              code=EXCLUDED.code, name=EXCLUDED.name, latitude=EXCLUDED.latitude,
              longitude=EXCLUDED.longitude, is_transport_hub=EXCLUDED.is_transport_hub""",
            [(s["id"], s["code"], s["name"], s["latitude"], s["longitude"], s["is_transport_hub"]) for s in stops])

        execute_values(cur, """
            INSERT INTO bus.bus_buses
              (id, carrier, number, first_point, last_point, route_length, tariff,
               tariff_str, region_id, working_zone_type_id, duration_minuts) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
              carrier=EXCLUDED.carrier, number=EXCLUDED.number, first_point=EXCLUDED.first_point,
              last_point=EXCLUDED.last_point, route_length=EXCLUDED.route_length, tariff=EXCLUDED.tariff,
              tariff_str=EXCLUDED.tariff_str, region_id=EXCLUDED.region_id,
              working_zone_type_id=EXCLUDED.working_zone_type_id, duration_minuts=EXCLUDED.duration_minuts,
              created_at=now()""",
            [(b["id"], b["carrier"], b["number"], b["first_point"], b["last_point"], b["route_length"],
              b["tariff"], b["tariff_str"], b["region_id"], b["working_zone_type_id"], b["duration_minuts"])
             for b in buses])

        execute_values(cur, """
            INSERT INTO bus.bus_routes (id, code, destination, bus_id, direction_type_id) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
              code=EXCLUDED.code, destination=EXCLUDED.destination,
              bus_id=EXCLUDED.bus_id, direction_type_id=EXCLUDED.direction_type_id""",
            [(r["id"], r["code"], r["destination"], r["bus_id"], r["direction_type_id"]) for r in routes])

        # Derived tables (SERIAL pk, joined by bus_id/route_id/stop_id): full
        # rebuild inside this transaction, so readers never see a half-refreshed set.
        cur.execute("DELETE FROM bus.bus_bus_stops")
        execute_values(cur, """
            INSERT INTO bus.bus_bus_stops
              (bus_stop_id, bus_id, stop_id, stop_code, stop_name, total_distance,
               intermediate_distance, direction_type_id) VALUES %s""",
            [(s["bus_stop_id"], s["bus_id"], s["stop_id"], s["stop_code"], s["stop_name"],
              s["total_distance"], s["intermediate_distance"], s["direction_type_id"]) for s in bus_stops])

        cur.execute("DELETE FROM bus.bus_route_coordinates")
        execute_values(cur, """
            INSERT INTO bus.bus_route_coordinates (route_id, latitude, longitude, sequence_order) VALUES %s""",
            [(c["route_id"], c["latitude"], c["longitude"], c["sequence_order"]) for c in coords])

        cur.execute("DELETE FROM bus.bus_walking_edges")
        execute_values(cur, """
            INSERT INTO bus.bus_walking_edges (from_stop_id, to_stop_id, distance_km, time_min) VALUES %s""",
            [(w["from_stop_id"], w["to_stop_id"], w["distance_km"], w["time_min"]) for w in walking])

        cur.execute("SELECT COUNT(*) FROM bus.bus_buses")
        nb = cur.fetchone()[0]
        conn.commit()
        return nb
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def main():
    if not DRY and not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
        sys.exit("DATABASE_URL not set — aborting before scraping (use --dry-run to test without a DB).")
    t0 = time.time()
    print("Scraping AYNA Baku bus data ...")
    buses, stops, bus_stops, routes, coords, walking = scrape()
    print(f"\nTotal: {len(buses)} routes, {len(stops)} stops, {len(bus_stops)} route-stops, "
          f"{len(routes)} directions, {len(coords)} coord pts, {len(walking)} walking edges")
    if not buses or not stops:
        sys.exit("No bus data scraped — aborting (nothing to write).")

    if DRY:
        print("[dry-run] no DB write.")
        for b in buses[:3]:
            print("  bus:", {k: b[k] for k in ("id", "number", "carrier", "first_point", "last_point", "route_length")})
        if stops:
            print("  stop sample:", stops[0])
        if walking:
            print("  walking edge sample:", walking[0])
        return

    nb = _write(buses, stops, bus_stops, routes, coords, walking)
    print(f"Committed: {nb} routes in bus.bus_buses.")

    try:
        from email_notifier import notify_success
        notify_success("AYNA", [
            ("Routes", len(buses)),
            ("Stops", len(stops)),
            ("Route-stops", len(bus_stops)),
            ("Coord points", len(coords)),
            ("Walking edges", len(walking)),
            ("Routes in DB", nb),
            ("Duration", f"{time.time() - t0:.0f}s"),
        ])
    except Exception as e:
        print(f"[notify] success email skipped: {e}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        try:
            from email_notifier import notify_error
            notify_error("AYNA", e)
        except Exception:
            pass
        raise
