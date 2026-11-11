import { simulate, pointEtas, fmtTime, mulberry32, CONSTRUCTION_FROM } from "./src/sim.js";
import { buildWindows, evaluate, evaluateStopTime, evaluateLate, weekly } from "./src/windows.js";

const sim = simulate();
const rows = pointEtas(sim);
const win = buildWindows(rows, sim.routes);
const today = sim.days.length - 1;
const route = sim.routes.find((r) => r.id === "r214");
const FAMILY_STOP = 4;
const SCHOOL_STOP = route.stops.length - 1;
const run = sim.runs.find((r) => r.route === route.id && r.dayIdx === today);
const todayRows = win.rows.filter((r) => r.dayIdx === today);
const T0 = route.start - 10;
const T1 = run.arrivals[SCHOOL_STOP] + 3;

const familyStop = { ...route.stops[FAMILY_STOP], name: "418 Laurel Ave" };
const schoolAddr = "1100 Bayview Dr";

function latest(routeId, stop, t) {
  let best = null;
  for (const r of todayRows) if (r.route === routeId && r.stop === stop && r.issuedAt <= t && (!best || r.issuedAt > best.issuedAt)) best = r;
  return best;
}
const hm = (m) => fmtTime(m).replace(" AM", "").replace(" PM", "");
const range = (lo, hi) => `${hm(lo)}–${fmtTime(hi)}`;

// ---------- icons ----------
const PIN = (c) => `<svg width="20" height="26" viewBox="0 0 20 26"><path d="M10 0C4.5 0 0 4.4 0 9.8 0 17 10 26 10 26s10-9 10-16.2C20 4.4 15.5 0 10 0z" fill="${c}"/><circle cx="10" cy="9.6" r="4.2" fill="#fff"/></svg>`;
const BACK = `<svg width="14" height="24" viewBox="0 0 14 24"><path d="M12 2 2 12l10 10" stroke="#99ca41" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEV = `<svg width="9" height="15" viewBox="0 0 9 15"><path d="M1.5 1.5 7.5 7.5l-6 6" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
const SB_ICONS = `<span class="icons"><svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#111"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#111"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#111"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#111"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0zM1 4.4a9.9 9.9 0 0 1 14 0l-1.4 1.4a7.9 7.9 0 0 0-11.2 0z" fill="#111"/></svg><svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="#111" opacity=".4"/><rect x="2" y="2" width="19" height="8" rx="1.8" fill="#111"/><rect x="23.5" y="4" width="1.8" height="4" rx=".9" fill="#111" opacity=".4"/></svg></span>`;
const EXPAND = `<svg width="22" height="22" viewBox="0 0 22 22" fill="#3a7bd5"><path d="M2 2h6L6 4l3.5 3.5-2 2L4 6 2 8zM20 2v6l-2-2-3.5 3.5-2-2L16 4l-2-2zM2 20v-6l2 2 3.5-3.5 2 2L6 18l2 2zM20 20h-6l2-2-3.5-3.5 2-2L18 16l2-2z"/></svg>`;
const DRIVER_AV = `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="18" r="9" fill="#8d5524"/><path d="M14 16c0-7 18-7 18 0v-3c0-6-18-6-18 0z" fill="#2b1a10"/><path d="M6 46c1-11 8-16 17-16s16 5 17 16z" fill="#5a8fb0"/></svg>`;

