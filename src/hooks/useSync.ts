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

    window.addEventListener("online", handleOnline);
    window.addEventListener("sync-queue-changed", handleQueueChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("sync-queue-changed", handleQueueChange);
    };
  }, [checkQueue]);

  return {
    pendingCount,
    syncStatus,
    isSyncing,
    triggerSync
  };
}
