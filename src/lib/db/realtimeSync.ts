import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, doc, setDoc } from "firebase/firestore";
import {
  adCampaignsStore,
  calendarStore,
  macrocyclesStore,
  sessionsStore,
  settingsStore,
  athleteStarsStore,
  starHistoryStore,
  getSyncQueue,
  isFictitiousUser,
  isFictitiousSession,
  sanitizeForFirestore
} from "./indexedDB";
import { UserProfile, hasRecentLocalUserWrite } from "@/lib/authService";

/**
 * Helper to check if two user profiles are functionally different, ignoring transient synchronization timestamps.
 */
function isProfileFunctionallyDifferent(p1: UserProfile | null, p2: UserProfile | null): boolean {
  if (!p1 || !p2) return p1 !== p2;

  const keysToCompare: (keyof UserProfile)[] = [
    "email",
    "fullName",
    "nickname",
    "birthDate",
    "country",
    "city",
    "gender",
    "role",
    "plan",
    "proExpiresAt",
    "clubId",
    "coachId",
    "coachName",
    "coachEmail",
    "clubName",
    "clubInviteCode",
    "clubLogo",
    "clubCountry",
    "isClubCreator",
    "profileSetupCompleted",
    "whatsappNumber"
  ];

  for (const key of keysToCompare) {
    if (JSON.stringify(p1[key]) !== JSON.stringify(p2[key])) {
      return true;
    }
  }

  if (JSON.stringify(p1.bowConfig) !== JSON.stringify(p2.bowConfig)) return true;
  if (JSON.stringify(p1.bows) !== JSON.stringify(p2.bows)) return true;
  if (JSON.stringify(p1.physicalData) !== JSON.stringify(p2.physicalData)) return true;

  return false;
}

let activeUnsubscribes: (() => void)[] = [];
let activeSyncKey: string | null = null;
let syncGeneration = 0;

function reportListenerError(name: string, err: any) {
  console.warn(`Firestore ${name} real-time listener error:`, err?.message || err);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("firestore-sync-error", { detail: { error: err?.message || String(err) } })
    );
  }
}

/**
 * Initializes Firebase real-time listeners for all core collections
 * using Incremental Delta Streaming (snapshot.docChanges()) for < 1ms local-first updates.
 *
 * Idempotent: calling it again with the same uid/role/club does NOT tear down and re-create
 * listeners (rapid listener churn triggers Firestore "INTERNAL ASSERTION FAILED (ca9/b815)").
 */
