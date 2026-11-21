"""app/: the list of files the page loads is the one app/build.py writes, and every file on
it exists, so the page cannot ask for a file that is not there."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Manifest(unittest.TestCase):
    def test_files_json_is_current_and_complete(self):
        committed = (ROOT / "app" / "files.json").read_text(encoding="utf-8")
        done = subprocess.run([sys.executable, str(ROOT / "app" / "build.py")], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual((ROOT / "app" / "files.json").read_text(encoding="utf-8"), committed,
                         "app/files.json is out of date: run python3 app/build.py")
        manifest = json.loads(committed)
        paths = list(manifest["engine"])
        for city in manifest["cities"].values():
            paths += [city["config"], *city["inputs"], *city["results"], *city["redesign"]]
        missing = [p for p in paths if not (ROOT / p).is_file()]
        self.assertEqual(missing, [])
        self.assertIn("measure.py", manifest["engine"])
        self.assertIn("redesign.py", manifest["engine"])

    def test_worker_and_page_load_the_same_pyodide(self):
        worker = (ROOT / "app" / "worker.js").read_text(encoding="utf-8")
        self.assertIn("pyodide/v0.27.2/full/pyodide.js", worker)
        self.assertNotIn("pyodide.js", (ROOT / "app" / "index.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
