import math
import sqlite3
import struct
import tempfile
import unittest
from pathlib import Path

from busnet.population import WEB_MERCATOR_R, cut_gpkg, load_gpkg


def mercator(lat, lon):
    return WEB_MERCATOR_R * math.radians(lon), WEB_MERCATOR_R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def hexagon(lat, lon, radius_m=460.0):
    """A GeoPackage geometry: a hexagon around (lat, lon) in web Mercator, with its envelope."""
    cx, cy = mercator(lat, lon)
    r = radius_m / math.cos(math.radians(lat))              # Mercator stretches distances by 1/cos(lat)
    ring = [(cx + r * math.cos(math.radians(60 * k)), cy + r * math.sin(math.radians(60 * k))) for k in range(7)]
    xs, ys = [x for x, _ in ring], [y for _, y in ring]
    wkb = struct.pack("<BII", 1, 3, 1) + struct.pack("<I", len(ring)) + b"".join(struct.pack("<2d", *p) for p in ring)
    return b"GP" + bytes([0, 3]) + struct.pack("<i", 3857) + struct.pack("<4d", min(xs), max(xs), min(ys), max(ys)) + wkb


def kontur_like(path, cells):
    """A GeoPackage laid out as Kontur's: metadata tables, the features, and two feature-count triggers."""
    con = sqlite3.connect(path)
    con.execute("PRAGMA application_id = 1196444487")
    con.execute("CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY, "
                "organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, "
                "description TEXT)")
    con.execute("CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, "
                "identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME, min_x DOUBLE, "
                "min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER)")
    con.execute("CREATE TABLE gpkg_ogr_contents (table_name TEXT NOT NULL PRIMARY KEY, feature_count INTEGER)")
    con.execute("CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, "
                "geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL)")
    con.execute('CREATE TABLE "population" ("fid" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "geom" GEOMETRY, '
                '"h3" TEXT, "population" REAL)')
    con.execute("CREATE TRIGGER trigger_insert_feature_count_population AFTER INSERT ON population BEGIN UPDATE "
                "gpkg_ogr_contents SET feature_count = feature_count + 1 WHERE table_name = 'population'; END")
    con.execute("CREATE TRIGGER trigger_delete_feature_count_population AFTER DELETE ON population BEGIN UPDATE "
                "gpkg_ogr_contents SET feature_count = feature_count - 1 WHERE table_name = 'population'; END")
    con.execute("INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84 / Pseudo-Mercator', 3857, 'EPSG', 3857, '', '')")
    con.execute("INSERT INTO gpkg_contents VALUES ('population', 'features', 'population', '', '2023-10-31', "
                "0, 0, 1, 1, 3857)")
    con.execute("INSERT INTO gpkg_ogr_contents VALUES ('population', 0)")
    con.execute("INSERT INTO gpkg_geometry_columns VALUES ('population', 'geom', 'GEOMETRY', 3857, 0, 0)")
    for k, (lat, lon, people) in enumerate(cells):
        con.execute("INSERT INTO population (geom, h3, population) VALUES (?, ?, ?)",
                    (hexagon(lat, lon), f"cell{k}", people))
    con.commit()
    con.close()


CUT = (56.905, 56.995, 24.0, 24.2)                         # between rows of cells, not on one


class CutTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.src, self.dst = Path(tmp.name) / "country.gpkg", Path(tmp.name) / "city.gpkg"
        self.cells = [(56.95 + 0.01 * i, 24.10 + 0.015 * j, 100.0 * (i + j + 1)) for i in range(-6, 7) for j in range(-6, 7)]
        self.cells.append((57.5, 25.0, 999.0))               # far off, as the rest of a country is
        kontur_like(self.src, self.cells)

    def test_the_cut_gives_the_same_zones_in_the_city_and_keeps_only_its_cells(self):
        kept = cut_gpkg(self.src, self.dst, CUT)
        inner = (56.92, 56.98, 24.04, 24.16)                 # the box the model reads, a cell inside the cut
        self.assertEqual(load_gpkg(self.dst, inner), load_gpkg(self.src, inner))
        self.assertEqual(load_gpkg(self.dst, inner, split=False), load_gpkg(self.src, inner, split=False))
        self.assertEqual(kept, sum(1 for lat, lon, _ in self.cells if CUT[0] <= lat <= CUT[1] and CUT[2] <= lon <= CUT[3]))
        self.assertLess(kept, len(self.cells))

    def test_the_cut_is_a_geopackage_with_its_count_and_extent_set(self):
        kept = cut_gpkg(self.src, self.dst, CUT)
        con = sqlite3.connect(self.dst)
        self.assertEqual(con.execute("PRAGMA application_id").fetchone()[0], 1196444487)
        self.assertEqual(con.execute("SELECT count(*) FROM population").fetchone()[0], kept)
        self.assertEqual(con.execute("SELECT feature_count FROM gpkg_ogr_contents").fetchone()[0], kept)
        min_x, max_x = con.execute("SELECT min_x, max_x FROM gpkg_contents").fetchone()
        self.assertGreater(max_x, min_x)
        con.execute("INSERT INTO population (geom, h3, population) VALUES (NULL, 'x', 1)")   # the triggers still run
        self.assertEqual(con.execute("SELECT feature_count FROM gpkg_ogr_contents").fetchone()[0], kept + 1)
        con.close()


if __name__ == "__main__":
    unittest.main()
