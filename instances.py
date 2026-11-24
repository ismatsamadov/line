#!/usr/bin/env python3
"""
Cut instances of the urban transit routing problem from the Baku network, in the format
of Mumford's (2013) benchmark networks, so that methods written for her networks can run
on a real city's. Christine Mumford suggested them.

Four instances are circles round the city centre, the 28 May metro station, each as wide
as gives the number of nodes nearest that of Mumford0 to Mumford3 (30, 70, 110 and 127),
and the fifth is the whole network. Nodes are served stops merged into clusters, links
the pairs of clusters routes serve one after the other, and the rules for routes come
from today's routes, each made into one path (busnet/instances.py). Link times and trips
are modelled, not measured.

Writes to ./output/instances/ (or --out), for each of Baku0 to Baku3 and BakuFull:
  <Name>Coords.txt        the number of nodes, then x and y of each node in metres
  <Name>TravelTimes.txt   minutes along each link, Inf where there is no link
  <Name>Demand.txt        trips between every pair of nodes
  <Name>Routes.txt        today's routes, one per line, nodes numbered from 1
  <Name>Nodes.csv         each node: position, the stops merged into it, people and pull
and for all five:
  routes.csv              which of today's routes each route of an instance stands for
  summary.json            each instance's rules and size, today's scores, what the redesign's
                          straightening does to today's routes, and how the instances were cut
  README.md               the instances explained for the researchers who use them

Standard library only, about twelve minutes. Usage:
  python3 instances.py
"""

import argparse
import csv
import json
import math
import statistics
import sys
import time
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from busnet import utrp                                                        # noqa: E402
from busnet.config import settings_file                                        # noqa: E402
from busnet.inputs import load_inputs                                          # noqa: E402
from busnet.instances import (cluster_stops, gravity, half_up, metres,         # noqa: E402
                              network_links, node_people, positions, todays_routes)
from busnet.metrics import _route_key                                          # noqa: E402
from busnet.service import run_time_s                                          # noqa: E402
from busnet.tables import write_csv                                            # noqa: E402

CLUSTER_M = 600                         # stops within this of the stop that starts a cluster join it
CENTRE = ("the 28 May metro station", 40.379862, 49.848636)      # as data/metro/stations.csv places it
ORIGIN = (39.9, 49.4)                   # coordinates are metres east and north of this point (lat, lon)
SIZES = {"Baku0": 30, "Baku1": 70, "Baku2": 110, "Baku3": 127}    # nodes, as Mumford0 to Mumford3
FULL = "BakuFull"
STEP_M = 100                            # the circles' radii are whole multiples of this
MIN_NODES = 2                           # the fewest nodes on a route
DEMAND_SCALE = 10                       # the trips are written ten times over, so that rounding loses little
SEARCHES = {"one_pass": False, "repeated": True}                  # name: repeat passes?
MEASURES = ("att", "d0", "d1", "d2", "dun", "route_time")
FIT_LADDER = ROOT / "output" / "robustness" / "fit_ladder.csv"


def demand_check():
    """The rank correlation of modelled with counted boardings when the demand model has
    destinations and its headways do not come from the counts (robustness.py's third step)."""
    with open(FIT_LADDER, newline="", encoding="utf-8-sig") as f:
        row = next(r for r in csv.DictReader(f) if r["inputs"].startswith("Plus destinations"))
    return {"spearman": float(row["spearman"]), "routes_compared": int(row["routes_compared"])}


def radii(routes, distance):
    """{name: radius} for each circle: the multiple of STEP_M whose instance has the number
    of nodes nearest SIZES[name], the smaller radius on a tie. The circles grow until they
    hold twice the largest size, or the whole network."""
    best, r, n = {}, 0, 0
    while n <= 2 * max(SIZES.values()) and r < max(distance):
        r += STEP_M
        inside = {c for c, d in enumerate(distance) if d <= r}
        n = len({v for path, _ in todays_routes(routes, inside) for v in path})
        for name, target in SIZES.items():
            if name not in best or abs(n - target) < abs(best[name][1] - target):
                best[name] = (r, n)
    return {name: r for name, (r, _) in best.items()}