// ---------- map (Mapbox-light style, drawn locally) ----------
const MAP_W = 375, MAP_H = 190;
const routePts = [[392, 128], [300, 128], [238, 128], [238, 94], [176, 94], [118, 70], [118, 128], [-20, 128]]; // offscreen yard -> ... -> family stop (idx 5) -> school offscreen
const STOP_AT = { 1: FAMILY_STOP - 3, 2: FAMILY_STOP - 2, 3: FAMILY_STOP - 1, 5: FAMILY_STOP }; // polyline vertex -> stop index
function mapSvg(busXY) {
  const rng = mulberry32(7);
  let g = "";
  // parks
  for (const [x, y, w, h] of [[22, 18, 46, 30], [190, 140, 60, 26], [292, 26, 38, 46], [60, 146, 40, 22]]) g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#bee8bc"/>`;
  // residential blocks: thin white streets
  for (let i = 0; i < 13; i++) {
    const x = 6 + i * 30 + rng() * 8;
    g += `<path d="M${x} 0 C ${x + 6} 60, ${x - 6} 120, ${x + 3} 190" stroke="#fff" stroke-width="2.6" fill="none"/>`;
  }
  for (let j = 0; j < 7; j++) {
    const y = 10 + j * 28 + rng() * 6;
    g += `<path d="M0 ${y} C 120 ${y + 8}, 250 ${y - 8}, 375 ${y + 4}" stroke="#fff" stroke-width="2.6" fill="none"/>`;
  }
  // cul-de-sacs and short residential spurs
  for (let k = 0; k < 14; k++) {
    const x = rng() * 360, y = rng() * 180, l = 12 + rng() * 18, a = rng() * Math.PI;
    g += `<path d="M${x} ${y} l ${l * Math.cos(a)} ${l * Math.sin(a)}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="${x + l * Math.cos(a)}" cy="${y + l * Math.sin(a)}" r="3" fill="#fff"/>`;
  }
  // arterials
  g += `<path d="M0 128 L375 128" stroke="#fff" stroke-width="7"/><path d="M238 0 L238 190" stroke="#fff" stroke-width="6"/>`;
  g += `<text x="300" y="122" font-size="10" fill="#7d7d7d" font-family="-apple-system, Helvetica, Arial">Bayview Dr</text>`;
  g += `<text x="130" y="88" font-size="9.5" fill="#8a8a8a" transform="rotate(-12 130 88)" font-family="-apple-system, Helvetica, Arial">Laurel Ave</text>`;
  g += `<text x="244" y="40" font-size="9.5" fill="#8a8a8a" transform="rotate(90 244 40)" font-family="-apple-system, Helvetica, Arial">Hillcrest Rd</text>`;
  // family pin
  g += `<g transform="translate(108 44)">${PIN("#99ca41")}<ellipse cx="10" cy="27" rx="6" ry="2" fill="#fff" stroke="#aaa"/></g>`;
  // bus
  if (busXY) {
    const [x, y, ang] = busXY;
    g += `<g transform="translate(${x} ${y}) rotate(${ang})"><rect x="-18" y="-9" width="36" height="18" rx="5" fill="#f5c518" stroke="#c99a00" stroke-width="1"/><rect x="-12" y="-5" width="4" height="10" rx="1" fill="#222"/><rect x="-5" y="-5" width="4" height="10" rx="1" fill="#222"/><rect x="2" y="-5" width="4" height="10" rx="1" fill="#222"/><rect x="9" y="-5" width="4" height="10" rx="1" fill="#222"/></g>`;
  }
  return `<svg width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}">${g}</svg>`;
}
// time -> position along the polyline, anchored at actual stop arrival times
function busPosition(t) {
  const anchors = [[route.start + 3, 0]];
  for (const [v, s] of Object.entries(STOP_AT)) anchors.push([run.arrivals[s], +v]);
  anchors.push([run.arrivals[FAMILY_STOP + 1], 7]);
  anchors.sort((a, b) => a[0] - b[0]);
  if (t < anchors[0][0] || t > anchors[anchors.length - 1][0]) return null;
  let v = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const [ta, va] = anchors[i];
    const [tb, vb] = anchors[i + 1];
    if (t >= ta && t <= tb) v = va + ((vb - va) * (t - ta)) / Math.max(0.01, tb - ta);
  }
  const i = Math.min(routePts.length - 2, Math.floor(v));
  const f = v - i;
  const [x1, y1] = routePts[i];
  const [x2, y2] = routePts[i + 1];
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, Math.abs(ang) > 90 ? ang - 180 : ang];
}

