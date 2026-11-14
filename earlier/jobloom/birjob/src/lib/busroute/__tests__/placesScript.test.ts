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

/** Run `code` with the script imported as `b` (its main() does not run), JSON in and out.
 *  -B: no bytecode written into scripts/bus/__pycache__ by a test run. */
function python(code: string, input: unknown = null): unknown {
  const program = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("b", sys.argv[1])',
    'b = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(b)',
    'data = json.load(sys.stdin)',
    code,
  ].join('\n');
  const run = spawnSync('python3', ['-I', '-B', '-c', program, SCRIPT], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout);
}

describe('build_places_json.py (#720)', () => {
  it('asks Overpass for OpenStreetMap as it was at the snapshot, so a lost answer can be fetched again', () => {
    const { query, snapshot } = python('print(json.dumps({"query": b.QUERY, "snapshot": b.SNAPSHOT}))') as
      { query: string; snapshot: string };
    expect(query).toContain(`[date:"${snapshot}"]`);
    // The places' ways and relations are given once with their centre and once with their
    // bounding box, and every named road last, with its line (#743).
    expect(query).toContain('way[name][highway]->.roads;');
    expect(query).toMatch(/out tags center qt;\nout ids bb qt;\n\.roads out tags geom qt;\n$/);
  });

  it('folds a name as the search does, so that the names it dedupes are the ones the search cannot tell apart', () => {
    const names = ['İÇƏRİŞƏHƏR', 'Bakı', 'Kotal qәs.', 'Гянджлик Молл', 'Ёлка, Йод', '  28-May m/st. ', "Papa John's",
      'Domino’s Pizza', 'Papa Johnʼs', 'L‘Occitane', 'Tod`s', 'Levi´s', 'Şüvəlan Çimərliyi', 'Gənclik Mall / Ganjlik'];
    expect(python('print(json.dumps([b.fold(n) for n in data]))', names)).toEqual(names.map(normalizeSearch));
  });

  it('applies a correction while OpenStreetMap has the value it corrects, and names it once it has not', () => {
    // A correction of no value adds a tag while the feature has none (the sea terminal's
    // amenity=ferry_terminal), and is named once OpenStreetMap has one.
    const result = python(`
b.CORRECTIONS[:] = [
    ("n1", "name:en", "Bad words", None, "vandalism"),
    ("n2", "name", "Old Nmae", "Old Name", "a typo"),
    ("n3", "*", "A joke", None, "not a place"),
    ("n4", "name:en", "Fixed since", None, "vandalism"),
    ("w5", "name", "Gone", None, "a feature OpenStreetMap no longer has"),
    ("n6", "amenity", None, "ferry_terminal", "a tag it lacks"),
    ("n7", "amenity", None, "ferry_terminal", "a tag a mapper has given it since"),
]
out, stale = b.correct([
    {"type": "node", "id": 1, "tags": {"name": "Good", "name:en": "Bad words"}},
    {"type": "node", "id": 2, "tags": {"name": "Old Nmae"}},
    {"type": "node", "id": 3, "tags": {"name": "A joke"}},
    {"type": "node", "id": 4, "tags": {"name": "Good", "name:en": "Good"}},
    {"type": "node", "id": 6, "tags": {"name": "Port"}},
    {"type": "node", "id": 7, "tags": {"name": "Port", "amenity": "ferry_terminal"}},
])
print(json.dumps({"tags": [e["tags"] for e in out], "stale": [c[0] for c in stale]}))`);
    expect(result).toEqual({
      tags: [{ name: 'Good' }, { name: 'Old Name' }, { name: 'Good', 'name:en': 'Good' },
        { name: 'Port', amenity: 'ferry_terminal' }, { name: 'Port', amenity: 'ferry_terminal' }],
      stale: ['n4', 'w5', 'n7'],
    });
  });

  it('stops the build, writing nothing, on a correction or added names that no longer apply', () => {
    // A synthetic answer the build can run through: the planner's 27 metro stations, as
    // OpenStreetMap names them, and one memorial whose English name a mapper has fixed.
    const result = python(`
import contextlib, io, shutil, tempfile
from pathlib import Path
tmp = Path(tempfile.mkdtemp())
b.OUT = tmp / "places.json"
stations = json.loads(b.METRO.read_text(encoding="utf-8"))["stations"]
elements = [{"type": "node", "id": 100 + i, "lat": s["latitude"], "lon": s["longitude"],
             "tags": {"name": s["name"].removesuffix("-2"), "railway": "station", "station": "subway"}}
            for i, s in enumerate(stations)]
elements.append({"type": "node", "id": 1, "lat": 40.36, "lon": 49.82,
                 "tags": {"name": "Memorial", "name:en": "Fixed since", "historic": "memorial"}})
answer = tmp / "answer.json"
answer.write_text(json.dumps({"osm3s": {"timestamp_osm_base": "2026-11-12T00:00:00Z"}, "elements": elements}))
b.PLACED_AT.clear()
def run(corrections, aliases):
    b.CORRECTIONS[:] = corrections
    b.ALIASES.clear(); b.ALIASES.update(aliases)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            b.build(str(answer))
        stopped = None
    except SystemExit as stop:
        stopped = str(stop)
    written = b.OUT.exists()
    b.OUT.unlink(missing_ok=True)
    return {"stopped": stopped, "written": written}
result = {
    "stale": run([("n1", "name:en", "Bad words", None, "vandalism")], {}),
    "missing": run([], {"n2": (["Other"], "a feature the answer does not have")}),
    "fine": run([("n1", "name:en", "Fixed since", None, "test")], {"n1": (["Other"], "test")}),
}
shutil.rmtree(tmp)
print(json.dumps(result))`) as Record<string, { stopped: string | null; written: boolean }>;
    expect(result.stale.written).toBe(false);
    expect(result.stale.stopped).toMatch(/^CORRECTIONS whose value OpenStreetMap no longer has.*n1 name:en 'Bad words'/);
    expect(result.missing.written).toBe(false);
    expect(result.missing.stopped).toMatch(/^ALIASES for features the answer does not have.*n2/);
    expect(result.fine).toEqual({ stopped: null, written: true });
  });

  it('gives every correction a feature, a tag, the value it corrects (or none, for a tag it adds) and a reason', () => {
    const corrections = python('print(json.dumps(b.CORRECTIONS))') as Array<[string, string, string | null, string | null, string]>;
    expect(corrections.length).toBeGreaterThan(0);
    for (const [id, tag, value, use, why] of corrections) {
      expect(id).toMatch(/^[nwr][1-9]\d*$/);
      expect(tag === '*' || /^[a-z_:]+$/.test(tag), `${id} ${tag}`).toBe(true);
      // No value: the correction adds the tag, so it names the value to add.
      expect(value === null ? tag !== '*' && use !== null && use.length > 0 : value.length > 0, id).toBe(true);
      expect(use === null || (use.length > 0 && use !== value), id).toBe(true);
      expect(why.length, id).toBeGreaterThan(10);
    }
  });

  it('places an outline at the feature inside it that PLACED_AT names, and adds the names ALIASES has', () => {
    const result = python(`
b.PLACED_AT.clear(); b.PLACED_AT["w1"] = ("w2", "a terminal")
b.ALIASES.clear(); b.ALIASES.update({"w1": (["Aeroport", "Airport", "Big Field"], "used so"), "n9": (["X"], "gone")})
bounds = {"w1": {"minlat": 40.0, "minlon": 50.0, "maxlat": 40.1, "maxlon": 50.1}}
places = [{"id": "w1", "name": "Big Field", "category": "airport", "point": (40.05, 50.05), "aliases": ["Airport"]}]
elements = [{"type": "way", "id": 2, "center": {"lat": 40.01, "lon": 50.02}, "tags": {}}]
b.place_at(places, elements, bounds)
missing = b.add_aliases(places)
result = {"place": places[0], "missing": missing}
elements[0]["center"] = {"lat": 40.2, "lon": 50.02}
try:
    b.place_at(places, elements, bounds)
except SystemExit as stop:
    result["outside"] = str(stop)
print(json.dumps(result))`);
    expect(result).toEqual({
      place: { id: 'w1', name: 'Big Field', category: 'airport', point: [40.01, 50.02], aliases: ['Airport', 'Aeroport'] },
      missing: ['n9'],
      outside: "PLACED_AT: w2 is not inside w1's outline",
    });
  });

  it('gives every placement and added name a reason', () => {
    const { placed, aliases } = python('print(json.dumps({"placed": b.PLACED_AT, "aliases": b.ALIASES}))') as
      { placed: Record<string, [string, string]>; aliases: Record<string, [string[], string]> };
    for (const [id, [inside, why]] of Object.entries(placed)) {
      expect(`${id} ${inside}`).toMatch(/^[nwr][1-9]\d* [nwr][1-9]\d*$/);
      expect(why.length, id).toBeGreaterThan(10);
    }
    for (const [id, [names, why]] of Object.entries(aliases)) {
      expect(id).toMatch(/^[nwr][1-9]\d*$/);
      expect(names.length, id).toBeGreaterThan(0);
      expect(why.length, id).toBeGreaterThan(10);
    }
  });

  it('leaves out a building\'s number, not a name with more to it', () => {
    const result = python(`print(json.dumps({
    "plain": [b.plain(n) for n in data],
    "mixed": [b.mixed("Araя Market"), b.mixed("Gənclik Mall / Гянджлик"), b.mixed("8km Детский Сад")]}))`,
    ['Bina 1', 'ev 111a', 'Корпус № 2', 'Дом', 'Bina', 'Bina MTK', 'Ev Goradil', 'Дом Книги', 'Мужской салон', 'Kafe',
      'Qeyri-yaşayış sahələri']);
    expect(result).toEqual({
      plain: [true, true, true, true, true, false, false, false, true, true, true],
      mixed: [['Araя'], [], []],
    });
  });

  it('leaves out someone\'s home or flat, and not a guest house, a house museum or a housing office', () => {
    // [category, tags, the shown name and the others, left out]
    const cases: Array<[string, Record<string, string>, string[], boolean]> = [
      ['hotel', { tourism: 'guest_house' }, ['дача друга рашида'], true], // a friend's dacha
      ['hotel', { tourism: 'guest_house' }, ['Rəşad ev'], true], // a person's home
      ['hotel', { tourism: 'guest_house' }, ['Elçin müəllimin evi'], true],
      ['hotel', { tourism: 'guest_house', 'addr:street': 'Nizami küç.' }, ["Leyla's home"], true],
      ['hotel', { tourism: 'motel' }, ['Mərdəkan evim'], true], // my home in Mərdəkan
      ['hotel', { tourism: 'guest_house', phone: '+994501234567' }, ['Kirayə'], true], // to let, whatever its contacts
      ['hotel', { tourism: 'motel' }, ['Kirayə Mənzil'], true], // a flat to let
      ['hotel', { tourism: 'guest_house' }, ['12 ev 5', '12 квартира дом 5'], true], // a flat's number, in Russian
      ['office', { office: 'ngo' }, ['Abc, bina-4, 8-mertebe 376-menzil'], true], // an office at a flat
      ['park', { leisure: 'park', barrier: 'fence' }, ["President's Residence"], true],
      ['park', { leisure: 'park', barrier: 'fence' }, ['İqamətgah'], true],
      ['hotel', { tourism: 'guest_house' }, ['Dacha Resort'], false],
      ['restaurant', { amenity: 'restaurant' }, ['Дача'], false],
      ['hotel', { tourism: 'guest_house', website: 'https://example.az' }, ["Leyla's home"], false], // a business
      ['hotel', { tourism: 'guest_house', 'contact:phone': '+994501234567' }, ['Rəşad ev'], false],
      ['hotel', { tourism: 'guest_house' }, ['Rəşad ev', 'Rashad Guest House'], false], // says it is a guest house
      ['hotel', { tourism: 'guest_house' }, ['Bilgəh Qonaq Evi'], false],
      ['hotel', { tourism: 'guest_house' }, ['Ev Goradil'], false], // the home's word first: a name
      ['hotel', { tourism: 'hotel' }, ['Baku Bay House'], false],
      ['museum', { tourism: 'museum' }, ['Niyazinin ev-muzeyi', 'Музей-квартира им.Ниязи'], false],
      ['government', { office: 'government' }, ['Xətai Rayon Mənzil Kommunal Təsərrüfat Birliyi'], false],
      ['restaurant', { amenity: 'restaurant' }, ['5-mərtəbə'], false],
      ['park', { leisure: 'park' }, ['Residence Park'], false], // no fence
      ['residential', { landuse: 'residential' }, ['Gulustan Residence'], false],
    ];
    expect(python('print(json.dumps([b.private_home(c, t, n) for c, t, n in data]))', cases.map(([c, t, n]) => [c, t, n])))
      .toEqual(cases.map(([, , , out]) => out));
  });

  it('labels a works or a company mapped as a government office or a town hall an office, and a state body as one', () => {
    // [tags, category]
    const cases: Array<[Record<string, string>, string]> = [
      [{ name: 'Bakı Neft Emalı Zavodu', office: 'government', industrial: 'oil', landuse: 'industrial' }, 'office'],
      [{ name: 'Azfen', office: 'government', man_made: 'works' }, 'office'],
      [{ name: 'Yarımstansiya 515', office: 'government', power: 'substation' }, 'office'],
      [{ name: 'Spark Beton', office: 'government', building: 'industrial' }, 'office'],
      [{ name: 'Afsan Plastik Qablar Zavodu', amenity: 'townhall', shop: 'hardware' }, 'office'],
      [{ name: 'Pepsi Cola', amenity: 'townhall', shop: 'beverages' }, 'office'],
      [{ name: 'Sevil', amenity: 'townhall', office: 'company' }, 'office'],
      [{ name: 'Saipem Company', office: 'government' }, 'office'],
      [{ name: 'Bakı Yağ Fabriki', office: 'government' }, 'office'],
      [{ name: 'Kristal MMC \\ Bakmil', office: 'government' }, 'office'],
      [{ name: 'Daxili İşlər Nazirliyi', office: 'government' }, 'government'],
      [{ name: 'Bakıxanov Bələdiyyəsi', amenity: 'townhall' }, 'government'],
      // government=* says which government office it is, whatever the name.
      [{ name: 'Azərbaycan Dəmir Yolları QSC', office: 'government', government: 'transportation' }, 'government'],
      // A word of the place the mappers add after " \ " is not the feature's own.
      [{ name: 'Polis İdarəsi \\ Maşınqayırma Zavodu', office: 'government' }, 'government'],
      [{ name: 'Abşeron Rayon Məhkəməsi', amenity: 'courthouse' }, 'government'],
    ];
    expect(python('print(json.dumps([b.category(t) for t in data]))', cases.map(([t]) => t)))
      .toEqual(cases.map(([, category]) => category));
  });

  it('offers no depot as a bus station, a mall, a market or a supermarket, and no closed airfield as an airport', () => {
    const cases: Array<[Record<string, string>, string | null]> = [
      [{ name: 'Baku Bus Depo', amenity: 'bus_station', bus: 'yes', public_transport: 'station' }, null],
      [{ name: 'Penitensiar Xidmətin Avtonəqliyyat Təsərrüfatı', amenity: 'bus_station' }, null],
      [{ name: 'Avtobaza 3', public_transport: 'station', bus: 'yes' }, null],
      [{ name: 'Platforma 3', amenity: 'bus_station', public_transport: 'platform' }, null],
      [{ name: 'Sumqayıt Avtovağzalı', amenity: 'bus_station' }, 'bus_station'],
      [{ name: 'Koroğlu Avtobus stansiyası', public_transport: 'station', bus: 'yes' }, 'bus_station'],
      [{ name: 'Depo', railway: 'halt' }, 'rail'], // a railway halt named after the depot is a station
      [{ name: 'Qala Aerodromu', aeroway: 'aerodrome', landuse: 'military', military: 'airfield' }, null],
      [{ name: 'Бывший аэроклуб', aeroway: 'aerodrome', 'abandoned:aeroway': 'aerodrome' }, null],
      [{ name: 'Zabrat Aeroportu', aeroway: 'aerodrome' }, 'airport'],
      [{ name: 'Termianl 2', aeroway: 'terminal' }, 'airport'],
      // A chain's or a company's depot or warehouse, its word after another of the name.
      [{ name: 'Bravo Depo Ambar', amenity: 'marketplace', website: 'https://bravosupermarket.az/' }, null],
      [{ name: 'Oba Market DEPO', shop: 'supermarket' }, null],
      [{ name: 'Gəncə Şərab - DEPO \\ Keşlə', shop: 'mall' }, null],
      [{ name: 'Azərsun Holdinq Anbarı', shop: 'supermarket' }, null],
      [{ name: 'Depo Univermaq', shop: 'department_store' }, 'mall'], // a store named Depo
      [{ name: 'Lotos Ticarət Mərkəzi \\ Depo', shop: 'mall' }, 'mall'], // the district after " \ "
      [{ name: 'İlk İnşaat Anbarı', shop: 'doityourself' }, 'shop'], // a shop sells from its warehouse
      [{ name: 'Depo Cafe', amenity: 'cafe' }, 'cafe'],
    ];
    expect(python('print(json.dumps([b.category(t) for t in data]))', cases.map(([t]) => t)))
      .toEqual(cases.map(([, category]) => category));
  });

  it('writes out a street name\'s abbreviations, and tells a street named only by its kind and number (#743)', () => {
    const result = python(`print(json.dumps({
    "written": [b.written_out(n) for n in data["written"]],
    "numbered": [b.numbered_street(n) for n in data["numbered"]],
    "keys": [b.street_key(n) for n in data["keys"]]}))`, {
      written: ['Nizami küç.', 'S.Vurğun Küç.', 'Nizami küç', 'Neftçilər pr.', 'Nizami küç. 1-ci döngə', 'Küçük Bağ', 'Bakı pr',
        'küç.küç.'],
      numbered: ['Döngə 1', '1-ci döngə', '2-ci küçə', '1572-ci keçid', 'Keçid 3', 'Dalan 3a', 'Küçə', 'Nərimanov döngə 8',
        '2-ci Kiçik Qala döngəsi', '28 May küçəsi', '1-ci Gölkənarı'],
      keys: ['Salyan şosesi', 'Salyan Şossesi', 'Bakı-Sumqayıt yolu'],
    });
    expect(result).toEqual({
      written: ['Nizami küçəsi', 'S.Vurğun Küçəsi', 'Nizami küçəsi', 'Neftçilər prospekti', 'Nizami küçəsi 1-ci döngə', 'Küçük Bağ',
        'Bakı pr', 'küç.küç.'],
      numbered: [true, true, true, true, true, true, true, false, false, false, false],
      // Both spellings of the word for a highway are one name.
      keys: ['salyan sossesi', 'salyan sossesi', 'baki sumqayit yolu'],
    });
  });

  it('makes a street of the ways of one name near each other, at its middle, under the way that is on (#743)', () => {
    const result = python(`
def way(i, name, line, highway="residential", **tags):
    return {"type": "way", "id": i, "tags": {"name": name, "highway": highway, **tags},
            "geometry": [{"lat": p[0], "lon": p[1]} for p in line]}
roads = [
    way(1, "Nizami küç.", [(40.40, 49.80), (40.40, 49.81)], **{"name:ru": "улица Низами"}),
    way(2, "Nizami küçəsi", [(40.40, 49.81), (40.40, 49.82)], **{"name:en": "Nizami Street", "wikidata": "Q1"}),
    way(3, "Nizami küç.", [(40.45, 49.80), (40.45, 49.805)]),  # 5.6 km away: another street
    way(4, "Nizami küç.", [(40.40, 49.82), (40.401, 49.821)], "primary_link"),
    way(5, "Döngə 1", [(40.40, 49.80), (40.401, 49.80)]),
    way(6, "Fəvvarələr meydanı", [(40.37, 49.83), (40.371, 49.83)], "pedestrian", place="square"),
    way(7, "Terminal yolu", [(40.37, 49.83), (40.371, 49.83)], "service"),
    # An L: the centre of its lines is off them, and the point moves onto the nearer one.
    way(8, "Bucaq küç.", [(40.30, 49.80), (40.30, 49.81), (40.31, 49.81)]),
]
streets, left_out = b.streets(roads)
print(json.dumps({"streets": streets, "left_out": left_out}))`) as {
      streets: Array<{ id: string; name: string; point: [number, number]; aliases: string[]; length: number; notable: boolean }>;
      left_out: Record<string, number>;
    };
    const byId = Object.fromEntries(result.streets.map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['w1', 'w3', 'w8']);
    // Ways 1 and 2 are one street, its spelling written out, with every other name its ways
    // have, Wikidata's mark, and the 1.7 km between its ends; its middle is where they meet.
    expect(byId.w1).toEqual({ id: 'w1', name: 'Nizami küçəsi', category: 'street', point: [40.4, 49.81], notable: true,
      aliases: ['улица Низами', 'Nizami Street'], length: 1.7 });
    expect(byId.w3).toMatchObject({ name: 'Nizami küçəsi', point: [40.45, 49.8025], length: 0.4, notable: false });
    expect(byId.w8.point[1]).toBe(49.81);
    expect(byId.w8.point[0]).toBeGreaterThan(40.3);
    expect(byId.w8.point[0]).toBeLessThan(40.31);
    expect(result.left_out).toEqual({ 'highway=primary_link': 1, 'highway=service': 1, 'a place as well': 1, 'named only by its kind or number': 1 });
  });

  it('writes the settlement nearest a street after a name other streets share, if near and the street short (#743)', () => {
    const result = python(`
found = [{"name": n, "point": p, "length": l} for n, p, l in data]
named = b.beside(found, [{"name": "Saray", "point": (40.53, 49.71)}, {"name": "Balaxanı / Bakı", "point": (40.46, 49.92)}])
print(json.dumps({"names": [s["name"] for s in found], "named": named}))`, [
      ['Sabir küçəsi', [40.527, 49.715], 1.1],
      ['Sabir küçəsi', [40.45, 49.92], 0.4],
      ['Sabir küçəsi', [40.30, 50.30], 0.5], // no settlement within 2 km
      ['Sabir küçəsi', [40.531, 49.711], 5.2], // longer than 5 km: through several
      ['Saray küçəsi', [40.531, 49.711], 0.3], // no other street has its name
      ['Saray yolu', [40.531, 49.711], 0.3], ['Saray yolu', [40.529, 49.709], 0.3], // their names say it
      ['Salyan şosesi', [40.531, 49.711], 1.0], ['Salyan şossesi', [40.461, 49.921], 1.0], // one name, two spellings
    ]);
    expect(result).toEqual({
      names: ['Sabir küçəsi / Saray', 'Sabir küçəsi / Balaxanı', 'Sabir küçəsi', 'Sabir küçəsi', 'Saray küçəsi', 'Saray yolu',
        'Saray yolu', 'Salyan şosesi / Saray', 'Salyan şossesi / Balaxanı'],
      named: 4,
    });
  });

  it('builds the streets from the answer\'s roads, apart from its places, corrections and all (#743)', () => {
    const result = python(`
import contextlib, io, shutil, tempfile
from pathlib import Path
tmp = Path(tempfile.mkdtemp())
b.OUT = tmp / "places.json"
stations = json.loads(b.METRO.read_text(encoding="utf-8"))["stations"]
elements = [{"type": "node", "id": 100 + i, "lat": s["latitude"], "lon": s["longitude"],
             "tags": {"name": s["name"].removesuffix("-2"), "railway": "station", "station": "subway"}}
            for i, s in enumerate(stations)]
elements.append({"type": "node", "id": 1, "lat": 40.53, "lon": 49.71, "tags": {"name": "Saray", "place": "village"}})
line = lambda *ps: {"geometry": [{"lat": p[0], "lon": p[1]} for p in ps], "bounds": {}}
elements.append({"type": "way", "id": 7, "tags": {"name": "Sabir küç.", "highway": "residential", "name:en": "Bad words"},
                 **line((40.527, 49.714), (40.527, 49.716))})
elements.append({"type": "way", "id": 8, "tags": {"name": "Sabir küç.", "highway": "residential"},
                 **line((40.45, 49.92), (40.45, 49.921))})
answer = tmp / "answer.json"
answer.write_text(json.dumps({"osm3s": {"timestamp_osm_base": "2026-11-12T00:00:00Z"}, "elements": elements}))
b.PLACED_AT.clear(); b.ALIASES.clear()
def run(corrections):
    b.CORRECTIONS[:] = corrections
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            b.build(str(answer))
    except SystemExit as stop:
        return {"stopped": str(stop)}
    rows = [r for r in json.loads(b.OUT.read_text())["places"] if r[2] == "street"]
    b.OUT.unlink()
    return {"streets": rows}
result = {"fine": run([("w7", "name:en", "Bad words", None, "vandalism")]),
          "stale": run([("w8", "name:en", "Gone", None, "vandalism fixed since")])}
shutil.rmtree(tmp)
print(json.dumps(result))`) as { fine: { streets: unknown[][] }; stale: { stopped: string } };
    // The name a correction leaves out goes, and the two Sabir küçəsi are told apart.
    expect(result.fine.streets).toEqual([
      ['w8', 'Sabir küçəsi', 'street', 40.45, 49.9205, 0, [], 0.1],
      ['w7', 'Sabir küçəsi / Saray', 'street', 40.527, 49.715, 0, [], 0.2],
    ]);
    expect(result.stale.stopped).toMatch(/^CORRECTIONS whose value OpenStreetMap no longer has.*w8 name:en 'Gone'/);
  });

  it('counts Baku Crystal Hall\'s amenity=events_centre as an events venue', () => {
    expect(python('print(json.dumps([b.category(t) for t in data]))',
      [{ amenity: 'events_centre' }, { amenity: 'events_venue' }])).toEqual(['culture', 'culture']);
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
