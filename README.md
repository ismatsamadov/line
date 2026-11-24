# Line | Planning Baku’s next quarter of bus service

A bus moved to one route comes off another. A merger can shorten a wait and cost someone their direct ride. These tradeoffs recur in public consultations: Houston riders asked for shorter waits, while Dublin riders flagged longer walks and extra transfers. Baku’s public route map, passenger counts and walking network let us test several of those decisions before changing a timetable. [Houston rider survey](https://linkhouston.org/equity-in-transit-2024/) · [Dublin consultation](https://busconnects.ie/wp-content/uploads/2022/02/Report-on-BusConnects-Consultation-2019.html)

## With the same buses, which routes should run more often?

**Start with 595 and 140E for a timetable review.** Both have counted demand and long estimated gaps between buses. In the redesign, 595 between Avtovağzal and Sumqayıt goes from **30 to 24 minutes** between departures, and 140E between Koroğlu and Mərdəkan goes from **30 to 25**. They carried about 2,399 and 3,133 boardings respectively on an average September weekday. The plan also cuts service on 50 and 54 from every 10 minutes to about every 24. The service intervals are model estimates. Routes 50 and 54 also lack boarding counts. Check their peak loads and actual departure intervals before taking a bus away. [All 201 routes, counts and proposed frequencies](output/redesign/routes.csv)

Across the full redesign, the same daily bus-hours save an estimated **1,268 rider-hours per 100,000 journeys**. This is a service budget: rounding the buses needed on each route gives 2,017 against 2,015 today. A dispatchable schedule still needs to fit the available vehicles and drivers. [Network comparison](output/redesign/impact.csv)

## Where does a nearby stop still mean a long walk?

**Check the areas around Gənclik, Avtovağzal and Qara Qarayev first.** They have the largest gaps between map coverage and walking coverage among the 27 metro-station areas tested. The table counts residents within one kilometre of each named station and measures their distance to the nearest **bus stop** by two methods. These circles can overlap and represent only the area around each station. [All station areas](output/station_access.csv) · [Reproduce the calculation](station_access.py)

| Station area | Within 400 m in a straight line | Within a 400 m walk on mapped streets |
|---|---:|---:|
| Gənclik | 100% | 62% |
| Avtovağzal | 87% | 50% |
| Qara Qarayev | 100% | 65% |

Around Gənclik alone, the gap represents about **12,700 residents** in the population model. An on-foot audit can trace the route to the nearest crossing and check for missing paths before planners choose between moving a stop and improving the approach. [Population and street data](data/SOURCES.md)

![Citywide comparison of bus-stop access by straight-line and walking distance.](animations/walking-access.gif)

## When two routes share most stops, do riders still need both?

**114B and 114A are worth testing together.** Some 92% of 114B’s stops are also on 114A. In the model, merging them and reallocating the buses leaves everyone previously within the 500 m access threshold inside it. **210 and 215 make the case for keeping service on a branch.** Their overlap is even higher at 93% of 210’s stops, yet the proposed merger leaves about 495 residents beyond that threshold. Before combining either pair, count boardings at the unique stops and check which direct journeys would gain a transfer. In the full redesign, the share of feasible trips requiring at least two transfers rises from 16.6% to 17.5%. [Merger results](output/redesign/changes.csv) · [Rider impacts](docs/results.md#check-these-before-acting)

![Baku route map replaying the 27 changes tested by the redesign.](animations/redesign.gif)

## What could the operator save?

Keeping today’s bus-hours directs the gain to riders and uses slightly more fuel. A separate scenario runs the redesigned network less often while preserving today’s **average** journey time. It saves an estimated **26,452 diesel-equivalent litres per weekday**. At AZN 1.10 per litre over 250 equivalent weekdays, that is **AZN 7.27 million in gross fuel value** and, at 2.67 kg CO₂ per litre, **17,657 tonnes of avoided tailpipe emissions**. The diesel price is a retail benchmark. The operator’s actual fuel mix, invoices and service days determine the budget effect. [Priced results](output/baku-priced/impact.csv) · [Diesel tariff](https://tariff.gov.az/post/bir-sira-mehsul-ve-xidmetler-uzre-guzestler-tetbiq-olunub-qiymetler-mueyyenlesdirilib) · [Animated calculation](animations/fuel-value.gif)

[Research paper](paper/manuscript.md) · [Data and assumptions](docs/methodology.md) · [Reproduce the study](docs/getting-started.md) · [Comparison across 26 cities](docs/world.md)

## Licensing

Noncommercial use requires credit. Commercial use requires the author's written permission. The code and settings use the PolyForm Noncommercial licence. The article, figures and the author’s contributions to the data and results use CC BY-NC 4.0. Third-party data retain their source terms, including © OpenStreetMap contributors (ODbL) and Kontur Population (CC BY). AYNA’s map is a research snapshot with no published licence. [Full terms and notices](LICENSE) · [Source credits](data/SOURCES.md) · [Citation](CITATION.cff)
