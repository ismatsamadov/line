import { describe, expect, it } from "vitest";
import type { BusLite, StopDetail } from "@/lib/busroute/types";
import type { PlaceMatch } from "@/lib/busroute/places";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { coarsePoint, EVERYDAY_PLACES, HUB_PLACES, keepShownRows, nearestStop, normalizeSearch, placeRank, placeStopNear, rankStops, searchBuses, searchStops, suggestEnds } from "../search";
import { buildPlaceIndex, searchPlaces } from "@/lib/busroute/places";

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

  it("folds the Cyrillic ә AYNA types for ə, and keeps Cyrillic for the places' Russian names (#720)", () => {
    // 216 stop names type it ("Kotal qәs."); they read "kotal q s" before, so "kotal qəs" missed them.
    expect(normalizeSearch("Kotal qәs.")).toBe("kotal qes");
    expect(normalizeSearch("Baş Әlәt")).toBe("bas elet");
    expect(searchStops([stop(1, "Kotal qәs.")], "kotal qəs").map(s => s.id)).toEqual([1]);
    expect(normalizeSearch("Гянджлик Молл")).toBe("гянджлик молл");
    expect(normalizeSearch("Ёлка, Йод")).toBe("елка иод");
  });

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

describe("stops and places in one list (#720)", () => {
  const place = (id: string, name: string, rank: number, label = "Universitet"): PlaceMatch => ({
    id, name, category: "university", label, latitude: 40.4, longitude: 49.85, rank,
  });
  const stops = [stop(1, "Gənclik m/st", "1001"), stop(2, "Gənclik", "1002"), stop(3, "Yeni Gənclik"), stop(4, "Hub", "", true)];

  it("ranks stops with the rank the merge compares", () => {
    expect(rankStops(stops, "gənclik")).toEqual([
      { stop: stops[1], rank: 0 }, { stop: stops[0], rank: 1 }, { stop: stops[2], rank: 2 },
    ]);
    expect(rankStops(stops, "  ")).toEqual([]);
  });

  it("puts the better matches first whichever they are, a stop first among equals", () => {
    const merged = suggestEnds(stops, "gənclik", [place("n9", "Gənclik", 0, "Metro stansiyası"), place("w2", "Gənclik Mall", 1), place("w3", "Mall Gənclik", 2), place("n4", "Gənclik metro", 3)]);
    expect(merged.map(s => s.kind === "stop" ? `s${s.stop.id}` : s.place.id)).toEqual(["s2", "n9", "s1", "w2", "s3", "w3", "n4"]);
    // A place's looser matches count with a stop's loosest.
    expect(merged.at(-1)?.rank).toBe(2);
  });

  it("puts a station, a mall or a stop that starts with the query above a café of that very name", () => {
    const at = (id: string, name: string, rank: number, category: string, label: string): PlaceMatch => ({
      id, name, category, label, latitude: 40.4, longitude: 49.85, rank,
    });
    // As the server sends them for "gənclik": exact names first, the metro before the cafés.
    const places = [
      at("n1", "Gənclik", 0, "metro", "Metro stansiyası"), at("n2", "Gənclik", 0, "cafe", "Kafe"),
      at("n3", "Gənclik", 0, "cafe", "Kafe"), at("w4", "Gənclik Mall", 1, "mall", "Ticarət mərkəzi"),
      at("n5", "Gənclik Market", 1, "supermarket", "Supermarket"),
    ];
    const merged = suggestEnds([stop(1, "Gənclik m/st", "1001")], "gənclik", places);
    expect(merged.map(s => s.kind === "stop" ? `s${s.stop.id}` : s.place.id)).toEqual(["n1", "w4", "s1", "n2", "n3", "n5"]);
    // A metro station's name that starts with the query beats a café's that is it.
    const neriman = suggestEnds([], "nəriman", [at("n6", "Nəriman", 0, "cafe", "Kafe"), at("n7", "Nəriman Nərimanov", 1, "metro", "Metro stansiyası")]);
    expect(neriman.map(s => s.kind === "place" && s.place.id)).toEqual(["n7", "n6"]);
  });

  it("lists a place no journey can reach after every other row", () => {
    const at = (id: string, name: string, rank: number): PlaceMatch => ({ id, name, category: "hotel", label: "Otel", latitude: 40.4, longitude: 49.85, rank });
    const merged = suggestEnds([stop(1, "Gənclik m/st")], "gənclik", [at("w1", "Gənclik", 0), at("w2", "Gənclik Plaza", 1)], place => place.id !== "w1");
    expect(merged.map(s => s.kind === "stop" ? `s${s.stop.id}` : s.place.id)).toEqual(["s1", "w2", "w1"]);
  });

  it("keeps the rows shown for a query in place and adds later ones below them", () => {
    const row = (key: string) => ({ key });
    const first = keepShownRows(null, "gənclik", [row("s1"), row("s2")]);
    expect(first.rows.map(r => r.key)).toEqual(["s1", "s2"]);
    // The places answer, ranked above the stops: below them instead, and a row shown
    // that the answer leaves out stays where it was.
    const answered = keepShownRows(first, "gənclik", [row("p1"), row("s2"), row("p2")]);
    expect(answered.rows.map(r => r.key)).toEqual(["s1", "s2", "p1", "p2"]);
    expect(keepShownRows(answered, "gənclik", [row("p1"), row("s1"), row("s2"), row("p2")])).toEqual(answered);
    // Another query is ordered as it comes.
    expect(keepShownRows(answered, "gənclik m", [row("p1"), row("s2")]).rows.map(r => r.key)).toEqual(["p1", "s2"]);
  });

  it("puts a station, an airport, a bus station or a mall before a stop that matches as well", () => {
    const at = (id: string, category: string): PlaceMatch => ({ id, name: "Gənclik X", category, label: "", latitude: 40.4, longitude: 49.85, rank: 1 });
    const merged = suggestEnds([stop(1, "Gənclik m/st")], "gənclik", ["metro", "rail", "airport", "bus_station", "mall", "university"].map(c => at(c, c)));
    expect(merged.map(s => s.kind === "stop" ? `s${s.stop.id}` : s.place.id)).toEqual(["metro", "rail", "airport", "bus_station", "mall", "s1", "university"]);
  });

  it("ranks a place carried over for a longer query as a stop would be ranked", () => {
    const at = (name: string, category = "metro", alias?: string) => ({ name, category, label: "Metro stansiyası", ...(alias ? { alias } : {}) });
    expect(placeRank("gənclik", at("Gənclik"))).toBe(0);
    expect(placeRank("gənc", at("Gənclik"))).toBe(1);
    // Every word in it: a station's counts as a start, as on the server.
    expect(placeRank("nerimanov", at("Nəriman Nərimanov"))).toBe(1);
    expect(placeRank("nerimanov", at("Nəriman Nərimanov", "university"))).toBe(2);
    expect(placeRank("ganjlik", at("Gənclik", "metro", "Ganjlik"))).toBe(0);
    // Its kind, and a query typed without its spaces, still find it, loosely.
    expect(placeRank("genclik metro", at("Gənclik"))).toBe(3);
    expect(placeRank("28ma", at("28 Mall", "mall"))).toBe(1);
    expect(placeRank("bravo", at("Gənclik"))).toBe(Infinity);
  });

  it("names everyday kinds that places.json has", () => {
    const { labels } = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../lib/busroute/places.json", import.meta.url)), "utf8"));
    for (const category of [...EVERYDAY_PLACES, ...HUB_PLACES]) expect(labels, category).toHaveProperty(category);
    expect(EVERYDAY_PLACES.has("metro") || EVERYDAY_PLACES.has("mall")).toBe(false);
  });

  it("offers the hubs for an empty query, and places alone where no stop matches", () => {
    expect(suggestEnds(stops, "", [place("w2", "Gənclik Mall", 1)])).toEqual([{ kind: "stop", stop: stops[3], rank: 0 }]);
    expect(suggestEnds(stops, "28 mall", [place("w5", "28 Mall", 0)])).toEqual([{ kind: "place", place: place("w5", "28 Mall", 0), rank: 0 }]);
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
    // Within a wider radius when asked: a place's nearest stop is named up to 1 km (#720).
    expect(nearestStop([stop(1, "Bakı")], 40.406, 49.85, 1)?.stop.id).toBe(1);
  });

  it("names a place's nearest stop with a name, within a journey's walk (#720)", () => {
    // A nameless stop is one no bus serves; the named one 330 m on is the one to name.
    const stops = [{ ...stop(1, ""), latitude: 40.4001 }, { ...stop(2, "Gənclik m/st"), latitude: 40.403 }, { ...stop(3, "Uzaq"), latitude: 40.42 }];
    expect(placeStopNear(stops, { latitude: 40.4, longitude: 49.85 })?.stop.id).toBe(2);
    expect(nearestStop(stops, 40.4, 49.85)?.stop.id).toBe(1);
    expect(placeStopNear(stops, { latitude: 40.39, longitude: 49.85 })).toBeNull();
  });

  it("tells where a point is only to two decimals, about 1 km (#720)", () => {
    expect(coarsePoint({ latitude: 40.377134, longitude: 49.854137 })).toEqual({ latitude: 40.38, longitude: 49.85 });
  });
});

