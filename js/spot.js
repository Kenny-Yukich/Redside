import { WATERS, HOME } from "./data.js";
import { getSpotSettings } from "./spot-settings.js";
import { nearestWater, spotContext } from "./spot-context.js";
import { preparePhoto, cellCenter, annotatePhoto } from "./spot-media.js";
import { getPlan, listPlans, savePlan, updatePlan, deletePlan } from "./spot-store.js";
import { mountSpotMap } from "./spot-map.js";
import { processSpotQueue, notifyPlans } from "./spot-queue.js";
import { addCatch } from "./log.js";
import { normalizeObservations, FACING_LABELS } from "./spot-observations.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const allSpecies = [...new Set(WATERS.flatMap(water => water.species.map(species => species.name)))];
let activeDraft = { lat: null, lon: null, heading: null, species: [], tackle: null, confirmed: false, media: null };
let cleanup = () => {};
export function disposeSpot() { cleanup(); cleanup = () => {}; }
function validPosition(lat, lon) { return Number.isFinite(lat) && Math.abs(lat) <= 85 && Number.isFinite(lon) && Math.abs(lon) <= 180; }
function displayName(plan) { return plan.inputs.observations?.location || plan.inputs.context.water?.name || "Unknown water"; }

function observationFields(value = {}) {
  const input = (key, type, attributes = "") => `<input name="obs_${key}" data-observation="${key}" type="${type}" value="${esc(value[key] ?? "")}" ${attributes}>`;
  return `<div class="spot-observations" data-observations>
    <p class="muted small">Optional. Tell the guide what the photo cannot: where you are, when it was taken, and what you noticed.</p>
    <label>Water & landmark${input("location", "text", 'maxlength="200" placeholder="Deschutes River, upstream of Steelhead Falls"')}</label>
    <label>Describe this spot<textarea name="obs_notes" data-observation="notes" rows="3" maxlength="1600" placeholder="Fishing from the bank. Clear water, light wind, a few fish rising. No bites on a spinner yet.">${esc(value.notes || "")}</textarea></label>
    <div class="row2"><label>Photo date${input("photoDate", "date")}</label><label>Time at the spot${input("photoTime", "time")}</label></div>
    <p class="muted small">Use the date and local time when the photo was taken. Leave anything you do not know blank.</p>
    <label>The photo faces<select name="obs_facing" data-observation="facing"><option value="">Choose if known</option>${Object.entries(FACING_LABELS).map(([key, label]) => `<option value="${key}" ${value.facing === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <details class="spot-conditions"><summary>Temperature & conditions</summary>
      <div class="row2"><label>Air temperature (°F)${input("airTempF", "number", 'min="-80" max="140" step="0.1" placeholder="If known"')}</label><label>Water temperature (°F)${input("waterTempF", "number", 'min="28" max="120" step="0.1" placeholder="If measured"')}</label></div>
      <p class="muted small">Add cloud cover, wind, water clarity, flow, insect activity, or what you have tried in your description above. Current weather may differ from conditions in an older photo.</p>
    </details></div>`;
}

function readObservations(form) {
  return Object.fromEntries([...form.querySelectorAll("[data-observation]")].map(input => [input.dataset.observation, input.value]));
}

function observationSummary(observations) {
  if (!observations || !Object.keys(observations).length) return '<p class="muted small">No extra spot details added.</p>';
  const labels = { location: "Water & landmark", notes: "Your description", photoDate: "Photo date", photoTime: "Time at the spot", facing: "Photo faces", airTempF: "Air temperature", waterTempF: "Water temperature" };
  return `<div class="spot-observation-summary"><p class="muted small">Reported by you when requesting this plan.</p>${Object.entries(labels).filter(([key]) => observations[key] !== undefined).map(([key, label]) => `<p><strong>${label}:</strong> ${esc(key === "facing" ? FACING_LABELS[observations[key]] : key.endsWith("TempF") ? `${observations[key]} °F` : observations[key])}</p>`).join("")}</div>`;
}

export function viewSpot(planId) {
  const view = document.createElement("section");
  view.className = "view spot-view";
  view.innerHTML = `<header class="page-head spot-head"><div><span class="scenic-kicker">Your next cast</span><h1>Fish This Spot</h1></div><a class="btn ghost" href="#/settings">Settings</a></header>
    <p class="muted">A photo, your position, and a plan to try.</p>
    ${planId ? '<a class="back" href="#/spot">‹ New photo & saved plans</a><div data-plan-result></div>' : '<div data-compose></div><h2 class="sec">Saved plans</h2><div data-saved-plans></div>'}
    <p data-spot-status role="status" aria-live="polite"></p>`;
  let disposed = false;
  let innerCleanup = () => {};
  let renderedSignature;
  const status = message => { if (!disposed) view.querySelector("[data-spot-status]").textContent = message; };
  let updateRevision = 0;
  const update = async event => {
    if (planId && event?.detail?.id && event.detail.id !== planId) return;
    const revision = ++updateRevision;
    try {
      if (planId) {
        const plan = await getPlan(planId);
        if (disposed || revision !== updateRevision) return;
        const signature = plan && JSON.stringify({ ...plan, photo: undefined, griddedPhoto: undefined, annotatedPhoto: undefined });
        if (signature && signature === renderedSignature) return;
        renderedSignature = signature;
        innerCleanup();
        if (!plan) { view.querySelector("[data-plan-result]").textContent = "This plan is not saved on this device. Catch log backups keep the plan link, but do not include photos."; return; }
        innerCleanup = renderPlan(view.querySelector("[data-plan-result]"), plan, status);
      } else {
        const plans = await listPlans();
        if (disposed || revision !== updateRevision) return;
        view.querySelector("[data-saved-plans]").innerHTML = plans.length ? plans.map(plan => `<a class="panel spot-saved" href="#/spot/${encodeURIComponent(plan.id)}"><strong>${esc(displayName(plan))}</strong><span>${esc(new Date(plan.createdAt).toLocaleString())}</span><span class="tag">${esc({ ready: "Ready offline", question: "Needs your answer", analyzing: "Analyzing…", queued: "Queued for signal", error: "Needs retry" }[plan.status] || plan.status)}</span></a>`).join("") : '<p class="muted">Your photos and plans will be saved here, on this device.</p>';
      }
    } catch (error) { status(error.message); }
  };
  const storageError = event => status(event.detail);
  window.addEventListener("spot-plans-changed", update);
  window.addEventListener("spot-storage-error", storageError);
  if (!planId) innerCleanup = renderComposer(view.querySelector("[data-compose]"), status);
  cleanup = () => { disposed = true; innerCleanup(); window.removeEventListener("spot-plans-changed", update); window.removeEventListener("spot-storage-error", storageError); };
  update();
  return view;
}

function renderComposer(root, status) {
  const draft = activeDraft;
  const settings = getSpotSettings();
  if (draft.tackle === null) draft.tackle = [...settings.tackle];
  let disposed = false, map = null, previewURL = null, compassCleanup = () => {}, positionRevision = 0, photoRevision = 0;
  let compassRevision = 0, manualPositionRevision = 0, preparing = false;
  let manuallyFaced = draft.heading !== null;
  root.innerHTML = `<form class="spot-form" data-spot-form>
    <div class="panel"><h2>1. Your photo</h2><div class="filter-row">
      <label class="btn primary spot-file">Take photo<input data-photo-camera type="file" accept="image/*" capture="environment"></label>
      <label class="btn ghost spot-file">Photo library<input data-photo-library type="file" accept="image/*"></label></div>
      <p data-photo-status role="status" aria-live="polite"></p>
      <div data-preview></div><p class="muted small">Choose a JPG, PNG, or another image your browser can open. If an iPhone HEIC photo will not open, export a JPEG copy first. The original stays on your device.</p></div>
    <div class="panel"><h2>2. Tell us about this spot</h2>${observationFields(draft.observations)}</div>
    <div class="panel"><h2>3. Position & facing</h2>
      <p class="muted small">Drag the pin to where you took the photo. Drag the gold arrow away from the pin in the direction you were facing. North is up.</p>
      <div class="spot-map" data-map aria-label="Satellite map: photo position and facing direction"></div>
      <div class="panel" data-map-error hidden role="alert"><h3>Satellite map unavailable</h3><p data-map-error-message></p><p>Your photo, GPS position, and heading are still available. Use the coordinate and heading fields below.</p><a class="spot-link" href="#/settings">Check map settings</a> <button class="btn ghost" type="button" data-map-retry>Retry map</button></div>
      <p class="muted small" data-map-status>Loading map…</p>
      <div class="filter-row"><button class="btn ghost" type="button" data-gps>Use live GPS</button><button class="btn ghost" type="button" data-compass>Use live compass</button></div>
      <div class="row2"><label>Latitude<input name="lat" type="number" step="any" min="-85" max="85" required></label><label>Longitude<input name="lon" type="number" step="any" min="-180" max="180" required></label></div>
      <label>Facing (degrees clockwise from north)<input name="heading" type="number" min="0" max="359.99" step="any" required placeholder="Drag the arrow or use compass"></label>
      <p class="muted small" data-water></p>
      <label class="spot-check"><input name="confirmed" type="checkbox" required> This is where I took the photo and the direction I faced.</label>
      <p class="muted small">Satellite imagery may be years old. The shoreline and reservoir level may differ today.</p></div>
    <div class="panel"><h2>4. Target & tackle</h2><fieldset><legend>Target species</legend><div data-species></div></fieldset>
      <label>Another species (optional)<input name="otherSpecies" maxlength="100" placeholder="Add a target"></label>
      <fieldset><legend>What I brought</legend><div data-tackle>${settings.tackle.length ? settings.tackle.map(item => `<label class="spot-check"><input type="checkbox" name="tackle" value="${esc(item)}" ${draft.tackle.includes(item) ? "checked" : ""}> ${esc(item)}</label>`).join("") : '<p class="muted small">Add your gear to <a class="spot-link" href="#/settings">My Tackle in Settings</a>. Without a list, the plan will suggest tackle.</p>'}</div></fieldset></div>
    <p class="muted small">Analyze sends the gridded photo, confirmed coordinates, facing, selected gear, and Redside conditions to your Worker and Claude. Mapbox supplies the overhead image.</p>
    <button class="btn primary wide" data-analyze type="submit">${navigator.onLine ? "Analyze this spot" : "Save & queue analysis"}</button>
    <p class="muted small">Saved plans open offline. Queued photos run when signal returns while Redside is open; reopen the app to resume.</p>
  </form>`;
  const form = root.querySelector("form");
  const photoStatus = message => {
    if (disposed) return;
    root.querySelector("[data-photo-status]").textContent = message;
    status(message);
  };
  const mapStatus = message => { if (!disposed) root.querySelector("[data-map-status]").textContent = message; };
  const mapError = message => {
    if (disposed) return;
    root.querySelector("[data-map]").hidden = true;
    root.querySelector("[data-map-error]").hidden = false;
    root.querySelector("[data-map-error-message]").textContent = message;
    mapStatus("");
  };
  function refreshControls() {
    if (disposed) return;
    form.querySelectorAll("input, button, textarea, select").forEach(control => { control.disabled = Boolean(draft.saving); });
    form.querySelector("[data-analyze]").disabled = Boolean(draft.saving || preparing);
    if (draft.savedPlanId) status("This photo is already saved. Analyze opens its saved plan.");
  }
  window.addEventListener("spot-draft-changed", refreshControls);
  function stopCompass() { compassRevision++; compassCleanup(); compassCleanup = () => {}; }
  function invalidateConfirmation() { draft.savedPlanId = null; draft.confirmed = false; form.elements.confirmed.checked = false; }
  function drawPreview() {
    if (previewURL) URL.revokeObjectURL(previewURL);
    if (draft.media) {
      previewURL = URL.createObjectURL(draft.media.photo);
      root.querySelector("[data-preview]").innerHTML = `<img class="spot-preview" src="${previewURL}" alt="Your clean fishing photo">`;
    }
  }
  let speciesWater;
  function updateWater() {
    const nearest = validPosition(draft.lat, draft.lon) ? nearestWater(draft.lat, draft.lon) : { water: null };
    const water = nearest.water;
    root.querySelector("[data-water]").textContent = water ? `${water.name} · nearest Redside reference, ${Math.round(nearest.distanceMeters)} m away. Position is matched to a reference point, not a water boundary.` : "Unknown water · no Redside reference within 2 km. Pick your target below.";
    const key = water?.id || "unknown";
    if (speciesWater === key) return;
    if (speciesWater !== undefined || !draft.species.length) draft.species = water ? water.species.map(item => item.name) : [];
    speciesWater = key;
    const choices = [...new Set([...(water?.species.map(item => item.name) || []), ...allSpecies])];
    root.querySelector("[data-species]").innerHTML = choices.map(name => `<label class="spot-check"><input type="checkbox" name="species" value="${esc(name)}" ${draft.species.includes(name) ? "checked" : ""}> ${esc(name)}</label>`).join("");
  }
  function setPosition(lat, lon, pan = false) {
    if (draft.saving) return;
    positionRevision++;
    draft.lat = lat; draft.lon = lon;
    form.elements.lat.value = lat.toFixed(6); form.elements.lon.value = lon.toFixed(6);
    invalidateConfirmation(); updateWater(); map?.update(lat, lon, draft.heading, pan);
  }
  function setHeading(heading, manual = false) {
    if (draft.saving) return;
    if (manual) { manuallyFaced = true; stopCompass(); }
    draft.heading = ((heading % 360) + 360) % 360;
    form.elements.heading.value = (Math.round(draft.heading * 100) / 100) % 360;
    invalidateConfirmation();
    if (validPosition(draft.lat, draft.lon)) map?.update(draft.lat, draft.lon, draft.heading);
  }
  async function useCompass() {
    if (draft.saving) return;
    stopCompass(); manuallyFaced = false;
    const revision = compassRevision;
    try {
      const Orientation = window.DeviceOrientationEvent;
      if (!Orientation) throw new Error("Compass unavailable. Drag the arrow or enter a heading.");
      if (typeof Orientation.requestPermission === "function" && await Orientation.requestPermission() !== "granted") throw new Error("Compass permission was not granted. You can still drag the arrow.");
      if (disposed || manuallyFaced || revision !== compassRevision || draft.saving) return;
      mapStatus("Point the phone in the photo direction. You can always drag the arrow to override.");
      const read = event => {
        if (disposed || manuallyFaced || revision !== compassRevision || draft.saving) return;
        const heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : event.absolute && Number.isFinite(event.alpha) ? 360 - event.alpha : null;
        if (heading === null || (Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy < 0)) return;
        setHeading(heading);
        mapStatus("Compass facing filled in. Check it against the photo, then confirm below.");
        stopCompass();
      };
      window.addEventListener("deviceorientation", read);
      window.addEventListener("deviceorientationabsolute", read);
      const timer = setTimeout(() => { if (revision !== compassRevision) return; stopCompass(); mapStatus("No compass reading. Drag the arrow or enter a heading."); }, 15000);
      compassCleanup = () => { window.removeEventListener("deviceorientation", read); window.removeEventListener("deviceorientationabsolute", read); clearTimeout(timer); };
    } catch (error) { if (revision === compassRevision) mapStatus(error.message); }
  }
  function useGPS() {
    if (draft.saving) return;
    if (!navigator.geolocation) { mapStatus("GPS unavailable. Place the pin or enter coordinates."); return; }
    const revision = positionRevision;
    mapStatus("Finding your live position…");
    navigator.geolocation.getCurrentPosition(position => {
      if (disposed || revision !== positionRevision || draft.saving) return;
      setPosition(position.coords.latitude, position.coords.longitude, true);
      mapStatus(`Live GPS accuracy about ${Math.round(position.coords.accuracy)} m. Drag the pin for an older photo.`);
    }, () => { if (revision === positionRevision) mapStatus("GPS unavailable or permission denied. Tap the map or enter the photo coordinates."); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }
  form.elements.lat.value = draft.lat ?? ""; form.elements.lon.value = draft.lon ?? "";
  form.elements.heading.value = draft.heading ?? ""; form.elements.confirmed.checked = draft.confirmed;
  form.elements.otherSpecies.value = draft.otherSpecies || "";
  drawPreview(); updateWater();
  refreshControls();
  root.querySelector("[data-gps]").onclick = useGPS;
  root.querySelector("[data-compass]").onclick = useCompass;
  root.querySelector("[data-photo-camera]").onclick = () => { if (!manuallyFaced) useCompass(); };
  for (const input of root.querySelectorAll("input[type=file]")) input.onchange = async () => {
    if (draft.saving) return;
    const file = input.files[0]; if (!file) return;
    const revision = ++photoRevision;
    input.dataset.photoRevision = String(revision);
    const manualRevision = manualPositionRevision;
    positionRevision++;
    preparing = true;
    refreshControls();
    photoStatus("Preparing your photo…");
    try {
      const media = await preparePhoto(file);
      if (disposed || revision !== photoRevision) return;
      draft.media = media; invalidateConfirmation(); drawPreview();
      photoStatus("Photo ready. Confirm position and facing, then pick your target.");
      if (manualRevision === manualPositionRevision) useGPS();
    } catch (error) {
      if (revision === photoRevision) photoStatus(`${error.message}${draft.media ? " Your previous photo is still selected." : " Choose another photo to continue."}`);
    }
    finally {
      if (input.dataset.photoRevision === String(revision)) input.value = "";
      if (!disposed && revision === photoRevision) { preparing = false; refreshControls(); }
    }
  };
  form.oninput = event => {
    if (draft.saving) return;
    draft.savedPlanId = null;
    const name = event.target.name;
    if (event.target.dataset.observation) draft.observations = readObservations(form);
    if (name === "lat" || name === "lon") {
      manualPositionRevision++;
      positionRevision++;
      draft.lat = form.elements.lat.value === "" ? null : Number(form.elements.lat.value);
      draft.lon = form.elements.lon.value === "" ? null : Number(form.elements.lon.value);
      invalidateConfirmation(); updateWater();
      if (validPosition(draft.lat, draft.lon)) map?.update(draft.lat, draft.lon, draft.heading, true);
    }
    if (name === "heading") {
      if (event.target.value === "") { manuallyFaced = true; stopCompass(); draft.heading = null; invalidateConfirmation(); }
      else setHeading(Number(event.target.value), true);
    }
    if (name === "species") draft.species = [...form.querySelectorAll('[name="species"]:checked')].map(input => input.value);
    if (name === "tackle") draft.tackle = [...form.querySelectorAll('[name="tackle"]:checked')].map(input => input.value);
    if (name === "otherSpecies") draft.otherSpecies = event.target.value;
    if (name === "confirmed") draft.confirmed = event.target.checked;
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (draft.saving || preparing) return;
    if (draft.savedPlanId) { location.hash = `#/spot/${draft.savedPlanId}`; return; }
    if (!draft.media) { status("Take or choose a photo first."); return; }
    if (!validPosition(draft.lat, draft.lon) || !Number.isFinite(draft.heading) || !draft.confirmed) { status("Confirm your photo position and facing direction."); return; }
    const species = [...new Set([...draft.species, draft.otherSpecies?.trim()].filter(Boolean))];
    if (!species.length) { status("Pick at least one target species."); return; }
    let observations;
    try { observations = normalizeObservations(readObservations(form)); }
    catch (error) { status(error.message); return; }
    draft.saving = true;
    stopCompass(); positionRevision++;
    refreshControls();
    try {
      const plan = { id: crypto.randomUUID(), createdAt: Date.now(), status: "queued", photo: draft.media.photo, griddedPhoto: draft.media.griddedPhoto,
        grid: draft.media.grid, annotatedPhoto: null, result: null, inputs: { lat: draft.lat, lon: draft.lon, heading: draft.heading, species,
          tackle: draft.tackle.filter(item => settings.tackle.includes(item)), context: spotContext(draft.lat, draft.lon), answers: [],
          ...(Object.keys(observations).length ? { observations } : {}) } };
      await savePlan(plan);
      navigator.storage?.persist?.().catch(() => {});
      draft.savedPlanId = plan.id;
      if (!disposed && activeDraft === draft) {
        activeDraft = { lat: null, lon: null, heading: null, species: [], tackle: null, confirmed: false, media: null };
        location.hash = `#/spot/${plan.id}`;
      }
      notifyPlans(plan.id); processSpotQueue();
    } catch (error) { status(error.message); }
    finally { draft.saving = false; window.dispatchEvent(new Event("spot-draft-changed")); }
  };
  async function loadMap() {
    if (disposed) return;
    map?.remove(); map = null;
    root.querySelector("[data-map]").hidden = false;
    root.querySelector("[data-map-error]").hidden = true;
    mapStatus("Loading satellite map…");
    if (!settings.mapboxToken) { mapError("Add a public Mapbox token in Settings to see satellite imagery. GPS and coordinate entry are available now."); return; }
    try {
      map = await mountSpotMap(root.querySelector("[data-map]"), { lat: draft.lat ?? HOME.lat, lon: draft.lon ?? HOME.lon, heading: draft.heading,
        token: settings.mapboxToken, onPosition: (lat, lon) => { if (draft.saving) { map?.update(draft.lat, draft.lon, draft.heading); return; } positionRevision++; manualPositionRevision++; draft.lat = lat; draft.lon = lon; form.elements.lat.value = lat.toFixed(6); form.elements.lon.value = lon.toFixed(6); invalidateConfirmation(); updateWater(); },
        onHeading: heading => { if (draft.saving) { map?.update(draft.lat, draft.lon, draft.heading); return; } manuallyFaced = true; stopCompass(); draft.heading = heading; form.elements.heading.value = (Math.round(heading * 100) / 100) % 360; invalidateConfirmation(); }, onError: mapError });
      if (disposed) { map?.remove(); return; }
      if (validPosition(draft.lat, draft.lon)) map?.update(draft.lat, draft.lon, draft.heading, true);
      mapStatus("Move the pin and drag the gold arrow to match your photo.");
    } catch (error) { mapError(error.message); }
  }
  root.querySelector("[data-map-retry]").onclick = loadMap;
  requestAnimationFrame(loadMap);
  return () => { disposed = true; stopCompass(); window.removeEventListener("spot-draft-changed", refreshControls); map?.remove(); if (previewURL) URL.revokeObjectURL(previewURL); };
}

