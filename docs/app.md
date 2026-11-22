# The engine in the browser

The tool is a set of command-line scripts, which suits someone who reads code and few of
the planners who would use its answers. `app/` is the first step towards an app for them:
a page that runs the same engine inside the browser, with nothing to install and nothing
sent to a server. A Web Worker (`app/worker.js`) loads Python compiled for the browser
(Pyodide 0.27.2, Python 3.12), the page copies `busnet/`, `measure.py`, `redesign.py` and a
city's inputs into it, and the worker runs the scripts exactly as on the command line, so the
page stays responsive and shows their progress as it comes.

So far it does one thing: it measures and redesigns Riga, the city whose inputs are in git,
and compares every result file with the repository's. On a MacBook in Chrome on 21 November
2026, starting Python took 1 to 3 seconds, measuring 6 seconds and the redesign search 83
seconds. All 14 result files matched: 11 byte for byte, among them both GTFS feeds and the
map, and `network.json`, `summary.json` and `impact.csv` to the last digits of their
floats, where the browser's maths library rounds differently.

To try it, serve the repository and open the page:

```sh
python3 -m http.server 8000        # from the repository root
# then open http://localhost:8000/app/
```

`python3 app/build.py` writes `app/files.json`, the list of files the page loads: the
engine, and for each city its settings, its inputs and the results to compare with.
`app/app.js` drives the page and `app/worker.js` runs Python. If Python fails to start, for
instance when the browser cannot reach jsDelivr, the page says so and the button works
again; the next click starts a fresh worker rather than repeating the failure.

What comes next is the app itself: the 26 cities of the world pilot to choose from, their
inputs read from the Hugging Face dataset, the network and the proposed changes on a map,
and a report and the redesigned feed to download.
