import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import { createHiggsfieldClientAdapter, HiggsfieldIntegrationError } from "./higgsfield-client.js";

const ID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
const STATUS_URL = `https://api.higgsfield.ai/requests/${ID}/status`;
const ENV = { HF_CREDENTIALS: "test-key:test-secret" };
const queued = () => ({ request_id: ID, status: "queued", status_url: STATUS_URL, cancel_url: `https://api.higgsfield.ai/requests/${ID}/cancel` });

async function localProvider(t, handle) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString() || "null") });
    handle(request, response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { requests, sdkFactory: config => createHiggsfieldClient({ ...config, baseURL: `http://127.0.0.1:${server.address().port}` }) };
}

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

test("official SDK submits once without polling, preserves request references and its documented authentication", async t => {
  const provider = await localProvider(t, (_, response) => json(response, queued()));
  const adapter = createHiggsfieldClientAdapter(ENV, provider);
  const result = await adapter.submit("bytedance/seedance-2.0/text-to-video", { prompt: "A river at dawn", resolution: "720p", generate_audio: true, duration: 5, aspect_ratio: "16:9" });
  assert.deepEqual(result, queued());
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].method, "POST");
  assert.equal(provider.requests[0].url, "/bytedance/seedance-2.0/text-to-video");
  assert.equal(provider.requests[0].headers.authorization, "Key test-key:test-secret");
  assert.equal(provider.requests[0].headers["user-agent"], "higgsfield-server-js/2.0");
  assert.equal(provider.requests[0].body.prompt, "A river at dawn");
  assert.equal(provider.requests[0].body.duration, 5);
  assert.equal(provider.requests[0].body.generate_audio, true);
});

test("official SDK does not repeat an ambiguous server failure or leak provider details", async t => {
  const provider = await localProvider(t, (_, response) => json(response, { detail: "test-secret and private prompt" }, 500));
  await assert.rejects(createHiggsfieldClientAdapter(ENV, provider).submit("vendor/model/generate", { prompt: "private prompt" }), error => {
    assert.ok(error instanceof HiggsfieldIntegrationError);
    assert.equal(error.code, "submission_unknown");
    assert.equal(error.ambiguous, true);
    assert.equal(error.retryable, false);
    assert.equal(error.upstreamStatus, 500);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /test-secret|private prompt|Authorization/);
    return true;
  });
  assert.equal(provider.requests.length, 1);
});

test("official SDK submission timeout is unknown and never retried", async t => {
  const provider = await localProvider(t, () => {});
  await assert.rejects(createHiggsfieldClientAdapter(ENV, { ...provider, timeoutMs: 50 }).submit("vendor/model/generate", { prompt: "A lake" }), error => error.code === "submission_unknown" && error.ambiguous && !error.retryable);
  assert.equal(provider.requests.length, 1);
});

test("official SDK credentials stay isolated between concurrent instances", async t => {
  const provider = await localProvider(t, (_, response) => json(response, queued()));
  await Promise.all([
    createHiggsfieldClientAdapter({ HF_CREDENTIALS: "one:secret-one" }, provider).submit("vendor/model/generate", { prompt: "One" }),
    createHiggsfieldClientAdapter({ HF_CREDENTIALS: "two:secret-two" }, provider).submit("vendor/model/generate", { prompt: "Two" }),
  ]);
  const byPrompt = new Map(provider.requests.map(request => [request.body.prompt, request.headers.authorization]));
  assert.equal(byPrompt.get("One"), "Key one:secret-one");
  assert.equal(byPrompt.get("Two"), "Key two:secret-two");
});

test("SDK authentication, validation, and credit errors are sanitized and never retried", async t => {
  for (const [status, expected] of [[401, "authentication_failed"], [403, "insufficient_credits"], [422, "invalid_input"], [429, "rate_limited"]]) {
    const provider = await localProvider(t, (_, response) => json(response, { detail: "test-secret private prompt" }, status));
    await assert.rejects(createHiggsfieldClientAdapter(ENV, provider).submit("vendor/model/generate", { prompt: "Prompt" }), error => {
      assert.equal(error.code, expected);
      assert.equal(error.ambiguous, false);
      assert.equal(error.retryable, false);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /test-secret|private prompt/);
      return true;
    });
    assert.equal(provider.requests.length, 1);
  }
});

test("rejects bad credentials, endpoints and unbounded/non-JSON inputs before SDK submission", async () => {
  for (const credentials of [undefined, "", "single-token", "key:secret:extra", "key:secret\n"]) {
    assert.throws(() => createHiggsfieldClientAdapter({ HF_CREDENTIALS: credentials }), error => error.code === "not_configured");
  }
  let calls = 0;
  const adapter = createHiggsfieldClientAdapter(ENV, { sdkFactory: () => { calls++; throw new Error("Should not submit"); } });
  for (const endpoint of ["https://evil.test/model", "../model", "model?override=true", "/vendor/model"]) {
    await assert.rejects(adapter.submit(endpoint, { prompt: "Prompt" }), error => error.code === "invalid_input");
  }
  const cycle = {}; cycle.self = cycle;
  for (const input of [[], { prompt: "a".repeat(300000) }, { value: NaN }, { value: () => {} }, cycle]) {
    await assert.rejects(adapter.submit("vendor/model", input), error => error.code === "invalid_input");
  }
  assert.equal(calls, 0);
});

