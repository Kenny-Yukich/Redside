import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, headingEndpoint, satelliteUrl, validateInput, MODEL } from "./index.js";
import { gridCells, resultSchema, validateResult, ZONE_TITLES } from "../js/spot-contract.js";
import { WATERS } from "../js/data.js";

const env = {
  ALLOWED_ORIGIN: "https://kenny-yukich.github.io", APP_PASSPHRASE: "test-only-passphrase",
  ANTHROPIC_API_KEY: "test-only-anthropic-secret", MAPBOX_TOKEN: "test-only-mapbox-secret",
};
const landscape = { columns: 6, rows: 4 };
const portrait = { columns: 4, rows: 6 };
function input() {
  return {
    photo: "data:image/jpeg;base64,/9j/2Q==", grid: landscape, lat: 44.49, lon: -121.15, heading: 90,
    species: ["Rainbow trout"], tackle: ["Size 2 spinner"], answers: [],
    context: { water: WATERS[0], distanceMeters: 150, biteScore: { score: 55, band: "fair", reasons: [] },
      conditions: { flow: { flowCfs: 500 }, flowTs: 1790265600000, weather: { tempF: 60 }, weatherTs: 1790265600000 },
      date: "2026-09-24T12:00:00.000Z" },
  };
}
function plan() {
  return { kind: "plan", zones: ZONE_TITLES.map((title, index) => ({
    id: index + 1, title, cell: ["B2", "C3", "D2"][index], tackle: "Size 2 spinner", fromMyTackle: true,
    aim: "Cast beside the visible rock.", technique: "Retrieve slowly with brief pauses.",
    reasons: [{ source: ["photo", "overhead", "Redside data"][index], text: "This feature could be worth exploring." }],
  })), fallback: "After ten casts, change retrieve speed.", visible: ["A rock is visible by the bank."],
  guesses: ["Depth, fish presence and current water level are unknown. The overhead shoreline may be outdated."] };
}
function request(body = input(), overrides = {}) {
  return new Request("https://redside-advisor.test/analyze", {
    method: "POST", headers: { origin: env.ALLOWED_ORIGIN, "content-type": "application/json", "x-app-passphrase": env.APP_PASSPHRASE },
    body: JSON.stringify(body), ...overrides,
  });
}
function upstream(result = plan(), observe = () => {}) {
  return async (url, options) => {
    observe(url, options);
    if (url.startsWith("https://api.mapbox.com/")) return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "content-type": "image/jpeg" } });
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "return_spot_analysis", input: result }] });
  };
}
const neverFetch = () => { throw new Error("Must not call an upstream service."); };

test("validates full Redside water data and unknown-water requests", () => {
  assert.equal(validateInput(input()).context.water.id, WATERS[0].id);
  const unknown = input();
  unknown.context = { water: "unknown water", distanceMeters: 6000, biteScore: null, conditions: null, date: unknown.context.date };
  assert.equal(validateInput(unknown), unknown);
});

test("rejects unusable coordinates, headings, context, and malformed photos before API calls", async () => {
  for (const mutate of [
    value => { value.lat = "44.49"; }, value => { value.lat = 90; }, value => { value.lon = -181; },
    value => { value.heading = 360; }, value => { value.heading = null; }, value => { value.grid = { columns: 5, rows: 4 }; },
    value => { value.photo = "data:image/png;base64,/9j/2Q=="; }, value => { value.photo = "data:image/jpeg;base64,/9j/2Q="; },
    value => { value.species = []; }, value => { value.tackle = ["x".repeat(301)]; },
    value => { value.context.distanceMeters = 2001; }, value => { value.context.date = "yesterday"; },
    value => { value.answers = [{ question: "Flow?", answer: "" }]; },
  ]) {
    const body = input(); mutate(body);
    const response = await handleRequest(request(body), env, neverFetch);
    assert.equal(response.status, 400);
  }
});

