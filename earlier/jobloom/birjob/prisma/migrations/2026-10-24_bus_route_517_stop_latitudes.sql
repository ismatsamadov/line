-- Put two stops of route 517 back in Absheron (#685).
--
-- WHAT IS WRONG
--
-- bus.bus_stop_details holds stop 3838 ("Ziya Bünyadov küçəsi, 53") at latitude
-- 4.049233 and stop 3839 ("7 saylı tam orta məktəb") at 4.049409: in the Indian
-- Ocean, about 4,000 km south of Baku. They are the only two stops outside
-- 39.5-41.5 N, 48.5-51 E (read on the box, 2026-10-24), and both serve only
-- route 517 (bus_id 189). The bus planner drew every journey through them down to
-- the ocean and measured it in thousands of kilometres, and the stop map put the
-- two markers there.
--
-- THE FIX, AND WHY THESE VALUES
--
-- The digits are right and the decimal point is one place out: the stops belong at
-- 40.49233 and 40.49409. Checked on the box on 2026-10-24 against route 517's own
-- rows, read-only:
--   - 3838 lands between its neighbours in travel order on Ziya Bünyadov street,
--     3837 (40.494076, 49.742065) and 3831 (40.490272, 49.733016);
--   - 3839 lands about 25 m from 3837, which has the same name ("7 saylı tam orta
--     məktəb") in the other direction: the usual pair across a street. In
--     longitude it is between its own neighbours 3791 (49.738141) and 3165
--     (49.746519), and it is north of both, by 196 m and 93 m, where the route bends;
--   - moved, they lie 10 m and 36 m from the nearest point of the route's own
--     recorded path (bus.bus_route_coordinates for bus_id 189).
-- samirmehd1yev/best_route_finding, whose AYNA snapshot this data shares, makes the
-- same two corrections in migrations/002_repair_grouped_latitudes.sql.
--
-- Each UPDATE is guarded by the broken value, so a re-run changes nothing and a
-- later correction of either row is left alone. No code depends on it.
--
-- APPLY on the box, from /opt/birjob, and record it in the same paste (&& so a
-- failed apply is never recorded; deploy/check-migrations.sh refuses the next
-- deploy until it is recorded):
--
--   cd /opt/birjob && set -a && . ./.env.hetzner && set +a
--   docker compose exec -T db psql -v ON_ERROR_STOP=1 -U birjob_owner -d birjob \
--     < prisma/migrations/2026-10-24_bus_route_517_stop_latitudes.sql && \
--   docker compose exec -T db psql -v ON_ERROR_STOP=1 -U birjob_owner -d birjob -c \
--     "INSERT INTO website._migrations (name) VALUES ('2026-10-24_bus_route_517_stop_latitudes.sql') ON CONFLICT DO NOTHING"
--
-- AFTER APPLYING. The stop list and the line viewer read the table on every
-- request, so they serve the new coordinates at once: Cloudflare caches nothing
-- under /api/ (docs/owner-actions.md), and the s-maxage on those routes is left
-- from Vercel. Routing builds its graph once per process and keeps the old
-- coordinates until the app restarts, which the next deploy does. A browser can
-- still hold one stale copy of /api/avtobus/stops (stale-while-revalidate).
--
-- INVERSE:
--   UPDATE bus.bus_stop_details SET latitude = 4.049233 WHERE id = 3838 AND latitude = 40.49233;
--   UPDATE bus.bus_stop_details SET latitude = 4.049409 WHERE id = 3839 AND latitude = 40.49409;
--
-- VERIFY (expect the two rows at 40.49233 and 40.49409, then 0):
--   SELECT id, latitude, longitude FROM bus.bus_stop_details WHERE id IN (3838, 3839);
--   SELECT count(*) FROM bus.bus_stop_details
--    WHERE latitude NOT BETWEEN 39.5 AND 41.5 OR longitude NOT BETWEEN 48.5 AND 51;

BEGIN;

UPDATE bus.bus_stop_details SET latitude = 40.49233 WHERE id = 3838 AND latitude BETWEEN 4.04 AND 4.06;
UPDATE bus.bus_stop_details SET latitude = 40.49409 WHERE id = 3839 AND latitude BETWEEN 4.04 AND 4.06;

COMMIT;
