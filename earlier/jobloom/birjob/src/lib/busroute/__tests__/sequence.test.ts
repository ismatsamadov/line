import { describe, expect, it } from 'vitest';
import { collapseRepeatedSequence } from '../sequence';

const collapse = (list: number[]) => collapseRepeatedSequence(list, (n) => n);

describe('collapseRepeatedSequence', () => {
  it("keeps one copy of a stop list stored twice over, as 120A's are (#685)", () => {
    // 120A's first direction in the snapshot, travel order (bus_id 160).
    const d1 = [1880, 1345, 1367, 327, 613, 841, 309, 1532, 1141, 231, 1647, 1167, 1373, 618, 1200];
    expect(collapse([...d1, ...d1])).toEqual(d1);
    expect(collapse([...d1, ...d1, ...d1])).toEqual(d1);
  });

  it('leaves every other shape as it is', () => {
    for (const list of [
      [1, 2, 3, 1],       // ends where it starts
      [1, 2, 3, 4, 1],    // loops back to its start
      [1, 2, 1, 3],       // revisits a stop on the way
      [1, 2, 3, 1, 2],    // repeats only part of itself
      [1, 2, 3, 1, 2, 4], // two copies that differ
      [5, 5, 5, 5],       // one stop over and over is not a copy of a route
      [1, 2, 3],
      [],
    ]) expect(collapse(list), String(list)).toEqual(list);
  });

  it('returns the rows themselves, in their order', () => {
    const rows = [{ stop_id: 7, id: 1 }, { stop_id: 8, id: 2 }, { stop_id: 7, id: 3 }, { stop_id: 8, id: 4 }];
    expect(collapseRepeatedSequence(rows, (r) => r.stop_id)).toEqual([rows[0], rows[1]]);
  });
});
