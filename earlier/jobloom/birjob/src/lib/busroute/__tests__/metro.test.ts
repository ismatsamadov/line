import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import metroJson from '../metro.json';
import { MetroData, metroNetwork } from '../metro';
import { haversine, WALK_RADIUS_KM } from '../geo';
import type { LatLng } from '../types';
import { isMetroStation, METRO_STATION_ID_BASE } from '../types';
import { stop } from './fixtures';

const data = MetroData.parse(metroJson);
const km = (a: LatLng, b: LatLng) => haversine(a[0], a[1], b[0], b[1]);
const at = new Map(data.stations.map((s) => [s.name, [s.latitude, s.longitude] as LatLng]));

describe('metro.json (#689)', () => {
  it('is in git, not swallowed by the `*.json` line of .gitignore', () => {
    // Deploys ship `git ls-files`: an ignored file passes every check on the laptop
    // that has it and is missing on the box. That line has matched seven other files
    // the repository needs.
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    // --no-index: the rules themselves, which a tracked file would otherwise skip.
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', 'src/lib/busroute/metro.json'], { cwd: root });
    expect(ignored.status).toBe(1); // 0 would mean ignored, 128 no repository
  });

  it('puts every station in Baku and every exit beside its station', () => {
    // #685's lesson: check reference data against the place it describes, not only its shape.
    expect(data.stations).toHaveLength(27);
    expect(new Set(data.stations.map((s) => s.name)).size).toBe(27);
    for (const s of data.stations) {
      expect(s.latitude, s.name).toBeGreaterThan(40.2);
      expect(s.latitude, s.name).toBeLessThan(40.7);
      expect(s.longitude, s.name).toBeGreaterThan(49.5);
      expect(s.longitude, s.name).toBeLessThan(50.4);
      expect(data.lines[s.line], s.name).toBeDefined();
      expect(s.exits.length, s.name).toBeGreaterThan(0);
      for (const exit of s.exits) expect(km(exit, [s.latitude, s.longitude]), s.name).toBeLessThan(0.5);
    }
  });

  it('times every leg at a train speed, and runs each train along a track that meets its stations', () => {
    for (const ride of data.rides) {
      const legs = ride.stations.length - 1;
      expect([ride.seconds.length, ride.km.length, ride.paths.length]).toEqual([legs, legs, legs]);
      for (const name of ride.stations) expect(at.has(name), name).toBe(true);
      ride.paths.forEach((path, i) => {
        const leg = `${ride.stations[i]} → ${ride.stations[i + 1]}`;
        if (ride.vehicle === 'bus') return expect(path, leg).toBeNull();
        expect(path, leg).not.toBeNull();
        expect(km(path![0], at.get(ride.stations[i])!), leg).toBeLessThan(0.1);
        expect(km(path![path!.length - 1], at.get(ride.stations[i + 1])!), leg).toBeLessThan(0.1);
        const length = path!.slice(1).reduce((sum, point, j) => sum + km(path![j], point), 0);
        expect(Math.abs(length - ride.km[i]!), leg).toBeLessThan(0.1);
        // Seconds read as minutes, or the other way round, would leave this range.
        const kmh = ride.km[i]! / (ride.seconds[i] / 3600);
        expect(kmh, leg).toBeGreaterThan(10);
        expect(kmh, leg).toBeLessThan(80);
      });
    }
  });

  it('rides as the operator ran it on 25 October 2026', () => {
    // A refresh of metro.json that changes these is a change to what riders are told:
    // update this list on purpose, with docs/bus-routing.md.
    const rides = data.rides.map((r) => `${r.vehicle} ${r.stations[0]} → ${r.stations[r.stations.length - 1]}`);
    expect(rides).toEqual([
      'train Nəriman Nərimanov → Bakmil', 'train Bakmil → Nəriman Nərimanov',
      // The shuttle beyond Əhmədli is a change of train both ways.
      'train İçərişəhər → Əhmədli', 'train Əhmədli → Həzi Aslanov',
      'train Həzi Aslanov → Əhmədli', 'train Əhmədli → İçərişəhər',
      // No trains between Nizami and 28 May: the express bus runs instead.
      'train Dərnəgül → Nizami', 'bus Nizami → 28 May', 'bus 28 May → Nizami', 'train Nizami → Dərnəgül',
      'train Cəfər Cabbarlı → Şah İsmayıl Xətai', 'train Şah İsmayıl Xətai → Cəfər Cabbarlı',
      // The planner's wait at Avtovağzal, on the way to Xocəsən only, is not a change.
      'train Xocəsən → 8 Noyabr', 'train 8 Noyabr → Xocəsən',
    ]);
  });
});