// ---------- parent screen ----------
function parentScreen(t) {
  const pk = latest(route.id, FAMILY_STOP, t);
  const sc = latest(route.id, SCHOOL_STOP, t);
  const pickedUp = t >= run.arrivals[FAMILY_STOP];
  const atSchool = t >= run.arrivals[SCHOOL_STOP];
  const started = t >= route.start;
  const stopsBefore = run.arrivals.slice(0, FAMILY_STOP).filter((a) => a > t).length;
  let l1, l2;
  if (atSchool) [l1, l2] = ["Ride completed", `Dropped off at ${fmtTime(run.arrivals[SCHOOL_STOP])}`];
  else if (pickedUp) [l1, l2] = ["Ride in progress", "On the way to school"];
  else if (!started) [l1, l2] = ["Ride starts soon", `Driver leaves the yard at ${fmtTime(route.start)}`];
  else [l1, l2] = ["Driver on the way", stopsBefore === 0 ? "Your pickup is next" : `${stopsBefore} stop${stopsBefore > 1 ? "s" : ""} before your pickup`];
  const ref = pickedUp ? null : pk;
  const late = ref ? Math.round(ref.eta - familyStop.sched) : 0;
  const status = pickedUp ? (atSchool ? "Your ride is complete" : "Your ride is in progress") : late >= 3 ? `Your ride is running ${late} min late` : "Your ride is on time";
  const bar = (r) => {
    const a = r.lo - 6, b = r.hi + 6;
    const x = (v) => (100 * (v - a)) / (b - a);
    return `<div class="rangebar"><span class="r" style="left:${x(r.lo)}%;width:${x(r.hi) - x(r.lo)}%"></span><span class="p" style="left:${x(r.eta)}%"></span></div>`;
  };
  const pickupTimes = pickedUp
    ? `<div class="lbl">Scheduled</div><div class="val">${fmtTime(familyStop.sched)}</div><div class="lbl">Picked up</div><div class="val">${fmtTime(run.arrivals[FAMILY_STOP])}</div>`
    : `<div class="lbl">Scheduled</div><div class="val">${fmtTime(familyStop.sched)}</div>
       <div class="lbl">Current ETA</div><div class="val ${late >= 3 ? "late" : ""}">${fmtTime(pk.eta)}</div>
       <div class="lbl new">Likely</div><div class="val new" style="margin-bottom:0">${range(pk.lo, pk.hi)}</div>${bar(pk)}`;
  const bystop = pickedUp
    ? `<div class="bystop done"><div class="t">Picked up at ${fmtTime(run.arrivals[FAMILY_STOP])}</div><div class="s">${run.arrivals[FAMILY_STOP] >= latest(route.id, FAMILY_STOP, run.arrivals[FAMILY_STOP] - 0.01).lo ? "Inside" : "Outside"} the window shown before the bus arrived.</div></div>`
    : `<div class="bystop"><div class="t">Be at the stop by ${fmtTime(pk.byStop)}</div><div class="s">On mornings like this one, the bus got here earlier than that about 1 time in 100.</div></div>`;
  const schoolTimes = atSchool
    ? `<div class="lbl">Scheduled</div><div class="val">${fmtTime(route.stops[SCHOOL_STOP].sched)}</div><div class="lbl">Dropped off</div><div class="val">${fmtTime(run.arrivals[SCHOOL_STOP])}</div>`
    : `<div class="lbl">Scheduled</div><div class="val">${fmtTime(route.stops[SCHOOL_STOP].sched)}</div>
       <div class="lbl">Current ETA</div><div class="val">${fmtTime(sc.eta)}</div>
       <div class="lbl new">Likely</div><div class="val new" style="margin-bottom:0">${range(sc.lo, sc.hi)}</div>`;
  return `
    <div class="sb"><span>${hm(t)}</span>${SB_ICONS}</div>
    <div class="navbar"><span class="back">${BACK}</span>Tue Nov 10, 2026</div>
    <div class="driver"><span class="av">${DRIVER_AV}</span><span class="who"><small>Your driver</small><b>Marisol</b></span>${CHEV}</div>
    <div class="map">${mapSvg(busPosition(t))}<span class="expand">${EXPAND}</span><span class="info">i</span></div>
    <div class="banner"><div class="l1">${l1}</div><div class="l2">${l2}</div></div>
    <div class="ride-status ${!pickedUp && late >= 3 ? "late" : ""}">${status}</div>
    <div class="stopsec"><div class="rail">${PIN("#99ca41")}<span class="dash"></span></div>
      <div class="main"><h3>Pickup</h3><div class="addr">${familyStop.name}</div>
        <div class="kids"><div class="kid"><div class="face" style="background:#7e57c2">M</div>Maya</div><div class="kid"><div class="face" style="background:#26a69a">L</div>Leo</div></div>
      </div>
      <div class="times">${pickupTimes}</div></div>
    ${bystop}
    <div class="stopsec" style="padding-top:12px"><div class="rail">${PIN("#f57c20")}</div>
      <div class="main"><h3>Dropoff</h3><div class="addr">${route.school}<br>${schoolAddr}</div></div>
      <div class="times">${schoolTimes}</div></div>`;
}

