/**
 * Road shapes for the planner (#685): which stretch of AYNA's recorded route line
 * each leg between two stops follows, so a ride is drawn along the road instead of
 * as straight lines between stops.
 *
 * The recorded lines cannot be drawn as stored. Read on the box on 2026-10-24:
 * three directions are pieces joined by straight jumps of 9 to 20 km (557, 550 and
 * 555, direction 1), two lie wholly outside Baku (531 direction 1 has latitude equal
 * to longitude, 521 direction 2 has the two swapped), some are filed under the other
 * direction or stored backwards, and four directions have none. So a ride's stops
 * are placed on a line in travel order, and a leg gets the road only where both of
 * its stops sit on that line and nothing on the way is a jump. On that snapshot
 * 11,230 of the 11,355 legs get the road, in about 0.6 s for the whole network.
 */
import { haversine } from "./geo";
import type { LatLng } from "./types";

/** A stop further than this from the line is not on it (km). */
const MAX_SNAP_KM = 0.3;
/** A straight stretch longer than this is a break in the line, not a road (km). */
const MAX_JUMP_KM = 5;
/** Per km of line the stops span; 1 km weighs as much as a 32 m worse snap. */
const SPAN_COST = 0.001;

interface Projection {
  /** Where on the line: the segment's index plus the fraction along it. */
  position: number;
  point: LatLng;
  /** From the stop, km; Infinity for a stop without coordinates. */
  distance: number;
}

const km = (a: LatLng, b: LatLng) => haversine(a[0], a[1], b[0], b[1]);

/** Every vertex of the line and the stop's foot on each segment, in line order. */
function projections(stop: LatLng | undefined, line: LatLng[]): Projection[] {
  const result: Projection[] = [];
  const add = (position: number, point: LatLng) =>
    result.push({ position, point, distance: stop ? km(stop, point) : Infinity });
  add(0, line[0]);
  for (let i = 0; i < line.length - 1; i++) {
    const [aLat, aLng] = line[i], [bLat, bLng] = line[i + 1];
    if (stop) {
      // Flat projection, east-west scaled by the latitude: plenty for a few hundred metres.
      const scale = Math.cos((stop[0] * Math.PI) / 180);
      const x = (bLng - aLng) * scale, y = bLat - aLat;
      const lengthSquared = x * x + y * y;
      const t = lengthSquared === 0 ? 0
        : Math.max(0, Math.min(1, ((stop[1] - aLng) * scale * x + (stop[0] - aLat) * y) / lengthSquared));
      if (t > 0 && t < 1) add(i + t, [aLat + t * (bLat - aLat), aLng + t * (bLng - aLng)]);
    }
    add(i + 1, line[i + 1]);
  }
  return result;
}

/**
 * Place every stop on the line so that positions never go back, with the least
 * total squared offset. A stop further than MAX_SNAP_KM costs a flat 1 and stays
 * unmatched, so one bad coordinate cannot drag the rest off the line.
 *
 * SPAN_COST per km of line between the first stop and the last breaks near-ties:
 * a terminus standing by both ends of a loop with no stops on it is placed past
 * the loop rather than before it. Five rides on the snapshot have one, 114A's
 * second direction among them (its first leg would run 1.55 km for stops 60 m
 * apart). The cost telescopes, so it cannot move a loop between two stops, which
 * the stops themselves hold in place.
 */
function matchStops(stops: Array<LatLng | undefined>, line: LatLng[]) {
  const along = [0];
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + km(line[i - 1], line[i]));
  const at = (position: number) => {
    const i = Math.min(Math.floor(position), line.length - 1);
    return along[i] + (position - i) * (i + 1 < line.length ? along[i + 1] - along[i] : 0);
  };
  const rows = stops.map((stop) => projections(stop, line));
  const parents: Int32Array[] = [];
  let costs = new Float64Array(0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = new Float64Array(row.length);
    const parent = new Int32Array(row.length).fill(-1);
    let previous = 0, bestIndex = -1, bestCost = Infinity;
    for (let j = 0; j < row.length; j++) {
      if (i > 0) {
        while (previous < rows[i - 1].length && rows[i - 1][previous].position <= row[j].position) {
          if (costs[previous] < bestCost) { bestCost = costs[previous]; bestIndex = previous; }
          previous++;
        }
      }
      const snap = row[j].distance <= MAX_SNAP_KM ? row[j].distance ** 2 : 1;
      next[j] = snap + (i === 0 ? -SPAN_COST * at(row[j].position) : bestCost);
      parent[j] = bestIndex;
    }
    parents.push(parent);
    costs = next;
  }
  const last = rows[rows.length - 1];
  const total = (j: number) => costs[j] + SPAN_COST * at(last[j].position);
  let best = 0;
  for (let j = 1; j < costs.length; j++) if (total(j) < total(best)) best = j;
  const cost = total(best);
  const matches: Array<Projection | undefined> = new Array(stops.length);
  for (let i = stops.length - 1; i >= 0; i--) {
    const match = rows[i][best];
    if (match.distance <= MAX_SNAP_KM) matches[i] = match;
    best = parents[i][best];
  }
  return { matches, cost };
}

/** Each leg's stretch of the line between its two matched stops, unless it jumps. */
function cutLegs(stops: Array<LatLng | undefined>, line: LatLng[], matches: Array<Projection | undefined>) {
  const legs: Array<LatLng[] | undefined> = new Array(stops.length - 1).fill(undefined);
  for (let i = 0; i < legs.length; i++) {
    const from = matches[i], to = matches[i + 1];
    if (!from || !to) continue;
    const leg: LatLng[] = [from.point];
    for (let j = Math.floor(from.position) + 1; j < to.position; j++) leg.push(line[j]);
    leg.push(to.point);
    // Two stops at one point of the line (or at repeated points of it, which the
    // data has) are on it only if they are one place.
    if (leg.every((point) => km(point, leg[0]) < 0.001) && km(stops[i]!, stops[i + 1]!) > 0.01) continue;
    if (leg.every((point, k) => k === 0 || km(leg[k - 1], point) <= MAX_JUMP_KM)) legs[i] = leg;
  }
  return legs;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
};

