// app.js — Redside UI. Vanilla JS, no build step. A tiny hash router renders
// each view into #app; a bottom tab bar switches sections.

import { WATERS, WATER_BY_ID, GLOSSARY, ODFW_CENTRAL, ODFW_REGS } from "./data.js";
import { refreshAll, cachedFor, ageLabel, skyLabel } from "./conditions.js";
import { rankWaters, scoreWater, recommend, askAI } from "./advisor.js";
import { getCatches, addCatch, deleteCatch, catchesForWater, stats, exportJSON, importJSON } from "./log.js";

const app = document.getElementById("app");
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const driveStr = (m) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} hr`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  if (!p) return;
  if (!navigator.onLine) { p.textContent = "Offline — showing last sync"; p.className = "sync-pill offline"; return; }
  p.textContent = syncing ? "Syncing conditions…" : "Conditions up to date";
  p.className = "sync-pill" + (syncing ? " busy" : "");
}

// ---- Bite-score dial (SVG) --------------------------------------------------
function dial(score, band, size = 64) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return `<svg class="dial ${band}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" class="dial-track"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" class="dial-fill"
      stroke-dasharray="${c}" stroke-dashoffset="${off}"
      transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="52%" class="dial-num">${score}</text>
  </svg>`;
}

// ===== TODAY =================================================================
let driveFilter = 45; // "after-work" default; Infinity for "anywhere"
function viewToday() {
  const now = new Date();
  const { text, ranked } = recommend(now, driveFilter);
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  const cards = ranked.map((r) => {
    const w = r.water, c = cachedFor(w.id);
    const bits = [];
    if (c?.flow?.flowCfs != null) bits.push(`${c.flow.flowCfs.toLocaleString()} cfs`);
    if (c?.weather) bits.push(`${skyLabel(c.weather.today?.code)}, ${c.weather.today?.hi}°/${c.weather.today?.lo}°`);
    if (c?.weather?.today?.windMax != null) bits.push(`wind ${c.weather.today.windMax}`);
    const target = w.species.find((s) => s.rank === "signature" || s.rank === "primary");
    return `<a class="card water-card" href="#/water/${w.id}">
      ${dial(r.score, r.band)}
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
      <div class="hero-eyebrow">Central Oregon · ${esc(dateStr)}</div>
      <h1 class="hero-title">Where to fish</h1>
      <p id="sync-pill" class="sync-pill">Checking…</p>
      <div class="reco"><span class="reco-slash"></span><p>${esc(text)}</p></div>
    </header>
    <div class="filter-row">
      <button class="chip ${driveFilter===45?"on":""}" data-drive="45">Within 45 min</button>
      <button class="chip ${driveFilter===Infinity?"on":""}" data-drive="inf">Anywhere</button>
      <button class="chip ghost" id="resync">Sync now</button>
    </div>
    <div class="cards">${cards}</div>
  </section>`);

  v.querySelectorAll("[data-drive]").forEach((b) => b.onclick = () => {
    driveFilter = b.dataset.drive === "inf" ? Infinity : 45; render();
  });
  v.querySelector("#resync").onclick = () => sync(render);
  return v;
}

// ===== WATERS LIST ==========================================================
function viewWaters() {
  const now = new Date();
  const rows = WATERS.slice().sort((a,b)=>a.driveMin-b.driveMin).map((w) => {
    const r = scoreWater(w, now);
    return `<a class="card water-card" href="#/water/${w.id}">
      ${dial(r.score, r.band, 52)}
      <div class="card-body">
        <div class="card-top"><h3>${esc(w.name)}</h3><span class="drive">${driveStr(w.driveMin)}</span></div>
        <p class="card-sub">${esc(w.tagline)}</p>
      </div><span class="chev">›</span></a>`;
  }).join("");
  return el(`<section class="view">
    <header class="page-head"><h1>Your waters</h1><p class="muted">Seven spots, sorted by drive from Madras.</p></header>
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
    <a class="back" href="#/">‹ Today</a>
    <header class="water-hero">
      ${dial(r.score, r.band, 76)}
      <div><h1>${esc(w.name)}</h1><p class="muted">${esc(w.tagline)} · ${driveStr(w.driveMin)} from Madras</p></div>
    </header>
    <p class="intro">${esc(w.intro)}</p>
    <div class="panel"><div class="panel-head"><span>Why that score</span></div><ul class="reasons">${reasons}</ul></div>
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
  return v;
}
function cell(label, val, sub) {
  return `<div class="gauge"><span class="gauge-val">${esc(val)}</span><span class="gauge-lbl">${esc(label)}</span><span class="gauge-sub">${esc(sub)}</span></div>`;
}

