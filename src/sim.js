// Synthetic morning routes for the Arrival window demo. Seeded and deterministic.
// Everything here is fictional: district, schools, stops, students and drivers.

export const SEED = 20261110;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// School days: Mon-Fri from Aug 17 2026 through Nov 10 2026, minus Labor Day and Oct 12.
export function schoolDays() {
  const out = [];
  const start = Date.UTC(2026, 7, 17);
  const end = Date.UTC(2026, 10, 10);
  const holidays = new Set([Date.UTC(2026, 8, 7), Date.UTC(2026, 9, 12)]);
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6 || holidays.has(t)) continue;
    out.push(t);
  }
  return out;
}

export const CONSTRUCTION_FROM = Date.UTC(2026, 9, 19); // Oct 19: lane closure on Route 214 between stops 3 and 4

const STREETS = ["Laurel Ave", "Crawford Way", "Bayview Dr", "Sycamore St", "Alder Ct", "Marina Blvd", "Hillcrest Rd", "Juniper St", "Oak Knoll Dr", "Canyon Rd", "Harbor St", "Willow Ln", "Edgewood Ave", "Maple St", "Redwood Ave", "Seaview Ter", "Cypress Way", "Linden Ave"];

// Routes: [name, school, bell (minutes after midnight), stops]
function buildRoutes(rng) {
  const defs = [
    ["214", "Bayview Middle School", 8 * 60 + 30, 9],
    ["201", "Anza Elementary School", 8 * 60 + 40, 7],
    ["207", "Bayview Middle School", 8 * 60 + 30, 10],
    ["219", "Harbor Elementary School", 8 * 60 + 35, 8],
    ["226", "Anza Elementary School", 8 * 60 + 40, 6],
    ["233", "Harbor Elementary School", 8 * 60 + 35, 9],
  ];
  return defs.map(([name, school, bell, nStops], ri) => {
    const seg = []; // scheduled minutes from stop k-1 to stop k (k=0 is from the yard to stop 1)
    const students = [];
    for (let k = 0; k <= nStops; k++) {
      seg.push(k === 0 ? 9 + 4 * rng() : k === nStops ? 6 + 4 * rng() : 2.2 + 3.2 * rng());
      if (k < nStops) students.push(1 + Math.floor(rng() * 5));
    }
    // last element: last stop -> school
    // schedules are built from typical (not ideal) leg and boarding times
    const total = seg.reduce((a, b) => a + 1.035 * b + 0.1, 0) + students.reduce((a, n) => a + 0.42 + 0.19 * n, 0);
    const start = bell - 10 - total; // planned to reach school 10 minutes before the bell
    const sched = [];
    let t = start + 1.035 * seg[0] + 0.1;
    for (let k = 0; k < nStops; k++) {
      sched.push(t);
      t += 0.42 + 0.19 * students[k] + 1.035 * seg[k + 1] + 0.1;
    }
    const stops = sched.map((s, k) => ({
      idx: k,
      name: `${100 + Math.floor(rng() * 800)} ${STREETS[(ri * 5 + k * 3) % STREETS.length]}`,
      sched: s,
      students: students[k],
    }));
    stops.push({ idx: nStops, name: school, sched: t, students: 0, school: true }); // drop-off at school
    return { id: "r" + name, name, school, bell, start, seg, stops, nPickups: nStops };
  });
}

// Simulate actual stop arrival times (minutes after midnight) for every route and day.
export function simulate(seed = SEED) {
  const rng = mulberry32(seed);
  const routes = buildRoutes(rng);
  const days = schoolDays();
  const runs = []; // {day, dayIdx, route, rain, sub, arrivals:[...], schoolArr}
  days.forEach((day, di) => {
    const rain = rng() < 0.16; // rainy mornings (known from the forecast before routes start)
    const traffic = Math.exp(0.06 * normal(rng)) * (rain ? 1.13 : 1);
    const early = di < 10; // first two weeks: new riders, longer and more variable boarding
    for (const r of routes) {
      const sub = rng() < 0.05; // substitute driver
      let t = r.start + Math.max(-1, 0.4 + 1.4 * normal(rng)) + (sub ? 3 + 2 * rng() : 0) + (rain ? 0.8 : 0);
      const arrivals = [];
      for (let k = 0; k <= r.nPickups; k++) {
        let travel = r.seg[k] * traffic * Math.exp(0.15 * normal(rng) + (rain ? 0.1 * normal(rng) : 0));
        if (rng() < (rain ? 0.07 : 0.03)) travel += 1 + 3 * rng(); // a train, a double-parked truck, a missed light cycle
        if (r.name === "214" && k === 3 && day >= CONSTRUCTION_FROM) travel += 2.6 + 1.2 * Math.abs(normal(rng));
        t += travel;
        arrivals.push(t);
        if (k === r.nPickups) break; // arrived at school
        const n = r.stops[k].students;
        const dwell = 0.4 + 0.15 * n + (early ? 0.35 + 0.45 * Math.abs(normal(rng)) : 0) + 0.15 * Math.abs(normal(rng)) * n / 3;
        t = Math.max(t + dwell, r.stops[k].sched - 1); // drivers hold rather than leave a stop more than a minute early
      }
      runs.push({ day, dayIdx: di, route: r.id, rain, sub, arrivals });
    }
  });
  return { routes, days, runs };
}

// The point ETA a live system would show (a stand-in for Zum's model). It learns from the previous
// 15 school days of the same route: mean time from the scheduled start to each stop, and mean time
// between stops. Predictions are issued 10 minutes before the scheduled start (pre-trip, when
// parents check the app) and again each time the bus leaves a stop; after a stop it scales the
// remaining legs by today's pace so far (shrunk halfway toward 1).
// Returns rows {route, dayIdx, day, rain, stop, issuedAt, eta, actual, lead, sched}.
export function pointEtas(sim, { lookback = 15 } = {}) {
  const byRoute = {};
  for (const run of sim.runs) (byRoute[run.route] ||= []).push(run);
  const rows = [];
  for (const r of sim.routes) {
    const rr = byRoute[r.id];
    const n = r.stops.length;
    for (let i = 0; i < rr.length; i++) {
      const run = rr[i];
      const hist = rr.slice(Math.max(0, i - lookback), i);
      const fromStart = (k) => (hist.length ? hist.reduce((a, h) => a + h.arrivals[k] - r.start, 0) / hist.length : r.stops[k].sched - r.start + 0.6);
      const between = (j, k) => fromStart(k) - fromStart(j);
      const push = (stop, issuedAt, eta) =>
        rows.push({ route: r.id, dayIdx: run.dayIdx, day: run.day, rain: run.rain, stop, issuedAt, eta, actual: run.arrivals[stop], lead: eta - issuedAt, sched: r.stops[stop].sched });
      // pre-trip
      const pre = r.start - 10;
      for (let k = 0; k < n; k++) push(k, pre, r.start + fromStart(k));
      // after each stop
      for (let j = 0; j < n - 1; j++) {
        const issuedAt = run.arrivals[j] + 0.4 + 0.15 * r.stops[j].students; // leaves stop j
        let pace = 1;
        if (j >= 1) {
          const expect = between(0, j);
          if (expect > 0) pace = 1 + 0.5 * ((run.arrivals[j] - run.arrivals[0]) / expect - 1);
        }
        for (let k = j + 1; k < n; k++) push(k, issuedAt, run.arrivals[j] + pace * between(j, k));
      }
    }
  }
  rows.sort((a, b) => a.dayIdx - b.dayIdx || a.issuedAt - b.issuedAt);
  return rows;
}

export function fmtTime(min) {
  const m = Math.round(min);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}
