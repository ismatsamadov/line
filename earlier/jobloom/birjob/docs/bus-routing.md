# Bus routing

The planner answers “which buses and metro trains should I take between these
stops?” from the retained AYNA reference snapshot and a snapshot of the metro
(`src/lib/busroute/metro.json`, #689). It has no schedule, vehicle positions,
traffic or waiting-time feed. Neither snapshot refreshes automatically.

```mermaid
flowchart LR
  A[Stop selection] --> B[POST /api/avtobus/find]
  B --> C[Validate integer stop IDs]
  C --> D[Shared graph initialization]
  D --> E[PostgreSQL bus reference tables]
  D --> M[metro.json]
  D --> F[Minimum-boardings search]
  F --> G[Bus, metro and walking instructions]
```

## Ranking

A destination directly connected by a walking edge of at most 300 m gets an
explicit walking-only result. Other trips are ranked lexicographically:

1. Number of boardings.
2. Estimated movement time, including walking.
3. Walking distance.
4. Total estimated distance.

This implements #664's requested preference: an available one-bus itinerary wins
over every two-bus itinerary, even when the latter has a shorter estimated time.
It does not promise the fastest journey. Increasing a finite transfer penalty
would not enforce this preference for arbitrary journey lengths.

A metro ride is a ride like a bus ride (#689): boarding a train, changing trains
and boarding the metro's express bus each count as one boarding. One bus still
beats a bus and a train, however much faster the second is; among journeys with as
many boardings, the faster wins, and that is where the metro comes in. See
[Metro](#metro-689) for what the rule costs.

`src/lib/busroute/routing.ts` runs one Dijkstra search with a priority queue of
immutable labels. A label records the arrival stop and the last edge. Continuing
a ride requires the same `(bus, direction)` identity **and** the next consecutive
route position. Changing direction, reboarding after a walk, or boarding at a
later occurrence of a repeated stop starts another ride. Reconstruction splits
instructions at those same boarding boundaries, so ranking and displayed
transfer counts agree. Transfer count is `max(boardings - 1, 0)`.

Walking edges cannot follow other walking edges. Because the graph includes all
nearby stop pairs, any permitted straight-line walk within the radius already
has a direct edge; chaining would only enable walks beyond the stated limit.
One walk may occur before the first ride, between rides, and after the last ride.
There is no overall walking budget across a journey with several rides.

The state includes whether a walking arrival has already boarded a bus, so an
origin walk cannot suppress an otherwise valid bus-and-walk arrival. Queue
entries whose label has been replaced are skipped. The unused, incorrect Yen
alternative-path implementation and its unused optimization modes were removed;
the endpoint exposes one complete itinerary.

## Graph and data

`graph.ts` loads stops, buses and route-stop rows in parallel. Within a bus and
direction, travel order is cumulative `total_distance`, then `bus_stop_id` and
`id` as stable tie-breaks. This agrees with the line viewer. Repeated stops stay
in the graph with distinct positions so a ride cannot jump across a loop. A
missing stop breaks its adjacent legs; it is not skipped to invent a shortcut.

The snapshot stores 120A's stops twice in each direction (bus_id 160: 30 rows for
15 stops and 28 for 14, every row at `total_distance` 23.4), so travel order puts
one copy after the other. `collapseRepeatedSequence` (`sequence.ts`) keeps one copy
of a list that is an exact repeat of itself, in the graph and in the line viewer
(#685). Without it the planner rode from the terminus straight back to the first
stop as one leg and spread the line's duration over twice the legs. It changes no
other shape: a loop, a route that ends where it starts and a stop listed twice in a
row stay as they are.

Two stops of route 517, 3838 and 3839, were stored at latitude 4.05, the right
digits with the decimal point one place out, which put every journey through them
in the Indian Ocean. `prisma/migrations/2026-10-24_bus_route_517_stop_latitudes.sql`
moves them to 40.49233 and 40.49409; its header has the evidence. This finds any
other stop outside the area (0 since that file was applied on 2026-10-24). Nothing
runs it automatically:

```sql
SELECT id, name, latitude, longitude FROM bus.bus_stop_details
 WHERE latitude NOT BETWEEN 39.5 AND 41.5 OR longitude NOT BETWEEN 48.5 AND 51;
```

Since 2026-10-26, `isBakuCoordinate` in `geo.ts` applies this same generous
envelope in the graph, the stop picker/map data and the line viewer. It rejects
nonfinite coordinates as well as world-valid points outside the network's area,
including the old latitude 4.05. A rejected stop breaks its adjacent graph legs
instead of creating a shortcut through it. This protects searches and maps; it
does not repair the underlying rows or replace the read-only data audit above.

The graph uses haversine distance between stops. A bus line's stored duration is
spread evenly over its legs; missing/nonpositive duration falls back to 30
minutes for the whole line. Neither figure is road geometry or a live estimate.
`totalTime` contains movement only, with no invented wait or transfer penalty.
`totalStops` counts stop and metro-station visits, merging an adjacent shared
transfer stop once while preserving repeated visits around loops and distinct
walking-transfer endpoints.

`walking.ts` builds bidirectional connections of at most `WALK_RADIUS_KM` from
the same coordinates. A spatial grid covers nearby Baku stops without an all-pairs
scan. Connections do not depend on input order or bus membership; even two stops
served by the same line can need a walk because their directions differ. The
graph no longer reads legacy `bus_walking_edges`, whose generation omitted useful
pairs. That table kept its rows until the owner had it dropped on 2026-10-25 (#688,
`prisma/migrations/2026-10-25_drop_retired_data.sql`); every other reference table
remains, and no migration or production write was needed to repair the graph.

`getGraph()` caches the initialization **promise**, returning only a completed
graph to concurrent callers. A failure clears that promise so the next request
can retry with a fresh graph. The API catches failures and returns a localized
error rather than letting a database exception escape.

## Road shapes

`shape.ts` draws a ride along AYNA's recorded route line (`bus_route_coordinates`)
instead of straight lines between its stops (#685). The lines cannot be drawn as
stored: three directions are pieces joined by straight jumps of 9 to 20 km (557, 550
and 555, direction 1), two lie outside Baku (531 direction 1 has latitude equal to
longitude, 521 direction 2 has the two swapped), some are filed under the other
direction or stored backwards, and four directions have none.

So the graph reads every line once per process (`queryRouteShapes`, about 109,000
points) and places each ride's stops on a line in travel order: a dynamic program
that never moves backwards along the line and minimises each stop's squared
distance from it, a stop more than 300 m away staying unmatched. The ride's own line
and the bus's other direction are each tried as stored and reversed. The fit with
the most legs on the road wins. On a tie the ride keeps its own line unless another
fits clearly closer, its stops' median offset under 70% of the own line's: the rule
the open-data study of the network used to refile misfiled lines. Two lines of one
bus can both reach every stop and take other streets (553's are 18.6 and 27.9 km),
so a slightly closer fit is not enough. A small cost per kilometre between the first
and last stop places a terminus past a loop with no stops on it rather than before
it. A leg gets the road only when both its stops are matched, it is not two stops
apart meeting at one point of the line, and no straight stretch on the way is longer
than 5 km; every other leg stays straight, and so does a walk.

Bus edges carry their leg's road, and a journey's ride joins them
(`RouteSegment.path`). The line viewer matches its stops to the bus's lines the same
way, so it no longer draws a broken line as stored; its coordinates are empty when
nothing fits, and the map then joins the stops. Distances and times do not change:
they still come from straight lines between stops, as the page says. If the lines
fail to load, the graph builds without them and every ride is drawn straight until
the process restarts: the graph is built once, and only a console error says so.
The line viewer also catches a failure reading its optional road geometry: it
returns the ordered stops with empty coordinates, allowing the map to join those
stops. A geometry-table failure therefore does not hide an otherwise usable line.

Measured on a copy of the production tables on 2026-10-24: 11,230 of 11,355 legs get
the road, and the graph builds in about 1.1 s with the lines. Of 300 random trips,
723 of 731 rides were drawn along the road, each starting and ending within 300 m of
its stops and none with a jump; line 521's second direction now stays inside Baku.
Forty legs over 1 km are more than four times the straight line between their stops.
They follow the recorded line around loops, which the open-data study of the network
lists as detours on many of those routes: 112 direction 2 has 4.5 km of road between
stops 40 m apart. 553 direction 1's line, the one the study files under it, runs a
9 km loop with no stops between its first two stops; the recorded line shows it, and
nothing here can confirm the bus drives it.

## Metro (#689)

The metro joins the graph from `src/lib/busroute/metro.json`, which
`scripts/bus/build_metro_json.py` writes from the metro tables of the open-data
study of the bus network (github.com/ismatsamadov/route_efficiency, `data/metro/`,
built there by its `data/build_metro.py`). The study read the operator's own API
on 25 October 2026: its journey planner timed every train service both ways. It
took the stations and the track from OpenStreetMap (data of 24 October) and the
operator's 98 exits from opendata.az. `metro.json` records the commit it came
from and carries 27 stations with their exits, and 14 rides with 48 legs, each
leg with its running time, its track distance and its stretch of track. The
OpenStreetMap part is under the ODbL, credited on the map and on the page; the
operator's part is a snapshot like AYNA's.

**What a ride is.** The operator's planner starts a new leg where a passenger
changes, and the script keeps a change only where the planner makes it both ways:
a train that runs through a station one way runs back through it. On the
25 October snapshot that gives:

- red line: İçərişəhər – Əhmədli, and a shuttle on to Həzi Aslanov while that
  station's turnback siding is repaired (the operator said on 23 October that the
  shuttle ends "in the coming days"); Nəriman Nərimanov – Bakmil;
- green line: Dərnəgül – Nizami, then the express bus to 28 May, since no trains
  have run between Nizami and 28 May since 15 August 2026 (works; the buses run
  06:00–00:00); Cəfər Cabbarlı – Şah İsmayıl Xətai;
- purple line: Xocəsən – 8 Noyabr. The planner waits at Avtovağzal on the way to
  Xocəsən only, so that is not a change and the ride runs through.

A ride's times are running times. The planner's waits are left out, as every wait
is. Three of the operator's figures are kept as given though they look wrong. Two
are the first leg out of a terminus: 6.5 minutes from Şah İsmayıl Xətai to Cəfər
Cabbarlı against 3.0 the other way over the same 2.2 km, and 5.0 minutes from Həzi
Aslanov to Əhmədli against 2.5 the other way over the same 1.4 km, both perhaps
counting time standing at the terminus. The third is the express bus's numbers, M1
and M2 in its structured answer but "M2 or M3" in its own instruction text; the bus
is shown as M1/M2.

**In the graph** (`metro.ts`, added by `TransitGraph.addMetro`). Stations are nodes
numbered from `METRO_STATION_ID_BASE` (1,000,000) in their order in `metro.json`;
AYNA's stop ids end at 3,841, and the graph leaves the metro out rather than let a
stop id into that range. The stop picker does not offer stations, so journeys still
start and end at bus stops. A ride's legs are `metro` edges with the ride's
identity and consecutive positions, which the search continues exactly like a bus
direction. A stop within 300 m of a station's nearest exit gets a walk to and from
the station, measured to that exit and drawn by it (stop, exit, station); the
minutes inside the station, escalators and passages, are not counted. The two
pairs of stations within 300 m of each other are the interchanges, 28 May and Cəfər
Cabbarlı (35 m) and Memar Əcəmi and Memar Əcəmi-2 (129 m), and are joined by
walks. A walk still cannot follow a walk, so a walk to one station cannot go on to
the next on foot. Bakmil's only exit has no bus stop within 300 m (the nearest is
0.7 km away), so no journey uses Bakmil. If the metro cannot be built the graph is
built without it and the console says so, as with the road shapes.

**Shown.** A segment has a `mode` (`bus`, `metro` or `walk`); a metro train or the
metro's express bus also has its `line` (the operator's name and colour), bus id
-2 (`METRO_RIDE_BUS_ID`) and, as `busNumber`, the line's name or the bus numbers.
Its `headsign` is the ride's terminus and its `direction` is null. The step list
names a train "Metro · Qırmızı xətt" with its stations and terminus, a station at
either end of a walk as "<name> metrosu", and the express bus as "Ekspres avtobus
M1/M2" with a note that no trains run there. The map draws a train in its line's
colour on a dark casing and each station as an "M" in that colour. Buses keep their
colours (`segmentColors.ts`, shared by the list and the map).

**Measured** on 2026-10-25 against the AYNA snapshot in route_efficiency's
`data/ayna.db` (the same 3,456 stops and 208 buses as production), with a local
harness that is not committed. The graph builds in 0.75 s with the metro, and 26
of the 27 stations reach a stop. Of 1,500 random trips, 204 use the metro: 9 need
fewer boardings than by bus alone, and 195 keep their boardings and are 9.1 minutes
faster on average. None got slower or needed more boardings, and every journey
passed checks for gaps between segments, walks over 300 m, two walks in a row and
the transfer count. Neftçilər m/st → 28 May m/st now takes the red line, 19.9
minutes against 40.6 by bus 49. Şah İsmayıl Xətai → Ulduz takes the branch line,
the interchange and the red line, 17.2 minutes against 54.4 by two buses.
Həzi Aslanov m/st → Sahil m/st stays on bus 20, because the metro would need the
change at Əhmədli. What #664's rule costs: in 320 of 590 random trips a journey
with one more boarding would be at least 10 minutes faster (22 on average, waits
not counted), but 262 of those exist by bus alone, so this is the rule's trade-off
and not the metro's; 135 of them use the metro.

**Refreshing.** In route_efficiency, `python3 data/metro_scraper.py` and
`python3 data/build_metro.py`; then here
`python3 scripts/bus/build_metro_json.py <path to route_efficiency>`. If the
services changed, `metro.test.ts` fails on its list of rides: update that list and
this section together, since they are what riders are told. The file is
re-included in `.gitignore`, whose `*.json` line would otherwise keep it out of git
and so off the box, and `metro.test.ts` fails if it stops being.

## API and UI

`POST /api/avtobus/find` accepts positive PostgreSQL integer IDs. Invalid JSON,
invalid IDs and identical stops return 400 before loading the graph. Unknown
stops or an unreachable destination return 404; initialization failures return
500 with a retryable error message. Error bodies keep the string shape consumed
by the client. A successful response includes origin/destination metadata and a
single `RouteResult`. Every segment has its `mode`; bus segments include their
direction and terminal name, and metro segments their line and terminus.

The browser automatically searches when the selected stops change. Each request
has a generation number; changing stops, swapping them, choosing a location or
switching mode invalidates an older response. A delayed itinerary cannot overwrite
the current selection. Results show boarding/alighting stops, walking endpoints,
terminal direction and movement-time limitations. Walking-only journeys are
labeled “Piyada,” rather than “0 avtobus.”

Stop and bus searches fold Azerbaijani letters and Latin keyboard equivalents
(including dotted İ), support words in any order, and rank exact names/codes
before prefix and partial matches. Empty stop searches suggest transport hubs.
The picker uses a labeled combobox and listbox; arrow keys select an option,
Enter chooses it, and Escape or Tab closes the suggestions. Stop-list and
bus-list failures have retry controls rather than looking like an empty network.

GPS and empty-map taps choose a stop only within 600 m. That selection radius is
separate from the routing graph's 300 m walking-transfer limit. The GPS selection
shows the approximate distance to its stop and says that this access walk is not
included in the itinerary's movement time. A location callback is invalidated by
later selections or a mode change, so delayed GPS cannot replace a newer origin.

`GET /api/avtobus/line` takes `busId` as a positive PostgreSQL integer written in
digits, and `direction` as 1 or 2 (no direction means 1); anything else is a 400
before any query. `parseInt` used to read “1junk” and “1.5” as 1 and pass ids past
int4 to Prisma, which threw. The stop and bus lists show an error when their
request fails; a 500 body is JSON too, and used to read as an empty list. On a phone,
the map loads when first opened and remains mounted when its tab is hidden. Desktop
loads it immediately. A fit made while hidden once landed at maximum zoom on the
journey's middle; whenever the map goes from 0×0 to a real size it fits again, and
an ordinary window resize keeps the view (#685). New phone results scroll into view,
respecting reduced-motion preferences. The line summary uses the returned stop order
for its endpoints, including the return direction.

## Automated verification

Tests cover direct-bus preference, minimum transfers, tie-breaks, origin and
interchange walks, the walking limit, directions, loops, unreachable stops,
initialization concurrency/retry and API input/error handling. An independent
round-by-boardings oracle checks 900 trips over generated small networks. The
spatial grid is checked against exhaustive haversine pairs.

`routingOracle.test.ts` adds 900 generated trips checked against a separate
boarding-round cost oracle. It expands complete contiguous ride stretches in each
round and allows one walk between rounds, rather than reproducing the production
edge/state Dijkstra. Its mixed bus/metro networks include loops, origin walks,
interchanges and destination walks. It checks every ranking objective, transfer
counts, segment continuity and the absence of consecutive walking segments.

## Verification on 2026-10-26

The targeted planner, bus-routing and API suites passed 118 tests in 14 files. Regression
tests cover the historical out-of-area latitude, consistent filtering for the
picker and line map, and usable line stops when optional geometry cannot load.

A separate harness built the real graph, metro and shapes against a read-only
local AYNA snapshot (3,456 served stops, 208 buses), mocking only the database
reads. Of 600 sampled pairs, 594 had a route and six were unreachable; 68 routes
used metro and the largest transfer count was four. Every boarding count agreed
with an independent line-round oracle. Endpoint continuity, walking limits,
movement-time/distance sums and geometry jump checks passed; 1,472 of 1,488 rides
had a matched shape. This was local snapshot verification, without production
writes. The harness and exported snapshot remain outside the repository. Browser
launch and local PostgreSQL initialization were blocked by the sandbox, so this
run does not establish browser behavior for the redesigned interface. TypeScript,
Next lint and architecture checks pass. The production compiler also passes using
actual Archivo files downloaded through curl and supplied locally to Next's font
loader, since Node cannot resolve Google Fonts here. Full prerendering stops on
job pages that require the unavailable database. The full gate cannot pass in this
environment: PostgreSQL/network-binding integration suites cannot run. Correcting
PATH during deployment preflight made Python lint and all 414 Python tests pass.
No gate checks were bypassed to publish or deploy these changes.

Three separate temporary React server-rendering tests verify the actual page and
journey component: one H1, labeled comboboxes, unique element IDs, canonical/OG URL,
all three JSON-LD blocks, agreement between visible FAQ and schema answers, and
boarding/alighting instructions, intermediate stops and walking-only output.
These checks establish HTML/SEO output, not browser layout or interactions.

## Historical verification for #664

A read-only production snapshot on 2026-10-17 contained 3,456 stops, 208 buses and
402 directions. A local comparison with the previous implementation checked 200
trips: 134 used fewer boardings; all 100 sampled direct journeys retained at most
one boarding. Row-ID ordering currently agreed with cumulative-distance order in
all 402 directions, so the ordering change is preventative. The grid produced
10,260 walking edges versus 10,256 legacy rows. Snapshot files remain outside the
repository and the checks wrote no production data.

The production build and all eight sitemap/content guards passed. Browser
verification used that local production build with an explicit read-only tunnel
DSN. Desktop (1440 px) and phone (390 px) checks covered direct, walking and
three-bus journeys, unreachable destinations, API failure/retry, discarding a
delayed response, line viewing/direction changes and endpoint swapping. The
Neftçilər → 28 May browser journey used one bus, with a short initial walk.
No browser exceptions or horizontal overflow occurred. Other browser mutations
were intercepted; no email was sent and no production account was changed.

For a manual browser check, select a start and destination, verify the returned
bus count and directions, then swap endpoints. Change the destination while a
request is pending and ensure only the new selection appears. Check a short
walking trip, an unreachable pair and an API failure on phone and desktop. The
API-to-database check must use an explicit read-only tunnel DSN, never the retired
Neon value in `.env.local`.
