"""The Baku instances in Mumford's format (busnet/instances.py and instances.py).

The pieces that cut them are checked on made-up sequences and on the two-route test
network; the committed files must read back the way Mumford's files are read, keep their
rules under today's routes, score as summary.json says and give back their demand from
the coordinates, people and pull they publish. With BUSNET_SLOW_TESTS=1, instances.py runs
again (about twelve minutes) and must give the committed folder again."""

import csv
import json
import math
import tempfile
import unittest
from pathlib import Path

from busnet import instances, utrp
from busnet.assumptions import Assumptions
from tests.helpers import LAT, LON, two_route_network
from tests.test_regression import ROOT, SLOW, differences, regenerate

FOLDER = ROOT / "output" / "instances"
NAMES = ("Baku0", "Baku1", "Baku2", "Baku3", "BakuFull")


class Paths(unittest.TestCase):
    def test_loops_are_erased(self):
        self.assertEqual(instances.erase_loops([1, 2, 3, 2, 4]), [1, 2, 4])
        self.assertEqual(instances.erase_loops([1, 2, 3, 4, 2, 5, 6]), [1, 2, 5, 6])
        self.assertEqual(instances.erase_loops([1, 2, 3, 1]), [1])
        self.assertEqual(instances.erase_loops([1, 2, 3]), [1, 2, 3])

    def test_cutting_at_repeats_keeps_every_link(self):
        seq = [1, 2, 3, 2, 4, 1, 5, 4]
        parts = instances.split_at_repeats(seq)
        self.assertEqual(parts, [[1, 2, 3], [3, 2, 4, 1, 5], [5, 4]])
        links = {frozenset(p) for p in zip(seq, seq[1:])}
        self.assertEqual(links, {frozenset(p) for part in parts for p in zip(part, part[1:])})
        self.assertTrue(all(len(set(part)) == len(part) for part in parts))

    def test_runs_within_a_set_of_nodes(self):
        self.assertEqual(instances.stretches_within([1, 2, 3, 4, 5, 6], {1, 2, 4, 6}), [[1, 2]])
        self.assertEqual(instances.stretches_within([1, 2, 3, 4, 5], {1, 2, 3, 4, 5}), [[1, 2, 3, 4, 5]])

    def test_a_route_becomes_its_longest_path(self):
        # direction 1 makes a spur to 2 and back; direction 2 skips it
        self.assertEqual(instances.route_path([[0, 1, 2, 1, 3], [3, 1, 0]], {0, 1, 2, 3}), [0, 1, 3])
        # direction 2 reaches a node direction 1 does not, and is longer once reversed
        self.assertEqual(instances.route_path([[0, 1, 2], [3, 2, 1, 0]], {0, 1, 2, 3}), [0, 1, 2, 3])
        # cut to the circle: the run inside the set, not the single node where it comes back
        self.assertEqual(instances.route_path([[0, 1, 2, 3, 4, 2, 5], [5, 4, 3, 0]], {1, 2, 3}), [1, 2, 3])
        self.assertIsNone(instances.route_path([[0, 1, 2], [2, 1, 0]], {1}))

    def test_duplicates_and_stretches_are_credited_and_strays_dropped(self):
        routes = [(10, [[0, 1, 2, 3], [3, 2, 1, 0]]),
                  (20, [[1, 2], [2, 1]]),                   # a stretch of route 10
                  (30, [[5, 6], [6, 5]]),                   # shares no node with the others
                  (40, [[3, 2, 1, 0], [0, 1, 2, 3]])]       # route 10 the other way round
        self.assertEqual(instances.todays_routes(routes, set(range(7))), [([0, 1, 2, 3], [10, 20, 40])])


