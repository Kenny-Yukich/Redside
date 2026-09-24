import { createHiggsfieldClient } from "@higgsfield/client/v2";

const API_ORIGIN = "https://api.higgsfield.ai";
const USER_AGENT = "Redside/1.0 (Higgsfield generation jobs)";
const MAX_JSON_BYTES = 256 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUSES = new Set(["queued", "in_progress", "completed", "failed", "nsfw", "canceled"]);

// Safe to store or return. Never attach raw SDK errors: Axios errors contain
// the Authorization header and submitted prompt in their request config.
export class HiggsfieldIntegrationError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "HiggsfieldIntegrationError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 502;
    this.retryable = options.retryable ?? false;
    this.ambiguous = options.ambiguous ?? false;
    if (options.upstreamStatus) this.upstreamStatus = options.upstreamStatus;
    if (options.correlationId) this.correlationId = options.correlationId;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return new HiggsfieldIntegrationError("invalid_input", message, { httpStatus: 400 });
}

function credentialsFrom(env) {
  const value = env?.HF_CREDENTIALS;
  if (typeof value !== "string" || value.length > 1024 || !/^[^:\s]+:[^:\s]+$/.test(value)) {
    throw new HiggsfieldIntegrationError("not_configured", "Higgsfield credentials are not configured on the server.", { httpStatus: 503 });
  }
  return value;
}

function validateEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 200 ||
      !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i.test(endpoint)) {
    throw invalidInput("Choose a supported generation model.");
  }
}

function validateJsonInput(input) {
  const valid = (value, depth = 0) => {
    if (depth > 12) return false;
    if (value === null || typeof value === "boolean") return true;
    if (typeof value === "string") return value.length <= MAX_JSON_BYTES;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => valid(item, depth + 1));
    return object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
      Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) =>
        key.length <= 100 && !["__proto__", "constructor", "prototype"].includes(key) && valid(item, depth + 1));
  };
  if (!object(input) || !valid(input) || new TextEncoder().encode(JSON.stringify(input)).length > MAX_JSON_BYTES) {
    throw invalidInput("Generation inputs must be a bounded JSON object.");
  }
}

function requestUrl(requestId, value, action = "status") {
  if (typeof requestId !== "string" || !UUID.test(requestId) || typeof value !== "string") {
    throw invalidInput("Invalid generation request reference.");
  }
  let url;
  try { url = new URL(value); } catch { throw invalidInput("Invalid generation request reference."); }
  if (url.origin !== API_ORIGIN || url.username || url.password || url.search || url.hash ||
      url.pathname !== `/requests/${requestId}/${action}`) {
    throw invalidInput("Invalid generation request reference.");
  }
  return url.href;
}

function invalidResponse(phase) {
  return new HiggsfieldIntegrationError("invalid_response", "Higgsfield returned an unexpected response. Check the existing request before trying again.", {
    ambiguous: phase === "submit", retryable: phase !== "submit",
  });
}

function media(value, phase) {
  if (!object(value) || typeof value.url !== "string" || value.url.length > 8192) throw invalidResponse(phase);
  let url;
  try { url = new URL(value.url); } catch { throw invalidResponse(phase); }
  if (url.protocol !== "https:" || url.username || url.password) throw invalidResponse(phase);
  return { url: url.href };
}

function normalizeResponse(value, phase, expectedId, fallbackStatusUrl) {
  if (!object(value) || !STATUSES.has(value.status) || typeof value.request_id !== "string" ||
      !UUID.test(value.request_id) || (expectedId && value.request_id !== expectedId)) throw invalidResponse(phase);
  const result = { request_id: value.request_id, status: value.status };
  try {
    result.status_url = requestUrl(value.request_id, value.status_url ?? fallbackStatusUrl);
    if (value.cancel_url !== undefined) result.cancel_url = requestUrl(value.request_id, value.cancel_url, "cancel");
  } catch { throw invalidResponse(phase); }
  if (value.status === "completed") {
    if (value.images !== undefined) {
      if (!Array.isArray(value.images) || value.images.length > 16) throw invalidResponse(phase);
      result.images = value.images.map(item => media(item, phase));
    }
    if (value.video !== undefined) result.video = media(value.video, phase);
    if (value.audio !== undefined) result.audio = media(value.audio, phase);
    if (!result.images?.length && !result.video && !result.audio) throw invalidResponse(phase);
  }
  if (value.status === "failed") result.error = "Generation failed.";
  return result;
}

function correlationId(headers) {
  const value = headers?.get("x-correlation-id");
  return typeof value === "string" && /^[a-z0-9._:-]{1,128}$/i.test(value) ? value : undefined;
}