/**
 * The road for each leg of a ride, or undefined where it has none: legs[i] runs
 * from stops[i] to stops[i + 1]. Pass the ride's own line first, then the other
 * direction's. Each is tried as stored and reversed. The fit with the most legs
 * on the road wins. On a tie the ride keeps its own line unless another fits
 * clearly closer, its stops' median offset under 70% of the own line's: the rule
 * the open-data study of the network used to refile misfiled lines. Two lines of
 * one bus can both reach every stop and still take other streets (553's run 18.6
 * and 27.7 km for 15.9 km stop to stop), so a slightly closer fit is not enough.
 */
export function legPaths(stops: Array<LatLng | undefined>, lines: LatLng[][]): Array<LatLng[] | undefined> {
  type Fit = { legs: Array<LatLng[] | undefined>; onRoad: number; own: boolean; offset: number; cost: number };
  let best: Fit | undefined;
  const better = (fit: Fit, than: Fit) => {
    if (fit.onRoad !== than.onRoad) return fit.onRoad > than.onRoad;
    // Another line wins over the own one only by fitting clearly closer.
    if (fit.own !== than.own) return fit.own ? !(than.offset < 0.7 * fit.offset) : fit.offset < 0.7 * than.offset;
    return fit.cost < than.cost;
  };
  if (stops.length >= 2) lines.forEach((stored, rank) => {
    if (stored.length < 2) return;
    for (const line of [stored, [...stored].reverse()]) {
      const { matches, cost } = matchStops(stops, line);
      const legs = cutLegs(stops, line, matches);
      const offset = median(matches.flatMap((m) => (m ? [m.distance] : [])));
      const fit = { legs, onRoad: legs.filter(Boolean).length, own: rank === 0, offset, cost };
      if (!best || better(fit, best)) best = fit;
    }
  });
  return best?.legs ?? new Array(Math.max(stops.length - 1, 0)).fill(undefined);
}

/**
 * One polyline through the stops: each leg's road where it has one, a straight
 * line to the next stop where it has none. Undefined when no leg has a road, so
 * the caller can keep drawing straight between stops.
 */
export function joinLegs(stops: LatLng[], legs: Array<LatLng[] | undefined>): LatLng[] | undefined {
  if (!legs.some(Boolean)) return undefined;
  const path: LatLng[] = [];
  const push = (point: LatLng) => {
    const last = path[path.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) path.push(point);
  };
  for (let i = 0; i < stops.length - 1; i++) for (const point of legs[i] ?? [stops[i], stops[i + 1]]) push(point);
  return path;
}

// A stop sticks out of its ride when its two legs run more than MISPLACED_RATIO times
// the straight line between the stops either side, and over MISPLACED_KM longer.
const MISPLACED_RATIO = 3;
const MISPLACED_KM = 1;

/** A misplaced stop: its position in the ride, and the straight line between the stops either side (km). */
export interface Misplaced { at: number; direct: number }

/** Each leg's straight line (km), or null where a stop at either end has no coordinates. */
export const legLengths = (points: Array<LatLng | undefined>): Array<number | null> =>
  points.slice(1).map((to, i) => {
    const from = points[i];
    return from && to ? km(from, to) : null;
  });

/**
 * The stops of a ride that the data puts in the wrong place (#721). A stop that sticks
 * out of its ride while the recorded line passes it by, though it runs on through the
 * legs beyond, is taken to be misplaced. On the snapshot that is stop 3841 of 537, 1.1
 * km from both its lines, and 536's row "28 May küçəsi 222", which points at stop 3095,
 * C.Cavadov küç. 72A, elsewhere on the route. The buses that do go out of their way to
 * a stop, as 145 does to Binəqədi Gənclər Şəhərciyi, have it on their recorded line,
 * and their legs count in full. A misplaced stop's neighbours have their other legs on
 * the line and its own are not, so misplaced stops are at least three places apart,
 * and the legs past them never overlap.
 *
 * The graph times a ride past such a stop by the straight line between its neighbours
 * (graph.ts), and the line viewer draws its line that way (db.ts, #743). Both ask here of
 * the same sequence, every row of the ride in travel order with a stop that has no valid
 * coordinates as a gap and a stop listed twice in a row twice, so they tell the same stops.
 * The viewer's own list drops the one and lists the other once; asked of that list, it
 * flagged a misplaced stop stored twice in a row, which this does not tell, and hid a stop
 * that journeys ride to.
 */
export function misplacedStops(points: Array<LatLng | undefined>, lengths: Array<number | null>, legs: Array<LatLng[] | undefined>): Misplaced[] {
  const misplaced: Misplaced[] = [];
  for (let k = 1; k < lengths.length; k++) {
    const into = lengths[k - 1], out = lengths[k];
    if (into === null || out === null || legs[k - 1] || legs[k]) continue;
    const beyond = [k - 2, k + 1].filter((i) => i >= 0 && i < lengths.length);
    if (!beyond.length || !beyond.every((i) => legs[i])) continue;
    const before = points[k - 1]!, after = points[k + 1]!;
    const direct = haversine(before[0], before[1], after[0], after[1]);
    if (into + out <= MISPLACED_RATIO * direct || into + out - direct <= MISPLACED_KM) continue;
    misplaced.push({ at: k, direct });
  }
  return misplaced;
}
