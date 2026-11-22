"""Regenerate the committed results and compare them with the committed files.

The measurement runs, Baku's (about 12 seconds) and Riga's from its GTFS feed (a few
seconds), and the world table, gathered from the cities' results, always run. The redesigns
(about two minutes each), the measurement of every city of the world pilot (a few minutes),
the benchmark (about three) and the robustness checks (about ten) run only with
BUSNET_SLOW_TESTS=1 in the environment.

A rerun into a folder an earlier run wrote must leave none of the earlier run's tables
behind.

Files must match byte for byte, with one allowance: Python 3.12 changed how sum() adds
floats, so an older Python can differ in the last digits. A JSON file that is not
byte-identical still passes when every number in it matches to 1e-9, and a CSV file when
every number matches to the rounding of the decimals written (one in the 4th decimal) and
every whole number and text exactly."""

import csv
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLOW = os.environ.get("BUSNET_SLOW_TESTS") == "1"
CITY = ROOT / "cities" / "riga.toml"                 # another city, read from its GTFS feed
CITY_OUT = ROOT / "output" / "cities" / "riga"
WORLD_CITIES = sorted(p.stem for p in (ROOT / "cities").glob("*.toml"))


def regenerate(script, out, *args):
    done = subprocess.run([sys.executable, str(ROOT / script), "--out", str(out), *args],
                          cwd=ROOT, capture_output=True, text=True)
    if done.returncode:
        raise AssertionError(f"{script} exited {done.returncode}:\n{done.stderr[-3000:]}")


