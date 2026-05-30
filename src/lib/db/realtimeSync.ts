import { db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import {
  adCampaignsStore,
  calendarStore,
  macrocyclesStore,
  sessionsStore,
  settingsStore,
  athleteStarsStore,
  starHistoryStore
} from "./indexedDB";
import { UserProfile } from "@/lib/authService";

let activeUnsubscribes: (() => void)[] = [];

/**
 * Initializes Firebase real-time listeners for all core collections
 */
export function startRealtimeSync(currentUserUid: string | null) {
  // Clear any existing active listeners to prevent multiple streams
  stopRealtimeSync();

  if (typeof window === "undefined") return;

  // Check if the api key is the mock placeholder to prevent console warnings on mock environments
  const isMockFirebase = !process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 
                         process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key");
  
  if (isMockFirebase) {
    console.log("Mock Firebase configuration detected. Real-time sync disabled.");
    return;
  }

  console.log("Initializing real-time Firestore sync listeners...");

  // 1. Sync Users Collection
  const usersUnsub = onSnapshot(collection(db, "users"), async (snapshot) => {
    try {
      const usersList: UserProfile[] = [];
      snapshot.forEach((doc) => {
        usersList.push(doc.data() as UserProfile);
      });

      // Save to local simulated_users list
      await settingsStore.setItem("simulated_users", usersList);

      // Check if currently logged-in user profile has changed remotely
      if (currentUserUid) {
        const updatedCurrentUser = usersList.find((u) => u.uid === currentUserUid);
        if (updatedCurrentUser) {
          const localCurrent = await settingsStore.getItem<UserProfile>("current_user");
          
          // Verify if there are actual updates to avoid infinite rendering loops
          if (JSON.stringify(localCurrent) !== JSON.stringify(updatedCurrentUser)) {
            await settingsStore.setItem("current_user", updatedCurrentUser);
            // Notify components to update user context in real-time
            window.dispatchEvent(
              new CustomEvent("current-user-updated", { detail: { user: updatedCurrentUser } })
            );
          }
        }
      }

      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "simulated_users" } }));
    } catch (err) {
      console.error("Error in real-time users sync:", err);
    }
  });
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
      await sessionsStore.clear();

      for (const doc of snapshot.docs) {
        await sessionsStore.setItem(doc.id, doc.data());
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