class OnTheTestNetwork(unittest.TestCase):
    def setUp(self):
        self.net = two_route_network()
        self.a = Assumptions()

    def test_clusters_start_at_the_busiest_stops(self):
        self.assertEqual(instances.cluster_stops(self.net, 900), [[1, 2], [3, 4], [5]])
        self.assertEqual(instances.cluster_stops(self.net, 500), [[1], [2], [3], [4], [5]])

    def test_link_minutes_are_the_median_over_routes_and_directions(self):
        clusters = instances.cluster_stops(self.net, 900)
        of = {s: c for c, stops in enumerate(clusters) for s in stops}
        sequences, links = instances.network_links(self.net, self.a, of)
        self.assertEqual(sequences, {(1, 1): [0, 1, 2], (1, 2): [2, 1, 0], (2, 1): [0, 1], (2, 2): [1, 0]})
        hop = self.net.patterns[(1, 1)].chainage_m[1]                 # every hop is the same length
        urban = hop / self.a.cruise_mps("Şəhərdaxili") + self.a.stop_loss_s
        suburban = hop / self.a.cruise_mps("Şəhərətrafı") + self.a.stop_loss_s
        # cluster 0 is stops 1 and 2, reached at the mean of their times; cluster 1 stops 3 and 4
        between_0_and_1 = sorted([2 * urban, 2 * urban, 1.5 * suburban, 1.5 * suburban])
        self.assertEqual(links[(0, 1)], instances.half_up((between_0_and_1[1] + between_0_and_1[2]) / 2 / 60))
        self.assertEqual(links[(1, 2)], instances.half_up(1.5 * urban / 60))
        self.assertEqual(sorted(links), [(0, 1), (1, 2)])

    def test_people_go_to_the_cluster_of_their_nearest_stop(self):
        clusters = instances.cluster_stops(self.net, 900)
        of = {s: c for c, stops in enumerate(clusters) for s in stops}
        zones = [(LAT, LON + 0.001, 100), (LAT, LON + 0.03, 50), (LAT + 0.01, LON + 0.04, 7)]   # the last 1.1 km off
        people, pull = instances.node_people(self.net, self.a, zones, None, of, 3)
        self.assertEqual(people, [100, 50, 0])
        self.assertEqual(pull, people)
        people, pull = instances.node_people(self.net, self.a, zones, [1.0, 2.0, 3.0], of, 3)
        self.assertEqual(pull, [1.0, 2.0, 0.0])


class Demand(unittest.TestCase):
    def test_gravity_follows_its_formula(self):
        xy, people, pull = [(0, 0), (3000, 0), (0, 4000)], [100, 40, 0], [1, 2, 3]
        trips = instances.gravity(xy, people, pull, 6000, 10)

        def share(a, b):
            w = [pull[c] * math.exp(-math.hypot(xy[a][0] - xy[c][0], xy[a][1] - xy[c][1]) / 6000) for c in range(3)]
            return people[a] * w[b] / sum(w)

        self.assertEqual(trips[0][1], instances.half_up(10 * (share(0, 1) + share(1, 0)) / 2))
        self.assertEqual(trips[2][0], instances.half_up(10 * share(0, 2) / 2))        # node 2 has no people
        self.assertEqual([trips[k][k] for k in range(3)], [0, 0, 0])
        self.assertEqual(trips, [list(r) for r in zip(*trips)])


class Format(unittest.TestCase):
    def test_files_read_back_as_mumfords_are_read(self):
        inf = math.inf
        time = [[0, 3, inf], [3, 0, 12], [inf, 12, 0]]
        demand = [[0, 99999, 5], [99999, 0, 0], [5, 0, 0]]
        text = utrp.matrix_text(time)
        self.assertEqual(text.splitlines()[0], "     0     3   Inf")
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "TTravelTimes.txt").write_text(text, encoding="ascii")
            (folder / "TDemand.txt").write_text(utrp.matrix_text(demand), encoding="ascii")
            (folder / "TCoords.txt").write_text(utrp.coords_text([(12, 30000), (5, 7), (99999, 0)]), encoding="ascii")
            (folder / "TRoutes.txt").write_text(utrp.routes_text([[0, 1, 2], [2, 1]]), encoding="ascii")
            inst = utrp.read_instance(folder, "T", 2, 2, 3)
            self.assertEqual((inst.time, inst.demand), (time, demand))
            self.assertEqual(utrp.read_coords(folder / "TCoords.txt"), [(12, 30000), (5, 7), (99999, 0)])
            self.assertEqual((folder / "TRoutes.txt").read_text(encoding="ascii"), "1 2 3\n3 2\n")
            self.assertEqual(utrp.read_routes(folder / "TRoutes.txt"), [[0, 1, 2], [2, 1]])

    def test_values_that_do_not_fit_are_refused(self):
        with self.assertRaises(ValueError):
            utrp.matrix_text([[0, 100000]])
        with self.assertRaises(ValueError):
            utrp.matrix_text([[0, 2.5]])


