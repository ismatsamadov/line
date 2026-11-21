"""busnet/calibration.py and calibrate.py: the trips found once and spread again for any
demand settings give exactly the boardings metrics.evaluate_od gives for those settings,
and the committed output/calibration/ agrees with itself."""

import json
import math
import unittest
from dataclasses import replace
from pathlib import Path

from busnet import calibration
from busnet.assumptions import Assumptions
from busnet.metrics import evaluate_od
from calibrate import spearman
from tests.helpers import LAT, LON, STEP, two_route_network

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
        self.assertEqual(counts[0], len(s["grid"]["trip_decay_km"]) * len(s["grid"]["destination_share"])
                         * len(s["grid"]["metro_weight_per_1000_entries"]))
        for r in rows:
            self.assertGreaterEqual(float(r["chosen_most_trip_km"]) + 1e-9, float(r["least_trip_km"]))
        self.assertAlmostEqual(least[-1], s["today"]["mean_trip_km_straight_line"], places=3)


if __name__ == "__main__":
    unittest.main()
