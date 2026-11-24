# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Load gridded population as (lat, lon, people) zones, using only the standard library.

Supported inputs:
  - GeoPackage (.gpkg), e.g. Kontur Population, with polygon or point features and a
    population column; each polygon becomes seven points that share its population
  - CSV with latitude, longitude and population columns (header names are matched loosely)
Zones are clipped to a bounding box, normally the served stops plus a margin."""

import csv
import math
import sqlite3
import struct

WEB_MERCATOR_R = 6378137.0


def _mercator_to_latlon(x, y):
    lon = math.degrees(x / WEB_MERCATOR_R)
    lat = math.degrees(2 * math.atan(math.exp(y / WEB_MERCATOR_R)) - math.pi / 2)
    return lat, lon


# A hexagon split into seven equal parts, the way H3 subdivides a cell: its centre and
# six points at 0.655 of the circumradius (about a third of the envelope's larger side).
SPLIT = [(0.0, 0.0)] + [(math.cos(math.radians(60 * k)), math.sin(math.radians(60 * k))) for k in range(6)]


def _gpkg_shape(blob):
    """(centre_x, centre_y, width, height) of a GeoPackage geometry.

    Width and height come from the envelope; without one they are 0 and the
    centre is the mean of the vertices."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    flags = blob[3]
    order = "<" if flags & 1 else ">"
    env_len = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    if env_len:
        minx, maxx, miny, maxy = struct.unpack(order + "4d", blob[8:40])
        return (minx + maxx) / 2, (miny + maxy) / 2, maxx - minx, maxy - miny
    wkb = blob[8:]
    worder = "<" if wkb[0] == 1 else ">"
    gtype = struct.unpack(worder + "I", wkb[1:5])[0] % 1000
    if gtype == 1:                                           # point
        return (*struct.unpack(worder + "2d", wkb[5:21]), 0.0, 0.0)
    if gtype == 6:                                           # multipolygon: use the first polygon
        wkb = wkb[9:]
        worder = "<" if wkb[0] == 1 else ">"
    if struct.unpack(worder + "I", wkb[1:5])[0] % 1000 != 3:
        raise ValueError("unsupported geometry type")
    npts = struct.unpack(worder + "I", wkb[9:13])[0]
    coords = struct.unpack(worder + f"{2 * npts}d", wkb[13:13 + 16 * npts])
    xs, ys = coords[0::2][:-1] or coords[0::2], coords[1::2][:-1] or coords[1::2]
    return sum(xs) / len(xs), sum(ys) / len(ys), max(xs) - min(xs), max(ys) - min(ys)


def _features(con):
    """(table, geometry column, srs id) of a GeoPackage's first features table."""
    return con.execute(
        "SELECT c.table_name, g.column_name, g.srs_id FROM gpkg_contents c "
        "JOIN gpkg_geometry_columns g ON g.table_name = c.table_name "
        "WHERE c.data_type = 'features' LIMIT 1").fetchone()


