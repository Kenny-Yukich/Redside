// advisor.js — the "where should I fish" brain.
//
// The core is a transparent RULES ENGINE: it scores each water from the seasonal
// curve in data.js, then nudges the score with live flow + weather. It returns
// the number AND a plain-English list of reasons, so a beginner learns *why*.
// It runs entirely offline on cached data — no signal, no API needed.
//
// An optional AI layer (askAI) can answer free-form questions by calling a small
// serverless endpoint you deploy. If that endpoint isn't set up, the app just
// uses the rules engine. See functions/advisor.js and the README.

import { WATERS } from "./data.js";
import { cachedFor } from "./conditions.js";

// Clamp helper
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// Score one water for a given date. Returns { score, band, reasons[] }.
export function scoreWater(water, date = new Date()) {
  const month = date.getMonth();
  let score = water.monthlyBase[month];
  const reasons = [];

  // Seasonal baseline framing
  if (water.monthlyBase[month] >= 75) reasons.push({ good: true, text: `Prime season — ${water.name} is usually at its best right now.` });
  else if (water.monthlyBase[month] >= 55) reasons.push({ good: true, text: "Solid time of year to fish here." });
  else if (water.monthlyBase[month] <= 20) reasons.push({ good: false, text: "Off-season — this water is usually slow or closed now." });
  else reasons.push({ good: null, text: "A shoulder-season bet — can be good on the right day." });

  const c = cachedFor(water.id);

  // River flow adjustment
  if (water.type === "river" && water.idealFlow && c?.flow?.flowCfs != null) {
    const [lo, hi] = water.idealFlow;
    const f = c.flow.flowCfs;
    if (f >= lo && f <= hi) {
      score += 12;
      reasons.push({ good: true, text: `Flow is in the sweet spot at ${f.toLocaleString()} cfs.` });
    } else if (f < lo) {
      score -= 15;
      reasons.push({ good: false, text: `Running low at ${f.toLocaleString()} cfs — thin, tougher water.` });
    } else {
      score -= 18;
      reasons.push({ good: false, text: `Running high at ${f.toLocaleString()} cfs — pushy and off-color; wade with care.` });
    }
  } else if (water.type === "river" && !c?.flow) {
    reasons.push({ good: null, text: "No live flow yet — sync when you have signal to sharpen this." });
  }

  // Water temperature (rivers)
  if (c?.flow?.waterTempF != null) {
    const t = c.flow.waterTempF;
    if (t >= 50 && t <= 62) { score += 4; reasons.push({ good: true, text: `Water temp ${t}°F — right in the active range for trout.` }); }
    else if (t > 68) { score -= 8; reasons.push({ good: false, text: `Water temp ${t}°F — warm; fish early, they'll be stressed midday.` }); }
  }

  // Weather: wind hurts lakes a lot; overcast helps trout; storms hurt.
  const wx = c?.weather;
  if (wx) {
    const wind = wx.today?.windMax ?? wx.windMph;
    if (wind != null) {
      if (wind >= 20 && water.type === "reservoir") { score -= 12; reasons.push({ good: false, text: `Wind to ${wind} mph — the lake will be choppy and hard to fish.` }); }
      else if (wind >= 25) { score -= 8; reasons.push({ good: false, text: `Windy (to ${wind} mph) — pick sheltered water.` }); }
      else if (wind <= 8) { score += 4; reasons.push({ good: true, text: `Light wind (~${wind} mph) — calm, easy conditions.` }); }
    }
    const code = wx.today?.code;
    if (code === 3 || code === 2) { score += 5; reasons.push({ good: true, text: "Cloud cover — trout feed more confidently under gray skies." }); }
    if (code >= 95) { score -= 10; reasons.push({ good: false, text: "Thunderstorms in the forecast — a safety call, not just a fishing one." }); }
    if (wx.today?.precipPct != null && wx.today.precipPct >= 70 && code < 95) {
      reasons.push({ good: null, text: `${wx.today.precipPct}% chance of rain — pack a shell.` });
    }
  } else {
    reasons.push({ good: null, text: "No weather synced yet — connect once to fill this in." });
  }

  score = clamp(Math.round(score));
  const band = score >= 70 ? "hot" : score >= 45 ? "fair" : "slow";
  return { score, band, reasons };
}

// Rank all waters for a date, optionally filtered by max drive minutes.
export function rankWaters(date = new Date(), maxDriveMin = Infinity) {
  return WATERS
    .filter((w) => w.driveMin <= maxDriveMin)
    .map((w) => ({ water: w, ...scoreWater(w, date) }))
    .sort((a, b) => b.score - a.score);
}

// Build a short plain-language recommendation from the top result(s).
export function recommend(date = new Date(), maxDriveMin = Infinity) {
  const ranked = rankWaters(date, maxDriveMin);
  if (!ranked.length) return { text: "No waters within that drive time. Widen the range?", ranked };
  const top = ranked[0];
  const target = top.water.species.find((s) => s.rank === "signature" || s.rank === "primary");
  const drive = top.water.driveMin < 60 ? `${top.water.driveMin} min` : `~${(top.water.driveMin / 60).toFixed(1)} hr`;
  let text = `Top pick: ${top.water.name} (${drive} away). `;
  if (top.band === "hot") text += "It's firing right now — ";
  else if (top.band === "fair") text += "A fair bet today — ";
  else text += "Nothing's on fire, but of your options — ";
  if (target) text += `go after ${target.name.toLowerCase()}.`;
  return { text, ranked };
}

// ---- Optional AI layer -------------------------------------------------------
// Posts the current conditions + the water knowledge base to your serverless
// endpoint (which holds the Anthropic key). Falls back gracefully if unset.
const AI_ENDPOINT = "/api/advisor"; // change if you deploy elsewhere

export async function askAI(question, date = new Date()) {
  const ranked = rankWaters(date);
  const context = ranked.map((r) => ({
    name: r.water.name,
    driveMin: r.water.driveMin,
    score: r.score,
    reasons: r.reasons.map((x) => x.text),
    species: r.water.species.map((s) => ({ name: s.name, when: s.when })),
    conditions: cachedFor(r.water.id),
  }));
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, date: date.toISOString(), context }),
  });
  if (!res.ok) throw new Error(`advisor endpoint ${res.status}`);
  const data = await res.json();
  return data.answer;
}
