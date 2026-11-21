"""The GTFS writer and reader (busnet/gtfs.py). The writer runs on the two-route test network,
with route 1's outbound line cut short after stop 3 and a repeated point, as AYNA's lines
sometimes are; the reader reads that feed back, and a small feed made up to hold the cases
real feeds have: holidays, extra days, short turns, branches, frequencies, trips without a
direction, a loop, a tram, a number two routes share and a shape stored backwards. Three
more feeds hold a branch large enough to run as a route, express routes, a night bus, and
a line that passes a stop twice with shape_dist_traveled saying which pass the bus stops on."""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from busnet.assumptions import Assumptions
from busnet.geo import PROJ, haversine_m
from busnet.gtfs import read_gtfs, shape_points, write_gtfs
from busnet.metrics import near_duplicates
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
        self.assertEqual(self.table.summary["hours_of_service"], 17)
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

    def test_a_holiday_added_on_top_of_the_usual_timetable_is_passed_over(self):
        from busnet.gtfs import Calendar

        class Doubled:                           # as Cardiff Bus's feed runs 25 December and 1 January
            def columns(self, name, *wanted):
                rows = {"calendar.txt": [("WK", "1", "1", "1", "1", "1", "0", "0", "20261102", "20270129")],
                        "calendar_dates.txt": [("XMAS", "20261225", "1"), ("XMAS", "20270101", "1")]}
                return iter(rows.get(name, []))
        day = Calendar(Doubled()).busiest_weekday({"WK": 10, "XMAS": 6})
        self.assertEqual(day.isoformat(), "2026-11-02")

    def test_a_chosen_day_and_a_day_without_service(self):
        _, table = read_gtfs(self.feed, Assumptions(gtfs_date="2026-11-03"))
        self.assertAlmostEqual(table.trips_each_way["R1"], ((2 + 2 / 5) + 2) / 2, places=3)
        with self.assertRaises(ValueError):
            read_gtfs(self.feed, Assumptions(gtfs_date="2026-11-02"))

    def test_the_projection_moves_to_the_feed(self):
        self.assertAlmostEqual(PROJ.lat0, LAT, delta=0.011)
        self.assertAlmostEqual(PROJ.lon0, LON + 0.03, delta=0.011)



def zipped(folder, name, files):
    """A feed from {file name: text}, as a zip file in folder."""
    path = Path(folder) / name
    with zipfile.ZipFile(path, "w") as z:
        for file, text in files.items():
            z.writestr(file, text)
    return path


def stop_times(rows, hop_s=HOP_S):
    """stop_times.txt from [(trip, [stops], first departure, [shape_dist_traveled or None])]."""
    out = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled\n"
    for trip, stops, start, dist in rows:
        for i, s in enumerate(stops):
            t = clock(start, i * hop_s)
            out += f"{trip},{t},{t},{s},{i + 1},{'' if dist is None else dist[i]}\n"
    return out


