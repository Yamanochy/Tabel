// ============================================================
// ОФЛАЙН-ОЧЕРЕДЬ — если при сохранении смены нет интернета, запись
// (вместе с уже сжатыми фото) кладётся в IndexedDB на телефоне и сама
// отправляется, как только сеть появится снова.
// ============================================================

const OFFLINE_DB_NAME = "tabel-offline-queue";
const OFFLINE_STORE = "pending";

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(OFFLINE_STORE)) {
        req.result.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(kind, payload, photoBlobs) {
  const idb = await openOfflineDB();
  const item = {
    id: "q" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    kind, payload, photoBlobs, queuedAt: Date.now(),
  };
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return item;
}

async function queueGetAll() {
  try {
    const idb = await openOfflineDB();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function queueDelete(id) {
  const idb = await openOfflineDB();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

let pendingQueueCache = [];
let offlineFlushInProgress = false;

async function refreshPendingQueueCache() {
  pendingQueueCache = await queueGetAll();
}

function looksLikeNetworkError(e) {
  if (!navigator.onLine) return true;
  const msg = String(e && e.message || "");
  return /fetch|network|internet|offline/i.test(msg);
}

async function flushOfflineQueue() {
  if (offlineFlushInProgress) return;
  offlineFlushInProgress = true;
  let syncedShift = false, syncedAdvance = false;
  try {
    await refreshPendingQueueCache();
    for (const item of pendingQueueCache) {
      try {
        const urls = [];
        for (const blob of item.photoBlobs) {
          urls.push(await uploadToCloudinary(blob));
        }
        const coll = item.kind === "advance" ? "tabelAdvances" : "tabelShifts";
        const urlField = item.kind === "advance" ? "receiptUrls" : "photoUrls";
        await db.collection(coll).add({
          ...item.payload,
          [urlField]: urls,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await queueDelete(item.id);
        if (item.kind === "advance") syncedAdvance = true; else syncedShift = true;
      } catch (e) {
        break; // сети всё ещё нет — остальное попробуем позже
      }
    }
  } finally {
    await refreshPendingQueueCache();
    offlineFlushInProgress = false;
    if (typeof currentTab !== "undefined") {
      if (syncedShift && currentTab === "shifts" && !shiftFormOpen) render();
      if (syncedAdvance && currentTab === "advances" && !advanceFormOpen) render();
      if ((syncedShift || syncedAdvance) && currentTab === "summary") render();
    }
  }
}

window.addEventListener("online", () => flushOfflineQueue());
setInterval(() => { if (navigator.onLine) flushOfflineQueue(); }, 25000);