// ===== CATCH LOG ============================================================
function logRow(c) {
  return `<li class="log-row" data-id="${c.id}">
    <div><strong>${esc(c.species||"Fish")}</strong> ${c.length?`· ${esc(c.length)}`:""}
      <span class="muted small">${esc(c.date)}${c.waterName?` · ${esc(c.waterName)}`:""}</span></div>
    ${c.method?`<div class="muted small">Worked: ${esc(c.method)}</div>`:""}
    ${c.notes?`<div class="small">${esc(c.notes)}</div>`:""}
    <button class="del" data-del="${c.id}" aria-label="Delete">✕</button>
  </li>`;
}
function viewLog() {
  const list = getCatches();
  const s = stats();
  const topWater = Object.entries(s.byWater).sort((a,b)=>b[1]-a[1])[0];
  const v = el(`<section class="view">
    <header class="page-head"><h1>Catch log</h1>
      <p class="muted">Stays on this phone. Export a backup before you switch devices.</p></header>
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
    <header class="page-head"><h1>Ask</h1>
      <p class="muted">Describe your day — time, target, how far you'll drive.</p></header>
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
    <a class="card water-card" href="#/water/${r.water.id}">${dial(r.score,r.band,52)}
      <div class="card-body"><div class="card-top"><h3>${esc(r.water.name)}</h3><span class="drive">${driveStr(r.water.driveMin)}</span></div>
      <p class="card-cond">${esc(r.reasons[0]?.text||"")}</p></div><span class="chev">›</span></a>`).join("");
  return `<div class="reco inline"><span class="reco-slash"></span><p>${esc(text)}</p></div><div class="cards">${top3}</div>`;
}

// ===== Log sheet (modal) ====================================================
function openLogSheet(water) {
  const today = new Date().toISOString().slice(0,10);
  const opts = WATERS.map((w)=>`<option value="${w.id}" ${water&&w.id===water.id?"selected":""}>${esc(w.name)}</option>`).join("");
  const speciesOpts = water ? water.species.map((s)=>`<option>${esc(s.name)}</option>`).join("") : WATERS.flatMap(w=>w.species.map(s=>s.name)).filter((v,i,a)=>a.indexOf(v)===i).map(n=>`<option>${esc(n)}</option>`).join("");
  const sheet = el(`<div class="scrim">
    <div class="sheet">
      <div class="sheet-head"><h3>Log a catch</h3><button class="x" id="closeSheet">✕</button></div>
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
  const close = () => sheet.remove();
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
  const pop = el(`<div class="scrim light"><div class="glossary"><h4>${esc(key)}</h4><p>${esc(GLOSSARY[key]||"")}</p><button class="btn ghost" id="gx">Got it</button></div></div>`);
  document.body.appendChild(pop);
  const close=()=>pop.remove();
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
  return viewToday();
}
function render() {
  app.innerHTML = "";
  app.appendChild(route());
  updateSyncPill();
  document.querySelectorAll(".tab").forEach((t)=>t.classList.toggle("on", t.dataset.route === (location.hash||"#/")));
  app.scrollTop = 0; window.scrollTo(0,0);
}
window.addEventListener("hashchange", render);
window.addEventListener("online", () => sync(render));
window.addEventListener("offline", updateSyncPill);

// First paint immediately from cache; then sync in the background.
render();
sync(render);

// Register service worker for offline/installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
