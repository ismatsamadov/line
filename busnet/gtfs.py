"""Read a GTFS feed into a network, and write a network back out as GTFS.

GTFS is the format transit agencies publish their timetables in, so reading it lets every
measurement and the redesign search run on any city with a feed, not only on the AYNA
snapshot.

Reading takes one service day: gtfs_date, or else the weekday with the most bus trips. Each
route direction becomes one stop pattern, the sequence most of its departures run.
Departures that run a part of it (short turns) count towards its frequency in proportion
to the distance they cover. A branch, a sequence with stops the pattern does not have,
runs as a route of its own when it carries at least a fifth of its direction's departures
(and three), its two directions paired when their stops lie along each other; a smaller
one is left out and counted in the timetable's summary and notes. The timetable then
gives each route its trips a day in each direction (its headway; see
service.route_headways) and its moving speed: the scheduled running time less
stop_loss_s at every stop. Stops are placed on their shape by the feed's
shape_dist_traveled where it gives one, and otherwise matched to it as the AYNA snapshot's
are (model.py): a shape stored backwards is reversed, and one that cannot explain its
stops (stops out of order, or far from the line) gives way to straight lines between
them. A route that runs in one direction only is a loop, and is not counted as if it ran
back. A route is marked express when its name says so, or when nearly all its stops lie
on another route that calls at many more stops along the way, so the redesign does not
merge it into that route. The summary gives the hours in which buses leave at least a
quarter as often as in the busiest hour, the value service_hours should have.

Writing turns each route direction into one trip that repeats every headway between the
start and end of service (frequencies.txt). Times between stops follow the same model as
the metrics: distance at the route's moving speed plus the fixed loss at each stop. A feed
written with estimated headways describes the model, not an official timetable.

Shapes are the repaired route lines with two changes the MobilityData GTFS validator asks
for: a point that repeats the one before it is written once, and a line that ends before
the last stops of its direction (or starts after the first) is carried on to them in
straight lines, the way the model measures those hops."""

import bisect
import csv
import datetime
import io
import math
import re
import statistics
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from .geo import PROJ, Polyline, fit_score, haversine_m
from .model import Network, Route, Stop, _best_variant, _pattern_from, _shape_problem, _straight_pattern

FEED_URL = "https://github.com/ismatsamadov/route_efficiency"
FAR_FROM_LINE_M = 100.0      # the validator's limit for a stop's distance from its trip's shape
# Nominal. The Mobility Database, which lists today's feed, wants the last day at least a week
# ahead, a span of two years at most and no gap between versions (docs/outputs.md).
SERVICE_DATES = ("20260101", "20271231")
# The agency and language the AYNA network is written with; a network read from a feed
# passes its own (Timetable.feed).
BAKU_FEED = {"agency_id": "baku", "agency_name": "Baku buses, modelled from AYNA data",
             "agency_url": "https://ayna.gov.az", "timezone": "Asia/Baku", "lang": "az"}


# ---------------------------------------------------------------- writing

def _hms(seconds):
    seconds = int(round(seconds))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def _beyond_ends(line, pts, far_m=FAR_FROM_LINE_M):
    """How many stops at the start and at the end lie past the ends of the line: more than
    far_m from it, with the line's first (or last) point the nearest point on it."""
    def past(pt, at_end):
        offset, chainage = min(line.project_all(*pt))
        return offset > far_m and (chainage >= line.length_m - 1.0 if at_end else chainage <= 1.0)

    lead = 0
    while lead < len(pts) and past(pts[lead], False):
        lead += 1
    trail = 0
    while trail < len(pts) - lead and past(pts[-1 - trail], True):
        trail += 1
    return lead, trail


def shape_points(pattern, network):
    """(lat, lon) points of a direction's shape, reaching its first and last stops."""
    if len(pattern.path) < 2:
        return list(pattern.path)
    pts = [(network.stops[s].lat, network.stops[s].lon) for s in pattern.stop_ids]
    lead, trail = _beyond_ends(Polyline(pattern.path), pts)
    return pts[:lead] + list(pattern.path) + pts[len(pts) - trail:]


