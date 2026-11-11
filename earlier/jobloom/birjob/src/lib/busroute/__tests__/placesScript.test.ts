/**
 * scripts/bus/build_places_json.py (#720), which writes places.json: its functions run
 * through python3, as the script runs on a refresh. check-all does not read scripts/, so
 * without this a refresh would be the first run of a changed line.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSearch } from '../searchText';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/bus/build_places_json.py', import.meta.url));

/** Run `code` with the script imported as `b` (its main() does not run), JSON in and out. */
function python(code: string, input: unknown = null): unknown {
  const program = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("b", sys.argv[1])',
    'b = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(b)',
    'data = json.load(sys.stdin)',
    code,
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-c', program, SCRIPT], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout);
}

describe('build_places_json.py (#720)', () => {
  it('asks Overpass for OpenStreetMap as it was at the snapshot, so a lost answer can be fetched again', () => {
    const { query, snapshot } = python('print(json.dumps({"query": b.QUERY, "snapshot": b.SNAPSHOT}))') as
      { query: string; snapshot: string };
    expect(query).toContain(`[date:"${snapshot}"]`);
    // The ways and relations are given once with their centre and once with their bounding box.
    expect(query).toMatch(/out tags center qt;\nout ids bb qt;\n$/);
  });

  it('folds a name as the search does, so that the names it dedupes are the ones the search cannot tell apart', () => {
    const names = ['İÇƏRİŞƏHƏR', 'Bakı', 'Kotal qәs.', 'Гянджлик Молл', 'Ёлка, Йод', '  28-May m/st. ', "Papa John's",
      'Domino’s Pizza', 'Papa Johnʼs', 'L‘Occitane', 'Tod`s', 'Levi´s', 'Şüvəlan Çimərliyi', 'Gənclik Mall / Ganjlik'];
    expect(python('print(json.dumps([b.fold(n) for n in data]))', names)).toEqual(names.map(normalizeSearch));
  });

  it('applies a correction while OpenStreetMap has the value it corrects, and names it once it has not', () => {
    const result = python(`
b.CORRECTIONS[:] = [
    ("n1", "name:en", "Bad words", None, "vandalism"),
    ("n2", "name", "Old Nmae", "Old Name", "a typo"),
    ("n3", "*", "A joke", None, "not a place"),
    ("n4", "name:en", "Fixed since", None, "vandalism"),
    ("w5", "name", "Gone", None, "a feature OpenStreetMap no longer has"),
]
out, stale = b.correct([
    {"type": "node", "id": 1, "tags": {"name": "Good", "name:en": "Bad words"}},
    {"type": "node", "id": 2, "tags": {"name": "Old Nmae"}},
    {"type": "node", "id": 3, "tags": {"name": "A joke"}},
    {"type": "node", "id": 4, "tags": {"name": "Good", "name:en": "Good"}},
])
print(json.dumps({"tags": [e["tags"] for e in out], "stale": [c[0] for c in stale]}))`);
    expect(result).toEqual({
      tags: [{ name: 'Good' }, { name: 'Old Name' }, { name: 'Good', 'name:en': 'Good' }],
      stale: ['n4', 'w5'],
    });
  });

  it('gives every correction a feature, a tag, the value it corrects and a reason', () => {
    const corrections = python('print(json.dumps(b.CORRECTIONS))') as Array<[string, string, string, string | null, string]>;
    expect(corrections.length).toBeGreaterThan(0);
    for (const [id, tag, value, use, why] of corrections) {
      expect(id).toMatch(/^[nwr][1-9]\d*$/);
      expect(tag === '*' || /^[a-z_:]+$/.test(tag), `${id} ${tag}`).toBe(true);
      expect(value.length, id).toBeGreaterThan(0);
      expect(use === null || (use.length > 0 && use !== value), id).toBe(true);
      expect(why.length, id).toBeGreaterThan(10);
    }
  });

  it('flags for a person the names with an insult, a curse or a political word, and not the ministries', () => {
    const names = ['Heydar Aliyev mafia boss grave', 'Хуйня', 'Qəhbə', 'Corrupt regime',
      'Daxili İşlər Nazirliyi', 'Hugo Boss', 'Художественный музей', 'Воронеж', 'Gənclik Mall'];
    expect(python('print(json.dumps([bool(b.REVIEW.search(b.fold(n))) for n in data]))', names))
      .toEqual([true, true, true, true, false, false, false, false, false]);
  });

  it('waits as Retry-After says, in seconds or as an HTTP date, and two minutes an attempt without it', () => {
    const waits = python(`
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
soon = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=90), usegmt=True)
print(json.dumps([b.retry_after(v, 2) for v in ["30", " 30 ", soon, "0", "", None, "soon"]]))`) as number[];
    expect(waits[0]).toBe(30);
    expect(waits[1]).toBe(30);
    expect(waits[2]).toBeGreaterThanOrEqual(85);
    expect(waits[2]).toBeLessThanOrEqual(91);
    expect(waits.slice(3)).toEqual([240, 240, 240, 240]);
  });
});
