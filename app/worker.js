// Python in a Web Worker, so that the page stays responsive while the engine runs. The page
// sends {id, cmd, ...}; the worker answers {id, ok, ...} and streams the engine's printed lines
// as {type: "log", line}.

importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js");

let py = null;

// py is set only once Python is ready, so a start that fails leaves nothing half made.
async function start() {
  const runtime = await loadPyodide();
  await runtime.loadPackage("sqlite3");
  runtime.runPython("import sqlite3");          // loadPackage can report a failure without throwing
  runtime.setStdout({ batched: (line) => postMessage({ type: "log", line }) });
  runtime.setStderr({ batched: (line) => postMessage({ type: "log", line }) });
  py = runtime;
  return { version: py.version };
}

async function load(paths) {
  for (const path of paths) {
    const response = await fetch("../" + path);
    if (!response.ok) throw new Error(`could not load ${path}: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    py.FS.mkdirTree("/repo/" + path.split("/").slice(0, -1).join("/"));
    py.FS.writeFile("/repo/" + path, bytes);
  }
  return {};
}

async function run(script, args) {
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
  return {};
}

function read(path, binary) {
  const full = "/repo/" + path;
  if (!py.FS.analyzePath(full).exists) return { data: null };
  return { data: binary ? py.FS.readFile(full) : py.FS.readFile(full, { encoding: "utf8" }) };
}

self.onmessage = async (event) => {
  const { id, cmd } = event.data;
  try {
    let answer;
    if (cmd === "start") answer = await start();
    else if (cmd === "load") answer = await load(event.data.paths);
    else if (cmd === "run") answer = await run(event.data.script, event.data.args);
    else if (cmd === "read") answer = read(event.data.path, event.data.binary);
    else throw new Error(`unknown command ${cmd}`);
    postMessage({ id, ok: true, ...answer });
  } catch (error) {
    const message = String(error && error.message || error);
    postMessage({ id, ok: false, error: message, fatal: /fatal/i.test(message) });   // Pyodide's fatal errors say so
  }
};