def write_gtfs(path, network, a, headways, version, start_hour=6, feed=None):
    """headways: {route id: (minutes, source)}; routes without one are left out.
    version names the network in feed_info.txt, e.g. "today" or "redesign"; feed gives the
    agency and language (keys as in BAKU_FEED, which fills in any it lacks)."""
    feed = {**BAKU_FEED, **(feed or {})}
    start = start_hour * 3600
    end = (start_hour + a.service_hours) * 3600
    served = sorted({s for (rid, _), p in network.patterns.items() if rid in headways for s in p.stop_ids})
    trips, stop_times, shapes, freqs = [], [], [], []
    for (rid, d), p in sorted(network.patterns.items()):
        if rid not in headways:
            continue
        trip, shape = f"{rid}_{d}", f"shape_{rid}_{d}"
        trips.append([rid, "daily", trip, network.stops[p.stop_ids[-1]].name, d - 1, shape])
        speed = a.speed_mps(network.routes[rid])
        t = 0.0
        for i, s in enumerate(p.stop_ids):
            if i:
                t += (p.chainage_m[i] - p.chainage_m[i - 1]) / speed + a.stop_loss_s
            stop_times.append([trip, _hms(start + t), _hms(start + t), s, i + 1])
        pts = shape_points(p, network)
        line = Polyline(pts) if len(pts) > 1 else None
        last, n = None, 0
        for k, (lat, lon) in enumerate(pts):
            dist = f"{line.cum[k]:.1f}" if line else "0"
            if dist == last:                     # a repeated point, or one within 5 cm of the last
                continue
            n += 1
            shapes.append([shape, f"{lat:.6f}", f"{lon:.6f}", n, dist])
            last = dist
        freqs.append([trip, _hms(start), _hms(end), int(round(headways[rid][0] * 60)), 0])

    tables = {
        "agency.txt": (["agency_id", "agency_name", "agency_url", "agency_timezone"],
                       [[feed["agency_id"], feed["agency_name"], feed["agency_url"], feed["timezone"]]]),
        "feed_info.txt": (["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date",
                           "feed_end_date", "feed_version", "feed_contact_url"],
                          [["Ismat Samadov, independent researcher", FEED_URL, feed["lang"], *SERVICE_DATES,
                            version, f"{FEED_URL}/issues"]]),
        "stops.txt": (["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"],
                      [[s, network.stops[s].code or "", network.stops[s].name or "",
                        f"{network.stops[s].lat:.6f}", f"{network.stops[s].lon:.6f}"] for s in served]),
        "routes.txt": (["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"],
                       [[rid, feed["agency_id"], network.routes[rid].number,
                         f"{network.routes[rid].first_point} - {network.routes[rid].last_point}", 3]
                        for rid in sorted(headways) if rid in network.routes]),
        "calendar.txt": (["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
                          "sunday", "start_date", "end_date"], [["daily", 1, 1, 1, 1, 1, 1, 1, *SERVICE_DATES]]),
        "trips.txt": (["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"], trips),
        "stop_times.txt": (["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stop_times),
        "shapes.txt": (["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"], shapes),
        "frequencies.txt": (["trip_id", "start_time", "end_time", "headway_secs", "exact_times"], freqs),
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, (header, rows) in tables.items():
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow(header)
            w.writerows(rows)
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))   # fixed date: same input, same file
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, buf.getvalue())


# ---------------------------------------------------------------- reading

TYPE_NAMES = {0: "Tram", 1: "Metro", 2: "Rail", 3: "Bus", 4: "Ferry", 5: "Cable tram", 6: "Aerial lift",
              7: "Funicular", 11: "Trolleybus", 12: "Monorail"}
# Extended route types (lowest, past the highest, basic type), e.g. 700-716 bus service and 200-209 coach.
EXTENDED = ((100, 200, 2), (200, 300, 3), (400, 500, 1), (700, 800, 3), (800, 900, 11), (900, 1000, 0),
            (1000, 1100, 4), (1200, 1300, 4), (1300, 1400, 6), (1400, 1500, 7))
SPEED_KMH = (5.0, 90.0)      # a timetable speed outside these gives way to the zone's (assumptions.py)
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
BRANCH_SHARE = 0.2           # a branch with this share of its direction's departures, and at least
MIN_BRANCH_DEPARTURES = 3    # this many, runs as a route of its own; a smaller one is left out
PAIR_M = 150.0               # a branch's two directions: most stops of each within this of the other's
EXPRESS_WORDS = ("express", "ekspres", "expres", "экспресс", "экспрес")
EXPRESS_SHARE, EXPRESS_CALLS = 0.85, 0.6   # see _express