test("malformed submit response is ambiguous; an accepted job must not be resubmitted", async () => {
  for (const value of [{}, { ...queued(), status: "unknown" }, { ...queued(), status_url: "https://evil.test/status" }, { ...queued(), status: "completed" }]) {
    const adapter = createHiggsfieldClientAdapter(ENV, { sdkFactory: () => ({ subscribe: async () => value }) });
    await assert.rejects(adapter.submit("vendor/model", { prompt: "Prompt" }), error => error.code === "invalid_response" && error.ambiguous && !error.retryable);
  }
});

test("status follows the verified returned URL with application User-Agent and validates ownership reference", async () => {
  let calls = 0;
  const adapter = createHiggsfieldClientAdapter(ENV, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, STATUS_URL);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Key test-key:test-secret");
    assert.match(options.headers["User-Agent"], /^Redside\/1\.0/);
    assert.equal(options.redirect, "error");
    return Response.json({ request_id: ID, status: "completed", video: { url: "https://cdn.higgsfield.ai/result.mp4", extra: "ignored" } }, { headers: { "X-Correlation-ID": "test-correlation" } });
  } });
  const result = await adapter.status(ID, STATUS_URL);
  assert.equal(result.status_url, STATUS_URL);
  assert.equal(result.correlation_id, "test-correlation");
  assert.deepEqual(result.video, { url: "https://cdn.higgsfield.ai/result.mp4" });
  assert.equal(calls, 1);
  for (const url of ["https://evil.test/status", STATUS_URL.replace("https:", "http:"), `${STATUS_URL}?key=hidden`, `${STATUS_URL}#fragment`, STATUS_URL.replace("api.higgsfield.ai", "user:pass@api.higgsfield.ai"), STATUS_URL.replace(ID, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]) {
    await assert.rejects(adapter.status(ID, url), error => error.code === "invalid_input");
  }
  assert.equal(calls, 1);
});

test("status recognizes canceled, failed and moderated terminal states without publishing their media", async () => {
  for (const status of ["queued", "in_progress", "failed", "nsfw", "canceled"]) {
    const adapter = createHiggsfieldClientAdapter(ENV, { fetchImpl: async () => Response.json({ ...queued(), status, error: "provider private detail", video: { url: "https://cdn.higgsfield.ai/hidden.mp4" } }) });
    const result = await adapter.status(ID, STATUS_URL);
    assert.equal(result.status, status);
    assert.equal(result.video, undefined);
    assert.equal(result.error, status === "failed" ? "Generation failed." : undefined);
  }
});

test("status rate limits preserve retry timing and correlation without automatically polling", async () => {
  let calls = 0;
  const adapter = createHiggsfieldClientAdapter(ENV, { fetchImpl: async () => {
    calls++;
    return new Response("private provider detail", { status: 429, headers: { "Retry-After": "12", "X-Correlation-ID": "corr-123" } });
  } });
  await assert.rejects(adapter.status(ID, STATUS_URL), error => {
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    assert.equal(error.ambiguous, false);
    assert.equal(error.retryAfterSeconds, 12);
    assert.equal(error.correlationId, "corr-123");
    return true;
  });
  assert.equal(calls, 1);
});

test("status timeout aborts its fetch and reports a retryable read failure", async () => {
  const adapter = createHiggsfieldClientAdapter(ENV, { timeoutMs: 10, fetchImpl: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("test-secret must not be copied")), { once: true });
  }) });
  await assert.rejects(adapter.status(ID, STATUS_URL), error => error.code === "provider_unavailable" && error.retryable && !error.ambiguous && !error.message.includes("test-secret"));
});

test("status rejects mismatched requests, unsafe outputs and oversized JSON", async () => {
  for (const response of [
    Response.json({ ...queued(), request_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    Response.json({ ...queued(), status: "completed", images: [{ url: "javascript:alert(1)" }] }),
    new Response("a".repeat(300000)),
    new Response("not JSON"),
  ]) {
    const adapter = createHiggsfieldClientAdapter(ENV, { fetchImpl: async () => response });
    await assert.rejects(adapter.status(ID, STATUS_URL), error => error.code === "invalid_response" && error.retryable && !error.ambiguous);
  }
});

test("SDK webhook is encoded as a query parameter and never presented as a verified signature", async t => {
  const provider = await localProvider(t, (_, response) => json(response, queued()));
  await createHiggsfieldClientAdapter(ENV, provider).submit("vendor/model", { prompt: "Prompt" }, { webhook: { url: "https://example.test/hooks?token=opaque-callback-token" } });
  const requestUrl = new URL(provider.requests[0].url, "http://localhost");
  assert.equal(requestUrl.searchParams.get("hf_webhook"), "https://example.test/hooks?token=opaque-callback-token");
  assert.equal(provider.requests[0].body.webhook, undefined);
});
