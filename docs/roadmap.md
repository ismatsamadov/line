# Roadmap

Where I think the work stands on 21 November 2026, and what I would do next. This page is
about what is missing, not what has been built.

## What I would do next

The weakest part of the work is demand. The gravity model ranks routes against the
BakuBus counts at only 0.58, and 145 of the 201 routes have no counts at all, so the
redesign's bus moves rest on estimates. Route 519 is the warning sign: a 3-stop shuttle
that the model credits with 14,800 boardings a day and that the search therefore runs
every 3 minutes. Nothing I can do with public data fixes this, and the data that would
(real headways, boardings for the other carriers' routes, BakıKart validations) cannot
be obtained from AYNA, so the estimates are what the work has to live with and the
paper has to say so plainly.

Until that data exists there are two things I can do alone that would change the
answer, and one I have to wait for. The wait is for the map: AYNA has been launching a
new network since January 2026, but on 23 October 2026 the map API still returned
exactly the data of 6 May ([data.md](data.md#when-the-data-is-from)), so the
before-and-after study has to wait until the API changes; when it does, a new scrape
and a rerun of the three scripts will show which findings survive. The first thing I
can do now is the metro. Today metro stations only attract trips, but many Baku trips
combine bus and metro and some bus routes exist mainly to feed it, so trips that would
use the metro look slower or impossible by bus. Its data is now in place
([data.md](data.md#metro)): stations, the five train services, running times from the
operator's own journey planner, published intervals and track distances, in
`data/metro/` and `data/metro_headways.csv`. What remains is to put them into the travel
graph, with walking links between stations and bus stops, and to decide which metro to
model: the one before 15 August 2026, with green trains running through to Həzi
Aslanov, or today's, cut between Nizami and 28 May for the 11 months the works are
planned to take. The second is vehicle capacity: a maximum-load rule (buses needed =
peak load ÷ bus capacity) so that a frequency shift cannot hand a route more riders
than its buses carry.

The walking check of 25 October 2026 ([results.md](results.md#who-the-network-reaches))
adds a third: the streets and paths of OpenStreetMap are now in the repository
(`data/external/osm/osm_walk_network.json.gz`, read by `busnet/walking.py`), and the
walk to the nearest stop along them is typically 1.54 times the straight line, against
the 1.3 the travel model assumes for every walk. Putting that network into the model's
access and transfer walks, and into the redesign's coverage guard, would lengthen
modelled trips and tighten the guard; the check measures the gap but does not yet close
it.

The demand model's settings are now fitted to the counts and cross-validated
([calibration.md](calibration.md)). The fit at today's settings is 0.53 rather than 0.58,
which was a lucky sample, and no setting that keeps trips realistic ranks the counted
routes better; the ones that do make trips a third as long as today's. What would move it
is data rather than tuning: the average length of a Baku bus trip, from BakıKart or a
survey, to fix how fast trips fall off with distance; counts by stop or by hour; and a
doubly constrained gravity model, which is still to try.

The benchmark test of 27 October 2026 ([benchmark.md](benchmark.md)) suggests one
cheap change to the search itself: on Mumford1 to Mumford3, repeating the
straightening passes until one keeps nothing adds 34 to 53% to the gain in travel time
of a single pass, and `redesign.py` makes a single pass. Repeating its passes, and checking the gain on the
independent sample as before, would show whether Baku's minute is an underestimate.

The instances I promised in October 2026 are made ([instances.md](instances.md)): the
Baku network cut into five instances in the format of Mumford's (2013) benchmark files,
four circles round the centre the size of her four networks and the whole network, each
with today's routes, their scores and what straightening does to them. Their link times
and demand are labelled as modelled, with the 0.58 rank correlation against counted
boardings stated as the demand's only check. Christine Mumford suggested them, and they
credit her. What they need now is other people's methods run on them; the two
researchers who were told to expect them are the first to ask.

The code now runs on any city that publishes a GTFS feed. The feed replaces the snapshot,
and its timetable gives every route the headway and speed Baku's data lacks
([getting-started.md](getting-started.md#another-city-from-its-gtfs-feed)). Read back,
Baku's own feed reproduces the snapshot's results to within 0.1%. Riga's feed has been
through it too ([cities.md](cities.md)): its timetable is CC0, so the feed, Kontur's grid
for Latvia and OpenStreetMap's destinations are committed, and its bus network is
measured and redesigned. So are 24 more cities on five continents and Baku's own feed, in
the world pilot ([world.md](world.md)), which also put the reader's two untried parts to
work: six feeds place their stops by `shape_dist_traveled`, and thirteen have express
routes. What they need next is readers: someone at Rīgas satiksme, at each operator of the
pilot or in each city, who would look at its `impact.csv`, and the counts by route that
would replace the modelled demand.

Everything else can wait, because it would make the method look more serious without
changing the answer much: generating new candidate routes (k-shortest paths between
busy terminals, metro stations and destinations, splitting long routes, cutting loops),
replacing the greedy search with simulated annealing or NSGA-II from pymoo, which can
undo earlier changes, comparing travel times with r5py, and extending the tests to the
kinds of change in `busnet/optimize.py`. The benchmark networks showed what such
methods buy: on Mumford's networks they reach far lower travel times than straightening
a published route set does. The GTFS feeds now pass MobilityData's validator with no
errors (`validate_gtfs.py`); its remaining warnings are AYNA's, chiefly stops that sit
far from their own route's line. Since 10 November 2026 the Mobility Database lists
today's feed as a community feed
([mdb-3629](https://mobilitydatabase.org/feeds/gtfs/mdb-3629)), the first for
Azerbaijan. That asks two things of me: the file keeps its link, and its nominal service
dates, which end on 31 December 2027, move forward by 24 December 2027
([outputs.md](outputs.md#outputredesigngtfs_todayzip-and-gtfs_redesignzip)).

## What this version cannot do

- Headways are estimated for 200 of the 201 routes (55 from boardings, 145 by service
  type, 1 published), so waiting times, fleet, bus-hours and fuel per route are
  approximate. BakuBus publishes only its routes' first and last departures, which bear
  out the 17 hours of service assumed.
- Demand comes from a gravity model that ranks routes at 0.58, so estimated riders per
  route can be far off; the redesign uses counts for the 56 BakuBus routes and
  estimates for the other 145.
- The metro is not in the travel graph; there is no vehicle capacity or crowding; there
  is one all-day weekday average with no peak, night or weekend pattern; walking is
  straight-line distance times 1.3, so walks across rail lines, motorways or the sea
  look shorter than they are (along OpenStreetMap's streets and paths the walk to the
  nearest stop is typically 1.54 times the line, and 66% of people within 400 m in a
  straight line becomes 45%; [results.md](results.md#who-the-network-reaches)); and
  speeds are set by service type, not by street.
- Observed boardings exist only for BakuBus, so 145 routes of other carriers have
  nothing to check against.
- The map API returned the same data on 23 October 2026 as on 6 May, while AYNA has
  been launching a new network since January, so the map may lag the street and mix
  old and new routes; 7 routes have no stops, and route 180 (Pirallahı) looks cut off
  because its connecting routes are missing from the data.
- The population grid is from November 2023: 3.04 million people in the study area
  against 3.22 million official for 2026.
- The search is greedy and only changes existing routes, so it finds improvements, not
  the best network. On the benchmark networks it improves Mumford's (2013) route sets
  best for passengers on both scores, but methods that build and reshape routes reach far lower travel
  times, and in their own route sets it finds almost nothing to straighten
  ([benchmark.md](benchmark.md)).
- Fuel is in diesel-equivalent litres; CNG and electric buses are not modelled
  separately.
- Another city runs from its GTFS feed, but as one service day, one stop pattern per
  route direction and branch (short turns counted, small branches left out and listed in
  `timetable.txt`) and one all-day frequency per route over the hours of service. Express
  routes are recognised from their names and their stops, so one with its own stops and
  a plain name is treated as local.

## Questions that are not mine to answer

Several settings are really policy choices, and I have only picked defaults for them.
Whether the redesign's gain should be taken as faster trips with today's fleet or as
today's trip times with about 12% fewer buses is the first; the results report both,
and `output/redesign/impact.csv` puts each in buses, bus-hours, fuel and CO₂ a day, and
in money once prices are set.
How many people may lose a stop within walking distance so that the rest travel faster
is the second: today the limits are 500 per change and 3,000 in total, at 500 m
(`redesign_max_people_losing_stop`, `redesign_max_people_losing_stop_total`,
`max_access_walk_m`), and the robustness run shows that a limit of zero costs nothing
here. How much riders mind changing buses is the third: the model counts each change as
5 extra minutes on top of waiting (`transfer_penalty_min`), a figure a survey or AYNA's
own model could set for Baku. Which routes must stay as they are, whether express
routes, school services or routes bound by contracts, belongs in
`redesign_protected_routes`, which today holds only 180. Whether routes of different
carriers can be merged at all matters, because 59 of the 72 near-duplicate pairs
involve two carriers; the gross-cost contracts AYNA plans would make it easier. And how
any of this compares with AYNA's own redesign I cannot say: its consultant's network
needs about 2,800 buses, against about 2,300 in service.

## When new data arrives

Real headways go into `data/headways.csv`; then rerun the three scripts. For a new
network snapshot, run `python3 <repository>/data/ayna_scraper.py` in an empty folder
outside the repository (it writes `ayna_data/ayna.db` there), replace `data/ayna.db`
with that file and rerun the three scripts; the repairs are detected from the data, so
they adapt to the new snapshot, and `output/repairs.txt` shows any new ones. Fresh
public data comes from `python3 data/fetch_external.py --refresh`, and a fresh metro
from `python3 data/metro_scraper.py` followed by `python3 data/build_metro.py`. AYNA's
bicycle lanes and parking points come with the other opendata.az files; after a refresh,
`python3 bicycle.py` puts the new lanes beside the network again, and when AYNA says
what the 649 MPS points in its parking file are, or publishes when each lane was built
and what separates it from traffic, `docs/data.md` is where that goes. Whatever changes, I
commit the new data and the regenerated `output/` together, so results always match
their inputs. Once that commit is on `main`, the Mobility Database stores the new
today's feed at its next daily download, so I run `validate_gtfs.py` on the new feeds
before committing them.
