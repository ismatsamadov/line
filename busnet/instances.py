# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Instances of the urban transit routing problem cut from the Baku network, in the format
of Mumford's (2013) benchmark networks (busnet/utrp.py reads and scores them).

An instance is nodes with coordinates, the minutes along the links between them, the trips
between every pair, and rules for the routes. Cut from Baku:

  nodes    served stops merged into clusters (cluster_stops), so that both sides of a
           street and the stops round a junction are one node
  links    every pair of clusters some route serves one after the other, with the travel
           model's minutes between them (network_links)
  routes   today's routes, each made into one path that visits no node twice (route_path,
           todays_routes); the number of routes and the most nodes on one are taken from
           them, so that today's network keeps the rules
  demand   the gravity model of the travel model between the nodes (node_people, gravity)

The positions are the only measured part. Link times rest on the model's speeds, and the
demand on a model whose only check is how it ranks routes against counted boardings."""

import math
import statistics
from collections import defaultdict

from .geo import PROJ
from .graph import StopIndex


def half_up(x):
    return math.floor(x + 0.5)


# ---------------------------------------------------------------- nodes and links

def cluster_stops(network, radius_m):
    """Served stops merged into clusters: a list of clusters, each a list of stop ids
    beginning with the stop that started it.

    Stops are taken in order of the routes serving them, most first and ties by id; a stop
    not yet in a cluster starts one and takes every stop not yet in a cluster within
    radius_m of it. The busiest stops anchor the clusters, and no stop is farther than
    radius_m from the stop that started its cluster."""
    served = sorted(network.served_stop_ids())
    at = network.routes_at_stop()
    index = StopIndex([network.stops[s] for s in served])
    taken, clusters = set(), []
    for s in sorted(served, key=lambda s: (-len(at[s]), s)):
        if s in taken:
            continue
        stop = network.stops[s]
        members = [s] + sorted(t.id for _, t in index.within(stop.lat, stop.lon, radius_m) if t.id not in taken and t.id != s)
        taken.update(members)
        clusters.append(members)
    return clusters


def positions(network, clusters):
    """(lat, lon) of each cluster: the mean of its stops'."""
    return [(sum(network.stops[s].lat for s in c) / len(c), sum(network.stops[s].lon for s in c) / len(c))
            for c in clusters]


def network_links(network, a, cluster_of):
    """({(route id, direction): the clusters it serves, in order}, {(i, j): minutes} for
    each pair of clusters i < j that some route direction serves one after the other).

    A bus reaches each stop at the travel model's time: every hop takes its length along
    the path at the route's cruise speed plus stop_loss_s, as in graph.TransitGraph. A
    cluster served at several stops in a row counts once, reached at the mean of their
    times, and the time between two clusters in a row is one observation of their link.
    A link takes the median of its observations over every route and both directions, in
    whole minutes rounded to the nearest and at least 1."""
    sequences, seen = {}, defaultdict(list)
    for key, p in sorted(network.patterns.items()):
        speed = a.cruise_mps(network.routes[p.route_id].zone)
        at = [0.0]
        for i in range(1, len(p.stop_ids)):
            at.append(at[-1] + (p.chainage_m[i] - p.chainage_m[i - 1]) / speed + a.stop_loss_s)
        runs = []                                    # [cluster, seconds at each of its stops in a row]
        for s, t in zip(p.stop_ids, at):
            c = cluster_of[s]
            if runs and runs[-1][0] == c:
                runs[-1][1].append(t)
            else:
                runs.append([c, [t]])
        sequences[key] = [c for c, _ in runs]
        for (c1, t1), (c2, t2) in zip(runs, runs[1:]):
            seen[(min(c1, c2), max(c1, c2))].append(sum(t2) / len(t2) - sum(t1) / len(t1))
    links = {pair: max(1, half_up(statistics.median(obs) / 60)) for pair, obs in sorted(seen.items())}
    return sequences, links


# ---------------------------------------------------------------- today's routes as paths

def erase_loops(seq):
    """seq with its loops cut out: when a node comes round again, the nodes since its first
    visit are dropped."""
    out, where = [], {}
    for c in seq:
        if c in where:
            for gone in out[where[c] + 1:]:
                del where[gone]
            del out[where[c] + 1:]
        else:
            where[c] = len(out)
            out.append(c)
    return out


def split_at_repeats(seq):
    """seq cut into stretches that visit no node twice, each after the first beginning
    with the last node of the one before, so that every link of seq is in one of them."""
    out, cur = [], []
    for c in seq:
        if c in cur:
            out.append(cur)
            cur = [cur[-1]]
        cur.append(c)
    out.append(cur)
    return [s for s in out if len(s) >= 2]


def stretches_within(seq, inside):
    """The longest runs of seq whose nodes are all in inside, of two nodes or more."""
    out, run = [], []
    for c in seq + [None]:
        if c is not None and c in inside:
            run.append(c)
            continue
        if len(run) >= 2:
            out.append(run)
        run = []
    return out


