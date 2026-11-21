// The engine in the browser: load Python (Pyodide), copy the engine and a city's inputs into
// its file system, run measure.py exactly as on the command line, and compare each result
// file with the repository's.

const logBox = document.getElementById("log");
const log = (line) => { logBox.textContent += line + "\n"; };
const seconds = (t) => ((performance.now() - t) / 1000).toFixed(1) + " s";

async function copyIn(py, paths) {
  for (const path of paths) {
    const response = await fetch("../" + path);
    if (!response.ok) throw new Error(`could not load ${path}: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    py.FS.mkdirTree("/repo/" + path.split("/").slice(0, -1).join("/"));
    py.FS.writeFile("/repo/" + path, bytes);
  }
}

// Numbers equal to within tol, everything else exactly; JSON and CSV are parsed first, so that
// a last-digit difference in a float is not counted as a change.
function sameValue(a, b, tol) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i], tol));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => sameValue(a[k], b[k], tol));
  }
  return a === b;
}

function csvCells(text) {
  return text.replace(/^﻿/, "").trim().split(/\r?\n/).map((line) => line.split(",").map((c) => (c !== "" && !isNaN(c) ? Number(c) : c)));
}

function compare(name, mine, theirs) {
  if (mine === theirs) return { ok: true, how: "identical, byte for byte" };
  if (name.endsWith(".json") && sameValue(JSON.parse(mine), JSON.parse(theirs), 1e-9)) return { ok: true, how: "same values (floats to 1e-9)" };
  if (name.endsWith(".csv") && sameValue(csvCells(mine), csvCells(theirs), 1.5e-4)) return { ok: true, how: "same values (to the 4 decimals written)" };
  return { ok: false, how: "differs" };
}

async function compareFolder(py, outDir, paths, tbody) {
  let same = 0;
  for (const path of paths) {
    const name = path.split("/").pop();
    const target = `/repo/${outDir}/${name}`;
    let cell;
    if (!py.FS.analyzePath(target).exists) {
      cell = { ok: false, how: "not written" };
    } else if (name.endsWith(".zip")) {
      const mine = py.FS.readFile(target);
      const theirs = new Uint8Array(await (await fetch("../" + path)).arrayBuffer());
      cell = mine.length === theirs.length && mine.every((b, i) => b === theirs[i])
        ? { ok: true, how: "identical, byte for byte" } : { ok: false, how: "differs" };
    } else {
      const mine = py.FS.readFile(target, { encoding: "utf8" });
      const theirs = await (await fetch("../" + path)).text();
      cell = compare(name, mine, theirs);
    }
    same += cell.ok ? 1 : 0;
    tbody.insertAdjacentHTML("beforeend", `<tr><td>${path.replace("output/cities/", "")}</td><td class="${cell.ok ? "ok" : "bad"}">${cell.how}</td></tr>`);
  }
  return same;
}

async function runScript(py, script, args) {
  py.globals.set("script", script);
  py.globals.set("args", py.toPy(args));
  await py.runPythonAsync(`
import os, runpy, sys
os.chdir("/repo")
if "/repo" not in sys.path:
    sys.path.insert(0, "/repo")
sys.argv = [script, *args]
runpy.run_path(script, run_name="__main__")
`);
}

async function run(city, withRedesign) {
  const button = document.getElementById("run");
  button.disabled = true;
  try {
    const t0 = performance.now();
    log("Loading Python ...");
    const py = await loadPyodide();
    await py.loadPackage("sqlite3");
    py.setStdout({ batched: (s) => log("  " + s) });
    py.setStderr({ batched: (s) => log("  " + s) });
    log(`Python ${py.version} ready in ${seconds(t0)}`);

    const manifest = await (await fetch("files.json")).json();
    const c = manifest.cities[city];
    const t1 = performance.now();
    await copyIn(py, [...manifest.engine, c.config, ...c.inputs]);
    log(`Engine and ${city}'s inputs copied in ${seconds(t1)}`);

    const tbody = document.querySelector("#results tbody");
    document.getElementById("results").hidden = false;
    const t2 = performance.now();
    await runScript(py, "measure.py", ["--config", c.config, "--out", `output/app/${city}`]);
    log(`Measured in ${seconds(t2)}`);
    let same = await compareFolder(py, `output/app/${city}`, c.results, tbody), total = c.results.length;

    if (withRedesign) {
      const t3 = performance.now();
      await runScript(py, "redesign.py", ["--config", c.config, "--out", `output/app/${city}/redesign`]);
      log(`Redesigned in ${seconds(t3)}`);
      same += await compareFolder(py, `output/app/${city}/redesign`, c.redesign, tbody);
      total += c.redesign.length;
    }
    log(`${same} of ${total} result files match the repository. Total ${seconds(t0)}.`);
  } catch (e) {
    log("Failed: " + e.message);
    console.error(e);
  } finally {
    button.disabled = false;
  }
}

document.getElementById("run").addEventListener("click", () => run("riga", document.getElementById("redesign").checked));
