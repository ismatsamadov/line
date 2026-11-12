# Bus routing

The planner answers “which buses and metro trains should I take between these
stops?” from the retained AYNA reference snapshot and a snapshot of the metro
(`src/lib/busroute/metro.json`, #689). It has no schedule, vehicle positions,
traffic or waiting-time feed. Neither snapshot refreshes automatically. The map
also draws AYNA's bicycle lanes and racks, and a journey names the racks beside it
(`bike.json`, [Bicycles](#bicycles-692)); nothing routes by bicycle. The start and
destination can also be a named place from an OpenStreetMap snapshot (`places.json`,
[Places](#places-720)) or the person's location: the journey then walks from it to a
stop near it and from a stop to it, counted like any walk
([Routing from a place](#routing-from-a-place-720)).

```mermaid
flowchart LR
  P[GET /api/avtobus/places] --> Q[places.json]
  P -->|places that match, with their points| A
  A[Stop, place or location] --> B[POST /api/avtobus/find]
  B --> C[Validate stop IDs or points]
  C --> D[Shared graph initialization]
  D --> E[PostgreSQL bus reference tables]
  D --> M[metro.json]
  D --> F[Cheapest-journey search]
  W[access.ts: stops within 1 km of a point] --> F
  F --> G[Bus, metro and walking instructions]
  G --> K[bike.json: racks beside the journey]
```

## Ranking

A destination directly connected by a walking edge of at most 400 m gets an
explicit walking-only result. Every other journey costs its estimated movement
time, walking included, plus `BOARDING_PENALTY_MIN` (15 minutes) for each
boarding, and the cheapest wins (#721). Ties go to:

1. Fewer boardings.
2. Less walking.
3. Less total estimated distance.

The 15 minutes stand for what the movement time leaves out: the wait for each
vehicle, which nothing published can estimate (no timetable or headway, #693),
and the change itself. A journey with one more boarding therefore wins only when
it is at least 15 minutes faster, and #664's promise holds where the difference
is small: one bus still beats two buses, or a bus and a train, that save less
than a quarter of an hour. The longest walk between stops takes 6.9 minutes on its
streets ([Graph and data](#graph-and-data)), less than one boarding, so a destination
within a walk is always reached on foot.

Until #721 the ranking was lexicographic, boardings first (#664): an available
one-bus journey beat every two-bus journey, however much faster the two were. It
passed over journeys such as 2147 → 2734, two buses in 67.2 minutes where a bus,
the red line and a bus take 24.8; in 22 of 196 sampled trips the fastest journey
with one more boarding than the fewest was 20 minutes or more faster (times as in
[Graph and data](#graph-and-data)). A finite
penalty cannot promise one bus over two for every journey length, which is why
#664 refused one; #721 gives that promise up where it costs a quarter of an hour
or more. Choosing by cost is the same as taking the fastest journey for each
number of boardings, the Pareto front of boardings and minutes, and keeping the
one with the lowest minutes plus penalty; one search finds it without listing the
front.

How much the penalty decides, on those 196 trips, counting the journeys that take
more boardings than the fewest possible:

| Penalty | Trips | Extra boardings | Minutes saved: median, least |
| --- | --- | --- | --- |
| 10 min | 74 | 69 × 1, 5 × 2 | 16.8, 10.1 |
| **15 min** | **46** | 44 × 1, 2 × 2 | 19.7, 15.4 |
| 20 min | 22 | 21 × 1, 1 × 2 | 30.2, 24.7 |

Fifteen keeps the fewest boardings in three trips of four and gives them up only
for a saving that is clear against estimates this rough. It is one constant in
`routing.ts`; where to set it is the owner's call.

A metro ride is a ride like a bus ride (#689): boarding a train, changing trains
and boarding the metro's express bus each count as one boarding and pay the same
penalty. The faster train wins among journeys with as many boardings, and a bus
and a train beat one bus when they save more than a boarding.

`src/lib/busroute/routing.ts` runs one Dijkstra search with a priority queue of
immutable labels, compared on cost, then boardings, walking and distance. A
label records the arrival stop and the last edge. Continuing a ride requires the
same `(bus, direction)` identity **and** a leg from the route position the last
one reached, to the next position or, past a misplaced stop, the one after it
([Graph and data](#graph-and-data)). Changing direction, reboarding after a walk,
or boarding at a later occurrence of a repeated stop starts another ride.
Reconstruction splits instructions at those same boarding boundaries, so ranking
and displayed transfer counts agree.
Transfer count is `max(boardings - 1, 0)`. The search takes its starting labels
with their own costs; the endpoint passes one, at the chosen stop, or at a point
whose walks to the stops near it are its edges ([Routing from a
place](#routing-from-a-place-720)).

Walking edges cannot follow other walking edges. Because the graph includes all
nearby stop pairs, any permitted straight-line walk within the radius already
has a direct edge; chaining would only enable walks beyond the stated limit.
One walk may occur before the first ride, between rides, and after the last ride.
There is no overall walking budget across a journey with several rides.

The state includes whether a walking arrival has already boarded a bus, so an
origin walk cannot suppress an otherwise valid bus-and-walk arrival. Every state
is a number: a walk's is made of its stop and that flag, and a ride's names the
position it arrived at, by its edge's kind, ride and `toSequence`. Until #721 both
were strings built and hashed for every edge tried, most of a search's time. Now
`graph.ts` keeps each ride edge's number on the edge once the graph is built
(`numberRidePositions`), as a property a copy does not take, and an edge without
one, a copy or one built elsewhere, is numbered from its own fields. Keying a ride
by its edge object was as fast, but only while `getEdges` returned the graph's own
objects: through a graph that copied its edges no ride state was ever met twice,
and 1343 → 3642 ran the process out of memory in review. So `getEdges` may hand
back copies, and a ride edge's kind, ride and `toSequence` must name one position
of one ride, at one stop (`RoutingGraph` in `routing.ts`). Two legs can arrive at
one position: the leg past a misplaced stop arrives where the leg on from that
stop does, and the search keeps the cheaper. Queue entries whose label has been
replaced are skipped. The unused, incorrect Yen alternative-path implementation and
its unused optimization modes were removed; the endpoint exposes one complete
itinerary.

## Graph and data

`graph.ts` loads stops, buses and route-stop rows in parallel. Within a bus and
direction, travel order is cumulative `total_distance`, then `bus_stop_id` and
`id` as stable tie-breaks. This agrees with the line viewer. Repeated stops stay
in the graph with distinct positions so a ride cannot jump across a loop. A
missing stop breaks its adjacent legs; it is not skipped to invent a shortcut,
though its stretch still counts for the line's time (below).

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
shared out over its legs by their straight-line length (#721); a missing or
nonpositive duration falls back to 30 minutes for the whole line. AYNA's
duration is its route length at one speed: 1.66 minutes a kilometre on the median
line and never above 1.67, where the route length covers both directions (its
median ratio to the two recorded lines' lengths is 0.99). Spread over one
direction, as here, that is about 18 km/h along the road and 16 km/h in a straight
line, a usual pace for a city bus with its stops.

Until #721 the duration went to the legs in equal shares, so a leg's speed
depended on how far apart its stops were: 2.2 km/h at the 1st percentile of the
11,355 legs, 72.6 at the 99th, and 147 km/h for the 6.5 km leg of 553 in 2.65
minutes; 497 legs were slower than walking. The search rode buses for those
artifacts. #721's journey took 525 for 5.6 km in 10.3 minutes (33 km/h, twice its
line's pace) to catch 503 at Xırdalan rather than where it starts, at Avtovağzal.
Shared by length, each leg keeps its line's pace: 10.6 to 21.9 km/h for 98% of
legs and 32.5 at most (line 517). The model still knows no dwell time, traffic or
faster highway stretches, and a leg whose road loops far beyond the straight line
between its stops (40 legs over 1 km, [Road shapes](#road-shapes)) is still
timed by the straight line. Neither figure is road geometry or a live estimate.
`totalTime` contains movement only; the boarding penalty decides the choice and
is not added to the time shown.
`totalStops` counts stop and metro-station visits, merging an adjacent shared
transfer stop once while preserving repeated visits around loops and distinct
walking-transfer endpoints.

Shared by length, one stop in the wrong place sets the pace of its whole line, so
two cases count differently (`measuredLength` in `graph.ts`, #721). A run of stops
without coordinates breaks its legs, but the bus still covers that stretch: it
counts as the straight line between the stops either side, and the rest of the
line keeps its pace (in a synthetic line of ten stops, one missing had made the
others 29% slower). And a stop is taken to be misplaced when its two legs run more
than three times the straight line between its neighbours, and over a kilometre
longer, while the recorded line ([Road shapes](#road-shapes)) passes it by but
runs on through the legs beyond: its two legs then count as that straight line in
the length the line's time is shared over, so the rest of the line keeps its pace.
A ride that stays on past the stop takes one more leg (`misplacedStops`), from the
stop before it to the stop after, as long as that straight line and timed at that
pace. It reaches the stop after at the same route position as the leg from the
stop itself, so the search keeps the cheaper of the two, and a journey through it
still lists the stop among those it passes, as the line does, but draws the ride
straight past it. The stop's own legs keep their stored lengths and take their
time at that pace, because the stop stays where it is stored, with its walks:
boarding or alighting there costs the way to where it stands. Shared as the
straight line instead, as early in the review, the stop was a jump (536 from 3077
to 3095, stored 2.72 km apart, in 1.5 minutes), and a spur out to such a stop and
back would have cost nothing. Kept at their stored lengths with no leg past, as
later in the review, they made every ride through the stop pay a detour the bus
does not make, and no answer among 1,500 random pairs rode 536 or 537 through
either stop.
This is the only use routing makes of the recorded lines, and without them it
changes nothing. Sixteen stops on the snapshot stick out that far. Fourteen lie on
their line, where the bus does go out of its way (145 to Binəqədi Gənclər
Şəhərciyi, 3.6 km of legs for 1.1 between its neighbours), and count in full. The
other two are suspected errors in the data. The right coordinates are unknown, so
no migration corrects them:

- **Stop 3841**, Zabrat-Kürdəxanı şosesi, 18, the second stop of 537's second
  direction, is stored at 40.520541, 49.950679, 1.1 km from both of 537's
  recorded lines while the stops either side lie on them. The stop beside the
  terminus in the other direction, 3840 (Zabrat-Kürdəxanı şosesi, 19), is stored
  2.8 km south at the same longitude. 3841's legs ran 5.43 km where its
  neighbours are 0.78 apart, took 15.3 of the direction's 70 minutes, and left the
  other 26 legs 19% fast.
- **Stop 3095**: 536's second direction lists "28 May küçəsi 222" as stop 3095,
  whose own record is C.Cavadov küç. 72A, at 40.529394, 49.849165: a point on
  536's route, but not between those neighbours. Its legs ran 4.73 km for 0.71,
  took 14.6 of 88 minutes, and left the other 32 legs 14% fast.

The rule changes the time of 62 legs, all in those two directions, and no
distance, and adds the two legs past. Both directions now run at their lines' pace,
17.3 and 16.7 km/h in a straight line, and so do the misplaced stops' legs: a ride
to or from such a stop takes the way its stored place makes, 10.6 minutes for 537's
3.06 km from 1635 to 3841, and a ride through it the straight line, 2.7 minutes
from 1635 to 1421 where the stored legs take 18.9 (536 from 3077 to 3079: 2.6
against 17.0). End to end the two directions take AYNA's 70 and 88 minutes, where
the stored legs made them 86.2 and 102.5. Of the review's 1,500 random pairs (seed
20261111) 32 answers change against times shared by length alone, and 4 of the 200
below, each on 536 or 537: 8 of the 32 keep their journey at its line's true pace,
and 24 take another, 17 of them through a misplaced stop.

`walking.ts` builds bidirectional connections of at most `WALK_RADIUS_KM` from
the same coordinates. That limit is 400 m in a straight line, about seven minutes on
its streets and the distance a bus stop is usually taken to serve; it was 300 m until #721, which left
Azərbaycan Hava Yolları QSC (stop 1343) without the 28 May hub (stop 105) 355 m
away, so its trip to Sumqayıt took three buses where two go through Avtovağzal. A
spatial grid covers nearby Baku stops without an all-pairs scan; its cells, and
the boxes the metro searches around a station's exits, are sized from the limit
for the narrowest degree of longitude in the network's area. Connections do not
depend on input order or bus membership; even two stops served by the same line
can need a walk because their directions differ. The
graph no longer reads legacy `bus_walking_edges`, whose generation omitted useful
pairs. That table kept its rows until the owner had it dropped on 2026-10-25 (#688,
`prisma/migrations/2026-10-25_drop_retired_data.sql`); every other reference table
remains, and no migration or production write was needed to repair the graph.

Every walk is timed on its streets: its straight line times `WALK_DETOUR`, 1.3, at
4.5 km/h (`walkMinutes` in `geo.ts`, #720). On OpenStreetMap's walking network in Baku
the way on foot was 1.29 times the straight line at the median for walks of up to
400 m between stops, and 1.37 to 1.40 for the longer walks from and to a place and for
the walk the whole way (measured on 2026-11-11); the open-data study of the network
assumes 1.3. The distances shown, and every limit a search walks within (400 m here,
1 km from a place, 2 km for the walk the whole way), stay straight lines, and the page
says so: "Məsafə düz xətt üzrədir, vaxt küçələrlə yol üçün 30% artıq hesablanıb".

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
they still come from straight lines between stops, as the page says; the lines only
tell a misplaced stop, which sets its line's pace by the straight line past it and
is ridden past that way ([Graph and data](#graph-and-data)).
If the lines fail to load, the graph builds without them and every ride is drawn
straight until the process restarts: the graph is built once, and only a console
error says so.
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
stop id into that range. The pickers offer the stations as places (#720), and a journey
from or to one walks to or from the station, by its nearest exit, or a stop near it
([Routing from a place](#routing-from-a-place-720)). A
ride's legs are `metro` edges with the ride's
identity and consecutive positions, which the search continues exactly like a bus
direction. A stop within a walk (400 m) of a station's nearest exit gets a walk to
and from the station, measured to that exit and drawn by it (stop, exit, station);
the minutes inside the station, escalators and passages, are not counted. The two
pairs of stations within a walk of each other are the interchanges, 28 May and
Cəfər Cabbarlı (35 m) and Memar Əcəmi and Memar Əcəmi-2 (129 m), and are joined by
walks; the next closest pair is 812 m apart. A walk still cannot follow a walk, so
a walk to one station cannot go on to the next on foot. Bakmil's only exit has no
bus stop within a walk (the nearest is 0.7 km away), so no journey uses Bakmil.
If the metro cannot be built the graph is
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
and not the metro's; 135 of them use the metro. These figures predate #721, which
replaced that rule and the equal shares of a line's time ([Ranking](#ranking)).

**Refreshing.** In route_efficiency, `python3 data/metro_scraper.py` and
`python3 data/build_metro.py`; then here
`python3 scripts/bus/build_metro_json.py <path to route_efficiency>`. If the
services changed, `metro.test.ts` fails on its list of rides: update that list and
this section together, since they are what riders are told. The file is
re-included in `.gitignore`, whose `*.json` line would otherwise keep it out of git
and so off the box, and `metro.test.ts` fails if it stops being.

## Bicycles (#692)

The map draws Baku's bicycle lanes and bicycle racks, and a found journey names the
racks nearest its first boarding and its last alighting. Both come from AYNA's open data
on opendata.az, under CC0 (Creative Commons CCZero): "Velosiped zolaqlarının coğrafi
koordinatları" (the lanes, its layer "Mövcud zolaqlar", file of 24 September 2026) and
"Velosiped parkinq məntəqələrinin coğrafi koordinatları" (the racks, its layer
"velosiped məntəqələri yeni", MPV-1-2 to MPV-185-2, file of 4 May 2026; the portal's
24 September date for it is an edit of the description, and the layer inside is named
after an older file, "velosiped məntəqələri.11 sentyabr.kmz"). The issue pointed at
samirmehd1yev/TransportTech, a hackathon repository whose two KMZ files are byte for byte
the portal's, so `src/lib/busroute/bike.json` is built from the portal's files.
`scripts/bus/build_bike_json.py` writes it and records both files' SHA-256.

**What the data is.** 60 lane segments on 54 streets, 57.1 km in all (the file has a
61st record, for 8 Noyabr pr., with no points), and 185 racks, four of them on the
Absheron coast north of the city (MPV-144-2 to MPV-147-2). The parking dataset says what
it covers: only where the racks are, and not how much they are used, by how many people,
or any other operating figure. They are places to leave a bicycle; nothing in the data is
a bicycle to hire. The same file holds 649 points named MPS-* under "My Places", which
the script leaves out on purpose: the file's name (mpv-v-mps) pairs them with the racks,
and the dataset's Russian title names bicycles and scooters, so they read as scooter
parking; only the MPV layer is named for bicycles.

**Why nothing routes by bicycle.** A cycle leg needs a bicycle where the journey starts,
which the data cannot say, and a road network for cycling, which the planner does not
have. It would also undo the ranking: a leg on a bicycle pays no boarding, so riding all
the way would win most trips. The planner keeps its stop-to-stop journeys and adds what
the data supports: where to leave the bicycle.

**Beside a journey** (`journeyBikeParking` in `bike.ts`, called by
`POST /api/avtobus/find`). The rack nearest the first ride's first stop or station, and
the one nearest the last ride's last, each within the planner's walk (400 m). A walk before
the first ride or after the last is not counted, since the bicycle takes its place, and a
journey on foot gets none. The response carries them as `bikeParking`: `boarding` and
`alighting`, either of them null, or null altogether. If they cannot be worked out, the
journey is sent without them and the console says why. The step list names each rack
with its stop and its straight-line distance, and the map marks it with a green "P" at
any zoom.

**On the map** (`BusMap.tsx`). The lanes are a dotted green line, apart from every route
line (solid) and the walk (dashed grey). The racks are green dots from zoom 14, where
they stop crowding each other: the median gap between a rack and its nearest neighbour is
260 m. A switch in the map's corner, "Velosiped zolaqları", turns both off. Neither takes
a tap: a lane is not interactive, and a rack shows its name without the tap going on to
choose the nearest stop. `bike.json` travels in the map's chunk (7.6 KB gzipped), so it
loads with the map and not with the page.

**Measured** on 2026-10-29 against route_efficiency's `data/ayna.db` (the same 3,456
served stops as production): 453 stops have a rack within 300 m and 170 within 100 m.
16 of the 27 metro stations have one within 300 m of the station's point, 15 of them
within 120 m, and 178 of the 185 racks are within 300 m of a stop.

**Refreshing.** AYNA says it updates the parking dataset every six months. Download the two
files from their dataset pages (the script's header has the addresses), then
`python3 scripts/bus/build_bike_json.py movcud-zolaqlar-velo.kmz mpv-v-mps.-son.kmz`.
If what they hold changed, `bike.test.ts` fails on its counts: update them and this
section together. The file is re-included in `.gitignore`, as metro.json is, and
`bike.test.ts` fails if it stops being.

## Places (#720)

The start and destination pickers offer named places beside the stops: malls, markets,
restaurants and cafés, universities and schools, hospitals and clinics, hotels, parks,
government offices, embassies, banks, sights, metro stations, settlements and more,
12,590 of them in 36 categories, each shown with its category in Azerbaijani ("Ticarət
mərkəzi"). A journey from or to a place walks from it to a stop or station near it and
from one to it, counted in the time and distance and drawn on the map
([Routing from a place](#routing-from-a-place-720)).

**Where the places come from.** Google's place data was ruled out: its terms forbid
storing it and showing Places results on a map that is not Google's, and the planner
draws OpenStreetMap tiles with Leaflet. The places are OpenStreetMap's, © OpenStreetMap
contributors, under the Open Database Licence (ODbL) 1.0. `scripts/bus/build_places_json.py`
sends one query to the Overpass API (overpass-api.de, with a User-Agent naming the
planner; on a 429, 502 or 504 it waits, for Retry-After when given, in seconds or as a
date, and tries at most twice more) for every named feature in the network's area that
carries one of the tags a destination does: amenity, shop, office, tourism, leisure,
healthcare, historic, building, railway and public-transport stations, aerodromes, place,
beaches, retail, commercial and residential land, towers, lighthouses and piers. The area
is the extent of AYNA's stops and about 2 km around it, 39.92–40.66 N and 49.37–50.39 E,
inside the envelope `isBakuCoordinate` accepts. The query asks for OpenStreetMap as it was
at the snapshot's second (`[date:"2026-11-11T06:09:21Z"]`, the script's `SNAPSHOT`), and
Overpass keeps past states, so the same query fetches the same features whenever it is
sent. The first answer was not kept; the one fetched again on 11 November at 12:47 UTC
rebuilt all 12,658 places byte for byte. The answer is saved as it came and the build
reads the saved file, so a build can be re-run on the same snapshot.

**What the script keeps.** The snapshot of 11 November 2026 (OpenStreetMap data of 06:09
UTC) had 21,770 features, 5.9 MB with their bounding boxes. A feature becomes a place
when `category()` gives it one of the 36 categories (the first test that matches wins, so
a hospital that is also a building is a hospital); parking, fuel, pharmacies, car repair,
corner shops, industry and named buildings with no other tag get none. Nor does a bus
depot mapped as a bus station, by a depot's word in its name (Baku Bus Depo, which "baku
bus" listed above the Central Bus Station, and the prison service's motor yard), or an
airfield no passenger flies from, military or abandoned (Qala Aerodromu, the Kala air
base, and a former aero club), which ranked as airports. Nor does a chain's or a
company's depot or warehouse mapped as a mall, a market or a supermarket, by a depot's or
a warehouse's word after another of its own name (Bravo Depo Ambar, Oba Market DEPO,
Gəncə Şərab - DEPO): nine of them. A store named Depo (Depo Univermaq) stays, and so do
the shops, where a warehouse often sells (İlk İnşaat Anbarı, building materials). A works
or a company that mappers tagged `office=government` or `amenity=townhall` is an office
("Ofis"), as every company's office is, not a state body ("Dövlət qurumu"): `works()`
tells it by `industrial=*`, `landuse=industrial`, `man_made=works`, `power=*` or an
industrial building, by a shop tag or another kind of office beside the town hall, or by
a factory's, a mill's or a company's word in its own name (Zavodu, Fabriki, MMC, Ltd,
Şirkəti, Group), unless `government=*` says which government office it is. That is 274
places, from Afsan Plastik Qablar Zavodu, a town hall with a shop tag, to the oil
refinery and the state-owned companies' offices (Azərişıq ASC); people commute to them,
so they stay. Baku Crystal Hall's rarer `amenity=events_centre` counts as an events
venue, as `events_venue` does. A place's name is `name:az`, else `name`. `name`,
`name:ru`, `name:en`, `alt_name`, `old_name`, `short_name`, `official_name` and `brand`,
with their `:az` and `:ru` forms, are searched as its other names, so "Ganjlik Mall" and
"Гянджлик" find Gənclik. 694 features were left out because their name only says what
they are ("Kafe", "Market", "Məscid", "Uşaq bağçası", "Шашлычная", "Qeyri-yaşayış
sahələri", non-residential premises), is a building's number ("Bina 1", "Корпус № 2", "ev
111a") or has no letters, which no list could tell apart; 20 because they are someone's
home or flat, which nobody else travels to (`private_home()`, and the build names each
one): three guest houses named a dacha ("дача друга рашида", a friend's dacha), nine
guest houses and motels named a person's home ("Vahid ev", "Mustafa müəllimin evi",
"Amir's home": the home's word after one or two others, with no lodging's word in any
name and no tag a business has), three lodgings named a flat to let ("Kirayə", "Kirayə
Mənzil İraq"), two named by a flat's number (an office at "…8-mertebe 376-menzil", a
guest house whose Russian name is "28 квартира дом 25") and three residences' fenced
grounds mapped as parks (President's Residence, Residence Bilgah, İqamətgah); and one,
Yaşma Bağları, because its centre is outside the area. A guest house named so with a
website or a phone stays, as do the guest houses named "Qonaq Evi" and "Ev Goradil", the
home's word first. Two features of one category and one name mapped twice, a mall's point
and its outline or a town's point and its boundary, are one place when they lie within
300 m (1 km for parks, beaches and residential complexes, 1.5 km for areas and 5 km for
settlements); the point is kept before the outline and takes the other's names. The 27
metro stations are `metro.json`'s, at its coordinates and with its names, plus the names
of the OpenStreetMap station each one matches (Koroğlu is still found as Məşədi
Əzizbəyov). A way or a relation sits at the centre Overpass gives it, the middle of its
bounding box, to five decimals. The query asks for the bounding boxes too, and the build
names every outline over 2 km across that is not a settlement or an area (12), so that a
person can check its centre is somewhere one can go. The airport's was not: its outline
is 4 by 6 km, and its centre, on the airfield, was 1,027 m from the nearest stop, so the
place people choose for "aeroport" could not be reached. `PLACED_AT` puts it at Terminal
1, its international terminal, 150 m from the stop where the H1 bus starts; the build
stops if either goes missing or the terminal leaves the airport's bounding box. The
airport keeps its own place, under the names people type, and Terminal 1 its own. No
other airport, port or beach without a stop within 600 m is that case: 9 are mapped as
points, and the outlines' whole bounding boxes are over 500 m from a served stop (the
beach clubs of the north shore lie that far below the coast road), save two IDEA public
beaches on the north shore, strips of 820 and 930 m whose bounding boxes come within 340
and 520 m of a stop, with nothing mapped inside them to place them at. Qala Aerodromu, a
military air base with no public entrance, was the other, and is no longer a place.

**Corrections.** What a person decided after reading the data is `CORRECTIONS` in the
script: a feature, a tag, the value as mapped, the value used instead or none, and why;
the tag `*` leaves out the whole feature, and a value as mapped of none adds a tag the
feature does not have. A correction applies only while OpenStreetMap still has that
value, or still has no such tag, and the build stops, naming it, once that changes, so a
vandalism fix cannot stop applying unseen: a person reads the feature as it is now and
updates or removes the entry. It stops the same way for an `ALIASES` or `PLACED_AT`
feature that is gone. The first is an English name a vandal gave Heydar Aliyev's grave in
the Alley of Honour, which the picker showed as the other name that matched "aliyev"; the
grave keeps its own name and its Russian one. Every build also prints each name and other
name with a word from `REVIEW` (insults, profanity, crime and politics, in English,
Azerbaijani and Russian) for a person to read: four on 11 November, none of them
vandalism (the café Mafiya's three names and the anti-corruption directorate's English
name). The review that found the grave's name read all 12,658 places and found no other.
Ten corrections more: the first of a university's numbered buildings, misspelt "Корупс №
1" (the rule above leaves out the other four), and a hall among them, "Зал ручных игр",
mapped as a university; and eight names typed partly in the other alphabet, which neither
keyboard finds: "Araя Market" is Araz Market (я is z in the Russian keyboard layout),
"Leon Palaсу" Leon Palace and "8-сш ль" 8-ci km the same way, and a Latin K, T, D or e
stands in a Russian word. The build names every word in both alphabets, to be corrected
so, and `places.test.ts` fails on one. Six more after a review on 12 November: a test
record, "random market" (its street and house number "random", its postcode 1234, its
phone 789789789), which "random" and "market" listed first as a mall, and five private
gardens and homes mapped as parks or a garden, which no rule tells by their names, each
left without that tag. Six more on reading the rest of what that review named: Zağulba's
government dachas, a closed estate mapped as a park; a joke mapped as a beach, 19 km
from any stop ("my angel, I love you", house number 123); a company's workshop and a
seller of building materials mapped as lodging, which nothing else in their tags gives a
category; and Ələt's new railway depot mapped as a station (the halt named Depo is a
passenger stop, and stays): each left without that tag, and so is a node that maps Baku's
sea terminal as a hotel 32 m from its outline, the port, which takes its names. Two
places that quote the film The Diamond Arm
("Цигель Цигель", "Аптека") are not jokes: they mark where it was filmed in İçərişəhər,
which the Old City's tours visit, and stay. `ALIASES` adds the names people search a
well-known place by that OpenStreetMap does not have, each with where the name is used:
the airport is also "Aeroport", "Hava limanı", "Airport" and "Аэропорт", which in Baku
mean no other (OpenStreetMap names the places around it VIP terminal Aeroport, Şeraton
Aeroport, Aeroport Poliklinikası and ABB Aeroport). Before them "aeroport" listed a
clinic first, and "airport" the Aeroekspress stop in town. The others: "BDU" and "БГУ"
for Bakı Dövlət Universiteti; "ADNSU", "ASOIU" and "Neft Akademiyası", its name until
2015, for the oil university; "Qafqaz Universiteti", whose Xırdalan campus became Bakı
Mühəndislik Universiteti in 2016, and "BMU"; "Alov Qüllələri" and "Пламенные башни" for
Flame Towers; "Heydar Aliyev Center", the centre's own English name, where
OpenStreetMap has "Center of Heydar Aliev"; and "Terminal 2" for the airport's second
terminal, which OpenStreetMap names "Termianl 2", misspelt, so that "terminal 2" found
only Şah Dəniz 2 Terminal. None of them found its place before. The sea terminal's
outline takes "Dəniz Vağzalı" and "Sea Port Baku" from that node, mapped as a hotel. Seven
metro stations' OpenStreetMap nodes have no Russian name, and get the names they go by in
Russian (Гянджлик, 28 Мая, 20 Января, 8 Ноября, Автовокзал, Джафар Джаббарлы, Ходжасан):
"гянджлик" found Gənclik Mall, not the station.

The result, `src/lib/busroute/places.json`, is 1.02 MB: 1,849 shops of the kinds people
travel to (electronics, clothes, furniture, books and the like), 1,558 restaurants and
fast-food places, 1,142 cafés, 1,028 supermarkets, 924 government offices, 718 offices,
634 schools, 468 residential complexes, 407 hotels, 398 hospitals, 388 kindergartens, 388
sights, 256 post offices, 242 banks, 230 clinics, 221 sports venues, 211 cultural centres
and libraries, 207 parks, 199 places of worship, 161 areas, 140 malls, 133 settlements,
123 colleges, 77 universities, 66 embassies, 66 theatres and cinemas, 66 amusement
places, 60 markets, 59 beaches, 58 museums, 53 railway stations, 27 metro stations, 13
bus stations, 10 ports, 6 airport features and 4 squares. `places.test.ts` pins each
count, the snapshot date, the header and the shape.

**ODbL.** `places.json` is a derived database. Its header records the credit, the
licence, the snapshot's timestamp, the day it was read, the query and the SHA-256 of the
answer it was built from; that script and this section are how it is produced, which is
what ODbL 4.6 asks to be offered with it on request. Wherever places are listed the
picker credits "© OpenStreetMap iştirakçıları" under them, the map's attribution says the
same, and the page's FAQ and data notes name OpenStreetMap and the snapshot's date.

**Search** (`places.ts`, `GET /api/avtobus/places?q=…&near=lat,lng`). The file is read on
the server only. The route builds an in-memory index from it once per process, on the
first search, and keeps no failed build, as `getGraph()` does; it answers at most eight
places, so the browser never loads the file. Names fold as the stop search folds them
(`searchText.ts`, shared by both: case, the Azerbaijani letters and dotted İ for a Latin
keyboard, and the Cyrillic ә that 216 AYNA stop names type for ə), and Cyrillic stays,
for the Russian names. An apostrophe joins its word rather than splitting it, so "papa
johns" finds the six Papa John's ("john s" before); no stop name has one. The ranking:
the name itself, then a name starting with the query, then a name whose words start with
the query's words in any order, then looser matches, a query word of four letters or more
inside the name or the category's own name ("gənclik metro"). A metro or railway station,
an airport, a bus station or a mall whose name's words start with the query's counts as
one whose name starts with the query, and the route sends that rank (`HUBS`); a looser
match does not step up, nor a match on the district the mappers add after " / " ("8 km"
for Lotos Ticarət Mərkəzi / 8-ci km). Strictly by match, "nerimanov" listed eight courts,
offices and a park whose names start with Nərimanov, and not the station Nəriman
Nərimanov, whose second word it is, which now comes first. A query that matches nothing
is tried again without its spaces against the names without theirs, so "28mall" and
"parkbulvar" find 28 Mall and Park Bulvar; typos are not looked for. Among equal matches
a match on the shown name comes before one on another name, then the weightier category
(a metro station, airport or mall before a supermarket or a café, and a feature with a
Wikidata entry a little higher), then the better match before that step (Sədərək Ticarət
Mərkəzi before Mini Sədərək), then, given `near`, the nearer place, then the shorter
name. The pickers send the journey's other end as `near`, so of the 91 supermarkets named
"Bravo" the ones near it come first. A query that folds to under two letters finds
nothing. zod refuses an empty query, one over 100 characters and a malformed point or one
outside the area with a 400 before any search. If the index cannot be built the route
answers 200 with no places and `degraded: true`, uncached, and the pickers say place
search is unavailable and keep every stop. The route answers `Cache-Control: no-store`,
so neither a browser nor the edge keeps an answer past a deploy that changes
`places.json`. At first it sent the stop and bus lists' `s-maxage` with
`stale-while-revalidate` and no `max-age`: Cloudflare's cache rule leaves `/api/` out
(`docs/owner-actions.md` §2), but Chrome kept each answer and, after the data changed,
showed it once more while it asked again, for up to a week (the airport at its old point
on the airfield, on 11 November). Every search the pickers send reaches the route, which
answers from memory: over 735 searches, every prefix of 30 names as they are typed, the
median took 0.3 ms and 99 in 100 under 2 ms (2026-11-11, on a laptop), and the pickers
keep each answer while the page is open. Middleware hands the path to its route and
robots.txt keeps `/api/` out of the index (`placesEdge.test.ts`).

**In the pickers** (`usePlaceSearch.ts`, `search.ts`, `Picker.tsx`). The browser asks
as the person types, at most once every 250 ms and the first at once, keeps each answer
while the picker is on the page, shows a query's own answer only for that query, and
meanwhile shows an earlier answer's places that still match what is typed. Stops and places share one list: the
better match first, whichever it is; [Routing from a place](#routing-from-a-place-720)
has how equal matches are ordered and how the list waits for its places. A place has its
own pin and reads, for example, "Ticarət mərkəzi · dayanacağa 84 m: Gənclik m/st": the
other name that found it if that was not the shown one, its category, and the nearest
stop with a name within the 1 km a journey walks, distance first so a phone cuts the
stop's name rather than the distance. A stop reads "Dayanacaq" with its code. The arrow
keys keep the option they chose when places arrive.

**Not searched.** Street addresses and house numbers. On 11 November 2026 OpenStreetMap
had 8,552 features with both a street and a house number in the whole area (an Overpass
count, 11:45 UTC), too few for a city of Baku's size to promise a result, and the planner
has no other address data. The FAQ says so.

**Refreshing.** Move `SNAPSHOT` in the script to a recent minute, then
`python3 scripts/bus/build_places_json.py --fetch places-overpass.json` (one query, 79
seconds on 11 November; keep the answer outside the repository), then
`python3 scripts/bus/build_places_json.py places-overpass.json`. The header's "read" is
the day of the database Overpass answered from. Read the names the build prints for
review, and if it stops on a correction or an added name that no longer applies, look at
the feature in OpenStreetMap and update or remove the entry. `places.test.ts` fails on
its counts and snapshot date, and the page's `PLACES_DATE` must move with the snapshot (a
test compares them): update the counts, this section and the date together. The file is
re-included in `.gitignore`, as metro.json is, and `places.test.ts` fails if it stops
being.

## Routing from a place (#720)

A journey can start or end at a point instead of a stop: a place chosen from the
search, or the person's location. It walks from the point to a stop or metro station
near it, and from one near the destination to the destination, and those walks count
in its minutes and kilometres like any other walk. `findJourney` (`routing.ts`) does it
in the one search that finds a journey between two stops: the point is a node of its
own, with a walk to each stop and station near it as its edges (`accessWalks`,
`access.ts`), and the destination is a node that the stops near it walk to. The search
therefore starts from all the stops near the origin at once, each at its walk's cost,
and ends at whichever stop near the destination gives the cheapest journey, chosen by
the rule in [Ranking](#ranking) with the walks in it; it is not one search per pair of
stops. A walk to a station is measured to its nearest exit and drawn by it (stop,
exit, station), as `metro.ts` does for a stop. A walk still never follows another: the
walk from the place cannot go on to another stop on foot, and the walk to the
destination cannot follow a walk between stops. The points are nodes -1 and -2, and
their states (`walkedTo`, `startAt`) are negative numbers that are not multiples of 4,
apart from every stop's and every ride's. Between two stops nothing changed:
`findJourney` hands them to `findRoute`.

**Which stops.** Every stop and station within `ACCESS_RADIUS_KM`, 1 km in a straight
line (about 17 minutes on its streets), that a ride leaves from (at the origin) or
reaches (at the destination), the nearest first, at most `ACCESS_STOP_LIMIT`, 64. A stop
no bus serves is never one; the snapshot's 385 such stops have no name either. The
location button and, before this, a place used the nearest stop within 600 m, and the
journey could walk on from it, 400 m more; within 1 km every such start is one walk, so
no journey it could give is lost. Over the 12,590 places of `places.json` (worked out
again after the review of 12 November; of the 12,634 it had when this was first
measured, 483 had none within 1 km):

| Radius | Places with no stop or station that close | Stops at a place: median, 90th pct., most |
| --- | --- | --- |
| 400 m | 1,825 (14.5%) | 5, 10, 20 |
| 600 m | 1,139 (9.0%) | 9, 19, 33 |
| 800 m | 708 (5.6%) | 15, 32, 50 |
| **1 km** | **478 (3.8%)** | **22, 46, 63** |

On 1,000 random pairs of the 12,634 places `places.json` had before that review (not
measured again since), against standing each place for its nearest stop within 600 m
among all 3,841 stops of the stop list, as the page did, with the walks to those stops
added to that journey's minutes:

| Radius | Journeys | Cost saved, median and mean | Costlier than the nearest stop | Walking per journey, median |
| --- | --- | --- | --- | --- |
| nearest stop | 810 | | | 0.58 km |
| 600 m | 815 | 1.7, 4.7 min | 12, by up to 21.1 min | 0.60 km |
| 800 m | 887 | 2.7, 6.0 min | none | 0.66 km |
| **1 km** | **912** | **3.3, 6.7 min** | **none** | **0.69 km** |
| 1.2 km | 926 | 3.6, 7.0 min | none | 0.71 km |

Cost is minutes plus 15 a boarding, the walks included and timed on their streets. At
1 km, of the 810 pairs both answer, 323 journeys need fewer boardings, 8 one more and
479 as many: 1,691 boardings instead of 2,037. The minutes alone stay about as they
were (0.5 fewer at the median, 0.3 on average): with as many boardings they fall by 1.1
at the median, and with fewer they rise by 3.6, which the boardings saved pay for. 485
of the 782 journeys that ride in both board or alight at another stop than the
nearest, and 657 of the 810 nearest-stop journeys walked on from that stop to another
one first or last. 102 of the 190 pairs the nearest stop could not serve get a journey;
72 still have a place with no stop within 1 km and too far to walk, and 16 cannot be
reached. The walks are longer, as the rule lets them be: 277 m at the median for a walk
to or from a place and 761 m at the 90th percentile, and 304 of the 883 journeys that
ride walk more than 600 m at one end; 177 start or end their rides at a metro station.
Among only the 3,456 served stops the nearest-stop rule answers 815 pairs with 2,055
boardings, and the cost saved is the same, 3.4 and 6.7 minutes. A smaller cap only cost
journeys and the search took as long either way: 8 stops saved 4.3 minutes on average
and left 26 journeys costlier than the nearest stop's, 12 saved 5.3 (7 costlier), 20
saved 6.2, 30 saved 6.6, and 64 6.7. No place has more than 63 stops within 1 km; any
other point in the area has at most 65, and only a few (4 of 53,360 points on a grid
over the network), so the limit, set above the places' 63, bounds a request's work
should the stops or the radius grow and loses almost nothing.

**Walking the whole way.** The walk from one end to the other boards nothing, so it
wins a tie with every journey that rides. Up to `MAX_WALK_INSTEAD_MIN`, 30 minutes on
its streets (about 1.7 km in a straight line), it is the answer when it costs no more
than the cheapest journey that rides; up to `MAX_WALK_ONLY_KM`, 2 km in a straight line,
it is the answer when nothing rides there, or when the cheapest journey that rides takes
as long or longer even before its waits. A walk of 15 minutes or less (865 m) costs
no more than any journey that rides, so it needs no search, and a longer one bounds the
search: it stops once nothing left can be cheaper. On random place pairs, 60 in each
band of straight-line distance, the walk was the cheaper in 56 of those from 1.1 to 1.5
km and was the answer in all 56; from 1.5 to 2 km it was the cheaper in 43 and the
answer in 27, the other 16 taking more than 30 minutes against a faster ride; it was
still the cheaper in 22 pairs from 2 to 2.5 km, 11 from 2.5 to 3 km and 5 beyond, and
offered in none. Without the limits, with walks timed on their straight line, it won as
walks of 41 to 63 minutes, mostly over journeys with two boardings: 15 minutes a
boarding is an allowance for the wait, not a measured one, and too rough to send
someone on a long walk instead, so past 30 minutes a journey that rides is the answer
whatever its boardings cost, if it is faster, and beyond 2 km whatever it takes. Past
30 minutes any journey that rides had won at first: from 40.59678, 49.66272 to
40.57931, 49.66120, three buses in 102 minutes against a walk of 34. Of 300 random
place pairs whose walk takes 30 to 35 minutes (1.73 to 2 km), 294 have a journey that
rides, and 6 of those take as long as the walk or longer, by 1 to 72 minutes, before
any wait; the walk is the answer for those 6 and for none of the other 288. A point
with no stop within 1 km and too far to walk gets an error naming it.

**Cost.** Finding a point's stops scans the served stops once, 26 to 39 µs; which stops
a ride serves is worked out once per graph. Timed seven times each, on a busy laptop,
200 random place pairs took 7.6 ms at the median and 19.0 at the 95th percentile, about
as long as the journey between the nearest stops (7.5 and 19.5); 60 pairs of places in
the centre, with 45 or more stops at each end, took 3.8 and 8.8 against 4.0 and 9.2.

**On the page.** A chosen place or the location is sent as its point (`from`/`to`, see
[API and UI](#api-and-ui)), and the notes that the walk to its stop was not counted are
gone. The step list starts or ends with the walk, the place marked with a pin and its
length in kilometres from 1 km. The map marks a place with a pin in its end's colour
and the location with a blue dot, each labelled as a chosen stop is, draws the walks
dashed like every walk, and frames the places themselves, with room above for their
labels. A map tap fills the start, and keeps filling it while a destination, a stop or
a place, is chosen.

In the pickers a place names the nearest stop with a name within 1 km
(`placeStopNear`), and a place with none is listed last and says so; choosing it is not
refused, as the walk the whole way may be the answer. Among equal matches a station, an
airport, a bus station or a mall comes first (`HUB_PLACES`), then a stop, then another
place, then a café, restaurant, shop, school or one of the other eleven everyday kinds
(`EVERYDAY_PLACES`), which also ranks one step below its match: typing "gənclik" had
listed two cafés above Gənclik m/st. Rows a picker has shown never move, since a tap may
be on its way to one; the places answer a moment after the stops, so when nothing stands
in for them the list waits, says "Axtarılır…", and lists the stops and places together
once they come, or at most 550 ms after the keystroke that began the wait (`HOLD_MS`). It
waits once a burst of typing: restarted at every keystroke, it kept the list empty while
anyone typed a key within 550 ms of the last, and the stops never showed. The places are
asked for while typing, at most every 250 ms, and until a query's own answer comes the
places of an earlier one that still match stand in, ranked for it as the search ranks
them (`placeRank`, with the search's own rules from `placeMatch.ts`): the answer for the
longest query the typed one starts with, or, when a letter is taken back, for the
shortest that starts with it. Asked only once typing paused, the places for what was
typed last came after its stops were listed, and went below them. Places that come
after the list is shown go below it, and an answer that comes after its query changed
only ever stands in.
"gənclik", "koroglu", "nerimanov" and "avtovağzal" each list their metro station first.
The places search ranks by the journey's other end, sent in its address, which logs
and error reports keep; the person's location goes there only to two decimals, about
1 km (`coarsePoint`). A location known only to more than 1 km is not used, and the next
try asks the GPS for a fresh fix: asked again for a quick one, up to a minute old, the
browser gave the same rough fix back.

**How it was measured.** On a scratch PostgreSQL loaded as for the #721 verification
below (route_efficiency's `data/ayna.db`: 3,841 stops, 3,456 of them served, 208 buses
and 11,786 stop rows) and its buses' route lines (109,147 points), through the real
`graph.ts`, with the `places.json` of 11 November 2026 before a games hall left it
(12,634 places). Every place-pair number in this section is of those places: the review
of 12 November, which left out 43 places and made 274 others offices,
was not followed by a new run. The table of stops near a place was worked out again
for the 12,590 from the same stops (that database's tables as CSV, and `metro.json`),
served as `access.ts` serves them; for the 12,634 it gives the first table's numbers
exactly. The numbers come out as here only with the route lines loaded: #721's
`measuredLength` reads them to tell a misplaced stop, which changes some rides' times.
The harness is a vitest file outside the repository: it builds the graph
with `getGraph()`, draws place pairs with the tests' linear congruential generator from
seed 720, answers each with `findJourney` and with `findRoute` between the places'
nearest stops, and tallies them; nothing else is needed to repeat it. The page was
checked in headless Chrome at 390 × 844 and 1440 × 1000 against `next dev` on that
database: place to place, the location to a place, the walk the whole way, the four
queries above, the place search's `near=` for the location (two decimals), and two map
taps after choosing a destination place, which changed the start both times; no console
error and no sideways scrolling. At 390 × 844 on 12 November: Kids Akademi to Azərsun
Holdinq Anbarı in Sumqayıt (a warehouse, left out since) is the walk, 34 minutes, over
two buses taking 106; the location refused at ±1.5 km is asked for again with high
accuracy and no cached fix, and used at ±30 m; and "gənclik mall" typed a key every 120
ms, with every request 300 ms slower as on a phone network, says "Axtarılır…" for its
second and third letters only, then lists the stops and places at every key, Gənclik the
station first for "gənclik".

## API and UI

`POST /api/avtobus/find` accepts, for each end, a positive PostgreSQL integer ID
(`fromStopId`, `toStopId`) or a point (`from`, `to`: `{latitude, longitude, name?}`,
#720), exactly one of the two. A point must lie in the network's area
(`isBakuCoordinate`); its name, at most 200 characters, only goes back as text, and a
point without one is "Başlanğıc nöqtəsi" or "Təyinat nöqtəsi". Invalid JSON, invalid
IDs or points, an end given both ways or neither, and identical stops or points return
400 before loading the graph. Unknown stops or an unreachable destination return 404,
and so does a point with no stop within 1 km and too far to walk, with an error that
names it; initialization failures return 500 with a retryable error message. Error
bodies keep the string shape consumed by the client. A successful response includes
origin/destination metadata (`{id, name}` for a stop, `{name, latitude, longitude}`
for a point), a single `RouteResult` and the racks beside it, `bikeParking` (#692).
Every segment has its `mode`; bus segments include their direction and terminal name,
and metro segments their line and terminus. A walk from or to a point is a `walk`
segment whose first or last stop is the point, with id -1 (`ORIGIN_POINT_ID`) or -2
(`DESTINATION_POINT_ID`), its name and coordinates, and the totals include it, so a
client that reads only `route.segments` and the totals shows it as any walk.

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
The start and destination pickers list named places among the stops;
[Places](#places-720) has how they are searched, and [Routing from a
place](#routing-from-a-place-720) what choosing one does.

Empty-map taps choose a stop only within 600 m. That selection radius is separate
from the routing graph's 400 m walking-transfer limit. The location button
("Olduğum yerdən başla") makes the person's location the start itself, shown as
"Sizin yeriniz" with its accuracy, and the journey walks from it (#720). A location
outside the network's area is refused in the browser, as the server refuses it, and so
is one known only to more than 1 km, a Wi-Fi or network position, with a note that
says how sure it was. A location callback is invalidated by later selections or a mode
change, so delayed GPS cannot replace a newer origin.

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

Tests cover the boarding penalty below, at and above its threshold, tie-breaks,
origin and interchange walks, the walking limit, directions, loops, unreachable
stops, the length-shared leg times with a missing or a misplaced stop, a ride past a
misplaced stop and how its journey lists and draws it, a graph that hands back
copies of its edges, initialization concurrency/retry and API
input/error handling. An independent round-by-boardings oracle checks 900 trips over
generated small networks, choosing the round with the lowest minutes plus
penalties. The spatial grid is checked against exhaustive haversine pairs, at Baku's
latitude and at the network's northern edge, and its cell sizes against the
shortest degrees in the network's area.

`routingOracle.test.ts` adds 900 generated trips checked against a separate
boarding-round cost oracle. It expands complete contiguous ride stretches in each
round and allows one walk between rounds, rather than reproducing the production
edge/state Dijkstra, and then chooses among the rounds by cost. Its mixed bus/metro
networks include loops, origin walks, interchanges and destination walks. It checks
every ranking objective, transfer counts, segment continuity and the absence of
consecutive walking segments. Both oracles assert that more than ten of their trips
take more boardings than the fewest, so the penalty is exercised and not only the
boarding count.

Journeys from and to a point (#720) have their own tests (`journey.test.ts`): the stop
boarded is not the nearest when another is cheaper overall, walks to a stop beyond a
transfer walk's 400 m, no walk after the walk from the point or before the walk to it,
a station by its exit, a stop at one end and a point at the other, the walk timed on
its streets, the walk the whole way below, at and above the cost of riding (an exact
tie goes to the walk), both of its limits and the radius at their boundaries, and which
end has no stop in reach. The same round oracle checks 600 generated trips between
points, finding the walks to and from them itself rather than through `accessWalks`;
it asserts that more than 100 of them ride, more than 50 walk the whole way and more
than 10 board at another stop than the nearest. The route handler is tested for points,
a stop and a point, names, the area and identical points. The planner's own state is
tested with its pickers and map as stand-ins (`Component.test.ts`): the find request
for places, stops and the location, map taps after a destination place, the location's
point in the place search's address, and a location known only to a kilometre and a
half. The pickers are tested for rows that keep their places when the places arrive, a
query told to the owner in the same update, the chosen end's description, and an empty
list while a new query's places are held for; the lists for "gənclik", "koroglu",
"nerimanov" and "avtovağzal" with the real places, the ranks of places carried over,
the same ranks as the search's over every prefix of twenty names people type, the
nearest named stop a place's row names, and the point to two decimals are tested in
`search.test.ts`. `usePlaceSearch.test.ts` types at a key every 120 ms: at most one
request every 250 ms, the list held once from the first keystroke, the places that came
while typing standing in for later queries and for a shorter one, and a late answer
that never becomes a newer query's own. A location sure to exactly 1 km is used, and
after a rough one the next try asks for a fresh fix.

## Verification for #721 (2026-11-11)

The owner's request was `{fromStopId: 1343, toStopId: 3642}`: Azərbaycan Hava
Yolları QSC in central Baku to Nizami Gəncəvi adına uşaq kitabxanası in Sumqayıt,
24.8 km apart. Only 503, in its second direction, stops within 400 m of the
library, so every journey ends on it; the question is where to board it.

- **Before:** walk 261 m, 61 for 19 stops, 525 for 7 stops to Xırdalan
  Qəbirstanlığı, then 503 for 28 stops: three boardings, 94.6 minutes as then
  estimated. The 300 m walk ruled out the 28 May hub 355 m away, and equal time
  shares made 525 twice as fast as its line, so the journey caught 503 at Xırdalan.
- **Times shared by length alone:** 61, a walk to 8 Noyabr, the purple line to
  Avtovağzal, a walk, then 503 from Avtovağzal m/st: three boardings, 104.4 minutes.
- **After (400 m walks as well):** walk 379 m to 28 May m/st (stop 1711), bus 2 for
  16 stops to Biləcəri dairəsi, walk 248 m to Avtovağzal m/st, then 503 for 35
  stops: two boardings, 112.8 minutes. Timed the same way, the old journey takes
  109.7 minutes, so the new one costs 142.8 against its 154.7. The cost rule does
  not change this answer; the fewest boardings are also the cheapest here.

No defect was found in the search itself. On 196 routable random pairs the old
search returned exactly the fewest-boardings journey that an independent search
over boardings and minutes found: its state keys, ride continuation, stale-entry
skipping and early return are sound. The wrong journey came from the model: the
walk limit, the equal shares and the rule.

**Measured on 200 random pairs** (seed 721; 196 routable before and after), each
change on top of the ones listed before it, so a count depends on that order. Times
shared by length include the rule for a misplaced stop
([Graph and data](#graph-and-data)), which moves 4 of these answers.

- times shared by length: 116 answers change, none in its number of boardings;
- 400 m walks, on top of those times: 44 change, 20 of them to fewer boardings (19
  by one, one by two);
- the cost rule, on top of both: 46 change, all to more boardings (44 by one, 2 by
  two), each saving at least 15.4 minutes and 19.7 at the median.

All together 146 of 196 answers change. Timing old and new journeys alike, by
length: 14 need fewer boardings (13 one fewer, one two fewer; 235 m more walking at
the median), 92 keep their count and save 3.1 minutes at the median (6.1 on
average), and 40 add boardings and save 26.4 minutes at the median (31.5 on
average, never under 15). Boardings over the 196 trips go from 522 to 549 and
average walking from 266 to 283 m. The time shown rises by 3.1 minutes at the
median: equal shares had let the search find legs faster than their line.

**Search cost**, old and new in one run on those pairs (the old search on the old
model): 7.0 ms at the median instead of 13.8, and 13.4 ms at the 95th percentile
instead of 29.3; another run gave 7.9 and 15.1 against 13.8 and 31.4. Labels
settled went from 6,240 to 7,217 at the median and from 14,102 to 14,373 at the
95th percentile, with 16,590 walking edges instead of 10,264; 1343 → 3642 settles
13,532 instead of 12,657. The time went to string keys (see [Ranking](#ranking));
keyed by edge, the new search returned the same journey as with strings for all
200 pairs. Keyed by number, as now, it returns the same response as keyed by edge
for all 200 and for the review's 1,500 pairs (seed 20261111), at the same speed:
6.6 ms at the median and 13.1 at the 95th percentile on those 1,500, against 6.6
and 13.3 in the same run. Through a graph that hands back copies of its edges it
settles the same labels and returns the same journeys.

**How.** A scratch PostgreSQL was loaded from route_efficiency's `data/ayna.db`
(the same 3,456 served stops, 208 buses and 11,786 stop rows as production, stop
order from its `seq`) and read by the real `graph.ts` through Prisma. Running the
old search on the new graph, with equal shares restored and walks over 300 m left
out, reproduced all 200 old answers. The harness and the database stay outside the
repository; nothing was read from or written to production.

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
