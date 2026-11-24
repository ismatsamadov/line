# Line | What Baku’s bus network can teach us about better service

*By Ismat Samadov*

In Baku, eight or more bus routes share the same road on 21 stretches totalling 71 km. Meanwhile, roughly 650,000 residents live within 400 metres of a stop in a straight line but face a longer walk along mapped streets. Merging two routes could free buses for a neighbourhood with long waits. Removing the wrong stop could make a clinic harder to reach. [Corridor measurements](output/corridors.csv) · [Walking-distance analysis](output/robustness/coverage_walk.csv)

## Where routes overlap and riders wait

Some busy corridors need several routes. To find places where moving buses could shorten a journey, Line compares the time people spend walking, waiting, riding and transferring across Baku’s 201 routes. The study uses AYNA’s routes and stops, Kontur’s population grid and BakuBus boarding counts. Only one route has a published interval between buses. For 55 others, the model infers frequency from boardings. For the remaining 145, it estimates frequency by service type. [Data sources](data/SOURCES.md) · [Method](docs/methodology.md)

The model selected 27 changes, including merging overlapping routes and shortening detours. **With the same total bus-hours, the average journey on a separate test sample fell from 74.82 to 74.06 minutes.** That is about 46 seconds per trip, or **1,268 hours per 100,000 journeys**. Trips that could not be completed within two hours counted as 120 minutes. Across ten samples, the saving ranged from 0.68 to 0.81 minutes. [Sample results](output/robustness/redesign_seeds.csv)

![The model tests route changes across Baku. The map replays the 27 changes it selected.](animations/redesign.gif)

## The fuel bill and the carbon footprint

The operator could also run the redesigned network less often and keep the average journey near its original length. Using 0.30 litres per kilometre plus 0.05 per stop, the model estimates a saving of **26,452 diesel-equivalent litres per weekday**. At Azerbaijan’s retail diesel price of AZN 1.10 per litre, repeated over 250 equivalent weekdays, that comes to **AZN 7.27 million in gross fuel value** and **17,657 tonnes of avoided tailpipe CO₂**, using 2.67 kg CO₂ per litre. Actual savings depend on the buses’ fuel mix, what the operator pays and how much service it runs. [Fuel and emissions calculation](output/baku-priced/impact.csv) · [Diesel tariff](https://tariff.gov.az/post/bir-sira-mehsul-ve-xidmetler-uzre-guzestler-tetbiq-olunub-qiymetler-mueyyenlesdirilib) · [Animated estimate](animations/fuel-value.gif)

## Who keeps access to a stop

A circle drawn 400 metres around each stop covers 66% of residents in the study area. Measured along mapped streets and footpaths, coverage falls to 45%. Under the initial redesign, about 976 people lost access to a stop within the model’s 500-metre threshold. Requiring the model to protect those residents still produced a **0.77-minute average saving**. That version gives planners a shorter list of changes to check on foot and with peak-hour passenger counts. [Coverage experiment](output/robustness/redesign_settings.csv) · [Routes to check on the ground](docs/results.md#check-these-before-acting)

![How the share of residents near a bus stop changes when distance is measured along streets instead of in a straight line.](animations/walking-access.gif)

The same method found shorter modelled trips across 26 networks on five continents, with a median gain of 2.91 minutes. Outside Baku, passenger demand was modelled without local boarding counts. The practical use for cities is to identify which changes deserve fieldwork and what to measure there, from peak passenger loads and actual waits to fuel use and the walk to the next stop. [City comparisons and limitations](docs/world.md)

[Research paper](paper/manuscript.md) · [Reproduce the study](docs/getting-started.md) · [Model assumptions](busnet.toml)

## Licensing

Research by Ismat Samadov. Noncommercial use requires credit. Commercial use requires the author's written permission. The code and settings use the PolyForm Noncommercial licence. The article, figures and the author’s contributions to the data and results use CC BY-NC 4.0. Third-party data retain their source terms, including © OpenStreetMap contributors (ODbL) and Kontur Population (CC BY). AYNA’s map is a research snapshot with no published licence. [Full terms and notices](LICENSE) · [Source credits](data/SOURCES.md) · [Citation](CITATION.cff)
