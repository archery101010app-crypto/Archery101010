"use client";

import { useState, useEffect, useCallback } from "react";
import { getSyncQueue } from "@/lib/db/indexedDB";
import { runSync, forceSync } from "@/lib/db/syncManager";

export function useSync() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState("Sincronizado");
  const [isSyncing, setIsSyncing] = useState(false);

  const checkQueue = useCallback(async () => {
    try {
      const queue = await getSyncQueue();
      setPendingCount(queue.length);
      
      // Auto-retry synchronization in the background if items are pending and online
      if (queue.length > 0 && navigator.onLine) {
        runSync().catch((err) => console.error("Immediate background sync retry failed:", err));
      }
    } catch (e) {
      console.error("Error reading sync queue length:", e);
    }
  }, []);

  // Update counts and run background checks periodically
  useEffect(() => {
    checkQueue();

    // Check queue every 5 seconds to keep the Header indicators synchronized
    const interval = setInterval(checkQueue, 5000);
    return () => clearInterval(interval);
  }, [checkQueue]);

  const handleSyncProgress = (count: number, text: string) => {
    if (count >= 0) setPendingCount(count);
    setSyncStatus(text);
    setIsSyncing(text === "Conectando..." || text.startsWith("Subiendo"));
  };

  const triggerSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    await forceSync(handleSyncProgress);
    await checkQueue();
    setIsSyncing(false);
  };

  // Run automatically when network reconnection is detected and listen to queue changes
  useEffect(() => {
    const handleOnline = () => {
      runSync(handleSyncProgress);
    };

    const handleQueueChange = () => {
      checkQueue();
    };

    const handleSyncError = (e: any) => {
      const errMsg = e.detail?.error || "";
      if (errMsg.includes("permission-denied") || errMsg.includes("insufficient permissions")) {
        setSyncStatus("Sin permisos en la nube");
      } else {
        setSyncStatus("Error de Firestore");
      }
      setIsSyncing(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("sync-queue-changed", handleQueueChange);
    window.addEventListener("firestore-sync-error", handleSyncError);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("sync-queue-changed", handleQueueChange);
      window.removeEventListener("firestore-sync-error", handleSyncError);
    };
  }, [checkQueue]);

  return {
    pendingCount,
    syncStatus,
    isSyncing,
    triggerSync
  };
}
