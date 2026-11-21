"""The GTFS writer and reader (busnet/gtfs.py). The writer runs on the two-route test network,
with route 1's outbound line cut short after stop 3 and a repeated point, as AYNA's lines
sometimes are; the reader reads that feed back, and a small feed made up to hold the cases
real feeds have: holidays, extra days, short turns, branches, frequencies, trips without a
direction, a loop, a tram, a number two routes share and a shape stored backwards."""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from busnet.assumptions import Assumptions
from busnet.geo import PROJ
from busnet.gtfs import read_gtfs, shape_points, write_gtfs
from busnet.model import Pattern
from busnet.service import operations, route_headways

from .helpers import LAT, LON, STEP, two_route_network


def short_line_network():
    net = two_route_network()
    p = net.patterns[(1, 1)]
    pts = [(net.stops[s].lat, net.stops[s].lon) for s in p.stop_ids]
    net.patterns[(1, 1)] = Pattern(1, 1, p.stop_ids, p.chainage_m, [pts[0], pts[0], pts[1], pts[2]], "shape")
    return net


def read(feed):
    with zipfile.ZipFile(feed) as z:
        return {name: list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8")))) for name in z.namelist()}


class GtfsTest(unittest.TestCase):
    def setUp(self):
        self.net = short_line_network()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.feed = Path(tmp.name) / "feed.zip"
        write_gtfs(self.feed, self.net, Assumptions(), {1: (10, "test"), 2: (15, "test")}, "today")
        self.tables = read(self.feed)

    def test_files_and_feed_info(self):
        for name in ("agency.txt", "feed_info.txt", "stops.txt", "routes.txt", "calendar.txt", "trips.txt",
                     "stop_times.txt", "shapes.txt", "frequencies.txt"):
            self.assertIn(name, self.tables)
        info = self.tables["feed_info.txt"][0]
        self.assertEqual(info["feed_version"], "today")
        self.assertEqual(info["feed_lang"], "az")

    def test_stop_times_resolve_and_increase(self):
        stops = {r["stop_id"] for r in self.tables["stops.txt"]}
        trips = {r["trip_id"] for r in self.tables["trips.txt"]}
        last = {}
        for r in self.tables["stop_times.txt"]:
            self.assertIn(r["stop_id"], stops)
            self.assertIn(r["trip_id"], trips)
            self.assertGreater(r["arrival_time"], last.get(r["trip_id"], ""))
            last[r["trip_id"]] = r["arrival_time"]

    def test_repeated_points_are_written_once(self):
        for shape in {r["shape_id"] for r in self.tables["shapes.txt"]}:
            dist = [float(r["shape_dist_traveled"]) for r in self.tables["shapes.txt"] if r["shape_id"] == shape]
            self.assertTrue(all(b > a for a, b in zip(dist, dist[1:])), shape)

    def test_short_line_is_carried_on_to_the_last_stops(self):
        pts = shape_points(self.net.patterns[(1, 1)], self.net)
        stops = [(self.net.stops[s].lat, self.net.stops[s].lon) for s in (4, 5)]
        self.assertEqual(pts[-2:], stops)
        rows = [r for r in self.tables["shapes.txt"] if r["shape_id"] == "shape_1_1"]
        self.assertEqual(len(rows), 5)                # stops 1, 2 and 3 on the line, then 4 and 5
        self.assertAlmostEqual(float(rows[-1]["shape_dist_traveled"]), self.net.patterns[(1, 1)].length_m, delta=1)

    def test_full_lines_are_left_alone(self):
        p = self.net.patterns[(1, 2)]
        self.assertEqual(shape_points(p, self.net), p.path)


def keep_projection(test):
    """read_gtfs moves the shared projection to the feed's stops; put it back after the test."""
    test.addCleanup(PROJ.centre_on, PROJ.lat0, PROJ.lon0)


class ReadBackTest(unittest.TestCase):
    """The feed the writer makes, read back: the same network, headways and speeds."""

    def setUp(self):
        keep_projection(self)
        self.net, self.a = two_route_network(), Assumptions()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        feed = Path(tmp.name) / "feed.zip"
        write_gtfs(feed, self.net, self.a, {1: (10, "test"), 2: (15, "test")}, "today")
        self.back, self.table = read_gtfs(feed, self.a)

    def test_same_routes_stops_and_lengths(self):
        self.assertEqual(sorted(r.number for r in self.back.routes.values()), ["1", "2A"])
        for (rid, d), p in self.net.patterns.items():
            q = self.back.patterns[(str(rid), d)]
            self.assertEqual(q.stop_ids, [str(s) for s in p.stop_ids])
            self.assertAlmostEqual(q.length_m, p.length_m, delta=1)

    def test_headways_and_speeds_come_back(self):
        hw = route_headways(self.back, self.a, timetable=self.table.trips_each_way)
        self.assertAlmostEqual(hw["1"][0], 10, places=6)
        self.assertAlmostEqual(hw["2"][0], 15, places=6)
        self.assertAlmostEqual(self.back.routes["1"].speed_kmh, 22, delta=0.1)       # the urban zone's speed
        self.assertAlmostEqual(self.back.routes["2"].speed_kmh, 29, delta=0.1)       # suburban
        self.assertEqual(self.table.summary["hours_of_departures"], 17)
        self.assertEqual(self.table.warnings, [])


STOPS = {f"S{i}": (LAT, LON + STEP * (i - 1)) for i in range(1, 7)}              # a street, 847 m between stops
STOPS.update({"S7": (LAT + 0.01, LON + 0.02), "S8": (LAT + 0.02, LON + 0.02),     # a branch to the north
              "S9": (LAT + 0.01, LON + 0.04), "S10": (LAT + 0.01, LON + 0.03),    # the far side of a loop
              "Q1": (LAT - 0.01, LON), "Q2": (LAT - 0.01, LON + STEP)})           # a tram line
OUT = ["S1", "S2", "S3", "S4", "S5", "S6"]
TRIPS = [   # route, service, trip, direction_id, shape, stops, first departure
    ("R1", "WK", "r1_out_1", "0", "SH1", OUT, "06:00:00"),
    ("R1", "WK", "r1_out_2", "0", "SH1", OUT, "07:00:00"),
    ("R1", "XT", "r1_extra", "0", "SH1", OUT, "08:00:00"),                        # Wednesday 4 November only
    ("R1", "WK", "r1_short", "0", "", ["S1", "S2", "S3"], "09:00:00"),             # a short turn
    ("R1", "WK", "r1_branch", "0", "", ["S1", "S2", "S7", "S8"], "10:00:00"),      # a branch
    ("R1", "WK", "r1_back_1", "1", "SH1", OUT[::-1], "06:30:00"),                 # the outbound shape, backwards
    ("R1", "WK", "r1_back_2", "1", "SH1", OUT[::-1], "07:30:00"),
    ("R2", "WK", "r2_freq", "", "", ["S2", "S3", "S4", "S5"], "06:00:00"),         # no direction_id; frequencies
    ("R2", "WK", "r2_back", "", "", ["S5", "S4", "S3", "S2"], "09:00:00"),
    ("L1", "WK", "l1", "0", "", ["S3", "S4", "S9", "S10", "S3"], "06:00:00"),      # a loop, one way
    ("T1", "WK", "t1", "0", "", ["Q1", "Q2"], "06:00:00"),                         # a tram
    ("R3", "WK", "r3", "0", "", ["S5", "S6"], "06:00:00"),                         # route number 1 again
]
HOP_S = 150      # scheduled seconds between stops: 130 moving plus the model's 20 at a stop: 23.5 km/h


def clock(text, plus):
    h, m, s = map(int, text.split(":"))
    t = h * 3600 + m * 60 + s + plus
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def made_up_feed(folder):
    """The feed as a zip with its files in a folder inside it and a byte-order mark in stops.txt."""
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,Test Buses,https://example.org,Asia/Baku\n",
        "stops.txt": "\ufeffstop_id,stop_name,stop_lat,stop_lon\n" + "".join(
            f"{k},stop {k},{lat:.6f},{lon:.6f}\n" for k, (lat, lon) in STOPS.items()),
        "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\n"
                      "R1,A,1,,3\nR2,A,2,,700\nL1,A,L,Loop,3\nT1,A,T,,0\nR3,A,1,,3\n",
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        "WK,1,1,1,1,1,0,0,20261102,20261130\n",
        "calendar_dates.txt": "service_id,date,exception_type\nWK,20261102,2\nXT,20261104,1\n",
        "trips.txt": "route_id,service_id,trip_id,direction_id,shape_id\n" + "".join(
            f"{r},{sv},{t},{d},{sh}\n" for r, sv, t, d, sh, _, _ in TRIPS),
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "".join(
            f"{t},{clock(start, i * HOP_S)},{clock(start, i * HOP_S)},{s},{10 * (i + 1)}\n"
            for _, _, t, _, _, stops, start in TRIPS for i, s in enumerate(stops)),
        "frequencies.txt": "trip_id,start_time,end_time,headway_secs\nr2_freq,06:00:00,08:00:00,600\n",
        "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" + "".join(
            f"SH1,{LAT:.6f},{LON + STEP * k / 2:.6f},{k + 1}\n" for k in range(11)),
    }
    path = Path(folder) / "made_up.zip"
    with zipfile.ZipFile(path, "w") as z:
        for name, text in files.items():
            z.writestr(f"gtfs/{name}", text)
    return path


