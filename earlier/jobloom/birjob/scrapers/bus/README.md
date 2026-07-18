# Bus scraper — AYNA (Baku transit) → `bus.*`

Refreshes the `bus.*` tables that power **/avtobus** (per-route SEO pages,
`src/lib/bus.ts`) and **/aletler/avtobus-marsrutu** (the A→B journey planner,
`src/lib/busroute/*`). Those tables were originally loaded once by hand
(`scripts/bus/import.ts`, never committed); this scraper keeps them fresh so the
"dövri olaraq yenilənir" ("periodically updated") copy in the UI is true.

## Source
Public AYNA JSON API — no auth, no HTML parsing:

| Endpoint | Gives |
|---|---|
| `GET /api/bus/getBusList` | `[{id, number}]` — ~209 routes |
| `GET /api/bus/getBusById?id=N` | route metadata + `stops[]` + `routes[]` (geometry) |

Stop names/codes/coords come from each route's stop objects, so `/stop/getAll`
(coords only, no names) isn't needed.

## Writes (one atomic transaction)
- `bus_stop_details`, `bus_buses`, `bus_routes` — **upsert by stable id** (the live
  front-end joins on these ids and caches; stable ids avoid churn). `bus_buses.created_at`
  is bumped so `getDataLastUpdated()` reports real freshness.
- `bus_bus_stops`, `bus_route_coordinates`, `bus_walking_edges` — **full rebuild**
  (SERIAL pk, joined by bus_id/route_id/stop_id). Walking edges = ≤300 m transfers,
  spatial-grid binned (≈O(n), not O(n²)).

Fully decoupled: never calls a birjob endpoint; the DB is the only contract.

## Run
```bash
pip install -r requirements.txt
python3 scraper.py                 # reads DATABASE_URL from .env.local or env
python3 scraper.py --dry-run       # fetch + parse only, no DB
python3 scraper.py --dry-run --limit 5   # only 5 routes (quick check)
```

## Schedule
`.github/workflows/bus-scrape.yml` — **weekly** (Sunday 07:00 Baku) + `workflow_dispatch`.
Routes/stops change rarely, so weekly is plenty.

## Schema
`schema.sql` is the scraper's self-asserted copy (CREATE … IF NOT EXISTS, run every
invocation). Keep it in sync with the canonical `prisma/migrations/add_bus_route_tables.sql`.
