"""The demand model's settings fitted to counted boardings (calibrate.py).

metrics.evaluate_od samples origins, finds every trip's quickest path and spreads the trips
over the destinations with a gravity model. Only the last step depends on the demand
settings (trip_decay_km and the pull of each zone), so trip_paths finds the paths once and
boardings spreads the trips again for any settings, giving exactly the boardings
evaluate_od gives for them."""

import math
import random
from array import array
from collections import Counter
from operator import mul

from .geo import PROJ
from .graph import StopIndex, TransitGraph


def trip_paths(network, a, zones, n_origins=300, seed=7, headways=None):
    """Every sampled origin's trips by bus, as evaluate_od finds them.

    Returns (origins, distances, rides): the origin zones, sampled in proportion to
    population as evaluate_od samples them; for each origin, the straight-line metres to
    every zone; and for each origin, {destination zone: the route ids its quickest trip
    boards, in order} for the trips made by bus within max_trip_min. Trips walked all the
    way, and trips that cannot be made in time, board nothing."""
    graph = TransitGraph(network, a, headways)
    index = StopIndex([network.stops[s] for s in graph.stop_ids])
    walk = a.walk_detour / a.walk_speed_mps
    access = [[(s.id, d * walk) for d, s in index.within(lat, lon, a.max_access_walk_m)] for lat, lon, _ in zones]
    acc_nodes = [[graph.arrival(s) for s, _ in acc] for acc in access]
    acc_walk = [[w for _, w in acc] for acc in access]
    xy = [PROJ.to_xy(lat, lon) for lat, lon, _ in zones]
    zpop = [z[2] for z in zones]

    rng = random.Random(seed)
    keyed = sorted(((rng.random() ** (1.0 / w), i) for i, w in enumerate(zpop) if w > 0), reverse=True)
    origins = [i for _, i in keyed[:n_origins]]

    cutoff = a.max_trip_min * 60
    penalty = a.transfer_penalty_s
    distances, rides = [], []
    for o in origins:
        sources = {}
        for s, w in access[o]:
            node = graph.departure(s)
            sources[node] = min(w, sources.get(node, math.inf))
        dist = None
        routes_to = {}
        if sources:
            dist, _, pred, settled = graph.search(sources, graph.trip_cutoff_s)
            for n in settled:                       # a node's predecessor is settled before it
                p = pred[n]
                if p < 0:
                    routes_to[n] = ()
                    continue
                r = routes_to.get(p, ())
                if graph.node_route[n] is not None and graph.is_departure(p):
                    r = r + (graph.node_route[n],)
                routes_to[n] = r
        ox, oy = xy[o]
        dm_o = array("d", (math.hypot(x - ox, y - oy) for x, y in xy))
        ride = {}
        for d in range(len(zones)):
            if d == o:
                continue
            best, end = math.inf, None
            if dist is not None:
                for node, w in zip(acc_nodes[d], acc_walk[d]):
                    c = dist[node] + w - penalty
                    if c < best:
                        best, end = c, node
            if dm_o[d] <= 2000 and dm_o[d] * walk < best:
                best, end = dm_o[d] * walk, None
            if best <= cutoff and end is not None and routes_to.get(end):
                ride[d] = routes_to[end]
        distances.append(dm_o)
        rides.append(ride)
    return origins, distances, rides


def decay_weights(distances, decay_km):
    """exp(-distance / decay) for every origin and zone: the part of the gravity model that
    depends on trip_decay_km only."""
    decay_m = decay_km * 1000
    return [array("d", (math.exp(-d / decay_m) for d in dm_o)) for dm_o in distances]


def spread(origins, rides, decay, pull, distances=None):
    """({route id: modelled boardings}, mean straight-line trip in km or None) with the zones'
    pull and a decay_weights result: evaluate_od's modelled_boardings and
    mean_trip_km_straight_line for those settings (the second only given distances).

    From each origin the trips go to every other zone in proportion to its pull x the
    decay weight, adding up to one; each trip by bus boards the routes of its path."""
    out = Counter()
    km, counted = 0.0, 0
    for k, (o, ride, dw) in enumerate(zip(origins, rides, decay)):
        weights = list(map(mul, pull, dw))
        total = sum(weights) - weights[o]
        if total <= 0:
            continue
        if distances is not None:
            km += (sum(map(mul, weights, distances[k])) - weights[o] * distances[k][o]) / total / 1000
            counted += 1
        for d, routes in ride.items():
            f = weights[d]
            if f <= 0:
                continue
            f /= total
            for r in routes:
                out[r] += f
    return out, (km / counted if counted else None)


def boardings(origins, rides, decay, pull):
    """{route id: modelled boardings}: spread without the trip length."""
    return spread(origins, rides, decay, pull)[0]
