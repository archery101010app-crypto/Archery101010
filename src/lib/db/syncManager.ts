import { db } from "@/lib/firebase";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import {
  getSyncQueue,
  removeFromSyncQueue,
  updateSyncItem
} from "./indexedDB";

// State flags to control sequential runs and prevent race conditions
let isSyncing = false;
let syncPending = false;

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

/**
 * Real-Time Turbo Sync: Coalesced parallel synchronizer that uploads items in the queue
 * to Firebase with zero artificial delay while preserving 100% Offline-First safety.
 */
export async function runSync(onProgressUpdate?: (pendingCount: number, statusText: string) => void): Promise<void> {
  if (isSyncing) {
    syncPending = true;
    if (onProgressUpdate) onProgressUpdate(-1, "Sincronizando...");
    return;
  }

  isSyncing = true;
  if (onProgressUpdate) onProgressUpdate(-1, "Conectando...");

  try {
    let queue = await getSyncQueue();
    const skippedKeys = new Set<string>();

    while (queue.length > 0) {
      // Group items by collection + payloadId to coalesce redundant intermediate updates
      const latestByTarget = new Map<string, typeof queue[0]>();
      const supersededIds: string[] = [];

      for (const item of queue) {
        const targetKey = `${item.collection}:${item.payloadId}`;
        if (skippedKeys.has(targetKey)) continue;

        const existing = latestByTarget.get(targetKey);
        if (existing) {
          // If an earlier item existed for the same document, supersede it with the newer state
          supersededIds.push(existing.id);
          if (existing.operation === "INSERT" && item.operation === "UPDATE") {
            latestByTarget.set(targetKey, { ...item, operation: "INSERT" });
          } else {
            latestByTarget.set(targetKey, item);
          }
        } else {
          latestByTarget.set(targetKey, item);
        }
      }

      // Clean up superseded intermediate items immediately
      if (supersededIds.length > 0) {
        await Promise.all(supersededIds.map((id) => removeFromSyncQueue(id)));
      }

      const batchItems = Array.from(latestByTarget.values());
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
            if (item.operation === "INSERT") {
              await withTimeout(setDoc(docRef, { ...item.payload, updatedAt: Date.now() }), NETWORK_TIMEOUT_MS);
            } else if (item.operation === "UPDATE") {
              await withTimeout(
                setDoc(docRef, { ...item.payload, updatedAt: Date.now() }, { merge: true }),
                NETWORK_TIMEOUT_MS
              );
            } else if (item.operation === "DELETE") {
              await withTimeout(deleteDoc(docRef), NETWORK_TIMEOUT_MS);
            }

            await removeFromSyncQueue(item.id);
          } catch (err: any) {
            console.error(`Failed to sync item ${item.id}:`, err);

            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("firestore-sync-error", { detail: { error: err.message || String(err) } })
              );
            }

            await updateSyncItem(item.id, {
              status: "failed",
              attempts: item.attempts + 1
            });

            skippedKeys.add(targetKey);

            if (err.message === "NETWORK_TIMEOUT" || (typeof navigator !== "undefined" && !navigator.onLine)) {
              networkAborted = true;
            }
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

    // If another write arrived while syncing, flush immediately (0ms microtask)
    if (syncPending) {
      syncPending = false;
      queueMicrotask(() => {
        runSync(onProgressUpdate).catch((e) => console.error("Microtask sync error:", e));
      });
    } else if (onProgressUpdate) {
      const remaining = await getSyncQueue();
      onProgressUpdate(remaining.length, remaining.length === 0 ? "Sincronizado" : "Sin conexión");
    }
  }
}

// Auto-flush queue immediately when device regains connectivity or returns to foreground
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    runSync().catch((err) => console.error("Auto-online sync failed:", err));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      runSync().catch((err) => console.error("Visibility wakeup sync failed:", err));
    }
  });
}

/**
 * Hook or helper to force a manual synchronization attempt
 */
export async function forceSync(onProgressUpdate?: (pendingCount: number, statusText: string) => void): Promise<boolean> {
  if (!navigator.onLine) {
    if (onProgressUpdate) onProgressUpdate(-1, "Sin conexión a internet");
    return false;
  }
  
  await runSync(onProgressUpdate);
  const queue = await getSyncQueue();
  return queue.length === 0;
}