export function startRealtimeSync(
  currentUserUid: string | null,
  scope?: { role?: string | null; clubId?: string | null }
) {
  if (typeof window === "undefined") return;

  const role = scope?.role || "archer";
  const clubId = scope?.clubId || null;
  const isCoachRole = role === "coach" || role === "team_admin" || role === "team_admin_coach";
  // Only coach roles attach a club-scoped sessions listener; archers keep the same listener stream when linking/unlinking
  const syncKey = `${currentUserUid || "anon"}|${role}|${isCoachRole ? clubId || "" : ""}`;
  if (activeSyncKey === syncKey && activeUnsubscribes.length > 0) {
    return; // Already listening with identical scope
  }

  // Clear any existing active listeners to prevent multiple streams
  stopRealtimeSync();
  activeSyncKey = syncKey;
  const generation = ++syncGeneration;

  // Check if the api key is the mock placeholder to prevent console warnings on mock environments
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isMockFirebase =
    (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) &&
    isLocalhost;

  if (isMockFirebase) {
    console.log("Mock Firebase configuration detected. Real-time sync disabled.");
    return;
  }

  console.log("Initializing Real-Time Turbo Sync Firestore listeners...");

  // 1. Sync Users Collection
  const usersUnsub = onSnapshot(
    collection(db, "users"),
    async (snapshot) => {
      if (generation !== syncGeneration) return;
      try {
        const usersList: UserProfile[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as UserProfile;
          if (data) {
            if (!data.uid) {
              data.uid = docSnap.id;
            }
            if (!isFictitiousUser(data)) {
              usersList.push(data);
            }
          }
        });

        // Save to local simulated_users list, keeping unsynced local users to avoid overwriting them
        const rawLocalUsers = (await settingsStore.getItem<UserProfile[]>("simulated_users")) || [];
        const localUsers = rawLocalUsers.filter((u) => !isFictitiousUser(u));
        const queue = await getSyncQueue();
        const nowQueueMs = Date.now();
        const pendingUserUids = new Set(
          queue
            .filter(
              (q) =>
                q.collection === "users" &&
                nowQueueMs - (q.timestamp || 0) < 60000
            )
            .map((q) => q.payloadId)
        );
        for (const localU of localUsers) {
          if (hasRecentLocalUserWrite(localU.uid)) {
            pendingUserUids.add(localU.uid);
          }
        }
        if (currentUserUid && hasRecentLocalUserWrite(currentUserUid)) {
          pendingUserUids.add(currentUserUid);
        }

        const localByUid = new Map(localUsers.map((u) => [u.uid, u]));

        // Rebuild merged list: prefer local user profile if it has a pending write or newer updatedAt timestamp
        const mergedList: UserProfile[] = [];

        for (const remoteU of usersList) {
          const localU = localByUid.get(remoteU.uid);
          const localIsNewer =
            localU &&
            typeof localU.updatedAt === "number" &&
            typeof remoteU.updatedAt === "number" &&
            localU.updatedAt > remoteU.updatedAt;
          if (!pendingUserUids.has(remoteU.uid) && !localIsNewer) {
            mergedList.push(remoteU);
          }
        }

        // Add local users who have pending edits, newer local timestamps, or who were not in the remote list
        for (const localU of localUsers) {
          if (!mergedList.some((u) => u.uid === localU.uid)) {
            mergedList.push(localU);
          }
        }

        // Check whether any user profile changed functionally or crossed the online/offline threshold
        const nowMs = Date.now();
        const isOnline = (u?: UserProfile | null) =>
          !!u?.lastActiveAt && nowMs - u.lastActiveAt < 120000;
        let rosterMeaningfullyChanged = mergedList.length !== localUsers.length;
        if (!rosterMeaningfullyChanged) {
          for (const u of mergedList) {
            const prev = localByUid.get(u.uid) || null;
            if (
              !prev ||
              isProfileFunctionallyDifferent(prev, u) ||
              isOnline(prev) !== isOnline(u)
            ) {
              rosterMeaningfullyChanged = true;
              break;
            }
          }
        }

        await settingsStore.setItem("simulated_users", mergedList);

        // Check if currently logged-in user profile has changed remotely
        // Protect the current_user from being overwritten if there are pending/recent local updates!
        if (currentUserUid && !pendingUserUids.has(currentUserUid)) {
          const updatedCurrentUser = usersList.find((u) => u.uid === currentUserUid);
          if (updatedCurrentUser) {
            const localCurrent = await settingsStore.getItem<UserProfile>("current_user");

            const localIsNewer =
              localCurrent &&
              typeof localCurrent.updatedAt === "number" &&
              typeof updatedCurrentUser.updatedAt === "number" &&
              localCurrent.updatedAt > updatedCurrentUser.updatedAt;

            // Helper to check if a profile has all mandatory fields (matches authService.ts)
            const isProfileValid = (u: UserProfile | null | undefined): boolean => {
              if (!u) return false;
              return !!(
                u.fullName?.trim() &&
                u.birthDate &&
                u.country &&
                u.gender
              );
            };

            const isLocalValid = isProfileValid(localCurrent);
            const isRemoteValid = isProfileValid(updatedCurrentUser);

            if (localIsNewer) {
              // Skip overwriting a newer local profile with an older snapshot
            } else if (isLocalValid && !isRemoteValid) {
              console.warn(
                "[Sync] Local profile is complete, but remote is missing mandatory fields. Skip overwrite to avoid reset loop."
              );
            } else {
              const hasFunctionalDifference = isProfileFunctionallyDifferent(
                localCurrent,
                updatedCurrentUser
              );
              const hasAnyDifference =
                JSON.stringify(localCurrent) !== JSON.stringify(updatedCurrentUser);

              if (hasFunctionalDifference) {
                console.log(
                  "[Sync] Functional difference detected in user profile. Overwriting and dispatching update..."
                );
                await settingsStore.setItem("current_user", updatedCurrentUser);
                // Notify components to update user context in real-time
                window.dispatchEvent(
                  new CustomEvent("current-user-updated", { detail: { user: updatedCurrentUser } })
                );
              } else if (hasAnyDifference) {
                await settingsStore.setItem("current_user", updatedCurrentUser);
              }
            }
          }
        }

        if (rosterMeaningfullyChanged) {
          window.dispatchEvent(
            new CustomEvent("local-db-change", { detail: { store: "simulated_users" } })
          );
          window.dispatchEvent(new CustomEvent("users-roster-updated"));
        }
      } catch (err) {
        console.error("Error in real-time users sync:", err);
      }
    },
    (err) => {
      console.warn("Firestore users collection real-time listener failed/disabled:", err.message);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("firestore-sync-error", { detail: { error: err.message } })
        );
      }
    }
  );
  activeUnsubscribes.push(usersUnsub);

  // Helper for incremental delta sync on standard stores (avoids full .clear() disk stalls)
  function createIncrementalStoreListener(
    collectionName: string,
    store: LocalForage,
    storeEventName: string
  ) {
    let isFirstSnapshot = true;
    return onSnapshot(
      collection(db, collectionName),
      async (snapshot) => {
        if (generation !== syncGeneration) return;
        try {
          const queue = await getSyncQueue();
          const pendingIds = new Set(
            queue.filter((item) => item.collection === collectionName).map((item) => item.payloadId)
          );

          if (isFirstSnapshot) {
            isFirstSnapshot = false;
            const remoteIds = new Set(snapshot.docs.map((d) => d.id));
            const keysToRemove: string[] = [];
            await store.iterate((_: any, key: string) => {
              if (!remoteIds.has(key) && !pendingIds.has(key)) {
                keysToRemove.push(key);
              }
            });
            await Promise.all([
              ...keysToRemove.map((k) => store.removeItem(k)),
              ...snapshot.docs
                .filter((d) => !pendingIds.has(d.id))
                .map((d) => store.setItem(d.id, d.data()))
            ]);
          } else {
            const changes = snapshot.docChanges();
            if (changes.length === 0) return;

            await Promise.all(
              changes.map(async (change) => {
                const docId = change.doc.id;
                if (pendingIds.has(docId)) return;

                if (change.type === "removed") {
                  await store.removeItem(docId);
                } else {
                  await store.setItem(docId, change.doc.data());
                }
              })
            );
          }

          window.dispatchEvent(
            new CustomEvent("local-db-change", { detail: { store: storeEventName } })
          );
        } catch (err) {
          console.error(`Error in real-time ${collectionName} sync:`, err);
        }
      },
      (err) => reportListenerError(collectionName, err)
    );
  }

  // 2. Sync Ad Campaigns Collection (Incremental Real-Time)
  activeUnsubscribes.push(
    createIncrementalStoreListener("ad_campaigns", adCampaignsStore, "ad_campaigns")
  );

  // 3. Sync Calendar Events Collection (Incremental Real-Time)
  activeUnsubscribes.push(
    createIncrementalStoreListener("calendar_events", calendarStore, "calendar_events")
  );

  // 4. Sync Macrocycles Collection (Incremental Real-Time)
  activeUnsubscribes.push(
    createIncrementalStoreListener("macrocycles", macrocyclesStore, "macrocycles_local")
  );

  // 5. Sync Sessions (scoped, attached synchronously — no late async listener, no OR query)
  //    - Archer: only own sessions
  //    - Coach / Team admin: own sessions + sessions of their club
  //    - SuperAdmin: whole collection
  async function applySessionsSnapshot(snapshot: any, isFirst: boolean, isOwnScope: boolean) {
    const queue = await getSyncQueue();
    const pendingSessionIds = new Set(
      queue.filter((item) => item.collection === "sessions").map((item) => item.payloadId)
    );

    if (isFirst) {
      const remoteIds = new Set(snapshot.docs.map((d: any) => d.id));
      const keysToRemove: string[] = [];
      const localSessionsToRescue: Array<{ key: string; value: any }> = [];

      await sessionsStore.iterate((value: any, key: string) => {
        if (isFictitiousSession(value, key)) {
          keysToRemove.push(key);
          return;
        }
        if (!isOwnScope || !currentUserUid) return;
        const isOwnSession = value && (value.userId === currentUserUid || value.userUid === currentUserUid);
        if (!isOwnSession || value.isDraft || value.isDuel) return;
        // Own completed session missing in the cloud → upload it (NEVER delete user data)
        if (!remoteIds.has(key) && !pendingSessionIds.has(key)) {
          localSessionsToRescue.push({ key, value });
        }
      });

      for (const { key, value } of localSessionsToRescue) {
        const payload = sanitizeForFirestore({
          ...value,
          id: value.id || value.uid || key,
          userId: currentUserUid,
          clubId: value.clubId || clubId || null,
          updatedAt: Date.now()
        });
        setDoc(doc(db, "sessions", key), payload, { merge: true }).catch((e) =>
          console.warn("Could not rescue local session to cloud:", e?.message || e)
        );
      }

      await Promise.all([
        ...keysToRemove.map((k) => sessionsStore.removeItem(k)),
        ...snapshot.docs
          .filter((d: any) => !pendingSessionIds.has(d.id) && !isFictitiousSession(d.data(), d.id))
          .map(async (d: any) => {
            const data = d.data();
            if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
              const existingLocal = await sessionsStore.getItem<any>(d.id);
              if (
                existingLocal &&
                (existingLocal.updatedAt || existingLocal.timestamp || 0) >= (data.updatedAt || data.timestamp || 0)
              ) {
                return;
              }
            }
            await sessionsStore.setItem(d.id, { ...data, id: d.id });
          })
      ]);
    } else {
      const changes = snapshot.docChanges();
      if (changes.length === 0) return;

      await Promise.all(
        changes.map(async (change: any) => {
          const docId = change.doc.id;
          if (pendingSessionIds.has(docId)) return;

          if (change.type === "removed") {
            const existingLocal = await sessionsStore.getItem<any>(docId);
            // Never drop the user's own data just because it left a query scope
            if (
              existingLocal &&
              currentUserUid &&
              (existingLocal.userId === currentUserUid || existingLocal.userUid === currentUserUid) &&
              !isOwnScope
            ) {
              return;
            }
            if (existingLocal?.isDraft && currentUserUid && existingLocal.userId === currentUserUid) {
              return;
            }
            await sessionsStore.removeItem(docId);
          } else {
            const data = change.doc.data();
            if (isFictitiousSession(data, docId)) {
              await sessionsStore.removeItem(docId);
              return;
            }
            if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
              const existingLocal = await sessionsStore.getItem<any>(docId);
              if (
                existingLocal &&
                (existingLocal.updatedAt || existingLocal.timestamp || 0) >= (data.updatedAt || data.timestamp || 0)
              ) {
                return;
              }
            }
            await sessionsStore.setItem(docId, { ...data, id: docId });
          }
        })
      );
    }

    window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "sessions_local" } }));
  }

  function attachSessionsListener(target: any, isOwnScope: boolean, label: string) {
    let isFirst = true;
    const unsub = onSnapshot(
      target,
      async (snapshot: any) => {
        if (generation !== syncGeneration) return;
        const first = isFirst;
        isFirst = false;
        try {
          await applySessionsSnapshot(snapshot, first, isOwnScope);
        } catch (err) {
          console.error(`Error in real-time sessions sync (${label}):`, err);
        }
      },
      (err: any) => reportListenerError(`sessions:${label}`, err)
    );
    activeUnsubscribes.push(unsub);
  }

  if (role === "superadmin") {
    attachSessionsListener(collection(db, "sessions"), true, "all");
  } else if (currentUserUid) {
    attachSessionsListener(
      query(collection(db, "sessions"), where("userId", "==", currentUserUid)),
      true,
      "own"
    );
    if (isCoachRole && clubId) {
      attachSessionsListener(
        query(collection(db, "sessions"), where("clubId", "==", clubId)),
        false,
        "club"
      );
    }
  }

  // 6. Sync Athlete Stars Collection (Incremental Real-Time)
  activeUnsubscribes.push(
    createIncrementalStoreListener("athlete_stars", athleteStarsStore, "athlete_stars")
  );

  // 7. Sync Star History Collection (Incremental Real-Time)
  activeUnsubscribes.push(
    createIncrementalStoreListener("star_history", starHistoryStore, "star_history")
  );
}

/**
 * Detaches all active Firestore real-time listeners
 */
export function stopRealtimeSync() {
  syncGeneration++;
  activeSyncKey = null;
  if (activeUnsubscribes.length > 0) {
    console.log("Detaching real-time Firestore sync listeners...");
    activeUnsubscribes.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // ignore
      }
    });
    activeUnsubscribes = [];
  }
}
