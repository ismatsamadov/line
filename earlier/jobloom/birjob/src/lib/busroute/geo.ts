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

export const WALK_RADIUS_KM = 0.3; // 300 meters
export const WALK_SPEED_KMH = 4.5; // average walking speed

/** The reference network covers Baku and its surrounding settlements. A point
 * can be a valid world coordinate and still be corrupt here (517's 4.05° N).
 * Keep the same generous envelope used by the reference-data audit. */
export function isBakuCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 39.5 && latitude <= 41.5 && longitude >= 48.5 && longitude <= 51;
}
