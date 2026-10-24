/**
 * Collapse a stop list stored as an exact repeat of itself to one copy (#685).
 *
 * The snapshot holds 120A's stops twice in each direction (bus_id 160: 30 rows for
 * 15 stops, 28 for 14), all at the same total_distance, so travel order puts one
 * copy after the other. Kept as is, the planner rode from the terminus straight
 * back to the first stop as if it were one leg, and spread the line's duration
 * over twice the legs; the line viewer listed every stop twice.
 *
 * Only a whole-list repeat collapses. A loop that revisits stops, a route that
 * ends where it starts, or two consecutive copies of one stop are other shapes
 * and stay as they are.
 */
export function collapseRepeatedSequence<T>(items: T[], key: (item: T) => number): T[] {
  if (items.length < 4) return items;
  // Prefix function: prefix[i] is the longest proper prefix of items[0..i] that
  // is also its suffix, so items.length - prefix[last] is the shortest period.
  const prefix = new Array<number>(items.length).fill(0);
  for (let i = 1; i < items.length; i++) {
    let matched = prefix[i - 1];
    while (matched > 0 && key(items[i]) !== key(items[matched])) matched = prefix[matched - 1];
    if (key(items[i]) === key(items[matched])) matched++;
    prefix[i] = matched;
  }
  const period = items.length - prefix[items.length - 1];
  return period >= 2 && period < items.length && items.length % period === 0
    ? items.slice(0, period)
    : items;
}