describe("a station or a mall at the top of the list it is typed for (#720)", () => {
  // The planner's real places, and the AYNA stops whose names hold these words.
  const index = buildPlaceIndex(JSON.parse(readFileSync(fileURLToPath(new URL("../../../../lib/busroute/places.json", import.meta.url)), "utf8")));
  const named = (names: string[]) => names.map((name, i) => stop(100 + i, name));
  const STOPS: Record<string, StopDetail[]> = {
    "gənclik": named(["Gənclik küç. 120", "Gənclik küç. 13", "Gənclik küç. 14", "Gənclik küç. 200", "Gənclik küç. 45", "Gənclik küç. 60",
      "Gənclik m/st", "Gənclik metro stansiyası", "Gənclik Nəqliyyat Mübadilə Məntəqəsi", "Gənclik parkı"]),
    "koroglu": named(["Koroğlu NMM", "Koroğlu Nəqliyyat Mübadilə Mərkəzi", "Koroğlu küç.", "Koroğlu küç. 101C", "Koroğlu küç. 123"]),
    "nerimanov": named(["Nərimanov Rayon Məhkəməsi", "Nərimanov Rayon Prokurorluğu", "Nəriman Nərimanov m/st", "M.Nərimanov küç."]),
    "avtovağzal": named(["Avtovağzal m/st", "Bakı Beynəlxalq Avtovağzal Kompleksi", "Sumqayıt Avtovağzalı"]),
  };
  const rows = (query: string, places: PlaceMatch[]) => suggestEnds(STOPS[query], query, places)
    .map(found => found.kind === "stop" ? { key: `s${found.stop.id}`, name: found.stop.name } : { key: `p${found.place.id}`, name: `${found.place.name} (${found.place.category})` });

  it.each([["gənclik", "gənc", "Gənclik (metro)"], ["koroglu", "koro", "Koroğlu (metro)"],
    ["nerimanov", "nərim", "Nəriman Nərimanov (metro)"], ["avtovağzal", "avtov", "Avtovağzal (metro)"]])(
    "lists the station first for %j, whether its places arrive with the list or were carried over", (query, prefix, first) => {
      // The list waited for the places (usePlaceSearch's holding), so they are ranked in.
      const waited = keepShownRows(keepShownRows(null, query, []), query, rows(query, searchPlaces(index, query)));
      expect(waited.rows[0].name, JSON.stringify(waited.rows.slice(0, 5))).toBe(first);
      // Typed on from a shorter query, its places are carried over and ranked for this one.
      const carried = searchPlaces(index, prefix).map(place => ({ ...place, rank: placeRank(query, place) })).filter(place => place.rank < Infinity);
      const atOnce = keepShownRows(null, query, rows(query, carried));
      expect(atOnce.rows[0].name, JSON.stringify(atOnce.rows.slice(0, 5))).toBe(first);
    });
});
