/**
 * scripts/bus/build_places_json.py (#720), which writes places.json: its functions run
 * through python3, as the script runs on a refresh. check-all does not read scripts/, so
 * without this a refresh would be the first run of a changed line.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
