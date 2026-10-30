import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, or } from "firebase/firestore";
import {
  adCampaignsStore,
  calendarStore,
  macrocyclesStore,
  sessionsStore,
  settingsStore,
  athleteStarsStore,
  starHistoryStore,
  getSyncQueue
} from "./indexedDB";
import { UserProfile } from "@/lib/authService";

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
    "clubId",
    "clubName",
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

/**
 * Initializes Firebase real-time listeners for all core collections
 * using Incremental Delta Streaming (snapshot.docChanges()) for < 1ms local-first updates.
 */
export function startRealtimeSync(currentUserUid: string | null) {
  // Clear any existing active listeners to prevent multiple streams
  stopRealtimeSync();

  if (typeof window === "undefined") return;

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
      try {
        const usersList: UserProfile[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as UserProfile;
          if (data) {
            if (!data.uid) {
              data.uid = doc.id;
            }
            usersList.push(data);
          }
        });

        // Save to local simulated_users list, keeping unsynced local users to avoid overwriting them
        const localUsers = (await settingsStore.getItem<UserProfile[]>("simulated_users")) || [];
        const queue = await getSyncQueue();
        const pendingUserUids = new Set(
          queue.filter((q) => q.collection === "users").map((q) => q.payloadId)
        );

        // Rebuild merged list: prefer local user profile if it has a pending write in the queue
        const mergedList: UserProfile[] = [];

        // Add remote users who do not have pending local edits
        for (const remoteU of usersList) {
          if (!pendingUserUids.has(remoteU.uid)) {
            mergedList.push(remoteU);
          }
        }

        // Add local users who have pending edits, or who were not in the remote list
        for (const localU of localUsers) {
          if (pendingUserUids.has(localU.uid)) {
            mergedList.push(localU);
          } else if (!usersList.some((u) => u.uid === localU.uid)) {
            mergedList.push(localU);
          }
        }

        await settingsStore.setItem("simulated_users", mergedList);

        // Check if currently logged-in user profile has changed remotely
        // Protect the current_user from being overwritten if there are pending local updates in the sync queue!
        if (currentUserUid && !pendingUserUids.has(currentUserUid)) {
          const updatedCurrentUser = usersList.find((u) => u.uid === currentUserUid);
          if (updatedCurrentUser) {
            const localCurrent = await settingsStore.getItem<UserProfile>("current_user");

            // Helper to check if a profile has all mandatory fields
            const isProfileValid = (u: UserProfile | null | undefined): boolean => {
              if (!u) return false;
              return !!(
                u.nickname?.trim() &&
                u.fullName?.trim() &&
                u.birthDate &&
                u.city?.trim() &&
                u.country &&
                u.gender
              );
            };

            const isLocalValid = isProfileValid(localCurrent);
            const isRemoteValid = isProfileValid(updatedCurrentUser);

            if (isLocalValid && !isRemoteValid) {
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

        window.dispatchEvent(
          new CustomEvent("local-db-change", { detail: { store: "simulated_users" } })
        );
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
    return onSnapshot(collection(db, collectionName), async (snapshot) => {
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
    });
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

  // 5. Sync Sessions Collection (Incremental Real-Time + Scoped Cloud Filter + Live Draft Protection)
  settingsStore
    .getItem<UserProfile>("current_user")
    .then((localUser) => {
      let isFirstSessionsSnapshot = true;
      const role = localUser?.role || "archer";
      const clubId = localUser?.clubId || null;

      // Smart Query Scoping:
      // - SuperAdmins and Coaches receive global or club-wide telemetry
      // - Individual archers only download their own sessions (+ their club's sessions if in a club), saving up to 95% Firestore reads
      let sessionsTarget: any = collection(db, "sessions");
      if (currentUserUid && role === "archer") {
        if (clubId) {
          sessionsTarget = query(
            collection(db, "sessions"),
            or(where("userId", "==", currentUserUid), where("clubId", "==", clubId))
          );
        } else {
          sessionsTarget = query(
            collection(db, "sessions"),
            where("userId", "==", currentUserUid)
          );
        }
      }

      const sessionsUnsub = onSnapshot(sessionsTarget, async (snapshot: any) => {
        try {
          const queue = await getSyncQueue();
          const pendingSessionIds = new Set(
            queue.filter((item) => item.collection === "sessions").map((item) => item.payloadId)
          );

          if (isFirstSessionsSnapshot) {
            isFirstSessionsSnapshot = false;
            const remoteIds = new Set(snapshot.docs.map((d: any) => d.id));
            const keysToRemove: string[] = [];

            await sessionsStore.iterate((value: any, key: string) => {
              const isOwnLocalDraft =
                value && value.isDraft && (!currentUserUid || value.userId === currentUserUid);
              const isDemoSession = typeof key === "string" && key.startsWith("SES-D-");
              if (
                !remoteIds.has(key) &&
                !pendingSessionIds.has(key) &&
                !isOwnLocalDraft &&
                !isDemoSession
              ) {
                keysToRemove.push(key);
              }
            });

            await Promise.all([
              ...keysToRemove.map((k) => sessionsStore.removeItem(k)),
              ...snapshot.docs
                .filter((d: any) => !pendingSessionIds.has(d.id))
                .map(async (d: any) => {
                  const data = d.data();
                  if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
                    const existingLocal = await sessionsStore.getItem<any>(d.id);
                    if (
                      existingLocal &&
                      (existingLocal.updatedAt || existingLocal.timestamp || 0) >=
                        (data.updatedAt || data.timestamp || 0)
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
                  if (
                    existingLocal?.isDraft &&
                    currentUserUid &&
                    existingLocal.userId === currentUserUid
                  ) {
                    return;
                  }
                  await sessionsStore.removeItem(docId);
                } else {
                  const data = change.doc.data();
                  if (data?.isDraft && currentUserUid && data.userId === currentUserUid) {
                    const existingLocal = await sessionsStore.getItem<any>(docId);
                    if (
                      existingLocal &&
                      (existingLocal.updatedAt || existingLocal.timestamp || 0) >=
                        (data.updatedAt || data.timestamp || 0)
                    ) {
                      return;
                    }
                  }
                  await sessionsStore.setItem(docId, { ...data, id: docId });
                }
              })
            );
          }

          window.dispatchEvent(
            new CustomEvent("local-db-change", { detail: { store: "sessions_local" } })
          );
        } catch (err) {
          console.error("Error in real-time sessions sync:", err);
        }
      });
      activeUnsubscribes.push(sessionsUnsub);
    })
    .catch((err) => console.error("Failed to initialize scoped sessions listener:", err));

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
  if (activeUnsubscribes.length > 0) {
    console.log("Detaching real-time Firestore sync listeners...");
    activeUnsubscribes.forEach((unsub) => unsub());
    activeUnsubscribes = [];
  }
}