def load_gpkg(path, bbox=None, split=True):
    """Zones from a GeoPackage. With split=True each polygon becomes seven points
    sharing its population, so coverage is not judged from the centre alone."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    table, geom_col, srs = _features(con)
    cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
    pop_col = next((c for c in cols if c.lower() in ("population", "pop", "people")), None)
    if pop_col is None:
        raise ValueError(f"no population column in {table}: {cols}")
    zones = []
    for blob, pop in con.execute(f'SELECT "{geom_col}", "{pop_col}" FROM "{table}"'):
        if not blob or not pop:
            continue
        cx, cy, w, h = _gpkg_shape(blob)
        step = 0.33 * max(w, h)
        pts = [(cx + dx * step, cy + dy * step) for dx, dy in SPLIT] if split and step else [(cx, cy)]
        share = float(pop) / len(pts)
        for x, y in pts:
            lat, lon = _mercator_to_latlon(x, y) if srs == 3857 else (y, x)
            if bbox is None or (bbox[0] <= lat <= bbox[1] and bbox[2] <= lon <= bbox[3]):
                zones.append((lat, lon, share))
    con.close()
    return zones


def cut_gpkg(src, dst, bbox):
    """Write to dst a GeoPackage with src's tables and only the features whose centre lies in
    bbox (min_lat, max_lat, min_lon, max_lon), in src's order, so that load_gpkg reads the
    same zones from either within a box that bbox holds with a cell's width to spare. The
    feature count and extent are set to the features kept."""
    con = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    table, geom_col, srs = _features(con)
    out = sqlite3.connect(dst)
    for pragma in ("application_id", "user_version"):
        out.execute(f"PRAGMA {pragma} = {con.execute(f'PRAGMA {pragma}').fetchone()[0]}")
    schema = con.execute("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE "
                         "'sqlite_%' AND name NOT LIKE 'rtree_%' ORDER BY type = 'trigger'").fetchall()   # no index kept
    for kind, name, sql in schema:
        if kind != "trigger":
            out.execute(sql)
    cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
    at = cols.index(geom_col)
    kept, box = [], [math.inf, math.inf, -math.inf, -math.inf]
    for row in con.execute(f'SELECT * FROM "{table}"'):
        if not row[at]:
            continue
        cx, cy, w, h = _gpkg_shape(row[at])
        lat, lon = _mercator_to_latlon(cx, cy) if srs == 3857 else (cy, cx)
        if bbox[0] <= lat <= bbox[1] and bbox[2] <= lon <= bbox[3]:
            kept.append(row)
            box = [min(box[0], cx - w / 2), min(box[1], cy - h / 2), max(box[2], cx + w / 2), max(box[3], cy + h / 2)]
    out.executemany(f'INSERT INTO "{table}" VALUES ({", ".join("?" * len(cols))})', kept)
    for kind, name, sql in schema:
        if kind == "table" and name != table:
            rows = con.execute(f'SELECT * FROM "{name}"').fetchall()
            if rows:
                out.executemany(f'INSERT INTO "{name}" VALUES ({", ".join("?" * len(rows[0]))})', rows)
    if kept:
        out.execute("UPDATE gpkg_contents SET min_x = ?, min_y = ?, max_x = ?, max_y = ? WHERE table_name = ?",
                    (*box, table))
    if out.execute("SELECT 1 FROM sqlite_master WHERE name = 'gpkg_ogr_contents'").fetchone():
        out.execute("UPDATE gpkg_ogr_contents SET feature_count = ? WHERE table_name = ?", (len(kept), table))
    if out.execute("SELECT 1 FROM sqlite_master WHERE name = 'gpkg_extensions'").fetchone():
        out.execute("DELETE FROM gpkg_extensions WHERE extension_name = 'gpkg_rtree_index'")
    for kind, name, sql in schema:
        if kind == "trigger":
            out.execute(sql)
    out.commit()
    out.execute("VACUUM")
    out.close()
    con.close()
    return len(kept)


def load_csv(path, bbox=None):
    zones = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        names = {n.lower(): n for n in reader.fieldnames}
        lat_k = next(names[n] for n in names if n in ("lat", "latitude", "y"))
        lon_k = next(names[n] for n in names if n in ("lon", "lng", "longitude", "x"))
        pop_k = next(names[n] for n in names if "pop" in n)
        for row in reader:
            lat, lon, pop = float(row[lat_k]), float(row[lon_k]), float(row[pop_k] or 0)
            if pop > 0 and (bbox is None or (bbox[0] <= lat <= bbox[1] and bbox[2] <= lon <= bbox[3])):
                zones.append((lat, lon, pop))
    return zones


def load_population(path, bbox=None, split=True):
    return load_gpkg(path, bbox, split) if str(path).lower().endswith(".gpkg") else load_csv(path, bbox)


def stops_bbox(network, margin_km=2.0):
    """(min_lat, max_lat, min_lon, max_lon) of served stops, widened by margin_km."""
    stops = [network.stops[s] for s in network.served_stop_ids()]
    dlat = margin_km / 111.2
    mid = sum(s.lat for s in stops) / len(stops)
    dlon = margin_km / (111.2 * math.cos(math.radians(mid)))
    return (min(s.lat for s in stops) - dlat, max(s.lat for s in stops) + dlat,
            min(s.lon for s in stops) - dlon, max(s.lon for s in stops) + dlon)
