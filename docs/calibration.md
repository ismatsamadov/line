# Fitting the demand model to the counts

The demand model is the weakest part of the work. It spreads each origin's trips over the
city by population, destinations and distance, and its only check is how well the
boardings it gives the 56 counted BakuBus routes rank against the counts. The roadmap
proposed fitting its settings to those counts, keeping some routes aside so that the fit
is not judged on the data it was tuned to. `python3 calibrate.py` does that, in about
twenty-five minutes, and writes `output/calibration/`
([outputs.md](outputs.md#outputcalibration--the-demand-model-fitted-to-the-counted-boardings)).
The answer is more a warning than an improvement.

## The fit today is 0.53, not 0.58

The fit I have quoted, a rank correlation (Spearman) of 0.58, comes from robustness.py's
fit ladder, which samples 300 trip origins once, and samples differ. Over five samples of
2,000 origins, which move the fit far less, the same settings give 0.53 ± 0.01. 0.58 was a
lucky sample; the model's fit at today's settings is about 0.53. Everything below uses
samples of 2,000 origins, with headways that do not come from the counts, as the fair step
of the fit ladder does.

## The search

Three settings shape the demand: how fast trips fall off with distance (`trip_decay_km`,
today 6 km), how much destinations pull trips compared with homes (`destination_share`,
today 0.5), and how much a metro station weighs for every 1,000 daily entries
(`metro_weight_per_1000_entries`, today 2). I tried 420 combinations: fall-offs from 1 to
30 km, shares from 0 to 1, metro weights from 0 to 8. Finding every trip's path is the
slow part of the model and does not depend on these settings, so `busnet/calibration.py`
finds the paths once and spreads the trips again for each setting; a test holds it to
exactly the boardings and trip lengths `metrics.evaluate_od` gives.

The best setting on all 56 routes ranks them at 0.67, with trips falling off over 1.5 km.
That is the fit on the routes it was chosen on, so I cross-validated it: the routes are
split into five folds, the setting is chosen on four and predicts the fifth, two hundred
times over. Chosen that way, the fit on routes the choice never saw is 0.62 ± 0.02, and on
three fresh samples of origins the setting chosen most often ranks the routes at 0.64 to
0.66 against 0.52 to 0.56 for today's settings.

## Why I keep today's settings

That setting fits the counts by making trips short: its trips average 2.7 km in a straight
line, against 8.4 km at today's settings, so that many of them are short enough to walk.
The State Statistical Committee puts the average bus passenger's trip in Azerbaijan at
15.6 km along the road in 2025. That figure covers intercity buses too, so Baku's city
trips are shorter; but a model whose trips are a third as long as today's is hard to
square with it. The counts reward a model that keeps trips near home, where the routes
with the most boardings run, and they cannot tell how far people ride.

So the honest question is how much a realistic trip length costs. Choosing only among
settings whose trips are at least a given length, and cross-validating as before:

| Least average trip, straight line | Settings | Fit on held-out routes | Setting chosen most | Its trips |
|---|---|---|---|---|
| none | 420 | 0.62 ± 0.02 | 1.5 km fall-off, share 0.75, metro 0 | 2.7 km |
| 2 km | 386 | 0.63 ± 0.02 | 1.5 km fall-off, share 0.75, metro 0 | 2.7 km |
| 3 km | 350 | 0.64 ± 0.02 | 2 km fall-off, share 0.5, metro 0 | 3.4 km |
| 4 km | 315 | 0.63 ± 0.01 | 3 km fall-off, share 0.6, metro 8 | 5.0 km |
| 5 km | 290 | 0.63 ± 0.01 | 3 km fall-off, share 0.6, metro 8 | 5.0 km |
| 6 km | 280 | 0.58 ± 0.01 | 4 km fall-off, share 1, metro 0 | 6.5 km |
| 7 km | 245 | 0.55 ± 0.01 | 5 km fall-off, share 1, metro 0 | 7.6 km |
| 8 km | 210 | 0.52 ± 0.01 | 6 km fall-off, share 0.5, metro 1 | 8.4 km |
| 8.4 km (today's) | 194 | 0.52 ± 0.01 | 6 km fall-off, share 0.5, metro 2 | 8.4 km |

Among settings whose trips are as long as today's, today's settings are the ones chosen
most, and the fit stays where it is. The fit rises only as the trips allowed get shorter:
to about 0.63 with trips of 5 km in a straight line, perhaps 6 to 7 km by road, where
trips fall off over 3 km and metro stations weigh four times today's. Whether that is
better depends on a number nobody publishes for Baku: how far its bus passengers ride.

## What it means

The settings are not where most of the model's error lies, unless Baku's bus trips are far
shorter than the national figure suggests. Keeping trips as long as today's, no setting
ranks the counted routes better; allowing trips of 5 km in a straight line, a 3 km
fall-off with heavier metro stations reaches 0.63 on routes it was not fitted to. I keep
today's settings, so the results do not change, and keep that alternative for when Baku's
trip length is known.

Three things would settle it. An average trip length for Baku's buses, from BakıKart's
card records or a household survey, would fix the fall-off directly instead of leaving it
to the counts. Counts by stop or by hour would test where the trips go, which counts by
route cannot. And a doubly constrained gravity model, which makes each zone receive the
trips its destinations attract, is still to try. Until then the fair figure to quote for
the demand model is about 0.53.
