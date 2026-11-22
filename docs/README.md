# Documentation

This folder explains everything in the repository: where the data comes from, what
every setting means, how each measurement and the redesign search work, what every
output file contains, what the results are, and what I would do next.

## The project in one paragraph

Baku's bus network (208 routes, about 3,500 stops, from AYNA's public map) had never
been measured in public for how well it serves riders, and the data to do it properly
is not public either: no timetables, no vehicle positions, no origin-destination data.
So I measured what the geometry alone can tell: routes that wander, routes that repeat
each other, stops too close together, detours, and people left without a nearby stop.
Then I built a travel model from public population, ridership, metro and OpenStreetMap
data to estimate door-to-door travel times and daily bus operation, with every
assumption in one settings file, and a search that changes the network step by step
with today's fleet, keeping a change only if trips get faster without cutting people
off. The redesign shortens the average trip from 51.9 to 51.0 minutes with the same
buses, or matches today's trip times with about 12% fewer buses and 12% less fuel, and
the gain holds on ten samples of trips and under fourteen other assumptions. I treat its
changes as candidates for review, not a plan; [results.md](results.md#check-these-before-acting)
lists what to check first. The same measurements and search now run on any city that
publishes a GTFS feed, where the timetable gives the headways and speeds Baku's data
lacks, and each redesign comes with what it is worth in minutes, buses, fuel and CO₂.
Run on 25 cities on five continents and on Baku's own feed, the search shortens trips in
every one, by 2.8 minutes in the middle city, or keeps today's trip times with a fifth fewer
buses in the networks their operators publish ([world.md](world.md)).

## Where to read

| If you want to... | Read |
|---|---|
| Run the tools and regenerate every result | [getting-started.md](getting-started.md) |
| Measure and redesign another city from its GTFS feed | [getting-started.md](getting-started.md#another-city-from-its-gtfs-feed) |
| See a second city measured and redesigned from its feed, Riga, beside Baku | [cities.md](cities.md) |
| See the same search on 25 cities and Baku from their own feeds, and what it would save across them | [world.md](world.md) |
| See what a redesign is worth: minutes per trip, buses, bus-hours, fuel, CO₂ and money | [outputs.md](outputs.md#outputredesignimpactcsv--what-the-redesign-is-worth), [results.md](results.md#what-the-redesign-is-worth) |
| See the latest findings and the redesign | [results.md](results.md) |
| See how much the results depend on the trip sample and the assumptions | [results.md](results.md#how-robust-the-results-are) |
| See AYNA's bicycle lanes and parking points beside the bus network | [results.md](results.md#bicycle-lanes-and-parking) |
| Understand the data, its defects, the repairs and the licences | [data.md](data.md) |
| Change an assumption or a data path | [configuration.md](configuration.md) |
| Know exactly how a number is computed | [methodology.md](methodology.md) |
| Understand the redesign algorithm and how to tune it | [redesign.md](redesign.md) |
| See how the search does on the benchmark networks of the literature, where the answers are known | [benchmark.md](benchmark.md) |
| Run your own method on Baku: five instances in the format of Mumford's benchmark networks | [instances.md](instances.md) |
| See how well the demand model can be fitted to the counted boardings, and how far to trust the fit | [calibration.md](calibration.md) |
| Read any output file, column by column | [outputs.md](outputs.md) |
| Change or extend the code | [code.md](code.md) |
| See the research and other cities' experience behind the approach | [research.md](research.md) |
| Know what comes next, the limitations and the open questions | [roadmap.md](roadmap.md) |
| Turn the work into a research paper: outline, venues, format, steps for an independent researcher | [paper.md](paper.md) |
| Read the manuscript draft and its title page | [../paper/manuscript.md](../paper/manuscript.md), [../paper/title-page.md](../paper/title-page.md) |
| Use the route planner built on the same data | [birjob.com/aletler/avtobus-marsrutu](https://www.birjob.com/aletler/avtobus-marsrutu) (in Azerbaijani) |
| Run the engine in a browser, with nothing installed | [app.md](app.md) |
| Show the findings to people who will act on them: a guided tour, a map with nine views, a card per route, the data defects, the checklist and tables of all routes and carriers | [../index.html](../index.html), served at [ismatsamadov.github.io/route_efficiency](https://ismatsamadov.github.io/route_efficiency/); how it is built: [code.md](code.md#the-page) |
| Watch the network move: a modelled hour of buses, nine months of counted riders, the redesign one change at a time, how far the buses take you, and the bicycle lanes beside them | [../README.md](../README.md), each in the section it illustrates; how they are drawn: [code.md](code.md#the-animations), what each frame shows: [outputs.md](outputs.md#animations--the-animations-in-the-readme) |
| Look up a term | [glossary.md](glossary.md) |

## Three commands

```sh
python3 measure.py --scenario stop-balancing --min-gap 250   # measure today's network (about 12 s)
python3 redesign.py                                          # search for a better one (about 2 minutes)
python3 robustness.py                                        # the results under other samples and assumptions (about 15 minutes)
```

All three read `busnet.toml` and the data committed under `data/`, need only Python 3.11
or newer, and give byte-identical results on every run. `python3 -m unittest` runs the
tests, `python3 bicycle.py` puts AYNA's bicycle lanes and parking points beside the
network (about 4 s), `python3 site/build.py` then rebuilds the page's data from
`output/` (about 3 s), and `python3 animations/build.py` redraws the animations in the
README (about 4 minutes).