class ReadTest(unittest.TestCase):
    def setUp(self):
        keep_projection(self)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.feed = made_up_feed(tmp.name)
        self.a = Assumptions()
        self.net, self.table = read_gtfs(self.feed, self.a)
        self.s = self.table.summary

    def test_the_busiest_weekday_counts_extra_days_and_skips_holidays(self):
        self.assertEqual((self.table.day, self.s["weekday"]), ("2026-11-04", "Wednesday"))

    def test_only_buses_are_read_and_shared_numbers_are_told_apart(self):
        self.assertEqual(self.s["routes_of_other_types"], {"Tram": 1})
        self.assertEqual(sorted(r.number for r in self.net.routes.values()), ["1 [R1]", "1 [R3]", "2", "L"])
        net, _ = read_gtfs(self.feed, Assumptions(gtfs_route_types=[3, 0]))
        self.assertEqual(net.routes["T1"].zone, "Tram")

    def test_short_turns_count_by_distance_and_branches_are_left_out(self):
        self.assertEqual(self.net.patterns[("R1", 1)].stop_ids, OUT)
        self.assertAlmostEqual(self.table.trips_each_way["R1"], ((3 + 2 / 5) + 2) / 2, places=3)
        self.assertEqual((self.s["departures_on_part_of_a_pattern"], self.s["departures_left_out"]), (1, 1))
        self.assertEqual(self.s["stops_only_on_departures_left_out"], 2)
        self.assertAlmostEqual(self.s["share_of_departures_modelled"], 21 / 22)
        self.assertTrue(any(n.startswith("1 [R1] d1: 1 other stop sequence") for n in self.table.notes))

    def test_frequencies_and_directions_without_ids(self):
        self.assertEqual(self.net.patterns[("R2", 1)].stop_ids, ["S2", "S3", "S4", "S5"])
        self.assertEqual(self.net.patterns[("R2", 2)].stop_ids, ["S5", "S4", "S3", "S2"])
        self.assertAlmostEqual(self.table.trips_each_way["R2"], (12 + 1) / 2)
        self.assertEqual(route_headways(self.net, self.a, timetable=self.table.trips_each_way)["R2"],
                         (17 * 60 / 6.5, "timetable"))

    def test_speed_is_the_timetable_less_the_time_at_stops(self):
        hop_m = self.net.patterns[("R1", 1)].length_m / 5
        self.assertAlmostEqual(self.net.routes["R1"].speed_kmh, hop_m / (HOP_S - 20) * 3.6, places=6)
        self.assertEqual((self.s["speeds_from_timetable"], self.s["speeds_from_settings"]), (4, 0))

    def test_a_shape_stored_backwards_is_reversed(self):
        self.assertIn("1 [R1] d2: shape was stored backwards; reversed", self.net.repairs)
        p = self.net.patterns[("R1", 2)]
        self.assertEqual(p.path_source, "shape")
        self.assertAlmostEqual(p.length_m, self.net.patterns[("R1", 1)].length_m, delta=1)

    def test_a_loop_runs_one_way_and_is_not_counted_back(self):
        loop = self.net.routes["L1"]
        self.assertTrue(loop.runs_one_way)
        self.assertFalse(self.net.routes["R1"].runs_one_way)
        row = operations(self.net, self.a, {"L1": (60, "timetable")})[0]["L1"]
        self.assertAlmostEqual(row["trips_per_day"], 17)

    def test_an_old_long_service_does_not_hide_a_newer_busier_one(self):
        from busnet.gtfs import Calendar

        class Old:
            def columns(self, name, *wanted):
                rows = {"calendar.txt": [("OLD", "1", "1", "1", "1", "1", "0", "0", "20150101", "20301231"),
                                         ("NEW", "1", "1", "1", "1", "1", "0", "0", "20261102", "20270630")]}
                return iter(rows.get(name, []))
        day = Calendar(Old()).busiest_weekday({"OLD": 1, "NEW": 5})
        self.assertEqual(day.isoformat(), "2026-11-02")

    def test_a_chosen_day_and_a_day_without_service(self):
        _, table = read_gtfs(self.feed, Assumptions(gtfs_date="2026-11-03"))
        self.assertAlmostEqual(table.trips_each_way["R1"], ((2 + 2 / 5) + 2) / 2, places=3)
        with self.assertRaises(ValueError):
            read_gtfs(self.feed, Assumptions(gtfs_date="2026-11-02"))

    def test_the_projection_moves_to_the_feed(self):
        self.assertAlmostEqual(PROJ.lat0, LAT, delta=0.011)
        self.assertAlmostEqual(PROJ.lon0, LON + 0.03, delta=0.011)


if __name__ == "__main__":
    unittest.main()
