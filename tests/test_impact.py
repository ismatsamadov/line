# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""The impact table (busnet/impact.py): which rows appear, and that a change is after less today."""

import unittest

from busnet.assumptions import Assumptions
from busnet.impact import COLUMNS, capped_minutes, impact_rows


def summary(minutes, reach, people, fleet, hours, km, fuel):
    return {"accessibility": {"mean_door_to_door_min": minutes, "share_reachable": reach, "share_within_45_min": 0.3},
            "population_within_coverage_radius": people,
            "operations": {"fleet": fleet, "bus_hours_per_day": hours, "bus_km_per_day": km,
                           "fuel_l_per_day": fuel, "co2_t_per_day": fuel * 2.67 / 1000}}


TODAY = summary(50.0, 0.6, 1000, 100, 1500, 30000, 12000)
SAME = summary(48.0, 0.62, 990, 100, 1500, 31000, 12500)
FEWER = summary(50.5, 0.61, 990, 90, 1350, 27900, 11250)


class ImpactTest(unittest.TestCase):
    def rows(self, **settings):
        return {r["measure"]: r for r in impact_rows(TODAY, SAME, FEWER, Assumptions(**settings))}

    def test_capped_minutes_count_impossible_trips_at_the_limit(self):
        self.assertAlmostEqual(capped_minutes(TODAY["accessibility"], Assumptions()), 0.6 * 50 + 0.4 * 120)

    def test_without_prices_only_physical_rows(self):
        rows = self.rows()
        self.assertEqual(len(rows), 11)
        self.assertFalse(any("cost" in m or "year" in m or "Value" in m for m in rows))
        fuel = rows["Fuel a day"]
        self.assertEqual(list(fuel), list(COLUMNS))
        self.assertEqual((fuel["same_buses_change"], fuel["fewer_buses_change"]), (500, -750))
        buses = rows["Buses in service"]
        self.assertEqual((buses["same_buses_change"], buses["fewer_buses_change"]), (0, -10))

    def test_minutes_per_trip_and_hours_per_100000_journeys(self):
        rows = self.rows()
        trip = rows["Average door-to-door trip, impossible trips counted at 120 min"]
        self.assertAlmostEqual(trip["same_buses_change"], (0.62 * 48 + 0.38 * 120) - (0.6 * 50 + 0.4 * 120))
        hours = rows["Riders' time per 100,000 journeys"]
        self.assertAlmostEqual(hours["same_buses_change"], trip["same_buses_change"] * 100_000 / 60)

    def test_prices_journeys_and_a_year(self):
        rows = self.rows(daily_journeys=600_000, value_of_time=5, fuel_price=1.2, cost_per_bus_hour=20,
                         currency="AZN", days_per_year=300)
        self.assertAlmostEqual(rows["Fuel cost a day"]["fewer_buses_change"], -750 * 1.2)
        self.assertAlmostEqual(rows["Running cost a day, besides fuel"]["fewer_buses_change"], -150 * 20)
        trip_change = rows["Average door-to-door trip, impossible trips counted at 120 min"]["same_buses_change"]
        self.assertAlmostEqual(rows["Riders' time a day"]["same_buses_change"], trip_change * 600_000 / 60)
        self.assertAlmostEqual(rows["Value of riders' time a year"]["same_buses_change"],
                               trip_change * 600_000 / 60 * 5 * 300)
        self.assertEqual(rows["Fuel cost a year"]["unit"], "AZN")
        self.assertAlmostEqual(rows["CO2 a year"]["fewer_buses_change"], -750 * 2.67 / 1000 * 300)


if __name__ == "__main__":
    unittest.main()
