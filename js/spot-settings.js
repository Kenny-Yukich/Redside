// Device-only configuration. No provider secrets belong in the static app.
const KEY = "redside.spot.settings.v1";
export function getSpotSettings() {
  try { return { workerUrl: "", passphrase: "", mapboxToken: "", tackle: [], ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { workerUrl: "", passphrase: "", mapboxToken: "", tackle: [] }; }
}
export function saveSpotSettings(value) {
  const url = value.workerUrl.trim().replace(/\/+$/, "");
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error("Use an HTTPS Worker URL.");
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error("Enter only the Worker origin, without a path or query.");
  }
  if (value.mapboxToken && !value.mapboxToken.trim().startsWith("pk.")) throw new Error("The map needs a public Mapbox token starting with pk., never a secret token.");
  const tackle = [...new Set(value.tackle.map(item => item.trim()).filter(Boolean))];
  if (tackle.length > 50 || tackle.some(item => item.length > 160)) throw new Error("Keep My Tackle to 50 items, at most 160 characters each.");
  localStorage.setItem(KEY, JSON.stringify({ workerUrl: url, passphrase: value.passphrase, mapboxToken: value.mapboxToken.trim(), tackle }));
  window.dispatchEvent(new Event("spot-settings-changed"));
}

export function viewSpotSettings() {
  const view = document.createElement("section");
  view.className = "view spot-view";
  view.innerHTML = `<a class="back" href="#/spot">‹ Fish This Spot</a>
    <header class="page-head"><h1>Settings</h1><p class="muted">Fish This Spot · saved on this device.</p></header>
    <form class="spot-form panel">
      <label>Worker URL<input name="workerUrl" type="url" placeholder="https://redside-spot.your-subdomain.workers.dev" autocomplete="off"></label>
      <label>App passphrase<input name="passphrase" type="password" autocomplete="off" maxlength="256"></label>
      <p class="muted small">Enter once here. The passphrase stays on this device and is sent only to your Worker. It is never included in exports.</p>
      <label>Public Mapbox token<input name="mapboxToken" autocomplete="off" spellcheck="false" placeholder="pk.…"></label>
      <p class="muted small">Use a separate public token restricted to this Redside website. Provider secret keys belong in the Worker.</p>
      <label>My Tackle<textarea name="tackle" rows="7" placeholder="One item per line, e.g.&#10;Size 2 silver spinner&#10;Black woolly bugger #8"></textarea></label>
      <p class="muted small">Include size, color, or weight if you know it. Pick what you brought when you analyze.</p>
      <button class="btn primary" type="submit">Save settings</button>
      <p role="status" aria-live="polite" data-status></p>
    </form>`;
  const form = view.querySelector("form");
  const settings = getSpotSettings();
  for (const name of ["workerUrl", "passphrase", "mapboxToken"]) form.elements[name].value = settings[name];
  form.elements.tackle.value = settings.tackle.join("\n");
  form.onsubmit = event => {
    event.preventDefault();
    try {
      saveSpotSettings({ workerUrl: form.elements.workerUrl.value, passphrase: form.elements.passphrase.value, mapboxToken: form.elements.mapboxToken.value, tackle: form.elements.tackle.value.split(/\r?\n/) });
      view.querySelector("[data-status]").textContent = "Settings saved on this device.";
    } catch (error) { view.querySelector("[data-status]").textContent = error.message; }
  };
  return view;
}
