# Getting started

## Requirements

- Python 3.11 or newer (`python3 --version`). The settings reader uses `tomllib`, which
  arrived in 3.11.
- Nothing else. The code uses only Python's standard library, and every input file is in
  the repository, so no internet connection is needed to regenerate results.
- Only for the optional check of the GTFS feeds: Java 17 or newer and MobilityData's
  validator ([below](#checking-the-gtfs-feeds)).

## Regenerate every result

From the repository root:

```sh
python3 measure.py --scenario stop-balancing --min-gap 250
python3 redesign.py
python3 robustness.py
```

| Command | Writes | Time |
|---|---|---|
| `python3 measure.py` | `output/` measures of today's network | about 8 s |
| `python3 measure.py --scenario stop-balancing --min-gap 250` | the same, plus `output/scenario.json` and `output/scenario_removed_stops.csv` | about 12 s |
| `python3 redesign.py` | `output/redesign/`, with `impact.csv`: what the redesign is worth in minutes, buses, fuel and CO₂ | about 2 minutes |
| `python3 robustness.py` | `output/robustness/`: the results on other trip samples and under other assumptions | about 15 minutes (8 processes) |
| `python3 bicycle.py` | `output/bicycle/`: AYNA's bicycle lanes and parking points beside the bus network | about 4 s |
| `python3 site/build.py` | `site/data.js` and `site/checklist.xlsx`, the page's data, from `output/`; with `--og` also `site/og.png` (needs Chrome) | about 3 s |
| `python3 animations/build.py` | `animations/*.gif`, the four animations at the top of the README ([below](#redraw-the-animations)) | about 4 minutes |

The committed `output/` folder was produced by exactly these three commands. Running
them again gives byte-identical files: random sampling uses fixed seeds and every list
is sorted before use. This was checked on a fresh clone of the repository. One caveat:
Python 3.12 changed how `sum()` adds floats, so Python 3.11 can differ from the
committed files in the last digits of some numbers; the regression test allows that.

## Run the tests

```sh
python3 -m unittest                            # about 35 s
BUSNET_SLOW_TESTS=1 python3 -m unittest        # also regenerates the redesign and the robustness checks, about 20 minutes
```

The tests check the geometry, the headway and daily-service rules, the settings reader
and the redesign's plan arithmetic on a small made-up network, read a small bicycle
file in the shape of AYNA's, regenerate `output/` and `output/bicycle/` to compare them
with the committed files, and rebuild the page's data and checklists to compare them
with the committed ones ([code.md](code.md#checking-a-change)).

## See the page

```sh
python3 site/build.py --og     # after any change to output/
python3 -m http.server         # then open http://localhost:8000/ (or /#tour for the tour)
```

`index.html` is the page for readers of the results ([code.md](code.md#the-page)). It
needs an internet connection for the map library and the base map tiles; everything
else is in the repository. GitHub Pages publishes it when Settings → Pages is set to
deploy from the branch `main`, folder `/ (root)`.

## Redraw the animations

```sh
python3 animations/build.py                  # all four, about 4 minutes
python3 animations/build.py --only riders    # one of buses, riders, redesign and travel-time; repeatable
```

The four GIFs at the top of the README are drawn from the committed data and results with
the standard library, like everything else ([code.md](code.md#the-animations)). Run
`redesign.py` first after any change to the data or the settings: `redesign.gif` replays
the search and stops with a message if it keeps other changes than
`output/redesign/changes.csv` lists.

## Checking the GTFS feeds

The two feeds in `output/redesign/` can be checked with MobilityData's canonical GTFS
validator, the same checker the R package gtfstools runs with `validate_gtfs()`. It is a
Java program and not part of the repository: install Java 17 or newer, download
`gtfs-validator-8.0.1-cli.jar` from the validator's
[releases page](https://github.com/MobilityData/gtfs-validator/releases), then run

```sh
python3 validate_gtfs.py --jar path/to/gtfs-validator-8.0.1-cli.jar   # under a minute
```

`--java` names the Java executable if it is not on the PATH, and `--date` the date the
validator's date rules use (26 October 2026 by default, so that a rerun gives the same
files). It writes `output/gtfs_validation/notices.csv` and `stops_far_from_shape.csv`
([outputs.md](outputs.md#outputgtfs_validation--what-the-gtfs-validator-says-about-the-feeds));
run it again whenever `redesign.py` changes the feeds. Version 8.0.1 finds no errors in
either feed.

## Change something and see the effect

1. Edit a value in `busnet.toml` (see [configuration.md](configuration.md)), or add real
   data, for example real headways in `data/headways.csv`.
2. Run the three commands again.
3. `git diff output/` shows what changed in every result.

To try a value once without editing the file:

```sh
python3 measure.py --set transfer_penalty_min=8
python3 redesign.py --set redesign_max_people_losing_stop=0 --out output/redesign_strict
```

`--set` can be repeated. `--config none` ignores `busnet.toml` and uses the built-in
defaults (and then finds no data files except `data/ayna.db`).

## Another city, from its GTFS feed

The measurements and the redesign search run on any city that publishes a GTFS feed.
The feed replaces the AYNA snapshot, and its timetable gives every route its headway and
its speed, which Baku's data cannot. Riga is in the repository as the worked example
([cities.md](cities.md)):

```sh
python3 measure.py --config cities/riga.toml --out output/cities/riga                  # a few seconds
python3 redesign.py --config cities/riga.toml --out output/cities/riga/redesign        # about a minute
```

A new city takes one more command first. `data/fetch_city.py` downloads the three inputs
into `data/cities/<city>/` and writes the settings file `cities/<city>.toml`:

| Input | Where it comes from |
|---|---|
| The city's GTFS feed, a zip file | `--feed`: the agency's open-data page, or the [Mobility Database](https://mobilitydatabase.org), which listed about 3,600 feeds in October 2026 |
| A population grid | Kontur Population for the country (`--country`, its two-letter code), the same source as Azerbaijan's in `data/external/kontur/` |
| Places people go | OpenStreetMap: the five destination queries of `data/fetch_external.py` through the Overpass API, in the box of the feed's served stops plus 2 km; or, with `--osm geofabrik`, the same kinds cut out of the country's extract from [Geofabrik](https://download.geofabrik.de) |

```sh
python3 data/fetch_city.py my_city --feed https://example.org/gtfs.zip --country XX
python3 measure.py --config cities/my_city.toml --out output/cities/my_city
python3 redesign.py --config cities/my_city.toml --out output/cities/my_city/redesign
```

The public Overpass servers are sometimes overloaded for hours; when a query fails, run
the script again with `--osm geofabrik --refresh`. It downloads the country's extract
(Latvia's is 142 MB), reads it in a few minutes with `data/osm_pbf.py` and keeps it
nowhere. An extract gives nodes and ways, as Overpass's `out center` does, a way at the
centre of the box around its nodes, but not relations, so a few large sites mapped only
as relations are missed. Riga's destinations came this way on 21 November 2026, when no
Overpass server answered.

The settings file names the inputs, sets `service_hours` to the feed's hours of service
and resets what `busnet.toml` sets for Baku alone; the script never overwrites it, so
edits to it stay. Riga's, for instance, protects the airport bus by hand:

```toml
[data]
gtfs = "../data/cities/riga/gtfs.zip"
population = "../data/cities/riga/kontur_population_LV_20231101.gpkg"
destinations = ["../data/cities/riga/osm_education.json", "...", "../data/cities/riga/osm_transport.json"]

[service]
service_hours = 18                   # the hours of service the feed's timetable shows
headway_from_ridership = false       # no counts in the format of BakuBus's
reference_fleet = 0                  # buses in daily service, if known

[redesign]
redesign_protected_routes = ["22"]   # 22 runs to the airport, which no destination kind covers,
                                     # so the model cannot see its riders and would drop it
```

`measure.py` prints the day it read (the weekday with the most bus trips, or
`gtfs_date`), the share of that day's departures on the route patterns, the branches run
as routes and the express routes, the hours of service (the hours in which buses leave at
least a quarter as often as in the busiest hour), and any warning about the feed;
`timetable.txt` lists each branch, each express route and each route whose speed fell back
to the settings
([configuration.md](configuration.md#a-gtfs-feed-instead-of-the-ayna-snapshot-gtfs)).
`redesign.py` then writes the redesign and its `impact.csv`. With `--set fuel_price=...`,
`cost_per_bus_hour`, `value_of_time`, `daily_journeys` and `days_per_year`, the table adds
money, riders' hours and a year
([configuration.md](configuration.md#what-the-redesign-is-worth-impact)). Before
publishing another city's data, check its licence: this repository commits every input
it uses, and a feed's terms may not allow that. Riga's feed is CC0.

## Refresh the public data

```sh
python3 data/fetch_external.py             # download only files that are missing
python3 data/fetch_external.py --refresh   # download everything again
python3 data/fetch_external.py --only osm  # one group: kontur, opendata, stat, osm or wikidata
                                           # (osm also cuts the walking network out of Geofabrik's 47 MB extract, about a minute)
python3 data/metro_scraper.py              # the metro's own API again (about 20 requests)
python3 data/build_metro.py                # rebuild data/metro/ from the downloads
```

Refreshing changes the inputs, so results will change. Commit refreshed data and the
regenerated `output/` together. OpenStreetMap queries go through public Overpass servers,
which are sometimes slow; the script retries and tries three servers, and you can run it
again for anything that failed. It prints the date of the OpenStreetMap data each server
answered with: a mirror can be months behind, and then the file is better fetched again
later. Nothing reads `data/metro/` yet, so the metro scripts do not change the results.

## Messages you may see

| Message | Meaning | What to do |
|---|---|---|
| `Settings error: unknown setting(s): ...` | A name in `busnet.toml` or `--set` is misspelled | Use one of the names the message lists |
| `missing population: ... (using assumptions instead)` | A data file named in `busnet.toml` is not there | Restore it with `data/fetch_external.py`, or accept that the related measures are skipped |
| `metro stations without exit coordinates: ...` | A metro station name could not be matched to an exit | Check the names in the two metro files |
| `ModuleNotFoundError: No module named 'tomllib'` | Python older than 3.11 | Use Python 3.11 or newer |
| `The redesign needs population data` | `redesign.py` without a population file | Restore the Kontur file |
| `Settings error: no GTFS feed at ...` | `[data] gtfs` names a file that is not there | Fix the path; relative paths are read from the settings file's folder |
| `Settings error: no trips of route types [3] run on ...` | Nothing of those types runs on `gtfs_date` | Leave `gtfs_date` empty for the busiest weekday, or add types to `gtfs_route_types` |
| `buses leave at least a quarter as often as in the busiest hour from ... set it to ...` | The feed's hours of service differ from `service_hours` by more than an hour | Set `service_hours` as the message says, so waiting times match the timetable |

## Where to go next

- Results so far: [results.md](results.md)
- How the numbers are made: [methodology.md](methodology.md)
- How the redesign works: [redesign.md](redesign.md)