def _same(a, b, tol):
    """True when two parsed values are equal, numbers to within tol."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=tol, abs_tol=tol)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k], tol) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y, tol) for x, y in zip(a, b))
    return a == b


def _same_cell(a, b):
    """Two CSV cells: the same text, or two numbers no further apart than rounding to the
    decimals written. The writers round floats to 4 decimals (fewer show when the last are
    zeros), so two runs whose floats differ in the last bits can differ by one in the 4th
    decimal; a cell written with more decimals is held to its own last one. Whole numbers,
    such as counts and ids, must match exactly."""
    if a == b:
        return True
    if not (_NUMBER.fullmatch(a) and _NUMBER.fullmatch(b)) or (_WHOLE.fullmatch(a) and _WHOLE.fullmatch(b)):
        return False
    x, y = Decimal(a), Decimal(b)
    places = max(4, -x.as_tuple().exponent, -y.as_tuple().exponent)
    return abs(x - y) <= Decimal(1).scaleb(-places)


_NUMBER = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_WHOLE = re.compile(r"[+-]?\d+")


def _same_csv(expected, actual):
    rows = [list(csv.reader(io.StringIO(data.decode("utf-8-sig")))) for data in (expected, actual)]
    return len(rows[0]) == len(rows[1]) and all(
        len(r) == len(q) and all(_same_cell(a, b) for a, b in zip(r, q)) for r, q in zip(*rows))


def same_file(expected, actual, name):
    if expected == actual:
        return True
    if name.endswith(".json"):
        return _same(json.loads(expected), json.loads(actual), 1e-9)
    if name.endswith(".csv"):
        return _same_csv(expected, actual)
    return False


def differences(expected_dir, actual_dir):
    """Names of committed files that are missing or differ in the regenerated folder."""
    names = sorted(p.name for p in expected_dir.iterdir() if p.is_file() and not p.name.startswith("."))
    out = []
    for n in names:
        if not (actual_dir / n).exists() or not same_file((expected_dir / n).read_bytes(), (actual_dir / n).read_bytes(), n):
            out.append(n)
    return out


class CommittedResults(unittest.TestCase):
    def test_measure_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("measure.py", tmp, "--scenario", "stop-balancing", "--min-gap", "250")
            self.assertEqual(differences(ROOT / "output", Path(tmp)), [])

    def test_city_measure_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("measure.py", tmp, "--config", str(CITY))
            self.assertEqual(differences(CITY_OUT, Path(tmp)), [])

    def test_world_table_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("world.py", tmp)
            self.assertEqual(differences(ROOT / "output" / "world", Path(tmp)), [])

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to measure every city of the world pilot again")
    def test_world_cities_measure_regenerates_output(self):
        missing = [c for c in WORLD_CITIES if c != "baku" and not (ROOT / "data" / "cities" / c / "gtfs.zip").exists()]
        if missing:
            self.skipTest(f"no inputs for {len(missing)} cities here: python3 data/fetch_world.py downloads them")
        for city in WORLD_CITIES:
            with self.subTest(city=city), tempfile.TemporaryDirectory() as tmp:
                regenerate("measure.py", tmp, "--config", str(ROOT / "cities" / f"{city}.toml"))
                self.assertEqual(differences(ROOT / "output" / "cities" / city, Path(tmp)), [])

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to run the two-minute redesign of Riga")
    def test_city_redesign_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("redesign.py", tmp, "--config", str(CITY))
            self.assertEqual(differences(CITY_OUT / "redesign", Path(tmp)), [])

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to run the two-minute redesign")
    def test_redesign_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("redesign.py", tmp)
            self.assertEqual(differences(ROOT / "output" / "redesign", Path(tmp)), [])

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to run the three-minute benchmark")
    def test_benchmark_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("benchmark.py", tmp)
            for sub in ("", "route_sets"):
                self.assertEqual(differences(ROOT / "output" / "benchmark" / sub, Path(tmp) / sub), [])

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to run the ten-minute robustness checks")
    def test_robustness_regenerates_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("robustness.py", tmp)
            self.assertEqual(differences(ROOT / "output" / "robustness", Path(tmp)), [])


class Rerun(unittest.TestCase):
    """A run into a folder an earlier run wrote leaves no table of the earlier run behind."""

    def test_every_table_writer_removes_a_table_that_has_become_empty(self):
        import bicycle
        import measure
        import redesign
        import robustness
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "table.csv"
            for script in (measure, redesign, robustness, bicycle):
                script.write_csv(path, [{"stop_id": 7970, "km": 0.12345}])
                self.assertEqual(path.read_bytes(), "\ufeffstop_id,km\r\n7970,0.1235\r\n".encode())
                script.write_csv(path, [])
                self.assertFalse(path.exists(), script.__name__)

    def test_stop_balancing_that_removes_nothing_after_one_that_removed_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = ("--config", str(CITY), "--od-origins", "2", "--scenario", "stop-balancing")
            removed = Path(tmp) / "scenario_removed_stops.csv"
            regenerate("measure.py", tmp, *args, "--min-gap", "250")
            self.assertTrue(removed.exists())
            regenerate("measure.py", tmp, *args, "--min-gap", "0")
            details = json.loads((Path(tmp) / "scenario.json").read_text(encoding="utf-8"))["details"]
            self.assertEqual((details["removed_stops"], details["removed_stop_visits"]), (0, 0))
            self.assertFalse(removed.exists())


# (cell, cell, the same?) for both CSV comparisons, this one and app.js's (tests/test_app.py).
CSV_CASES = [
    ("401932.5714", "401932.5715", True), ("0.5", "0.5001", True),       # 0.5000 is written 0.5
    ("12.0", "11.9999", True), ("401932.5714", "401982.5714", False),    # 50 more people
    ("401932.5714", "401932.5716", False), ("0.5", "0.6", False),
    ("0.012345678", "0.012345679", True), ("0.012345678", "0.012345688", False),   # eight digits written
    ("401932", "401933", False), ("0123", "123", False),                 # a count is exact, an id is text
    ("-0.0", "0.0", True), ("1e-05", "1.1e-05", True), ("1e-05", "1.2e-05", False),
]


class Comparison(unittest.TestCase):
    def test_numbers_match_to_within_rounding_but_text_must_match_exactly(self):
        self.assertTrue(same_file(b'{"a": [1.00000000001, "x"]}', b'{"a": [1.0, "x"]}', "f.json"))
        self.assertFalse(same_file(b'{"a": [1.01, "x"]}', b'{"a": [1.0, "x"]}', "f.json"))
        self.assertFalse(same_file(b'{"a": "x"}', b'{"a": "y"}', "f.json"))
        self.assertTrue(same_file("﻿r,v\n1,0.1234\n".encode(), "﻿r,v\n1,0.1235\n".encode(), "f.csv"))
        self.assertFalse(same_file("﻿r,v\n1,0.1234\n".encode(), "﻿r,v\n1,0.1244\n".encode(), "f.csv"))
        self.assertFalse(same_file(b"abc", b"abd", "f.txt"))

    def test_a_csv_number_may_move_by_its_last_decimal_and_no_more(self):
        for a, b, same in CSV_CASES:
            csv_ = lambda v: f"﻿route,people\r\n22,{v}\r\n".encode()
            self.assertEqual(same_file(csv_(a), csv_(b), "impact.csv"), same, (a, b))
        self.assertFalse(same_file(b"r,v\r\n1,1.0\r\n", b"r,v\r\n1,1.0\r\n23,2.0\r\n", "f.csv"))

    def test_fifty_more_people_in_rigas_impact_table_are_found(self):
        data = (ROOT / "output" / "cities" / "riga" / "redesign" / "impact.csv").read_bytes()
        text = data.decode("utf-8-sig")
        people = next(r["today"] for r in csv.DictReader(io.StringIO(text)) if r["unit"] == "people")   # about 402,000
        edited = data.replace(people.encode(), f"{Decimal(people) + 50}".encode(), 1)
        self.assertNotEqual(data, edited)
        self.assertFalse(same_file(data, edited, "impact.csv"))