def cut(name, radius, routes, distance, links, xy, people, pull, a):
    """One instance: its nodes (cluster numbers, nearest the centre first), utrp.Instance,
    today's routes as node numbers from 0 and the route ids each stands for."""
    inside = {c for c, d in enumerate(distance) if radius is None or d <= radius}
    today = todays_routes(routes, inside)
    nodes = sorted({v for path, _ in today for v in path}, key=lambda c: (distance[c], c))
    at = {c: k for k, c in enumerate(nodes)}
    n = len(nodes)
    times = [[0] * n for _ in range(n)]
    for i, ci in enumerate(nodes):
        for j, cj in enumerate(nodes):
            if i != j:
                times[i][j] = links.get((min(ci, cj), max(ci, cj)), math.inf)
    demand = gravity([xy[c] for c in nodes], [people[c] for c in nodes], [pull[c] for c in nodes],
                     a.trip_decay_km * 1000, DEMAND_SCALE)
    route_nodes = [[at[c] for c in path] for path, _ in today]
    inst = utrp.Instance(name, times, demand, len(route_nodes), MIN_NODES, max(map(len, route_nodes)))
    return nodes, inside, inst, route_nodes, [rids for _, rids in today]


def node_rows(network, clusters, nodes, latlon, xy, people, pull):
    rows = []
    for k, c in enumerate(nodes, 1):
        stops = clusters[c]
        rows.append({"node": k, "cluster": c + 1, "x": xy[c][0], "y": xy[c][1],
                     "lat": f"{latlon[c][0]:.6f}", "lon": f"{latlon[c][1]:.6f}",
                     "name": network.stops[stops[0]].name, "stops": len(stops),
                     "stop_ids": " ".join(map(str, sorted(stops))), "people": people[c], "pull": pull[c]})
    return rows


def straighten(inst, routes):
    """What the redesign's straightening does to today's routes, as benchmark.py runs it."""
    out = {}
    for kind, repeat in SEARCHES.items():
        final, before, after, log, tried = utrp.search(inst, routes, repeat=repeat)
        assert not utrp.problems(inst, final), utrp.problems(inst, final)
        out[kind] = {**tried, "changes": len(log), "att_after": after["att"], "route_time_after": after["route_time"],
                     **{f"{k}_after": after[k] for k in ("d0", "d1", "d2", "dun")}}
    return out


