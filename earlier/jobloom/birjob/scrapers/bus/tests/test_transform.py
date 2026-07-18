"""Tests for the pure transform helpers in the AYNA bus scraper — the logic that
shapes rows written to bus.*. No network or DB: these exercise the value-mapping,
the walking-edge geometry, and the Prisma-DSN stripping only.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import scraper  # noqa: E402
from scraper import (  # noqa: E402
    parse_bus_detail, compute_walking_edges, _strip_prisma_params,
    _split_upsert, fnum, fint, haversine_km,
)

# A minimal getBusById payload mirroring the real AYNA shape.
SAMPLE = {
    "id": 1, "number": "1", "carrier": "BakuBus MMC",
    "firstPoint": "Neftçilər m/st", "lastPoint": "28 May m/st", "routLength": 25.8,
    "tariff": 60, "tariffStr": "60 qəpik", "regionId": 1,
    "workingZoneTypeId": 1, "durationMinuts": 55,
    "stops": [
        {"id": 1, "stopCode": "1001200", "stopName": "Neftçilər m/st", "totalDistance": 0.0,
         "intermediateDistance": 0.0, "directionTypeId": 1, "busId": 1, "stopId": 1439,
         "stop": {"id": 1439, "code": "1001200", "name": "Neftçilər m/st",
                  "latitude": "40.411565", "longitude": "49.94198", "isTransportHub": False}},
        {"id": 2, "stopCode": "1001201", "stopName": "Xətai m/st", "totalDistance": 1.2,
         "intermediateDistance": 1.2, "directionTypeId": 1, "busId": 1, "stopId": 1440,
         "stop": {"id": 1440, "code": "1001201", "name": "Xətai m/st",
                  "latitude": "40.4130", "longitude": "49.9450", "isTransportHub": True}},
    ],
    "routes": [
        {"id": 10, "code": "1", "destination": "Neftçilər - 28 May", "busId": 1, "directionTypeId": 1,
         "flowCoordinates": [{"lat": 40.411594, "lng": 49.942017}, {"lat": 40.411453, "lng": 49.942248}]},
    ],
}


def test_parse_bus_row():
    bus, stops, bus_stops, routes, coords = parse_bus_detail(SAMPLE)
    assert bus["id"] == 1
    assert bus["number"] == "1"
    assert bus["carrier"] == "BakuBus MMC"
    assert bus["first_point"] == "Neftçilər m/st"
    assert bus["route_length"] == 25.8
    assert bus["tariff"] == 60
    assert bus["duration_minuts"] == 55


def test_parse_stop_details():
    _, stops, _, _, _ = parse_bus_detail(SAMPLE)
    assert len(stops) == 2
    s = stops[0]
    assert s["id"] == 1439
    assert s["name"] == "Neftçilər m/st"
    assert s["code"] == "1001200"
    assert s["latitude"] == 40.411565 and s["longitude"] == 49.94198
    assert s["is_transport_hub"] is False
    assert stops[1]["is_transport_hub"] is True


def test_parse_bus_stops_ordering_key():
    _, _, bus_stops, _, _ = parse_bus_detail(SAMPLE)
    assert len(bus_stops) == 2
    # bus_stop_id is the ordering key the front-end sorts by; it comes from the
    # AYNA stops[] entry id (route order), NOT the global stop id.
    assert [b["bus_stop_id"] for b in bus_stops] == [1, 2]
    assert bus_stops[0]["stop_id"] == 1439
    assert bus_stops[0]["direction_type_id"] == 1
    assert bus_stops[0]["bus_id"] == 1


def test_parse_routes_and_coords():
    _, _, _, routes, coords = parse_bus_detail(SAMPLE)
    assert len(routes) == 1
    assert routes[0] == {"id": 10, "code": "1", "destination": "Neftçilər - 28 May",
                         "bus_id": 1, "direction_type_id": 1}
    assert len(coords) == 2
    assert coords[0] == {"route_id": 10, "latitude": 40.411594, "longitude": 49.942017, "sequence_order": 0}
    assert coords[1]["sequence_order"] == 1


def test_parse_drops_stops_without_coords():
    payload = {"id": 9, "number": "9", "stops": [
        {"id": 1, "stopName": "No coords", "stopId": 500, "directionTypeId": 1, "stop": {"id": 500}},
    ], "routes": []}
    _, stops, bus_stops, _, _ = parse_bus_detail(payload)
    assert stops == []            # no lat/lng -> excluded from bus_stop_details
    assert len(bus_stops) == 1    # ...but still listed on the route (has a name)


def test_compute_walking_edges_near_and_far():
    stops = [
        {"id": 1, "latitude": 40.4000, "longitude": 49.9000},
        {"id": 2, "latitude": 40.4003, "longitude": 49.9000},  # ~33 m from #1
        {"id": 3, "latitude": 40.5000, "longitude": 49.9000},  # ~11 km from #1/#2
    ]
    edges = compute_walking_edges(stops)
    pairs = {(e["from_stop_id"], e["to_stop_id"]) for e in edges}
    assert pairs == {(1, 2), (2, 1)}          # only the near pair, both directions
    e = next(x for x in edges if x["from_stop_id"] == 1)
    assert 0 < e["distance_km"] < 0.3
    assert e["time_min"] > 0


def test_compute_walking_edges_empty():
    assert compute_walking_edges([]) == []


def test_strip_prisma_params():
    dsn = ("postgresql://u:p@h.eu-central-1.aws.neon.tech/db"
           "?sslmode=require&pgbouncer=true&connection_limit=20&pool_timeout=5")
    out = _strip_prisma_params(dsn)
    assert "pgbouncer" not in out
    assert "connection_limit" not in out
    assert "pool_timeout" not in out
    assert "sslmode=require" in out


def _detail(bid):
    return {"id": bid, "number": str(bid), "carrier": "BakuBus MMC",
            "firstPoint": "A", "lastPoint": "B", "stops": [
                {"id": 1, "stopName": "A", "stopId": 100 + bid, "directionTypeId": 1,
                 "stop": {"id": 100 + bid, "name": "A", "latitude": "40.40", "longitude": "49.90"}},
                {"id": 2, "stopName": "B", "stopId": 200 + bid, "directionTypeId": 1,
                 "stop": {"id": 200 + bid, "name": "B", "latitude": "40.41", "longitude": "49.91"}},
            ], "routes": []}


def test_scrape_skips_a_broken_route(monkeypatch):
    """A single route that persistently errors (AYNA 500s id 96) must NOT abort
    the whole scrape — the regression this run caught."""
    from urllib.error import HTTPError
    listed = [{"id": 1, "number": "1"}, {"id": 96, "number": "96"}, {"id": 2, "number": "2"}]

    def fake_fetch(path, tries=4):
        if path == "/bus/getBusList":
            return listed
        if "id=96" in path:
            raise HTTPError(path, 500, "Internal Server Error", {}, None)
        return _detail(1 if "id=1" in path else 2)

    monkeypatch.setattr(scraper, "fetch", fake_fetch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_a, **_k: None)
    buses, stops, bus_stops, routes, coords, walking, n_listed = scraper.scrape()
    assert n_listed == 3
    assert sorted(b["id"] for b in buses) == [1, 2]   # 96 skipped, scrape survived
    assert len(stops) == 4


def test_split_upsert_counts_inserted_vs_updated():
    # RETURNING (xmax = 0) yields one 1-tuple per affected row: True=inserted,
    # False=updated (ON CONFLICT). Mirrors what psycopg2 fetch=True returns.
    rows = [(True,), (True,), (False,), (True,), (False,)]
    assert _split_upsert(rows) == (3, 2)
    assert _split_upsert([]) == (0, 0)
    assert _split_upsert([(True,), (True,)]) == (2, 0)   # all fresh
    assert _split_upsert([(False,), (False,)]) == (0, 2)  # all updates


def test_numeric_helpers():
    assert fnum("3.5") == 3.5
    assert fnum(None) is None
    assert fnum("x") is None
    assert fint("7") == 7
    assert fint(None) == 0
    assert fint(None, 3) == 3
    assert round(haversine_km(40.40, 49.90, 40.40, 49.90), 6) == 0.0
    assert haversine_km(40.40, 49.90, 40.41, 49.90) > 1.0  # ~1.1 km
