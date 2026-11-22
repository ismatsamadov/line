#!/usr/bin/env python3
"""
Fit the demand model's settings to the boardings BakuBus counts, and check the fit on
routes it was not fitted to.

The demand model spreads each origin's trips over every zone in proportion to the zone's
pull x exp(-distance / trip_decay_km); a zone's pull mixes its population with the
destinations near it (destination_share), among them the metro stations, which weigh
metro_weight_per_1000_entries for every 1,000 daily entries. This script tries a grid of
the three settings and scores each by how well the modelled boardings rank the 56 counted
BakuBus routes (Spearman), with headways that do not come from the counts, as the fair
step of robustness.py's fit ladder. To judge the fit honestly it is cross-validated: the
routes are split into five folds, the settings are chosen on four and the fifth is
predicted with them, two hundred times over. The settings and the fit on fresh samples of
origins are checked last.

The paths of every trip do not depend on these settings, so they are found once
(busnet/calibration.py) and the trips are spread again for each setting.

Writes to ./output/calibration/ (or --out):
  grid.csv        every setting tried: its fit on all 56 routes and the average length of its trips
  grid_routes.csv every setting's modelled share of each counted route
  cv.csv          each cross-validation repeat, among all settings and among those whose trips are
                  at least as long as today's: the fit on routes held out, and the settings chosen
  routes.csv      each counted route: observed and modelled shares at today's and the fitted settings
  tradeoff.csv    for each least average trip length, the cross-validated fit among the settings
                  whose trips are at least that long: how much a realistic trip length costs
  summary.json    the fit at today's settings on many samples, the best setting, the
                  cross-validated fits, the check on fresh samples, the official average bus
                  trip, and the settings used

Standard library only, about twenty-five minutes. Usage:
  python3 calibrate.py
  python3 calibrate.py --tradeoff-only     # rewrite tradeoff.csv from a finished run, in seconds
"""

import argparse
import csv
import json
import random
import statistics
import sys
import time
from collections import Counter
from dataclasses import asdict, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from busnet import calibration                                                 # noqa: E402
from busnet.config import settings_file                                        # noqa: E402
from busnet.destinations import metro_points, zone_attraction                  # noqa: E402
from busnet.inputs import load_inputs                                          # noqa: E402
from busnet.metrics import compare_ridership                                   # noqa: E402
from busnet.population import load_population, stops_bbox                     # noqa: E402
from busnet.service import route_headways                                      # noqa: E402

DECAYS_KM = (1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30)
SHARES = (0, 0.25, 0.4, 0.5, 0.6, 0.75, 1.0)
METRO_WEIGHTS = (0, 1, 2, 4, 8)          # per 1,000 daily entries; today's is 2
ORIGINS = 2000                           # origins per sample; 300 leave the fit uncertain by about 0.04
SEED = 7                                 # the sample the grid is scored on
NOISE_SEEDS = (1, 2, 3, 4, 5)            # samples that show how much the fit moves with the sample
FRESH_SEEDS = (101, 102, 103)            # samples the chosen settings are checked on
FOLDS, REPEATS = 5, 200


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})


def spearman(xs, ys):
    """Spearman's rank correlation, ties given their mean rank."""
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        out = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2
            i = j + 1
        return out
    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sxx = sum((a - mx) ** 2 for a in rx)
    syy = sum((b - my) ** 2 for b in ry)
    return sxy / (sxx * syy) ** 0.5 if sxx and syy else 0.0


def official_trip_km():
    """The State Statistical Committee's average trip of a bus passenger in Azerbaijan, latest
    year (data/external/opendata/stat_avg_trip_distance.csv): buses of every kind, city and
    intercity, along the road."""
    path = ROOT / "data" / "external" / "opendata" / "stat_avg_trip_distance.csv"
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r["INDICATOR"] == "Avtobus"]
    last = max(rows, key=lambda r: int(r["TIME_PERIOD"]))
    return {"year": int(last["TIME_PERIOD"]), "km": float(last["OBS_VALUE"])}


def settings_to_score(today):
    """Every setting of the grid, (trip_decay_km, destination_share, metro weight), and today's
    after them when they fall between the grid's points, so that today's are always scored."""
    grid = [(d, s, m) for d in DECAYS_KM for s in SHARES for m in METRO_WEIGHTS]
    return grid if today in grid else grid + [today]