def table(rows, header):
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def readme(summary):
    """README.md of the folder, for those who use the instances without the repository."""
    inst, how, check = summary["instances"], summary["construction"], summary["demand_check"]
    names = list(inst)
    rules = table([[n, f"{inst[n]['radius_m'] / 1000:.1f} km" if inst[n]["radius_m"] else "the whole network",
                    inst[n]["nodes"], f"{inst[n]['links']:,}", f"{inst[n]['trips']:,}", inst[n]["routes"],
                    f"{inst[n]['min_nodes']}–{inst[n]['max_nodes']}"] for n in names],
                  ["Instance", "Circle round the centre", "Nodes", "Links", "Trips", "Routes", "Nodes on a route"])
    scores = table([[n, f"{inst[n]['today']['att']:.4f}", *(f"{inst[n]['today'][k]:.2f}" for k in ("d0", "d1", "d2", "dun")),
                     f"{inst[n]['today']['route_time']:,.0f}"] for n in names],
                   ["Instance", "ATT", "d0", "d1", "d2", "dun", "Route time"])
    found = table([[n, inst[n]["straightening"]["one_pass"]["changes"],
                    f"{inst[n]['today']['att']:.4f} → {inst[n]['straightening']['one_pass']['att_after']:.4f}",
                    f"{inst[n]['today']['route_time']:,.0f} → {inst[n]['straightening']['one_pass']['route_time_after']:,.0f}",
                    inst[n]["straightening"]["repeated"]["changes"],
                    f"{inst[n]['straightening']['repeated']['att_after']:.4f}",
                    f"{inst[n]['straightening']['repeated']['route_time_after']:,.0f}"] for n in names],
                  ["Instance", "Changes, one pass", "ATT", "Route time", "Changes, passes repeated", "ATT", "Route time"])
    full = inst[FULL]
    speeds = summary["settings"]["cruise_kmh"].values()
    return f"""# Baku instances of the urban transit routing problem

Five instances cut from the bus network of Baku, Azerbaijan, in the format of the benchmark
networks of Mumford (2013), so that methods written for Mandl's and Mumford's networks can
run on a real city's. Christine Mumford suggested making them (personal communication,
October 2026).

They come from AYNA's map of the network as scraped on 23 October 2026: {how['served_stops']:,} served
stops on {how['routes_with_stops']} routes. Baku0 to Baku3 are circles round the city centre, {how['centre']['name']},
each as wide as gives the number of nodes nearest that of Mumford0 to Mumford3; {FULL} is
the whole network. They were made by `instances.py` in
[github.com/ismatsamadov/line](https://github.com/ismatsamadov/line),
which explains them in `docs/instances.md`.

**Only the positions are measured.** The minutes along the links come from distances along
the routes' paths at the speeds the travel model assumes, and the trips from a gravity
model. Baku has no origin-destination data; the model's only check is that it ranks the
{check['routes_compared']} counted BakuBus routes by their boardings with a rank correlation of
{check['spearman']:.2f} against the counts. Treat the instances as a realistic network with modelled
times and demand, not as measurements of Baku.

## The instances and their rules

{rules}

The rules are Mumford's: exactly the number of routes given; every route a path along the
links that visits no node twice, with between the fewest and the most nodes given; every
node on some route; and every node reachable from every other. As in her files, the
number of routes and the bounds are not in the files; they are here and in `summary.json`.
They come from today's routes (below), so that today's network keeps them: the number of
routes is today's, the most nodes on a route is today's longest, and the fewest is
{MIN_NODES}, since a circle cuts routes at its edge and leaves short stubs.

## Today's routes, scored

`<Name>Routes.txt` holds today's routes, each made into one path. Scored as the literature
scores Mumford's networks (every route runs both ways, each trip takes its quickest path,
every change of route costs 5 minutes, and of equally quick paths the one with fewer
changes counts), they give, in minutes and % of trips:

{scores}

ATT is the average travel time of all trips, d0 to d2 the shares of trips with 0, 1 or 2
changes, dun the share with more, and route time the minutes to drive every route once
one way. The repository's straightening search, which replaces a stretch of a route by
the quickest path between its ends when that lowers ATT (`docs/benchmark.md` there), gives:

{found}

## Files

For each instance `<Name>`, in the layout of Mumford's files, every value a whole number
right-aligned in six characters:

| File | Contents |
|---|---|
| `<Name>Coords.txt` | The number of nodes n on the first line, then one line `x y` per node: whole metres east and north of {ORIGIN[0]}° N, {ORIGIN[1]}° E |
| `<Name>TravelTimes.txt` | n lines of n values: the minutes along the link between two nodes, `Inf` where there is no link, 0 on the diagonal. Symmetric |
| `<Name>Demand.txt` | n lines of n values: the trips between two nodes, 0 on the diagonal. Symmetric |
| `<Name>Routes.txt` | Today's routes, one per line, as node numbers from 1 |
| `<Name>Nodes.csv` | One row per node: `node` (from 1, the line of the node in the files), `cluster` (the same node in every instance, numbered among all {how['clusters']} clusters), `x`, `y`, `lat`, `lon`, `name` (the stop that started the cluster), `stops` and `stop_ids` (AYNA's stop ids), `people` and `pull` (below) |

Node 1 is the node nearest the centre, and the others follow by distance from it.
`routes.csv` gives, for each route of each instance, its nodes, its minutes one way and the
numbers of AYNA's routes it stands for. `summary.json` holds the same figures as this file,
with more detail.

## How they are cut

Nodes are served stops merged into clusters. Taking the stops in order of the routes that
serve them, most first, each stop not yet in a cluster starts one and takes every stop
not yet in one within {CLUSTER_M} m of it, so that both sides of a street and the stops round a
junction become one node. That gives {how['clusters']} clusters, with the whole network's two
matrices together about {full['matrix_mb']:.1f} MB. A node's position is the mean of its stops'.

A link joins two nodes that some route serves one after the other. A bus reaches each stop
at the travel model's time: the distance along the route's path at the cruise speed of
its kind of service ({min(speeds):g} to {max(speeds):g} km/h) plus {how['stop_loss_s']:.0f} seconds at every stop.
A node served at several stops in a row is reached at the mean of their times. Each pass
of a route over a link is one observation, and the link takes the median of all of them,
both directions together, rounded to the nearest whole minute and at least 1.

A route becomes one path: each direction is cut to its runs inside the circle, each run
gives the path left when its loops are erased and the stretches left when it is cut
where it comes back to a node, and the longest of all of these over both directions is
the route. A path that another route's path runs along is dropped, since under the
scoring it adds nothing. The instance's nodes are those on the largest group of paths
that share nodes, so a node no path reaches is left out ({full['clusters_left_out']} of the
{full['clusters_in_window']} clusters, with {full['people_left_out']:,} people, in {FULL}).

## The demand

Each node's `people` are those living closer to one of its stops than to any other stop,
within {how['demand']['access_walk_m']:.0f} m (Kontur's population grid of November 2023, each hexagon
spread over seven points), and its `pull` is the same people's pull on trip ends, half
their number and half the destinations near them: OpenStreetMap's schools, hospitals,
shops, offices and stations, and the metro stations by their passengers. The people of
node a make trips to every node b in proportion to b's pull × exp(−d / {how['demand']['trip_decay_km']:g} km), with d the
straight line between the two in `<Name>Coords.txt`, over every node of the instance,
a included; trips within a node are left out. With T(a, b) those trips, the file holds

    round({DEMAND_SCALE} × (T(a, b) + T(b, a)) / 2)

so the matrix can be computed again from `<Name>Coords.txt` and the `people` and `pull`
of `<Name>Nodes.csv`. The mean of the two directions makes it symmetric, as Mumford's
are, without changing a score, since every route runs both ways. The trips are counted
{DEMAND_SCALE} times over so that rounding loses little; the average travel time and the shares by
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
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "busnet.toml"), help="settings file (TOML); 'none' for defaults only")
    ap.add_argument("--set", action="append", default=[], metavar="NAME=VALUE",
                    help="override one setting or data path for this run; repeatable")
    ap.add_argument("--out", default=str(ROOT / "output" / "instances"))
    args = ap.parse_args()

    config = settings_file(args.config)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    try:
        inp = load_inputs(ROOT, config, args.set)
    except (ValueError, TypeError) as e:
        sys.exit(f"Settings error: {e}")
    a, net = inp.a, inp.network
    if not inp.zones:
        sys.exit("The instances need population data: set data.population in busnet.toml")

    clusters = cluster_stops(net, CLUSTER_M)
    cluster_of = {s: c for c, stops in enumerate(clusters) for s in stops}
    latlon = positions(net, clusters)
    xy = [metres(lat, lon, ORIGIN) for lat, lon in latlon]
    centre = metres(CENTRE[1], CENTRE[2], ORIGIN)
    distance = [math.hypot(x - centre[0], y - centre[1]) for x, y in xy]
    sequences, links = network_links(net, a, cluster_of)
    model_min = sum(run_time_s(p, net, a) for p in net.patterns.values()) / 60
    link_min = sum(links[(min(x, y), max(x, y))] for seq in sequences.values() for x, y in zip(seq, seq[1:]))
    people, pull = node_people(net, a, inp.zones, inp.attraction, cluster_of, len(clusters))
    people, pull = [half_up(p) for p in people], [half_up(p) for p in pull]
    routes = [(rid, [sequences[k] for k in sorted(sequences) if k[0] == rid])
              for rid in sorted({r for r, _ in sequences}, key=lambda r: _route_key(net.number(r)))]
    print(f"{len(net.served_stop_ids()):,} served stops in {len(clusters)} clusters of {CLUSTER_M} m; "
          f"{len(links):,} links; {len(routes)} routes")

    windows = {**radii(routes, distance), FULL: None}
    summary_instances, route_rows = {}, []
    for name, radius in windows.items():
        t1 = time.time()
        nodes, inside, inst, today, sources = cut(name, radius, routes, distance, links, xy, people, pull, a)
        broken = utrp.problems(inst, today)
        assert not broken, (name, broken)
        score = utrp.evaluate(inst, today)
        searched = straighten(inst, today)
        n = inst.n
        left_out = sorted(inside - set(nodes))
        minutes = [inst.time[i][j] for i in range(n) for j in range(i + 1, n) if inst.time[i][j] < math.inf]
        files = {
            f"{name}Coords.txt": utrp.coords_text([xy[c] for c in nodes]),
            f"{name}TravelTimes.txt": utrp.matrix_text(inst.time),
            f"{name}Demand.txt": utrp.matrix_text(inst.demand),
            f"{name}Routes.txt": utrp.routes_text(today),
        }
        for file, text in files.items():
            (out / file).write_text(text, encoding="ascii")
        write_csv(out / f"{name}Nodes.csv", node_rows(net, clusters, nodes, latlon, xy, people, pull))
        for k, (r, rids) in enumerate(zip(today, sources), 1):
            route_rows.append({"instance": name, "route": k, "nodes": len(r), "minutes": utrp.route_time(inst, [r]),
                               "node_list": " ".join(str(v + 1) for v in r),
                               "stands_for": " ".join(net.number(rid) for rid in rids)})
        summary_instances[name] = {
            "radius_m": radius, "nodes": n, "links": len(minutes), "routes": inst.routes,
            "min_nodes": inst.min_nodes, "max_nodes": inst.max_nodes,
            "routes_today": sum(map(len, sources)),
            "clusters_in_window": len(inside), "clusters_left_out": len(left_out),
            "people": sum(people[c] for c in nodes), "people_left_out": sum(people[c] for c in left_out),
            "trips": sum(map(sum, inst.demand)),
            "link_minutes": {"min": min(minutes), "median": statistics.median(minutes), "max": max(minutes)},
            "matrix_mb": (len(files[f"{name}TravelTimes.txt"]) + len(files[f"{name}Demand.txt"])) / 1e6,
            "today": score,
            "straightening": searched,
        }
        print(f"{name:8s} {'whole network' if radius is None else f'{radius / 1000:.1f} km':>13s}  {n:4d} nodes  "
              f"{len(minutes):5d} links  {inst.routes:3d} routes of {inst.min_nodes}-{inst.max_nodes} nodes  "
              f"ATT {score['att']:6.2f}  d0 {score['d0']:5.2f}  route time {score['route_time']:6,.0f}  "
              f"straightening {searched['one_pass']['changes']} / {searched['repeated']['changes']} changes, "
              f"ATT {searched['repeated']['att_after']:6.2f}  ({time.time() - t1:.0f} s)")

    summary = {
        "instances": summary_instances,
        "construction": {
            "served_stops": len(net.served_stop_ids()),
            "routes_with_stops": len(routes),
            "cluster_radius_m": CLUSTER_M,
            "clusters": len(clusters),
            "centre": {"name": CENTRE[0], "lat": CENTRE[1], "lon": CENTRE[2]},
            "circle_sizes": SIZES,
            "coordinates": {"origin_lat": ORIGIN[0], "origin_lon": ORIGIN[1], "unit": "m",
                            "projection": "flat, centred on 40.4 N 49.85 E (busnet/geo.py)"},
            "node_numbering": "from 1, nearest the centre first",
            "link_minutes": "median over every route and both directions of the travel model's time "
                            "between the clusters, rounded to the nearest minute, at least 1",
            "stop_loss_s": a.stop_loss_s,
            "minutes_of_every_route_direction": {"travel_model": model_min, "along_the_links": link_min,
                                                 "ratio": link_min / model_min},
            "demand": {"trip_decay_km": a.trip_decay_km, "access_walk_m": a.max_access_walk_m,
                       "destination_share": a.destination_share, "scale": DEMAND_SCALE},
        },
        "demand_check": demand_check(),
        "settings": asdict(a),
        "inputs": inp.found,
    }
    write_csv(out / "routes.csv", route_rows)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "README.md").write_text(readme(summary), encoding="utf-8")
    print(f"Wrote {out.resolve()} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
