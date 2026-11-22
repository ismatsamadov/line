"""Regenerate the committed results and compare them with the committed files.

The measurement runs, Baku's (about 12 seconds) and Riga's from its GTFS feed (a few
seconds), and the world table, gathered from the cities' results, always run. The redesigns
(about two minutes each), the measurement of every city of the world pilot (a few minutes),
the benchmark (about three) and the robustness checks (about ten) run only with
BUSNET_SLOW_TESTS=1 in the environment.

A rerun into a folder an earlier run wrote must leave none of the earlier run's tables
behind.

Files must match byte for byte, with one allowance: Python 3.12 changed how sum() adds
floats, so an older Python can differ in the last digits. A CSV or JSON file that is not
byte-identical still passes when every number in it matches to within rounding."""

import csv
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
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


def _cells(data):
    rows = []
    for row in csv.reader(io.StringIO(data.decode("utf-8-sig"))):
        cells = []
        for c in row:
            try:
                cells.append(float(c))
            except ValueError:
                cells.append(c)
        rows.append(cells)
    return rows


def same_file(expected, actual, name):
    if expected == actual:
        return True
    if name.endswith(".json"):
        return _same(json.loads(expected), json.loads(actual), 1e-9)
    if name.endswith(".csv"):
        return _same(_cells(expected), _cells(actual), 1.5e-4)    # values are rounded to 4 decimals
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


class Comparison(unittest.TestCase):
    def test_numbers_match_to_within_rounding_but_text_must_match_exactly(self):
        self.assertTrue(same_file(b'{"a": [1.00000000001, "x"]}', b'{"a": [1.0, "x"]}', "f.json"))
        self.assertFalse(same_file(b'{"a": [1.01, "x"]}', b'{"a": [1.0, "x"]}', "f.json"))
        self.assertFalse(same_file(b'{"a": "x"}', b'{"a": "y"}', "f.json"))
        self.assertTrue(same_file("﻿r,v\n1,0.1234\n".encode(), "﻿r,v\n1,0.1235\n".encode(), "f.csv"))
        self.assertFalse(same_file("﻿r,v\n1,0.1234\n".encode(), "﻿r,v\n1,0.1244\n".encode(), "f.csv"))
        self.assertFalse(same_file(b"abc", b"abd", "f.txt"))