// ---------- admin screen ----------
const VEHICLES = { r214: "214476", r201: "281904", r207: "290821", r219: "211471", r226: "272104", r233: "233918" };
function adminScreen(t) {
  const cards = sim.routes.map((r) => {
    const rr = sim.runs.find((x) => x.route === r.id && x.dayIdx === today);
    const school = r.stops.length - 1;
    const nStudents = r.stops.reduce((a, s) => a + s.students, 0);
    const p = latest(r.id, school, t);
    const arrived = t >= rr.arrivals[school];
    const started = t >= r.start;
    const next = rr.arrivals.filter((a) => a <= t).length + 1;
    let cls = "", st, eta, right;
    if (arrived) {
      st = `<span class="dot gray"></span>Arrived`;
      cls = "idle";
      right = `<div class="lbl">Arrived</div><div class="eta">${fmtTime(rr.arrivals[school])}</div>`;
    } else if (!started) {
      st = `<span class="dot gray"></span>Starts ${fmtTime(r.start)}`;
      cls = "idle";
    }
    let risk = "", likely = "";
    if (!arrived && p) {
      const delay = Math.round(p.eta - r.stops[school].sched);
      const delayed = delay >= 3 && started;
      if (started) {
        st = delayed ? `<span class="dot red"></span>Delayed by ${delay} mins` : `<span class="dot"></span>In progress`;
        cls = delayed ? "delayed" : "";
      }
      right = `<div class="lbl ${delayed ? "red" : ""}">Estimated arrival</div><div class="eta ${delayed ? "red" : ""}">${fmtTime(p.eta)}</div>`;
      likely = `<span class="likely">Likely ${range(p.lo, p.hi)}</span>`;
      const pl = p.pLate;
      const k = pl < 0.05 ? "ok" : pl < 0.2 ? "warn" : "bad";
      risk = `<span class="risk ${k}">${pl < 0.05 ? "&lt;5%" : Math.round(100 * pl) + "%"} chance after ${hm(r.bell)} bell</span>`;
    }
    return `<div class="ride ${cls}"><div class="hd"><b>Route ${r.name}</b><span class="st">${st}</span></div>
      <div class="bd"><div>Vehicle <b>${VEHICLES[r.id]}</b><br>${nStudents} students<br>${r.school}</div><div class="r">${right || ""}</div></div>
      <div class="ft">${likely || "<span></span>"}${risk}</div>
      <div class="ft"><span></span><span>${arrived ? "Completed" : started ? `Next stop ${Math.min(next, school)} of ${school}` : `${school} stops`}</span></div></div>`;
  });
  return `<div class="sb" style="background:#fff"><span>${hm(t)}</span>${SB_ICONS}</div><div class="navbar">Today's rides</div><div class="rides">${cards.join("")}</div>`;
}

