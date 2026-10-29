#!/usr/bin/env python3
"""
Write src/lib/busroute/bike.json, Baku's bicycle lanes and bicycle parking for the bus
planner's map and journeys (#692).

Both are AYNA's (Azərbaycan Yerüstü Nəqliyyat Agentliyi) open data on opendata.az, under
CC0 (Creative Commons CCZero), as KMZ files exported from Google Earth:

  Velosiped zolaqlarının coğrafi koordinatları (the lanes)
    https://opendata.az/@azerbaycan-yerustu-neqliyyat-agentliyi/velosiped-zolaqlarinin-cografi-koordinatlari
    movcud-zolaqlar-velo.kmz, layer "Mövcud zolaqlar" (existing lanes)
  Velosiped parkinq məntəqələrinin coğrafi koordinatları (the parking)
    https://opendata.az/@azerbaycan-yerustu-neqliyyat-agentliyi/velosiped-parkinq-menteqelerinin-cografi-koordinatlari
    mpv-v-mps.-son.kmz, layer "velosiped məntəqələri yeni"

Download both from those pages (DOWNLOADS below has the files' own addresses), then:

    python3 scripts/bus/build_bike_json.py movcud-zolaqlar-velo.kmz mpv-v-mps.-son.kmz

Standard library only. What it decides, so that the planner does not have to:

- Only the named layer of each file is read. The parking file also carries 649 points
  named MPS-* under "My Places", left out on purpose: the file's name (mpv-v-mps) pairs
  them with the MPV racks and the dataset's Russian title ("Координаты велосипедов и
  самокатов", bicycles and scooters) has a second kind of vehicle, so they read as
  scooter parking, while only the MPV layer is named for bicycles. The file also holds
  Google Earth's own sample places (the Eiffel Tower, Sydney) and an older lane layer
  ("Velosiped yolları 2025 yanvar").
- A lane with fewer than two points is left out and named on stderr. The file of
  24 September 2026 has one, an empty record for 8 Noyabr pr.
- A placemark with more than one geometry stops the build rather than lose all but the
  first, and so does a point outside the box around Baku and Absheron that the metro
  uses: that is a broken coordinate, not a lane or a rack (#685).
- Coordinates keep six decimals (about 0.1 m) and are written [latitude, longitude], the
  planner's order; KML writes longitude first.
- The files' SHA-256 are recorded, so a refresh shows whether AYNA changed anything.
"""

import hashlib
import json
import math
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent.parent / "src" / "lib" / "busroute" / "bike.json"
KML = "{http://www.opengis.net/kml/2.2}"
EARTH_RADIUS_KM = 6371.0
# The box around Baku and Absheron that build_metro_json.py checks stations against.
BAKU = ((40.2, 40.7), (49.5, 50.4))
DATASETS = "https://opendata.az/@azerbaycan-yerustu-neqliyyat-agentliyi/"
DOWNLOADS = "https://admin.opendata.az/dataset/"
LANES = {
    "dataset": DATASETS + "velosiped-zolaqlarinin-cografi-koordinatlari",
    "download": DOWNLOADS + "74727856-3e72-4d49-ab34-9d4aac8f4ab0/resource/f0bccfe6-0639-46a7-8cfe-7e5f1be741d8/download/movcud-zolaqlar-velo.kmz",
    "layer": "Mövcud zolaqlar",
}
PARKING = {
    "dataset": DATASETS + "velosiped-parkinq-menteqelerinin-cografi-koordinatlari",
    "download": DOWNLOADS + "8d61b508-7f13-4219-984f-08d769c61251/resource/6902ae9f-e2ae-4c20-bdee-6fd55c701645/download/mpv-v-mps.-son.kmz",
    "layer": "velosiped məntəqələri yeni",
}