describe('metroNetwork (#689)', () => {
  const network = metroNetwork([]);
  const id = (name: string) => network.stations.find((s) => s.name === name)!.id;
  const name = (stopId: number) => network.stations.find((s) => s.id === stopId)?.name;

  it('gives the stations ids no bus stop has', () => {
    expect(network.stations).toHaveLength(27);
    expect(network.stations.every((s) => s.id > METRO_STATION_ID_BASE && isMetroStation(s.id))).toBe(true);
    expect(new Set(network.stations.map((s) => s.id)).size).toBe(27);
  });

  it('rides each service from station to station in order, toward its terminus', () => {
    const sahil = network.edges.filter((e) => e.from === id('Sahil')).map((e) => e.edge);
    expect(sahil.map((e) => e.kind === 'metro' && [name(e.toStopId), e.headsign])).toEqual(expect.arrayContaining([
      ['28 May', 'Əhmədli'], ['İçərişəhər', 'İçərişəhər'],
    ]));
    // Every leg but a ride's last continues on the same ride from the station it reaches.
    for (const { edge } of network.edges) {
      if (edge.kind !== 'metro' || name(edge.toStopId) === edge.headsign) continue;
      const onward = network.edges.filter((e) => e.from === edge.toStopId && e.edge.kind === 'metro' && e.edge.rideId === edge.rideId);
      expect(onward.map((e) => e.edge.kind === 'metro' && e.edge.fromSequence)).toEqual([edge.toSequence]);
    }
  });

  it('runs the express bus between Nizami and 28 May, with no track', () => {
    const bus = network.edges.filter((e) => e.edge.kind === 'metro' && e.edge.vehicle === 'bus');
    expect(bus.map((e) => `${name(e.from)} → ${name(e.edge.toStopId)}`)).toEqual(['Nizami → 28 May', '28 May → Nizami']);
    for (const { edge } of bus) {
      expect(edge).toMatchObject({ busId: -2, busNumber: 'M1/M2', time: 3 });
      expect('path' in edge).toBe(false);
    }
  });

  it('walks between stations only within the two interchanges', () => {
    const walks = network.edges
      .filter((e) => e.edge.kind === 'walk' && isMetroStation(e.from) && isMetroStation(e.edge.toStopId))
      .map((e) => `${name(e.from)} → ${name(e.edge.toStopId)}`);
    expect(walks.sort()).toEqual([
      '28 May → Cəfər Cabbarlı', 'Cəfər Cabbarlı → 28 May', 'Memar Əcəmi → Memar Əcəmi-2', 'Memar Əcəmi-2 → Memar Əcəmi',
    ]);
  });

  it("walks from a stop to a station within a walk (400 m) of the stop's nearest exit, and draws the walk by it", () => {
    // Xocəsən has one exit, 83 m from the station's point.
    const xocesen = data.stations.find((s) => s.name === 'Xocəsən')!;
    const [exit] = xocesen.exits;
    const near = stop(1, exit[0] + 0.0009, exit[1]);           // 100 m north of the exit
    const far = stop(2, exit[0] + 0.0039, exit[1]);            // 434 m north of it
    const east = stop(3, xocesen.latitude, xocesen.longitude + 0.0045); // 381 m from the point, 458 m from the exit
    expect(WALK_RADIUS_KM).toBe(0.4);
    expect(km([east.latitude, east.longitude], [xocesen.latitude, xocesen.longitude])).toBeLessThan(WALK_RADIUS_KM);
    expect(km([far.latitude, far.longitude], exit)).toBeGreaterThan(WALK_RADIUS_KM);
    const network = metroNetwork([near, far, east]);
    const station = network.stations.find((s) => s.name === 'Xocəsən')!;
    const walks = network.edges.filter((e) => e.edge.kind === 'walk' && !(isMetroStation(e.from) && isMetroStation(e.edge.toStopId)));
    expect(walks.map((e) => [e.from, e.edge.toStopId])).toEqual([[1, station.id], [station.id, 1]]);
    expect(walks[0].edge.distance).toBeCloseTo(0.1, 2);
    expect(walks[0].edge.time).toBeCloseTo((walks[0].edge.distance * 1.3 / 4.5) * 60);
    expect(walks[0].edge).toMatchObject({ path: [[near.latitude, near.longitude], exit, [station.latitude, station.longitude]] });
    expect(walks[1].edge).toMatchObject({ path: [[station.latitude, station.longitude], exit, [near.latitude, near.longitude]] });
  });

  it("measures to the station's nearest exit", () => {
    const koroglu = data.stations.find((s) => s.name === 'Koroğlu')!;
    const exit = koroglu.exits[koroglu.exits.length - 1];
    const network = metroNetwork([stop(1, exit[0], exit[1] + 0.0006)]); // 51 m east of that exit
    const [walk] = network.edges.filter((e) => e.from === 1);
    const nearest = Math.min(...koroglu.exits.map((e) => km(e, [exit[0], exit[1] + 0.0006])));
    expect(walk.edge.distance).toBeCloseTo(nearest, 6);
    expect(walk.edge.kind === 'walk' && walk.edge.path?.[1]).toEqual(koroglu.exits.find((e) => km(e, [exit[0], exit[1] + 0.0006]) === nearest));
  });

  it('refuses a ride that names a station it does not have', () => {
    const broken = { ...metroJson, rides: [{ ...metroJson.rides[0], stations: ['Nowhere', 'Bakmil'] }] };
    expect(() => metroNetwork([], broken)).toThrow(/does not fit/);
    expect(() => metroNetwork([], { ...metroJson, rides: 'none' })).toThrow();
  });
});