// ---------- left panel: coverage chart and stats ----------
const wk = weekly(win, sim.days);
function covChart() {
  const W = 436, H = 170, L = 34, R = 8, T = 10, B = 24;
  const x = (i) => L + ((W - L - R) * i) / (wk.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - 0.4) / 0.6);
  let g = "";
  for (const v of [0.4, 0.6, 0.8, 1]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eef1ec"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#47617b">${v * 100}%</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${y(0.9)}" y2="${y(0.9)}" stroke="#528033" stroke-dasharray="3 3" opacity=".6"/><text x="${x(2)}" y="${y(0.9) + 13}" font-size="10" fill="#528033">target 90%</text>`;
  const ci = wk.findIndex((w) => w.start >= CONSTRUCTION_FROM);
  if (ci > 0) g += `<rect x="${x(ci) - 8}" y="${T}" width="${x(ci + 1) - x(ci) + 16}" height="${H - T - B}" fill="#fcf4aa" opacity=".5"/><text x="${x(ci) + 4}" y="${H - B - 5}" font-size="9.5" fill="#6b5d00" text-anchor="middle">lane closure</text>`;
  g += `<rect x="${x(0) - 6}" y="${T}" width="${x(1) - x(0) + 6}" height="${H - T - B}" fill="#e1e9ec" opacity=".6"/><text x="${x(0) - 2}" y="${H - B - 18}" font-size="9.5" fill="#47617b">first</text><text x="${x(0) - 2}" y="${H - B - 6}" font-size="9.5" fill="#47617b">weeks</text>`;
  const line = (k, c, w) => `<polyline points="${wk.map((d, i) => `${x(i)},${y(Math.max(0.4, d[k]))}`).join(" ")}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
  g += line("static", "#9fb3c4", 2) + line("band", "#e8833a", 2) + line("window", "#528033", 2.6);
  wk.forEach((d, i) => {
    if (i % 2 === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#47617b">${new Date(d.start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</text>`;
  });
  return `<svg width="${W}" height="${H}">${g}</svg>`;
}
const ev = evaluate(win);
const stp = evaluateStopTime(win, sim.routes);
const late = evaluateLate(win, sim.routes);
document.getElementById("cov-chart").innerHTML = covChart();
document.getElementById("stats").innerHTML = `
  <div class="stat"><div class="v">${(100 * ev.window.coverage).toFixed(1)}%</div><div class="k">of arrivals inside the window, ${ev.window.width.toFixed(1)} min wide on average. ETA ± 2 min: ${(100 * ev.band.coverage).toFixed(0)}%</div></div>
  <div class="stat"><div class="v">${stp.byStop.wait.toFixed(1)} min</div><div class="k">average wait at the stop using "be at the stop by", vs ${stp.fiveEarly.wait.toFixed(1)} min for "5 min before scheduled"</div></div>
  <div class="stat"><div class="v">${(100 * stp.byStop.miss).toFixed(1)}%</div><div class="k">of mornings the bus beat that time, vs ${(100 * stp.etaMinus2.miss).toFixed(1)}% for "2 min before the ETA"</div></div>`;

