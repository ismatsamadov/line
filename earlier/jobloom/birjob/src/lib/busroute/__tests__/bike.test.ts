import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import bikeJson from '../bike.json';
import { BIKE, journeyBikeParking, nearestBikeParking, type BikeParking } from '../bike';
import { haversine, WALK_RADIUS_KM } from '../geo';
import type { LatLng, RouteResult, RouteSegment } from '../types';

const km = (a: LatLng, b: LatLng) => haversine(a[0], a[1], b[0], b[1]);
// The box around Baku and Absheron that the metro's stations are held to.
const inBaku = ([lat, lng]: LatLng) => lat > 40.2 && lat < 40.7 && lng > 49.5 && lng < 50.4;

describe('bike.json (#692)', () => {
  it('is in git, not swallowed by the `*.json` line of .gitignore', () => {
    // Deploys ship `git ls-files`: an ignored copy passes every check on the laptop
    // that has it and is missing on the box (metro.test.ts has the history).
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', 'src/lib/busroute/bike.json'], { cwd: root });
    expect(ignored.status).toBe(1); // 0 would mean ignored, 128 no repository
  });

  it('says whose data it is, under what licence, and where to fetch it again', () => {
    expect(bikeJson.source.license).toMatch(/^CC0/);
    for (const file of [bikeJson.source.lanes, bikeJson.source.parking]) {
      expect(file.dataset).toMatch(/^https:\/\/opendata\.az\/@azerbaycan-yerustu-neqliyyat-agentliyi\//);
      expect(file.download).toMatch(/^https:\/\/admin\.opendata\.az\/dataset\/.+\.kmz$/);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('puts every lane and every rack in Baku and Absheron, and no lane jumps', () => {
    // #685's lesson: check reference data against the place it describes. KML writes
    // longitude first; read the other way round, every point lands near 49.8° N, 40.4° E.
    for (const lane of BIKE.lanes) {
      expect(lane.street).not.toBe('');
      expect(lane.path.length, lane.street).toBeGreaterThanOrEqual(2);
      for (const point of lane.path) {
        expect(point, lane.street).toHaveLength(2);
        expect(inBaku(point), `${lane.street} ${point}`).toBe(true);
      }
      lane.path.slice(1).forEach((point, i) => expect(km(lane.path[i], point), lane.street).toBeLessThan(3));
    }
    for (const rack of BIKE.parking) expect(inBaku([rack.latitude, rack.longitude]), rack.name).toBe(true);
    expect(new Set(BIKE.parking.map((rack) => rack.name)).size).toBe(BIKE.parking.length);
  });

  it('holds what AYNA published: the lanes on 24 September 2026, the racks on 4 May', () => {
    // A refresh that changes these changes what riders are shown: update them on
    // purpose, with docs/bus-routing.md.
    expect(BIKE.lanes).toHaveLength(60);
    expect(new Set(BIKE.lanes.map((lane) => lane.street)).size).toBe(54);
    const length = BIKE.lanes.reduce((sum, lane) => sum + lane.path.slice(1).reduce((s, point, i) => s + km(lane.path[i], point), 0), 0);
    expect(length).toBeCloseTo(57.1, 1);
    expect(BIKE.parking).toHaveLength(185);
    expect(BIKE.parking[0].name).toBe('MPV-1-2');
  });
});

describe('nearestBikeParking (#692)', () => {
  // 0.001° of latitude is 111 m; at 40.4° N, 0.001° of longitude is 85 m.
  const racks: BikeParking[] = [
    { name: 'A', latitude: 40.4, longitude: 49.85 },
    { name: 'B', latitude: 40.401, longitude: 49.85 },
  ];

  it('names the nearest rack within a walk, and none beyond it', () => {
    expect(nearestBikeParking(40.4002, 49.85, racks)?.name).toBe('A');
    expect(nearestBikeParking(40.4008, 49.85, racks)?.name).toBe('B');
    const east = nearestBikeParking(40.4, 49.853, racks)!;
    expect(east.name).toBe('A');
    expect(east.distance).toBeCloseTo(haversine(40.4, 49.853, 40.4, 49.85), 9);
    expect(east.distance).toBeLessThan(WALK_RADIUS_KM);
    expect(nearestBikeParking(40.397, 49.85, racks)).toBeNull(); // 334 m south of A
    expect(nearestBikeParking(40.4, 49.85, [])).toBeNull();
  });

  it('agrees with a search of every rack, on the real data', () => {
    let seed = 692;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let found = 0;
    for (let i = 0; i < 2000; i++) {
      const lat = 40.36 + random() * 0.06, lng = 49.80 + random() * 0.15;
      const nearest = [...BIKE.parking].sort((a, b) =>
        haversine(lat, lng, a.latitude, a.longitude) - haversine(lat, lng, b.latitude, b.longitude))[0];
      const got = nearestBikeParking(lat, lng);
      if (haversine(lat, lng, nearest.latitude, nearest.longitude) <= WALK_RADIUS_KM) {
        found++;
        expect(got?.name).toBe(nearest.name);
      } else {
        expect(got).toBeNull();
      }
    }
    expect(found).toBeGreaterThan(100);
  });
});

describe('journeyBikeParking (#692)', () => {
  const at = (id: number, latitude: number, longitude: number) => ({ id, name: `Stop ${id}`, latitude, longitude });
  const segment = (mode: RouteSegment['mode'], stops: Array<ReturnType<typeof at>>): RouteSegment => ({
    busId: mode === 'walk' ? -1 : 10, busNumber: mode === 'walk' ? 'walk' : '10', mode,
    direction: mode === 'bus' ? 1 : null, headsign: mode === 'walk' ? null : 'Terminus', stops, distance: 1, time: 1,
  });
  const journey = (...segments: RouteSegment[]): RouteResult => ({ segments, totalDistance: 1, totalTime: 1, totalTransfers: 0, totalStops: 2 });
  // Each rack 11 m from the stop it is named after; the walks' far ends are about 220 m
  // from the racks beside the rides, so a rack chosen at a walk's far end would differ.
  const racks: BikeParking[] = [
    { name: 'by the walk start', latitude: 40.3981, longitude: 49.85 },
    { name: 'by the boarding', latitude: 40.4001, longitude: 49.85 },
    { name: 'by the alighting', latitude: 40.4501, longitude: 49.9 },
    { name: 'by the walk end', latitude: 40.4521, longitude: 49.9 },
  ];

  it('takes the racks beside the first boarding and the last alighting, not the walks around them', () => {
    const ends = journeyBikeParking(journey(
      segment('walk', [at(1, 40.398, 49.85), at(2, 40.4, 49.85)]),
      segment('bus', [at(2, 40.4, 49.85), at(3, 40.42, 49.87)]),
      segment('metro', [at(1_000_001, 40.421, 49.871), at(1_000_002, 40.45, 49.9)]),
      segment('walk', [at(1_000_002, 40.45, 49.9), at(4, 40.452, 49.9)]),
    ), racks);
    expect(ends?.boarding).toMatchObject({ stop: { id: 2 }, parking: { name: 'by the boarding' } });
    expect(ends?.alighting).toMatchObject({ stop: { id: 1_000_002 }, parking: { name: 'by the alighting' } });
    expect(ends!.boarding!.parking.distance).toBeLessThan(0.02);
  });

  it('keeps the one end that has a rack', () => {
    const ends = journeyBikeParking(journey(segment('bus', [at(2, 40.4, 49.85), at(6, 40.31, 49.71)])), racks);
    expect(ends?.boarding?.parking.name).toBe('by the boarding');
    expect(ends?.alighting).toBeNull();
  });

  it('is null for a journey on foot, and when neither end has a rack within a walk', () => {
    expect(journeyBikeParking(journey(segment('walk', [at(1, 40.4, 49.85), at(2, 40.401, 49.85)])), racks)).toBeNull();
    expect(journeyBikeParking(journey(segment('bus', [at(5, 40.3, 49.7), at(6, 40.31, 49.71)])), racks)).toBeNull();
  });
});
