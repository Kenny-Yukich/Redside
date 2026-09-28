import { getSpotSettings } from "./spot-settings.js";
import { listPlans, updatePlan } from "./spot-store.js";
import { blobDataURL, annotatePhoto } from "./spot-media.js";
import { validateResult } from "./spot-contract.js";

let running = false;
let started = false;
export function notifyPlans(id) { window.dispatchEvent(new CustomEvent("spot-plans-changed", { detail: { id } })); }

async function drain() {
  if (!navigator.onLine) return;
  const settings = getSpotSettings();
  if (!settings.workerUrl || !settings.passphrase) return;
  const plans = (await listPlans()).reverse();
  for (const candidate of plans) {
    if (!navigator.onLine) break;
    // Claim the current stored record atomically, never the initial snapshot.
    // Interrupted requests need an explicit retry because the server may have
    // completed them while iOS suspended the app.
    const plan = await updatePlan(candidate.id, current => {
      if (current.status === "analyzing" && Date.now() - (current.startedAt || 0) > 180000) {
        return { ...current, status: "error", lastError: "This analysis was interrupted. Your photo is saved. Tap Retry to send it again." };
      }
      return current.status === "queued" ? { ...current, status: "analyzing", startedAt: Date.now(), lastError: "" } : null;
    });
    if (!plan) continue;
    notifyPlans(plan.id);
    if (plan.status !== "analyzing") continue;
    const controller = new AbortController();
    // Allow the Worker's 20-second map and 90-second model limits plus transit.
    const timer = setTimeout(() => controller.abort(), 125000);
    try {
      const response = await fetch(`${settings.workerUrl}/analyze`, {
        method: "POST", mode: "cors", cache: "no-store", credentials: "omit",
        headers: { "Content-Type": "application/json", "x-app-passphrase": settings.passphrase },
        body: JSON.stringify({ ...plan.inputs, grid: plan.grid, photo: await blobDataURL(plan.griddedPhoto) }),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fallback = { 401: "The app passphrase was not accepted. Update it in Settings to match your Worker.", 403: "The service refused access. Check the website allowed by your Worker.", 404: "The analysis service was not found. Check the full Worker URL in Settings and deploy the latest Worker.", 429: "The advisor is busy. Wait a minute before retrying.", 503: "The analysis service is not configured. Check the Worker secrets and deployment." };
        const message = typeof json.error === "string" && json.error.length < 500 && !/[{}<>]/.test(json.error) ? json.error : null;
        throw new Error(message || fallback[response.status] || "The analysis service could not finish. Your photo is saved. Check the service setup before retrying.");
      }
      let result;
      try { result = validateResult(json, plan.grid, plan.inputs.tackle); }
      catch { throw new Error("The advisor returned an incomplete fishing plan. Your photo is saved; try the analysis again."); }
      plan.result = result;
      plan.annotatedPhoto = null;
      plan.status = result.kind === "plan" ? "ready" : "question";
      plan.completedAt = Date.now();
    } catch (error) {
      const network = !navigator.onLine;
      plan.status = network ? "queued" : "error";
      plan.lastError = network ? "Waiting for a connection. If you have signal, check the Worker URL and allowed origin in Settings." :
        error.name === "AbortError" ? "The analysis timed out. Your photo is saved; tap Retry when ready." :
        error instanceof TypeError ? "Cannot reach the AI service. Check the full Worker URL in Settings, your connection, and that the Worker allows this Redside website. Your photo is saved; retry after fixing the connection." : error.message;
    } finally { clearTimeout(timer); }
    // Persist the small model result before allocating a PNG. A full device
    // must not send another paid request just because annotation storage fails.
    let saved;
    try {
      saved = await updatePlan(plan.id, current => current.startedAt === plan.startedAt ? plan : null);
    } catch (error) {
      await updatePlan(plan.id, current => ({ ...current, status: "error", result: plan.result,
        lastError: "Analysis finished but storage is full. Free device storage before retrying; another analysis may be charged." })).catch(() => {});
      notifyPlans(plan.id);
      throw error;
    }
    if (saved && plan.status === "ready") {
      try {
        const annotatedPhoto = await annotatePhoto(plan.photo, plan.result, plan.grid);
        await updatePlan(plan.id, current => ({ ...current, annotatedPhoto }));
      } catch {
        window.dispatchEvent(new CustomEvent("spot-storage-error", { detail: "The plan is saved. Its share photo could not be stored; it can be prepared again when you open the plan." }));
      }
    }
    notifyPlans(plan.id);
    if (plan.status === "queued") break;
  }
}

export async function processSpotQueue() {
  if (running) return;
  running = true;
  try {
    if (navigator.locks?.request) await navigator.locks.request("redside-spot-queue", { ifAvailable: true }, lock => lock && drain());
    else await drain();
  } catch (error) {
    window.dispatchEvent(new CustomEvent("spot-storage-error", { detail: error.message }));
  } finally { running = false; }
}
export function startSpotQueue() {
  if (started) return;
  started = true;
  window.addEventListener("online", processSpotQueue);
  window.addEventListener("spot-settings-changed", processSpotQueue);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) processSpotQueue(); });
  // iOS does not reliably support background sync. Resume while the app is open.
  setInterval(() => { if (!document.hidden) processSpotQueue(); }, 60000);
  processSpotQueue();
}
