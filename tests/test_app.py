"""app/: the list of files the page loads is the one app/build.py writes, and every file on
it exists, so the page cannot ask for a file that is not there. With Node installed, app.js
also runs against a stand-in page and worker: its CSV comparison holds numbers to the
decimals written, as tests/test_regression.py does."""

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

from tests.test_regression import CSV_CASES

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")

# app.js in a Node vm, with a stand-in document, fetch and Worker. A test's script sets
# behave(worker, message) to answer the page's requests, calls the page's functions and
# prints a JSON line for the test to read.
PAGE = r"""
const fs = require("fs"), vm = require("vm");
const elements = {};
const element = (id) => elements[id] || (elements[id] = {
  id, textContent: "", scrollTop: 0, scrollHeight: 0, disabled: false, checked: false, hidden: true, innerHTML: "",
  addEventListener() {}, insertAdjacentHTML(_, html) { this.innerHTML += html; } });
const workers = [];
let behave = () => {};
class FakeWorker {
  constructor(url) { this.url = url; this.sent = []; this.terminated = false; workers.push(this); }
  postMessage(msg) { this.sent.push(msg); setTimeout(() => behave(this, msg), 0); }
  terminate() { this.terminated = true; }
}
const manifest = { engine: [], cities: { riga: { config: "cities/riga.toml", inputs: [], results: [], redesign: [] } } };
const page = vm.createContext({
  document: { getElementById: element, querySelector: () => element("tbody") }, Worker: FakeWorker, setTimeout, console,
  performance: { now: () => 0 }, fetch: async () => ({ json: async () => manifest, text: async () => "" }) });
vm.runInContext(fs.readFileSync("app/app.js", "utf8"), page);
const answer = (w, msg, extra = {}) => w.onmessage({ data: { id: msg.id, ok: true, ...extra } });
const fail = (w, msg, error) => w.onmessage({ data: { id: msg.id, ok: false, error } });
"""


def run_page(script):
    """What a script run on the stand-in page prints, read as JSON."""
    done = subprocess.run([NODE, "-e", PAGE + script], cwd=ROOT, capture_output=True, text=True, timeout=60)
    if done.returncode:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout)


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


@unittest.skipUnless(NODE, "Node is not installed")
class PageComparison(unittest.TestCase):
    def test_a_csv_number_may_move_by_its_last_decimal_and_no_more(self):
        got = run_page(f"""
const csv = (v) => "\\ufeffroute,people\\r\\n22," + v + "\\r\\n";
console.log(JSON.stringify({json.dumps(CSV_CASES)}.map(([a, b]) => page.compareText("impact.csv", csv(a), csv(b)).ok)));
""")
        self.assertEqual(got, [same for _, _, same in CSV_CASES])

    def test_fifty_more_people_in_rigas_impact_table_are_found(self):
        text = (ROOT / "output" / "cities" / "riga" / "redesign" / "impact.csv").read_text(encoding="utf-8")
        got = run_page(f"""
const text = {json.dumps(text)};
const people = text.split(/\\r?\\n/).map((l) => l.split(",")).find((r) => r[1] === "people")[2];
const edited = text.replace(people, String(Number(people) + 50));
console.log(JSON.stringify([edited !== text, page.compareText("impact.csv", text, text).ok,
                            page.compareText("impact.csv", edited, text).ok]));
""")
        self.assertEqual(got, [True, True, False])


if __name__ == "__main__":
    unittest.main()