test("requires passphrase and rejects every other or missing origin", async () => {
  for (const origin of [null, "https://github.com", "https://evil.test", "https://kenny-yukich.github.io.evil.test"]) {
    const req = request();
    if (origin) req.headers.set("origin", origin); else req.headers.delete("origin");
    const response = await handleRequest(req, env, neverFetch);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  for (const passphrase of [null, "wrong"]) {
    const req = request();
    if (passphrase) req.headers.set("x-app-passphrase", passphrase); else req.headers.delete("x-app-passphrase");
    const response = await handleRequest(req, env, neverFetch);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  }
});

test("CORS preflight permits only POST and approved headers", async () => {
  const req = new Request("https://worker.test/analyze", { method: "OPTIONS", headers: {
    origin: env.ALLOWED_ORIGIN, "access-control-request-method": "POST",
    "access-control-request-headers": "content-type, x-app-passphrase",
  } });
  const response = await handleRequest(req, env, neverFetch);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  req.headers.set("access-control-request-headers", "authorization");
  assert.equal((await handleRequest(req, env, neverFetch)).status, 403);
  req.headers.set("access-control-request-method", "GET");
  assert.equal((await handleRequest(req, env, neverFetch)).status, 403);
});

test("fails closed for a path-bearing CORS config and missing secrets", async () => {
  assert.equal((await handleRequest(request(), { ...env, ALLOWED_ORIGIN: `${env.ALLOWED_ORIGIN}/Redside/` }, neverFetch)).status, 503);
  assert.equal((await handleRequest(request(), { ...env, ALLOWED_ORIGIN: "*" }, neverFetch)).status, 503);
  assert.equal((await handleRequest(request(), { ...env, APP_PASSPHRASE: "" }, neverFetch)).status, 503);
});

test("rejects JSON content type, malformed JSON, unknown paths and methods", async () => {
  assert.equal((await handleRequest(request({}, { headers: { origin: env.ALLOWED_ORIGIN, "x-app-passphrase": env.APP_PASSPHRASE } }), env, neverFetch)).status, 415);
  assert.equal((await handleRequest(request({}, { body: "{" }), env, neverFetch)).status, 400);
  const wrongPath = new Request("https://worker.test/elsewhere", request());
  assert.equal((await handleRequest(wrongPath, env, neverFetch)).status, 404);
  const get = new Request("https://worker.test/analyze", { headers: { origin: env.ALLOWED_ORIGIN } });
  assert.equal((await handleRequest(get, env, neverFetch)).status, 405);
});

test("caps both declared and streamed request sizes", async () => {
  const req = request(); req.headers.set("content-length", String(9 * 1024 * 1024));
  assert.equal((await handleRequest(req, env, neverFetch)).status, 413);
  const oversized = request({}, { body: " ".repeat(8 * 1024 * 1024 + 1) });
  assert.equal((await handleRequest(oversized, env, neverFetch)).status, 413);
});

test("north/east facing endpoints and satellite overlays agree with confirmed pin", () => {
  const north = headingEndpoint(44.49, -121.15, 0);
  assert.ok(north[1] > 44.49); assert.ok(Math.abs(north[0] + 121.15) < 1e-8);
  const east = headingEndpoint(44.49, -121.15, 90);
  assert.ok(east[0] > -121.15); assert.ok(Math.abs(east[1] - 44.49) < 1e-6);
  const url = satelliteUrl(input(), "token+test");
  const overlay = JSON.parse(decodeURIComponent(url.match(/geojson\((.*?)\)\//)[1]));
  assert.deepEqual(overlay.features[0].geometry.coordinates[0], [-121.15, 44.49]);
  assert.deepEqual(overlay.features[1].geometry.coordinates, [-121.15, 44.49]);
  assert.match(url, /satellite-v9/); assert.match(url, /17,0,0\/1024x1024/);
  assert.equal(new URL(url).searchParams.get("access_token"), "token+test");
});

test("sends both images, authoritative instructions, requested model and forced tool; returns validated plan without caching", async () => {
  let calls = 0;
  const response = await handleRequest(request(), env, upstream(plan(), (url, options) => {
    calls++;
    if (!url.includes("anthropic.com")) return;
    const body = JSON.parse(options.body);
    assert.equal(body.model, MODEL); assert.equal(MODEL, "claude-sonnet-5");
    assert.equal(body.tool_choice.type, "tool"); assert.equal(body.tool_choice.name, body.tools[0].name);
    assert.deepEqual(body.thinking, { type: "disabled" });
    const images = body.messages[0].content.filter(block => block.type === "image");
    assert.equal(images.length, 2);
    assert.equal(images[0].source.data, "/9j/2Q==");
    assert.equal(images[1].source.media_type, "image/jpeg");
    assert.ok(!options.body.includes(env.MAPBOX_TOKEN));
    assert.match(body.system, /may be years old/); assert.match(body.system, /NEVER state depth, fish presence, or current water level as fact/);
    assert.match(body.system, /weed edge versus shadow/);
    assert.equal(options.headers["x-api-key"], env.ANTHROPIC_API_KEY);
  }));
  assert.equal(calls, 2); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), plan());
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("clarification responses have no zones, and answers reach the next analysis", async () => {
  const question = { kind: "question", question: "Which way is the current moving?", options: ["Left", "Right", "Not sure"] };
  const first = await handleRequest(request(), env, upstream(question));
  assert.deepEqual(await first.json(), question);
  const body = input(); body.answers = [{ question: question.question, answer: "Left" }];
  const next = await handleRequest(request(body), env, upstream(plan(), (url, options) => {
    if (url.includes("anthropic.com")) {
      const content = JSON.parse(options.body).messages[0].content;
      assert.match(content.at(-1).text, /"answer":"Left"/);
    }
  }));
  assert.equal(next.status, 200);
});

test("portrait grids allow A-D / 1-6 and landscape grids A-F / 1-4", () => {
  assert.equal(gridCells(landscape).length, 24); assert.equal(gridCells(portrait).length, 24);
  assert.ok(gridCells(portrait).includes("D6")); assert.ok(!gridCells(portrait).includes("F2"));
  assert.ok(resultSchema(landscape).oneOf[0].properties.zones.items.properties.cell.enum.includes("F4"));
  const result = plan(); result.zones[0].cell = "D6";
  assert.equal(validateResult(result, portrait, input().tackle), result);
  assert.throws(() => validateResult(result, landscape, input().tackle));
});

test("invalid model plans never escape validation", async () => {
  for (const mutate of [
    value => { value.zones[0].cell = "G2"; }, value => { value.zones[1].cell = value.zones[0].cell; },
    value => { value.zones[0].title = "Try this"; }, value => { value.zones[0].id = 2; },
    value => { value.zones[0].reasons[0].source = "internet"; }, value => { value.zones[0].tackle = "Not owned"; },
    value => { value.zones.push(value.zones[0]); }, value => { value.visible = []; },
    value => { value.guesses = []; }, value => { value.extra = true; },
  ]) {
    const result = plan(); mutate(result);
    assert.equal((await handleRequest(request(), env, upstream(result))).status, 502);
  }
  const questionWithZones = { kind: "question", question: "Which way?", options: ["Left", "Right"], zones: [] };
  assert.equal((await handleRequest(request(), env, upstream(questionWithZones))).status, 502);
});

test("suggested unowned tackle is accepted only when explicitly marked as alternative", () => {
  const result = plan(); result.zones[0].tackle = "A small spoon"; result.zones[0].fromMyTackle = false;
  assert.equal(validateResult(result, landscape, input().tackle), result);
  assert.throws(() => validateResult({ kind: "question", question: "Which way?", options: ["Left", "Left"] }, landscape));
});

test("upstream errors, secrets and raw payloads are never exposed", async () => {
  for (const fetcher of [
    async () => new Response(`SECRET ${env.MAPBOX_TOKEN}`, { status: 403 }),
    async () => { throw new Error(`SECRET ${env.MAPBOX_TOKEN}`); },
    async (url) => url.includes("mapbox.com") ? new Response("image", { headers: { "content-type": "image/jpeg" } }) :
      new Response(`SECRET ${env.ANTHROPIC_API_KEY}`, { status: 500 }),
  ]) {
    const response = await handleRequest(request(), env, fetcher);
    assert.equal(response.status, 502);
    const message = await response.text();
    assert.ok(!message.includes("SECRET")); assert.ok(!message.includes(env.MAPBOX_TOKEN)); assert.ok(!message.includes(env.ANTHROPIC_API_KEY));
  }
});

test("existing Ask endpoint keeps its answer shape and authentication", async () => {
  const req = new Request("https://worker.test/api/advisor", request({ question: "Where today?", date: input().context.date, context: [{ name: "Haystack", score: 55 }] }));
  const response = await handleRequest(req, env, async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(JSON.parse(options.body).model, MODEL);
    return Response.json({ content: [{ type: "text", text: "Try Haystack today." }] });
  });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { answer: "Try Haystack today." });
});
