import { db } from "@/lib/firebase";
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import {
  getSyncQueue,
  removeFromSyncQueue,
  updateSyncItem,
  SyncItem
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
 * Sequential synchronizer that uploads items in the queue to Firebase in the background
 */
export async function runSync(onProgressUpdate?: (pendingCount: number, statusText: string) => void): Promise<void> {
  if (isSyncing) {
    syncPending = true;
    if (onProgressUpdate) onProgressUpdate(-1, "Pendiente...");
    return;
  }

  isSyncing = true;
  if (onProgressUpdate) onProgressUpdate(-1, "Conectando...");

  try {
    let queue = await getSyncQueue();
    
    while (queue.length > 0) {
      if (onProgressUpdate) onProgressUpdate(queue.length, `Subiendo ${queue.length} pendiente(s)...`);
      
      const item = queue[0];
      const docRef = doc(db, item.collection, item.payloadId);

      try {
        // Execute operation with robust 15-second timeout
        if (item.operation === "INSERT") {
          await withTimeout(setDoc(docRef, { ...item.payload, updatedAt: Date.now() }), NETWORK_TIMEOUT_MS);
        } else if (item.operation === "UPDATE") {
          await withTimeout(updateDoc(docRef, { ...item.payload, updatedAt: Date.now() }), NETWORK_TIMEOUT_MS);
        } else if (item.operation === "DELETE") {
          await withTimeout(withTimeout(deleteDoc(docRef), NETWORK_TIMEOUT_MS), NETWORK_TIMEOUT_MS);
        }

        // Success: Remove item from queue
        await removeFromSyncQueue(item.id);
      } catch (err: any) {
        console.error(`Failed to sync item ${item.id}:`, err);
        
        // Update item with failure status and increment attempts
        await updateSyncItem(item.id, {
          status: "failed",
          attempts: item.attempts + 1
        });
        
        // Network failure: break queue loop to retry later, avoiding locking the thread on repeated timeouts
        if (err.message === "NETWORK_TIMEOUT" || !navigator.onLine) {
          break;
        }
      }

      // Reload queue for next iteration
      queue = await getSyncQueue();
    }
  } catch (globalErr) {
    console.error("Critical error in sync loop:", globalErr);
  } finally {
    isSyncing = false;
    
    // Check if another sync was scheduled during execution
    if (syncPending) {
      syncPending = false;
      // Schedule next run
      setTimeout(() => runSync(onProgressUpdate), 100);
    } else {
      if (onProgressUpdate) {
        const remaining = await getSyncQueue();
        onProgressUpdate(remaining.length, remaining.length === 0 ? "Sincronizado" : "Sin conexión");
      }
    }
  }
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
