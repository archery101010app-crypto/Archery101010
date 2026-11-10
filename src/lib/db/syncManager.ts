import { auth, db } from "@/lib/firebase";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import {
  SyncItem,
  getSyncQueue,
  removeFromSyncQueue,
  updateSyncItem,
  sanitizeForFirestore,
  isFictitiousSession,
  isFictitiousUser
} from "./indexedDB";

// State flags to control sequential runs and prevent race conditions
let isSyncing = false;
let syncPending = false;
let syncPendingIgnoreBackoff = false;

// Custom timeout wrapper for network requests (15 seconds limit)
const NETWORK_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("NETWORK_TIMEOUT")), timeoutMs)
    )
  ]);
}

function getBackoffDelayMs(attempts: number): number {
  return Math.min(60000, 2000 * Math.pow(2, Math.max(0, attempts)));
}

function isPlainObject(val: unknown): val is Record<string, any> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date);
}

/**
 * Real-Time Turbo Sync: Coalesced parallel synchronizer that uploads items in the queue
 * to Firebase with zero artificial delay while preserving 100% Offline-First safety.
 *
 * Transient network failures NEVER drop items from syncQueueStore (kept indefinitely with
 * exponential backoff up to 60s). Only true unrecoverable schema/permission errors are
 * dropped after 5 attempts so role/club propagation races can succeed on retry 2-3.
 */
