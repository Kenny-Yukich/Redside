// Optional browser checks only; the app still needs no build or dependencies.
// npm install --no-save --package-lock=false playwright
// npx playwright install chromium
// node tests/browser-smoke.mjs
// Existing installs may use REDSIDE_PLAYWRIGHT_MODULE and REDSIDE_BROWSER_CHANNEL.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = process.env.REDSIDE_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright");
const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    // Exercise the same subdirectory hosting used by GitHub Pages.
    const pathname = requestPath.startsWith("/Redside/") ? requestPath.slice("/Redside".length) : requestPath;
    const path = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!(await stat(path)).isFile()) throw new Error("Not a file");
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const appURL = origin + "/Redside/";
let browser;
let debugPage;
const planResponse = {
  kind: "plan",
  zones: [
    { id: 1, cell: "B2", title: "Start here", tackle: "Silver spinner", fromMyTackle: true, aim: "Aim beside the visible rock.", technique: "Retrieve slowly.", reasons: [{ source: "photo", text: "A rock is visible." }] },
    { id: 2, cell: "C3", title: "Work this next", tackle: "Silver spinner", fromMyTackle: true, aim: "Aim along the visible edge.", technique: "Vary the retrieve.", reasons: [{ source: "overhead", text: "Older overhead imagery suggests a bend." }] },
    { id: 3, cell: "D2", title: "Third option", tackle: "Silver spinner", fromMyTackle: true, aim: "Cast across the visible open patch.", technique: "Retrieve with pauses.", reasons: [{ source: "Redside data", text: "The water entry lists trout." }] },
  ],
  fallback: "After ten casts, change retrieve speed.",
  visible: ["Rocks near the bank."],
  guesses: ["Depth, fish presence and current level are unknown."],
};
const questionResponse = { kind: "question", question: "Which way is the surface moving?", options: ["Left", "Right", "Not sure"] };
const workerCalls = [];
const tileRequests = [];
let replyWithQuestion = false;
let holdNextReply = false;
let releaseWorkerReply;