function renderPlan(root, plan, status) {
  let disposed = false;
  const urls = [];
  const url = blob => { const value = URL.createObjectURL(blob); urls.push(value); return value; };
  const result = plan.result;
  const ready = plan.status === "ready" && result?.kind === "plan";
  const answerLimitReached = (plan.inputs.answers?.length || 0) >= 10;
  const settings = getSpotSettings();
  const waiting = { queued: "Saved on this device. Waiting for signal; keep Redside open or reopen it to resume.", analyzing: "Reading your photo and satellite image… Your photo is saved if you leave the app.", error: "Your photo is saved. Retry the analysis when ready.", question: "One detail will help make this plan useful." };
  root.innerHTML = `<div class="panel"><strong>${esc(displayName(plan))}</strong><p class="muted small">${esc(new Date(plan.createdAt).toLocaleString())}</p>
    ${!ready ? `<p role="status">${esc(waiting[plan.status] || "Saved")}</p>` : ""}
    ${(!settings.workerUrl || !settings.passphrase) && !ready ? '<p>Add the Worker URL and app passphrase in <a class="spot-link" href="#/settings">Settings</a> to run this saved photo.</p>' : ""}
    ${plan.lastError ? `<div role="alert"><h2>Analysis needs attention</h2><p>${esc(plan.lastError)}</p><a class="spot-link" href="#/settings">Check connection settings</a></div>` : ""}
    <div class="spot-photo"><img src="${url(plan.photo)}" alt="Your fishing photo${ready ? ', with three numbered target zones' : ''}">
    ${ready ? result.zones.map(zone => { const point = cellCenter(zone.cell, plan.grid); return `<button type="button" class="spot-zone" data-zone="${zone.id}" style="left:${point.x * 100}%;top:${point.y * 100}%" aria-label="${zone.id}. ${esc(zone.title)}" aria-pressed="false">${zone.id}</button>`; }).join("") : ""}</div>
    ${ready ? `<div class="spot-legend">${result.zones.map(zone => `<button class="chip" type="button" data-select-zone="${zone.id}">${zone.id} · ${esc(zone.title)}</button>`).join("")}</div><div data-zone-detail aria-live="polite"></div>` : ""}
    ${["queued", "error"].includes(plan.status) ? '<button class="btn primary" data-retry>Retry analysis</button>' : ""}</div>
    ${plan.status === "question" && result?.kind === "question" ? `<div class="panel"><h2>${esc(result.question)}</h2>${answerLimitReached ? '<p>This photo has reached its limit of 10 clarifications. <a class="spot-link" href="#/spot">Take a clearer photo to start a new plan</a>.</p>' : `<div class="filter-row">${result.options.map((option, index) => `<button class="chip" data-answer="${index}">${esc(option)}</button>`).join("")}</div>`}</div>` : ""}
    ${ready ? `<div class="panel"><h2>If nothing’s happening</h2><p>${esc(result.fallback)}</p></div>
    <div class="panel"><h2>What I can see vs what I’m guessing</h2><h3>Visible evidence</h3><ul>${result.visible.map(item => `<li>${esc(item)}</li>`).join("")}</ul><h3>Guesses to check</h3><ul>${result.guesses.map(item => `<li>${esc(item)}</li>`).join("")}</ul><p class="muted small">Depth, fish presence, and current water level are uncertain. Overhead imagery may be years old; today’s shoreline can differ.</p></div>
    <div class="panel"><label class="spot-check"><input type="checkbox" data-include-location> Include water name & coordinates in shared photo</label><div class="filter-row"><button class="btn primary" data-share>Share photo</button><button class="btn ghost" data-tried>Tried it</button></div><div data-tried-container></div></div>` : ""}
    <div class="panel" data-spot-details><h2>Your spot details</h2>${observationSummary(plan.inputs.observations)}
      ${["ready", "question", "error"].includes(plan.status) ? '<button type="button" class="btn ghost" data-edit-observations>Add or edit details</button><div data-observations-editor></div>' : ""}</div>
    <details class="panel" data-photo-details><summary>Saved photo details</summary><p>Your photo, location, and facing direction are saved on this device.</p><p>Target fish: ${esc(plan.inputs.species.join(", "))}</p><p>Facing: ${esc(Math.round(plan.inputs.heading))}&deg;</p></details>
    ${plan.status !== "analyzing" ? '<button class="btn ghost" data-delete-plan>Delete saved plan</button>' : ""}`;
  let retrying = false;
  async function retry(answer = null) {
    if (retrying || disposed) return;
    retrying = true;
    root.querySelectorAll("[data-answer], [data-retry]").forEach(button => { button.disabled = true; });
    try {
      const updated = await updatePlan(plan.id, current => {
        if (answer) {
          if (current.status !== "question" || current.result?.question !== answer.question || (current.inputs.answers?.length || 0) >= 10) return null;
          return { ...current, status: "queued", lastError: "", inputs: { ...current.inputs, answers: [...(current.inputs.answers || []), answer] } };
        }
        if (!["queued", "error"].includes(current.status)) return null;
        return { ...current, status: "queued", lastError: "" };
      });
      if (!updated) status("This plan has changed. Its latest saved state is shown below.");
      notifyPlans(plan.id); processSpotQueue();
    } catch (error) { status(error.message); }
    finally {
      retrying = false;
      if (!disposed) root.querySelectorAll("[data-answer], [data-retry]").forEach(button => { button.disabled = false; });
    }
  }
  root.querySelector("[data-retry]")?.addEventListener("click", () => retry());
  root.querySelector("[data-edit-observations]")?.addEventListener("click", () => {
    const editor = root.querySelector("[data-observations-editor]");
    if (editor.firstElementChild) { editor.querySelector("input")?.focus(); return; }
    editor.innerHTML = `<form class="spot-form" data-observations-form>${observationFields(plan.inputs.observations)}
      <p class="muted small">This requests a new AI analysis using the saved photo and these details. Your original plan stays saved. API usage applies.</p>
      <button class="btn primary" type="submit">Analyze with these details</button> <button class="btn ghost" type="button" data-cancel-observations>Cancel</button><p role="status" data-observations-status></p></form>`;
    const form = editor.querySelector("form");
    editor.querySelector("[data-cancel-observations]").onclick = () => { editor.replaceChildren(); root.querySelector("[data-edit-observations]").focus(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if (form.dataset.saving || disposed) return;
      form.dataset.saving = "true";
      form.querySelectorAll("input, textarea, select, button").forEach(control => { control.disabled = true; });
      try {
        const observations = normalizeObservations(readObservations(form));
        const inputs = { ...plan.inputs, answers: [], context: spotContext(plan.inputs.lat, plan.inputs.lon) };
        delete inputs.observations;
        if (Object.keys(observations).length) inputs.observations = observations;
        const updated = { id: crypto.randomUUID(), basedOnPlanId: plan.id, createdAt: Date.now(), status: "queued",
          photo: plan.photo, griddedPhoto: plan.griddedPhoto, grid: plan.grid, annotatedPhoto: null, result: null, inputs };
        await savePlan(updated);
        if (!disposed) location.hash = `#/spot/${updated.id}`;
        notifyPlans(updated.id); processSpotQueue();
      } catch (error) {
        if (!disposed) form.querySelector("[data-observations-status]").textContent = error.message;
      } finally {
        delete form.dataset.saving;
        if (!disposed) form.querySelectorAll("input, textarea, select, button").forEach(control => { control.disabled = false; });
      }
    };
    form.querySelector("input").focus();
  });
  root.querySelectorAll("[data-answer]").forEach(button => button.onclick = () => retry({ question: result.question, answer: result.options[Number(button.dataset.answer)] }));
  root.querySelector("[data-delete-plan]")?.addEventListener("click", async () => {
    if (!confirm("Delete this saved photo and plan from this device? Linked catch log entries will remain.")) return;
    try { await deletePlan(plan.id); if (!disposed) location.hash = "#/spot"; notifyPlans(plan.id); }
    catch (error) { status(error.message); }
  });
  if (ready) {
    function selectZone(id) {
      const zone = result.zones.find(item => item.id === id);
      root.querySelectorAll("[data-zone]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.zone) === id)));
      root.querySelector("[data-zone-detail]").innerHTML = `<h2>${zone.id}. ${esc(zone.title)}</h2><h3>Tie on</h3><p>${esc(zone.tackle)} <span class="tag">${zone.fromMyTackle ? "My Tackle" : "Suggested tackle"}</span></p><h3>Where to aim</h3><p>${esc(zone.aim)}</p><h3>How to work it</h3><p>${esc(zone.technique)}</p><h3>Why here</h3><ul class="spot-reasons">${zone.reasons.map(reason => `<li><span class="tag">${esc(reason.source === "angler" ? "Your observations" : reason.source)}</span> ${esc(reason.text)}</li>`).join("")}</ul>`;
    }
    root.querySelectorAll("[data-zone], [data-select-zone]").forEach(button => button.onclick = () => selectZone(Number(button.dataset.zone || button.dataset.selectZone)));
    selectZone(1);
    let shareBlob = plan.annotatedPhoto, shareRevision = 0;
    const share = root.querySelector("[data-share]");
    share.disabled = !shareBlob;
    async function prepareShare(includeLocation = false) {
      const revision = ++shareRevision;
      share.disabled = true;
      try {
        const blob = await annotatePhoto(plan.photo, result, plan.grid, { includeLocation, waterName: displayName(plan), lat: plan.inputs.lat, lon: plan.inputs.lon });
        if (disposed || revision !== shareRevision) return;
        shareBlob = blob; share.disabled = false;
      } catch (error) { if (!disposed && revision === shareRevision) status(error.message); }
    }
    root.querySelector("[data-include-location]").onchange = event => prepareShare(event.target.checked);
    if (!shareBlob) prepareShare();
    share.onclick = async () => {
      const file = new File([shareBlob], "redside-fish-this-spot.png", { type: "image/png" });
      try {
        // Invoke share immediately in the tap gesture; canvas work happened earlier.
        if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Fish This Spot" }); return; }
      } catch (error) { if (error.name === "AbortError") return; }
      const downloadURL = URL.createObjectURL(file);
      const anchor = document.createElement("a"); anchor.href = downloadURL; anchor.download = file.name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(downloadURL), 60000);
      status("Photo exported as PNG.");
    };
    root.querySelector("[data-tried]").onclick = () => {
      root.querySelector("[data-tried-container]").innerHTML = `<form class="spot-form" data-tried-form><label>Which zone?<select name="zone">${result.zones.map(zone => `<option value="${zone.id}">${zone.id} · ${esc(zone.title)}</option>`).join("")}</select></label><label>What I tied on<input name="tackle" required maxlength="200"></label><label>Result<select name="result"><option value="fish">Fish</option><option value="bites">Bites</option><option value="nothing">Nothing</option></select></label><label>Note (optional)<textarea name="note" maxlength="2000" rows="3"></textarea></label><button class="btn primary" type="submit">Save to catch log</button></form>`;
      const form = root.querySelector("[data-tried-form]");
      form.elements.tackle.value = result.zones[0].tackle;
      form.elements.zone.onchange = () => { form.elements.tackle.value = result.zones.find(zone => zone.id === Number(form.elements.zone.value)).tackle; };
      form.onsubmit = event => {
        event.preventDefault();
        try {
          addCatch({ planId: plan.id, zone: Number(form.elements.zone.value), result: form.elements.result.value,
            waterId: plan.inputs.context.water?.id || "", waterName: displayName(plan), species: plan.inputs.species.join(", "), method: form.elements.tackle.value,
            notes: form.elements.note.value, conditions: plan.inputs.context.conditions });
          form.remove(); status("Saved to the catch log, linked to this plan.");
        } catch (error) { status(`Could not save to the catch log: ${error.message}`); }
      };
      form.elements.zone.focus();
    };
  }
  return () => { disposed = true; urls.forEach(value => URL.revokeObjectURL(value)); };
}
