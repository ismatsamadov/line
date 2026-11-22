"""busnet/graph.py: the stop index finds the nearest stop anywhere within the distance asked
for."""

import unittest

from busnet.graph import StopIndex

from .helpers import LAT, LON, stop


class NearestStop(unittest.TestCase):
    def test_a_stop_in_the_outer_band_of_the_distance_is_found(self):
        index = StopIndex([stop(1, LAT + 0.0405, LON)])          # 4,503 m north, past the last doubling (4,000 m)
        d, s = index.nearest(LAT, LON, max_m=5000)
        self.assertAlmostEqual(d, index.within(LAT, LON, 5000)[0][0])
        self.assertEqual(s.id, 1)
        self.assertIsNone(index.nearest(LAT, LON, max_m=4500))

    def test_a_distance_below_one_cell(self):
        index = StopIndex([stop(1, LAT + 0.001, LON)])           # 111 m north; cells are 250 m
        self.assertEqual(index.nearest(LAT, LON, max_m=150)[1].id, 1)
        self.assertIsNone(index.nearest(LAT, LON, max_m=100))

    def test_the_nearest_of_several(self):
        index = StopIndex([stop(1, LAT + 0.02, LON), stop(2, LAT, LON + 0.005), stop(3, LAT - 0.03, LON)])
        self.assertEqual(index.nearest(LAT, LON)[1].id, 2)



if __name__ == "__main__":
    unittest.main()
