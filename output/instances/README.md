# Baku instances of the urban transit routing problem

Five instances cut from the bus network of Baku, Azerbaijan, in the format of the benchmark
networks of Mumford (2013), so that methods written for Mandl's and Mumford's networks can
run on a real city's. Christine Mumford suggested making them (personal communication,
October 2026).

They come from AYNA's map of the network as scraped on 23 October 2026: 3,456 served
stops on 201 routes. Baku0 to Baku3 are circles round the city centre, the 28 May metro station,
each as wide as gives the number of nodes nearest that of Mumford0 to Mumford3; BakuFull is
the whole network. They were made by `instances.py` in
[github.com/ismatsamadov/line](https://github.com/ismatsamadov/line),
which explains them in `docs/instances.md`.

**Only the positions are measured.** The minutes along the links come from distances along
the routes' paths at the speeds the travel model assumes, and the trips from a gravity
model. Baku has no origin-destination data; the model's only check is that it ranks the
56 counted BakuBus routes by their boardings with a rank correlation of
0.58 against the counts. Treat the instances as a realistic network with modelled
times and demand, not as measurements of Baku.

## The instances and their rules

| Instance | Circle round the centre | Nodes | Links | Trips | Routes | Nodes on a route |
|---|---|---|---|---|---|---|
| Baku0 | 2.8 km | 30 | 56 | 2,840,762 | 27 | 2–9 |
| Baku1 | 4.5 km | 70 | 127 | 5,657,404 | 50 | 2–16 |
| Baku2 | 6.1 km | 111 | 198 | 7,887,866 | 59 | 2–21 |
| Baku3 | 6.9 km | 125 | 220 | 8,489,320 | 63 | 2–22 |
| BakuFull | the whole network | 680 | 1,068 | 21,498,080 | 196 | 2–34 |

The rules are Mumford's: exactly the number of routes given; every route a path along the
links that visits no node twice, with between the fewest and the most nodes given; every
node on some route; and every node reachable from every other. As in her files, the
number of routes and the bounds are not in the files; they are here and in `summary.json`.
They come from today's routes (below), so that today's network keeps them: the number of
routes is today's, the most nodes on a route is today's longest, and the fewest is
2, since a circle cuts routes at its edge and leaves short stubs.

## Today's routes, scored

`<Name>Routes.txt` holds today's routes, each made into one path. Scored as the literature
scores Mumford's networks (every route runs both ways, each trip takes its quickest path,
every change of route costs 5 minutes, and of equally quick paths the one with fewer
changes counts), they give, in minutes and % of trips:

| Instance | ATT | d0 | d1 | d2 | dun | Route time |
|---|---|---|---|---|---|---|
| Baku0 | 10.7661 | 67.94 | 30.28 | 1.78 | 0.00 | 420 |
| Baku1 | 15.9356 | 58.28 | 36.54 | 4.88 | 0.30 | 1,181 |
| Baku2 | 18.6832 | 53.17 | 39.80 | 6.51 | 0.52 | 1,806 |
| Baku3 | 19.7930 | 50.27 | 41.46 | 7.52 | 0.75 | 1,976 |
| BakuFull | 34.8690 | 31.71 | 43.59 | 19.24 | 5.47 | 9,284 |

ATT is the average travel time of all trips, d0 to d2 the shares of trips with 0, 1 or 2
changes, dun the share with more, and route time the minutes to drive every route once
one way. The repository's straightening search, which replaces a stretch of a route by
the quickest path between its ends when that lowers ATT (`docs/benchmark.md` there), gives:

| Instance | Changes, one pass | ATT | Route time | Changes, passes repeated | ATT | Route time |
|---|---|---|---|---|---|---|
| Baku0 | 10 | 10.7661 → 10.1102 | 420 → 390 | 13 | 10.0586 | 382 |
| Baku1 | 22 | 15.9356 → 14.7310 | 1,181 → 1,091 | 34 | 14.4857 | 1,040 |
| Baku2 | 23 | 18.6832 → 17.3771 | 1,806 → 1,683 | 47 | 16.9123 | 1,594 |
| Baku3 | 26 | 19.7930 → 18.3972 | 1,976 → 1,828 | 51 | 17.8796 | 1,741 |
| BakuFull | 30 | 34.8690 → 33.7601 | 9,284 → 8,961 | 50 | 33.2328 | 8,827 |

