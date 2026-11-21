# Baku in the benchmark's format

The benchmark test ([benchmark.md](benchmark.md)) ran my search on the networks the
literature uses, where the answers are known. This page runs the test the other way. The
methods that beat straightening there were written for Mandl's and Mumford's small
networks, and none of them has been run on Baku. So I cut the Baku network into instances
of the same problem, in the format of Mumford's (2013) files, for anyone with such a
method to run it on a real city's network without my travel model. Christine Mumford
suggested them in October 2026. `python3 instances.py` writes them to `output/instances/`
in about four minutes ([outputs.md](outputs.md#outputinstances--baku-in-the-benchmarks-format)),
and the folder's own `README.md` explains them to people who download it without this
repository.

## Five instances

Baku0 to Baku3 are circles round the city centre, the 28 May metro station, each as wide
as gives the number of nodes nearest that of Mumford0 to Mumford3 (30, 70, 110 and 127).
The radii go up in steps of 100 m, so Baku2 comes out one node over and Baku3 two under.
BakuFull is the whole network.

| Instance | Circle | Nodes | Links | Routes | Nodes on a route | Mumford's network of that size |
|---|---|---|---|---|---|---|
| Baku0 | 2.8 km | 30 | 56 | 27 | 2–9 | Mumford0: 30 nodes, 90 links, 12 routes of 2–15 nodes |
| Baku1 | 4.5 km | 70 | 127 | 50 | 2–16 | Mumford1: 70, 210, 15 of 10–30 |
| Baku2 | 6.1 km | 111 | 198 | 59 | 2–21 | Mumford2: 110, 385, 56 of 10–22 |
| Baku3 | 6.9 km | 125 | 220 | 63 | 2–22 | Mumford3: 127, 425, 60 of 12–25 |
| BakuFull | the whole network | 680 | 1,068 | 196 | 2–34 | |

Two things set them apart from Mumford's networks. They are half as connected: a node has
3.1 to 3.7 links on average where hers have 6 to 7, because a link here is a stretch of
street that a bus drives between neighbouring nodes. And near the centre the routes are
many and short: Baku0 has 27 routes on 30 nodes, because 41 of today's routes cross its
circle and it keeps only their middle stretches.

## How the network becomes an instance

The nodes are Baku's 3,456 served stops merged into clusters, so that both sides of a
street and the stops round a junction become one node. Taking the stops in order of the
number of routes serving them, most first, each stop not yet in a cluster starts one and
takes every stop not yet in one within 600 m of it. That gives 710 clusters, each placed
at the mean position of its stops.

A link joins two nodes that some route serves one after the other, and its minutes come
from the travel model ([methodology.md](methodology.md)): the distance along the route's
path at the cruise speed of its kind of service, plus 20 seconds at every stop. Each pass
of a route over a link is one observation, and the link takes the median of all of them,
both directions together, in whole minutes and at least 1, since Mumford's files hold
whole minutes.

Each of today's routes becomes one path that visits no node twice, as the format needs.
Each direction is cut to its stretches inside the circle; I erase the loops of each
stretch and also cut it where it comes back to a node, and the longest path any of this
gives, over both directions, is the route. A path that another route's path runs along is
dropped, since under the benchmark's scoring it adds nothing, and the route is credited
to the one it runs along; `routes.csv` says which of AYNA's routes each path stands for.
The instance's nodes are those on the largest group of paths that share nodes, which
leaves out one to five clusters in each circle and 30 of the 710 in BakuFull.

The rules come from today's routes, so that today's network keeps them: the number of
routes is today's, the most nodes on a route is today's longest, and the fewest is 2,
because the circle cuts routes at its edge and leaves short stubs. As in Mumford's files,
the rules are not in the instance files; they are in the folder's `README.md` and
`summary.json`. Anyone who wants tighter bounds can set them, at the price of today's
routes no longer keeping them.

## The demand

The trips between nodes come from the travel model's gravity model, the one behind every
Baku result here. A node's people are those who live nearer to one of its stops than to
any other stop, within 500 m (Kontur's population grid); its pull is half their number and
half the destinations near them (OpenStreetMap's schools, hospitals, shops, offices and
stations, and the metro stations by their passengers). The people of each node make trips
to every node in proportion to its pull times exp(−d / 6 km), with d the straight line
between the two. The files hold the mean of the two directions, so the matrices are
symmetric like Mumford's, counted ten times over so that rounding loses little;
`<Name>Nodes.csv` publishes each node's people and pull, so the matrix can be computed
again from the files alone, and a test does that.

## Today's routes, scored and straightened

Scored as the literature scores Mumford's networks (every route runs both ways, each trip
takes its quickest path, every change of route costs 5 minutes), today's routes give
these average travel times (ATT, in minutes), shares of trips by number of changes (%),
and route times (minutes to drive every route once one way). The last two columns are
what the redesign's straightening does to them, run as in the benchmark test, first one
pass and then with the passes repeated until one keeps nothing:

| Instance | ATT | No change | One | Two | More | Route time | One pass: ATT, route time | Passes repeated |
|---|---|---|---|---|---|---|---|---|
| Baku0 | 10.77 | 67.94 | 30.28 | 1.78 | 0.00 | 420 | 10.11, 390 (10 changes) | 10.06, 382 (13) |
| Baku1 | 15.94 | 58.28 | 36.54 | 4.88 | 0.30 | 1,181 | 14.73, 1,091 (22) | 14.49, 1,040 (34) |
| Baku2 | 18.68 | 53.17 | 39.80 | 6.51 | 0.52 | 1,806 | 17.38, 1,683 (23) | 16.91, 1,594 (47) |
| Baku3 | 19.79 | 50.27 | 41.46 | 7.52 | 0.75 | 1,976 | 18.40, 1,828 (26) | 17.88, 1,741 (51) |
| BakuFull | 34.87 | 31.71 | 43.59 | 19.24 | 5.47 | 9,284 | 33.76, 8,961 (30) | not run |

On the four circles, one pass lowers ATT by 6.1 to 7.6% and route time by 6.8 to 7.6%, and
repeated passes by 6.6 to 9.7% and 9.0 to 11.9%. On Mumford's published route sets the
same search saved a similar share of route time, 6.3 to 13.5%, but only 1.2 to 2.6% of
ATT. So today's Baku routes hold far more stretches whose replacement by a quicker path
helps the trips, but not all of that gain is real. An instance has no one-way streets, no turns and no terminals, and every link runs both
ways, so a stretch that a bus drives because of a one-way street, or to reach its
terminal, looks like a detour. On BakuFull a pass may try only 80 stretches, those that
save the most route time, across 196 routes, so its 3.2% is the cap's as much as the
network's. There I ran one pass only, which takes about three minutes.

These are gains in the benchmark's terms, with no walking, waiting or frequencies. They
are not the redesign's result for Baku, which is measured door to door in the travel
model ([results.md](results.md)).

## What is measured and what is modelled

Only the positions are measured: they are AYNA's stops. The link times rest on the
travel model's speeds, not on timetables or GPS. A link's minutes are a median over the
routes that serve it, rounded to the whole minute, and part of a route direction's time
within its first and last node drops out; together, the minutes along all of today's route
directions add up to 19,274 on the links against 20,153 in the travel model, 4.4% less.
The demand rests on a model whose only check is that it ranks the 56 counted BakuBus
routes by their boardings with a rank correlation of 0.58 against the counts; Baku has no
origin-destination data. So the instances are a real city's network with modelled times
and demand, which is what the benchmark needs, and not a measurement of how Baku travels.
The folder's `README.md` says the same to anyone who finds the files alone.

## Using them

The files read as Mumford's do: `busnet.utrp.read_instance(folder, name, routes,
min_nodes, max_nodes)` reads one with the rules from `summary.json`, and any reader of
her files reads the matrices and coordinates. Node 1 is the node nearest the centre, and
the others follow by distance from it. `<Name>Nodes.csv` ties every node to AYNA's stop
ids, and its `cluster` column numbers the node among all 710 clusters, so the same place
has the same number in every instance. `tests/test_instances.py` checks the pieces
that cut the instances on made-up data, reads the committed files back, checks that
today's routes keep the rules and score as `summary.json` says, and computes the demand
again from the published nodes; with `BUSNET_SLOW_TESTS=1` it cuts them again and
compares them with the committed folder.

The instances keep the terms of their sources: AYNA's map data, which AYNA publishes with
no licence and this repository redistributes as a research snapshot with attribution;
Kontur's population grid (CC BY); OpenStreetMap (ODbL); and Bakı Metropoliteni's metro
entries and exits (CC BY) on opendata.az ([data.md](data.md)). The code that cuts them is
under the MIT licence.

## References

- Mandl, C. E. (1980). Evaluation and optimization of urban public transportation
  networks. European Journal of Operational Research 5(6): 396–404
  ([doi](https://doi.org/10.1016/0377-2217(80)90126-5)).
- Mumford, C. L. (2013). New heuristic and evolutionary operators for the multi-objective
  urban transit routing problem. 2013 IEEE Congress on Evolutionary Computation, 939–946
  ([doi](https://doi.org/10.1109/CEC.2013.6557668)).