def pulls(fine, points, metro, keys):
    """{(destination_share, metro weight): each zone's pull} for the (share, weight) keys;
    population alone at share 0. points are the destinations besides the metro; metro, the
    metro exits weighing one for every 1,000 daily entries (destinations.metro_points with
    1), scaled by each weight, so a weight of 0 today takes no counts away from the others."""
    population = [z[2] for z in fine]
    out = {}
    for s, m in keys:
        scaled = points + [(lat, lon, w * m, kind) for lat, lon, w, kind in metro]
        out[(s, m)] = zone_attraction(fine, scaled, s) or population
    return out


def score(network, settings, origins, distances, rides, pull, observed, numbers, say=print):
    """Each setting scored on one sample of trips (calibration.trip_paths): (grid, trip_km, rows,
    route_rows), its modelled boardings of the counted routes in the order of numbers, its
    average straight-line trip, and its rows of grid.csv and grid_routes.csv. pull holds each
    (share, metro weight) of the settings (pulls); observed, the counted boardings by route number."""
    grid, trip_km, rows, route_rows = {}, {}, [], []
    for decay in dict.fromkeys(k[0] for k in settings):
        dw = calibration.decay_weights(distances, decay)
        for key in (k for k in settings if k[0] == decay):
            _, s, m = key
            b, km = calibration.spread(origins, rides, dw, pull[(s, m)], distances)
            mod = counted_boardings(network, b, numbers)
            grid[key], trip_km[key] = mod, km
            fit = compare_ridership(network, b, observed)[1]
            rows.append({"trip_decay_km": decay, "destination_share": s, "metro_weight_per_1000_entries": m,
                         "mean_trip_km_straight_line": km,
                         "spearman": fit["spearman"], "pearson_of_log_shares": fit["pearson_of_log_shares"]})
            total = sum(mod) or 1
            route_rows += [{"trip_decay_km": decay, "destination_share": s, "metro_weight_per_1000_entries": m,
                            "route": n, "modelled_share": f"{v / total:.8g}"} for n, v in zip(numbers, mod)]
        del dw
        say(f"  decay {decay:4g} km done")
    return grid, trip_km, rows, route_rows


def counted_boardings(network, boardings, numbers):
    """Modelled boardings of the counted routes, in the order of numbers."""
    by_number = {network.routes[k].number: v for k, v in boardings.items()}
    return [by_number.get(n, 0.0) for n in numbers]


def cross_validate(observed, grid, rng, today):
    """One repeat: the routes split into FOLDS folds; for each, the setting with the best fit on
    the others predicts it, today's settings winning a tie. Returns (Spearman of the held-out
    predictions over all routes, the settings chosen)."""
    n = len(observed)
    order = list(range(n))
    rng.shuffle(order)
    folds = [order[k::FOLDS] for k in range(FOLDS)]
    shares = {key: [v / (sum(mod) or 1) for v in mod] for key, mod in grid.items()}
    predicted = [0.0] * n
    chosen = []
    for test in folds:
        train = [i for i in range(n) if i not in set(test)]
        obs_train = [observed[i] for i in train]
        best = max(grid, key=lambda key: (spearman(obs_train, [grid[key][i] for i in train]), key == today))
        chosen.append(best)
        for i in test:
            predicted[i] = shares[best][i]
    return spearman(observed, predicted), chosen


TRADEOFF_KM = (0, 2, 3, 4, 5, 6, 7, 8)   # the least average straight-line trip a setting may give


def tradeoff(observed, grid, trip_km, today):
    """For each least trip length, the cross-validated fit when the settings are chosen only among
    those whose average straight-line trip is at least that long."""
    rows = []
    for least in TRADEOFF_KM + (trip_km[today],):
        candidates = {k: v for k, v in grid.items() if trip_km[k] >= least - 1e-9}
        rng = random.Random(11)
        fits, chosen = [], Counter()
        for _ in range(REPEATS):
            fit, keys = cross_validate(observed, candidates, rng, today)
            fits.append(fit)
            chosen.update(keys)
        top = chosen.most_common(1)[0][0]
        rows.append({"least_trip_km": least, "settings": len(candidates),
                     "spearman_held_out_mean": statistics.fmean(fits), "spearman_held_out_sd": statistics.stdev(fits),
                     "chosen_most": f"{top[0]:g}/{top[1]:g}/{top[2]:g}", "chosen_most_times": chosen[top],
                     "chosen_most_trip_km": trip_km[top], "chosen_most_spearman_all_routes": spearman(observed, grid[top])})
    return rows


