#!/usr/bin/env python3
"""
Download the world pilot's files, as the committed results were made from them, from the
Hugging Face dataset that holds them: each city's inputs in data/cities/<city>/ (its GTFS
feed, Kontur's population grid cut to it, and OpenStreetMap's destinations) and the two feeds
and the map redesign.py writes for it in output/cities/<city>/redesign/. They stay out of git
(.gitignore) because of their size; data/world_files.csv lists each with its size and SHA-256,
and every download is checked against it. Riga's are in git too, so they are not listed.

data/fetch_city.py downloads a city's inputs from their publishers instead, as they are on the
day: newer feeds, which give other results than the committed ones.

Standard library only. Usage (from the repository root):
  python3 data/fetch_world.py              # download the files that are missing or differ
  python3 data/fetch_world.py --check      # only say which are missing or differ
  python3 data/fetch_world.py --manifest   # list the files here in data/world_files.csv, after a new run
"""

import argparse
import csv
import hashlib
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data"))

import fetch_external                                                           # noqa: E402

DATASET = "ismatsamadov/route-efficiency-cities"
REVISION = "995a3976ce78ca54bb6a83aa7c6a740ac0b9c6f5"   # the dataset's commit that data/world_files.csv describes
URL = "https://huggingface.co/datasets/{}/resolve/{}/{}"
MANIFEST = ROOT / "data" / "world_files.csv"
# The files that live in the dataset rather than in git, as .gitignore lists them.
PATTERNS = ("data/cities/*/*", "output/cities/*/redesign/gtfs_*.zip", "output/cities/*/redesign/network.geojson")
IN_GIT = {"riga"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def local_files():
    """The files here that belong in the dataset, by their path from the repository root."""
    found = set()
    for pattern in PATTERNS:
        for p in ROOT.glob(pattern):
            if p.is_file() and p.parts[len(ROOT.parts) + 2] not in IN_GIT:
                found.add(p.relative_to(ROOT).as_posix())
    return sorted(found)


def write_manifest():
    rows = [{"path": rel, "bytes": (ROOT / rel).stat().st_size, "sha256": sha256(ROOT / rel)} for rel in local_files()]
    with open(MANIFEST, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["path", "bytes", "sha256"], lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {MANIFEST.relative_to(ROOT)}: {len(rows)} files, {sum(r['bytes'] for r in rows) / 1e6:,.0f} MB")


def read_manifest():
    with open(MANIFEST, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only list the files that are missing or differ")
    ap.add_argument("--manifest", action="store_true", help="write data/world_files.csv from the files here")
    args = ap.parse_args()
    if args.manifest:
        write_manifest()
        return
    rows = read_manifest()
    todo = [r for r in rows if not (ROOT / r["path"]).exists() or sha256(ROOT / r["path"]) != r["sha256"]]
    print(f"{len(rows)} files listed, {len(todo)} missing or different "
          f"({sum(int(r['bytes']) for r in todo) / 1e6:,.0f} MB)")
    if args.check:
        for r in todo:
            print(f"  {r['path']}")
        return
    failed = []
    for r in todo:
        url = URL.format(DATASET, REVISION, urllib.parse.quote(r["path"]))
        try:
            body = fetch_external.fetch(url, timeout=1800)
        except RuntimeError as e:
            failed.append(f"{r['path']}: {e}")
            continue
        if hashlib.sha256(body).hexdigest() != r["sha256"]:
            failed.append(f"{r['path']}: the download does not match its SHA-256 in {MANIFEST.name}")
            continue
        fetch_external.save(ROOT / r["path"], body)
    if failed:
        sys.exit("Failed (run again later):\n  " + "\n  ".join(failed))


if __name__ == "__main__":
    main()
