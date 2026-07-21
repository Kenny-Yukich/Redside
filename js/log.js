// log.js — the catch log. Purely local (stored on this device), which is exactly
// what we planned: no accounts, no server, no sharing. Includes JSON export/import
// so the log survives a phone swap — the one way to move it between devices.

const KEY = "redside.catchlog.v1";

export function getCatches() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function addCatch(entry) {
  const list = getCatches();
  const rec = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    date: entry.date || new Date().toISOString().slice(0, 10),
    waterId: entry.waterId || "",
    waterName: entry.waterName || "",
    species: entry.species || "",
    length: entry.length || "",
    method: entry.method || "",   // what worked: bait/lure/fly
    notes: entry.notes || "",
    // snapshot of conditions at the time, if we have them — this is what makes
    // the log valuable later ("you caught fish here when flow was X").
    conditions: entry.conditions || null,
  };
  list.unshift(rec);
  save(list);
  return rec;
}

export function deleteCatch(id) {
  save(getCatches().filter((c) => c.id !== id));
}

export function catchesForWater(waterId) {
  return getCatches().filter((c) => c.waterId === waterId);
}

// Simple stats to hand back to the angler over time.
export function stats() {
  const list = getCatches();
  const byWater = {};
  const bySpecies = {};
  for (const c of list) {
    if (c.waterName) byWater[c.waterName] = (byWater[c.waterName] || 0) + 1;
    if (c.species) bySpecies[c.species] = (bySpecies[c.species] || 0) + 1;
  }
  return { total: list.length, byWater, bySpecies };
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify(getCatches(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `redside-catchlog-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(text, { merge = true } = {}) {
  const incoming = JSON.parse(text);
  if (!Array.isArray(incoming)) throw new Error("That file isn't a catch log.");
  const current = merge ? getCatches() : [];
  const seen = new Set(current.map((c) => c.id));
  for (const c of incoming) {
    if (!seen.has(c.id)) { current.push(c); seen.add(c.id); }
  }
  current.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  save(current);
  return current.length;
}
