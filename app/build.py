#!/usr/bin/env python3
"""
Write app/files.json: the files the app loads into the browser's Python to run the engine,
as paths relative to the repository root. The engine is busnet/, measure.py and redesign.py; each city
brings its settings (cities/<city>.toml) and its inputs (data/cities/<city>/).

Usage:
  python3 app/build.py            # the cities whose inputs are in git (Riga)
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITIES = ["riga"]


def main():
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "busnet").glob("*.py"))
    files += ["measure.py", "redesign.py"]
    cities = {}
    for city in CITIES:
        inputs = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "data" / "cities" / city).iterdir() if p.is_file())
        cities[city] = {"config": f"cities/{city}.toml", "inputs": inputs,
                        "results": sorted(str(p.relative_to(ROOT)) for p in (ROOT / "output" / "cities" / city).iterdir() if p.is_file()),
                        "redesign": sorted(str(p.relative_to(ROOT)) for p in (ROOT / "output" / "cities" / city / "redesign").iterdir() if p.is_file())}
    out = ROOT / "app" / "files.json"
    out.write_text(json.dumps({"engine": files, "cities": cities}, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}: {len(files)} engine files, cities {', '.join(cities)}")


if __name__ == "__main__":
    main()
