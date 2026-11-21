"""data/bakubus_route_hours.csv, the first and last departures BakuBus publishes: every route is
a BakuBus route of the AYNA snapshot, and the hours docs/data.md quotes come from the file."""

import csv
import sqlite3
import statistics
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def minutes(text):
    h, m = map(int, text.split(":"))
    return h * 60 + m


class BakuBusHours(unittest.TestCase):
    def setUp(self):
        with open(ROOT / "data" / "bakubus_route_hours.csv", newline="", encoding="utf-8") as f:
            self.rows = list(csv.DictReader(f))
        self.span = {}
        for r in self.rows:
            first, last = minutes(r["first_departure"]), minutes(r["last_departure"])
            self.span[r["route"]] = ((last - first) % (24 * 60)) / 60          # H1's last bus leaves after midnight

    def test_every_route_is_a_bakubus_route_of_the_snapshot(self):
        con = sqlite3.connect(f"file:{ROOT / 'data' / 'ayna.db'}?mode=ro", uri=True)
        carrier = dict(con.execute("SELECT number, carrier FROM buses"))
        con.close()
        self.assertEqual(len(self.rows), 52)
        for r in self.rows:
            self.assertTrue(carrier.get(r["route"], "").startswith("BakuBus"), r["route"])

    def test_the_hours_docs_quote(self):
        v = list(self.span.values())
        self.assertAlmostEqual(statistics.mean(v), 16.95, delta=0.005)
        self.assertEqual(statistics.median(v), 17.5)
        self.assertEqual((min(self.span, key=self.span.get), min(v)), ("E1", 13.0))
        self.assertEqual((max(self.span, key=self.span.get), max(v)), ("H1", 19.0))
        self.assertEqual(sum(1 for r in self.rows if minutes(r["first_departure"]) < 6 * 60), 21)


if __name__ == "__main__":
    unittest.main()
