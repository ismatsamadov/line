# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import math
import unittest

from busnet.assumptions import Assumptions
from busnet.service import fuel_l, operations, route_headways, run_time_s
from tests.helpers import route, two_route_network


class Headways(unittest.TestCase):
    def setUp(self):
        self.net = two_route_network()
        self.a = Assumptions()

    def test_supplied_beats_everything(self):
        hw = route_headways(self.net, self.a, observed={"2A": 6120}, supplied={"2A": 7.5}, timetable={2: 100})
        self.assertEqual(hw[2], (7.5, "supplied"))

    def test_a_timetable_beats_boardings_and_is_not_clamped(self):
        # 680 trips each way over 17 hours: every 1.5 minutes, faster than min_headway_min allows an estimate
        hw = route_headways(self.net, self.a, observed={"1": 6120}, timetable={1: 680, 2: 51})
        self.assertEqual(hw[1], (1.5, "timetable"))
        self.assertEqual(hw[2], (20.0, "timetable"))

    def test_ridership_headway_from_boardings(self):
        # 6,120 boardings a day, 60 per trip: 51 trips each way over 17 hours = every 20 minutes
        hw = route_headways(self.net, self.a, observed={"1": 6120})
        self.assertEqual(hw[1], (20.0, "ridership"))

    def test_ridership_headway_is_clamped(self):
        self.assertEqual(route_headways(self.net, self.a, observed={"1": 1_000_000})[1], (3.0, "ridership"))
        self.assertEqual(route_headways(self.net, self.a, observed={"1": 10})[1], (30.0, "ridership"))

    def test_zone_then_default(self):
        hw = route_headways(self.net, self.a, observed={"1": 6120}, supplied=None)
        self.assertEqual(hw[2], (15, "zone"))                                  # suburban
        off = Assumptions(headway_from_ridership=False)
        self.assertEqual(route_headways(self.net, off, observed={"1": 6120})[1], (10, "zone"))   # urban
        self.net.routes[2] = route(2, "2A", zone="Nowhere")
        self.assertEqual(route_headways(self.net, self.a)[2], (12, "default"))

    def test_routes_without_stops_get_no_headway(self):
        self.net.routes[3] = route(3, "3")
        self.assertNotIn(3, route_headways(self.net, self.a))


class TripsAndService(unittest.TestCase):
    def setUp(self):
        self.net = two_route_network()
        self.a = Assumptions()
        self.p = self.net.patterns[(1, 1)]

    def test_run_time_and_fuel_follow_the_formulas(self):
        self.assertAlmostEqual(run_time_s(self.p, self.net, self.a), self.p.length_m / (22 / 3.6) + 4 * 20)
        self.assertAlmostEqual(fuel_l(self.p, self.a), self.p.length_m / 1000 * 0.30 + 4 * 0.05)

    def test_daily_service_from_a_headway(self):
        per_route, total = operations(self.net, self.a, {1: (10, "zone")})
        row = per_route[1]
        round_trip_s = sum(run_time_s(p, self.net, self.a) for p in self.net.patterns_of(1))
        self.assertAlmostEqual(row["trips_per_day"], 2 * 17 * 60 / 10)
        self.assertAlmostEqual(row["bus_hours_per_day"], 102 * round_trip_s / 3600)
        self.assertAlmostEqual(row["bus_km_per_day"], 102 * 2 * self.p.length_m / 1000)
        self.assertEqual(row["fleet"], math.ceil(round_trip_s / 60 * 1.15 / 10))
        self.assertEqual(total["fleet"], row["fleet"])
        self.assertAlmostEqual(total["co2_t_per_day"], total["fuel_l_per_day"] * 2.67 / 1000)
        self.assertEqual(total["headway_sources"], {"supplied": 0, "ridership": 0, "zone": 1, "default": 0})

    def test_a_one_direction_route_is_counted_out_and_back(self):
        del self.net.patterns[(2, 2)]
        row = operations(self.net, self.a, {2: (15, "zone")})[0][2]
        self.assertAlmostEqual(row["bus_km_per_day"], (17 * 60 / 15) * 2 * self.net.patterns[(2, 1)].length_m / 1000)

    def test_a_loop_that_runs_one_way_is_not(self):
        del self.net.patterns[(2, 2)]
        self.net.routes[2].runs_one_way = True
        row = operations(self.net, self.a, {2: (15, "timetable")})[0][2]
        one_way_s = run_time_s(self.net.patterns[(2, 1)], self.net, self.a)
        self.assertAlmostEqual(row["trips_per_day"], 17 * 60 / 15)
        self.assertAlmostEqual(row["bus_km_per_day"], (17 * 60 / 15) * self.net.patterns[(2, 1)].length_m / 1000)
        self.assertEqual(row["fleet"], math.ceil(one_way_s / 60 * 1.15 / 15))

    def test_a_speed_from_a_timetable_replaces_the_zones(self):
        self.net.routes[1].speed_kmh = 36.0
        self.assertAlmostEqual(run_time_s(self.p, self.net, self.a), self.p.length_m / 10 + 4 * 20)
