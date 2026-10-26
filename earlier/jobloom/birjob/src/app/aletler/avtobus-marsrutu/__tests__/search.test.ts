import { describe, expect, it } from "vitest";
import type { BusLite, StopDetail } from "@/lib/busroute/types";
import { nearestStop, normalizeSearch, searchBuses, searchStops } from "../search";

const stop = (id: number, name: string, code = "", hub = false): StopDetail => ({
  id, name, code, latitude: 40.4, longitude: 49.85, is_transport_hub: hub,
});
const bus = (id: number, number: string, first_point = "Neftçilər", last_point = "28 May"): BusLite => ({
  id, number, first_point, last_point, route_length: 10, duration_minuts: 20,
});

describe("phone-friendly transit search", () => {
  it.each([
    ["İÇƏRİŞƏHƏR", "iceriseher"], ["NƏRİMAN NƏRİMANOV", "neriman nerimanov"],
    ["  28-May m/st. ", "28 may m st"], ["Əhmədli", "ehmedli"], ["Gənclik", "genclik"],
  ])("normalizes %s", (input, expected) => expect(normalizeSearch(input)).toBe(expected));

  it("finds ASCII spellings and reordered words", () => {
    const stops = [stop(1, "Neftçilər m/st"), stop(2, "28 May m/st"), stop(3, "İçərişəhər")];
    expect(searchStops(stops, "neftciler").map(s => s.id)).toEqual([1]);
    expect(searchStops(stops, "may 28").map(s => s.id)).toEqual([2]);
    expect(searchStops(stops, "iceriseher").map(s => s.id)).toEqual([3]);
  });

  it("ranks exact names and codes before prefixes and substrings", () => {
    const stops = [stop(1, "Yeni Gənclik"), stop(2, "Gənclik m/st"), stop(3, "Gənclik"), stop(4, "Başqa dayanacaq", "genclik")];
    const result = searchStops(stops, "genclik").map(s => s.id);
    expect(result.slice(0, 2).sort()).toEqual([3, 4]);
    expect(result.slice(2)).toEqual([2, 1]);
  });

  it("preserves same-name stops and exposes their different codes", () => {
    const stops = [stop(1, "28 May", "A"), stop(2, "28 May", "B")];
    expect(searchStops(stops, "28 may")).toHaveLength(2);
    expect(searchStops(stops, "B").map(s => s.id)).toEqual([2]);
    expect(searchStops(stops, "missing")).toEqual([]);
  });

  it("offers hubs on focus and caps large result sets", () => {
    const stops = Array.from({ length: 70 }, (_, i) => stop(i + 1, `Dayanacaq ${i}`, "", i % 2 === 0));
    expect(searchStops(stops, "")).toHaveLength(12);
    expect(searchStops(stops, "").every(s => s.is_transport_hub)).toBe(true);
    expect(searchStops(stops, "dayanacaq")).toHaveLength(25);
  });

  it("ranks a bus number exactly and sorts buses numerically", () => {
    const buses = [bus(1, "88A"), bus(2, "188"), bus(3, "88"), bus(4, "9"), bus(5, "2"), bus(6, "H1")];
    expect(searchBuses(buses, "88").map(b => b.number)).toEqual(["88", "88A", "188"]);
    expect(searchBuses(buses, "").map(b => b.number)).toEqual(["2", "9", "88", "88A", "188", "H1"]);
    expect(searchBuses(buses, "may neftciler")).toHaveLength(6);
  });
});

describe("nearby stop selection", () => {
  it("chooses the closest stop independent of array order", () => {
    const near = stop(2, "Yaxın"), far = { ...stop(1, "Uzaq"), latitude: 40.404 };
    expect(nearestStop([far, near], 40.4001, 49.85)?.stop.id).toBe(2);
  });
  it("rejects missing stops, invalid coordinates and locations over 600 m away", () => {
    expect(nearestStop([], 40.4, 49.85)).toBeNull();
    expect(nearestStop([stop(1, "Bakı")], 41, 49.85)).toBeNull();
    expect(nearestStop([stop(1, "Bakı")], Number.NaN, 49.85)).toBeNull();
    expect(nearestStop([stop(1, "Bakı")], 40.404, 49.85)?.distance).toBeLessThan(0.6);
    expect(nearestStop([stop(1, "Bakı")], 40.406, 49.85)).toBeNull();
  });
});