## Files

For each instance `<Name>`, in the layout of Mumford's files, every value a whole number
right-aligned in six characters:

| File | Contents |
|---|---|
| `<Name>Coords.txt` | The number of nodes n on the first line, then one line `x y` per node: whole metres east and north of 39.9° N, 49.4° E |
| `<Name>TravelTimes.txt` | n lines of n values: the minutes along the link between two nodes, `Inf` where there is no link, 0 on the diagonal. Symmetric |
| `<Name>Demand.txt` | n lines of n values: the trips between two nodes, 0 on the diagonal. Symmetric |
| `<Name>Routes.txt` | Today's routes, one per line, as node numbers from 1 |
| `<Name>Nodes.csv` | One row per node: `node` (from 1, the line of the node in the files), `cluster` (the same node in every instance, numbered among all 710 clusters), `x`, `y`, `lat`, `lon`, `name` (the stop that started the cluster), `stops` and `stop_ids` (AYNA's stop ids), `people` and `pull` (below) |

Node 1 is the node nearest the centre, and the others follow by distance from it.
`routes.csv` gives, for each route of each instance, its nodes, its minutes one way and the
numbers of AYNA's routes it stands for. `summary.json` holds the same figures as this file,
with more detail.

## How they are cut

Nodes are served stops merged into clusters. Taking the stops in order of the routes that
serve them, most first, each stop not yet in a cluster starts one and takes every stop
not yet in one within 600 m of it, so that both sides of a street and the stops round a
junction become one node. That gives 710 clusters, with the whole network's two
matrices together about 5.6 MB. A node's position is the mean of its stops'.

A link joins two nodes that some route serves one after the other. A bus reaches each stop
at the travel model's time: the distance along the route's path at the cruise speed of
its kind of service (22 to 40 km/h) plus 20 seconds at every stop.
A node served at several stops in a row is reached at the mean of their times. Each pass
of a route over a link is one observation, and the link takes the median of all of them,
both directions together, rounded to the nearest whole minute and at least 1.

A route becomes one path: each direction is cut to its runs inside the circle, each run
gives the path left when its loops are erased and the stretches left when it is cut
where it comes back to a node, and the longest of all of these over both directions is
the route. A path that another route's path runs along is dropped, since under the
scoring it adds nothing. The instance's nodes are those on the largest group of paths
that share nodes, so a node no path reaches is left out (30 of the
710 clusters, with 37,285 people, in BakuFull).

## The demand

Each node's `people` are those living closer to one of its stops than to any other stop,
within 500 m (Kontur's population grid of November 2023, each hexagon
spread over seven points), and its `pull` is the same people's pull on trip ends, half
their number and half the destinations near them: OpenStreetMap's schools, hospitals,
shops, offices and stations, and the metro stations by their passengers. The people of
node a make trips to every node b in proportion to b's pull × exp(−d / 6 km), with d the
straight line between the two in `<Name>Coords.txt`, over every node of the instance,
a included; trips within a node are left out. With T(a, b) those trips, the file holds

    round(10 × (T(a, b) + T(b, a)) / 2)

so the matrix can be computed again from `<Name>Coords.txt` and the `people` and `pull`
of `<Name>Nodes.csv`. The mean of the two directions makes it symmetric, as Mumford's
are, without changing a score, since every route runs both ways. The trips are counted
10 times over so that rounding loses little; the average travel time and the shares by
number of changes do not depend on the scale.

## Terms

The instances are derived from AYNA's map data, which AYNA publishes with no licence and
which the repository redistributes as a research snapshot with attribution to AYNA; from
Kontur's population grid (CC BY); from OpenStreetMap (© OpenStreetMap contributors,
ODbL); and from Bakı Metropoliteni's metro entries and exits (CC BY) on opendata.az. They carry
those terms, as the repository's other results do, and what the repository adds to them
is under CC BY-NC 4.0. The code that cuts them is under the PolyForm Noncommercial
License 1.0.0. Neither allows commercial use without the author's written permission
(ismetsemedov@gmail.com).

## References

- Mumford, C. L. (2013). New heuristic and evolutionary operators for the multi-objective
  urban transit routing problem. 2013 IEEE Congress on Evolutionary Computation, 939–946.
  https://doi.org/10.1109/CEC.2013.6557668
