// The engine in the browser. Python runs in a Web Worker (worker.js), so the page stays
// responsive and shows the engine's lines as they come. The page copies the engine and a
// city's inputs into the worker, runs measure.py and redesign.py exactly as on the command
// line, and compares each result file with the repository's.

const logBox = document.getElementById("log");
const log = (line) => { logBox.textContent += line + "\n"; logBox.scrollTop = logBox.scrollHeight; };
const seconds = (t) => ((performance.now() - t) / 1000).toFixed(1) + " s";

// A promise for each request to the worker, settled by the answer with the same id.
const worker = new Worker("worker.js");
const pending = new Map();
let nextId = 1;
worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "log") { log("  " + msg.line); return; }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error));
};
const call = (cmd, args = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, cmd, ...args });
});

// JSON numbers equal to within tol, everything else exactly; JSON is parsed first, so that a
// last-digit difference in a float is not counted as a change.
function sameValue(a, b, tol) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i], tol));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => sameValue(a[k], b[k], tol));
  }
  return a === b;
}

// Two CSV cells: the same text, or two numbers no further apart than rounding to the decimals
// written. The writers round floats to 4 decimals (fewer show when the last are zeros), so two
// runs can differ by one in the 4th decimal; a cell written with more decimals is held to its
// own last one. Whole numbers, such as counts and ids, must match exactly. Compared as exact
// integers in units of the last decimal, as tests/test_regression.py compares them.
const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
function sameCell(a, b) {
  if (a === b) return true;
  const [x, y] = [NUMBER.exec(a), NUMBER.exec(b)];
  if (!x || !y || !(x[2] || x[3]) || !(y[2] || y[3])) return false;
  if (x[3] === undefined && !x[4] && y[3] === undefined && !y[4]) return false;
  const decimals = (m) => (m[3] || "").length - Number(m[4] || 0);
  const places = Math.max(4, decimals(x), decimals(y));
  const units = (m) => (m[1] === "-" ? -1n : 1n) * BigInt((m[2] || "") + (m[3] || "") || "0") * 10n ** BigInt(places - decimals(m));
  const gap = units(x) - units(y);
  return gap >= -1n && gap <= 1n;
}

function sameCsv(mine, theirs) {
  const rows = (text) => text.replace(/^\ufeff/, "").trim().split(/\r?\n/).map((line) => line.split(","));
  const [a, b] = [rows(mine), rows(theirs)];
  return a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((c, j) => sameCell(c, b[i][j])));
}

function compareText(name, mine, theirs) {
  if (mine === theirs) return { ok: true, how: "identical, byte for byte" };
  if (name.endsWith(".json") && sameValue(JSON.parse(mine), JSON.parse(theirs), 1e-9)) return { ok: true, how: "same values (floats to 1e-9)" };
  if (name.endsWith(".csv") && sameCsv(mine, theirs)) return { ok: true, how: "same values (to the last decimal written)" };
  return { ok: false, how: "differs" };
}

async function compareFolder(outDir, paths, tbody) {
  let same = 0;
  for (const path of paths) {
    const name = path.split("/").pop();
    const binary = name.endsWith(".zip");
    const { data } = await call("read", { path: `${outDir}/${name}`, binary });
    let cell;
    if (data === null) {
      cell = { ok: false, how: "not written" };
    } else if (binary) {
      const theirs = new Uint8Array(await (await fetch("../" + path)).arrayBuffer());
      cell = data.length === theirs.length && data.every((b, i) => b === theirs[i])
        ? { ok: true, how: "identical, byte for byte" } : { ok: false, how: "differs" };
    } else {
      cell = compareText(name, data, await (await fetch("../" + path)).text());
    }
    same += cell.ok ? 1 : 0;
    tbody.insertAdjacentHTML("beforeend", `<tr><td>${path.replace("output/cities/", "")}</td><td class="${cell.ok ? "ok" : "bad"}">${cell.how}</td></tr>`);
  }
  return same;
}

let started = null;

async function run(city, withRedesign) {
  const button = document.getElementById("run");
  button.disabled = true;
  const tbody = document.querySelector("#results tbody");
  tbody.innerHTML = "";
  try {
    const t0 = performance.now();
    if (!started) {
      log("Loading Python ...");
      started = call("start");
    }
    const { version } = await started;
    log(`Python ${version} ready in ${seconds(t0)}`);

    const manifest = await (await fetch("files.json")).json();
    const c = manifest.cities[city];
    const t1 = performance.now();
    await call("load", { paths: [...manifest.engine, c.config, ...c.inputs] });
    log(`Engine and ${city}'s inputs copied in ${seconds(t1)}`);

    document.getElementById("results").hidden = false;
    const t2 = performance.now();
    await call("run", { script: "measure.py", args: ["--config", c.config, "--out", `output/app/${city}`] });
    log(`Measured in ${seconds(t2)}`);
    let same = await compareFolder(`output/app/${city}`, c.results, tbody), total = c.results.length;

    if (withRedesign) {
      const t3 = performance.now();
      await call("run", { script: "redesign.py", args: ["--config", c.config, "--out", `output/app/${city}/redesign`] });
      log(`Redesigned in ${seconds(t3)}`);
      same += await compareFolder(`output/app/${city}/redesign`, c.redesign, tbody);
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