@dataclass
class Timetable:
    """What read_gtfs took from a feed's timetable: each route's trips a day in each direction
    (its headway, see service.route_headways), a summary, warnings about the feed and notes
    on single routes for the record, and the agency and language to write the network back
    with (write_gtfs)."""
    day: str
    trips_each_way: dict        # route id -> trips a day in each direction, short turns counted by distance
    summary: dict
    warnings: list
    notes: list
    feed: dict


def basic_route_type(value):
    """The basic GTFS route type of a basic or extended one: 700 (bus service) and 200 (coach) are 3."""
    t = int(value)
    return next((basic for lo, hi, basic in EXTENDED if lo <= t < hi), t)


class Feed:
    """The text files of a GTFS feed, in a folder or a zip file (also inside one folder of it)."""

    def __init__(self, path):
        self.path = Path(path)
        self.zip = None if self.path.is_dir() else zipfile.ZipFile(self.path)
        names = self.zip.namelist() if self.zip else [p.name for p in self.path.iterdir()]
        self.files = {}
        for name in sorted(names, key=lambda n: (n.count("/"), n)):
            self.files.setdefault(name.rsplit("/", 1)[-1], name)

    def columns(self, name, *wanted):
        """Each row of a file as a tuple of the wanted columns, stripped, with "" for a column
        the file lacks. A file the feed lacks has no rows."""
        if name not in self.files:
            return
        raw = self.zip.open(self.files[name]) if self.zip else open(self.path / self.files[name], "rb")
        with io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as f:
            rows = csv.reader(f)
            header = [h.strip() for h in next(rows, [])]
            at = [header.index(w) if w in header else None for w in wanted]
            for row in rows:
                if row:
                    yield tuple(row[i].strip() if i is not None and i < len(row) else "" for i in at)

    def close(self):
        if self.zip:
            self.zip.close()


def _date(text):
    digits = re.sub(r"\D", "", str(text))
    return datetime.date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))


def _seconds(text):
    """Seconds after midnight of a GTFS time, which may pass 24:00:00."""
    h, m, s = text.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _number(text):
    """A number from a feed, or None for an empty field."""
    return float(text) if text else None


class Calendar:
    """Which service ids run on which day: the weekly patterns of calendar.txt with the
    exceptions of calendar_dates.txt."""

    def __init__(self, feed):
        self.weekly = [(sid, _date(start), _date(end), [d == "1" for d in days])
                       for sid, *days, start, end in feed.columns(
                           "calendar.txt", "service_id", "monday", "tuesday", "wednesday", "thursday",
                           "friday", "saturday", "sunday", "start_date", "end_date") if start and end]
        self.extra = defaultdict(dict)           # day -> {service id: True if added, False if removed}
        for sid, day, kind in feed.columns("calendar_dates.txt", "service_id", "date", "exception_type"):
            if day and kind in ("1", "2"):
                self.extra[_date(day)][sid] = kind == "1"

    def services(self, day):
        running = {sid for sid, start, end, on in self.weekly if start <= day <= end and on[day.weekday()]}
        for sid, added in self.extra.get(day, {}).items():
            (running.add if added else running.discard)(sid)
        return running

    def days(self):
        """The days the busiest one can fall on: every day calendar_dates.txt names, and the
        days from the first start_date to a week after the last. After the last start, weekly
        services only end, so no later day of the week has more of them."""
        out = set(self.extra)
        starts = [start for _, start, _, _ in self.weekly]
        if starts:
            first, last = min(starts), max(starts)
            out.update(first + datetime.timedelta(k) for k in range((last - first).days + 7))
        return sorted(out)

    def busiest_weekday(self, trips_per_service):
        """The weekday with the most trips, the first if several; a weekend day if none runs on a weekday."""
        best, key = None, (False, 0)
        for day in self.days():
            n = sum(trips_per_service.get(s, 0) for s in self.services(day))
            if n and (day.weekday() < 5, n) > key:
                best, key = day, (day.weekday() < 5, n)
        return best


