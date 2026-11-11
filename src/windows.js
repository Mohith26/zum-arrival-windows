// Arrival windows: calibrated ranges around a point ETA, a "be at the stop by" time and a
// late-to-bell probability, all from conformal prediction on the ETA's own past errors.
//
// For each prediction we know the point ETA, the predicted lead time (ETA - now), the route and
// whether it is raining. Day by day:
//  1. Scale: robust spread (IQR / 1.349) of the last 40 days' residuals for the lead-time bucket,
//     separately for rainy and dry mornings, so a rainy 20-minute-out prediction gets a wider window.
//  2. Scores: residual / scale for the last 10 school days in the same route x lead bucket
//     (Mondrian conformal), falling back to all routes when a stratum is thin.
//  3. Window = ETA + scale x [lower, upper] conformal quantiles of those scores; "be at the stop
//     by" = ETA + scale x a 1% lower quantile; P(late to bell) = conformal predictive tail.
//  4. Adaptive conformal inference (Gibbs and Candes, 2021): after each day's outcomes, each
//     stratum's miscoverage levels move by gamma x (target - miss), so coverage recovers when
//     something changes (a lane closure, the first weeks of school) instead of staying broken.

export const BUCKETS = [0, 4, 8, 14, 22, Infinity];
export const BUCKET_LABELS = ["<4 min", "4-8 min", "8-14 min", "14-22 min", "22+ min"];
export function bucketOf(lead) {
  for (let i = 0; i < BUCKETS.length - 1; i++) if (lead < BUCKETS[i + 1]) return i;
  return BUCKETS.length - 2;
}

// Split-conformal quantiles with the finite-sample correction.
// (Indices are clamped to the sample, so a level below 1/(n+1) returns the extreme score instead
// of an infinite bound; the demo always has n >= 40.)
export function lowerQ(sorted, beta) {
  const n = sorted.length;
  const k = Math.floor(beta * (n + 1));
  return sorted[Math.min(Math.max(k, 1), n) - 1];
}
export function upperQ(sorted, beta) {
  const n = sorted.length;
  const k = Math.ceil((1 - beta) * (n + 1));
  return sorted[Math.min(Math.max(k, 1), n) - 1];
}
export function iqrScale(xs) {
  if (xs.length < 8) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.floor(p * (s.length - 1))];
  return Math.max(0.25, (q(0.75) - q(0.25)) / 1.349);
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function buildWindows(rows, routes, opts = {}) {
  const { alpha = 0.1, early = 0.01, gamma = 0.004, windowDays = 10, minN = 40, staticDays = 15, band = 2, aci = true, strata = "bucket", scaleDays = 40 } = opts;
  const keyOf = (r, b) => (strata === "stop" ? r.route + "|s" + r.stop : r.route + "|" + b);
  const bell = Object.fromEntries(routes.map((r) => [r.id, r.bell]));
  const schoolStop = Object.fromEntries(routes.map((r) => [r.id, r.stops.length - 1]));
  const byDay = [];
  for (const r of rows) (byDay[r.dayIdx] ||= []).push(r);
  const nDays = byDay.length;

  // static calibration: residual quantiles per lead bucket from the first `staticDays` days
  const stat = BUCKET_LABELS.map((_, b) => {
    const res = rows.filter((r) => r.dayIdx < staticDays && bucketOf(r.lead) === b).map((r) => r.actual - r.eta).sort((x, y) => x - y);
    return { lo: lowerQ(res, alpha / 2), hi: upperQ(res, alpha / 2), early: lowerQ(res, early) };
  });

  const levels = {}; // stratum -> {lo, hi, e}
  const out = [];
  const levelTrace = [];
  for (let d = 0; d < nDays; d++) {
    const today = byDay[d] || [];
    const hist = [];
    for (let h = Math.max(0, d - windowDays); h < d; h++) if (byDay[h]) hist.push(...byDay[h]);
    const histScale = [];
    for (let h = Math.max(0, d - scaleDays); h < d; h++) if (byDay[h]) histScale.push(...byDay[h]);
    // 1. scales per bucket x rain (fallback: bucket only, then 1.5 min)
    const scale = {};
    for (let b = 0; b < BUCKET_LABELS.length; b++) {
      const all = histScale.filter((r) => bucketOf(r.lead) === b).map((r) => r.actual - r.eta);
      for (const rain of [false, true]) {
        const sub = histScale.filter((r) => bucketOf(r.lead) === b && r.rain === rain).map((r) => r.actual - r.eta);
        scale[b + "|" + rain] = iqrScale(sub.length >= 30 ? sub : all) || 1.5;
      }
    }
    // 2. scores per stratum (route x bucket) and pooled per bucket
    const scores = {};
    const pooled = {};
    for (const r of hist) {
      const b = bucketOf(r.lead);
      const s = (r.actual - r.eta) / scale[b + "|" + r.rain];
      (scores[keyOf(r, b)] ||= []).push(s);
      (pooled[b] ||= []).push(s);
    }
    for (const k in scores) scores[k].sort((a, b) => a - b);
    for (const k in pooled) pooled[k].sort((a, b) => a - b);

    for (const r of today) {
      const b = bucketOf(r.lead);
      const key = keyOf(r, b);
      const lv = (levels[key] ||= { lo: alpha / 2, hi: alpha / 2, e: early });
      const S = scores[key] && scores[key].length >= minN ? scores[key] : pooled[b] || [];
      const sc = scale[b + "|" + r.rain];
      const res = r.actual - r.eta;
      const row = { ...r, bucket: b, resid: res, n: S.length };
      if (S.length >= minN) {
        row.lo = r.eta + sc * lowerQ(S, lv.lo);
        row.hi = r.eta + sc * upperQ(S, lv.hi);
        row.byStop = r.eta + sc * lowerQ(S, lv.e);
        if (r.stop === schoolStop[r.route]) {
          const z = (bell[r.route] - r.eta) / sc;
          let c = 0;
          for (let i = S.length - 1; i >= 0 && S[i] >= z; i--) c++;
          row.pLate = (c + 1) / (S.length + 1);
        }
      }
      row.staticLo = r.eta + stat[b].lo;
      row.staticHi = r.eta + stat[b].hi;
      row.staticEarly = r.eta + stat[b].early;
      row.bandLo = r.eta - band;
      row.bandHi = r.eta + band;
      out.push(row);
    }
    // 4. ACI update with today's outcomes (feedback arrives after the morning run)
    if (aci) {
      const todayRows = out.filter((x) => x.dayIdx === d && x.lo !== undefined).sort((a, b) => a.issuedAt - b.issuedAt);
      for (const x of todayRows) {
        const lv = levels[keyOf(x, x.bucket)];
        lv.lo = clamp(lv.lo + gamma * (alpha / 2 - (x.actual < x.lo ? 1 : 0)), 0.002, 0.3);
        lv.hi = clamp(lv.hi + gamma * (alpha / 2 - (x.actual > x.hi ? 1 : 0)), 0.002, 0.3);
        lv.e = clamp(lv.e + gamma * (early - (x.actual < x.byStop ? 1 : 0)), 0.002, 0.2);
      }
    }
    levelTrace.push(JSON.parse(JSON.stringify(levels)));
  }
  return { rows: out, levelTrace, opts: { alpha, early, gamma, windowDays, minN, staticDays, band } };
}

