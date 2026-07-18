-- Bus route planner (Baku) — schema + tables for /avtobus and
-- /aletler/avtobus-marsrutu. Scraped from the AYNA transit API by
-- scrapers/bus/scraper.py.
--
-- This is the scraper's OWN copy of the schema (decoupled from
-- prisma/migrations/add_bus_route_tables.sql, which stays the canonical DDL the
-- website's Prisma client is generated against — keep the two in sync). The
-- scraper runs this on every invocation via open(SCHEMA_SQL); everything is
-- CREATE ... IF NOT EXISTS, so it self-asserts and is safe to re-run. Tables are
-- read-only at request time from the website.

CREATE SCHEMA IF NOT EXISTS bus;

-- Stops (id, name, coordinates).
CREATE TABLE IF NOT EXISTS bus.bus_stop_details (
    id               INTEGER PRIMARY KEY,
    code             TEXT,
    name             TEXT NOT NULL,
    latitude         DOUBLE PRECISION NOT NULL,
    longitude        DOUBLE PRECISION NOT NULL,
    is_transport_hub BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_bus_stop_details_name ON bus.bus_stop_details (name);
CREATE INDEX IF NOT EXISTS idx_bus_stop_details_coords ON bus.bus_stop_details (latitude, longitude);

-- Buses (route lines).
CREATE TABLE IF NOT EXISTS bus.bus_buses (
    id                   INTEGER PRIMARY KEY,
    carrier              TEXT NOT NULL,
    number               TEXT NOT NULL,
    first_point          TEXT NOT NULL,
    last_point           TEXT NOT NULL,
    route_length         DOUBLE PRECISION NOT NULL DEFAULT 0,
    tariff               INTEGER NOT NULL DEFAULT 0,
    tariff_str           TEXT NOT NULL DEFAULT '',
    region_id            INTEGER NOT NULL DEFAULT 0,
    working_zone_type_id INTEGER NOT NULL DEFAULT 0,
    duration_minuts      INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bus_buses_number ON bus.bus_buses (number);

-- Junction: ordered stops per (bus, direction).
CREATE TABLE IF NOT EXISTS bus.bus_bus_stops (
    id                    SERIAL PRIMARY KEY,
    bus_stop_id           INTEGER NOT NULL,
    bus_id                INTEGER NOT NULL,
    stop_id               INTEGER NOT NULL,
    stop_code             TEXT NOT NULL DEFAULT '',
    stop_name             TEXT NOT NULL,
    total_distance        DOUBLE PRECISION NOT NULL DEFAULT 0,
    intermediate_distance DOUBLE PRECISION,
    direction_type_id     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bus_bus_stops_bus_dir ON bus.bus_bus_stops (bus_id, direction_type_id);
CREATE INDEX IF NOT EXISTS idx_bus_bus_stops_stop ON bus.bus_bus_stops (stop_id);

-- Route directions (for map geometry lookup).
CREATE TABLE IF NOT EXISTS bus.bus_routes (
    id                INTEGER PRIMARY KEY,
    code              TEXT NOT NULL DEFAULT '',
    destination       TEXT NOT NULL DEFAULT '',
    bus_id            INTEGER NOT NULL,
    direction_type_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bus_routes_bus_dir ON bus.bus_routes (bus_id, direction_type_id);

-- Route polyline coordinates (map rendering).
CREATE TABLE IF NOT EXISTS bus.bus_route_coordinates (
    id             SERIAL PRIMARY KEY,
    route_id       INTEGER NOT NULL,
    latitude       DOUBLE PRECISION NOT NULL,
    longitude      DOUBLE PRECISION NOT NULL,
    sequence_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bus_route_coords_route_seq ON bus.bus_route_coordinates (route_id, sequence_order);

-- Precomputed ≤300 m walking transfers (avoids O(n²) cold-start build).
CREATE TABLE IF NOT EXISTS bus.bus_walking_edges (
    id           SERIAL PRIMARY KEY,
    from_stop_id INTEGER NOT NULL,
    to_stop_id   INTEGER NOT NULL,
    distance_km  DOUBLE PRECISION NOT NULL,
    time_min     DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bus_walking_edges_from ON bus.bus_walking_edges (from_stop_id);
