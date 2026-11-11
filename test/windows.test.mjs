import test from "node:test";
import assert from "node:assert/strict";
import { simulate, pointEtas, mulberry32, normal, CONSTRUCTION_FROM } from "../src/sim.js";
import { lowerQ, upperQ, iqrScale, bucketOf, buildWindows, evaluate, evaluateStopTime, evaluateLate } from "../src/windows.js";

const sim = simulate();
const rows = pointEtas(sim);
const win = buildWindows(rows, sim.routes);

test("simulator is deterministic and the schedule is sane", () => {
  const again = simulate();
  assert.deepEqual(again.runs.slice(0, 20), sim.runs.slice(0, 20));
  assert.equal(sim.days.length, 60);
  for (const r of sim.routes) for (let k = 1; k < r.stops.length; k++) assert.ok(r.stops[k].sched > r.stops[k - 1].sched);
  const late = sim.runs.filter((x) => x.arrivals.at(-1) > sim.routes.find((r) => r.id === x.route).bell).length / sim.runs.length;
  assert.ok(late > 0.02 && late < 0.15, "late share " + late);
  assert.equal(rows.length, 17100);
});

test("conformal quantiles use the finite-sample index", () => {
  const s = Array.from({ length: 19 }, (_, i) => i + 1); // n = 19, (n+1) = 20
  assert.equal(upperQ(s, 0.05), 19); // ceil(0.95*20) = 19th smallest
  assert.equal(upperQ(s, 0.1), 18);
  assert.equal(lowerQ(s, 0.05), 1);
  assert.equal(lowerQ(s, 0.1), 2);
  assert.equal(bucketOf(3.9), 0);
  assert.equal(bucketOf(30), 4);
  assert.ok(Math.abs(iqrScale(Array.from({ length: 4001 }, (_, i) => normal(mulberry32(i)))) - 1) < 0.1);
});

test("split conformal covers at least 1 - alpha on exchangeable data", () => {
  const rng = mulberry32(42);
  let hit = 0;
  const trials = 3000;
  for (let t = 0; t < trials; t++) {
    const cal = Array.from({ length: 49 }, () => normal(rng) * (1 + rng())).sort((a, b) => a - b);
    const y = normal(rng) * (1 + rng());
    if (y >= lowerQ(cal, 0.05) && y <= upperQ(cal, 0.05)) hit++;
  }
  const cov = hit / trials;
  assert.ok(cov >= 0.88 && cov <= 0.95, "coverage " + cov); // theory: >= 0.90, <= 0.90 + 2/(n+1)
});

test("arrival windows hit the 90% target where a fixed band does not", () => {
  const ev = evaluate(win);
  assert.ok(ev.n > 12000);
  assert.ok(Math.abs(ev.window.coverage - 0.9) < 0.015, "coverage " + ev.window.coverage);
  assert.ok(ev.band.coverage < 0.75);
  assert.ok(ev.static.width > ev.window.width, "one-time calibration is wider");
  const rain = evaluate(win, { filter: (r) => r.rain });
  assert.ok(rain.window.coverage > 0.86 && rain.window.width > ev.window.width);
});

test("adaptive levels recover coverage after the lane closure", () => {
  const off = buildWindows(rows, sim.routes, { aci: false });
  const cIdx = sim.days.findIndex((d) => d >= CONSTRUCTION_FROM);
  const f = (r) => r.route === "r214" && r.stop >= 4 && r.dayIdx >= cIdx && r.dayIdx < cIdx + 10;
  const on = evaluate(win, { filter: f }).window.coverage;
  const no = evaluate(off, { filter: f }).window.coverage;
  assert.ok(on > no, `${on} vs ${no}`);
});

test("be-at-the-stop time: rare misses, much less waiting than the 5-minute rule", () => {
  const st = evaluateStopTime(win, sim.routes);
  assert.ok(st.byStop.miss < 0.02, "miss " + st.byStop.miss);
  assert.ok(st.byStop.wait < st.fiveEarly.wait - 1.5);
  assert.ok(st.etaMinus2.miss > 5 * st.byStop.miss);
});

test("late-to-bell probabilities beat a late-if-ETA-past-bell flag and are valid probabilities", () => {
  const late = evaluateLate(win, sim.routes);
  assert.ok(late.brier < late.brierFlag);
  for (const r of win.rows) if (r.pLate !== undefined) assert.ok(r.pLate > 0 && r.pLate <= 1);
  assert.ok(Math.abs(late.bins[0].predicted - late.bins[0].observed) < 0.02);
});

test("windows are ordered and the be-at-stop time sits at or below the window", () => {
  for (const r of win.rows) {
    if (r.lo === undefined) continue;
    assert.ok(r.lo <= r.hi);
    assert.ok(r.byStop <= r.lo + 1e-9);
  }
});