async function run(name, check) {
  try {
    await check();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    if (debugPage && !debugPage.isClosed()) {
      process.stderr.write(`FAIL ${name}\nURL: ${debugPage.url()}\n${(await debugPage.locator("body").innerText()).slice(-2500)}\n`);
      await mkdir(resolve(root, "test-results"), { recursive: true });
      await debugPage.screenshot({ path: resolve(root, "test-results/browser-smoke-failure.png"), fullPage: true });
    }
    throw error;
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.REDSIDE_BROWSER_CHANNEL ? { channel: process.env.REDSIDE_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  debugPage = page;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Keep tests deterministic and independent of remote weather/fonts/map access.
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === "https://redside.test" && url.pathname === "/analyze") {
      const request = route.request();
      const inputs = request.postDataJSON();
      workerCalls.push({ inputs, method: request.method(), headers: request.headers() });
      if (holdNextReply) {
        holdNextReply = false;
        await new Promise(resolve => { releaseWorkerReply = resolve; });
      }
      return route.fulfill({ json: replyWithQuestion && !inputs.answers?.length ? questionResponse : planResponse });
    }
    if (url.hostname === "waterservices.usgs.gov") return route.fulfill({ json: { value: { timeSeries: [] } } });
    if (url.hostname === "api.open-meteo.com") return route.fulfill({ json: { current: { temperature_2m: 60, wind_speed_10m: 5, weather_code: 2 }, daily: { temperature_2m_max: [65], temperature_2m_min: [45], precipitation_probability_max: [0], wind_speed_10m_max: [6], weather_code: [2] } } });
    if (process.env.REDSIDE_TEST_LEAFLET === "1" && url.hostname === "cdnjs.cloudflare.com" && /\/leaflet\.(js|css)$/.test(url.pathname)) {
      return route.fulfill({ response: await route.fetch() });
    }
    if (process.env.REDSIDE_TEST_LEAFLET === "1" && url.hostname === "api.mapbox.com") {
      tileRequests.push({ url: url.href, referer: route.request().headers().referer });
      return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zAAAAABJRU5ErkJggg==", "base64") });
    }
    return route.abort();
  });
  await page.goto(appURL + "#/spot");

  await run("nearest-water context and facing bearings", async () => {
    const result = await page.evaluate(async () => {
      const { WATERS } = await import("./js/data.js");
      const { nearestWater, spotContext, destination, bearingBetween } = await import("./js/spot-context.js");
      const water = WATERS[0];
      const north = destination(water.lat, water.lon, 0);
      const east = destination(water.lat, water.lon, 90);
      return {
        exact: nearestWater(water.lat, water.lon).water.id,
        expected: water.id,
        distant: nearestWater(0, 0).water,
        unknown: spotContext(0, 0).water,
        score: spotContext(water.lat, water.lon).biteScore.score,
        north: bearingBetween(water.lat, water.lon, ...north),
        east: bearingBetween(water.lat, water.lon, ...east),
      };
    });
    assert.equal(result.exact, result.expected);
    assert.equal(result.distant, null);
    assert.equal(result.unknown, "unknown water");
    assert.ok(Number.isFinite(result.score));
    assert.ok(Math.min(Math.abs(result.north), Math.abs(360 - result.north)) < 0.001);
    assert.ok(Math.abs(result.east - 90) < 0.001);
  });

  await run("device settings validation and tackle deduplication", async () => {
    const result = await page.evaluate(async () => {
      const { saveSpotSettings, getSpotSettings } = await import("./js/spot-settings.js");
      const settings = { workerUrl: "https://redside.test", passphrase: "browser-test-passphrase", mapboxToken: "", tackle: [" Silver spinner ", "Silver spinner", "Black woolly bugger #8"] };
      let rejectedSecret = false;
      let rejectedInsecure = false;
      try { saveSpotSettings({ ...settings, mapboxToken: "sk.not-public" }); } catch { rejectedSecret = true; }
      try { saveSpotSettings({ ...settings, workerUrl: "http://remote.example" }); } catch { rejectedInsecure = true; }
      saveSpotSettings(settings);
      return { settings: getSpotSettings(), rejectedSecret, rejectedInsecure };
    });
    assert.equal(result.rejectedSecret, true);
    assert.equal(result.rejectedInsecure, true);
    assert.deepEqual(result.settings.tackle, ["Silver spinner", "Black woolly bugger #8"]);
  });

  await run("landscape and portrait photos resize and get separate labeled grids", async () => {
    const result = await page.evaluate(async () => {
      const { preparePhoto, blobDataURL, cellCenter } = await import("./js/spot-media.js");
      const makePhoto = async (width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#9fbece";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#38605b";
        ctx.fillRect(0, height * .75, width, height * .25);
        return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .95));
      };
      const labels = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) { labels.push(String(text)); return original.call(this, text, ...args); };
      try {
        const landscape = await preparePhoto(await makePhoto(2400, 1600));
        const landscapeLabels = labels.splice(0);
        const portrait = await preparePhoto(await makePhoto(1600, 2400));
        const portraitLabels = labels.splice(0);
        window.__spotFixture = landscape;
        window.__spotFixturePortrait = portrait;
        window.__spotFixtureUpload = await blobDataURL(landscape.photo);
        const clean = await createImageBitmap(landscape.photo);
        const gridded = await createImageBitmap(landscape.griddedPhoto);
        const canvas = document.createElement("canvas");
        canvas.width = landscape.width;
        canvas.height = landscape.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(clean, 0, 0);
        const cleanLabelPixel = Array.from(ctx.getImageData(12, 12, 1, 1).data);
        ctx.drawImage(gridded, 0, 0);
        const gridLabelPixel = Array.from(ctx.getImageData(12, 12, 1, 1).data);
        clean.close(); gridded.close();
        return {
          landscape: { width: landscape.width, height: landscape.height, grid: landscape.grid, type: landscape.photo.type, gridType: landscape.griddedPhoto.type },
          portrait: { width: portrait.width, height: portrait.height, grid: portrait.grid },
          landscapeLabels, portraitLabels, cleanLabelPixel, gridLabelPixel,
          first: cellCenter("A1", landscape.grid), last: cellCenter("D6", portrait.grid),
        };
      } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    });
    assert.deepEqual(result.landscape, { width: 1568, height: 1045, grid: { columns: 6, rows: 4 }, type: "image/jpeg", gridType: "image/jpeg" });
    assert.deepEqual(result.portrait, { width: 1045, height: 1568, grid: { columns: 4, rows: 6 } });
    assert.equal(result.landscapeLabels.length, 24);
    assert.ok(result.landscapeLabels.includes("F4"));
    assert.equal(result.portraitLabels.length, 24);
    assert.ok(result.portraitLabels.includes("D6"));
    assert.notDeepEqual(result.cleanLabelPixel, result.gridLabelPixel, "Grid must alter only the working copy");
    assert.deepEqual(result.first, { x: 1 / 12, y: 1 / 8 });
    assert.deepEqual(result.last, { x: 7 / 8, y: 11 / 12 });
  });

  await run("PNG annotation leaves location out unless explicitly included", async () => {
    const result = await page.evaluate(async () => {
      const { annotatePhoto } = await import("./js/spot-media.js");
      const fixture = window.__spotFixture;
      const zones = { zones: [{ cell: "A1" }, { cell: "C2" }, { cell: "F4" }] };
      const location = { waterName: "Private test water", lat: 44.59321, lon: -121.28567 };
      const text = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) { text.push(String(value)); return original.call(this, value, ...args); };
      try {
        const normal = await annotatePhoto(fixture.photo, zones, fixture.grid, location);
        const normalText = text.splice(0);
        const included = await annotatePhoto(fixture.photo, zones, fixture.grid, { ...location, includeLocation: true });
        const includedText = text.splice(0);
        return { normalText, includedText, type: normal.type, includeType: included.type, signature: Array.from(new Uint8Array(await normal.arrayBuffer()).slice(0, 8)) };
      } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    });
    assert.equal(result.type, "image/png");
    assert.equal(result.includeType, "image/png");
    assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(!result.normalText.some(text => /Private test water|44\.59321|-121\.28567/.test(text)));
    assert.ok(result.includedText.includes("Private test water"));
    assert.ok(result.includedText.includes("44.59321, -121.28567"));
  });

  await run("IndexedDB photo Blobs persist across page lifetimes", async () => {
    const originalSizes = await page.evaluate(async () => {
      const { savePlan } = await import("./js/spot-store.js");
      const fixture = window.__spotFixture;
      await savePlan({ id: "browser-storage-check", createdAt: Date.now(), status: "error", ...fixture });
      return [fixture.photo.size, fixture.griddedPhoto.size];
    });
    const second = await context.newPage();
    try {
      // A same-origin inert page reads storage without running the app's queue.
      await second.goto(origin + "/tests/browser-storage-check");
      const stored = await second.evaluate(async () => {
        const { getPlan, deletePlan } = await import("/js/spot-store.js");
        const plan = await getPlan("browser-storage-check");
        const result = { blobs: [plan.photo instanceof Blob, plan.griddedPhoto instanceof Blob], sizes: [plan.photo.size, plan.griddedPhoto.size], grid: plan.grid };
        await deletePlan(plan.id);
        return result;
      });
      assert.deepEqual(stored.blobs, [true, true]);
      assert.deepEqual(stored.sizes, originalSizes);
      assert.deepEqual(stored.grid, { columns: 6, rows: 4 });
    } finally { await second.close(); }
  });

  // Feature assertions are kept below so failures show the individual behavior.
  await run("spot route renders at iPhone viewport", async () => {
    await page.locator("[data-photo-library]").waitFor({ state: "attached" });
    assert.equal(await page.locator("[data-photo-library]").getAttribute("type"), "file");
    assert.equal(await page.locator("[data-photo-camera]").getAttribute("capture"), "environment");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow at a narrow phone width");
  });

  await run("iOS compass permission and heading can be overridden manually", async () => {
    await page.evaluate(() => {
      window.__compassRequests = 0;
      Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: { requestPermission: async () => { window.__compassRequests++; return "granted"; } } });
    });
    await page.locator("[data-compass]").click();
    await page.waitForFunction(() => window.__compassRequests === 1);
    await page.evaluate(() => {
      const event = new Event("deviceorientation");
      Object.defineProperty(event, "webkitCompassHeading", { value: 72 });
      window.dispatchEvent(event);
    });
    assert.equal(await page.locator("[name=heading]").inputValue(), "72");
    await page.locator("[name=heading]").fill("123");
    await page.evaluate(() => {
      const event = new Event("deviceorientation");
      Object.defineProperty(event, "webkitCompassHeading", { value: 10 });
      window.dispatchEvent(event);
    });
    assert.equal(await page.locator("[name=heading]").inputValue(), "123");
  });

  const photoDataURL = await page.evaluate(() => window.__spotFixtureUpload);
  const photoFile = { name: "shore.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photoDataURL.split(",")[1], "base64") };
  async function fillSpot() {
    await page.locator("[data-photo-library]").setInputFiles(photoFile);
    await page.locator("[data-spot-form]").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-spot-status]")?.textContent.startsWith("Photo ready."));
    const water = await page.evaluate(async () => (await import("./js/data.js")).WATERS[0]);
    await page.locator("[name=lat]").fill(String(water.lat));
    await page.locator("[name=lon]").fill(String(water.lon));
    await page.locator("[name=heading]").fill("90");
    await page.locator("[name=confirmed]").check();
    await page.locator("[name=species]").first().check();
    const spinner = page.locator("[name=tackle][value='Silver spinner']");
    if (await spinner.count()) await spinner.check();
    else await page.locator("[name=tackle]").first().check();
  }

  let firstPlanId;
  await run("analyze sends prepared photo/context and renders three zones", async () => {
    // Revisit after Settings changed so tackle options reflect saved inventory.
    await page.goto(appURL + "#/spot");
    await page.reload();
    await fillSpot();
    await page.locator("[data-analyze]").click();
    await page.locator("[data-zone='1']").waitFor();
    assert.equal(await page.locator("[data-zone]").count(), 3);
    assert.equal(workerCalls.length, 1);
    const sent = workerCalls[0];
    assert.equal(sent.method, "POST");
    assert.equal(sent.headers["x-app-passphrase"], "browser-test-passphrase");
    assert.deepEqual(sent.inputs.grid, { columns: 6, rows: 4 });
    assert.ok(sent.inputs.photo.startsWith("data:image/jpeg;base64,"));
    assert.equal(sent.inputs.heading, 90);
    assert.ok(sent.inputs.species.length > 0);
    assert.ok(sent.inputs.tackle.includes("Silver spinner"));
    assert.ok(sent.inputs.context.water.id);
    assert.ok(Number.isFinite(sent.inputs.context.biteScore.score));
    firstPlanId = await page.evaluate(async () => {
      const plans = await (await import("./js/spot-store.js")).listPlans();
      return plans.find(plan => plan.status === "ready").id;
    });
    await page.locator("[data-zone='2']").click();
    assert.ok((await page.locator("[data-plan-result]").innerText()).includes("Older overhead imagery suggests a bend."));
    assert.ok((await page.locator("[data-plan-result]").innerText()).includes(planResponse.fallback));
    assert.ok((await page.locator("[data-plan-result]").innerText()).includes("What I can see"));
    assert.equal(await page.locator("[data-include-location]").isChecked(), false);
    await page.locator("[data-debug] summary").click();
    assert.ok((await page.locator("[data-debug]").innerText()).includes('"kind": "plan"'));
    assert.ok(await page.locator("[data-debug] img").isVisible());
    await page.locator("[data-debug] summary").click();
    await mkdir(resolve(root, "test-results"), { recursive: true });
    await page.screenshot({ path: resolve(root, "test-results/spot-plan-mobile.png"), fullPage: true });
  });

  await run("share delivers a PNG with location excluded by default", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: async options => {
        const file = options.files[0];
        window.__sharedPhoto = { name: file.name, type: file.type, size: file.size, text: options.text || "", title: options.title || "" };
      } });
    });
    await page.locator("[data-share]").click();
    await page.waitForFunction(() => window.__sharedPhoto);
    const shared = await page.evaluate(() => window.__sharedPhoto);
    assert.equal(shared.type, "image/png");
    assert.ok(shared.name.endsWith(".png"));
    assert.ok(shared.size > 1000);
    assert.ok(!/Haystack|44\.|-121\./.test(shared.text + shared.title + shared.name));
  });

  await run("sharing falls back to a downloadable PNG", async () => {
    await page.evaluate(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
    const pendingDownload = page.waitForEvent("download");
    await page.locator("[data-share]").click();
    const download = await pendingDownload;
    assert.equal(download.suggestedFilename(), "redside-fish-this-spot.png");
    assert.equal(await download.failure(), null);
    const bytes = await readFile(await download.path());
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  await run("unrelated plan notifications preserve an open Tried it form", async () => {
    await page.locator("[data-tried]").click();
    const form = page.locator("[data-tried-form]");
    await form.locator("[name=zone]").selectOption("2");
    await form.locator("[name=note]").fill("Do not lose this unfinished note.");
    await page.evaluate(async id => {
      (await import("./js/spot-queue.js")).notifyPlans("some-other-plan");
      await (await import("./js/spot-store.js")).getPlan(id);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }, firstPlanId);
    assert.equal(await form.locator("[name=note]").inputValue(), "Do not lose this unfinished note.");
    assert.equal(await form.locator("[name=zone]").inputValue(), "2");
  });

  await run("Tried it links catch outcomes and JSON export/import preserves them", async () => {
    await page.locator("[data-tried]").click();
    const form = page.locator("[data-tried-form]");
    await form.locator("[name=zone]").selectOption("2");
    await form.locator("[name=tackle]").fill("Silver spinner");
    await form.locator("[name=result]").selectOption("bites");
    await form.locator("[name=note]").fill("Two taps near the edge.");
    await form.locator("button[type=submit]").click();
    const result = await page.evaluate(async () => {
      const log = await import("./js/log.js");
      const catches = log.getCatches();
      let exported;
      const originalURL = URL.createObjectURL;
      const originalClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = blob => { exported = blob; return originalURL(blob); };
      HTMLAnchorElement.prototype.click = () => {};
      try { await log.exportJSON(); }
      finally { URL.createObjectURL = originalURL; HTMLAnchorElement.prototype.click = originalClick; }
      const json = await exported.text();
      for (const entry of catches) log.deleteCatch(entry.id);
      log.importJSON(json);
      return { saved: catches[0], restored: log.getCatches()[0], exported: json };
    });
    assert.equal(result.saved.planId, firstPlanId);
    assert.equal(result.saved.zone, 2);
    assert.equal(result.saved.result, "bites");
    assert.equal(result.saved.method, "Silver spinner");
    assert.equal(result.saved.notes, "Two taps near the edge.");
    assert.deepEqual(result.restored, result.saved);
    assert.ok(!result.exported.includes("browser-test-passphrase"));
  });

  await run("ambiguous photo asks a question and reruns with the tapped answer", async () => {
    replyWithQuestion = true;
    const before = workerCalls.length;
    await page.goto(appURL + "#/spot");
    await fillSpot();
    await page.locator("[data-analyze]").click();
    await page.locator("[data-answer]").first().waitFor();
    assert.equal(await page.locator("[data-zone]").count(), 0);
    assert.equal(await page.locator("[data-answer]").count(), 3);
    await page.locator("[data-answer]").filter({ hasText: "Left" }).click();
    await page.locator("[data-zone='1']").waitFor();
    assert.equal(workerCalls.length, before + 2);
    assert.deepEqual(workerCalls.at(-1).inputs.answers, [{ question: questionResponse.question, answer: "Left" }]);
    replyWithQuestion = false;
  });

  await run("offline analysis queues locally and resumes when the app reconnects", async () => {
    const before = workerCalls.length;
    await page.goto(appURL + "#/spot");
    await fillSpot();
    await context.setOffline(true);
    await page.locator("[data-analyze]").click();
    await page.waitForFunction(async () => (await (await import("./js/spot-store.js")).listPlans()).some(plan => plan.status === "queued"));
    assert.equal(workerCalls.length, before);
    await context.setOffline(false);
    await page.locator("[data-zone='1']").waitFor();
    assert.equal(workerCalls.length, before + 1);
    const stored = await page.evaluate(async () => {
      const plans = await (await import("./js/spot-store.js")).listPlans();
      return { statuses: plans.map(plan => plan.status), secrets: JSON.stringify(plans).includes("browser-test-passphrase"), annotated: plans.every(plan => plan.annotatedPhoto instanceof Blob) };
    });
    assert.ok(stored.statuses.every(status => status === "ready"));
    assert.equal(stored.secrets, false);
    assert.equal(stored.annotated, true);
  });

  await run("deleting a queued plan during another analysis does not submit or resurrect it", async () => {
    const before = workerCalls.length;
    holdNextReply = true;
    try {
      await page.evaluate(async id => {
        const { getPlan, savePlan } = await import("./js/spot-store.js");
        const template = await getPlan(id);
        await savePlan({ ...template, id: "queue-delete-a", status: "queued", createdAt: Date.now(), result: null, annotatedPhoto: null });
        await savePlan({ ...template, id: "queue-delete-b", status: "queued", createdAt: Date.now() + 1, result: null, annotatedPhoto: null });
        window.__queueDeleteDrain = (await import("./js/spot-queue.js")).processSpotQueue();
      }, firstPlanId);
      await page.waitForFunction(async () => (await (await import("./js/spot-store.js")).getPlan("queue-delete-a")).status === "analyzing");
      for (let attempt = 0; !releaseWorkerReply && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseWorkerReply, "First queued analysis reached the mocked Worker");
      await page.evaluate(async () => (await import("./js/spot-store.js")).deletePlan("queue-delete-b"));
      releaseWorkerReply();
      releaseWorkerReply = null;
      await page.waitForFunction(async () => (await (await import("./js/spot-store.js")).getPlan("queue-delete-a")).status === "ready");
      const result = await page.evaluate(async () => {
        await window.__queueDeleteDrain;
        const { getPlan, deletePlan } = await import("./js/spot-store.js");
        const second = await getPlan("queue-delete-b");
        await deletePlan("queue-delete-a");
        return second;
      });
      assert.equal(result, null);
      assert.equal(workerCalls.length, before + 1);
    } finally {
      holdNextReply = false;
      releaseWorkerReply?.();
      releaseWorkerReply = null;
    }
  });

  await run("PNG storage quota failure preserves the result and never repeats the paid analysis", async () => {
    const before = workerCalls.length;
    const stored = await page.evaluate(async id => {
      const store = await import("./js/spot-store.js");
      const queue = await import("./js/spot-queue.js");
      const template = await store.getPlan(id);
      await store.savePlan({ ...template, id: "quota-check", status: "queued", createdAt: Date.now(), result: null, annotatedPhoto: null });
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (value.annotatedPhoto) throw new DOMException("Simulated PNG quota exhaustion", "QuotaExceededError");
        return original.call(this, value, ...args);
      };
      try {
        await queue.processSpotQueue();
        await queue.processSpotQueue();
        const plan = await store.getPlan("quota-check");
        return { status: plan.status, result: plan.result, hasPNG: plan.annotatedPhoto instanceof Blob };
      } finally { IDBObjectStore.prototype.put = original; }
    }, firstPlanId);
    assert.equal(stored.status, "ready");
    assert.deepEqual(stored.result, planResponse);
    assert.equal(stored.hasPNG, false);
    assert.equal(workerCalls.length, before + 1);
    await page.goto(appURL + "#/spot/quota-check");
    await page.locator("[data-zone='1']").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-share]")?.disabled === false);
    assert.equal(workerCalls.length, before + 1, "Opening the saved result regenerates its share PNG locally");
    await page.evaluate(async () => (await import("./js/spot-store.js")).deletePlan("quota-check"));
  });

  if (process.env.REDSIDE_TEST_LEAFLET === "1") {
    await run("real Leaflet pin and facing arrow drag independently with Pages-path tile referrers", async () => {
      await page.evaluate(async () => {
        const settings = await import("./js/spot-settings.js");
        settings.saveSpotSettings({ ...settings.getSpotSettings(), mapboxToken: "pk.browser-map-test" });
      });
      await page.goto(appURL + "#/settings");
      await page.goto(appURL + "#/spot");
      await page.locator(".leaflet-container .spot-pin").waitFor();
      const before = { lat: await page.locator("[name=lat]").inputValue(), lon: await page.locator("[name=lon]").inputValue() };
      async function dragMarker(selector, dx, dy) {
        const marker = page.locator(selector);
        await marker.scrollIntoViewIfNeeded();
        const box = await marker.boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 10 });
        await page.mouse.up();
      }
      await dragMarker(".spot-pin", 35, 20);
      const moved = { lat: await page.locator("[name=lat]").inputValue(), lon: await page.locator("[name=lon]").inputValue() };
      assert.notDeepEqual(moved, before, "Dragging the pin changes the photo coordinates");
      await dragMarker(".spot-arrow", 55, 25);
      assert.deepEqual({ lat: await page.locator("[name=lat]").inputValue(), lon: await page.locator("[name=lon]").inputValue() }, moved, "Dragging facing must not move the photo pin");
      const heading = Number(await page.locator("[name=heading]").inputValue());
      assert.ok(Number.isFinite(heading) && heading > 0 && heading < 360);
      assert.equal(await page.locator("[name=confirmed]").isChecked(), false);
      assert.ok(tileRequests.length > 0);
      assert.ok(tileRequests.every(request => request.referer === appURL), "Restricted public tokens need the full GitHub Pages path in Referer");
      await page.screenshot({ path: resolve(root, "test-results/spot-map-mobile.png"), fullPage: true });
    });
  }

  await run("service worker never intercepts or caches Worker POST requests", async () => {
    const handlers = {};
    const code = await readFile(resolve(root, "sw.js"), "utf8");
    runInNewContext(code, { self: { addEventListener: (name, handler) => { handlers[name] = handler; } }, URL, location: { origin } });
    let intercepted = false;
    handlers.fetch({ request: new Request("https://redside.test/analyze", { method: "POST", body: "{}" }), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, "Analysis POST must pass straight through to the network");
  });

  await run("saved photo plans reopen offline from the service worker cache", async () => {
    const seed = await page.evaluate(async id => {
      const plan = await (await import("./js/spot-store.js")).getPlan(id);
      const { blobDataURL } = await import("./js/spot-media.js");
      return { ...plan, photo: await blobDataURL(plan.photo), griddedPhoto: await blobDataURL(plan.griddedPhoto), annotatedPhoto: await blobDataURL(plan.annotatedPhoto) };
    }, firstPlanId);
    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    const offlinePage = await offlineContext.newPage();
    try {
      await offlineContext.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await offlinePage.goto(appURL + "#/spot");
      await offlinePage.evaluate(async plan => {
        for (const key of ["photo", "griddedPhoto", "annotatedPhoto"]) plan[key] = await (await fetch(plan[key])).blob();
        await (await import("./js/spot-store.js")).savePlan(plan);
        await navigator.serviceWorker.ready;
      }, seed);
      await offlinePage.waitForFunction(() => navigator.serviceWorker.controller);
      await offlinePage.goto(appURL + "#/spot/" + firstPlanId);
      await offlinePage.locator("[data-zone='1']").waitFor();
      await offlineContext.setOffline(true);
      await offlinePage.reload();
      await offlinePage.locator("[data-zone='1']").waitFor();
      assert.equal(await offlinePage.locator("[data-zone]").count(), 3);
      assert.equal(await offlinePage.locator(".spot-photo img").evaluate(image => image.complete && image.naturalWidth > 0), true);
      await offlinePage.locator("[data-zone='3']").click();
      assert.ok((await offlinePage.locator("[data-zone-detail]").innerText()).includes("Third option"));
    } finally { await offlineContext.close(); }
  });

  assert.deepEqual(errors, [], "No uncaught browser errors");
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
