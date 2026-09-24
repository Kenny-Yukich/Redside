// app.js — Redside UI. Vanilla JS, no build step. A tiny hash router renders
// each view into #app; a bottom tab bar switches sections.

import { WATERS, WATER_BY_ID, GLOSSARY, ODFW_CENTRAL, ODFW_REGS } from "./data.js";
import { refreshAll, cachedFor, ageLabel, skyLabel } from "./conditions.js";
import { rankWaters, scoreWater, recommend, askAI } from "./advisor.js";
import { getCatches, addCatch, deleteCatch, catchesForWater, stats, exportJSON, importJSON } from "./log.js";
import { viewSpot, disposeSpot } from "./spot.js";
import { viewSpotSettings } from "./spot-settings.js";
import { startSpotQueue } from "./spot-queue.js";

const app = document.getElementById("app");
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const driveStr = (m) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} hr`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function manageDialog(root, initialFocus) {
  const returnFocus = document.activeElement;
  const selector = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    root.remove();
    if (returnFocus?.focus) returnFocus.focus();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const focusable = [...root.querySelectorAll(selector)].filter((node) => !node.disabled);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKeydown);
  requestAnimationFrame(() => root.querySelector(initialFocus)?.focus());
  return close;
}

// Turn <term>x</term> markup into tappable glossary buttons.
function terms(html) {
  return html.replace(/<term>(.*?)<\/term>/g, (_, w) => {
    const raw = w.toLowerCase();
    const key = GLOSSARY[raw] ? raw : (GLOSSARY[raw.replace(/s$/, "")] ? raw.replace(/s$/, "") : null);
    if (!key) return w;
    return `<button class="term" data-term="${esc(key)}">${esc(w)}<span class="term-dot">?</span></button>`;
  });
}

// ---- Sync -------------------------------------------------------------------
let syncing = false;
async function sync(render) {
  if (syncing || !navigator.onLine) { if (render) render(); return; }
  syncing = true;
  updateSyncPill();
  await refreshAll(() => {});
  syncing = false;
  updateSyncPill();
  if (render) render();
}
function updateSyncPill() {
  const p = document.getElementById("sync-pill");
  const button = document.getElementById("resync");
  if (button) {
    button.disabled = syncing;
    button.classList.toggle("busy", syncing);
    button.innerHTML = syncing
      ? `<span class="sync-icon" aria-hidden="true"></span>Syncing`
      : `<span class="sync-icon" aria-hidden="true"></span>Refresh`;
  }
  if (!p) return;
  const latestTs = Math.max(0, ...WATERS.map((w) => cachedFor(w.id)?.ts || 0));
  const age = latestTs ? ageLabel(latestTs) : "not synced yet";
  if (!navigator.onLine) { p.textContent = `Offline · saved ${age}`; p.className = "sync-pill offline"; return; }
  p.textContent = syncing ? "Updating conditions…" : `Updated ${age}`;
  p.className = "sync-pill" + (syncing ? " busy" : "");
}

// ---- Bite-score dial (SVG) --------------------------------------------------
function scoreLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 45) return "Fair";
  if (score >= 25) return "Slow";
  return "Poor";
}

function dial(score, band, size = 64) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const label = `${score} out of 100, ${scoreLabel(score)}`;
  return `<svg class="dial ${band}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">
    <title>${label}</title>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" class="dial-track"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" class="dial-fill"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"
      transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="52%" class="dial-num">${score}</text>
  </svg>`;
}

function scoreDial(score, band, size = 64) {
  return `<span class="score-dial">${dial(score, band, size)}<span class="score-label ${band}">${scoreLabel(score)}</span></span>`;
}

function targetFor(water) {
  return water.species.find((s) => s.rank === "signature" || s.rank === "primary");
}

function conditionBits(result) {
  const c = cachedFor(result.water.id);
  const bits = [];
  if (c?.flow?.flowCfs != null) bits.push(`${c.flow.flowCfs.toLocaleString()} cfs`);
  if (c?.weather) bits.push(`${skyLabel(c.weather.today?.code)}, ${c.weather.today?.hi}°/${c.weather.today?.lo}°`);
  if (c?.weather?.today?.windMax != null) bits.push(`wind ${c.weather.today.windMax} mph`);
  return bits;
}

const TACKLE_CATALOG = [
  { terms: ["wedding ring"], label: "Wedding ring", icon: "spinner" },
  { terms: ["dodger"], label: "Dodger", icon: "dodger" },
  { terms: ["powerbait"], label: "PowerBait", icon: "bait" },
  { terms: ["white corn", "shoepeg corn", "corn"], label: "White corn", icon: "corn" },
  { terms: ["worm"], label: "Worm", icon: "worm" },
  { terms: ["soft-plastic", "soft plastic", "grub"], label: "Soft plastic", icon: "grub" },
  { terms: ["crankbait", "plug"], label: "Crankbait", icon: "plug" },
  { terms: ["streamer"], label: "Streamer", icon: "fly" },
  { terms: ["dry fly"], label: "Dry fly", icon: "dry-fly" },
  { terms: ["nymph", "chironomid"], label: "Nymph", icon: "nymph" },
  { terms: ["spinner"], label: "Spinner", icon: "spinner" },
  { terms: ["spoon"], label: "Spoon", icon: "spoon" },
  { terms: ["hoochie"], label: "Hoochie", icon: "hoochie" },
];

function tackleIcon(type) {
  const art = {
    spinner: `<path d="M8 27h10m4 0h7"/><circle cx="19" cy="27" r="2.5" class="accent-fill"/><path d="M29 27c6-10 13-9 12-2-1 5-6 7-12 2Z" class="soft-fill"/><path d="M8 27c-5 0-5 8 0 8 4 0 5-4 2-6"/>`,
    dodger: `<path d="M11 18c8-6 22-6 30 0l-4 19c-9 5-17 5-26 0Z" class="soft-fill"/><path d="m17 23 17 9M15 30l15 7"/><circle cx="12" cy="18" r="2"/><circle cx="37" cy="37" r="2"/>`,
    bait: `<path d="M15 18h22l2 5v17H13V23Z" class="soft-fill"/><path d="M16 14h20v6H16z"/><circle cx="21" cy="29" r="2" class="accent-fill"/><circle cx="29" cy="34" r="2" class="accent-fill"/><circle cx="34" cy="27" r="1.5" class="accent-fill"/>`,
    corn: `<path d="M14 37c8-18 17-21 26-19-1 12-8 22-20 23Z" class="soft-fill"/><circle cx="24" cy="29" r="2.5" class="accent-fill"/><circle cx="31" cy="25" r="2.5" class="accent-fill"/><circle cx="29" cy="33" r="2.5" class="accent-fill"/>`,
    worm: `<path d="M8 33c8-19 15 10 24-9 5-10 12-3 10 5" class="thick"/><path d="M38 29c0 5 5 8 8 3"/>`,
    grub: `<path d="M10 27h22c8 0 10 12 3 15-5 2-8-3-5-7" class="thick"/><path d="M9 21v13M5 21h8"/><circle cx="25" cy="27" r="2" class="accent-fill"/>`,
    plug: `<path d="M8 28c8-10 23-12 32-3-4 11-20 14-32 3Z" class="soft-fill"/><circle cx="33" cy="25" r="1.6" class="accent-fill"/><path d="m9 29-5 7M18 35c0 6 6 6 7 1M32 34c0 6 6 6 7 1"/>`,
    fly: `<path d="M11 29h29M24 29c-8-11-14-7-10 1m11-1c6-12 14-8 11 0"/><path d="m18 24 12 10M18 34l12-10"/><path d="M39 29c0 7 7 8 9 2"/>`,
    "dry-fly": `<path d="M9 31h32M22 30c-10-14-16-7-9 0m11 0c7-15 18-7 10 1"/><path d="m13 24 17 13m-13 1 12-14"/><path d="M40 31c0 6 6 7 8 2"/>`,
    nymph: `<path d="M12 29h29M18 25l-5-6m9 6 1-8m4 8 6-6m-14 13-5 6m10-6 1 7m5-7 6 5"/><ellipse cx="25" cy="29" rx="10" ry="5" class="soft-fill"/><path d="M40 29c0 7 6 8 8 2"/>`,
    spoon: `<path d="M12 17c15 0 25 8 25 18-15 2-27-6-25-18Z" class="soft-fill"/><circle cx="14" cy="19" r="2"/><path d="M37 35c1 7 8 8 10 2"/>`,
    hoochie: `<path d="M17 17h18l3 9H14Z" class="soft-fill"/><path d="M17 27 12 42m10-15-2 16m7-16 2 16m3-16 7 14"/><circle cx="22" cy="22" r="1.5" class="accent-fill"/><circle cx="30" cy="22" r="1.5" class="accent-fill"/>`,
  };
  return `<svg class="tackle-icon" viewBox="0 0 52 52" aria-hidden="true">${art[type] || art.spoon}</svg>`;
}

function tackleGuide(species) {
  const copy = `${species.how} ${species.gear}`.toLowerCase();
  const picks = TACKLE_CATALOG.filter((item) => item.terms.some((term) => copy.includes(term))).slice(0, 4);
  if (!picks.length) return "";
  return `<div class="tackle-guide">
    <div class="tackle-head"><span>Quick tackle pick</span><span>not to scale</span></div>
    <div class="tackle-grid">${picks.map((item) => `<figure class="tackle-item"><span class="tackle-art">${tackleIcon(item.icon)}</span><figcaption>${esc(item.label)}</figcaption></figure>`).join("")}</div>
  </div>`;
}

// ===== TODAY =================================================================
let driveFilter = 45; // "after-work" default; Infinity for "anywhere"
function viewToday() {
  const now = new Date();
  const { ranked } = recommend(now, driveFilter);
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const top = ranked[0];

  const bestBet = top ? (() => {
    const w = top.water;
    const target = targetFor(w);
    const bits = conditionBits(top);
    return `<a class="best-bet" href="#/water/${w.id}">
      <div class="best-bet-top"><span class="best-kicker">Best bet</span><span class="best-drive">${driveStr(w.driveMin)} away</span></div>
      <div class="best-bet-main">
        <div class="best-bet-copy"><h2>${esc(w.name)}</h2><p>${target ? `Go for ${esc(target.name.toLowerCase())}` : esc(w.tagline)}</p></div>
        ${scoreDial(top.score, top.band, 68)}
      </div>
      <div class="best-bet-bottom"><span>${bits.map(esc).join(" · ") || "Seasonal score · live conditions pending"}</span><strong>View plan <span aria-hidden="true">›</span></strong></div>
    </a>`;
  })() : "";

  const cards = ranked.slice(1).map((r) => {
    const w = r.water;
    const bits = conditionBits(r);
    const target = targetFor(w);
    return `<a class="card water-card" href="#/water/${w.id}">
      ${scoreDial(r.score, r.band)}
      <div class="card-body">
        <div class="card-top"><h3>${esc(w.name)}</h3><span class="drive">${driveStr(w.driveMin)}</span></div>
        <p class="card-sub">${target ? "Go for " + esc(target.name.toLowerCase()) : esc(w.tagline)}</p>
        <p class="card-cond">${bits.map(esc).join(" · ") || "sync for live conditions"}</p>
      </div>
      <span class="chev">›</span>
    </a>`;
  }).join("");

  const v = el(`<section class="view">
    <header class="hero">
      <div class="hero-topline"><div class="hero-eyebrow">Central Oregon · ${esc(dateStr)}</div><p id="sync-pill" class="sync-pill" aria-live="polite">Checking…</p></div>
      <h1 class="hero-title">Where to fish today</h1>
      ${bestBet}
      <div class="hero-foot"><p>${esc(top?.reasons?.[0]?.text || "Widen your drive range to see more water.")}</p><button class="score-info-link" id="scoreInfo">How scoring works</button></div>
    </header>
    <div class="today-tools">
      <div class="drive-toggle" role="group" aria-label="Maximum drive time">
        <button class="chip ${driveFilter===45?"on":""}" data-drive="45" aria-pressed="${driveFilter===45}">Within 45 min</button>
        <button class="chip ${driveFilter===Infinity?"on":""}" data-drive="inf" aria-pressed="${driveFilter===Infinity}">Anywhere</button>
      </div>
      <button class="sync-btn" id="resync"><span class="sync-icon" aria-hidden="true"></span>Refresh</button>
    </div>
    ${cards ? `<div class="list-head"><h2>Other options</h2><span>${ranked.length - 1} nearby</span></div><div class="cards">${cards}</div>` : ""}
  </section>`);

  v.querySelectorAll("[data-drive]").forEach((b) => b.onclick = () => {
    driveFilter = b.dataset.drive === "inf" ? Infinity : 45; render();
  });
  v.querySelector("#resync").onclick = () => sync(renderAfterSync);
  v.querySelector("#scoreInfo").onclick = openScoreInfo;
  return v;
}

// ===== WATERS LIST ==========================================================
function viewWaters() {
  const now = new Date();
  const rows = WATERS.slice().sort((a,b)=>a.driveMin-b.driveMin).map((w) => {
    const r = scoreWater(w, now);
    return `<a class="card water-card" href="#/water/${w.id}">
      ${scoreDial(r.score, r.band, 52)}
      <div class="card-body">
        <div class="card-top"><h3>${esc(w.name)}</h3><span class="drive">${driveStr(w.driveMin)}</span></div>
        <p class="card-sub">${esc(w.tagline)}</p>
      </div><span class="chev">›</span></a>`;
  }).join("");
  return el(`<section class="view">
    <header class="page-head scenic-head waters-head"><div><span class="scenic-kicker">Field guide</span><h1>Your waters</h1><p>Seven spots, sorted by drive from Madras.</p></div></header>
    <div class="cards">${rows}</div>
  </section>`);
}

// ===== WATER DETAIL =========================================================
function viewWater(id) {
  const w = WATER_BY_ID[id];
  if (!w) return el(`<section class="view"><p>Unknown water.</p></section>`);
  const r = scoreWater(w);
  const c = cachedFor(w.id);
  const past = catchesForWater(w.id);
  const backDestinations = {
    "#/waters": ["#/waters", "Waters"],
    "#/ask": ["#/ask", "Ask"],
    "#/log": ["#/log", "Log"],
  };
  const [backHref, backLabel] = backDestinations[activeSection] || ["#/", "Today"];

  const cond = (() => {
    const items = [];
    if (w.type === "river") items.push(cell("Flow", c?.flow?.flowCfs != null ? `${c.flow.flowCfs.toLocaleString()} cfs` : "—", w.gaugeLabel || "river gauge"));
    if (c?.flow?.waterTempF != null) items.push(cell("Water", `${c.flow.waterTempF}°F`, "river temp"));
    if (c?.weather) {
      items.push(cell("Air", `${c.weather.today?.hi}°/${c.weather.today?.lo}°`, skyLabel(c.weather.today?.code)));
      items.push(cell("Wind", `${c.weather.today?.windMax ?? c.weather.windMph} mph`, "today's max"));
      if (c.weather.today?.precipPct != null) items.push(cell("Rain", `${c.weather.today.precipPct}%`, "chance today"));
    }
    const age = c?.ts ? `synced ${ageLabel(c.ts)}` : "not synced yet";
    return `<div class="panel">
      <div class="panel-head"><span>Conditions</span><span class="muted small">${esc(age)}</span></div>
      <div class="gauges">${items.join("") || `<p class="muted">Sync when you have signal to load live conditions.</p>`}</div>
    </div>`;
  })();

  const species = w.species.map((s) => `
    <div class="species">
      <div class="species-head">
        <h4>${esc(s.name)}</h4>
        <span class="tag ${s.rank}">${s.rank}</span>
        ${s.beginner ? `<span class="tag beginner">beginner-friendly</span>` : ``}
      </div>
      <p class="lbl">How</p><p>${terms(s.how)}</p>
      ${tackleGuide(s)}
      <p class="lbl">What to bring</p><p>${terms(s.gear)}</p>
      <p class="lbl">Best when</p><p>${esc(s.when)}</p>
    </div>`).join("");

  const regs = `<div class="panel regs">
    <div class="panel-head"><span>⚠ Rules — read before you go</span></div>
    <ul>${w.regsNotes.map((n)=>`<li>${terms(n)}</li>`).join("")}</ul>
    <p class="muted small">Oregon's rules change (emergency closures happen). This app never replaces the official regulations.</p>
    <div class="regs-links">
      <a class="btn ghost" href="${w.regsUrl}" target="_blank" rel="noopener">Official page</a>
      <a class="btn ghost" href="${ODFW_REGS}" target="_blank" rel="noopener">Full regs</a>
      <a class="btn ghost" href="${ODFW_CENTRAL}" target="_blank" rel="noopener">This week's report</a>
    </div>
  </div>`;

  const reasons = r.reasons.map((x)=>`<li class="${x.good===true?"good":x.good===false?"bad":"neutral"}">${esc(x.text)}</li>`).join("");

  const pastHtml = past.length
    ? `<div class="panel"><div class="panel-head"><span>Your history here</span><span class="muted small">${past.length} logged</span></div>
        <ul class="loglist">${past.slice(0,5).map(logRow).join("")}</ul></div>`
    : `<div class="panel empty"><p>No catches logged here yet. When you catch one, log it — after a season this section becomes your own cheat sheet for this water.</p></div>`;

  const v = el(`<section class="view water-detail">
    <a class="back" href="${backHref}">‹ ${backLabel}</a>
    <header class="water-hero">
      ${scoreDial(r.score, r.band, 76)}
      <div><h1>${esc(w.name)}</h1><p class="muted">${esc(w.tagline)} · ${driveStr(w.driveMin)} from Madras</p></div>
    </header>
    <p class="intro">${esc(w.intro)}</p>
    <div class="panel"><div class="panel-head"><span>Why that score</span><button class="info-btn" id="scoreInfo2">How it works</button></div><ul class="reasons">${reasons}</ul></div>
    ${cond}
    <div class="panel"><div class="panel-head"><span>When it's good</span></div>
      <p><strong>${esc(w.season.best)}.</strong> ${esc(w.season.note)}</p></div>
    <h2 class="sec">What to fish for</h2>
    ${species}
    <div class="panel"><div class="panel-head"><span>Getting on the water</span></div>
      <ul>${w.access.map((a)=>`<li>${esc(a)}</li>`).join("")}</ul></div>
    <div class="panel"><div class="panel-head"><span>Local knowledge</span></div>
      <ul>${w.local.map((a)=>`<li>${terms(a)}</li>`).join("")}</ul></div>
    ${regs}
    <button class="btn primary wide" id="logHere">Log a catch here</button>
    ${pastHtml}
  </section>`);

  v.querySelector("#logHere").onclick = () => openLogSheet(w);
  v.querySelector("#scoreInfo2").onclick = openScoreInfo;
  return v;
}
function cell(label, val, sub) {
  return `<div class="gauge"><span class="gauge-val">${esc(val)}</span><span class="gauge-lbl">${esc(label)}</span><span class="gauge-sub">${esc(sub)}</span></div>`;
}

// ===== CATCH LOG ============================================================
function logRow(c) {
  return `<li class="log-row" data-id="${esc(c.id)}">
    <div><strong>${esc(c.species||"Fish")}</strong> ${c.length?`· ${esc(c.length)}`:""}
      <span class="muted small">${esc(c.date)}${c.waterName?` · ${esc(c.waterName)}`:""}</span></div>
    ${c.method?`<div class="muted small">${c.planId ? "Tied on" : "Worked"}: ${esc(c.method)}</div>`:""}
    ${c.planId ? `<div class="small"><a class="spot-link" href="#/spot/${encodeURIComponent(c.planId)}">Fish This Spot · Zone ${esc(c.zone)}</a> · ${esc({ fish: "Fish", bites: "Bites", nothing: "Nothing" }[c.result] || c.result)}</div>` : ""}
    ${c.notes?`<div class="small">${esc(c.notes)}</div>`:""}
    <button class="del" data-del="${esc(c.id)}" aria-label="Delete">✕</button>
  </li>`;
}
function viewLog() {
  const list = getCatches();
  const s = stats();
  const topWater = Object.entries(s.byWater).sort((a,b)=>b[1]-a[1])[0];
  const v = el(`<section class="view">
    <header class="page-head scenic-head log-head"><div><span class="scenic-kicker">Your field notes</span><h1>Catch log</h1>
      <p>Stays on this phone. Export a backup before you switch devices.</p></div></header>
    <div class="stat-row">
      <div class="stat"><span class="stat-num">${s.total}</span><span class="stat-lbl">caught</span></div>
      <div class="stat"><span class="stat-num">${Object.keys(s.byWater).length}</span><span class="stat-lbl">waters</span></div>
      <div class="stat"><span class="stat-num">${topWater?esc(topWater[0].split(" ")[0]):"—"}</span><span class="stat-lbl">top spot</span></div>
    </div>
    <div class="filter-row">
      <button class="chip on" id="addCatch">+ Log a catch</button>
      <button class="chip ghost" id="expBtn">Export backup</button>
      <label class="chip ghost" for="impFile">Import</label>
      <input id="impFile" type="file" accept="application/json" hidden>
    </div>
    <ul class="loglist big">${list.length?list.map(logRow).join(""):`<li class="empty">Nothing logged yet. Your first fish goes here — and every catch teaches the app (and you) more about these waters.</li>`}</ul>
  </section>`);
  v.querySelector("#addCatch").onclick = () => openLogSheet(null);
  v.querySelector("#expBtn").onclick = () => exportJSON();
  v.querySelector("#impFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const n = importJSON(await f.text()); toast(`Imported — ${n} catches total.`); render(); }
    catch (err) { toast("Couldn't read that file."); }
  };
  v.querySelectorAll("[data-del]").forEach((b)=>b.onclick=()=>{ deleteCatch(b.dataset.del); render(); });
  return v;
}

// ===== ADVISOR ==============================================================
function viewAdvisor() {
  const v = el(`<section class="view">
    <header class="page-head scenic-head ask-head"><div><span class="scenic-kicker">Local advisor</span><h1>Ask Redside</h1>
      <p>Describe your day — time, target, how far you'll drive.</p></div></header>
    <div class="ask-chips">
      <button class="chip" data-q="I've got a couple hours after work, close to Madras.">After-work, close</button>
      <button class="chip" data-q="I want a shot at a trophy fish this weekend and don't mind driving.">Weekend trophy</button>
      <button class="chip" data-q="I'm a total beginner — where's the easiest place to actually catch something?">Easiest to catch</button>
      <button class="chip" data-q="Where's the kokanee bite best right now?">Best kokanee</button>
    </div>
    <div class="ask-box">
      <textarea id="q" rows="3" placeholder="e.g. Saturday morning, want trout, up to an hour away"></textarea>
      <button class="btn primary" id="askBtn">Get a rec</button>
    </div>
    <div id="answer" class="answer"></div>
  </section>`);
  const answer = v.querySelector("#answer");
  const run = async (q) => {
    v.querySelector("#q").value = q;
    answer.innerHTML = `<p class="muted">Thinking…</p>`;
    // Rules-engine answer always works (offline). Try AI for a richer reply.
    const maxDrive = /after work|close|near|madras|hour|30|45/i.test(q) && !/don'?t mind|far|weekend|trophy/i.test(q) ? 45 : Infinity;
    const { text, ranked } = recommend(new Date(), maxDrive);
    answer.innerHTML = renderRec(text, ranked);
    try {
      const ai = await askAI(q);
      if (ai) answer.insertAdjacentHTML("afterbegin", `<div class="ai-note"><span class="ai-badge">AI</span><p>${esc(ai)}</p></div>`);
    } catch { /* no endpoint deployed — rules answer stands */ }
  };
  v.querySelectorAll("[data-q]").forEach((b)=>b.onclick=()=>run(b.dataset.q));
  v.querySelector("#askBtn").onclick=()=>run(v.querySelector("#q").value.trim()||"Where should I fish today?");
  return v;
}
function renderRec(text, ranked) {
  const top3 = ranked.slice(0,3).map((r)=>`
    <a class="card water-card" href="#/water/${r.water.id}">${scoreDial(r.score,r.band,52)}
      <div class="card-body"><div class="card-top"><h3>${esc(r.water.name)}</h3><span class="drive">${driveStr(r.water.driveMin)}</span></div>
      <p class="card-cond">${esc(r.reasons[0]?.text||"")}</p></div><span class="chev">›</span></a>`).join("");
  return `<div class="reco inline"><span class="reco-slash"></span><p>${esc(text)}</p></div><div class="cards">${top3}</div>`;
}

// ===== Score explainer (modal) ==============================================
function openScoreInfo() {
  const sheet = el(`<div class="scrim">
    <div class="sheet info-sheet" role="dialog" aria-modal="true" aria-labelledby="scoreInfoTitle">
      <div class="sheet-head"><h3 id="scoreInfoTitle">How the score works</h3><button class="x" id="closeInfo" aria-label="Close score explanation">✕</button></div>
      <p>Every water gets a <strong>bite score from 0 to 100</strong>. It's an estimate built from real data — a read on whether the <em>conditions</em> are right, not a live report that fish are actually being caught.</p>
      <p class="lbl">What goes into it</p>
      <ul class="info-list">
        <li><strong>Season</strong> — the biggest piece. Each water has a month-by-month baseline drawn from ODFW reports and fishery guides. (An alpine lake scores near zero in winter when it's snowed in; a river peaks during its hatch.)</li>
        <li><strong>River flow</strong> — for the river waters, live USGS gauge readings nudge the score up when flow sits in the ideal range, and down when it's running too high or too low.</li>
        <li><strong>Water temperature</strong> — 50–62°F adds points (the active range for trout); above 68°F takes some away.</li>
        <li><strong>Weather</strong> — strong wind pulls lake scores down, overcast skies lift trout scores, and storms knock it down.</li>
      </ul>
      <p>Open any water and check <strong>“Why that score”</strong> to see exactly which of these moved the number today.</p>
      <p class="lbl">Sources</p>
      <ul class="info-list sources">
        <li>River flow &amp; temp — <a href="https://waterservices.usgs.gov" target="_blank" rel="noopener">USGS Water Services</a></li>
        <li>Weather — <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></li>
        <li>Seasonal baselines &amp; fishery info — <a href="${ODFW_CENTRAL}" target="_blank" rel="noopener">Oregon Dept. of Fish &amp; Wildlife</a></li>
      </ul>
      <p class="muted small">It's a planning aid, not a guarantee — conditions being good doesn't promise the fish agree.</p>
    </div></div>`);
  document.body.appendChild(sheet);
  const close = manageDialog(sheet, "#closeInfo");
  sheet.querySelector("#closeInfo").onclick = close;
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
}

// ===== Log sheet (modal) ====================================================
function openLogSheet(water) {
  const today = new Date().toISOString().slice(0,10);
  const opts = WATERS.map((w)=>`<option value="${w.id}" ${water&&w.id===water.id?"selected":""}>${esc(w.name)}</option>`).join("");
  const speciesOpts = water ? water.species.map((s)=>`<option>${esc(s.name)}</option>`).join("") : WATERS.flatMap(w=>w.species.map(s=>s.name)).filter((v,i,a)=>a.indexOf(v)===i).map(n=>`<option>${esc(n)}</option>`).join("");
  const sheet = el(`<div class="scrim">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="logSheetTitle">
      <div class="sheet-head"><h3 id="logSheetTitle">Log a catch</h3><button class="x" id="closeSheet" aria-label="Close catch log">✕</button></div>
      <label>Date<input type="date" id="f-date" value="${today}"></label>
      <label>Water<select id="f-water">${opts}</select></label>
      <label>Species<input list="f-species-list" id="f-species" placeholder="e.g. Rainbow trout"><datalist id="f-species-list">${speciesOpts}</datalist></label>
      <div class="row2">
        <label>Length<input id="f-length" placeholder='e.g. 14"'></label>
        <label>What worked<input id="f-method" placeholder="e.g. wedding ring + corn"></label>
      </div>
      <label>Notes<textarea id="f-notes" rows="2" placeholder="Where on the water, depth, time of day…"></textarea></label>
      <button class="btn primary wide" id="saveCatch">Save</button>
    </div></div>`);
  document.body.appendChild(sheet);
  const close = manageDialog(sheet, "#f-date");
  sheet.querySelector("#closeSheet").onclick = close;
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  sheet.querySelector("#saveCatch").onclick = () => {
    const wid = sheet.querySelector("#f-water").value;
    const w = WATER_BY_ID[wid];
    addCatch({
      date: sheet.querySelector("#f-date").value,
      waterId: wid, waterName: w?.name || "",
      species: sheet.querySelector("#f-species").value,
      length: sheet.querySelector("#f-length").value,
      method: sheet.querySelector("#f-method").value,
      notes: sheet.querySelector("#f-notes").value,
      conditions: cachedFor(wid),
    });
    close(); toast("Catch logged."); render();
  };
}

// ===== Glossary popover + toast =============================================
document.addEventListener("click", (e) => {
  const t = e.target.closest(".term");
  if (!t) return;
  e.preventDefault();
  const key = t.dataset.term;
  const pop = el(`<div class="scrim light"><div class="glossary" role="dialog" aria-modal="true" aria-labelledby="glossaryTitle"><h4 id="glossaryTitle">${esc(key)}</h4><p>${esc(GLOSSARY[key]||"")}</p><button class="btn ghost" id="gx">Got it</button></div></div>`);
  document.body.appendChild(pop);
  const close = manageDialog(pop, "#gx");
  pop.querySelector("#gx").onclick=close;
  pop.onclick=(ev)=>{ if(ev.target===pop) close(); };
});
function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add("show"), 10);
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); }, 2200);
}

// ===== Router ================================================================
function route() {
  const hash = location.hash || "#/";
  const [, seg, arg] = hash.split("/");
  if (seg === "water" && arg) return viewWater(arg);
  if (seg === "waters") return viewWaters();
  if (seg === "log") return viewLog();
  if (seg === "ask") return viewAdvisor();
  if (seg === "spot") return viewSpot(arg);
  if (seg === "settings") return viewSpotSettings();
  return viewToday();
}
let activeSection = "#/";
function render() {
  const hash = location.hash || "#/";
  if (["#/", "#/waters", "#/ask", "#/log"].includes(hash)) activeSection = hash;
  disposeSpot();
  app.innerHTML = "";
  app.appendChild(route());
  updateSyncPill();
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.route === (hash.startsWith("#/water/") ? activeSection : hash.startsWith("#/spot") || hash === "#/settings" ? "#/spot" : hash);
    t.classList.toggle("on", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  app.scrollTop = 0; window.scrollTo(0,0);
}
window.addEventListener("hashchange", render);
// Background condition updates must not replace an active photo or settings form.
function renderAfterSync() {
  if (location.hash.startsWith("#/spot") || location.hash === "#/settings") { updateSyncPill(); return; }
  render();
}
window.addEventListener("online", () => sync(renderAfterSync));
window.addEventListener("offline", updateSyncPill);

// First paint immediately from cache; then sync in the background.
render();
sync(renderAfterSync);
startSpotQueue();

// Register service worker for offline/installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