export async function runSync(
  onProgressUpdate?: (pendingCount: number, statusText: string) => void,
  ignoreBackoff: boolean = false
): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (onProgressUpdate) {
      const remaining = await getSyncQueue();
      onProgressUpdate(remaining.length, remaining.length === 0 ? "Sincronizado" : "Sin conexión");
    }
    return;
  }

  // Skip cloud writes when in Offline Guest mode or before Firebase Auth session is active
  if (!auth.currentUser) {
    if (onProgressUpdate) {
      const remaining = await getSyncQueue();
      onProgressUpdate(remaining.length, remaining.length === 0 ? "Sincronizado" : "Modo local");
    }
    return;
  }

  if (isSyncing) {
    syncPending = true;
    if (ignoreBackoff) syncPendingIgnoreBackoff = true;
    if (onProgressUpdate) onProgressUpdate(-1, "Sincronizando...");
    return;
  }

  isSyncing = true;
  if (onProgressUpdate) onProgressUpdate(-1, "Conectando...");

  try {
    let queue = await getSyncQueue();
    const skippedKeys = new Set<string>();

    while (queue.length > 0) {
      // Group items by collection + payloadId to coalesce redundant intermediate updates safely
      const latestByTarget = new Map<string, SyncItem>();
      const supersededIds: string[] = [];
      const mergedPersistQueue: SyncItem[] = [];

      for (const item of queue) {
        const targetKey = `${item.collection}:${item.payloadId}`;
        if (skippedKeys.has(targetKey)) continue;

        const existing = latestByTarget.get(targetKey);
        if (existing) {
          supersededIds.push(existing.id);
          if (item.operation === "DELETE") {
            latestByTarget.set(targetKey, item);
          } else {
            const mergedPayload =
              isPlainObject(existing.payload) && isPlainObject(item.payload)
                ? { ...existing.payload, ...item.payload }
                : item.payload ?? existing.payload;
            const mergedOp: SyncItem["operation"] =
              existing.operation === "INSERT" && item.operation === "UPDATE"
                ? "INSERT"
                : item.operation;
            const mergedItem: SyncItem = {
              ...item,
              operation: mergedOp,
              payload: mergedPayload,
              attempts: item.lastAttemptAt
                ? Math.max(existing.attempts || 0, item.attempts || 0)
                : item.attempts || 0,
              lastAttemptAt: item.lastAttemptAt
            };
            latestByTarget.set(targetKey, mergedItem);
            mergedPersistQueue.push(mergedItem);
          }
        } else {
          latestByTarget.set(targetKey, item);
        }
      }

      // Persist merged payloads FIRST before removing superseded items so zero fields can ever be lost
      if (mergedPersistQueue.length > 0) {
        await Promise.all(
          mergedPersistQueue.map((m) =>
            updateSyncItem(m.id, {
              operation: m.operation,
              payload: m.payload,
              attempts: m.attempts,
              lastAttemptAt: m.lastAttemptAt
            })
          )
        );
      }

      if (supersededIds.length > 0) {
        await Promise.all(supersededIds.map((id) => removeFromSyncQueue(id)));
      }

      const nowMs = Date.now();
      const batchItems: SyncItem[] = [];
      for (const [targetKey, item] of latestByTarget.entries()) {
        // Never attempt to push Offline Guest documents before migration to a real UID
        if (
          item.payloadId === "USR-GUEST-OFFLINE" ||
          item.payload?.uid === "USR-GUEST-OFFLINE" ||
          item.payload?.userId === "USR-GUEST-OFFLINE"
        ) {
          skippedKeys.add(targetKey);
          continue;
        }

        if (!ignoreBackoff && item.lastAttemptAt && (item.attempts || 0) > 0) {
          const backoffMs = getBackoffDelayMs(item.attempts || 0);
          if (nowMs - item.lastAttemptAt < backoffMs) {
            skippedKeys.add(targetKey);
            continue;
          }
        }
        batchItems.push(item);
      }

      if (batchItems.length === 0) {
        break;
      }

      if (onProgressUpdate) {
        onProgressUpdate(batchItems.length, `Subiendo ${batchItems.length} en tiempo real...`);
      }

      let networkAborted = false;

      // Execute independent document writes in parallel for maximum real-time throughput
      await Promise.allSettled(
        batchItems.map(async (item) => {
          const targetKey = `${item.collection}:${item.payloadId}`;
          const docRef = doc(db, item.collection, item.payloadId);

          try {
            if (
              (item.collection === "sessions" &&
                isFictitiousSession(item.payload || { id: item.payloadId }, item.payloadId)) ||
              (item.collection === "users" &&
                isFictitiousUser(item.payload || { uid: item.payloadId }))
            ) {
              await removeFromSyncQueue(item.id);
              return;
            }
            const cleanPayload = sanitizeForFirestore({
              ...(item.payload || {}),
              updatedAt: item.payload?.updatedAt ?? Date.now()
            });
            if (item.operation === "INSERT") {
              await withTimeout(setDoc(docRef, cleanPayload, { merge: true }), NETWORK_TIMEOUT_MS);
            } else if (item.operation === "UPDATE") {
              if (item.collection === "ad_campaigns" && !cleanPayload.name) {
                const { id: _omitId, ...metricOnlyPayload } = cleanPayload;
                await withTimeout(updateDoc(docRef, metricOnlyPayload), NETWORK_TIMEOUT_MS);
              } else {
                await withTimeout(
                  setDoc(docRef, cleanPayload, { merge: true }),
                  NETWORK_TIMEOUT_MS
                );
              }
            } else if (item.operation === "DELETE") {
              await withTimeout(deleteDoc(docRef), NETWORK_TIMEOUT_MS);
            }

            await removeFromSyncQueue(item.id);
          } catch (err: any) {
            const errCode = String(err?.code || "");
            const errMsg = String(err?.message || err || "");
            const nextAttempts = (item.attempts || 0) + 1;
            const attemptTs = Date.now();

            // Local demo ad campaigns (AD-DEMO-*) don't exist in Firestore unless created by SuperAdmin
            if (
              item.collection === "ad_campaigns" &&
              (errCode.includes("not-found") || errMsg.includes("No document to update"))
            ) {
              await removeFromSyncQueue(item.id);
              return;
            }

            const isTransientNetworkError =
              (typeof navigator !== "undefined" && !navigator.onLine) ||
              errMsg.includes("NETWORK_TIMEOUT") ||
              errMsg.includes("Sync timeout") ||
              errCode.includes("unavailable") ||
              errMsg.includes("unavailable") ||
              errCode.includes("deadline-exceeded") ||
              errMsg.includes("deadline-exceeded") ||
              errCode.includes("network-request-failed") ||
              errMsg.includes("network-request-failed") ||
              errMsg.includes("Failed to fetch") ||
              errMsg.toLowerCase().includes("offline");

            if (isTransientNetworkError) {
              // NEVER drop user sessions/events on weak or offline signal! Keep indefinitely with backoff.
              console.warn(
                `[SyncManager] Transient network failure for ${item.id} (${targetKey}), attempt #${nextAttempts}. Retained in queue with backoff.`
              );
              await updateSyncItem(item.id, {
                status: "failed",
                attempts: nextAttempts,
                lastAttemptAt: attemptTs
              });
              networkAborted = true;
            } else {
              console.error(`Failed to sync item ${item.id}:`, err);
              const isUnrecoverableSchemaOrPerm =
                errCode.includes("permission-denied") ||
                errCode.includes("invalid-argument") ||
                errMsg.includes("Missing or insufficient permissions") ||
                errMsg.includes("Unsupported field value");

              if (isUnrecoverableSchemaOrPerm && nextAttempts >= 5) {
                console.warn(
                  `[SyncManager] Dropping unrecoverable sync item ${item.id} (${targetKey}) after ${nextAttempts} attempts.`
                );
                await removeFromSyncQueue(item.id);
              } else {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("firestore-sync-error", { detail: { error: errMsg } })
                  );
                }
                await updateSyncItem(item.id, {
                  status: "failed",
                  attempts: nextAttempts,
                  lastAttemptAt: attemptTs
                });
              }
            }

            skippedKeys.add(targetKey);
          }
        })
      );

      if (networkAborted) {
        break;
      }

      // Reload queue for any items added while the batch was in flight
      queue = await getSyncQueue();
    }
  } catch (globalErr) {
    console.error("Critical error in sync loop:", globalErr);
  } finally {
    isSyncing = false;

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sync-queue-changed"));
    }

    // If another write arrived while syncing, flush immediately (0ms microtask)
    if (syncPending) {
      const nextIgnore = syncPendingIgnoreBackoff;
      syncPending = false;
      syncPendingIgnoreBackoff = false;
      queueMicrotask(() => {
        runSync(onProgressUpdate, nextIgnore).catch((e) =>
          console.error("Microtask sync error:", e)
        );
      });
    } else if (onProgressUpdate) {
      const remaining = await getSyncQueue();
      onProgressUpdate(remaining.length, remaining.length === 0 ? "Sincronizado" : "Sin conexión");
    }
  }
}

// Auto-flush queue immediately when device regains connectivity, returns to foreground, or Auth hydrates
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    runSync(undefined, true).catch((err) => console.error("Auto-online sync failed:", err));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      runSync().catch((err) => console.error("Visibility wakeup sync failed:", err));
    }
  });
  try {
    onAuthStateChanged(auth, (fbUser) => {
      if (fbUser && navigator.onLine) {
        runSync().catch((err) => console.error("Auth wakeup sync failed:", err));
      }
    });
  } catch {
    // Ignore in non-browser/mock environments
  }
}

/**
 * Hook or helper to force a manual synchronization attempt (ignores backoff timer)
 */
export async function forceSync(
  onProgressUpdate?: (pendingCount: number, statusText: string) => void
): Promise<boolean> {
  if (!navigator.onLine) {
    if (onProgressUpdate) onProgressUpdate(-1, "Sin conexión a internet");
    return false;
  }

  await runSync(onProgressUpdate, true);
  const queue = await getSyncQueue();
  return queue.length === 0;
}