def tradeoff_from_files(out):
    """The trade-off again from grid.csv, grid_routes.csv and routes.csv of a finished run."""
    def read(name):
        with open(out / name, newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    key = lambda r: (float(r["trip_decay_km"]), float(r["destination_share"]), float(r["metro_weight_per_1000_entries"]))
    routes = read("routes.csv")
    numbers = [r["route"] for r in routes]
    observed = [float(r["observed_weekday_boardings"]) for r in routes]
    trip_km = {key(r): float(r["mean_trip_km_straight_line"]) for r in read("grid.csv")}
    shares = {}
    for r in read("grid_routes.csv"):
        shares.setdefault(key(r), {})[r["route"]] = float(r["modelled_share"])
    grid = {k: [v[n] for n in numbers] for k, v in shares.items()}
    s = json.loads((out / "summary.json").read_text(encoding="utf-8"))["today"]
    today = (float(s["trip_decay_km"]), float(s["destination_share"]), float(s["metro_weight_per_1000_entries"]))
    return tradeoff(observed, grid, trip_km, today)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "busnet.toml"), help="settings file (TOML); 'none' for defaults only")
    ap.add_argument("--out", default=str(ROOT / "output" / "calibration"))
    ap.add_argument("--origins", type=int, default=ORIGINS)
    ap.add_argument("--tradeoff-only", action="store_true",
                    help="only rewrite tradeoff.csv, from the grid files of a finished run in --out")
    args = ap.parse_args()
    if args.tradeoff_only:
        rows = tradeoff_from_files(Path(args.out))
        write_csv(Path(args.out) / "tradeoff.csv", rows)
        for r in rows:
            print(f"trips at least {r['least_trip_km']:4.1f} km ({r['settings']:3d} settings): held-out Spearman "
                  f"{r['spearman_held_out_mean']:.3f} +- {r['spearman_held_out_sd']:.3f}, chosen most {r['chosen_most']}")
        return

    config = settings_file(args.config)
    config = str(Path(config).resolve()) if config else None
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    inp = load_inputs(ROOT, config, [], split=False)
    a, net = inp.a, inp.network
    if not inp.zones or not inp.observed:
        sys.exit("The calibration needs population and ridership data: see data.population and data.ridership in busnet.toml")
    fine = load_population(inp.data["population"], stops_bbox(net), split=True)
    fair = replace(a, headway_from_ridership=False)
    headways = route_headways(net, fair, inp.observed, inp.supplied)
    served = {r.number for k, r in net.routes.items() if net.patterns_of(k)}
    numbers = sorted(n for n in inp.observed if n in served)
    observed = [inp.observed[n] for n in numbers]
    today_key = (a.trip_decay_km, a.destination_share, a.metro_weight_per_1000_entries)
    print(f"{len(numbers)} counted routes; {len(fine):,} zones; {args.origins:,} origins a sample")

    settings = settings_to_score(today_key)
    others = [pt for pt in inp.points if pt[3] != "metro"]
    metro = []
    if inp.found.get("metro_passengers") and inp.found.get("metro_exits"):
        metro = metro_points(inp.data["metro_passengers"], inp.data["metro_exits"], 1.0)[0]
    pull = pulls(fine, others, metro, dict.fromkeys(k[1:] for k in settings))

    # How much the fit at today's settings moves from one sample of origins to another.
    noise = []
    for seed in NOISE_SEEDS:
        o, d, r = calibration.trip_paths(net, fair, fine, args.origins, seed=seed, headways=headways)
        b = calibration.boardings(o, r, calibration.decay_weights(d, a.trip_decay_km), pull[(a.destination_share, a.metro_weight_per_1000_entries)])
        noise.append(spearman(observed, counted_boardings(net, b, numbers)))
        del o, d, r
    print(f"today's settings on {len(NOISE_SEEDS)} samples: Spearman {statistics.fmean(noise):.3f} +- {statistics.stdev(noise):.3f}")

    # The grid, on one sample: every setting's boardings on the counted routes, its fit and
    # the average length of its trips.
    origins, distances, rides = calibration.trip_paths(net, fair, fine, args.origins, seed=SEED, headways=headways)
    grid, trip_km, rows, route_rows = score(net, settings, origins, distances, rides, pull, inp.observed, numbers,
                                            lambda line: print(f"{line} ({time.time() - t0:.0f}s)", flush=True))
    del distances
    write_csv(out / "grid.csv", rows)
    write_csv(out / "grid_routes.csv", route_rows)
    best_key = max(grid, key=lambda k: spearman(observed, grid[k]))
    best_fit = spearman(observed, grid[best_key])
    today_fit = spearman(observed, grid[today_key])
    print(f"today's settings {today_key}: {today_fit:.3f}, trips {trip_km[today_key]:.1f} km; "
          f"best of {len(grid)} {best_key}: {best_fit:.3f}, trips {trip_km[best_key]:.1f} km")

    # Cross-validation: settings chosen on four fifths of the routes, judged on the fifth; once
    # among all settings, and once among those whose trips are at least as long as today's.
    realistic = {k: v for k, v in grid.items() if trip_km[k] >= trip_km[today_key] - 1e-9}
    cv_rows, results = [], {}
    for name, candidates in (("all", grid), ("realistic", realistic)):
        rng = random.Random(11)
        chosen, fits = Counter(), []
        for rep in range(1, REPEATS + 1):
            fit, keys = cross_validate(observed, candidates, rng, today_key)
            chosen.update(keys)
            fits.append(fit)
            cv_rows.append({"candidates": name, "repeat": rep, "spearman_held_out": fit,
                            "settings_chosen": " ".join(f"{k[0]:g}/{k[1]:g}/{k[2]:g}" for k in keys)})
        results[name] = (fits, chosen)
        print(f"cross-validated among {name} settings ({len(candidates)}): Spearman {statistics.fmean(fits):.3f} +- {statistics.stdev(fits):.3f}; "
              f"chosen most {chosen.most_common(1)[0][0]}")
    write_csv(out / "cv.csv", cv_rows)
    write_csv(out / "tradeoff.csv", tradeoff(observed, grid, trip_km, today_key))

    # The settings chosen most often, and today's, on fresh samples of origins.
    final = {name: chosen.most_common(1)[0][0] for name, (_, chosen) in results.items()}
    fresh = []
    for seed in FRESH_SEEDS:
        o, d, r = calibration.trip_paths(net, fair, fine, args.origins, seed=seed, headways=headways)
        row = {"seed": seed}
        for name, key in (("today", today_key), ("fitted", final["all"]), ("fitted_realistic", final["realistic"])):
            b, km = calibration.spread(o, r, calibration.decay_weights(d, key[0]), pull[(key[1], key[2])], d)
            row[name] = spearman(observed, counted_boardings(net, b, numbers))
            row[name + "_trip_km"] = km
        fresh.append(row)
        del o, d, r
    print("fresh samples (today, fitted, fitted among realistic): "
          + "; ".join(f"{r['today']:.3f}, {r['fitted']:.3f}, {r['fitted_realistic']:.3f}" for r in fresh))

    shares = {k: [v / (sum(grid[k]) or 1) for v in grid[k]] for k in (today_key, final["all"], final["realistic"])}
    obs_total = sum(observed)
    write_csv(out / "routes.csv", [{"route": n, "observed_weekday_boardings": o, "observed_share": o / obs_total,
                                    "modelled_share_today": shares[today_key][i],
                                    "modelled_share_fitted": shares[final["all"]][i],
                                    "modelled_share_fitted_realistic": shares[final["realistic"]][i]}
                                   for i, (n, o) in enumerate(zip(numbers, observed))])
    key_dict = lambda k: {"trip_decay_km": k[0], "destination_share": k[1], "metro_weight_per_1000_entries": k[2],
                          "mean_trip_km_straight_line": trip_km[k]}
    cv_dict = lambda name: {"candidates": len(grid if name == "all" else realistic), "folds": FOLDS, "repeats": REPEATS,
                            "spearman_mean": statistics.fmean(results[name][0]), "spearman_sd": statistics.stdev(results[name][0]),
                            "settings_chosen_most": [{**key_dict(k), "times": c} for k, c in results[name][1].most_common(5)]}
    summary = {
        "routes_compared": len(numbers),
        "origins_per_sample": args.origins,
        "today": {**key_dict(today_key), "spearman_on_grid_sample": today_fit,
                  "spearman_over_samples": {"mean": statistics.fmean(noise), "sd": statistics.stdev(noise),
                                            "seeds": list(NOISE_SEEDS), "values": noise}},
        "best_on_all_routes": {**key_dict(best_key), "spearman": best_fit},
        "cross_validated": cv_dict("all"),
        "cross_validated_realistic": {**cv_dict("realistic"),
                                      "rule": "settings whose average straight-line trip is at least today's"},
        "fitted": key_dict(final["all"]),
        "fitted_realistic": key_dict(final["realistic"]),
        "fresh_samples": fresh,
        "official_average_bus_trip_km": official_trip_km(),
        "grid": {"trip_decay_km": list(DECAYS_KM), "destination_share": list(SHARES),
                 "metro_weight_per_1000_entries": list(METRO_WEIGHTS), "grid_seed": SEED,
                 "settings_scored": len(grid)},
        "settings": asdict(fair),
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {out.resolve()} in {time.time() - t0:.0f}s")

if __name__ == "__main__":
    main()