def _positions(part, seq):
    """Where part's stops fall in seq, in order, or None if part is not an in-order piece of it."""
    out, k = [], 0
    for s in part:
        while k < len(seq) and seq[k] != s:
            k += 1
        if k == len(seq):
            return None
        out.append(k)
        k += 1
    return out


def _same_way(seq, ref, stops):
    """Whether a trip runs the same way as a reference sequence: by the order of the stops the
    two share, or, when that does not decide, by which of their ends lie nearer each other."""
    at = {s: i for i, s in enumerate(ref)}
    idx = [at[s] for s in seq if s in at]
    up = sum(b > a for a, b in zip(idx, idx[1:]))
    down = sum(b < a for a, b in zip(idx, idx[1:]))
    if up != down:
        return up > down

    def apart(x, y):
        return haversine_m(stops[x].lat, stops[x].lon, stops[y].lat, stops[y].lon)
    return apart(seq[0], ref[0]) + apart(seq[-1], ref[-1]) <= apart(seq[0], ref[-1]) + apart(seq[-1], ref[0])


def _near_share(seq, other, stops, within_m=PAIR_M):
    """Share of seq's stops with a stop of other within within_m."""
    near = sum(1 for s in seq if any(haversine_m(stops[s].lat, stops[s].lon, stops[t].lat, stops[t].lon) <= within_m
                                     for t in other))
    return near / len(seq)


def _arrange(variants, dep):
    """A direction's stop sequences as patterns and the rest. The most run sequence is the first
    pattern; another becomes a pattern, a branch, when it is not an in-order piece of a pattern
    and has at least MIN_BRANCH_DEPARTURES departures and BRANCH_SHARE of the direction's. Every
    other sequence is folded into the first pattern it is a piece of (a short turn), or left out:
    (patterns, {sequence: (pattern index, its positions there) or None})."""
    floor = max(MIN_BRANCH_DEPARTURES, BRANCH_SHARE * sum(dep.values()))
    kept, fate = [], {}
    for v in sorted(variants, key=lambda v: (-dep[v], -len(v), v)):
        host = next(((k, at) for k, s in enumerate(kept) if (at := _positions(v, s))), None)
        if not kept or (host is None and dep[v] >= floor):
            kept.append(v)
        else:
            fate[v] = host
    return kept, fate


def _by_distance(line, shape_dist, stop_dist):
    """Each stop's place on the line from the feed's shape_dist_traveled, as matches for
    model._pattern_from, or None when values are missing, run backwards or fall off the line."""
    values = list(shape_dist) + list(stop_dist)
    if not values or any(v is None for v in values) or any(b < a for a, b in zip(shape_dist, shape_dist[1:])) \
            or any(b < a for a, b in zip(stop_dist, stop_dist[1:])):
        return None
    lo, hi = shape_dist[0], shape_dist[-1]
    slack = 0.01 * (hi - lo)
    out = []
    for d in stop_dist:
        if not lo - slack <= d <= hi + slack:
            return None
        i = min(max(bisect.bisect_right(shape_dist, d) - 1, 0), len(shape_dist) - 2)
        seg = shape_dist[i + 1] - shape_dist[i]
        t = min(1.0, max(0.0, (d - shape_dist[i]) / seg)) if seg > 0 else 0.0
        out.append({"chainage_m": line.cum[i] + t * (line.cum[i + 1] - line.cum[i])})
    return out


