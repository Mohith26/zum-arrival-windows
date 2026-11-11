# Arrival windows (concept for Zum)

**Live demo:** https://mohith26.github.io/zum-arrival-windows/ (drag the morning playback slider; add `#method` for the evaluation)

An unofficial concept feature for the Zum parent app and the Zum School Administrators app. Every
ETA gets a calibrated range ("Likely 7:54-8:01 AM"), families get a **Be at the stop by** time,
and school staff get a **chance the bus arrives after the bell**. All three come from conformal
prediction on the ETA's own recent errors, so the ranges mean what they say: about 9 in 10
arrivals land inside.

Unofficial concept demo by Mohith Gajjela. Not affiliated with Zum. Synthetic data: the district,
routes, students and drivers are fictional.

## Why

The Zum app shows a single AI-powered ETA per stop. A single number can't tell a parent how early
to walk out, so families fall back on rules like "be at the stop 5 minutes before the scheduled
time" (several districts publish exactly that). That rule wastes minutes on most mornings and
still fails when the bus runs early; "2 minutes before the ETA" misses the bus about 1 morning in
9 in this demo. Schools see "Delayed by 6 mins" but not whether that means a late arrival to class.

## How it works

`src/windows.js`, no dependencies. The point ETA is left alone; the method wraps whatever ETA the
app already shows (here a simple stand-in, `pointEtas` in `src/sim.js`).

1. **Residuals.** For every past prediction: error = actual arrival - ETA, plus its predicted
   lead time (ETA - when it was issued), route, and whether it was raining.
2. **Scale.** Robust spread (IQR / 1.349) of the last 40 school days' errors per lead-time bucket
   (<4, 4-8, 8-14, 14-22, 22+ minutes), separately for rainy and dry mornings.
3. **Mondrian split conformal.** Scaled errors from the last 10 school days for the same route and
   lead bucket (falling back to all routes under 40 points). Window = ETA + scale x [the
   finite-sample 5% and 95% conformal quantiles]. "Be at the stop by" = ETA + scale x the 1% lower
   quantile. P(after bell) = (1 + #scores past the bell) / (n + 1) for the school-arrival ETA.
4. **Adaptive conformal inference** (Gibbs and Candes, 2021). After each morning, each stratum's
   miscoverage levels move by gamma x (target - miss), gamma = 0.004, so a route that starts
   missing (a lane closure) widens until it is back on target.

## What the demo shows (`node scripts/report.mjs` prints every number)

6 routes, 60 school days (Aug 17 - Nov 10, 2026), 17,100 ETA predictions issued before each trip
and after every stop. Held-out mornings Sep 8 - Nov 10 (12,825 predictions):

| | Coverage | Avg width |
|---|---|---|
| **Arrival window** | **90.0%** | 8.3 min |
| ETA +/- 2 min | 67.3% | 4.0 min |
| One-time calibration (first 3 weeks, by lead time) | 95.9% | 10.1 min |
| Arrival window, rainy mornings | 93.0% | 11.3 min |
| Arrival window, Route 214 past the lane closure, first 2 weeks | 84.7% | 13.0 min |

**Be at the stop by** (predictions 8-22 minutes out, 3,912 pickups): the bus came first 1.1% of
the time and families waited 4.0 minutes on average. "5 min before scheduled": 0.0% and 6.4 min.
"2 min before the ETA": 10.8% and 2.4 min.

**Late to bell** (2,475 school-arrival predictions, 4.7% actually late): Brier 0.036 vs 0.044
for "late if the ETA is past the bell". Well calibrated below 30%; overconfident in the top bin
(predicted 85%, observed 56%, n = 75).

Today in the demo (Tue Nov 10, 7:44 AM): Route 214 is 4 minutes behind because of the lane
closure; the family's stop shows ETA 7:56, likely 7:54-8:01, be at the stop by 7:53. The bus
arrives at 7:57.

## Tests

`node --test test/windows.test.mjs` (8 tests, under a second): deterministic simulator and sane
schedule; finite-sample conformal indices; split conformal covers 88-95% on exchangeable data
(theory: at least 90%); demo coverage within 1.5 points of 90% while the fixed band is under 75%;
adaptive levels beat non-adaptive ones right after the lane closure; be-at-stop misses under 2%
with at least 1.5 minutes less waiting than the 5-minute rule; late-to-bell Brier beats the
ETA-past-bell flag; windows are ordered and the be-at-stop time sits at or below the window.

## Honest limitations

- Synthetic data. The simulator has start delays, rain, random hold-ups, slower boarding in the
  first two weeks, substitute drivers, a lane closure and drivers holding at early stops; real GPS
  data will have failure modes it doesn't (dead zones, detours, stale pings).
- Coverage is marginal: 90% over all mornings, not for every stop on every day. Mornings are
  correlated, so a bad week can sit below target (the chart shows it).
- Right after a sudden change, coverage dips (84.7% for two weeks after the lane closure) before the
  adaptive levels catch up. A detour flag from dispatch would fix that faster than learning it.
- Late-to-bell is overconfident above 30% in this demo; a real version should recalibrate it
  (e.g. isotonic on held-out mornings) before showing big numbers.
- The point ETA is a simple stand-in; Zum's ETA is better, which should make the windows narrower.
- The map is drawn locally in the Mapbox-light style; the app uses Mapbox. Kid and driver photos
  are replaced with initials and an illustration. Page chrome uses Inter in place of Zum's
  licensed Spezia.

## Novelty

Zum's FAQ, parents page, CMX pages, app store listings (parent, rider, school administrator, driver
apps), blog (Route Explorer update, 2025 results, TPG announcement, LAUSD expansion) describe
AI-powered point ETAs, delay notifications and "driver arriving" alerts; none shows a range,
a be-at-the-stop time or a late-to-bell probability. Stopfinder (Transfinder), Here Comes the Bus
and Edulog Parent Portal offer ETAs and geofence alerts, also without calibrated ranges.

## Files

- `index.html`, `styles.css`, `app.js`: the demo (no build step; Inter from Google Fonts).
- `src/sim.js`: seeded simulator (seed 20261110) and the stand-in point ETA.
- `src/windows.js`: conformal windows, ACI, evaluation.
- `scripts/report.mjs`: prints every number above.
- `assets/zum-logo.svg`: Zum's logo, used in the page header since the demo is addressed to Zum.
