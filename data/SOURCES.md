# Data sources

Every file the measurements read is committed here, so `python3 measure.py` reproduces
every result without downloading anything. `python3 data/fetch_external.py --refresh`
downloads the external files again from the sources below. Retrieved 23 October 2026
unless noted. The code is under the MIT licence and the documentation under CC BY 4.0
(`LICENSE` and the Licensing section of the README); the data keep the terms listed
here.

## Bus network

| File | Contents | Source | Licence |
|---|---|---|---|
| `ayna.db` | 208 routes, 3,841 stops, stop sequences and route shapes | AYNA map API (`map-api.ayna.gov.az`, an unauthenticated OpenAPI service), scraped 23 October 2026 with `ayna_scraper.py`; identical to the snapshot of 6 May 2026 kept in github.com/samirmehd1yev/best_route_finding. Also published on Kaggle with the tables as CSV: [doi.org/10.34740/KAGGLE/DSV/21173689](https://doi.org/10.34740/KAGGLE/DSV/21173689) | None. The data is AYNA's; neither AYNA nor the API publishes terms of use (ayna.gov.az states only "All rights reserved"). Redistributed here as a research snapshot with attribution to AYNA; this repository's licence does not extend to it |
| `ayna_scraper.py` | Script that builds `ayna.db` from the AYNA API | This repository | |
| `headways.csv` | Real headways where a public source gives one; add rows as data arrives | See the `source` column ([airport.az, August 2024](https://www.airport.az/en/press-release/h1-airport-express-route-will-now-operate-24-7-for-the-convenience-of-passengers/)) | |
| `bakubus_route_hours.csv` | The first and last departures of 52 BakuBus routes, with their two terminals as BakuBus names them; not read by the tools ([docs/data.md](../docs/data.md#bakubuss-first-and-last-departures-databakubus_route_hourscsv)) | Transcribed by hand from the route table on BakuBus's website ([bakubus.az/az/route](https://www.bakubus.az/az/route), "Marşrut şəbəkəsi"), which the page shows as one image, `uploads/menus/o_1ijslae3a1nc0d6evq9pq1dqai.png`, last changed on 12 February 2025; read on 21 November 2026 | None published. Facts of BakuBus MMC's service, transcribed as a research record with attribution to BakuBus |

## Metro network

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/metro_api/` | The metro API's answers: 26 stations, the train services on each line, service notices, two departure lists, the operator's answers to frequent questions, and journey-planner timings of every service both ways | Bakı Metropoliteni's API behind metro.gov.az (`app-api.metro.gov.az`, unauthenticated), read on 25 October 2026 with `metro_scraper.py` (read-only requests and the public journey planner) | None published; metro.gov.az states "Bütün hüquqlar qorunur" (all rights reserved). Redistributed here as a research snapshot with attribution to Bakı Metropoliteni, like `ayna.db`; this repository's licence does not extend to it |
| `metro_scraper.py`, `build_metro.py` | Scripts that download the API's answers and build `metro/` | This repository | |
| `metro/` | 27 stations with their names in every source, OpenStreetMap's route variants with track distances, route tracks, the timed services and the published departures | Built by `build_metro.py` from `external/metro_api/`, the OpenStreetMap and Wikidata files below and the opendata.az metro files | Mixed: coordinates, track geometry and distances come from OpenStreetMap and are under the ODbL; services, times and departures are Bakı Metropoliteni's (as `external/metro_api/`); opening dates are Wikidata's (CC0) |
| `metro_headways.csv` | Train intervals the operator has published, each with its source | Bakı Metropoliteni: metro.gov.az news of 14 September and 23 October 2026, the route-change page and the answers to frequent questions, read 25 October 2026 | Short quotations from the operator |

The licences of the opendata.az datasets below come from the portal's CKAN metadata
(`https://admin.opendata.az/api/3/action/package_show?id=<dataset id>`), which records
the generic Open Definition `cc-by` and `cc-zero` entries without a version; the dataset
web pages do not display them. The three State Statistical Committee tables are
downloaded from the Committee's open-data API (see `fetch_external.py`) and are also
published on opendata.az by the Committee (datasets `f3d36c3a-8bdc-4ceb-9bd5-2c73d2db2d8d`,
`843bdfbf-9c46-4e07-b9a7-1d831ba3697a` and `1ea3ff52-a1bd-46a8-9d95-0fe2e0b35798`), where
their licence is recorded as CC0.

## Population

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/kontur/kontur_population_AZ_20231101.gpkg` | Population on H3 hexagons (~0.74 km²), 10.48 million people in Azerbaijan | Kontur Population, release 2023-11-01, [HDX](https://data.humdata.org/dataset/kontur-population-azerbaijan) | CC BY (HDX: Creative Commons Attribution International; no version stated) |
| `external/stat/population_by_district_2026.xls` | Official population by city and district, 1 January 2026 | State Statistical Committee, [table 1.15](https://www.stat.gov.az/source/demoqraphy/en/001_15en.xls) | Official statistics; no licence stated |

## Ridership and travel

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/opendata/bakubus_passenger-2026.csv` | Daily boardings per BakuBus route, January to September 2026 | Bakı Metropoliteni via [opendata.az](https://admin.opendata.az/dataset/32766a9d-479c-41ff-a660-7b739b4ff034) | CC BY |
| `external/opendata/bakubus_payment_type-2026.csv` | Monthly share of payment types per BakuBus route | Bakı Metropoliteni via [opendata.az](https://admin.opendata.az/dataset/a98b2492-680a-401a-ab39-4e2b6ad0f270) | CC BY |
| `external/opendata/metro_passengers-2025.csv`, `metro_passengers-2026.csv` | Daily entries per metro station | Bakı Metropoliteni via [opendata.az](https://admin.opendata.az/dataset/66051a52-1172-4c59-8ea2-1062562c991f) | CC BY |
| `external/opendata/metro_payment_type-2026.csv` | Monthly share of payment types per metro station | Bakı Metropoliteni via [opendata.az](https://admin.opendata.az/dataset/2d3f1d95-5465-4e54-a14e-555c02785729) | CC BY |
| `external/opendata/metro_exits.csv` | Coordinates of 98 metro exits | Bakı Metropoliteni via [opendata.az](https://admin.opendata.az/dataset/3108fb32-8483-4126-8283-17f2f1452548) | CC BY |
| `external/opendata/ayna_buslines.kmz` | Official bus route lines, November 2025 | AYNA via [opendata.az](https://admin.opendata.az/dataset/366c03c3-f60a-4198-b8e4-959af2082296) | CC0 |
| `external/opendata/ayna_bus_stations.geojson` | Intercity bus stations and their coordinates | AYNA via [opendata.az](https://admin.opendata.az/dataset/0d42439f-191f-40f5-82df-21742123465e) | CC0 |
| `external/opendata/stat_avg_trip_distance.csv` | Average trip length per passenger by mode and year | State Statistical Committee, table DT_BJ_050 | CC0 |
| `external/opendata/stat_passengers_by_mode.csv` | Passengers carried by mode and year | State Statistical Committee, table DT_BJ_004 | CC0 |
| `external/opendata/stat_urban_electric_transport.csv` | Urban electric transport statistics | State Statistical Committee, table DT_BJ_049 | CC0 |

## Bicycle lanes and parking

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/opendata/ayna_bicycle_lanes.kmz` | AYNA's existing bicycle lanes, saved from Google Earth: one folder, "Mövcud zolaqlar", of 61 placemarks, 60 lines named after their streets (57.1 km on 54 streets) and one empty "8 Noyabr pr." placemark. The portal's `movcud-zolaqlar-velo.kmz`, 11,816 bytes, SHA-256 `dfbc6d1610a96db9c1bb466986175135c1e0a54bbf3213ac4cf81df60c71ac67` | AYNA via [opendata.az](https://admin.opendata.az/dataset/74727856-3e72-4d49-ab34-9d4aac8f4ab0), dataset of 24 September 2026 (version 2); retrieved 29 October 2026 | CC0 |
| `external/opendata/ayna_bicycle_parking.kmz` | AYNA's bicycle parking points, as a whole Google Earth session: 185 points named MPV-… in the folder "velosiped məntəqələri yeni", 649 points named MPS-… under "My Places", the bicycle lanes of January 2025 (44 lines, 44.2 km) and Google Earth's ten sample places. The portal's `mpv-v-mps.-son.kmz`, 87,908 bytes, SHA-256 `494065929eb8126a266699e7565d614218042b4c00b8da1902df9c8b746ee38e` | AYNA via [opendata.az](https://admin.opendata.az/dataset/8d61b508-7f13-4219-984f-08d769c61251), dataset of 4 May 2026 (version 2, metadata updated 24 September 2026); retrieved 29 October 2026 | CC0 |

What is inside each file, and what the two files leave unsaid, is in [docs/data.md](../docs/data.md#bicycle-lanes-and-parking).

## Destinations (OpenStreetMap)

Queried through the Overpass API for the box 39.9–40.7 N, 49.3–50.45 E. Data © OpenStreetMap contributors, available under the [Open Database Licence](https://www.openstreetmap.org/copyright).

| File | Contents |
|---|---|
| `external/osm/osm_bus_routes_tags.json` | Tags of 249 bus route relations (only route M5 has an interval tag) |
| `external/osm/osm_education.json` | Schools, colleges, universities, kindergartens |
| `external/osm/osm_health.json` | Hospitals and clinics |
| `external/osm/osm_shopping.json` | Malls, supermarkets, department stores, markets |
| `external/osm/osm_offices.json` | Offices, town halls, courthouses |
| `external/osm/osm_transport.json` | Railway and bus stations |
| `external/osm/osm_metro_routes.json` | The 12 metro route relations with their stops in order and track geometry (retrieved 25 October 2026) |
| `external/osm/osm_metro_stations.json` | Metro stations, stop positions and 107 entrances (retrieved 25 October 2026) |

Each file records the date of the OpenStreetMap data in it (`osm3s.timestamp_osm_base`).

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/osm/osm_walk_network.json.gz` | Every way tagged `highway` in the study area (39.92–40.66 N, 49.37–50.39 E: the served stops plus 2 km) with its tags and nodes: 99,185 ways and 570,706 nodes, in the shape of an Overpass answer, gzipped. For walking distances along streets and paths (`busnet/walking.py`) | Cut by `osm_pbf.py` from Geofabrik's extract `asia/azerbaijan-latest.osm.pbf` (46.6 MB, OpenStreetMap data of 24 October 2026 20:20 UTC), downloaded 25 October 2026 by `fetch_external.py`; the extract itself is not kept | ODbL, © OpenStreetMap contributors |
`osm_health.json` was answered by a mirror server with data as of 15 July 2026; the
others hold data as of the day they were retrieved.

## Wikidata

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/wikidata/metro_stations.json` | The stations on the three Baku Metro lines (31 items, four of them not yet open), with opening dates, coordinates and neighbouring stations | Wikidata Query Service, 25 October 2026 (query in `fetch_external.py`) | CC0 |

## Benchmark networks

| File | Contents | Source | Licence |
|---|---|---|---|
| `external/utrp/CEC2013Supp.zip` | Mandl's network and Mumford0–3 (link times, trips), the route sets best for passengers and for the operator, the score table (Table IV), Pareto fronts and supplementary text of Mumford (2013); SHA-256 `b483d39eb9cee5a9a6b5e5d3d1e0f4200569eef4d9dceecdd5cec87a21c25ca2` | C. L. Mumford's UTRP page at Cardiff University (`users.cs.cf.ac.uk/C.L.Mumford/Research Topics/UTRP/`), read from the [Wayback Machine copy of 16 December 2025](http://web.archive.org/web/20251216204206/https://users.cs.cf.ac.uk/C.L.Mumford/Research%20Topics/UTRP/CEC2013Supp.zip) on 27 October 2026 | None stated. Research data the author distributes with Mumford (2013), "New heuristic and evolutionary operators for the multi-objective urban transit routing problem", IEEE CEC 2013, [doi:10.1109/CEC.2013.6557668](https://doi.org/10.1109/CEC.2013.6557668), so that others can test on it; redistributed here unchanged with that attribution. Mandl's network is from Mandl (1980), EJOR 5(6), [doi:10.1016/0377-2217(80)90126-5](https://doi.org/10.1016/0377-2217(80)90126-5) |
| `external/utrp/husselmann2024/*.txt` | The route sets behind Tables 9 and 10 of Hüsselmann, van Vuuren and Andersen (2024): eleven `Extreme solutions.txt` files from their results repository, one per run of DBMOSA or NSGA-II, each with the ends of the run's Pareto set best for the operator and best for passengers and the scores their code gave them, saved under the name of the run's top folder; `ORIGINAL_PATHS.txt` lists each file's path in the repository | [github.com/GHuss7/UTRP-Improvements-Article-Results](https://github.com/GHuss7/UTRP-Improvements-Article-Results), the repository the paper's data availability statement names (commit 8d3656f of 23 August 2024), read on 30 October 2026 | None stated in the repository. Research results the authors publish with Hüsselmann, van Vuuren and Andersen (2024), "An improved solution methodology for the urban transit routing problem", Computers & Operations Research 163:106481, [doi:10.1016/j.cor.2023.106481](https://doi.org/10.1016/j.cor.2023.106481), itself CC BY 4.0; redistributed here unchanged with that attribution |
| `external/utrp/jiao2026/` | `best_networks.json`: the route sets with the lowest average travel times Jiao (2026) reports, one for each of Mumford0–3 and six for Mandl with 4 to 12 routes, with the author's ATT for each (SHA-256 `e1b1255a40ed0a46a3d9bb3a007b90d154d2ce34a221a8aa18f7040a485d41e9`); `best_known.csv`: the author's table of the best published values and their sources; `trndp_preprint_v2.pdf`: the preprint; `LICENSE-DATA` and `CITATION.cff` as in the archive | Zenodo record [10.5281/zenodo.23759374](https://doi.org/10.5281/zenodo.23759374) (v2 of 29 October 2026; all versions [10.5281/zenodo.23523785](https://doi.org/10.5281/zenodo.23523785)); the data files from inside `trndp-exact-v2.tar.gz` (`results/paper/data_20261022/best_networks.json`, `results/best_known.csv`), read on 30 October 2026 | CC BY 4.0 for the data (`LICENSE-DATA`, © 2026 Tianqin Jiao); the code in the archive is MIT. The author asks that the preprint and the archive be cited: Jiao, T. (2026), "Certified bounds and exact search for transit route network design", preprint v2, 22 October 2026 |

## Riga, a second city read from its GTFS feed

`cities/riga.toml` reads these files; `python3 data/fetch_city.py riga --refresh`
downloads them again ([docs/cities.md](../docs/cities.md)).

| File | Contents | Source | Licence |
|---|---|---|---|
| `cities/riga/gtfs.zip` | Rīgas satiksme's timetable: 80 routes (52 bus, 21 trolleybus, 7 tram), 12,059 trips, 1,643 stops and the shapes of the routes. The model reads the 52 bus routes as they run on Wednesday 4 November 2026. SHA-256 `aed076355a0c2a2c15eb3b0fc5c34933483fcd2b65a63609f3adbb8894f1fe4a` | Rīgas satiksme on Latvia's open data portal, dataset "Maršrutu saraksti Rīgas Satiksme sabiedriskajam transportam", file `marsrutusaraksti10_2026.zip` of 5 November 2026 ([data.gov.lv](https://data.gov.lv/dati/lv/dataset/marsrutu-saraksti-rigas-satiksme-sabiedriskajam-transportam)), retrieved 21 November 2026. The Mobility Database lists the dataset as feed mdb-3502 | CC0 1.0 (the portal's CKAN metadata) |
| `cities/riga/kontur_population_LV_20231101.gpkg` | Population on H3 hexagons (~0.74 km²): the 1,454 cells of Latvia's grid whose centre lies within the box of the served stops plus 5 km, cut by `data/fetch_city.py` (`busnet.population.cut_gpkg`); the measurements are the same as with the whole country's grid | Kontur Population, release 2023-11-01, the same source as Azerbaijan's above | CC BY |
| `cities/riga/osm_education.json`, `osm_health.json`, `osm_shopping.json`, `osm_offices.json`, `osm_transport.json` | The five kinds of destination above, in the box 56.841–57.089 N, 23.871–24.413 E (the served stops plus 2 km), as nodes and ways in the shape of an Overpass answer; relations are not included | Cut by `data/fetch_city.py --osm geofabrik` (`osm_pbf.places`) out of Geofabrik's extract `europe/latvia/latvia-latest.osm.pbf` (142 MB, OpenStreetMap data of 20 November 2026, 21:21 UTC), downloaded 21 November 2026, when no Overpass server answered; the extract itself is not kept | ODbL, © OpenStreetMap contributors |

## The world pilot: 24 more cities read from their GTFS feeds

`cities/<city>.toml` reads these files for each city of the world pilot
([docs/world.md](../docs/world.md)); `cities/baku.toml` reads Baku from this repository's own
feed, with the population and destination files above. They are not in git: with the feeds
and maps `redesign.py` writes for each city, they come to 243 files and 351 MB, kept in the
Hugging Face dataset
[ismatsamadov/route-efficiency-cities](https://huggingface.co/datasets/ismatsamadov/route-efficiency-cities).
`data/world_files.csv` lists each file with its size and SHA-256, and
`python3 data/fetch_world.py` downloads them and checks each. `python3 data/fetch_city.py
<city>` downloads a city's from their publishers instead, as they are on the day.

Every feed's publisher allows redistribution with credit. I read each licence on the
publisher's page or in its portal's metadata on 21 November 2026, except Gdańsk's and
Kyiv's, whose pages did not answer; their licences are as the Mobility Database records
them. Where a feed came from the Mobility Database's copy, because the publisher's address
wanted a key or did not answer from here, the copy is the publisher's file as the database
last fetched it.

| File | Contents | Source | Licence |
|---|---|---|---|
| `cities/accra/gtfs.zip` | Accra: Accra Mobility, a project of the Accra Metropolitan Assembly and AFD: trotro lines. 277 routes (277 bus), 554 trips, 2,525 stops, with the routes' shapes and frequencies. The model reads its 277 bus routes as they run on Monday 4 March 2019. SHA-256 `c33d127f1d456386c5e0e2d71b669a36690c08faf64be26d153dc6ba50a9ea86` | DigitalTransport4Africa's repository on GitLab; the copy the Mobility Database keeps as feed mdb-881, retrieved 21 November 2026 | ODbL 1.0 (the repository's LICENSE) |
| `cities/addis_ababa/gtfs.zip` | Addis Ababa: AddisMapTransit, with support from DigitalTransport4Africa: the Anbessa and Sheger city buses, mapped August 2022 to March 2024. 193 routes (193 bus), 385 trips, 1,340 stops, with the routes' shapes and frequencies. The model reads its 193 bus routes as they run on Monday 2 December 2019, the first weekday of a calendar from 2019 to 2099 that stands for any day. SHA-256 `db681d38cb0f02b6d77e8e4fc659b9bf3c1184be69725bf69645d05de3caa206` | DigitalTransport4Africa's repository on GitLab, folder "Addis Ababa GTFS_2023", file et-addisababa-bus.zip (buses only, without the minibus taxis); a mirror of AddisMapTransit-gtfs 1.0.0, retrieved 21 November 2026 | ODbL 1.0 (the folder's README) |
| `cities/austin/gtfs.zip` | Austin: Capital Metropolitan Transportation Authority (CapMetro), Austin. 70 routes (69 bus, 1 tram), 26,147 trips, 2,339 stops, with the routes' shapes. The model reads its 65 bus routes as they run on Friday 13 November 2026. SHA-256 `e315e6c8c6f7cc7d8c4b6faa28a187745771af986c5aef73ee81a878c963664a` | The Texas Open Data Portal (data.texas.gov, r4v4-vz24); the copy the Mobility Database keeps as feed mdb-150, retrieved 21 November 2026 | CapMetro's Open Data License Agreement, which grants non-exclusive, revocable rights to use, reproduce and redistribute its data |
| `cities/halifax/gtfs.zip` | Halifax: Halifax Transit. 81 routes (79 bus, 2 ferry), 9,239 trips, 2,347 stops, with the routes' shapes. The model reads its 79 bus routes as they run on Monday 24 August 2026. SHA-256 `f5d95091c8134716834734e2695b16689fd19c2302932e147c7075c6a9f6bb76` | Gtfs.halifax.ca; the copy the Mobility Database keeps as feed mdb-734, retrieved 21 November 2026 | Open Government Licence – Halifax |
| `cities/quebec/gtfs.zip` | Québec City: Réseau de transport de la Capitale (RTC), Québec City. 150 routes (150 bus), 64,767 trips, 4,199 stops, with the routes' shapes. The model reads its 137 bus routes as they run on Monday 23 November 2026. SHA-256 `39184ea80f2f6e14338181818b179651634898a33066da11ee3ad30d8558a624` | Données Québec, dataset "RTC : GTFS /arrêts et les parcours"; the copy the Mobility Database keeps as feed mdb-757, retrieved 21 November 2026 | CC BY 4.0 (Données Québec's metadata) |
| `cities/trujillo/gtfs.zip` | Trujillo: Transportes Metropolitanos de Trujillo's OMUS platform, built from OpenStreetMap by the Trufi Association. 102 routes (102 bus), 102 trips, 4,067 stops, with the routes' shapes and frequencies. The model reads its 102 bus routes as they run on Monday 3 January 2000, the first weekday of a calendar from 2000 to 2100 that stands for any day; the feed was built on 12 November 2024. SHA-256 `3f927c8e8335662463018667df7ce71a2f535793f1cd4bb466e55f50e8099eb0` | The Trujillo-OMUS repository on GitHub; the copy the Mobility Database keeps as feed mdb-2200, retrieved 21 November 2026 | GPL-3.0 for the repository; the routes are OpenStreetMap data (ODbL 1.0) |
| `cities/kochi/gtfs.zip` | Kōchi: Tosaden Kotsu (とさでん交通), regular buses in Kōchi. 25 routes (25 bus), 718 trips, 820 stops, with the routes' shapes. The model reads its 36 bus routes as they run on Thursday 1 October 2026. SHA-256 `61548287489a592e7470827d669c0de5031f091cededf807fccb071649a667db` | Japan's GTFS data repository (gtfs-data.jp); the copy the Mobility Database keeps as feed jbda-tosaden-kotsu-GTFS-Tosadentraffic_Regularbus, retrieved 21 November 2026 | CC BY 4.0 |
| `cities/kuala_lumpur/gtfs.zip` | Kuala Lumpur: Prasarana Malaysia, Rapid Bus KL. 139 routes (139 bus), 2,118 trips, 4,107 stops, with the routes' shapes and frequencies. The model reads its 139 bus routes as they run on Wednesday 1 April 2020, the first weekday of a calendar that runs to 31 March 2027 with the same service on every weekday. SHA-256 `8721e30d81a29b64dc4a64424871ec3afe8b2a0b509153ade2a32401c6c5cc61` | Malaysia's GTFS Static API (api.data.gov.my); the copy the Mobility Database keeps as feed tld-6767, retrieved 21 November 2026 | CC BY 4.0 (developer.data.gov.my) |
| `cities/melaka/gtfs.zip` | Melaka: BAS.MY Melaka. 22 routes (22 bus), 601 trips, 725 stops, with the routes' shapes. The model reads its 22 bus routes as they run on Friday 9 October 2026. SHA-256 `f9d3cce64852edc51fd5df7333ea31994e74d90b627f5d62b7a722484bdf7b2c` | Malaysia's GTFS Static API (api.data.gov.my/gtfs-static/mybas-melaka), retrieved 21 November 2026 | CC BY 4.0 (developer.data.gov.my) |
| `cities/penang/gtfs.zip` | Penang: Prasarana Malaysia, Rapid Penang. 47 routes (47 bus), 5,988 trips, 1,932 stops, with the routes' shapes. The model reads its 48 bus routes as they run on Monday 23 November 2026. SHA-256 `7cedac30c1fb09fadd54f85f9d1476c265940254a89f70253f04f6fef564ac83` | Malaysia's GTFS Static API (api.data.gov.my); the copy the Mobility Database keeps as feed tld-6770, retrieved 21 November 2026 | CC BY 4.0 (developer.data.gov.my) |
| `cities/sendai/gtfs.zip` | Sendai: Sendai City Transportation Bureau (仙台市交通局), city buses. 339 routes (339 bus), 8,231 trips, 2,147 stops, with the routes' shapes. The model reads its 341 bus routes as they run on Wednesday 7 October 2026. SHA-256 `58c8145517bf8017efca4dfc53d1ed8b44e59088dc5a3a654a965c0ff7761c6c` | The Public Transportation Open Data Center; the copy the Mobility Database keeps as feed odpt-SendaiMunicipal-bus_realtime_information, retrieved 21 November 2026 | CC BY 4.0 |
| `cities/cardiff/gtfs.zip` | Cardiff: Cardiff Bus. 61 routes (61 bus), 4,685 trips, 1,637 stops, with the routes' shapes. The model reads its 69 bus routes as they run on Tuesday 24 November 2026. SHA-256 `e5179e50d40ce1e33388891963ec87de88bb64f38a95bc86f41cdd16814fbc99` | The Department for Transport's Bus Open Data Service; the copy the Mobility Database keeps as feed mdb-1931, retrieved 21 November 2026 | Open Government Licence v3.0 |
| `cities/dublin/gtfs.zip` | Dublin: Dublin Bus, published by the National Transport Authority (Transport for Ireland). 116 routes (116 bus), 78,802 trips, 4,339 stops, with the routes' shapes. The model reads its 115 bus routes as they run on Monday 23 November 2026. SHA-256 `4444f7bcf0d596f53ae892695b191f4b830ec7d830947f6943675f1df1dba6db` | The NTA's GTFS files (data.gov.ie dataset "NTA GTFS and GTFS Realtime"); the copy of Dublin Bus's the Mobility Database keeps as feed mdb-2635, retrieved 21 November 2026 | CC BY 4.0 (data.gov.ie) |
| `cities/gdansk/gtfs.zip` | Gdańsk: ZTM Gdańsk (Zarząd Transportu Miejskiego w Gdańsku). 93 routes (83 bus, 10 tram), 95,677 trips, 1,626 stops, with the routes' shapes. The model reads its 92 bus routes as they run on Thursday 19 November 2026. SHA-256 `4419d54dfaff6a952a74cc0c0e446641577fb22f6351fd4667cb6938949d248c` | Gdańsk's open data portal (ckan.multimediagdansk.pl), which did not answer from here on 21 November 2026; the copy the Mobility Database keeps as feed mdb-2093, retrieved 21 November 2026 | CC0 1.0, as the Mobility Database records it |
| `cities/grenoble/gtfs.zip` | Grenoble: SMMAG, the Grenoble area's TAG network. 131 routes (126 bus, 5 tram), 19,362 trips, 2,208 stops, with the routes' shapes and frequencies. The model reads its 132 bus routes as they run on Monday 14 December 2026. SHA-256 `c5c4076a61ec3e4dc57966266ebdd3064cfbd5b7b402719962ebb09d96c69863` | Transport.data.gouv.fr; the copy the Mobility Database keeps as feed tdg-83459, retrieved 21 November 2026 | ODbL 1.0 |
| `cities/jyvaskyla/gtfs.zip` | Jyväskylä: Linkki, Jyväskylä's network, through Waltti. 86 routes (86 bus), 5,369 trips, 2,205 stops, with the routes' shapes. The model reads its 89 bus routes as they run on Friday 14 August 2026. SHA-256 `485c0fbed0972043a41959294201d4e855248bdf7b9ed4ed6737080b6ca6e0d9` | Waltti's open data; the copy the Mobility Database keeps as feed mdb-867, retrieved 21 November 2026 | CC BY 4.0 |
| `cities/kyiv/gtfs.zip` | Kyiv: Kyivpastrans (КП «Київпастранс»), Kyiv's municipal operator. 206 routes (140 bus, 49 trolleybus, 17 tram), 29,110 trips, 1,820 stops, with the routes' shapes. The model reads its 134 bus routes as they run on Friday 20 November 2026. SHA-256 `e19f95ce3d9b1aa96ea53ea65dd69eae81283f67b331c8794235bea2fa50c996` | The operator's GTFS export; the copy the Mobility Database keeps as feed mdb-3230, retrieved 21 November 2026 | CC BY 4.0, as the Mobility Database records it |
| `cities/palermo/gtfs.zip` | Palermo: AMAT Palermo S.p.A. and the Comune di Palermo. 66 routes (62 bus, 4 tram), 12,609 trips, 1,651 stops, with the routes' shapes. The model reads its 58 bus routes as they run on Monday 2 November 2026. SHA-256 `7261cb09f981fa2c5432235ef42d9b998fe3d2279d9164dfc03f64c84166122e` | Palermo's open data portal, dataset 1303; the copy the Mobility Database keeps as feed mdb-2373, retrieved 21 November 2026 | CC BY 4.0 IT; the tram's data CC BY-SA 4.0 (the portal) |
| `cities/rennes/gtfs.zip` | Rennes: STAR, Rennes Métropole's network. 155 routes (153 bus, 2 metro), 86,859 trips, 1,781 stops, with the routes' shapes. The model reads its 154 bus routes as they run on Friday 4 December 2026. SHA-256 `c2e57687cb5675274fe9c56a9042b5907242311b9a6678d660a52a38870cbb48` | Transport.data.gouv.fr; the copy the Mobility Database keeps as feed tdg-83281, retrieved 21 November 2026 | ODbL 1.0 |
| `cities/sofia/gtfs.zip` | Sofia: Urban Mobility Center, Sofia. 206 routes (148 bus, 30 trolleybus, 24 tram, 4 metro), 30,652 trips, 4,416 stops, with the routes' shapes. The model reads its 99 bus routes as they run on Monday 16 November 2026. SHA-256 `a3f8d1050d9ffe8108802ad9b8780a70f9f5469bdb386300190acde1e15161ca` | Sofia Traffic's GTFS service (gtfs.sofiatraffic.bg); the copy the Mobility Database keeps as feed mdb-2848, retrieved 21 November 2026 | CC BY 4.0, under Sofia Municipality's terms for mobility data (order СОА25-РД09-3745 of 3 September 2025) |
| `cities/valencia/gtfs.zip` | Valencia: EMT València (Empresa Municipal de Transports). 51 routes (51 bus), 21,627 trips, 1,117 stops, with the routes' shapes. The model reads its 52 bus routes as they run on Wednesday 2 December 2026. SHA-256 `1b672c46bb2863fcb177e6b6f2f1228cd4f46596d818b754cc9626a73dfbe9d8` | València's open data portal (opendata.vlci.valencia.es); the copy the Mobility Database keeps as feed mdb-795, retrieved 21 November 2026 | CC BY 4.0 (the portal's metadata) |
| `cities/cairns/gtfs.zip` | Cairns: Translink, Queensland's Department of Transport and Main Roads (Sunbus Cairns). 23 routes (23 bus), 3,228 trips, 462 stops, with the routes' shapes. The model reads its 20 bus routes as they run on Friday 27 November 2026. SHA-256 `296303a83f8dec04656c6e61d81e743b2ab12d8d38f42202c11ad1e96dd73e64` | Translink's file CNS_GTFS.zip, listed on Queensland's open data portal, retrieved 21 November 2026 | CC BY 4.0 (data.qld.gov.au) |
| `cities/christchurch/gtfs.zip` | Christchurch: Metro, Environment Canterbury. 60 routes (58 bus, 2 ferry), 7,431 trips, 2,083 stops, with the routes' shapes. The model reads its 34 bus routes as they run on Monday 9 November 2026. SHA-256 `cb350247a6558fde0124385ea2c7323f593435de6462a8d6a02d96a43e35dad9` | Metro's GTFS service, which needs a key; the copy the Mobility Database keeps as feed mdb-1313, retrieved 21 November 2026 | CC BY 4.0 (metroinfo.co.nz, developer resources) |
| `cities/townsville/gtfs.zip` | Townsville: Translink, Queensland's Department of Transport and Main Roads (Sunbus Townsville). 17 routes (17 bus), 1,984 trips, 637 stops, with the routes' shapes. The model reads its 17 bus routes as they run on Friday 27 November 2026. SHA-256 `4793bdf37786ec9d34e4d17e2e71a93efb13689227b0e075c5bdc2ab939143a3` | Translink's file TSV_GTFS.zip, listed on Queensland's open data portal, retrieved 21 November 2026 | CC BY 4.0 (data.qld.gov.au) |

Each city's population file is Kontur Population, release 2023-11-01 (CC BY), for its
country, cut to the box of the served stops plus 5 km. Its five destination files hold the
five kinds of destination above, as nodes and ways in the shape of an Overpass answer, in the
box of the served stops plus 2 km. `data/fetch_city.py --osm geofabrik` cut them out of the
Geofabrik extract named, downloaded on 21 November 2026, when every Overpass server failed;
the extracts are not kept. ODbL, © OpenStreetMap contributors.

| City | Population file in `cities/<city>/` | OpenStreetMap extract, and the date of its data | Box: south, west, north, east |
|---|---|---|---|
| Accra | `kontur_population_GH_20231101.gpkg`: 2,983 cells | `africa/ghana/ghana-latest.osm.pbf` (117 MB), data of 2026-11-20 21:21 UTC | 5.504,-0.442,5.780,0.021 |
| Addis Ababa | `kontur_population_ET_20231101.gpkg`: 7,414 cells | `africa/ethiopia/ethiopia-latest.osm.pbf` (141 MB), data of 2026-11-20 21:21 UTC | 8.724,38.350,9.215,39.172 |
| Austin | `kontur_population_US_20231101.gpkg`: 4,374 cells | `north-america/us/texas/texas-latest.osm.pbf` (729 MB), data of 2026-11-20 21:21 UTC | 30.129,-98.012,30.604,-97.351 |
| Halifax | `kontur_population_CA_20231101.gpkg`: 1,419 cells | `north-america/canada/nova-scotia/nova-scotia-latest.osm.pbf` (100 MB), data of 2026-11-20 21:21 UTC | 44.547,-63.884,44.904,-63.258 |
| Québec City | `kontur_population_CA_20231101.gpkg`: 1,113 cells | `north-america/canada/quebec/quebec-latest.osm.pbf` (1,168 MB), data of 2026-11-20 21:21 UTC | 46.717,-71.498,46.956,-71.123 |
| Trujillo | `kontur_population_PE_20231101.gpkg`: 461 cells | `south-america/peru/peru-latest.osm.pbf` (258 MB), data of 2026-11-20 21:21 UTC | -8.242,-79.141,-7.974,-78.928 |
| Kōchi | `kontur_population_JP_20231101.gpkg`: 754 cells | `asia/japan/shikoku/shikoku-latest.osm.pbf` (92 MB), data of 2026-11-20 21:21 UTC | 33.475,133.388,33.639,133.765 |
| Kuala Lumpur | `kontur_population_MY_20231101.gpkg`: 4,484 cells | `asia/malaysia-singapore-brunei/malaysia-singapore-brunei-latest.osm.pbf` (254 MB), data of 2026-11-20 21:21 UTC | 2.727,101.391,3.355,101.927 |
| Melaka | `kontur_population_MY_20231101.gpkg`: 2,263 cells | `asia/malaysia-singapore-brunei/malaysia-singapore-brunei-latest.osm.pbf` (254 MB), data of 2026-11-20 21:21 UTC | 2.167,102.092,2.492,102.582 |
| Penang | `kontur_population_MY_20231101.gpkg`: 2,264 cells | `asia/malaysia-singapore-brunei/malaysia-singapore-brunei-latest.osm.pbf` (254 MB), data of 2026-11-20 21:21 UTC | 5.100,100.172,5.662,100.572 |
| Sendai | `kontur_population_JP_20231101.gpkg`: 1,355 cells | `asia/japan/tohoku/tohoku-latest.osm.pbf` (313 MB), data of 2026-11-20 21:21 UTC | 38.166,140.550,38.408,141.027 |
| Cardiff | `kontur_population_GB_20231101.gpkg`: 913 cells | `europe/united-kingdom/wales/wales-latest.osm.pbf` (151 MB), data of 2026-11-20 21:21 UTC | 51.374,-3.359,51.606,-2.963 |
| Dublin | `kontur_population_IE_20231101.gpkg`: 3,217 cells | `europe/ireland-and-northern-ireland/ireland-and-northern-ireland-latest.osm.pbf` (418 MB), data of 2026-11-20 21:21 UTC | 53.053,-6.645,53.624,-6.023 |
| Gdańsk | `kontur_population_PL_20231101.gpkg`: 1,869 cells | `europe/poland/pomorskie/pomorskie-latest.osm.pbf` (119 MB), data of 2026-11-20 21:21 UTC | 54.220,18.324,54.493,18.965 |
| Grenoble | `kontur_population_FR_20231101.gpkg`: 2,106 cells | `europe/france/rhone-alpes/rhone-alpes-latest.osm.pbf` (534 MB), data of 2026-11-20 21:21 UTC | 44.952,5.569,45.393,6.000 |
| Jyväskylä | `kontur_population_FI_20231101.gpkg`: 10,351 cells | `europe/finland/finland-latest.osm.pbf` (778 MB), data of 2026-11-20 21:21 UTC | 61.857,25.034,62.798,26.533 |
| Kyiv | `kontur_population_UA_20231101.gpkg`: 2,475 cells | `europe/ukraine/ukraine-latest.osm.pbf` (885 MB), data of 2026-11-20 21:21 UTC | 50.208,30.253,50.585,30.800 |
| Palermo | `kontur_population_IT_20231101.gpkg`: 548 cells | `europe/italy/isole/isole-latest.osm.pbf` (217 MB), data of 2026-11-20 21:21 UTC | 38.033,13.228,38.228,13.457 |
| Rennes | `kontur_population_FR_20231101.gpkg`: 3,100 cells | `europe/france/bretagne/bretagne-latest.osm.pbf` (331 MB), data of 2026-11-20 21:21 UTC | 47.921,-1.973,48.318,-1.451 |
| Sofia | `kontur_population_BG_20231101.gpkg`: 2,168 cells | `europe/bulgaria/bulgaria-latest.osm.pbf` (178 MB), data of 2026-11-20 21:21 UTC | 42.462,23.054,42.872,23.632 |
| Valencia | `kontur_population_ES_20231101.gpkg`: 753 cells | `europe/spain/valencia/valencia-latest.osm.pbf` (142 MB), data of 2026-11-20 21:21 UTC | 39.256,-0.453,39.561,-0.254 |
| Cairns | `kontur_population_AU_20231101.gpkg`: 568 cells | `australia-oceania/australia/queensland/queensland-latest.osm.pbf` (200 MB), data of 2026-11-20 21:21 UTC | -17.122,145.644,-16.726,145.805 |
| Christchurch | `kontur_population_NZ_20231101.gpkg`: 2,875 cells | `australia-oceania/new-zealand/new-zealand-latest.osm.pbf` (406 MB), data of 2026-11-20 21:21 UTC | -43.661,172.082,-43.271,172.792 |
| Townsville | `kontur_population_AU_20231101.gpkg`: 607 cells | `australia-oceania/australia/queensland/queensland-latest.osm.pbf` (200 MB), data of 2026-11-20 21:21 UTC | -19.411,146.627,-19.172,146.869 |

## Searched for and not found

No public source gives route headways or timetables, vehicle positions, or ticket
validations by stop; BakuBus's website gives only the first and last departures of its
routes (above) and an interval for H1. Checked: the AYNA map API, opendata.az (69 transport datasets),
OpenStreetMap, the BakuBus and AYNA websites, and news reports. Until AYNA or the
operators share them, `busnet.toml` holds the assumptions that stand in for them. For the
metro, intervals and running times are published (above), but no full timetable, no
exit counts, no flows between stations and no GTFS feed: the Mobility Database catalogue
(3,613 feeds on 25 October 2026) had none for Azerbaijan, and the first it added since,
this repository's model of the buses (community feed mdb-3629, 10 November 2026), has no
metro.
