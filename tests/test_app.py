"""app/: the list of files the page loads is the one app/build.py writes, and every file on
it exists, so the page cannot ask for a file that is not there. With Node installed, app.js
also runs against a stand-in page and worker: its CSV comparison holds numbers to the
decimals written and reads quoted cells, as tests/test_regression.py does, and a run after
Python failed to start, failed fatally or lost its worker starts a fresh worker."""

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


@unittest.skipUnless(NODE, "Node is not installed")
class PageRetry(unittest.TestCase):
    """A run after Python failed to start starts a fresh worker, whether Python failed inside
    the worker or the worker could not load Pyodide at all."""

    RUNS = """
(async () => {
  const seen = [];
  for (let k = 0; k < 2; k++) {
    await page.run("riga", false);
    seen.push({ log: element("log").textContent, disabled: element("run").disabled });
  }
  console.log(JSON.stringify({ seen, workers: workers.length, terminated: workers.map((w) => w.terminated),
                               starts: workers.map((w) => w.sent.filter((m) => m.cmd === "start").length) }));
})();
"""

    def check(self, got, why):
        first, second = got["seen"]
        self.assertIn(f"Failed: {why}", first["log"])
        self.assertFalse(first["disabled"])                            # the button works again
        self.assertNotIn("Python 3.12.7 ready", first["log"])
        self.assertIn("Python 3.12.7 ready", second["log"])
        self.assertIn("0 of 0 result files match the repository", second["log"])
        self.assertFalse(second["disabled"])
        self.assertEqual((got["workers"], got["terminated"], got["starts"]), (2, [True, False], [1, 1]))

    def test_python_that_fails_to_start_can_be_started_again(self):
        got = run_page("""
behave = (w, msg) => {
  if (msg.cmd === "start") return workers.indexOf(w) === 0 ? fail(w, msg, "sqlite3 did not load") : answer(w, msg, { version: "3.12.7" });
  answer(w, msg, msg.cmd === "read" ? { data: null } : {});
};
""" + self.RUNS)
        self.check(got, "sqlite3 did not load")

    def test_a_fatal_error_after_a_good_start_gives_the_next_run_a_fresh_worker(self):
        got = run_page("""
behave = (w, msg) => {
  if (msg.cmd === "start") return answer(w, msg, { version: "3.12.7" });
  if (msg.cmd === "run" && workers.indexOf(w) === 0)
    return w.onmessage({ data: { id: msg.id, ok: false, error: "Pyodide already fatally failed and can no longer be used.", fatal: true } });
  answer(w, msg, msg.cmd === "read" ? { data: null } : {});
};
""" + self.RUNS)
        first, second = got["seen"]
        self.assertIn("Failed: Pyodide already fatally failed", first["log"])
        self.assertIn("0 of 0 result files match the repository", second["log"])
        self.assertEqual((got["workers"], got["terminated"], got["starts"]), (2, [True, False], [1, 1]))

    def test_a_worker_that_dies_between_two_requests_fails_with_its_own_error(self):
        got = run_page("""
behave = (w, msg) => {
  if (msg.cmd === "start") return answer(w, msg, { version: "3.12.7" });
  if (msg.cmd === "load" && workers.indexOf(w) === 0) {        // answers, then dies before the next request
    answer(w, msg);
    return w.onerror({ message: "worker crashed", preventDefault() {} });
  }
  answer(w, msg, msg.cmd === "read" ? { data: null } : {});
};
""" + self.RUNS)
        first, second = got["seen"]
        self.assertIn("Failed: worker crashed", first["log"])
        self.assertNotIn("null", first["log"])
        self.assertIn("0 of 0 result files match the repository", second["log"])
        self.assertEqual(got["workers"], 2)

    def test_a_worker_that_cannot_load_pyodide_releases_the_page(self):
        got = run_page("""
behave = (w, msg) => {
  if (workers.indexOf(w) === 0) return w.onerror({ message: "importScripts failed", preventDefault() {} });
  if (msg.cmd === "start") return answer(w, msg, { version: "3.12.7" });
  answer(w, msg, msg.cmd === "read" ? { data: null } : {});
};
""" + self.RUNS)
        self.check(got, "importScripts failed")


if __name__ == "__main__":
    unittest.main()
