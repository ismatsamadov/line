"""busnet/calibration.py and calibrate.py: the trips found once and spread again for any
demand settings give exactly the boardings metrics.evaluate_od gives for those settings,
and the committed output/calibration/ agrees with itself."""

import json
import math
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import calibrate
from busnet import calibration
from busnet.assumptions import Assumptions
from busnet.destinations import metro_points, zone_attraction
from busnet.metrics import evaluate_od
from calibrate import spearman
from tests.helpers import LAT, LON, STEP, two_route_network
from tests.test_graph import network_with_a_change

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "output" / "calibration"


def zones():
    """Places along and beside the test street, with people; some too far from a stop."""
    out = []
    for i in range(30):
        lon = LON - STEP + STEP * 6 * i / 29
        for dlat, people in ((0.0, 100 + 10 * i), (0.003, 50 + i), (0.02, 30)):
            out.append((LAT + dlat, lon, people))
    return out


class SameAsEvaluate(unittest.TestCase):
    def test_boardings_match_evaluate_od_for_any_settings(self):
        net, z = two_route_network(), zones()
        for decay_km, pull_of in ((6.0, None), (1.0, None), (2.5, lambda i, p: p * (1 + (i % 4)))):
            a = replace(Assumptions(), trip_decay_km=decay_km)
            pull = [pull_of(i, p) for i, (_, _, p) in enumerate(z)] if pull_of else None
            ref = evaluate_od(net, a, z, n_origins=40, seed=3, attraction=pull)["modelled_boardings"]
            origins, distances, rides = calibration.trip_paths(net, a, z, n_origins=40, seed=3)
            got = calibration.boardings(origins, rides, calibration.decay_weights(distances, decay_km),
                                        pull or [p for _, _, p in z])
            self.assertTrue(ref, "the test network must produce boardings")
            self.assertEqual(set(ref), set(got))
            for route, value in ref.items():
                self.assertTrue(math.isclose(got[route], value, rel_tol=1e-12), (decay_km, route, got[route], value))

    def test_trip_length_matches_evaluate_od(self):
        net, z = two_route_network(), zones()
        for decay_km in (0.8, 6.0):
            a = replace(Assumptions(), trip_decay_km=decay_km)
            ref = evaluate_od(net, a, z, n_origins=40, seed=3)["mean_trip_km_straight_line"]
            origins, distances, rides = calibration.trip_paths(net, a, z, n_origins=40, seed=3)
            _, km = calibration.spread(origins, rides, calibration.decay_weights(distances, decay_km),
                                       [p for _, _, p in z], distances)
            self.assertTrue(math.isclose(km, ref, rel_tol=1e-12), (decay_km, km, ref))

    def test_paths_do_not_depend_on_the_decay(self):
        net, z = two_route_network(), zones()
        a, b = (calibration.trip_paths(net, replace(Assumptions(), trip_decay_km=k), z, n_origins=20, seed=5)
                for k in (1.0, 30.0))
        self.assertEqual(a[0], b[0])
        self.assertEqual(a[2], b[2])


class TodaysSettings(unittest.TestCase):
    """calibrate.py scores today's settings wherever they fall, and scores every metro weight
    when today's is 0: two settings that stopped it."""

    def test_settings_between_the_grids_points_are_scored(self):
        self.assertEqual(len(calibrate.settings_to_score((6, 0.5, 2))), 420)
        a = Assumptions(destination_share=0.55)
        today = (a.trip_decay_km, a.destination_share, a.metro_weight_per_1000_entries)
        settings = calibrate.settings_to_score(today)
        self.assertEqual((len(settings), settings[-1]), (421, today))
        net, z = network_with_a_change(), zones()             # three routes, so that a fit is defined
        osm = [(LAT + 0.003, LON + 2 * STEP, 50.0, "university")]
        pull = calibrate.pulls(z, osm, [], dict.fromkeys(k[1:] for k in settings))
        origins, distances, rides = calibration.trip_paths(net, a, z, n_origins=40, seed=3)
        observed = {"1": 900.0, "2A": 300.0, "3": 150.0}
        grid, trip_km, rows, _ = calibrate.score(net, settings, origins, distances, rides, pull, observed,
                                                 sorted(observed), say=lambda line: None)
        self.assertEqual(len(rows), 421)
        direct = calibration.boardings(origins, rides, calibration.decay_weights(distances, 6.0),
                                       zone_attraction(z, osm, 0.55))
        self.assertEqual(grid[today], calibrate.counted_boardings(net, direct, sorted(observed)))
        self.assertGreater(trip_km[today], 0)

    def test_a_metro_weight_of_zero_today_keeps_the_counts_for_the_other_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            passengers, exits = Path(tmp) / "passengers.csv", Path(tmp) / "exits.csv"
            passengers.write_text("date;station;entries\n2026-09-01;Station A;12000\n2026-09-02;Station A;14000\n"
                                  "2026-09-01;Station B;3000\n2026-09-02;Station B;5000\n", encoding="utf-8")
            exits.write_text("id;station;lat;lon\n1;Station A;40400000;49810000\n2;Station A;40401000;49811000\n"
                             "3;Station B;40403000;49840000\n", encoding="utf-8")
            z = zones()
            osm = [(LAT + 0.003, LON + 2 * STEP, 50.0, "university")]
            keys = dict.fromkeys(k[1:] for k in calibrate.settings_to_score((6, 0.5, 0)))
            got = calibrate.pulls(z, osm, metro_points(passengers, exits, 1.0)[0], keys)
            for share, weight in keys:
                ref = zone_attraction(z, osm + metro_points(passengers, exits, weight)[0], share) or [p for _, _, p in z]
                self.assertTrue(all(math.isclose(g, r, rel_tol=1e-12) for g, r in zip(got[(share, weight)], ref)),
                                (share, weight))
            self.assertNotEqual(got[(0.5, 0)], got[(0.5, 2)])


