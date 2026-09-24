// Fish This Spot plans live in IndexedDB, including their image Blobs.
// Keeping a transaction open across an await can break on Safari, so every
// request below is created synchronously and resolved only after commit.
const DATABASE = "redside.spot-plans.v1";
const STORE = "plans";
const STATUSES = new Set(["queued", "analyzing", "question", "ready", "error"]);
let databasePromise;

function storageError(cause) {
  const name = cause?.name || "StorageError";
  const message = name === "QuotaExceededError"
    ? "This device is out of storage. Delete an older saved plan and try again."
    : name === "BlockedError"
      ? "Close other Redside tabs, then try saving this plan again."
      : "Redside could not open or save its photo storage. Check that this browser allows website storage and try again.";
  const error = new Error(message);
  error.name = name;
  error.cause = cause;
  return error;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(storageError(new Error("IndexedDB is unavailable")));
      return;
    }
    let settled = false;
    let request;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt", { unique: false });
    };
    request.onblocked = () => {
      settled = true;
      reject(storageError({ name: "BlockedError" }));
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error));
    };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked request can finish after its caller has already given up.
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      db.onclose = () => { databasePromise = undefined; };
      resolve(db);
    };
  }).catch((error) => { databasePromise = undefined; throw error; });
  return databasePromise;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    let value;
    let failure;
    try {
      tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(storageError(failure || tx.error));
      tx.onerror = () => { /* The transaction abort reports the final error. */ };
      operation(tx.objectStore(STORE), (result) => { value = result; }, error => {
        failure = error;
        try { tx.abort(); } catch { reject(storageError(error)); }
      });
    } catch (error) {
      if (tx) { try { tx.abort(); } catch { /* Already finished. */ } }
      reject(storageError(error));
    }
  });
}

export async function savePlan(plan) {
  if (!plan || typeof plan.id !== "string" || !plan.id ||
      !Number.isFinite(plan.createdAt) || !STATUSES.has(plan.status) ||
      !(plan.photo instanceof Blob) || !(plan.griddedPhoto instanceof Blob)) {
    throw new Error("This photo plan is incomplete and could not be saved.");
  }
  await transaction("readwrite", (store) => { store.put(plan); });
  return plan;
}

export async function getPlan(id) {
  return transaction("readonly", (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(request.result || null);
  });
}

// Read/modify/write in one transaction, so a stale queue snapshot cannot bring a
// deleted plan back. The updater must be synchronous; null means no change.
export async function updatePlan(id, updater) {
  return transaction("readwrite", (store, done, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (!request.result) { done(null); return; }
        const next = updater(request.result);
        if (!next) { done(null); return; }
        store.put(next);
        done(next);
      } catch (error) { fail(error); }
    };
  });
}

export async function listPlans() {
  return transaction("readonly", (store, done) => {
    const plans = [];
    const request = store.index("createdAt").openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done(plans); return; }
      plans.push(cursor.value);
      cursor.continue();
    };
  });
}

export async function deletePlan(id) {
  await transaction("readwrite", (store) => { store.delete(id); });
}
