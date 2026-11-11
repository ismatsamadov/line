import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import placesJson from '../places.json';
import metroJson from '../metro.json';
import { buildPlaceIndex, getPlaceIndex, PlacesData, searchPlaces } from '../places';
import { haversine, isBakuCoordinate } from '../geo';
import { normalizeSearch } from '../searchText';

const data = PlacesData.parse(placesJson);
const FILE = fileURLToPath(new URL('../places.json', import.meta.url));
// The network's area the script asks Overpass for (BBOX in build_places_json.py).
const inArea = (lat: number, lng: number) => lat >= 39.92 && lat <= 40.66 && lng >= 49.37 && lng <= 50.39;

describe('places.json (#720)', () => {
  it('is in git, not swallowed by the `*.json` line of .gitignore', () => {
    // Deploys ship `git ls-files`: an ignored copy passes every check on the laptop
    // that has it and is missing on the box (metro.test.ts has the history).
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', 'src/lib/busroute/places.json'], { cwd: root });
    expect(ignored.status).toBe(1); // 0 would mean ignored, 128 no repository
  });

  it('says whose data it is, under what licence, of when, and how it was read', () => {
    // ODbL: the credit, and how the derived database was made, travel with it.
    const { source } = placesJson;
    expect(source.data).toBe('© OpenStreetMap contributors');
    expect(source.license).toMatch(/^Open Database License \(ODbL\) 1\.0$/);
    expect(source.copyright).toBe('https://www.openstreetmap.org/copyright');
    expect(source.snapshot).toBe('2026-11-11T06:09:21Z');
    expect(source.read >= source.snapshot.slice(0, 10)).toBe(true);
    expect(source.api).toBe('https://overpass-api.de/api/interpreter');
    // Pinned to the snapshot, so the same query fetches the same features again.
    expect(source.query).toMatch(/^\[out:json\]\[timeout:900\]\[bbox:39\.92,49\.37,40\.66,50\.39\]\[date:"2026-11-11T06:09:21Z"\];/);
    expect(source.answer_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(source.script).toBe('scripts/bus/build_places_json.py');
    expect(placesJson.fields).toEqual(['id', 'name', 'category', 'latitude', 'longitude', 'notable', 'aliases']);
  });

  it('stays small enough to keep in memory and out of the browser', () => {
    // Read on the server only; the search sends eight places at a time.
    expect(statSync(FILE).size).toBeLessThan(3_000_000);
  });

  it('puts every place in the network\'s area, under its own id, name and category', () => {
    // #685's lesson: check reference data against the place it describes.
    const ids = new Set<string>();
    for (const [id, name, category, lat, lng, , aliases] of data.places) {
      expect(ids.has(id), id).toBe(false);
      ids.add(id);
      expect(inArea(lat, lng) && isBakuCoordinate(lat, lng), `${id} ${name}`).toBe(true);
      expect(data.labels[category], `${id} ${category}`).toBeDefined();
      expect(name).toBe(name.trim());
      expect(/\p{L}/u.test(name), `${id} ${name}`).toBe(true);
      expect(name, id).not.toMatch(/\\/); // the mappers' "Name \ Place" is written "Name / Place"
      // Another name is one the search could not find through the shown one.
      const folded = new Set([normalizeSearch(name)]);
      for (const alias of aliases) {
        expect(folded.has(normalizeSearch(alias)), `${id} ${alias}`).toBe(false);
        folded.add(normalizeSearch(alias));
      }
    }
  });

  it('leaves out names that only say what the place is, or are a building\'s number', () => {
    // "Kafe" ×100 would fill a search for cafés with rows nobody can tell apart.
    const names = new Set(data.places.map(([, name]) => normalizeSearch(name)));
    for (const plain of ['Kafe', 'Market', 'Məscid', 'Uşaq bağçası', 'Parkinq', 'Aptek', 'İnşaat Malları', 'Abidə',
      'Bina 1', 'Bina 11', 'ev 111a', 'Корпус № 2', 'Дом', 'Ev', 'Мужской салон', 'Шашлычная', 'Чайхана-кальянная']) {
      expect(names.has(normalizeSearch(plain)), plain).toBe(false);
    }
    expect(data.places.some(([, name]) => / ATM$/i.test(name))).toBe(false);
    // A building's word with more to it is a name: a housing cooperative, a guest house.
    expect(names.has('bina mtk') && names.has('ev goradil')).toBe(true);
  });

  it('leaves out country houses mapped as guest houses, and the misspelt first of the numbered buildings', () => {
    expect(data.places.filter(([, name, category]) => category === 'hotel' && /дача/i.test(name))).toEqual([]);
    expect(data.places.some(([id]) => id === 'w630137385')).toBe(false); // "Корупс № 1"
  });

  it('writes no word in both alphabets, which neither keyboard can type (CORRECTIONS in the build script)', () => {
    for (const [id, name, , , , , aliases] of data.places) {
      for (const n of [name, ...aliases]) {
        const mixed = (n.match(/\p{L}+/gu) ?? []).filter((w) => /\p{Script=Latin}/u.test(w) && /\p{Script=Cyrillic}/u.test(w));
        expect(mixed, `${id} ${n}`).toEqual([]);
      }
    }
    const named = (id: string) => data.places.find(([placeId]) => placeId === id)?.[1];
    expect(named('n4481359889')).toBe('Araz Market / Babək'); // "Araя": я is z in the Russian layout
    expect(named('n9943368707')).toBe('Leon Palace Şadlıq Sarayı');
    expect(named('n4212308706')).toBe('Lotos Ticarət Mərkəzi / 8-ci km');
  });

  it('keeps out the name a vandal gave Heydar Aliyev\'s grave (CORRECTIONS in the build script)', () => {
    // Its English name was an insult, and the picker showed it as the other name that
    // matched "aliyev". The memorial keeps its own name and its Russian one.
    for (const [id, name, , , , , aliases] of data.places) {
      for (const n of [name, ...aliases]) expect(n, id).not.toMatch(/mafia boss/i);
    }
    expect(data.places.find(([id]) => id === 'n3755614407'))
      .toEqual(['n3755614407', 'HEYDƏR ƏLİYEV', 'sight', 40.36175, 49.81999, 0, ['Могила Гейдара Алиева']]);
  });

  it('puts the airport at its Terminal 1, not mid-airfield (PLACED_AT in the build script)', () => {
    const at = (id: string) => data.places.find(([placeId]) => placeId === id)!;
    expect(at('w163717459').slice(1, 5)).toEqual(['Heydər Əliyev Beynəlxalq Aeroportu', 'airport', ...at('w372129341').slice(3, 5)]);
    expect(at('w163717459')[6]).toEqual(expect.arrayContaining(['Aeroport', 'Hava limanı', 'Airport', 'Аэропорт']));
  });

  it('holds one place per name and category where OpenStreetMap maps it twice', () => {
    // The node of a mall and its outline, the node of a town and its boundary: the
    // script's DUPLICATE_KM, larger for larger features.
    const limit: Record<string, number> = { settlement: 5, area: 1.5, residential: 1, park: 1, beach: 1 };
    const groups = new Map<string, Array<[number, number]>>();
    for (const [, name, category, lat, lng] of data.places) {
      const key = `${category}|${normalizeSearch(name)}`;
      const near = (groups.get(key) ?? []).find(([a, b]) => haversine(a, b, lat, lng) <= (limit[category] ?? 0.3));
      expect(near, `${category} ${name}`).toBeUndefined();
      groups.set(key, [...(groups.get(key) ?? []), [lat, lng]]);
    }
  });

  it('offers the planner\'s own 27 metro stations, where metro.json puts them', () => {
    const metro = data.places.filter(([, , category]) => category === 'metro');
    expect(metro.map(([, name]) => name).sort()).toEqual(metroJson.stations.map((s) => s.name).sort());
    for (const [, name, , lat, lng] of metro) {
      const station = metroJson.stations.find((s) => s.name === name)!;
      expect([lat, lng], name).toEqual([station.latitude, station.longitude]);
    }
    const koroglu = metro.find(([, name]) => name === 'Koroğlu')!;
    expect(koroglu[6]).toContain('Məşədi Əzizbəyov'); // its old name, still searched
    // Each has a Russian name: seven stations' come from ALIASES in the build script.
    for (const [, name, , , , , aliases] of metro) expect(aliases.some((a) => /\p{Script=Cyrillic}/u.test(a)), name).toBe(true);
  });

  it('is dated on the planner page as the file dates it', () => {
    // The page tells riders how old the places are; a refresh must move both.
    const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
    const [year, month, day] = placesJson.source.snapshot.slice(0, 10).split('-').map(Number);
    const page = readFileSync(fileURLToPath(new URL('../../../app/aletler/avtobus-marsrutu/page.tsx', import.meta.url)), 'utf8');
    expect(page).toContain(`const PLACES_DATE = '${day} ${MONTHS[month - 1]} ${year}-`);
  });

  it('holds what OpenStreetMap had on 11 November 2026', () => {
    // A refresh that changes these changes what riders are offered: update them on
    // purpose, with docs/bus-routing.md.
    const counts = Object.fromEntries(Object.keys(data.labels).map((c) => [c, 0]));
    for (const [, , category] of data.places) counts[category]++;
    expect(counts).toEqual({
      metro: 27, rail: 54, bus_station: 15, airport: 8, port: 10, mall: 145, market: 62, supermarket: 1032,
      shop: 1849, restaurant: 1558, cafe: 1142, hotel: 423, university: 78, college: 123, school: 634,
      kindergarten: 388, hospital: 398, clinic: 230, government: 1198, embassy: 66, post_office: 256, bank: 242,
      office: 445, park: 216, square: 4, sight: 388, museum: 58, theatre: 66, culture: 211, sport: 221, fun: 66,
      worship: 199, beach: 60, settlement: 133, area: 161, residential: 468,
    });
    expect(data.places).toHaveLength(12_634);
    expect(data.labels).toMatchObject({ mall: 'Ticarət mərkəzi', metro: 'Metro stansiyası', university: 'Universitet' });
  });
});

describe('searchPlaces (#720)', () => {
  const row = (id: string, name: string, category: string, lat = 40.4, lng = 49.85, notable: 0 | 1 = 0, aliases: string[] = []) =>
    [id, name, category, lat, lng, notable, aliases];
  const labels = { metro: 'Metro stansiyası', mall: 'Ticarət mərkəzi', supermarket: 'Supermarket', university: 'Universitet', sight: 'Görməli yer' };
  const index = buildPlaceIndex({
    labels,
    places: [
      row('n1', 'Gənclik', 'metro', 40.4, 49.851, 1, ['Ganjlik', 'Гянджлик']),
      row('w2', 'Gənclik Mall', 'mall', 40.401, 49.852, 1, ['Ganjlik Mall']),
      row('n3', 'Yeni Gənclik Market', 'supermarket'),
      row('n4', 'Bravo', 'supermarket', 40.40, 49.80),
      row('n5', 'Bravo', 'supermarket', 40.40, 49.90),
      row('n6', 'ADA Universiteti', 'university', 40.395, 49.849, 0, ['ADA University']),
      row('n7', 'Şirvanşahlar Sarayı', 'sight'),
      row('n8', 'Koroğlu', 'metro', 40.42, 49.918, 1, ['Məşədi Əzizbəyov']),
    ],
  });
  const ids = (query: string, options?: Parameters<typeof searchPlaces>[2]) => searchPlaces(index, query, options).map((p) => p.id);

  it('ranks the name itself, then names that start with it, then words that do, then looser matches', () => {
    const found = searchPlaces(index, 'gənclik');
    expect(found.map((p) => [p.id, p.rank])).toEqual([['n1', 0], ['w2', 1], ['n3', 2]]);
    expect(found[0]).toEqual({ id: 'n1', name: 'Gənclik', category: 'metro', label: 'Metro stansiyası', latitude: 40.4, longitude: 49.851, rank: 0 });
    expect(searchPlaces(index, 'mall gənc').map((p) => [p.id, p.rank])).toEqual([['w2', 1]]); // 2, a mall a step up
    // The category's name counts too, below every match on the name.
    expect(searchPlaces(index, 'gənclik metro').map((p) => [p.id, p.rank])).toEqual([['n1', 2]]); // 3, a station a step up
    expect(searchPlaces(index, 'sarayi').map((p) => [p.id, p.rank])).toEqual([['n7', 2]]);
    expect(searchPlaces(index, 'vanşahlar').map((p) => [p.id, p.rank])).toEqual([['n7', 3]]);
    expect(ids('ahl')).toEqual([]); // under four letters, a word must start a word
  });

  it('lets a station, an airport or a mall a step up from its words\' match, never to the name itself', () => {
    // "nerimanov" is the station's second word; eight places whose names start with it
    // filled the list, and the station was not in it.
    const offices = ['Parkı', 'Məhkəməsi', 'Bələdiyyəsi', 'Prokurorluğu', 'Polis İdarəsi', 'İcra Şöbəsi', 'Mədəniyyət Evi', 'Kitabxanası']
      .map((what, i) => row(`n${20 + i}`, `Nərimanov ${what}`, 'sight'));
    const hub = buildPlaceIndex({ labels, places: [...offices, row('n9', 'Nəriman Nərimanov', 'metro', 40.4, 49.87, 1)] });
    expect(searchPlaces(hub, 'nerimanov')[0]).toMatchObject({ id: 'n9', rank: 1 });
    expect(searchPlaces(hub, 'nəriman nərimanov')[0]).toMatchObject({ id: 'n9', rank: 0 });
    // A mall that starts with what was typed stays below the place that is named it.
    expect(searchPlaces(index, 'gənclik').map((p) => [p.id, p.rank])).toEqual([['n1', 0], ['w2', 1], ['n3', 2]]);
  });

  it('folds Azerbaijani letters for a Latin keyboard and finds the other names', () => {
    expect(ids('GENCLIK')).toEqual(['n1', 'w2', 'n3']);
    expect(ids('sirvansahlar')).toEqual(['n7']);
    expect(ids('ŞİRVANŞAHLAR SARAYI')).toEqual(['n7']);
    expect(searchPlaces(index, 'ganjlik mall')).toMatchObject([{ id: 'w2', rank: 0, alias: 'Ganjlik Mall', name: 'Gənclik Mall' }]);
    expect(searchPlaces(index, 'гянджлик')).toMatchObject([{ id: 'n1', alias: 'Гянджлик' }]);
    expect(searchPlaces(index, 'meşədi əzizbəyov')).toMatchObject([{ id: 'n8', name: 'Koroğlu', alias: 'Məşədi Əzizbəyov' }]);
    expect(searchPlaces(index, 'ada university')).toMatchObject([{ id: 'n6', alias: 'ADA University' }]);
    // A match on the shown name is not repeated as an alias.
    expect(searchPlaces(index, 'ada')[0]).not.toHaveProperty('alias');
  });

  it('tries a query that matches nothing again without its spaces, against names without theirs', () => {
    expect(searchPlaces(index, 'gənclikmall')).toMatchObject([{ id: 'w2', rank: 0 }]);
    expect(searchPlaces(index, 'ganjlikmall')).toMatchObject([{ id: 'w2', rank: 0, alias: 'Ganjlik Mall' }]);
    expect(searchPlaces(index, 'gənc likma').map((p) => [p.id, p.rank])).toEqual([['w2', 1], ['n3', 3]]); // Yeni Gənclik Market
    expect(ids('likmall')).toEqual(['w2']); // four letters or more: somewhere in the name
    expect(ids('ikm')).toEqual([]);
    // A query that matches with its spaces keeps that match: "Adapark" stays a looser one.
    const two = buildPlaceIndex({ labels, places: [row('n1', 'Ada Park', 'sight'), row('n2', 'Adapark', 'sight')] });
    expect(searchPlaces(two, 'ada park').map((p) => [p.id, p.rank])).toEqual([['n1', 0], ['n2', 3]]);
  });

  it('puts the weightier category first among equal matches, and the nearer place among equals', () => {
    expect(ids('bravo')).toEqual(['n4', 'n5']); // the same: then by id
    expect(ids('bravo', { near: { latitude: 40.4, longitude: 49.9 } })).toEqual(['n5', 'n4']);
    expect(ids('bravo', { near: { latitude: 40.4, longitude: 49.81 } })).toEqual(['n4', 'n5']);
  });

  it('finds nothing for under two letters, and at most `limit` places', () => {
    expect(ids('')).toEqual([]);
    expect(ids(' g ')).toEqual([]);
    expect(ids('?!')).toEqual([]);
    expect(ids('gə')).toEqual(['n1', 'w2', 'n3']);
    expect(ids('gənclik', { limit: 2 })).toEqual(['n1', 'w2']);
  });

  it('refuses a file of the wrong shape or with an unknown category', () => {
    expect(() => buildPlaceIndex({ labels, places: [['x1', 'A', 'mall', 40.4, 49.8, 0, []]] })).toThrow();
    expect(() => buildPlaceIndex({ labels, places: [row('n1', 'A', 'casino')] })).toThrow(/unknown category casino/);
    expect(() => buildPlaceIndex({ labels })).toThrow();
  });

  it('finds the places people ask for in the real data', async () => {
    const real = await getPlaceIndex();
    expect(await getPlaceIndex()).toBe(real); // built once
    const first = (query: string) => searchPlaces(real, query)[0];
    expect(first('gənclik mall')).toMatchObject({ name: 'Gənclik Mall', label: 'Ticarət mərkəzi', rank: 0 });
    // A metro station among the places whose names start with its words (HUBS in places.ts).
    for (const query of ['nerimanov', 'narimanov', 'nərimanov']) {
      expect(searchPlaces(real, query).slice(0, 3).map((p) => p.name), query).toContain('Nəriman Nərimanov');
    }
    expect(first('nerimanov')).toMatchObject({ name: 'Nəriman Nərimanov', category: 'metro' });
    expect(first('28 mall')).toMatchObject({ name: '28 Mall', category: 'mall', rank: 0 });
    expect(first('28mall')).toMatchObject({ name: '28 Mall', category: 'mall', rank: 0 });
    expect(first('parkbulvar')).toMatchObject({ name: 'Park Bulvar', category: 'mall', rank: 0 });
    expect(first('hazi aslanov')).toMatchObject({ name: 'Həzi Aslanov', category: 'metro' });
    expect(searchPlaces(real, 'гянджлик').slice(0, 2)).toMatchObject([
      { name: 'Gənclik', category: 'metro', alias: 'Гянджлик' }, { name: 'Gənclik Mall', alias: 'Гянджлик Мол' },
    ]);
    expect(first('28 may')).toMatchObject({ name: '28 May', category: 'metro' });
    expect(first('nizami')).toMatchObject({ name: 'Nizami', category: 'metro' });
    expect(first('ganjlik')).toMatchObject({ name: 'Gənclik', category: 'metro', alias: 'Ganjlik' });
    expect(first('ada universiteti')).toMatchObject({ name: 'ADA Universiteti', category: 'university' });
    expect(first('bakı dövlət universiteti')).toMatchObject({ name: 'Bakı Dövlət Universiteti' });
    expect(first('port baku')).toMatchObject({ name: 'Port Baku', category: 'mall' });
    expect(first('qiz qalasi')).toMatchObject({ name: 'Qız Qalası', category: 'sight' });
    expect(first('mərdəkan')).toMatchObject({ name: 'Mərdəkan', category: 'settlement' });
    expect(searchPlaces(real, "mcdonald's")).toHaveLength(8);
    // Names OpenStreetMap lacks, from ALIASES in the build script, and Baku Crystal Hall,
    // tagged amenity=events_centre.
    for (const [query, id] of [['bdu', 'w479865023'], ['бгу', 'w479865023'], ['adnsu', 'r3983666'],
      ['neft akademiyası', 'r3983666'], ['qafqaz universiteti', 'w32720577'], ['alov qüllələri', 'w340060268'],
      ['flame towers', 'w340060268'], ['heydar aliyev center', 'r19380164'], ['crystal hall', 'w249204041']]) {
      expect(first(query), query).toMatchObject({ id });
    }
    // The airport is the first answer for the words people use for it, and sits by a stop
    // a bus serves: Beynəlxalq Hava Limanı Terminal 1 (AYNA code 1001585), where the H1
    // starts. At its outline's centre, on the airfield, the nearest stop was 1,027 m away.
    for (const query of ['аэропорт', 'airport', 'aeroport', 'hava limanı', 'heydər əliyev beynəlxalq aeroportu']) {
      const airport = searchPlaces(real, query)[0];
      expect(airport, query).toMatchObject({ id: 'w163717459', name: 'Heydər Əliyev Beynəlxalq Aeroportu', category: 'airport' });
      expect(haversine(airport.latitude, airport.longitude, 40.464605, 50.052728), query).toBeLessThan(0.6);
    }
    // An apostrophe joins its word: "papa johns" found none of the six before.
    expect(searchPlaces(real, 'papa johns').map((p) => p.alias ?? p.name)).toEqual(Array(6).fill("Papa John's"));
    expect(searchPlaces(real, 'mcdonalds').map((p) => p.name)).toEqual(Array(8).fill("McDonald's"));
  });
});