class TradeoffFromFiles(unittest.TestCase):
    def test_todays_settings_off_the_grid_with_many_decimals(self):
        """--tradeoff-only reads today's settings back from summary.json, unrounded, and finds them
        among grid.csv's rows, which write_csv rounds to 4 decimals."""
        today = (6.0, 0.12345, 2.0)
        keys = [(6, 0.5, 2), today]
        routes = [("1", 900.0, 0.5), ("2A", 300.0, 0.3), ("3", 150.0, 0.2)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            calibrate.write_csv(out / "routes.csv", [{"route": n, "observed_weekday_boardings": o} for n, o, _ in routes])
            calibrate.write_csv(out / "grid.csv", [{"trip_decay_km": d, "destination_share": sh, "metro_weight_per_1000_entries": m,
                                                    "mean_trip_km_straight_line": 8.0 + k} for k, (d, sh, m) in enumerate(keys)])
            calibrate.write_csv(out / "grid_routes.csv", [{"trip_decay_km": d, "destination_share": sh,
                                                           "metro_weight_per_1000_entries": m, "route": n, "modelled_share": share}
                                                          for d, sh, m in keys for n, _, share in routes])
            (out / "summary.json").write_text(json.dumps({"today": dict(zip(
                ("trip_decay_km", "destination_share", "metro_weight_per_1000_entries"), today))}), encoding="utf-8")
            rows = calibrate.tradeoff_from_files(out)
        self.assertAlmostEqual(rows[-1]["least_trip_km"], 9.0)          # today's trips, read back from grid.csv
        self.assertTrue(all(r["settings"] >= 1 for r in rows))


class Spearman(unittest.TestCase):
    def test_ranks_with_ties(self):
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)
        self.assertAlmostEqual(spearman([1, 2, 2, 3], [1, 2, 3, 4]), 0.9486832980505138)


class Committed(unittest.TestCase):
    def test_summary_agrees_with_the_grid(self):
        import csv
        s = json.loads((FOLDER / "summary.json").read_text(encoding="utf-8"))
        with open(FOLDER / "grid.csv", newline="", encoding="utf-8-sig") as f:
            grid = list(csv.DictReader(f))
        key = lambda r: (float(r["trip_decay_km"]), float(r["destination_share"]), float(r["metro_weight_per_1000_entries"]))
        fit = {key(r): float(r["spearman"]) for r in grid}
        best = max(fit.values())
        self.assertAlmostEqual(best, s["best_on_all_routes"]["spearman"], places=3)
        today = s["today"]
        self.assertAlmostEqual(fit[(today["trip_decay_km"], today["destination_share"], today["metro_weight_per_1000_entries"])],
                               today["spearman_on_grid_sample"], places=3)
        self.assertLessEqual(s["cross_validated"]["spearman_mean"], best + 1e-9)
        self.assertLessEqual(s["fitted"]["mean_trip_km_straight_line"], today["mean_trip_km_straight_line"])

    def test_tradeoff_narrows_the_settings_as_trips_lengthen(self):
        import csv
        with open(FOLDER / "tradeoff.csv", newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        s = json.loads((FOLDER / "summary.json").read_text(encoding="utf-8"))
        least = [float(r["least_trip_km"]) for r in rows]
        self.assertEqual(least, sorted(least))
        counts = [int(r["settings"]) for r in rows]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertEqual(counts[0], s["grid"]["settings_scored"])
        for r in rows:
            self.assertGreaterEqual(float(r["chosen_most_trip_km"]) + 1e-9, float(r["least_trip_km"]))
        self.assertAlmostEqual(least[-1], s["today"]["mean_trip_km_straight_line"], places=3)


if __name__ == "__main__":
    unittest.main()