function retryAfterSeconds(headers) {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(delay) ? Math.max(0, Math.min(3600, Math.ceil(delay))) : undefined;
}

function providerError(error, phase, headers) {
  if (error instanceof HiggsfieldIntegrationError) return error;
  const status = Number(error?.statusCode ?? error?.response?.status);
  const options = {
    upstreamStatus: Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
    correlationId: correlationId(headers),
    retryAfterSeconds: retryAfterSeconds(headers),
    // Never retry a generation POST, even when the provider returned 5xx.
    retryable: phase === "status" && (!status || status >= 500 || [423, 429].includes(status)),
    ambiguous: phase === "submit" && (!status || status >= 500),
  };
  if (error?.name === "AuthenticationError" || status === 401) {
    return new HiggsfieldIntegrationError("authentication_failed", "Higgsfield rejected the server credentials.", { ...options, httpStatus: 503, ambiguous: false, retryable: false });
  }
  if (error?.name === "CredentialsMissedError") {
    return new HiggsfieldIntegrationError("not_configured", "Higgsfield credentials are not configured on the server.", { ...options, httpStatus: 503, ambiguous: false, retryable: false });
  }
  if (status === 403 || error?.name === "NotEnoughCreditsError") {
    return new HiggsfieldIntegrationError("insufficient_credits", "Higgsfield could not accept this request. Check account access and credits.", { ...options, httpStatus: 503, ambiguous: false, retryable: false });
  }
  if ([400, 422].includes(status)) {
    return new HiggsfieldIntegrationError("invalid_input", "Higgsfield rejected these generation inputs.", { ...options, httpStatus: 422 });
  }
  if (status === 404) {
    return new HiggsfieldIntegrationError("not_found", "Higgsfield could not find this model or request for the account.", { ...options, httpStatus: 404 });
  }
  if (status === 429) {
    return new HiggsfieldIntegrationError("rate_limited", "Higgsfield is receiving too many requests. Wait before trying again.", { ...options, httpStatus: 429 });
  }
  if (options.ambiguous) {
    return new HiggsfieldIntegrationError("submission_unknown", "The submission outcome is unknown. Check Higgsfield request history before creating another generation.", { ...options, httpStatus: 504 });
  }
  return new HiggsfieldIntegrationError("provider_unavailable", "Higgsfield is temporarily unavailable.", { ...options, httpStatus: 503 });
}

async function readJson(response) {
  if (Number(response.headers.get("content-length")) > MAX_JSON_BYTES) throw invalidResponse("status");
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse("status");
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        throw invalidResponse("status");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalidResponse("status"); }
}

/**
 * Model-specific schemas and job ownership belong to the application layer.
 * Dependencies are injectable for local tests, never supplied by HTTP callers.
 * JS SDK 0.2.6 cannot resume an existing request: only status uses REST.
 */
export function createHiggsfieldClientAdapter(env, dependencies = {}) {
  const credentials = credentialsFrom(env);
  const sdkFactory = dependencies.sdkFactory ?? createHiggsfieldClient;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const timeoutMs = dependencies.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw invalidInput("Invalid generation timeout.");
  return {
    async submit(endpoint, input, options = {}) {
      validateEndpoint(endpoint);
      validateJsonInput(input);
      let webhook;
      if (options.webhook !== undefined) {
        let url;
        try { url = new URL(options.webhook.url); } catch { throw invalidInput("Invalid generation webhook URL."); }
        if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href.length > 2048) {
          throw invalidInput("Invalid generation webhook URL.");
        }
        // SDK accepts `secret` but does not transmit it; use an application
        // callback token in the URL and recheck status with provider credentials.
        webhook = { url: url.href, secret: "" };
      }
      try {
        const client = sdkFactory({ credentials, timeout: timeoutMs, maxRetries: 0 });
        const value = await client.subscribe(endpoint, { input, withPolling: false, ...(webhook ? { webhook } : {}) });
        return normalizeResponse(value, "submit");
      } catch (error) { throw providerError(error, "submit"); }
    },
    async status(requestId, statusUrl) {
      const url = requestUrl(requestId, statusUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Key ${credentials}`, Accept: "application/json", "User-Agent": USER_AGENT },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw providerError({ statusCode: response.status }, "status", response.headers);
        }
        const result = normalizeResponse(await readJson(response), "status", requestId, url);
        const correlation = correlationId(response.headers);
        if (correlation) result.correlation_id = correlation;
        return result;
      } catch (error) {
        const safeError = providerError(error, "status", response?.headers);
        if (!safeError.correlationId) {
          const correlation = correlationId(response?.headers);
          if (correlation) safeError.correlationId = correlation;
        }
        throw safeError;
      } finally { clearTimeout(timer); }
    },
  };
}
