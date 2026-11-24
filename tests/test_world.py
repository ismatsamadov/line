# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""world.py: each city's saving and its share of today are taken from one baseline, the
redesign's, every published row and the total add up, and nothing is written when they do
not."""

import csv
import json
import tempfile
import unittest
from pathlib import Path

import world

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "output" / "world"


def published():
    with open(FOLDER / "cities.csv", newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    return rows, json.loads((FOLDER / "summary.json").read_text(encoding="utf-8"))


class Baseline(unittest.TestCase):
    def test_every_published_row_and_the_total_add_up(self):
        rows, s = published()
        self.assertEqual(len(rows), s["cities"])
        for r in rows + [s["total"]]:
            n = {k: float(r[k]) for k in ("buses", "fewer_buses", "buses_saved", "buses_capped", "buses_timetable")}
            self.assertEqual(n["buses"] - n["fewer_buses"], n["buses_saved"], r.get("city", "the total"))
            self.assertEqual(n["buses"] + n["buses_capped"], n["buses_timetable"], r.get("city", "the total"))
        t = s["total"]
        for k in ("buses", "fewer_buses", "buses_saved", "buses_capped", "buses_timetable"):
            self.assertEqual(t[k], sum(int(r[k]) for r in rows), k)
        self.assertAlmostEqual(t["share_of_buses_saved"], t["buses_saved"] / t["buses"])
        self.assertAlmostEqual(t["share_of_fuel_saved"], t["fuel_l_saved"] / t["fuel_l"])

    def test_today_is_the_redesigns_baseline_and_the_timetable_is_given_beside_it(self):
        rows, _ = published()
        for r in rows:
            folder = ROOT / "output" / "cities" / r["city"]
            impact = {i["measure"]: i for i in json.loads((folder / "redesign" / "summary.json").read_text(encoding="utf-8"))["impact"]}
            ops = json.loads((folder / "network.json").read_text(encoding="utf-8"))["network"]["operations"]
            self.assertEqual(int(r["buses"]), impact["Buses in service"]["today"], r["city"])
            self.assertAlmostEqual(float(r["fuel_l"]), impact["Fuel a day"]["today"], places=3)
            self.assertAlmostEqual(float(r["door_to_door_min"]),
                                   impact["Average door-to-door trip, possible trips only"]["today"], places=3)
            self.assertEqual(int(r["buses_timetable"]), ops["fleet"], r["city"])
            if int(r["routes_more_often_than_min_headway"]) == 0:
                self.assertEqual(r["buses_capped"], "0", r["city"])

    def test_a_row_that_does_not_add_up_stops_the_table(self):
        good = {"name": "Testville", "buses": 100, "fewer_buses": 80, "buses_saved": 20, "buses_capped": 5,
                "buses_timetable": 105, "routes_more_often_than_min_headway": 1,
                **{k: 10.0 for k in ("bus_hours", "bus_km", "fuel_l", "co2_t")},
                **{f"{k}_saved": 2.0 for k in ("bus_hours", "bus_km", "fuel_l", "co2_t")}}
        world.reconcile([good], good)
        for bad in ({"buses_saved": 25}, {"buses_capped": -1}, {"routes_more_often_than_min_headway": 0},
                    {"fuel_l_saved": 11.0}):
            with self.assertRaises(ValueError, msg=bad):
                world.reconcile([{**good, **bad}], good)

    def test_nothing_is_written_unless_the_table_adds_up(self):
        from unittest import mock
        real = world.city_row
        def off_by_one(*city):                   # Accra's saving one bus more than its baseline less its fewer buses
            row = real(*city)
            return {**row, "buses_saved": row["buses_saved"] + 1} if city[0] == "accra" else row
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(world, "city_row", off_by_one), \
                mock.patch("sys.argv", ["world.py", "--out", str(Path(tmp) / "world")]):
            with self.assertRaises(ValueError):
                world.main()
            self.assertFalse((Path(tmp) / "world").exists())


if __name__ == "__main__":
    unittest.main()
