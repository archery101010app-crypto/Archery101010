import { db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
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
  if (JSON.stringify(p1.physicalData) !== JSON.stringify(p2.physicalData)) return true;

  return false;
}

let activeUnsubscribes: (() => void)[] = [];

/**
 * Initializes Firebase real-time listeners for all core collections
 */
export function startRealtimeSync(currentUserUid: string | null) {
  // Clear any existing active listeners to prevent multiple streams
  stopRealtimeSync();

  if (typeof window === "undefined") return;

  // Check if the api key is the mock placeholder to prevent console warnings on mock environments
  const isLocalhost = typeof window !== "undefined" && 
                      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const isMockFirebase = (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 
                         process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) && isLocalhost;
  
  if (isMockFirebase) {
    console.log("Mock Firebase configuration detected. Real-time sync disabled.");
    return;
  }

  console.log("Initializing real-time Firestore sync listeners...");

  // 1. Sync Users Collection
  const usersUnsub = onSnapshot(
    collection(db, "users"),
    async (snapshot) => {
      try {
        const usersList: UserProfile[] = [];
        snapshot.forEach((doc) => {
          usersList.push(doc.data() as UserProfile);
        });

        // Save to local simulated_users list, keeping unsynced local users to avoid overwriting them
        const localUsers = await settingsStore.getItem<UserProfile[]>("simulated_users") || [];
        const queue = await getSyncQueue();
        const pendingUserUids = new Set(queue.filter(q => q.collection === "users").map(q => q.payloadId));

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
          } else if (!usersList.some(u => u.uid === localU.uid)) {
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
              console.warn("[Sync] Local profile is complete, but remote is missing mandatory fields. Skip overwrite to avoid reset loop.");
            } else {
              const hasFunctionalDifference = isProfileFunctionallyDifferent(localCurrent, updatedCurrentUser);
              const hasAnyDifference = JSON.stringify(localCurrent) !== JSON.stringify(updatedCurrentUser);

              if (hasFunctionalDifference) {
                console.log("[Sync] Functional difference detected in user profile. Overwriting and dispatching update...");
                await settingsStore.setItem("current_user", updatedCurrentUser);
                // Notify components to update user context in real-time
                window.dispatchEvent(
                  new CustomEvent("current-user-updated", { detail: { user: updatedCurrentUser } })
                );
              } else if (hasAnyDifference) {
                // There are differences only in transient/subscription timestamps (like lastActiveAt or updatedAt)
                // Overwrite IndexedDB silently to keep it fresh, but do NOT dispatch event to prevent rendering loop
                await settingsStore.setItem("current_user", updatedCurrentUser);
              }
            }
          }
        }

        window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "simulated_users" } }));
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

  // 2. Sync Ad Campaigns Collection
  const adsUnsub = onSnapshot(collection(db, "ad_campaigns"), async (snapshot) => {
    try {
      // Clear local store before saving updated campaigns
      await adCampaignsStore.clear();

      for (const doc of snapshot.docs) {
        await adCampaignsStore.setItem(doc.id, doc.data());
      }

      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "ad_campaigns" } }));
    } catch (err) {
      console.error("Error in real-time campaigns sync:", err);
    }
  });
  activeUnsubscribes.push(adsUnsub);

  // 3. Sync Calendar Events Collection
  const calendarUnsub = onSnapshot(collection(db, "calendar_events"), async (snapshot) => {
    try {
      await calendarStore.clear();

      for (const doc of snapshot.docs) {
        await calendarStore.setItem(doc.id, doc.data());
      }

      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "calendar_events" } }));
    } catch (err) {
      console.error("Error in real-time calendar sync:", err);
    }
  });
  activeUnsubscribes.push(calendarUnsub);

  // 4. Sync Macrocycles Collection
  const macrocyclesUnsub = onSnapshot(collection(db, "macrocycles"), async (snapshot) => {
    try {
      await macrocyclesStore.clear();

      for (const doc of snapshot.docs) {
        await macrocyclesStore.setItem(doc.id, doc.data());
      }

      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "macrocycles_local" } }));
    } catch (err) {
      console.error("Error in real-time macrocycles sync:", err);
    }
  });
  activeUnsubscribes.push(macrocyclesUnsub);

  // 5. Sync Sessions Collection
  const sessionsUnsub = onSnapshot(collection(db, "sessions"), async (snapshot) => {
    try {
      // Obtener todos los elementos en la cola de sincronización para identificar inserciones y eliminaciones pendientes
      const queue = await getSyncQueue();
      const pendingDeletes = new Set(
        queue.filter(item => item.collection === "sessions" && item.operation === "DELETE").map(item => item.payloadId)
      );
      const pendingInserts = new Map(
        queue.filter(item => item.collection === "sessions" && item.operation === "INSERT").map(item => [item.payloadId, item.payload])
      );

      // Cargar en memoria todas las sesiones locales que sean borradores (drafts) para preservarlas
      const localDrafts: any[] = [];
      await sessionsStore.iterate((value: any, key: string) => {
        if (value && value.isDraft) {
          localDrafts.push({ key, value });
        }
      });

      // Ahora limpiamos el almacén local
      await sessionsStore.clear();

      // Restaurar los borradores locales
      for (const draft of localDrafts) {
        await sessionsStore.setItem(draft.key, draft.value);
      }

      // Restaurar las sesiones pendientes de subida (inserts)
      for (const [id, payload] of pendingInserts.entries()) {
        await sessionsStore.setItem(id, payload);
      }

      // Escribir los documentos provenientes de Firestore (omitiendo aquellos con borrado pendiente)
      for (const doc of snapshot.docs) {
        if (!pendingDeletes.has(doc.id)) {
          // Aseguramos que doc.id quede guardado dentro de las propiedades del objeto (evita errores de borrado posterior)
          const data = doc.data();
          const docWithId = { ...data, id: doc.id };
          await sessionsStore.setItem(doc.id, docWithId);
        }
      }

      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "sessions_local" } }));
    } catch (err) {
      console.error("Error in real-time sessions sync:", err);
    }
  });
  activeUnsubscribes.push(sessionsUnsub);

  // 6. Sync Athlete Stars Collection
  const starsUnsub = onSnapshot(collection(db, "athlete_stars"), async (snapshot) => {
    try {
      await athleteStarsStore.clear();
      for (const doc of snapshot.docs) {
        await athleteStarsStore.setItem(doc.id, doc.data());
      }
      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "athlete_stars" } }));
    } catch (err) {
      console.error("Error in real-time athlete_stars sync:", err);
    }
  });
  activeUnsubscribes.push(starsUnsub);

  // 7. Sync Star History Collection
  const starHistoryUnsub = onSnapshot(collection(db, "star_history"), async (snapshot) => {
    try {
      await starHistoryStore.clear();
      for (const doc of snapshot.docs) {
        await starHistoryStore.setItem(doc.id, doc.data());
      }
      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "star_history" } }));
    } catch (err) {
      console.error("Error in real-time star_history sync:", err);
    }
  });
  activeUnsubscribes.push(starHistoryUnsub);
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
