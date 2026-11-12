import type { Bus, BusStop, GraphEdge, LatLng, StopDetail } from '../types';

export const stop = (id: number, latitude = 40 + id * 0.01, longitude = 49): StopDetail => ({
  id, name: `Stop ${id}`, code: String(id), latitude, longitude, is_transport_hub: false,
});
export const bus = (id: number): Bus => ({
  id, number: String(id), carrier: '', first_point: 'A', last_point: 'B', route_length: 10,
  tariff: 0, tariff_str: '', region_id: 1, working_zone_type_id: 1, duration_minuts: 30,
});
export const busStop = (busId: number, stopId: number, sequence: number, direction = 1): BusStop => ({
  id: busId * 100 + sequence, bus_stop_id: sequence, bus_id: busId, stop_id: stopId,
  stop_code: '', stop_name: `Stop ${stopId}`, total_distance: sequence, intermediate_distance: 1, direction_type_id: direction,
});
export const ride = (to: number, busId: number, time = 1, distance = 1, sequence = 0, direction = 1): GraphEdge => ({
  kind: 'bus', toStopId: to, busId, busNumber: String(busId), time, distance,
  rideId: `${busId}:${direction}`, direction, fromSequence: sequence, toSequence: sequence + 1,
  headsign: `Terminus ${busId}/${direction}`, fromStopName: '', toStopName: '',
});
export const walk = (to: number, distance = 0.2): GraphEdge => ({
  kind: 'walk', toStopId: to, busId: -1, busNumber: 'walk', time: distance / 4.5 * 60,
  distance, fromStopName: '', toStopName: '',
});
export const RED = { name: 'Qırmızı xətt', color: '#FF0000' };
export const train = (to: number, ride: number, time = 1, distance = 1, sequence = 0): GraphEdge => ({
  kind: 'metro', toStopId: to, busId: -2, busNumber: RED.name, time, distance, line: RED, vehicle: 'train',
  rideId: `metro:${ride}`, fromSequence: sequence, toSequence: sequence + 1,
  headsign: `Terminus metro:${ride}`, fromStopName: '', toStopName: '',
});
/** A graph of these edges; a stop stands where `at` puts it, or on 49° E (stop()), and a
 *  metro station has the `exits` given. */
export function graph(edges: Record<number, GraphEdge[]>, stopIds?: number[],
  { at = {}, exits = {} }: { at?: Record<number, LatLng>; exits?: Record<number, LatLng[]> } = {}) {
  const ids = new Set(stopIds ?? Object.entries(edges).flatMap(([id, rows]) => [Number(id), ...rows.map(e => e.toStopId)]));
  const info = (id: number) => !ids.has(id) ? undefined : at[id] ? stop(id, ...at[id]) : stop(id);
  return {
    getStopInfo: info,
    getEdges: (id: number) => edges[id] ?? [],
    getAllStops: () => [...ids].map(id => info(id)!),
    getStationExits: (id: number): LatLng[] | undefined => exits[id],
  };
}
