# Other cities

The measurements and the redesign search read any city's GTFS feed
([getting-started.md](getting-started.md#another-city-from-its-gtfs-feed)). I ran them on
Riga first. Its timetable is in the public domain. Its bus network is about a quarter
the size of Baku's. And its feed gives what Baku's data cannot: every route's real
frequency and speed. This page sets Riga beside Baku and says what a redesign would be
worth there. The world pilot then ran 24 more cities the same way
([world.md](world.md)). Every number here is in `output/cities/riga/`, which two commands
regenerate:

```sh
python3 measure.py --config cities/riga.toml --out output/cities/riga
python3 redesign.py --config cities/riga.toml --out output/cities/riga/redesign
```

## Riga

### What the feed gives

Rīgas satiksme publishes its timetable on Latvia's open data portal under CC0. I took
the file of October 2026, published on 5 November ([data/SOURCES.md](../data/SOURCES.md)).
It has 80 routes: 52 bus routes, 21 trolleybus routes and 7 tram routes. The model reads
the buses only, as it leaves out Baku's metro, so where trams and trolleybuses carry the
centre of Riga the bus network looks thinner than the city's transit is. It reads them
as they run on Wednesday 4 November 2026, the weekday with the most bus trips: 3,499
departures. From 05:00 to 23:00, buses leave at least a quarter as often as in the busiest
hour, so each route's trips are spread over those 18 hours.

98.2% of the departures run a route's main stop sequence or a short turn of it. Four
branches carry enough to run as routes of their own: 11 to Jaunciema kapi, 25 to
Tīraine, 36 to Imanta and one of 56's. The night bus N22 is left out, since one all-day
frequency cannot stand for it, as are 52 departures on small branches. Every route's
moving speed comes from its timetable, a median of 28.9 km/h (22 to 41). The headways
spread over the 18 hours run from every 9 minutes on route 3 to every 4 hours on route
34, with a median of 41 minutes. No route is marked express. Kontur's grid counts 603,000
people around the network. OpenStreetMap's destinations came from Geofabrik's extract of
Latvia, because no Overpass server answered on the day.

### Riga beside Baku

| | Baku | Riga |
|---|---|---|
| Routes in the model | 201 | 55 (51 routes and 4 branches) |
| Stops served | 3,456 | 1,241 |
| Route length, one way, all directions | 7,398 km | 1,818 km |
| Route-km per km of street link (duplication) | 1.93 | 1.87 |
| Most routes on one link | 26 | 16 |
| Median stop gap | 420 m | 529 m |
| Stop gaps under 300 m | 23.9% | 7.8% |
| Running time lost at stops | 18.8% | 20.8% |
| Median end-to-end circuity | 1.77 | 1.81 |
| Routes direct / indirect / very indirect / loop | 29 / 98 / 55 / 19 | 7 / 32 / 14 / 2 |
| Detours found | 271 on 139 routes | 78 on 33 routes |
| People within 400 m of a stop, straight line | 66.0% of 3.04 million | 66.7% of 0.60 million |
| Average door-to-door trip, trips that can be made | 51.8 min | 59.9 min |
| Trips that can be made within 45 minutes | 29.4% | 20.8% |
| Bus-equivalents in service, all-day average | 2,015 | 185 |
| Bus-km a day | 588,994 | 56,941 |
| Fuel a day | 226,592 L | 21,679 L |
| Where the headways come from | 1 published, 55 from counts, 145 assumed | 55 from the timetable |

The two networks share Baku's main faults in about the same measure. Routes are as
indirect, a median of 1.81 times the straight line between their ends against 1.77, and
the routes overlap about as much, 1.87 route-km for every kilometre of street link
against 1.93. Riga's stops are further apart: only 7.8% of its gaps are under 300 m,
against 23.9% in Baku. The same share of people live near a stop, about two in three,
but trips by bus take longer, 59.9 minutes on average against 51.8. That is what leaving
out the trams and trolleybuses should do. Riga's bus headways are long, a median of 41
minutes over the day, because frequent service in the centre is on rails and wires.

### What a redesign would be worth

The search keeps 28 changes:

- it drops seven routes (63, 37, 31, 30, 39, 44 and 53) and merges five pairs, four of
  them a route and its own branch;
- it straightens eleven detours;
- it removes 18 closely spaced stops;
- it moves buses in four rounds.

On the independent check:

| Measure | Today | Same buses | Change | 80% of the buses | Change |
|---|---|---|---|---|---|
| Average trip, impossible trips counted at 120 min | 80.40 min | 77.41 min | −2.99 min | 80.31 min | −0.09 min |
| Average trip, possible trips only | 59.90 min | 56.47 min | −3.42 min | 59.95 min | +0.05 min |
| Trips possible within 45 min | 20.8% | 22.4% | +1.6 points | 20.2% | −0.6 points |
| People within 400 m of a stop | 401,933 | 399,706 | −2,227 | 399,706 | −2,227 |
| Bus-equivalents, rounded up per route | 185 | 177 | −8 | 150 | −35 |
| Bus-hours a day | 2,491 | 2,491 | 0 | 2,004 | −486 |
| Bus-km a day | 56,941 | 57,725 | +784 | 46,450 | −10,491 |
| Fuel a day | 21,679 L | 21,915 L | +236 L | 17,635 L | −4,044 L |
| CO₂ a day | 57.9 t | 58.5 t | +0.6 t | 47.1 t | −10.8 t |

With today's buses the average trip gets three minutes shorter, four times Baku's gain.
Alternatively, today's trip times need a fifth fewer buses, saving about 4,000 litres of
fuel and 11 tonnes of CO₂ a day. I would not read the difference from Baku as Riga's
network being worse. Most of the gain comes from two kinds of change. The four rounds
of moving buses save about 1.9 minutes on the search sample, and the seven drops about
1.3. Both rest on riders the model estimates, because Riga publishes no counts by route. In
Baku, the counts on 56 routes kept the search from dropping any route with 1,000 or more
counted boardings a day.

### Check these before reading anything into it

1. **Only buses.** Trams and trolleybuses are in the feed but not in the model, so a bus
   route that runs beside a tram looks more needed than it is, and one that feeds it
   looks less. Adding them (`gtfs_route_types = [3, 11, 0]`) would bring their riders'
   trips into the model, but would also let the search straighten tram lines, which
   cannot leave their rails.
2. **No counts.** Every dropped route, and every route that gains or loses buses, rests on
   the gravity model alone. Riga's ticket validations by route would test it, as the
   BakuBus counts test Baku's.
3. **The airport.** Route 22 runs to the airport, which none of the destination kinds
   covers, so the model saw few riders on it and dropped it; `cities/riga.toml` protects
   it. Other routes to places the destinations miss could be dropped the same way.
4. **One weekday, one frequency.** Each route runs at its average frequency over 18 hours,
   so peaks are smoothed, and the 185 bus-equivalents are the buses an even service needs,
   not Rīgas satiksme's fleet.

The search's settings are Baku's, the same as for Baku's own results, apart from the
service hours, the protected airport route and the absence of counts; the other choices
are in `cities/riga.toml`. What this page shows is that the method carries to another
city's open data unchanged. Whether Riga's numbers hold up is a question for someone
who knows Riga's buses.
