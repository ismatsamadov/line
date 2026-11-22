"""busnet/graph.py: the stop index finds the nearest stop anywhere within the distance asked
for, and a trip counts as possible exactly when its door-to-door time is within max_trip_min,
in every caller of the journey search: the measurement, the redesign's scoring and the
calibration's paths."""

import unittest

from busnet import calibration
from busnet.assumptions import Assumptions
from busnet.graph import StopIndex
from busnet.metrics import evaluate_od
from busnet.model import Network
from busnet.optimize import Evaluator, Plan

from .helpers import LAT, LON, STEP, route, stop, straight, two_route_network


class NearestStop(unittest.TestCase):
    def test_a_stop_in_the_outer_band_of_the_distance_is_found(self):
        index = StopIndex([stop(1, LAT + 0.0405, LON)])          # 4,503 m north, past the last doubling (4,000 m)
        d, s = index.nearest(LAT, LON, max_m=5000)
        self.assertAlmostEqual(d, index.within(LAT, LON, 5000)[0][0])
        self.assertEqual(s.id, 1)
        self.assertIsNone(index.nearest(LAT, LON, max_m=4500))

    def test_a_distance_below_one_cell(self):
        index = StopIndex([stop(1, LAT + 0.001, LON)])           # 111 m north; cells are 250 m
        self.assertEqual(index.nearest(LAT, LON, max_m=150)[1].id, 1)
        self.assertIsNone(index.nearest(LAT, LON, max_m=100))

    def test_the_nearest_of_several(self):
        index = StopIndex([stop(1, LAT + 0.02, LON), stop(2, LAT, LON + 0.005), stop(3, LAT - 0.03, LON)])
        self.assertEqual(index.nearest(LAT, LON)[1].id, 2)


def network_with_a_change():
    """The two-route street with route 3 turning north from its last stop: from stop 1 to
    stop 7 takes route 1 and then route 3."""
    net = two_route_network()
    stops = dict(net.stops)
    stops[6] = stop(6, LAT + STEP, LON + 4 * STEP)
    stops[7] = stop(7, LAT + 2 * STEP, LON + 4 * STEP)
    routes = {**net.routes, 3: route(3, "3")}
    patterns = {**net.patterns, (3, 1): straight(3, 1, stops, [5, 6, 7]), (3, 2): straight(3, 2, stops, [7, 6, 5])}
    return Network(routes, stops, patterns)


class TripLimit(unittest.TestCase):
    """The search's cost holds the first boarding's transfer penalty on top of a trip's time,
    so a search that stopped at max_trip_min lost trips within it. A trip with one change, and
    one without, each tried with the limit just above and just below its time. The trip ends a
    walk of 200 m from its last stop, so going the other way the search reaches the stop within
    its budget while the trip, walk included, is past the limit."""

    CASES = (("no change", two_route_network, 5, {1: (10, "test"), 2: (15, "test")}, {"0": 1.0}),
             ("one change", network_with_a_change, 7, {1: (10, "test"), 2: (15, "test"), 3: (12, "test")}, {"1": 1.0}))

    def zones(self, net, last):
        end = net.stops[last]
        return [(net.stops[1].lat, net.stops[1].lon, 1), (end.lat + 0.0018, end.lon, 1)]   # 200 m north of the last stop

    def test_trips_on_both_sides_of_the_limit(self):
        for name, make, last, headways, changes in self.CASES:
            net = make()
            zones = self.zones(net, last)
            whole = evaluate_od(net, Assumptions(), zones, headways=headways)
            minutes = whole["mean_door_to_door_min"]
            self.assertEqual((whole["share_reachable"], whole["transfers"]), (1.0, changes), name)
            self.assertGreater(minutes, 15, name)
            for limit, possible in ((minutes + 0.01, True), (minutes - 0.01, False)):
                with self.subTest(trip=name, limit=round(limit, 2)):
                    a = Assumptions(max_trip_min=limit)
                    got = evaluate_od(net, a, zones, headways=headways)
                    self.assertEqual(got["share_reachable"], 1.0 if possible else 0.0)
                    self.assertEqual(sorted(got["modelled_boardings"]), sorted(whole["modelled_boardings"]) if possible else [])
                    if possible:
                        self.assertAlmostEqual(got["mean_door_to_door_min"], minutes, places=9)

                    plan = Plan.from_headways(net, a, headways)
                    score = Evaluator(net, a, zones, n_origins=2, seed=1).score(plan)
                    self.assertAlmostEqual(score["unreachable"], 0.0 if possible else 1.0)
                    self.assertAlmostEqual(score["minutes"], minutes if possible else limit, places=6)

                    _, _, rides = calibration.trip_paths(net, a, zones, n_origins=2, headways=headways)
                    boarded = sorted(r for ride in rides for routes in ride.values() for r in routes)
                    self.assertEqual(boarded, sorted(r for r in whole["modelled_boardings"] for _ in range(2)) if possible else [])


if __name__ == "__main__":
    unittest.main()
