// conditions.js — fetch live flow (USGS) + weather (Open-Meteo), cache for offline.
// Both APIs are free and need no key. Results are stored in localStorage with a
// timestamp so the app still shows the last-known conditions with zero signal.

import { WATERS } from "./data.js";

const CACHE_KEY = "redside.conditions.v1";
const cache = loadCache();

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export function cachedFor(waterId) {
  return cache[waterId] || null;
}

export function ageLabel(ts) {
  if (!ts) return "never synced";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

// ---- USGS instantaneous flow -------------------------------------------------
// Docs: waterservices.usgs.gov/nwis/iv. 00060 = discharge (cfs),
// 00065 = gage height (ft), 00010 = water temp (°C).
async function fetchFlow(siteId) {
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteId}` +
    `&parameterCd=00060,00065,00010&siteStatus=all`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS ${res.status}`);
  const data = await res.json();
  const series = data?.value?.timeSeries || [];
  const out = {};
  for (const s of series) {
    const code = s?.variable?.variableCode?.[0]?.value;
    const val = parseFloat(s?.values?.[0]?.value?.[0]?.value);
    if (Number.isNaN(val)) continue;
    if (code === "00060") out.flowCfs = Math.round(val);
    if (code === "00065") out.gageFt = val;
    if (code === "00010") out.waterTempF = Math.round((val * 9) / 5 + 32);
  }
  return out;
}

// ---- Open-Meteo weather ------------------------------------------------------
async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,` +
    `wind_speed_10m_max,weather_code&temperature_unit=fahrenheit` +
    `&wind_speed_unit=mph&timezone=America%2FLos_Angeles&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  return {
    tempF: Math.round(d.current?.temperature_2m),
    windMph: Math.round(d.current?.wind_speed_10m),
    code: d.current?.weather_code,
    today: {
      hi: Math.round(d.daily?.temperature_2m_max?.[0]),
      lo: Math.round(d.daily?.temperature_2m_min?.[0]),
      windMax: Math.round(d.daily?.wind_speed_10m_max?.[0]),
      precipPct: d.daily?.precipitation_probability_max?.[0] ?? null,
      code: d.daily?.weather_code?.[0],
    },
  };
}

// WMO weather codes -> plain words + a matching emoji-free label.
export function skyLabel(code) {
  if (code == null) return "—";
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

// Refresh one water. Never throws — returns whatever it managed to get, and
// keeps the last good value on failure so offline still shows something.
export async function refreshWater(water) {
  const prev = cache[water.id] || {};
  const next = { ...prev };
  const results = await Promise.allSettled([
    water.gauge ? fetchFlow(water.gauge) : Promise.resolve(null),
    fetchWeather(water.lat, water.lon),
  ]);
  if (results[0].status === "fulfilled" && results[0].value) {
    next.flow = results[0].value;
    next.flowTs = Date.now();
  }
  if (results[1].status === "fulfilled" && results[1].value) {
    next.weather = results[1].value;
    next.weatherTs = Date.now();
  }
  next.ts = Date.now();
  next.online = navigator.onLine;
  cache[water.id] = next;
  saveCache();
  return next;
}

// Refresh everything (used on app open when online).
export async function refreshAll(onEach) {
  for (const w of WATERS) {
    const c = await refreshWater(w);
    if (onEach) onEach(w.id, c);
  }
}
