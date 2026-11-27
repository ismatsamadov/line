# The world pilot: 25 cities and Baku

Baku's redesign shortens the average trip by about three quarters of a minute with the same
buses, or keeps today's trip times with 219 fewer of its 2,015 buses. I wanted to know whether that is
Baku's or the method's: whether the same search finds as much in other cities, and what it
would come to across many of them. So I ran it on 25 cities on five continents, each read
from the GTFS feed its transit agency, its city or a mapping project publishes, with the same
settings for all, and added Baku read from its own feed so that it compares like for like.
This page says how I chose the cities, what I ran, what came out and how far to trust it.
Every saving on it is a model estimate: apart from Baku, no city's demand rests on
passenger counts. The article [I measured the bus networks of 26 cities from their open
timetables](https://ismatsamadov.medium.com/i-measured-the-bus-networks-of-26-cities-from-their-open-timetables-aae0aabf710a) (also on [BirJob](https://www.birjob.com/blog/bus-networks-26-cities-open-timetables)) tells the same story for a general reader.

## What came out

The search found a better network in every city. With the same buses, the average
door-to-door trip gets shorter by 2.91 minutes in the middle city, from 0.76 in Kyiv to
8.32 in Trujillo, and by more than two minutes in 16 of the 26. Kept to today's trip times
instead, the middle city needs 77% of its buses, from 51% in Trujillo to 89% in Rennes.

| City | Continent | Routes | Stops | Buses today | Door to door today (min) | Same buses: minutes saved | Fewer buses: buses saved | Fuel saved (L a day) | CO₂ saved (t a day) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Accra (GH) | Africa | 277 | 2,525 | 2,183 | 56.3 | 2.57 | 859 | 66,497 | 177.5 |
| Addis Ababa (ET) | Africa | 193 | 1,340 | 972 | 62.4 | 3.45 | 413 | 29,832 | 79.7 |
| Austin (US) | Americas | 65 | 2,260 | 266 | 53.9 | 0.88 | 49 | 5,066 | 13.5 |
| Halifax (CA) | Americas | 79 | 2,344 | 183 | 59.4 | 6.19 | 58 | 6,215 | 16.6 |
| Québec City (CA) | Americas | 137 | 4,041 | 270 | 63.0 | 7.00 | 94 | 8,320 | 22.2 |
| Trujillo (PE) | Americas | 102 | 4,067 | 2,390 | 39.1 | 8.32 | 1,168 | 146,765 | 391.9 |
| Baku (AZ), from its own feed | Asia | 201 | 3,456 | 2,015 | 52.1 | 0.82 | 255 | 29,754 | 79.4 |
| Kōchi (JP) | Asia | 36 | 790 | 44 | 51.8 | 3.98 | 21 | 882 | 2.4 |
| Kuala Lumpur (MY) | Asia | 139 | 4,088 | 400 | 62.7 | 1.89 | 101 | 11,348 | 30.3 |
| Melaka (MY) | Asia | 22 | 725 | 43 | 57.7 | 1.23 | 4 | 761 | 2.0 |
| Penang (MY) | Asia | 48 | 1,932 | 188 | 52.0 | 2.85 | 59 | 6,162 | 16.5 |
| Sendai (JP) | Asia | 341 | 2,139 | 383 | 62.1 | 2.04 | 67 | 2,884 | 7.7 |
| Cardiff (GB) | Europe | 69 | 1,604 | 163 | 58.8 | 3.19 | 37 | 2,690 | 7.2 |
| Dublin (IE) | Europe | 115 | 4,295 | 706 | 62.5 | 3.32 | 187 | 18,011 | 48.1 |
| Gdańsk (PL) | Europe | 92 | 1,301 | 206 | 61.4 | 3.08 | 50 | 4,955 | 13.2 |
| Grenoble (FR) | Europe | 132 | 1,910 | 264 | 48.7 | 1.52 | 34 | 2,104 | 5.6 |
| Jyväskylä (FI) | Europe | 89 | 1,956 | 128 | 42.6 | 1.51 | 19 | 1,501 | 4.0 |
| Kyiv (UA) | Europe | 134 | 1,140 | 457 | 53.4 | 0.76 | 83 | 6,215 | 16.6 |
| Palermo (IT) | Europe | 58 | 1,545 | 231 | 54.7 | 4.62 | 78 | 6,867 | 18.3 |
| Rennes (FR) | Europe | 154 | 1,680 | 318 | 49.2 | 0.78 | 31 | 1,953 | 5.2 |
| Riga (LV) | Europe | 55 | 1,241 | 185 | 60.0 | 2.98 | 35 | 4,049 | 10.8 |
| Sofia (BG) | Europe | 99 | 2,298 | 389 | 57.7 | 1.44 | 45 | 5,110 | 13.6 |
| Valencia (ES) | Europe | 52 | 1,117 | 283 | 38.1 | 1.51 | 104 | 8,967 | 23.9 |
| Cairns (AU) | Oceania | 20 | 460 | 43 | 59.9 | 4.19 | 9 | 985 | 2.6 |
| Christchurch (NZ) | Oceania | 34 | 2,054 | 165 | 52.1 | 3.26 | 41 | 4,404 | 11.8 |
| Townsville (AU) | Oceania | 17 | 637 | 45 | 60.8 | 3.89 | 9 | 878 | 2.3 |
| All 26 | | 2,760 | 52,945 | 12,920 | | | 3,910 | 383,172 | 1,023.1 |

Over all 26 networks the model counts 12,920 buses in service on a weekday, and every
saving here is taken from that count. The timetables themselves would need 13,210: in
Accra, Addis Ababa and Trujillo seven routes run more often than every three minutes, the
shortest headway the model gives a route, and the model runs them at three minutes with
290 fewer buses (`buses_timetable` and `buses_capped` in `output/world/cities.csv`).
Keeping today's trip times, the redesigned networks need 3,910 fewer buses, 30%, which
saves 55,718 bus-hours, 383,172 litres of fuel and 1,023 tonnes of CO₂ a day. Most of
that, though, is in the three networks mapped from OpenStreetMap rather than published by
an operator: Trujillo's, Accra's and Addis Ababa's. They are minibus and city-bus
networks whose frequencies are the mappers' estimates, and the model prices their fuel as
a full-size bus burns it. Between them they hold 2,440 of the 3,910 buses and 243,093 of
the litres. In the 23 networks their operators or cities publish, the total is 1,470
fewer buses of 7,375, 20%, saving 19,320 bus-hours, 140,079 litres of fuel and 374 tonnes
of CO₂ a day. That is the figure I would quote.

The first version of this table, on 21 November 2026, took today's buses from the
timetables and the savings from the model's count, so 13,245 buses today less the 9,083
needed came to 4,162, not the 3,872 it gave as saved; the 290 buses in between are the
three-minute cap, not the redesign. The table now takes both from the model and checks
that every row and the total add up. The search, too, now starts from the model's count:
until then the same-buses option in Accra and Addis Ababa could hand the capped buses to
other routes, so its 2.79 and 3.70 minutes there rested on buses today's network does not
count; they are now 2.57 and 3.45. Two fixes in the model moved the results a little
too: trips that could just be made within two hours had been counted as impossible, and
Christchurch's timetable had been read without its times (below).

The same-buses option costs fuel in 22 of the 26 cities, 16,974 litres a day over the 23
published networks, because the same buses run more kilometres on the redesigned routes.
Riders' time cannot be added up in hours, since that needs each city's journeys a day, and
only Baku publishes counts the model can use. For every 100,000 journeys, the middle city
saves 4,858 hours of riders' time.

Baku comes out of its own feed much as it does out of AYNA's snapshot with BakuBus's counts
and the metro: 0.82 minutes and 255 fewer buses here, against 0.76 minutes and 219 fewer
buses in the study ([results.md](results.md#what-the-redesign-is-worth)). The settings it
shares with the other cities do not flatter it.

## How I chose the cities

The Mobility Database listed 4,709 GTFS feeds on 21 November 2026, 2,916 of them active. I
wanted feeds of one city's buses, published by its operator or its city, Baku-sized or
smaller, on every continent, and only feeds whose licence lets me pass them on, since the
inputs are published with the results. I read 37 candidates with the GTFS reader to see
their size and what it makes of them, and read each licence on the publisher's page or in
its portal's metadata. Two pages did not answer, Gdańsk's and Kyiv's; their licences are as
the Mobility Database records them. [data/SOURCES.md](../data/SOURCES.md) gives every feed's
publisher, date, licence and checksum.

These I left out:

| City | Why |
|---|---|
| Belo Horizonte | Its portal blocked my requests, so I could not read the licence; with 9,209 stops it is also nearly three times Baku's size |
| Canberra | The old feed is retired, the new one needs a key, and the developer page states no licence |
| Wellington | The portal grants CC BY 4.0 only where a file is marked so, and shows the files only after signing in |
| Kocaeli | The city's portal did not answer, and the Mobility Database keeps no copy |
| Laval | The operator's own terms forbid commercial use, against the CC BY of Québec's portal |
| Calgary, Winnipeg | I could not read their terms |
| Albuquerque | The city's terms reserve its rights |
| Kigali, Nairobi, Kampala, Abidjan, Jakarta | Their repositories or pages state no licence |
| Toluca, İzmir | 60,295 and 11,727 stops, too large for this run |
| Ipoh, Kuching, Seremban | Malaysia's smaller feeds cover only a day or two |

What is thin shows where open transit data exists more than anything else: South America
has one city, Africa two, both from mapping projects rather than operators and Accra's from
2019, and there is none in South Asia, the Middle East or China, where I found no feed that is
both open and current.

## What I ran

For each city, `data/fetch_city.py` downloaded the feed, cut Kontur's population grid for
its country to the city, and took the five kinds of destination from OpenStreetMap. Every
Overpass server failed on 21 November 2026, so the destinations came out of Geofabrik's
extracts of each city's region, read with `data/osm_pbf.py`. `measure.py` and `redesign.py`
then ran with the defaults of `busnet/assumptions.py`, as Riga's did, and the hours of
service each feed shows. Only buses are read; trams, metros, trolleybuses, trains and ferries
are left out, and so are night routes. Each feed is read for one weekday, the busiest that
does not stand out from the weeks around it. Baku is read from the feed this repository
publishes (Mobility Database mdb-3629), with the same settings as the rest; its own study,
with BakuBus's counts and the metro, stays the one to quote for Baku.

Two things in the reader changed on the way. Cardiff's feed adds its Christmas and New Year
timetables on top of the weekday one, and Dublin's its New Year's Day, so a holiday was the
busiest weekday; such a day is now passed over. Christchurch's feed gives 28 of its lines as
two routes, one for each direction, which the model ran as one-way routes the search could
halve; they are now read as one route each. Joining them at first lost the timetable's
departure times, so every Christchurch route took its speed from the settings; with its
scheduled speeds today's network needs 165 buses rather than 200, and the redesign saves
3.26 minutes a trip rather than 2.53. Neither change touches Riga's or Baku's results.

`world.py` puts the cities in one table, `output/world/cities.csv`, with the totals in
`summary.json` ([outputs.md](outputs.md#outputworld--the-world-pilot-in-one-table)). The
inputs, and the feeds and maps the redesigns write, are not in git but in the Hugging Face
dataset [ismatsamadov/route-efficiency-cities](https://huggingface.co/datasets/ismatsamadov/route-efficiency-cities):
351 MB, which `data/fetch_world.py` downloads and checks file by file.

## How far to trust it

The redesign drops and shifts routes by riders the model estimates from where people live
and the places they go. In Baku the counts hold that in check; elsewhere nothing does, so
the cities with the largest gains, Trujillo, Québec City and Halifax, are those where the
search changed the most on modelled riders alone, 36 to 59 changes, and where counts would
most change the answer. I treat every row as a candidate to check with the operator, not a plan.

The model sees buses alone. Where trams, a metro or trains carry much of the city, as in
Kyiv, Sofia, Gdańsk, Grenoble, Rennes and Dublin, the bus network is only part of it, and
trips that would use the rail lines look slow or impossible: only 20% of trips are possible
within two hours on Kyiv's buses. In Sendai, Kuala Lumpur and Trujillo most routes run one
way in the model, as their feeds give them: Sendai's gives most of its route numbers one
direction only, Kuala Lumpur's 105 of its 139 routes, and Trujillo's gives no directions.

Some feeds are rough. Trujillo's and Addis Ababa's come from OpenStreetMap with frequencies,
not timetables, and calendars that stand for any day; Accra's describes 2019; Kuala Lumpur's
calendar starts in 2020. The model prices fuel as a full-size diesel bus burns it, which
overstates it for minibuses. The search may drop a route to an airport, which no
destination kind covers: Riga's is protected by hand, and no other city's was checked.

What would make it real is the same as in Baku: each operator's counts by route, and
someone in each city who knows the network to read the changes. The method and the code are
the same everywhere, so a city that shares its counts gets the same treatment Baku has.

## Running it again

```sh
python3 data/fetch_world.py                  # the inputs, feeds and maps, 351 MB
python3 world.py                             # the table and its totals from output/cities/
python3 world.py --run --force --jobs 4      # measure and redesign every city again first
```

The checksums in `data/world_files.csv` identify the published Hugging Face files.
Regenerated GTFS archives carry the current GitHub publisher and contact URLs in
`feed_info.txt`. This metadata change affects their checksums. `python3 -m unittest`
regenerates the world table, and `BUSNET_SLOW_TESTS=1` also checks each city's measurements.
`data/fetch_city.py <city>` downloads a city's inputs from their publishers instead, as
they are on the day, which gives other results than these.