def route_path(directions, inside):
    """One route as the benchmark wants it: a path through the nodes in inside that visits
    no node twice, or None.

    Each direction, the second reversed so that both run the same way, is cut into its
    runs within inside; each run gives the path that erasing its loops leaves and the
    stretches that cutting it at repeated nodes leaves. The longest of all of them is the
    route; of equally long ones the first found."""
    found = []
    for k, seq in enumerate(directions):
        for run in stretches_within(seq if k == 0 else seq[::-1], inside):
            found.append(erase_loops(run))
            found.extend(split_at_repeats(run))
    found = [p for p in found if len(p) >= 2]
    return max(found, key=len) if found else None


def _stretch_of(small, big):
    """True when small runs along big, either way round."""
    n = len(small)
    return any(path[i:i + n] == small for path in (big, big[::-1]) for i in range(len(big) - n + 1))


def todays_routes(routes, inside):
    """Today's routes within a set of nodes: [(path, [route ids it stands for])].

    routes is [(route id, [the node sequence of each direction])] in the order the result
    should follow. Each route becomes one path (route_path). A path that another route's
    path runs along, either way round, is dropped and its route credited to that one,
    since under the benchmark's scoring it adds nothing. Of the paths left, those in the
    largest group joined by shared nodes are kept (most nodes, then most paths), so that
    every trip between their nodes has a path."""
    rank = {rid: k for k, (rid, _) in enumerate(routes)}
    found = {}                                   # path either way round -> (path, route ids)
    for rid, directions in routes:
        path = route_path(directions, inside)
        if path:
            found.setdefault(min(tuple(path), tuple(path[::-1])), (path, []))[1].append(rid)
    kept = []
    for path, rids in sorted(found.values(), key=lambda pr: -len(pr[0])):     # stable: ties stay in route order
        home = next((k for k in kept if _stretch_of(path, k[0])), None)
        if home:
            home[1].extend(rids)
        else:
            kept.append((path, list(rids)))
    if not kept:
        return []
    parent = list(range(len(kept)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    first = {}
    for k, (path, _) in enumerate(kept):
        for v in path:
            if v in first:
                parent[find(k)] = find(first[v])
            else:
                first[v] = k
    groups = defaultdict(list)
    for k in range(len(kept)):
        groups[find(k)].append(k)
    best = max(groups.values(), key=lambda g: (len({v for k in g for v in kept[k][0]}), len(g), -g[0]))
    out = [(kept[k][0], sorted(kept[k][1], key=rank.get)) for k in best]
    return sorted(out, key=lambda pr: rank[pr[1][0]])


# ---------------------------------------------------------------- demand

def node_people(network, a, zones, attraction, cluster_of, n):
    """(people, pull) of each of n clusters: the zones whose nearest served stop within
    max_access_walk_m is one of its stops. Without attraction, pull is people."""
    index = StopIndex([network.stops[s] for s in sorted(network.served_stop_ids())])
    people, pull = [0.0] * n, [0.0] * n
    for (lat, lon, p), w in zip(zones, attraction or [z[2] for z in zones]):
        near = index.within(lat, lon, a.max_access_walk_m)
        if near:
            c = cluster_of[near[0][1].id]
            people[c] += p
            pull[c] += w
    return people, pull


def gravity(xy, people, pull, decay_m, scale):
    """Trips between nodes, whole numbers in an n x n matrix with 0 on the diagonal.

    As in the travel model (metrics.evaluate_od), the people of node a make trips to every
    node b in proportion to b's pull x exp(-distance / decay_m), adding up to its people:
        T(a, b) = people(a) x pull(b) exp(-d(a, b) / decay_m) / sum over c of pull(c) exp(-d(a, c) / decay_m)
    with d the straight line between the coordinates and c every node, a itself included;
    the trips that stay within a node are then left out. Every route runs both ways, so a
    trip and its return take the same time; the matrix holds the mean of the two directions,
    times scale, rounded: round(scale x (T(a, b) + T(b, a)) / 2)."""
    n = len(xy)
    trips = [[0.0] * n for _ in range(n)]
    for i, (x, y) in enumerate(xy):
        w = [pull[j] * math.exp(-math.hypot(x - xj, y - yj) / decay_m) for j, (xj, yj) in enumerate(xy)]
        total = sum(w)
        if total:
            trips[i] = [people[i] * wj / total if j != i else 0.0 for j, wj in enumerate(w)]
    return [[half_up(scale * (trips[i][j] + trips[j][i]) / 2) for j in range(n)] for i in range(n)]


def metres(lat, lon, origin):
    """Whole metres east and north of origin (lat, lon), in the measurements' flat projection."""
    x, y = PROJ.to_xy(lat, lon)
    x0, y0 = PROJ.to_xy(*origin)
    return half_up(x - x0), half_up(y - y0)
