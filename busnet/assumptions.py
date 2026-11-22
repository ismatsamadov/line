"""Every number the metrics assume because the data does not contain it.

These are the defaults. Override any of them in busnet.toml (or another file passed
with --config), or for one run with --set name=value; see busnet/config.py. When real
data arrives (headways, GPS speeds, ticket validations), it replaces the matching
assumption: a headways file beats every headway setting below."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Assumptions:
    # Walking
    walk_speed_mps: float = 1.25          # about 4.5 km/h
    walk_detour: float = 1.3              # street distance / straight-line distance
    max_access_walk_m: float = 500        # furthest someone walks to or from a stop
    max_transfer_walk_m: float = 300      # furthest someone walks between stops to change buses
    coverage_radius_m: float = 400        # industry convention for bus stops (TCQSM; TransLink uses 450 m)

    # How often buses run. Each route takes the first that applies: a headways file you
    # supply; an estimate from observed boardings (if headway_from_ridership); the value
    # for its working zone; default_headway_min. No public source gives real headways.
    default_headway_min: float = 12
    headway_by_zone: dict = field(default_factory=lambda: {
        "Şəhərdaxili": 10, "Şəhərdaxili (ekspres)": 15,
        "Şəhərətrafı": 15, "Şəhərətrafı (ekspres)": 20,
        "Qəsəbədaxili": 20, "Qəsəbələrarası": 20, "Şəhərlərarası": 30,
    })
    headway_from_ridership: bool = True   # BakuBus routes: run often enough to carry observed boardings
    boardings_per_trip: float = 60        # average boardings on one one-way trip of a 12 m bus
    service_hours: float = 17             # 06:00 to 23:00
    min_headway_min: float = 3
    max_headway_min: float = 30
    transfer_penalty_min: float = 5       # extra perceived cost of each change, on top of waiting

    # Fleet: buses needed = round-trip time x (1 + layover_share) / headway
    layover_share: float = 0.15           # recovery time at the terminals
    reference_fleet: int = 2300           # buses in daily service, all operators (Ministry, January 2026)

    # Riding: moving speed between stops by working zone, plus a fixed loss at every stop.
    # Speeds are calibrated so the network-wide average comes to 22 km/h, the bus speed AYNA
    # reported after bus lanes and route changes (Ministry of Digital Development, Nov 2024).
    cruise_kmh: dict = field(default_factory=lambda: {
        "Şəhərdaxili": 22, "Şəhərdaxili (ekspres)": 29,
        "Şəhərətrafı": 29, "Şəhərətrafı (ekspres)": 36,
        "Qəsəbədaxili": 25, "Qəsəbələrarası": 31, "Şəhərlərarası": 40,
    })
    default_cruise_kmh: float = 25
    stop_loss_s: float = 20               # slowing, serving and accelerating (nMotion 2015; WMATA 10-20 s)

    # Fuel and emissions for a 12 m bus, in diesel-equivalent litres. Together these give
    # 43 L/100 km at 2.65 stops/km, matching the Braunschweig test cycle for diesel buses
    # (43.8 L/100 km, VTT 2012); the cost of an extra stop, 0.03-0.07 L, is estimated from VTT's test cycles.
    # CNG buses use about 35% more energy for similar CO2 per km; electric about 1.15 kWh/km.
    fuel_l_per_km: float = 0.30           # steady driving between stops
    fuel_l_per_stop: float = 0.05         # one stop-start cycle
    co2_kg_per_l: float = 2.67            # diesel, tank-to-wheel (IPCC 2006)

    # Demand model used while there is no origin-destination data. Trips start at homes
    # (population) and end at homes or destinations (jobs, schools, shops, metro stations).
    trip_decay_km: float = 6.0            # trips fall off as exp(-distance / this); official average
                                          # bus trip is 15.6 km (2025) but that includes intercity
    max_trip_min: float = 120             # longer door-to-door times count as "not reachable"
    destination_share: float = 0.5        # share of trip ends drawn to destinations rather than homes
    destination_weights: dict = field(default_factory=lambda: {
        "office": 1, "townhall": 3, "courthouse": 3,
        "kindergarten": 1, "school": 3, "college": 5, "university": 10,
        "clinic": 2, "hospital": 8,
        "supermarket": 2, "department_store": 4, "mall": 10, "marketplace": 8,
        "station": 5, "bus_station": 5,
    })
    metro_weight_per_1000_entries: float = 2.0   # weight of a metro station per 1,000 daily entries

    # Redesign search (redesign.py). The fleet stays at today's size; a change is kept only if
    # it shortens average door-to-door time and leaves no more than the allowed number of
    # people without a stop within max_access_walk_m.
    redesign_origins: int = 100                  # trip origins in the search sample
    redesign_seed: int = 11                      # which origins; the final check uses another sample
    redesign_min_gain_min: float = 0.005         # smallest improvement worth keeping, minutes
    redesign_max_straighten: int = 80            # detours to try straightening
    redesign_max_drop: int = 20                  # least-used routes to try dropping
    redesign_max_people_losing_stop: int = 500   # per change
    redesign_max_people_losing_stop_total: int = 3000
    redesign_shift_share: float = 0.2            # share of a route's buses moved in one shift
    redesign_shift_rounds: int = 4
    redesign_protect_boardings: float = 1000     # never drop a route with at least this many counted weekday boardings
    redesign_protected_routes: list = field(default_factory=lambda: ["180"])   # left as they are; 180 (Pirallahı):
                                                 # its connecting routes are missing from the data

    # A GTFS feed instead of the AYNA snapshot ([data] gtfs; see gtfs.py). The feed's timetable
    # then gives each route its headway and its moving speed.
    gtfs_date: str = ""                          # service day to read, YYYY-MM-DD; empty: the weekday with most bus departures
    gtfs_route_types: list = field(default_factory=lambda: [3])   # GTFS route types read: 3 is bus, with the extended
                                                 # bus and coach types; add 11 for trolleybuses, 0 for trams

    # What the redesign is worth (redesign.py, impact.csv). A value left at 0 is unknown, and the
    # rows that need it are left out rather than guessed.
    daily_journeys: float = 0                    # door-to-door bus journeys on a weekday, to turn minutes into hours
    fuel_price: float = 0                        # per diesel-equivalent litre, in currency
    cost_per_bus_hour: float = 0                 # running cost of a bus-hour besides fuel (driver, upkeep), in currency
    value_of_time: float = 0                     # what an hour of riders' time is worth, in currency
    currency: str = ""
    days_per_year: float = 0                     # weekday equivalents in a year, to turn a day into a year

    def cruise_mps(self, zone):
        return self.cruise_kmh.get(zone, self.default_cruise_kmh) / 3.6

    def speed_mps(self, route):
        """A route's moving speed: its own, read from a timetable, or else its zone's."""
        return route.speed_kmh / 3.6 if route.speed_kmh else self.cruise_mps(route.zone)

    @property
    def transfer_penalty_s(self):
        return self.transfer_penalty_min * 60