// Coverage / width / be-at-stop evaluation on test days (dayIdx >= fromDay).
export function evaluate(win, { fromDay = 15, filter = () => true } = {}) {
  const T = win.rows.filter((r) => r.dayIdx >= fromDay && r.lo !== undefined && filter(r));
  const cov = (lo, hi) => T.filter((r) => r.actual >= r[lo] && r.actual <= r[hi]).length / T.length;
  const width = (lo, hi) => T.reduce((a, r) => a + (r[hi] - r[lo]), 0) / T.length;
  return {
    n: T.length,
    window: { coverage: cov("lo", "hi"), width: width("lo", "hi") },
    static: { coverage: cov("staticLo", "staticHi"), width: width("staticLo", "staticHi") },
    band: { coverage: cov("bandLo", "bandHi"), width: width("bandLo", "bandHi") },
  };
}

// "Be at the stop by" vs. two rules of thumb, judged on the prediction a parent sees when deciding
// to leave home (lead 8-22 minutes) for pickup stops. A miss = the bus reached the stop first.
export function evaluateStopTime(win, routes, { fromDay = 15 } = {}) {
  const school = Object.fromEntries(routes.map((r) => [r.id, r.stops.length - 1]));
  const T = win.rows.filter((r) => r.dayIdx >= fromDay && r.byStop !== undefined && r.stop !== school[r.route] && r.lead >= 8 && r.lead < 22);
  const rule = (f) => {
    let miss = 0;
    let wait = 0;
    let nw = 0;
    for (const r of T) {
      const t = f(r);
      if (r.actual < t) miss++;
      else {
        wait += r.actual - t;
        nw++;
      }
    }
    return { miss: miss / T.length, wait: wait / nw };
  };
  return {
    n: T.length,
    byStop: rule((r) => r.byStop),
    fiveEarly: rule((r) => r.sched - 5),
    etaMinus2: rule((r) => r.eta - 2),
    staticEarly: rule((r) => r.staticEarly),
  };
}

// Weekly coverage series for the chart.
export function weekly(win, days, { filter = () => true } = {}) {
  const weeks = {};
  for (const r of win.rows) {
    if (r.lo === undefined || !filter(r)) continue;
    const wk = Math.floor(r.dayIdx / 5);
    const w = (weeks[wk] ||= { wk, n: 0, win: 0, stat: 0, band: 0, start: days[wk * 5] });
    w.n++;
    if (r.actual >= r.lo && r.actual <= r.hi) w.win++;
    if (r.actual >= r.staticLo && r.actual <= r.staticHi) w.stat++;
    if (r.actual >= r.bandLo && r.actual <= r.bandHi) w.band++;
  }
  return Object.values(weeks).map((w) => ({ wk: w.wk, start: w.start, n: w.n, window: w.win / w.n, static: w.stat / w.n, band: w.band / w.n }));
}

// Late-to-bell probabilities: reliability bins and Brier score vs. a "late if ETA > bell" flag.
export function evaluateLate(win, routes, { fromDay = 15 } = {}) {
  const bell = Object.fromEntries(routes.map((r) => [r.id, r.bell]));
  const T = win.rows.filter((r) => r.dayIdx >= fromDay && r.pLate !== undefined);
  const y = (r) => (r.actual > bell[r.route] ? 1 : 0);
  const brier = T.reduce((a, r) => a + (r.pLate - y(r)) ** 2, 0) / T.length;
  const brierFlag = T.reduce((a, r) => a + ((r.eta > bell[r.route] ? 1 : 0) - y(r)) ** 2, 0) / T.length;
  const bins = [[0, 0.1], [0.1, 0.3], [0.3, 0.6], [0.6, 1.01]].map(([a, b]) => {
    const c = T.filter((r) => r.pLate >= a && r.pLate < b);
    return { range: [a, b], n: c.length, predicted: c.length ? c.reduce((s, r) => s + r.pLate, 0) / c.length : null, observed: c.length ? c.reduce((s, r) => s + y(r), 0) / c.length : null };
  });
  return { n: T.length, brier, brierFlag, bins, lateRate: T.reduce((a, r) => a + y(r), 0) / T.length };
}
