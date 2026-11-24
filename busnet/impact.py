# SPDX-FileCopyrightText: 2026 Ismat Samadov
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""What a redesign is worth, in the units riders and operators count: minutes per trip,
people near a stop, buses, bus-hours, bus-km, fuel and CO2 a day, and money where the
settings give prices. redesign.py writes the rows to impact.csv and summary.json.

There are two ways to take the gain, both measured on the same independent sample of
trips: the same buses running the redesigned network (trips get shorter), or the
redesigned network with the fleet scaled down until the average trip is no longer than
today's (fewer buses, less fuel). Every figure comes from the model, so read the changes
as estimates for comparing networks, not as a forecast. A row that needs a value the
settings leave at 0 (journeys a day, prices, days a year) is left out rather than guessed."""

COLUMNS = ("measure", "unit", "today", "same_buses", "same_buses_change", "fewer_buses", "fewer_buses_change")


def capped_minutes(acc, a):
    """Average door-to-door minutes, counting trips that cannot be made in time at the limit."""
    r = acc["share_reachable"]
    return r * acc["mean_door_to_door_min"] + (1 - r) * a.max_trip_min


def impact_rows(today, same_buses, fewer_buses, a):
    """Rows of impact.csv from three network summaries on one sample (metrics.network_summary,
    with accessibility and operations): today's network, the redesign with today's buses,
    and the redesign with the fleet that keeps today's average trip. A change is the value
    after less today's, so a saving is negative."""
    nets = (today, same_buses, fewer_buses)
    acc = [n["accessibility"] for n in nets]
    ops = [n["operations"] for n in nets]
    minutes = [capped_minutes(x, a) for x in acc]
    money = a.currency or "currency"
    rows = []

    def add(measure, unit, values):
        t, s, f = values
        rows.append(dict(zip(COLUMNS, (measure, unit, t, s, s - t, f, f - t))))

    add(f"Average door-to-door trip, impossible trips counted at {a.max_trip_min:g} min", "min", minutes)
    add("Average door-to-door trip, possible trips only", "min", [x["mean_door_to_door_min"] for x in acc])
    add("Trips possible within 45 min", "share", [x["share_within_45_min"] for x in acc])
    add(f"Trips possible within {a.max_trip_min:g} min", "share", [x["share_reachable"] for x in acc])
    add(f"People with a stop within {a.coverage_radius_m:g} m", "people",
        [n["population_within_coverage_radius"] for n in nets])
    add("Buses in service", "buses", [o["fleet"] for o in ops])
    add("Bus-hours a day", "h", [o["bus_hours_per_day"] for o in ops])
    add("Bus-km a day", "km", [o["bus_km_per_day"] for o in ops])
    add("Fuel a day", "L", [o["fuel_l_per_day"] for o in ops])
    add("CO2 a day", "t", [o["co2_t_per_day"] for o in ops])
    add("Riders' time per 100,000 journeys", "h", [m * 100_000 / 60 for m in minutes])

    daily = []                                   # (measure, unit, values) that also make sense a year
    daily.append(("Fuel", "L", [o["fuel_l_per_day"] for o in ops]))
    daily.append(("CO2", "t", [o["co2_t_per_day"] for o in ops]))
    if a.daily_journeys:
        hours = [m * a.daily_journeys / 60 for m in minutes]
        add("Riders' time a day", "h", hours)
        daily.append(("Riders' time", "h", hours))
        if a.value_of_time:
            value = [h * a.value_of_time for h in hours]
            add("Value of riders' time a day", money, value)
            daily.append(("Value of riders' time", money, value))
    if a.fuel_price:
        cost = [o["fuel_l_per_day"] * a.fuel_price for o in ops]
        add("Fuel cost a day", money, cost)
        daily.append(("Fuel cost", money, cost))
    if a.cost_per_bus_hour:
        cost = [o["bus_hours_per_day"] * a.cost_per_bus_hour for o in ops]
        add("Running cost a day, besides fuel", money, cost)
        daily.append(("Running cost besides fuel", money, cost))
    if a.days_per_year:
        for measure, unit, values in daily:
            add(f"{measure} a year", unit, [v * a.days_per_year for v in values])
    return rows
