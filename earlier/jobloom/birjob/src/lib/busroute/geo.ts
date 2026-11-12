/** Geographic helpers — ported verbatim from best_route_finding. */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// The longest straight-line walk in a journey: about five minutes, the distance a
// bus stop is usually taken to serve. It was 300 m until #721, which left the stop
// "Azərbaycan Hava Yolları QSC" without the 28 May hub 355 m away, so the trip to
// Sumqayıt took three buses where two go through Avtovağzal.
export const WALK_RADIUS_KM = 0.4;
export const WALK_SPEED_KMH = 4.5; // average walking speed
// The streets a walk takes are longer than its straight line. On OpenStreetMap's
// walking network in Baku the way on foot was 1.29 times the straight line at the
// median for walks of up to 400 m between stops, and 1.37 to 1.40 for the longer walks
// from and to a place and for the walk the whole way (measured 2026-11-11, #720); the
// open-data study of the network assumes 1.3. Every walk's minutes are reckoned on its
// straight line times this; the distances shown, and the limits a search walks within
// (WALK_RADIUS_KM, access.ts, routing.ts), stay straight lines.
export const WALK_DETOUR = 1.3;

/** Minutes on foot for a straight-line distance in km, its streets reckoned in. */
export const walkMinutes = (km: number) => ((km * WALK_DETOUR) / WALK_SPEED_KMH) * 60;

// The shortest a degree of latitude and of longitude gets inside the envelope below
// (up to 41.5° N). Spatial searches size their cells and boxes with them, so any
// pair within a walk falls in neighbouring cells.
export const MIN_KM_PER_DEGREE_LAT = 110.5;
export const MIN_KM_PER_DEGREE_LON = 83;

/** The reference network covers Baku and its surrounding settlements. A point
 * can be a valid world coordinate and still be corrupt here (517's 4.05° N).
 * Keep the same generous envelope used by the reference-data audit. */
export function isBakuCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 39.5 && latitude <= 41.5 && longitude >= 48.5 && longitude <= 51;
}