def _pattern(rid, d, seq, stops, shape, repair, number, log, stop_dist=None):
    """One route direction from its stop sequence and, if the feed has one, its shape: placed by
    shape_dist_traveled where the feed gives it, otherwise matched to the line (geo.match_stops).
    Returns (pattern, whether shape_dist_traveled placed the stops)."""
    pts = [(stops[s].lat, stops[s].lon) for s in seq]
    if not shape or len(shape) < 2:
        return _straight_pattern(rid, d, list(seq), pts), False
    line = Polyline([(lat, lon) for lat, lon, _ in shape])
    placed = _by_distance(line, [x for _, _, x in shape], stop_dist) if stop_dist else None
    if placed:
        offsets = sorted(haversine_m(*pt, *line.point_at(m["chainage_m"])) for pt, m in zip(pts, placed))
        if offsets[len(offsets) // 2] <= 60:                 # the distances agree with the line
            return _pattern_from(rid, d, list(seq), pts, line, placed), True
    if not repair:
        return _pattern_from(rid, d, list(seq), pts, line, fit_score(line, pts)[2]), False
    breaks, median, line, match, reversed_ = _best_variant(line, pts)
    why = _shape_problem(breaks, median, line, len(pts), max_jump_m=None)     # a long straight is a sparse line, not a fault
    if why:
        log.append(f"{number} d{d}: shape cannot explain its stops ({why}); using straight lines between stops")
        return _straight_pattern(rid, d, list(seq), pts), False
    if reversed_:
        log.append(f"{number} d{d}: shape was stored backwards; reversed")
    return _pattern_from(rid, d, list(seq), pts, line, match), False


def _express(patterns):
    """Routes whose stops nearly all (EXPRESS_SHARE) lie on one direction of another route that
    calls at many more stops along the same stretch (they call at fewer than EXPRESS_CALLS of
    them): express services, whose purpose is to skip a local route's stops."""
    calling = defaultdict(set)                   # stop -> patterns that call there
    for key, p in patterns.items():
        for s in p.stop_ids:
            calling[s].add(key)
    out = set()
    for key, p in sorted(patterns.items()):
        mine = set(p.stop_ids)
        if len(mine) < 4 or key[0] in out:
            continue
        shared = Counter(other for s in mine for other in calling[s] if other[0] != key[0])
        for other, n in sorted(shared.items()):
            if n >= EXPRESS_SHARE * len(mine):
                at = [i for i, s in enumerate(patterns[other].stop_ids) if s in mine]
                if n / (at[-1] - at[0] + 1) < EXPRESS_CALLS:
                    out.add(key[0])
                    break
    return out


def read_gtfs(path, a, repair=True):
    """(Network, Timetable) from a GTFS feed, a zip file or a folder: the routes of the types in
    a.gtfs_route_types as they run on a.gtfs_date, or else on the busiest weekday. Moves the
    flat projection (geo.PROJ) to the feed's stops. With repair=True a shape stored backwards
    is reversed and one that cannot explain its stops gives way to straight lines, as for the
    AYNA snapshot; each fix is listed in Network.repairs."""
    feed = Feed(path)
    try:
        return _read(feed, a, repair, str(path))
    finally:
        feed.close()


def _read(feed, a, repair, source):
    types = {basic_route_type(t) for t in a.gtfs_route_types}
    agencies = {aid: (name, url, tz, lang) for aid, name, url, tz, lang in feed.columns(
        "agency.txt", "agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang")}
    kinds, other = {}, Counter()
    for rid, aid, short, long_name, desc, rtype in feed.columns(
            "routes.txt", "route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type"):
        mode = basic_route_type(rtype or 3)
        if mode in types:
            named_express = any(w in f"{short} {long_name} {desc}".lower() for w in EXPRESS_WORDS)
            kinds[rid] = (aid, short or long_name or rid, mode, named_express)
        else:
            other[TYPE_NAMES.get(mode, str(mode))] += 1

    listed, per_service = [], Counter()
    for rid, sid, tid, did, shp, sign in feed.columns(
            "trips.txt", "route_id", "service_id", "trip_id", "direction_id", "shape_id", "trip_headsign"):
        if rid in kinds:
            listed.append((tid, rid, sid, did if did in ("0", "1") else None, shp, sign))
            per_service[sid] += 1
    calendar = Calendar(feed)
    day = _date(a.gtfs_date) if a.gtfs_date else calendar.busiest_weekday(per_service)
    if day is None:
        raise ValueError(f"no day in the feed's calendar has trips of route types {sorted(types)}")
    running = calendar.services(day)
    trips = {tid: (rid, did, shp, sign) for tid, rid, sid, did, shp, sign in listed if sid in running}
    if not trips:
        raise ValueError(f"no trips of route types {sorted(types)} run on {day}")

    windows = defaultdict(list)                  # trip -> [(start, end, headway)] from frequencies.txt
    for tid, start, end, every in feed.columns("frequencies.txt", "trip_id", "start_time", "end_time", "headway_secs"):
        if tid in trips and start and end and every and float(every) > 0:
            windows[tid].append((_seconds(start), _seconds(end), float(every)))
    departures = {tid: sum(max(0.0, (e - s) / h) for s, e, h in windows[tid]) if tid in windows else 1.0
                  for tid in trips}

    calls, first, last = defaultdict(list), {}, {}
    for tid, sid, seq, arr, dep, dist in feed.columns(
            "stop_times.txt", "trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time",
            "shape_dist_traveled"):
        if tid not in trips:
            continue
        q = int(float(seq))
        calls[tid].append((q, sid, _number(dist)))
        t = dep or arr
        if t and (tid not in first or q < first[tid][0]):
            first[tid] = (q, t)
        t = arr or dep
        if t and (tid not in last or q > last[tid][0]):
            last[tid] = (q, t)

    used = {sid for cs in calls.values() for _, sid, _ in cs}
    stops = {}
    for sid, code, name, lat, lon in feed.columns("stops.txt", "stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon"):
        if sid in used and lat and lon:
            stops[sid] = Stop(sid, code, name, float(lat), float(lon), False)
    if not stops:
        raise ValueError("none of the stops the trips call at has a position in stops.txt")
    warnings, notes = [], []
    if len(stops) < len(used):
        warnings.append(f"{len(used) - len(stops)} stops called at in stop_times.txt have no position in stops.txt; "
                        f"trips pass them by")
    seqs, dists = {}, {}
    for tid, cs in calls.items():
        seq, dist = [], []
        for _, sid, d in sorted(cs, key=lambda c: c[0]):
            if sid in stops and (not seq or seq[-1] != sid):
                seq.append(sid)
                dist.append(d)
        seqs[tid], dists[tid] = tuple(seq), dist
    PROJ.centre_on(statistics.median(s.lat for s in stops.values()), statistics.median(s.lon for s in stops.values()))

    def run_s(tid):
        if tid in first and tid in last and last[tid][0] > first[tid][0]:
            return _seconds(last[tid][1]) - _seconds(first[tid][1])
        return None

    by_route = defaultdict(list)
    for tid in sorted(seqs):
        if len(seqs[tid]) >= 2:
            by_route[trips[tid][0]].append(tid)
    plans = {}                                   # (route, direction) -> ({sequence: its trips}, {sequence: departures})
    for rid, tids in sorted(by_route.items()):
        if all(trips[t][1] is not None for t in tids):
            direction = {t: 1 + int(trips[t][1]) for t in tids}
        else:                                    # no direction_id: compare each trip with the most run sequence
            dep = Counter()
            for t in tids:
                dep[seqs[t]] += departures[t]
            ref = max(dep, key=lambda s: (dep[s], len(s), s))
            direction = {t: 1 if _same_way(seqs[t], ref, stops) else 2 for t in tids}
        groups = defaultdict(lambda: defaultdict(list))
        for t in tids:
            groups[direction[t]][seqs[t]].append(t)
        for d, variants in groups.items():
            plans[(rid, d)] = (dict(variants), {v: sum(departures[t] for t in ts) for v, ts in variants.items()})
    layout = {key: _arrange(*plan) for key, plan in plans.items()}

    shape_of, needed = {}, set()
    for key, (kept, _) in layout.items():
        for seq in kept:
            common = Counter(trips[t][2] for t in plans[key][0][seq] if trips[t][2]).most_common(1)
            shape_of[(key, seq)] = common[0][0] if common else None
            needed.add(shape_of[(key, seq)])
    raw = defaultdict(list)
    for shp, lat, lon, seq, dist in feed.columns(
            "shapes.txt", "shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"):
        if shp in needed and lat and lon:
            raw[shp].append((int(float(seq)), float(lat), float(lon), _number(dist)))
    shapes = {shp: [(lat, lon, dist) for _, lat, lon, dist in sorted(pts, key=lambda p: p[0])] for shp, pts in raw.items()}

    def stop_dist(key, seq):
        """shape_dist_traveled at each stop of one of the sequence's trips on its shape, if any has them all."""
        return next((dists[t] for t in plans[key][0][seq] if trips[t][2] == shape_of[(key, seq)]
                     and all(d is not None for d in dists[t])), None)

    def headsign(key, seq):
        signs = Counter(trips[t][3] for t in plans[key][0][seq] if trips[t][3])
        return signs.most_common(1)[0][0] if signs else ""

    numbers = Counter(kinds[rid][1] for rid in by_route)
    routes, patterns, log, trips_each_way = {}, {}, [], {}
    in_patterns = folded = left_out = 0.0
    branch_stops, speeds, named_express, branch_routes, by_distance = set(), Counter(), set(), 0, 0
    for rid in sorted(by_route):
        aid, number, mode, named = kinds[rid]
        if numbers[number] > 1:                  # the same number at two agencies or for two route ids
            number = f"{number} [{rid}]"
        dirs = sorted(d for r, d in plans if r == rid)
        # The route: the most run sequence of each direction. Each branch beyond it is a route of
        # its own, its two directions paired when their stops lie along each other.
        members = [{d: layout[(rid, d)][0][0] for d in dirs}]
        loose = [(d, seq) for d in dirs for seq in layout[(rid, d)][0][1:]]
        while loose:
            d, seq = loose.pop(0)
            match = max(((min(_near_share(seq, s2, stops), _near_share(s2, seq, stops)), i)
                         for i, (d2, s2) in enumerate(loose) if d2 != d), default=(0.0, None))
            if match[1] is not None and match[0] >= 0.5:
                members.append({d: seq, loose[match[1]][0]: loose.pop(match[1])[1]})
            else:
                members.append({d: seq})
        main_sign = headsign((rid, dirs[0]), members[0][dirs[0]])
        for j, member in enumerate(members):
            route_id = rid if j == 0 else f"{rid}~{j}"
            label = number
            if j:
                sign = headsign((rid, min(member)), member[min(member)])
                label = f"{number} ({sign if sign and sign != main_sign else f'branch {j}'})"
            pats, each_way, run_times = {}, [], []
            for d in sorted(member):
                key, seq = (rid, d), member[d]
                variants, dep = plans[key]
                kept, fate = layout[key]
                p, placed = _pattern(route_id, d, seq, stops, shapes.get(shape_of[(key, seq)]), repair, label, log,
                                     stop_dist(key, seq))
                pats[d] = p
                by_distance += placed
                k = kept.index(seq)
                trips_d = dep[seq]
                for v, host in fate.items():
                    if host and host[0] == k and p.length_m > 0:        # a short turn: counts for the distance it covers
                        at = host[1]
                        trips_d += dep[v] * (p.chainage_m[at[-1]] - p.chainage_m[at[0]]) / p.length_m
                        folded += dep[v]
                in_patterns += dep[seq]
                if j:
                    branch_routes += d == min(member)
                    notes.append(f"{number} d{d}: a branch with {dep[seq]:g} of {sum(dep.values()):g} departures "
                                 f"runs as route {label}")
                each_way.append(trips_d)
                times = sorted(r for r in (run_s(t) for t in variants[seq]) if r and r > 0)
                run_times.append(statistics.median(times) if times else None)
            speed = None
            if all(run_times):
                moving = sum(run_times) - sum((len(p.stop_ids) - 1) * a.stop_loss_s for p in pats.values())
                speed = sum(p.length_m for p in pats.values()) / moving * 3.6 if moving > 0 else 0.0
                if not SPEED_KMH[0] <= speed <= SPEED_KMH[1]:
                    notes.append(f"{label}: the timetable gives a moving speed of {speed:.1f} km/h; "
                                 f"using the setting for {TYPE_NAMES.get(mode, mode)} instead")
                    speed = None
            speeds["timetable" if speed else "settings"] += 1
            agency = agencies.get(aid) or (next(iter(agencies.values())) if len(agencies) == 1 else ("", "", "", ""))
            first_p = pats[min(pats)]
            routes[route_id] = Route(route_id, label, " ".join(agency[0].split()), stops[first_p.stop_ids[0]].name,
                                     stops[first_p.stop_ids[-1]].name, None, TYPE_NAMES.get(mode, str(mode)), "", None,
                                     "", "", speed_kmh=speed, runs_one_way=len(pats) == 1)
            for d, p in pats.items():
                patterns[(route_id, d)] = p
            trips_each_way[route_id] = sum(each_way) / len(each_way)
            if named:
                named_express.add(route_id)
        for d in dirs:                           # what no pattern of the route carries
            variants, dep = plans[(rid, d)]
            out = [v for v, host in layout[(rid, d)][1].items() if host is None]
            if out:
                n = sum(dep[v] for v in out)
                stops_out = set().union(*map(set, out)) - set().union(*map(set, layout[(rid, d)][0]))
                left_out += n
                branch_stops |= stops_out
                notes.append(f"{number} d{d}: {len(out)} other stop sequence(s) with {n:g} of {sum(dep.values()):g} "
                             f"departures left out; {len(stops_out)} stops they call at are on no pattern of the route")

    express = named_express | _express(patterns)
    for rid in sorted(express):
        routes[rid].zone = f"{routes[rid].zone} express"
        notes.append(f"{routes[rid].number}: express" + (" (its name says so)" if rid in named_express
                                                         else ", skipping most stops of a route it runs along"))

    alone = sum(departures[t] for t in trips if len(seqs.get(t, ())) < 2)      # trips with fewer than two stops
    leaving = []                                 # every departure time of the day
    for tid in trips:
        if tid in windows:
            for s, e, h in windows[tid]:
                leaving += [s + k * h for k in range(int(math.ceil((e - s) / h)))]
        elif tid in first:
            leaving.append(_seconds(first[tid][1]))
    per_hour = Counter(int(t // 3600) for t in leaving)
    busy = sorted(h for h, n in per_hour.items() if n >= max(per_hour.values()) / 4) if per_hour else []
    service = (busy[0], busy[-1] + 1) if busy else None
    if service and abs(service[1] - service[0] - a.service_hours) > 1:
        warnings.append(f"buses leave at least a quarter as often as in the busiest hour from {service[0]:02d}:00 to "
                        f"{service[1]:02d}:00, {service[1] - service[0]} hours; service_hours is {a.service_hours:g}, "
                        f"so set it to {service[1] - service[0]} for waiting times to match")
    served = {s for p in patterns.values() for s in p.stop_ids}
    total = sum(departures.values())
    summary = {
        "feed": source,
        "day": day.isoformat(), "weekday": WEEKDAYS[day.weekday()],
        "route_types": sorted(types),
        "routes_of_these_types": len(kinds),
        "routes_running": len(by_route),
        "routes_of_other_types": dict(sorted(other.items())),
        "branches_run_as_routes": branch_routes,
        "routes_in_the_model": len(routes),
        "routes_running_one_way": sum(r.runs_one_way for r in routes.values()),
        "routes_express": len(express),
        "departures": total,
        "departures_on_patterns": in_patterns,
        "departures_on_part_of_a_pattern": folded,
        "departures_left_out": left_out + alone,
        "share_of_departures_modelled": (in_patterns + folded) / total if total else None,
        "stops_served": len(served),
        "stops_only_on_departures_left_out": len(branch_stops - served),
        "directions_placed_by_shape_dist_traveled": by_distance,
        "speeds_from_timetable": speeds["timetable"],
        "speeds_from_settings": speeds["settings"],
        "routes_more_often_than_min_headway": sum(1 for n in trips_each_way.values()
                                                  if n and a.service_hours * 60 / n < a.min_headway_min),
        "first_departure": _hms(min(leaving))[:5] if leaving else None,
        "last_departure": _hms(max(leaving))[:5] if leaving else None,
        "service_from": f"{service[0]:02d}:00" if service else None,
        "service_to": f"{service[1]:02d}:00" if service else None,
        "hours_of_service": service[1] - service[0] if service else None,
    }
    names = sorted({" ".join(ag[0].split()) for ag in agencies.values() if ag[0]})
    lang = (next((v for (v,) in feed.columns("feed_info.txt", "feed_lang") if v), "")
            or next((ag[3] for ag in agencies.values() if ag[3]), "") or "mul")
    meta = {"agency_id": "modelled",
            "agency_name": (f"{names[0]}, modelled from its GTFS feed" if len(names) == 1
                            else f"Buses of {len(names)} agencies, modelled from their GTFS feed"),
            "agency_url": next((ag[1] for ag in agencies.values() if ag[1]), FEED_URL),
            "timezone": next((ag[2] for ag in agencies.values() if ag[2]), "UTC"),
            "lang": lang}
    return Network(routes, stops, patterns, log), Timetable(day.isoformat(), trips_each_way, summary, warnings, notes, meta)
