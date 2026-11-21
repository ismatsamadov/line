I live in Baku. Like most people here I take buses, and like most people I had opinions about them: routes that wander, buses that run side by side along the same avenue, stops so close together that the bus barely gets going before it brakes again. I wanted to know whether those opinions held up, and by how much the network could do better with the buses it already has. The data to check that properly isn't public. So I built what I could from what is.

## What the tool does

It reads a city's GTFS feed, the open timetable format that most transit agencies publish for journey planners. From it, the tool measures the network the way planners do: how far each route strays from a straight line, how many routes repeat each other, how close the stops are, who lives more than 400 metres from a stop. Then it builds a travel model. People live where Kontur's population grid says they do, and travel to the places OpenStreetMap maps: schools, hospitals, shops, offices, stations. Every trip is routed door to door, with the walk to the stop, the wait, the ride, the changes.

On that model, the tool searches for a better network one step at a time: merging routes that repeat each other, dropping routes that carry few people, straightening detours, moving buses from quiet routes to busy ones. It keeps a change only if the average door-to-door trip gets shorter, and only if it leaves no more than a few hundred people without a stop within walking distance (500 per change, 3,000 in all). Then it checks the result on a different sample of trips than the one it searched on, and works out what the new network is worth: minutes per trip, buses, bus-hours, diesel and CO₂.

It is a few thousand lines of Python with no dependencies beyond the standard library, and everything is open: [https://github.com/ismatsamadov/route_efficiency](https://github.com/ismatsamadov/route_efficiency)

## Baku first

For Baku the tool reads the routes and stops on AYNA's public map, and BakuBus's published passenger counts keep the model honest. With the same 2,015 buses, the redesign makes the average trip about three quarters of a minute shorter. Kept to today's trip times instead, it needs 219 fewer buses, which would save about 26,000 litres of diesel and 71 tonnes of CO₂ every weekday.

That is less than I expected, and that turned out to be the interesting part.

## Then 25 more cities

The same tool runs on any city with an open feed. I took 25 more, on five continents, choosing feeds that their operators or cities publish under licences that allow redistribution: from Riga, Dublin, Cardiff, Sofia, Kyiv and Valencia to Halifax, Québec City, Austin, Kuala Lumpur, Sendai, Christchurch, Addis Ababa and Accra. Every city got the same settings.

With the same buses, the average trip gets shorter in every one of them: by 2.8 minutes in the middle city, from under a minute in Kyiv to more than eight in Trujillo. Kept to today's trip times, the 23 networks published by their operators would need about a fifth fewer buses, saving some 140,000 litres of fuel and 370 tonnes of CO₂ a weekday between them.

Baku, read from its own feed with the same settings as everyone else, lands near the bottom: the search finds less to improve there than in most cities.

## What it cannot tell you

Here is the part that matters most. Outside Baku, no city in the study shares passenger counts in a form the model can use, so demand is modelled, not measured. A route the model thinks is empty may be full of students at 8 a.m. The model also sees buses only: in cities where trams or a metro carry much of the load, it underrates the network. Three of the networks come from OpenStreetMap mapping projects rather than from their operators' timetables, and their numbers are the roughest. Every change the tool proposes is a candidate for a planner to check, not a plan.

What would make the numbers real is simple to say: an operator's counts by route. The method and the code are the same everywhere, so a city that shares its counts gets the treatment Baku has, and I would gladly run it.

## Try it

The write-up, with the table for every city and the list of cities I left out (and why): [https://github.com/ismatsamadov/route_efficiency/blob/8f75662f8c456910cd8708df1f13ec6406ec32f1/docs/world.md](https://github.com/ismatsamadov/route_efficiency/blob/8f75662f8c456910cd8708df1f13ec6406ec32f1/docs/world.md)

The data, as the results were made from it: [https://huggingface.co/datasets/ismatsamadov/route-efficiency-cities](https://huggingface.co/datasets/ismatsamadov/route-efficiency-cities)

Baku's results, for readers who will not open the code: [https://ismatsamadov.github.io/route_efficiency/](https://ismatsamadov.github.io/route_efficiency/)

If you plan bus networks, or work at one of these agencies, I would love to hear where the model is wrong.

---

*Also published on [Medium](https://ismatsamadov.medium.com/i-measured-the-bus-networks-of-26-cities-from-their-open-timetables-aae0aabf710a).*