function method() {
  const cIdx = sim.days.findIndex((d) => d >= CONSTRUCTION_FROM);
  const closure = evaluate(win, { filter: (r) => r.route === "r214" && r.stop >= 4 && r.dayIdx >= cIdx && r.dayIdx < cIdx + 10 });
  const rain = evaluate(win, { filter: (r) => r.rain });
  const f = (v) => (100 * v).toFixed(1) + "%";
  return `<h2>How Arrival windows work</h2>
  <p>The point ETA stays as it is. Each ETA also gets a range built from that ETA's own recent errors: residuals from the last 10 school days for the same route and lead time (how far out the prediction is), scaled by how noisy that lead time has been on rainy or dry mornings over the last 40 days. Split-conformal quantiles of those scaled residuals give a range that holds 90% of arrivals, a 1% lower bound becomes "be at the stop by", and the share of past errors that would have pushed the school arrival past the bell becomes the late-to-bell chance. Adaptive conformal inference nudges each route's levels after every morning, so coverage recovers when something changes.</p>
  <table><tr><th>Held-out mornings (Sep 8 - Nov 10, ${ev.n.toLocaleString()} predictions)</th><th>Coverage</th><th>Avg width</th></tr>
  <tr><td><b>Arrival window</b></td><td><b>${f(ev.window.coverage)}</b></td><td>${ev.window.width.toFixed(1)} min</td></tr>
  <tr><td>ETA ± 2 min</td><td>${f(ev.band.coverage)}</td><td>4.0 min</td></tr>
  <tr><td>One-time calibration (first 3 weeks, by lead time)</td><td>${f(ev.static.coverage)}</td><td>${ev.static.width.toFixed(1)} min</td></tr>
  <tr><td>Arrival window, rainy mornings</td><td>${f(rain.window.coverage)}</td><td>${rain.window.width.toFixed(1)} min</td></tr>
  <tr><td>Arrival window, Route 214 past the lane closure (first 2 weeks)</td><td>${f(closure.window.coverage)}</td><td>${closure.window.width.toFixed(1)} min</td></tr></table>
  <p><b>Be at the stop by</b> (predictions 8-22 minutes out, ${stp.n.toLocaleString()} pickups): bus came first ${f(stp.byStop.miss)}, average wait ${stp.byStop.wait.toFixed(1)} min. "5 min before scheduled": ${f(stp.fiveEarly.miss)}, ${stp.fiveEarly.wait.toFixed(1)} min. "2 min before the ETA": ${f(stp.etaMinus2.miss)}, ${stp.etaMinus2.wait.toFixed(1)} min.</p>
  <p><b>Late to bell</b> (${late.n.toLocaleString()} school-arrival predictions, ${f(late.lateRate)} actually late): Brier score ${late.brier.toFixed(3)} vs ${late.brierFlag.toFixed(3)} for "late if the ETA is past the bell". It is well calibrated below 30% and overconfident above it (predicted ${(100 * late.bins[3].predicted).toFixed(0)}%, observed ${(100 * late.bins[3].observed).toFixed(0)}% in the top bin, n = ${late.bins[3].n}).</p>
  <p class="note">What it doesn't do: coverage is marginal (over all mornings), not guaranteed for each stop on each day; right after a sudden change (the lane closure) it dips below target for about two weeks before the levels catch up; mornings are correlated, so the 90% holds on average, not every week. The point ETA here is a simple stand-in for Zum's model; the method wraps whatever ETA the app already shows. Synthetic data: 6 routes, 60 school days, ${rows.length.toLocaleString()} predictions.</p>`;
}

// ---------- wiring ----------
const scrub = document.getElementById("scrub");
document.getElementById("tick-a").textContent = fmtTime(T0);
document.getElementById("tick-b").textContent = fmtTime(T1);
const toT = (v) => T0 + ((T1 - T0) * v) / 100;
function render() {
  const t = toT(+scrub.value);
  document.getElementById("scrub-time").textContent = fmtTime(t);
  document.getElementById("parent").innerHTML = parentScreen(t);
  document.getElementById("admin").innerHTML = adminScreen(t);
}
const DEFAULT_T = 7 * 60 + 44;
scrub.value = String(Math.round((100 * (DEFAULT_T - T0)) / (T1 - T0)));
const hashT = /t=(\d{1,2}):(\d{2})/.exec(location.hash);
if (hashT) scrub.value = String(Math.round((100 * (+hashT[1] * 60 + +hashT[2] - T0)) / (T1 - T0)));
scrub.addEventListener("input", render);
render();
document.getElementById("method-link").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("modal-body").innerHTML = method();
  document.getElementById("modal").hidden = false;
});
document.getElementById("modal-x").addEventListener("click", () => (document.getElementById("modal").hidden = true));
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") e.currentTarget.hidden = true;
});
if (location.hash.includes("method")) document.getElementById("method-link").click();