class CommittedInstances(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary = json.loads((FOLDER / "summary.json").read_text(encoding="utf-8"))

    def instance(self, name):
        s = self.summary["instances"][name]
        return utrp.read_instance(FOLDER, name, s["routes"], s["min_nodes"], s["max_nodes"])

    def test_all_five_are_there(self):
        self.assertEqual(tuple(self.summary["instances"]), NAMES)

    def test_files_have_mumfords_layout(self):
        for name in NAMES:
            inst = self.instance(name)
            n = inst.n
            self.assertEqual(n, self.summary["instances"][name]["nodes"])
            coords = (FOLDER / f"{name}Coords.txt").read_text(encoding="ascii").splitlines()
            self.assertEqual(coords[0], str(n))
            self.assertEqual(len(coords), n + 1)
            self.assertTrue(all(len(line) == 12 for line in coords[1:]), name)
            for kind, matrix in (("TravelTimes", inst.time), ("Demand", inst.demand)):
                lines = (FOLDER / f"{name}{kind}.txt").read_text(encoding="ascii").splitlines()
                self.assertTrue(len(lines) == n and all(len(line) == 6 * n for line in lines), (name, kind))
                self.assertEqual(matrix, [list(r) for r in zip(*matrix)], (name, kind))
                self.assertEqual([matrix[k][k] for k in range(n)], [0] * n, (name, kind))
            links = sum(1 for i in range(n) for j in range(i + 1, n) if inst.time[i][j] < math.inf)
            self.assertEqual(links, self.summary["instances"][name]["links"])
            self.assertTrue(all(v >= 1 for row in inst.time for v in row if v), name)
            self.assertTrue(all(v >= 0 and v == int(v) for row in inst.demand for v in row), name)

    def test_todays_routes_keep_the_rules_and_score_as_published(self):
        for name in NAMES:
            inst = self.instance(name)
            routes = utrp.read_routes(FOLDER / f"{name}Routes.txt")
            self.assertEqual(utrp.problems(inst, routes), [], name)
            self.assertEqual(max(map(len, routes)), inst.max_nodes)
            score = utrp.evaluate(inst, routes)
            for measure, value in self.summary["instances"][name]["today"].items():
                self.assertAlmostEqual(score[measure], value, places=9, msg=(name, measure))

    def test_demand_comes_back_from_the_published_nodes(self):
        demand = self.summary["construction"]["demand"]
        for name in NAMES:
            with open(FOLDER / f"{name}Nodes.csv", newline="", encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual([int(r["node"]) for r in rows], list(range(1, len(rows) + 1)))
            xy = utrp.read_coords(FOLDER / f"{name}Coords.txt")
            self.assertEqual(xy, [(float(r["x"]), float(r["y"])) for r in rows])
            trips = instances.gravity(xy, [float(r["people"]) for r in rows], [float(r["pull"]) for r in rows],
                                      demand["trip_decay_km"] * 1000, demand["scale"])
            self.assertEqual(trips, self.instance(name).demand, name)

    def test_nodes_share_no_stop(self):
        for name in NAMES:
            with open(FOLDER / f"{name}Nodes.csv", newline="", encoding="utf-8-sig") as f:
                stops = [s for r in csv.DictReader(f) for s in r["stop_ids"].split()]
            self.assertEqual(len(stops), len(set(stops)), name)

    @unittest.skipUnless(SLOW, "set BUSNET_SLOW_TESTS=1 to cut the instances again (about twelve minutes)")
    def test_instances_regenerate_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            regenerate("instances.py", tmp)
            self.assertEqual(differences(FOLDER, Path(tmp)), [])


if __name__ == "__main__":
    unittest.main()