def km(a, b):
    """Great-circle distance in km between two (lat, lon) points."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def in_baku(point):
    (south, north), (west, east) = BAKU
    return south <= point[0] <= north and west <= point[1] <= east


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def placemarks(path, layer):
    """[(name, [(lat, lon), ...]), ...] for the placemarks of the layer named `layer`."""
    with zipfile.ZipFile(path) as kmz:
        raw = kmz.read("doc.kml")
    # Google Earth writes no DTD, and one could expand entities without limit.
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        sys.exit(f"{path}: the KML declares a DTD, which this script does not read")
    folders = [f for f in ET.fromstring(raw).iter(KML + "Folder") if (f.findtext(KML + "name") or "").strip() == layer]
    if len(folders) != 1:
        sys.exit(f"{path}: expected one layer named {layer!r}, found {len(folders)}")
    out = []
    for placemark in folders[0].findall(KML + "Placemark"):
        name = (placemark.findtext(KML + "name") or "").strip()
        geometries = placemark.findall(".//" + KML + "coordinates")
        if len(geometries) > 1:
            sys.exit(f"{path}: {name!r} has {len(geometries)} geometries; this script reads one")
        points = []
        for item in (geometries[0].text or "").split() if geometries else []:
            lon, lat = (float(v) for v in item.split(",")[:2])
            points.append((round(lat, 6), round(lon, 6)))
        out.append((name, points))
    if not out:
        sys.exit(f"{path}: the layer {layer!r} has no placemarks")
    return out


def main(argv):
    if len(argv) != 3:
        sys.exit("usage: build_bike_json.py <movcud-zolaqlar-velo.kmz> <mpv-v-mps.-son.kmz>")
    lanes_kmz, parking_kmz = Path(argv[1]).resolve(), Path(argv[2]).resolve()

    lanes = []
    for street, points in placemarks(lanes_kmz, LANES["layer"]):
        if len(points) < 2:
            print(f"left out: the lane {street!r} has {len(points)} point(s)", file=sys.stderr)
            continue
        lanes.append({"street": street, "path": [list(p) for p in points]})
    parking = []
    for name, points in placemarks(parking_kmz, PARKING["layer"]):
        if len(points) != 1:
            sys.exit(f"{parking_kmz}: the parking {name!r} has {len(points)} points, not one")
        parking.append({"name": name, "latitude": points[0][0], "longitude": points[0][1]})

    outside = [lane["street"] for lane in lanes if not all(in_baku(p) for p in lane["path"])]
    outside += [p["name"] for p in parking if not in_baku((p["latitude"], p["longitude"]))]
    if outside:
        sys.exit(f"outside Baku and Absheron, a broken coordinate: {outside}")
    names = [p["name"] for p in parking]
    if len(set(names)) != len(names) or not all(names):
        sys.exit("the parking names are not unique and non-empty")

    source = {
        "publisher": "Azərbaycan Yerüstü Nəqliyyat Agentliyi (AYNA), opendata.az",
        "license": "CC0 1.0 (Creative Commons CCZero)",
        "read": date.today().isoformat(),
        "lanes": {**LANES, "sha256": sha256(lanes_kmz)},
        "parking": {**PARKING, "sha256": sha256(parking_kmz)},
    }

    def rows(items):
        return "[\n" + ",\n".join("  " + json.dumps(i, ensure_ascii=False, separators=(",", ":")) for i in items) + "\n]"

    OUT.write_text("{\n" + ",\n".join([
        f'"source": {json.dumps(source, ensure_ascii=False)}',
        f'"lanes": {rows(lanes)}',
        f'"parking": {rows(parking)}',
    ]) + "\n}\n", encoding="utf-8")
    length = sum(km(a, b) for lane in lanes for a, b in zip(lane["path"], lane["path"][1:]))
    print(f"wrote {OUT}: {len(lanes)} lanes on {len({lane['street'] for lane in lanes})} streets, "
          f"{length:.1f} km; {len(parking)} parking places")


if __name__ == "__main__":
    main(sys.argv)