BASIC = {"agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA,Test Buses,https://example.org,Asia/Baku\n",
         "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                         "WK,1,1,1,1,1,0,0,20261102,20261130\n"}
STREET = {f"T{i}": (LAT, LON + STEP / 2 * (i - 1)) for i in range(1, 11)}         # ten stops 424 m apart
STREET.update({"T11": (LAT + 0.01, LON + STEP), "T12": (LAT + 0.02, LON + STEP)})   # a branch north from T3
LOCAL = [f"T{i}" for i in range(1, 11)]
BRANCH = ["T1", "T2", "T3", "T11", "T12"]


class BranchesAndExpressTest(unittest.TestCase):
    """A route whose branch carries half its departures, an express along a local route, a route
    named express, and a night bus."""

    def setUp(self):
        keep_projection(self)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        trips = [("L", "l_out_%d" % k, "0", "East", LOCAL, f"{6 + k:02d}:00:00") for k in range(4)]
        trips += [("L", "l_back_%d" % k, "1", "West", LOCAL[::-1], f"{6 + k:02d}:30:00") for k in range(4)]
        trips += [("L", "l_north_%d" % k, "0", "North", BRANCH, f"{6 + k:02d}:15:00") for k in range(4)]
        trips += [("L", "l_south_%d" % k, "1", "Centre", BRANCH[::-1], f"{6 + k:02d}:45:00") for k in range(4)]
        trips += [("X", "x_out", "0", "East", ["T1", "T4", "T7", "T10"], "07:05:00"),
                  ("X", "x_back", "1", "West", ["T10", "T7", "T4", "T1"], "08:05:00"),
                  ("A", "a_out", "0", "Airport", ["T10", "T12"], "07:10:00"),
                  ("N", "n_night", "0", "East", ["T1", "T2"], "26:30:00")]
        files = dict(BASIC)
        files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\n" + "".join(
            f"{k},stop {k},{lat:.6f},{lon:.6f}\n" for k, (lat, lon) in STREET.items())
        files["routes.txt"] = ("route_id,agency_id,route_short_name,route_long_name,route_type\n"
                               "L,A,5,,3\nX,A,5X,,3\nA,A,9,Airport Express,3\nN,A,N1,,3\n")
        files["trips.txt"] = "route_id,service_id,trip_id,direction_id,trip_headsign\n" + "".join(
            f"{r},WK,{t},{d},{h}\n" for r, t, d, h, _, _ in trips)
        files["stop_times.txt"] = stop_times([(t, st, start, None) for _, t, _, _, st, start in trips])
        self.net, self.table = read_gtfs(zipped(tmp.name, "branches.zip", files), Assumptions())

    def test_a_large_branch_runs_as_a_route_of_its_own(self):
        branch = self.net.routes["L~1"]
        self.assertEqual(branch.number, "5 (North)")
        self.assertEqual(self.net.patterns[("L~1", 1)].stop_ids, BRANCH)
        self.assertEqual(self.net.patterns[("L~1", 2)].stop_ids, BRANCH[::-1])
        self.assertFalse(branch.runs_one_way)
        self.assertEqual((self.table.trips_each_way["L"], self.table.trips_each_way["L~1"]), (4, 4))
        self.assertEqual(self.table.summary["branches_run_as_routes"], 1)
        self.assertEqual(self.table.summary["departures_left_out"], 1)          # the night bus

    def test_express_routes_are_found_by_their_stops_and_by_their_name(self):
        self.assertEqual(self.net.routes["X"].zone, "Bus express")              # 4 of the local route's 10 stops
        self.assertEqual(self.net.routes["A"].zone, "Bus express")              # "Airport Express"
        self.assertEqual(self.net.routes["L"].zone, "Bus")
        self.assertNotIn("5X", {r["route"] for r in near_duplicates(self.net, min_stops=4)})

    def test_a_night_bus_does_not_stretch_the_hours_of_service(self):
        s = self.table.summary
        self.assertEqual((s["first_departure"], s["last_departure"]), ("06:00", "26:30"))
        self.assertEqual((s["service_from"], s["service_to"], s["hours_of_service"]), ("06:00", "10:00", 4))

    def test_a_night_bus_is_left_out(self):
        self.assertNotIn("N", self.net.routes)                              # no day route can merge into it
        self.assertEqual((self.table.night, self.table.summary["routes_at_night"]), (["N1"], 1))
        self.assertTrue(any(n.startswith("N1: runs at night, 1 of its 1 departures") and n.endswith("stand for it")
                            for n in self.table.notes))


class ShapeDistanceTest(unittest.TestCase):
    """A line that passes a stop twice, with the bus stopping on the second pass, as the feed's
    shape_dist_traveled says; matching alone takes the nearer, first pass."""

    def setUp(self):
        keep_projection(self)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        line = [(LAT, LON), (LAT, LON + 0.01), (LAT, LON + 0.02), (LAT + 0.01, LON + 0.02), (LAT + 0.01, LON + 0.01),
                (LAT + 0.0002, LON + 0.01), (LAT + 0.0002, LON + 0.03)]
        self.cum = [0.0]
        for (a1, o1), (a2, o2) in zip(line, line[1:]):
            self.cum.append(self.cum[-1] + haversine_m(a1, o1, a2, o2))
        stops = {"P": line[0], "Q": (LAT + 0.00005, LON + 0.01), "R": line[-1]}       # Q: 6 m from the first pass
        files = dict(BASIC)
        files["stops.txt"] = "stop_id,stop_name,stop_lat,stop_lon\n" + "".join(
            f"{k},stop {k},{lat:.6f},{lon:.6f}\n" for k, (lat, lon) in stops.items())
        files["routes.txt"] = "route_id,agency_id,route_short_name,route_type\nR,A,7,3\n"
        files["trips.txt"] = "route_id,service_id,trip_id,direction_id,shape_id\nR,WK,t1,0,S\n"
        files["shapes.txt"] = "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled\n" + "".join(
            f"S,{lat:.6f},{lon:.6f},{k + 1},{self.cum[k] / 1000:.4f}\n" for k, (lat, lon) in enumerate(line))
        self.with_dist = files | {"stop_times.txt": stop_times(
            [("t1", ["P", "Q", "R"], "07:00:00", [0, f"{self.cum[5] / 1000:.4f}", f"{self.cum[6] / 1000:.4f}"])])}
        self.without = files | {"stop_times.txt": stop_times([("t1", ["P", "Q", "R"], "07:00:00", None)])}
        self.folder = tmp.name

    def test_shape_dist_traveled_places_the_stop_on_its_pass(self):
        net, table = read_gtfs(zipped(self.folder, "dist.zip", self.with_dist), Assumptions())
        self.assertAlmostEqual(net.patterns[("R", 1)].chainage_m[1], self.cum[5], delta=5)   # kilometres, as metres
        self.assertEqual(table.summary["directions_placed_by_shape_dist_traveled"], 1)

    def test_without_it_the_nearer_pass_is_taken(self):
        net, table = read_gtfs(zipped(self.folder, "plain.zip", self.without), Assumptions())
        self.assertLess(net.patterns[("R", 1)].chainage_m[1], 1000)
        self.assertEqual(table.summary["directions_placed_by_shape_dist_traveled"], 0)


if __name__ == "__main__":
    unittest.main()
