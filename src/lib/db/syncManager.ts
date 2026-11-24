import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, increment } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { logger } from "@/lib/logger";
import {
  SyncItem,
  sessionsStore,
  settingsStore,
  getSyncQueue,
  removeFromSyncQueue,
  updateSyncItem,
  markSessionTombstone,
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

const SUPERADMIN_EMAILS = new Set([
  "admin101010",
  "admin@archery101010.com",
  "admin101010@archery101010.com",
  "info@archery101010.com",
  "archery101010app@gmail.com"
]);

const CLUB_OR_ROLE_SYNC_KEYS = [
  "role",
  "plan",
  "proExpiresAt",
  "clubId",
  "coachId",
  "isClubCreator",
  "clubInviteCode",
  "joinedWithInviteCode"
] as const;

async function hasPendingClubOrRoleChanges(
  docRef: ReturnType<typeof doc>,
  cleanPayload: Record<string, any>
): Promise<boolean> {
  const hasNonDefaultPrivilege =
    Boolean(cleanPayload.clubId) ||
    Boolean(cleanPayload.coachId) ||
    Boolean(cleanPayload.clubInviteCode) ||
    Boolean(cleanPayload.joinedWithInviteCode) ||
    Boolean(cleanPayload.isClubCreator) ||
    (Boolean(cleanPayload.role) && cleanPayload.role !== "archer") ||
    cleanPayload.plan === "PRO";

  try {
    const snap = await withTimeout(getDoc(docRef), 5000);
    if (!snap.exists()) {
      return hasNonDefaultPrivilege;
    }
    const remote = snap.data() || {};
    return CLUB_OR_ROLE_SYNC_KEYS.some(
      (k) => k in cleanPayload && (cleanPayload[k] ?? null) !== (remote[k] ?? null)
    );
  } catch {
    return hasNonDefaultPrivilege;
  }
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
    const localCurrentUser = await settingsStore.getItem<any>("current_user").catch(() => null);
    const activeEmail = (auth.currentUser?.email || localCurrentUser?.email || "")
      .trim()
      .toLowerCase();
    const isSuperAdminActive =
      localCurrentUser?.role === "superadmin" || SUPERADMIN_EMAILS.has(activeEmail);
    const isCoachActive =
      !isSuperAdminActive &&
      (localCurrentUser?.role === "coach" ||
        localCurrentUser?.role === "team_admin" ||
        localCurrentUser?.role === "team_admin_coach" ||
        Boolean(localCurrentUser?.isClubCreator));
    const activeCoachClubId = auth.currentUser?.uid
      ? `CLB-${auth.currentUser.uid.replace("USR-", "")}`
      : "";

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
              attempts: Math.max(existing.attempts || 0, item.attempts || 0),
              lastAttemptAt: item.lastAttemptAt ?? existing.lastAttemptAt
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

        // Preserve offline items belonging to a different account on a shared device instead of failing 5x & dropping (Fixes A8/B15)
        if (!isSuperAdminActive && auth.currentUser) {
          const activeUid = auth.currentUser.uid;
          if (item.collection === "users") {
            const ownerUid = String(item.payloadId || item.payload?.uid || "").trim();
            const isCoachManagedRosterCreate =
              isCoachActive &&
              ownerUid.startsWith("USR-ATH-") &&
              item.payload?.coachId === activeUid;
            const isCoachStudentUnlink =
              isCoachActive &&
              item.operation === "UPDATE" &&
              item.payload?.clubId === null &&
              item.payload?.coachId === null &&
              !item.payload?.email;
            if (
              ownerUid &&
              ownerUid !== activeUid &&
              !isCoachManagedRosterCreate &&
              !isCoachStudentUnlink
            ) {
              skippedKeys.add(targetKey);
              continue;
            }
          } else if (item.collection === "sessions") {
            const sessionOwnerUid = String(
              item.payload?.userId || item.payload?.userUid || ""
            ).trim();
            const isCoachSessionRestore =
              isCoachActive &&
              item.payload?.restoredByCoach === true &&
              activeCoachClubId &&
              item.payload?.clubId === activeCoachClubId;
            if (sessionOwnerUid && sessionOwnerUid !== activeUid && !isCoachSessionRestore) {
              skippedKeys.add(targetKey);
              continue;
            }
          }
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
            const rawPayload = item.payload || {};
            const { syncedAt: _localOnlySyncedAt, ...cloudFields } =
              item.collection === "sessions" ? rawPayload : { syncedAt: undefined, ...rawPayload };
            const cleanPayload = sanitizeForFirestore({
              ...cloudFields,
              updatedAt: rawPayload?.updatedAt ?? Date.now()
            });
            let deferredPendingUserClubOrRole = false;
            if (item.operation === "INSERT") {
              try {
                await withTimeout(setDoc(docRef, cleanPayload, { merge: true }), NETWORK_TIMEOUT_MS);
              } catch (insErr) {
                if (item.collection === "users" && auth.currentUser?.uid === item.payloadId) {
                  const { buildOwnerSelfServiceProfilePatch } = await import("@/lib/authService");
                  const safePatch = buildOwnerSelfServiceProfilePatch(cleanPayload);
                  if (Object.keys(safePatch).length > 0) {
                    await withTimeout(updateDoc(docRef, safePatch), NETWORK_TIMEOUT_MS);
                    deferredPendingUserClubOrRole = await hasPendingClubOrRoleChanges(
                      docRef,
                      cleanPayload
                    );
                  } else {
                    throw insErr;
                  }
                } else {
                  throw insErr;
                }
              }
            } else if (item.operation === "UPDATE") {
              if (item.collection === "ad_campaigns" && !cleanPayload.name) {
                const metricUpdatedAt = Number(cleanPayload.updatedAt) || Date.now();
                const atomicMetricPatch =
                  cleanPayload.metricKind === "click"
                    ? {
                        clicks: increment(1),
                        totalClicks: increment(1),
                        updatedAt: metricUpdatedAt
                      }
                    : {
                        impressions: increment(1),
                        totalImpressions: increment(1),
                        updatedAt: metricUpdatedAt
                      };
                await withTimeout(updateDoc(docRef, atomicMetricPatch), NETWORK_TIMEOUT_MS);
              } else if (
                item.collection === "calendar_events" &&
                typeof cleanPayload.athleteChecklistUid === "string" &&
                cleanPayload.athleteChecklistUid.trim().length > 0
              ) {
                const checklistUid = cleanPayload.athleteChecklistUid.trim();
                const checklistItems = Array.isArray(cleanPayload.athleteChecklistItems)
                  ? cleanPayload.athleteChecklistItems
                  : [];
                await withTimeout(
                  updateDoc(docRef, {
                    [`completedByAthlete.${checklistUid}`]: checklistItems,
                    updatedAt: Number(cleanPayload.updatedAt) || Date.now()
                  }),
                  NETWORK_TIMEOUT_MS
                );
              } else {
                try {
                  await withTimeout(
                    setDoc(docRef, cleanPayload, { merge: true }),
                    NETWORK_TIMEOUT_MS
                  );
                } catch (updErr) {
                  if (item.collection === "users" && auth.currentUser?.uid === item.payloadId) {
                    const { buildOwnerSelfServiceProfilePatch } = await import("@/lib/authService");
                    const safePatch = buildOwnerSelfServiceProfilePatch(cleanPayload);
                    if (Object.keys(safePatch).length > 0) {
                      await withTimeout(updateDoc(docRef, safePatch), NETWORK_TIMEOUT_MS);
                      deferredPendingUserClubOrRole = await hasPendingClubOrRoleChanges(
                        docRef,
                        cleanPayload
                      );
                    } else {
                      throw updErr;
                    }
                  } else {
                    throw updErr;
                  }
                }
              }
            } else if (item.operation === "DELETE") {
              if (item.collection === "sessions") {
                await markSessionTombstone(item.payloadId);
              }
              await withTimeout(deleteDoc(docRef), NETWORK_TIMEOUT_MS);
            }

            if (deferredPendingUserClubOrRole) {
              const nextAttempts = (item.attempts || 0) + 1;
              await updateSyncItem(item.id, {
                status: "failed",
                attempts: nextAttempts,
                lastAttemptAt: Date.now()
              });
              skippedKeys.add(targetKey);
              return;
            }

            if (
              item.collection === "sessions" &&
              (item.operation === "INSERT" || item.operation === "UPDATE")
            ) {
              const existingLocal = await sessionsStore.getItem<any>(item.payloadId);
              if (existingLocal) {
                await sessionsStore.setItem(item.payloadId, {
                  ...existingLocal,
                  syncedAt: Date.now()
                });
              }
            }

            logger.debug(`[SyncManager] Synced ${item.operation} ${targetKey}`);
            await removeFromSyncQueue(item.id);
          } catch (err: any) {
            const errCode = String(err?.code || "").toLowerCase();
            const errMsg = String(err?.message || err || "");
            const errMsgLower = errMsg.toLowerCase();
            const nextAttempts = (item.attempts || 0) + 1;
            const attemptTs = Date.now();

            // Cleanly remove DELETE operations if target document is already absent
            if (
              item.operation === "DELETE" &&
              (errCode.includes("not-found") ||
                errMsgLower.includes("not-found") ||
                errMsg.includes("No document to update"))
            ) {
              await removeFromSyncQueue(item.id);
              return;
            }

            // Local demo ad campaigns (AD-DEMO-*) don't exist in Firestore unless created by SuperAdmin
            if (
              item.collection === "ad_campaigns" &&
              (errCode.includes("not-found") || errMsg.includes("No document to update"))
            ) {
              await removeFromSyncQueue(item.id);
              return;
            }

            const isUnauthenticatedErr =
              errCode.includes("unauthenticated") || errMsgLower.includes("unauthenticated");
            if (isUnauthenticatedErr && auth.currentUser) {
              await auth.currentUser.getIdToken(true).catch(() => {});
            }

            const isTransientNetworkError =
              (typeof navigator !== "undefined" && !navigator.onLine) ||
              isUnauthenticatedErr ||
              errCode.includes("aborted") ||
              errMsgLower.includes("aborted") ||
              errCode.includes("resource-exhausted") ||
              errMsgLower.includes("resource-exhausted") ||
              errCode.includes("internal") ||
              errMsgLower.includes("internal") ||
              errMsg.includes("NETWORK_TIMEOUT") ||
              errMsg.includes("Sync timeout") ||
              errCode.includes("unavailable") ||
              errMsgLower.includes("unavailable") ||
              errCode.includes("deadline-exceeded") ||
              errMsgLower.includes("deadline-exceeded") ||
              errCode.includes("network-request-failed") ||
              errMsgLower.includes("network-request-failed") ||
              errMsg.includes("Failed to fetch") ||
              errMsgLower.includes("offline");

            if (isTransientNetworkError) {
              // NEVER drop user sessions/events on weak or offline signal! Keep indefinitely with backoff.
              logger.debug(
                `[SyncManager] Transient network failure for ${item.id} (${targetKey}), attempt #${nextAttempts}. Retained in queue with backoff.`
              );
              await updateSyncItem(item.id, {
                status: "failed",
                attempts: nextAttempts,
                lastAttemptAt: attemptTs
              });
              networkAborted = true;
            } else {
              logger.warn(`Failed to sync item ${item.id}:`, err);
              const isUnrecoverableSchemaOrPerm =
                errCode.includes("permission-denied") ||
                errCode.includes("invalid-argument") ||
                errCode.includes("failed-precondition") ||
                errMsg.includes("Missing or insufficient permissions") ||
                errMsg.includes("Unsupported field value");

              if (nextAttempts >= 5 || (isUnrecoverableSchemaOrPerm && nextAttempts >= 5)) {
                logger.warn(
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
    logger.error("Critical error in sync loop:", globalErr);
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
          logger.debug("Microtask sync error:", e)
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
    runSync(undefined, true).catch((err) => logger.debug("Auto-online sync failed:", err));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      runSync().catch((err) => logger.debug("Visibility wakeup sync failed:", err));
    }
  });
  try {
    onAuthStateChanged(auth, (fbUser) => {
      if (fbUser && navigator.onLine) {
        runSync().catch((err) => logger.debug("Auth wakeup sync failed:", err));
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
