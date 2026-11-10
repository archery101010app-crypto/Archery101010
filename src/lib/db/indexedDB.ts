import localforage from "localforage";

// Initialize localForage instances for different data stores
export const sessionsStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "sessions_local"
});

export const syncQueueStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "cola_sincronizacion"
});

export const settingsStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "settings_local"
});

export const calendarStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "calendar_events"
});

export const adCampaignsStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "ad_campaigns"
});

export const adImpressionsStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "ad_impressions"
});

export const macrocyclesStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "macrocycles_local"
});

export const athleteStarsStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "athlete_stars"
});

export const starHistoryStore = localforage.createInstance({
  name: "Archery101010",
  storeName: "star_history"
});

// Types
export interface SyncItem {
  id: string; // unique transaction id, e.g. "TXN-1716800..."
  collection: string; // e.g. "sessions", "users", "clubs"
  operation: "INSERT" | "UPDATE" | "DELETE";
  payloadId: string; // the ID of the document being modified
  payload: any; // the actual data to write/modify
  timestamp: number;
  attempts: number;
  lastAttemptAt?: number;
  status: "pending" | "failed";
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  description?: string;
  createdByRole: "coach" | "archer";
  createdByName: string;
  createdByUid: string;
  clubId?: string;
  type: "competition" | "training" | "meeting" | "other";
  timestamp: number;
  // Coach cycle assignment metadata
  macrocycleId?: string;
  phaseId?: string;
  phaseName?: string;
  phaseType?: string;
  phaseColor?: string;
  targetArrows?: number;
  assignedAthleteIds?: string[];
  focusPoints?: string[];
  coachNotes?: string;
  customFields?: Array<{ label: string; value: string }>;
  dailyItems?: string[];
  completedItems?: number[];
  completedByAthlete?: Record<string, number[]>;
  isRestDay?: boolean;
  isCompleted?: boolean;
}

// Generate unique text-based IDs (prefix + timestamp + random chars)
export function generateResilientId(prefix: string): string {
  const timestamp = Date.now();
  const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${randomChars}`;
}

// Recursively strip undefined properties so Firestore setDoc() never throws on undefined fields
export function sanitizeForFirestore<T = any>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => (item === undefined ? null : sanitizeForFirestore(item))) as unknown as T;
  }
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj as Record<string, any>)) {
      if (v !== undefined) {
        cleaned[k] = sanitizeForFirestore(v);
      }
    }
    return cleaned as T;
  }
  return obj;
}

const FICTITIOUS_NAMES = new Set([
  "daniela solano",
  "carlos ruiz",
  "sebastián castro",
  "sebastian castro",
  "daniela rivas",
  "carlos mendoza",
  "sebastián gómez",
  "sebastian gomez",
  "laura archer",
  "mateo pérez",
  "mateo perez"
]);

const FICTITIOUS_EMAILS = new Set([
  "daniela.solano@club.com",
  "carlos.ruiz@club.com",
  "sebastian.castro@club.com",
  "daniela@archery101010.com",
  "carlos@archery101010.com",
  "sebastian@archery101010.com",
  "demo@archery101010.com",
  "google-user@archery101010.com",
  "coach@archery101010.com"
]);

/** Club ids that were never real clubs (legacy fallbacks) — athletes linked to them must relink */
export const FAKE_CLUB_IDS = new Set(["CLB-381847", "CLB-101010", "CLB-JOINED", "CLB-DIRECTOR-101010"]);

export function isFictitiousUser(u: any): boolean {
  if (!u) return true;
  const uid = String(u.uid || u.id || "").trim();
  const uidUpper = uid.toUpperCase();
  const email = String(u.email || "").trim().toLowerCase();
  const fullName = String(u.fullName || u.userName || "").trim().toLowerCase();

  if (
    uidUpper.startsWith("USR-D-") ||
    uidUpper.startsWith("USR-ATHLETE-") ||
    uidUpper.startsWith("USR-MOCK") ||
    uidUpper.startsWith("USR-SIM") ||
    uidUpper === "USR-DEMO" ||
    uidUpper === "USR-DIRECTOR-101010" ||
    uidUpper.startsWith("RIV-") ||
    uidUpper.startsWith("BOT-") ||
    uid.toLowerCase().includes("google-user")
  ) {
    return true;
  }

  if (email.endsWith("@club.com") || FICTITIOUS_EMAILS.has(email)) {
    return true;
  }

  // Name match ONLY for synthetic (non Firebase Auth) ids — a real person may share a name
  if (FICTITIOUS_NAMES.has(fullName) && (uidUpper.startsWith("USR-") || !uid)) {
    return true;
  }

  return false;
}

export function isFictitiousSession(s: any, key?: string): boolean {
  if (!s) return true;
  const id = String(s.id || s.uid || key || "").trim().toUpperCase();
  const userId = String(s.userId || s.userUid || "").trim().toUpperCase();
  const userName = String(s.userName || "").trim().toLowerCase();

  if (
    id.startsWith("SES-D-") ||
    id.startsWith("SES-DEMO") ||
    id.startsWith("SES-MOCK")
  ) {
    return true;
  }

  if (
    userId.startsWith("USR-D-") ||
    userId.startsWith("USR-ATHLETE-") ||
    userId.startsWith("USR-MOCK") ||
    userId.startsWith("USR-SIM") ||
    userId === "USR-DEMO" ||
    userId.startsWith("RIV-") ||
    userId.startsWith("BOT-")
  ) {
    return true;
  }

  if (!s.isDuel && FICTITIOUS_NAMES.has(userName) && (userId.startsWith("USR-") || !userId)) {
    return true;
  }

  return false;
}

export async function purgeAllFictitiousData(): Promise<void> {
  try {
    // 1. Purge fictitious users from simulated_users
    const users = await settingsStore.getItem<any[]>("simulated_users");
    if (Array.isArray(users)) {
      const realUsers = users.filter((u) => !isFictitiousUser(u));
      if (realUsers.length !== users.length) {
        await settingsStore.setItem("simulated_users", realUsers);
      }
    }

    // 2. Purge fictitious sessions from sessionsStore
    const sessionKeysToRemove: string[] = [];
    await sessionsStore.iterate((value: any, key: string) => {
      if (isFictitiousSession(value, key)) {
        sessionKeysToRemove.push(key);
      }
    });
    for (const k of sessionKeysToRemove) {
      await sessionsStore.removeItem(k);
    }

    // 3. Purge fictitious stars
    const starKeysToRemove: string[] = [];
    await athleteStarsStore.iterate((value: any, key: string) => {
      if (isFictitiousUser({ uid: value?.userId || key, fullName: value?.userName })) {
        starKeysToRemove.push(key);
      }
    });
    for (const k of starKeysToRemove) {
      await athleteStarsStore.removeItem(k);
    }

    const historyKeysToRemove: string[] = [];
    await starHistoryStore.iterate((value: any, key: string) => {
      if (isFictitiousUser({ uid: value?.userId, fullName: value?.userName })) {
        historyKeysToRemove.push(key);
      }
    });
    for (const k of historyKeysToRemove) {
      await starHistoryStore.removeItem(k);
    }

    // 4. Clean syncQueueStore: remove fictitious items and heal any failed real items by sanitizing undefined fields
    const queueItems: SyncItem[] = [];
    await syncQueueStore.iterate((value: SyncItem) => {
      queueItems.push(value);
    });
    for (const item of queueItems) {
      if (
        (item.collection === "users" && isFictitiousUser(item.payload || { uid: item.payloadId })) ||
        (item.collection === "sessions" && isFictitiousSession(item.payload || { id: item.payloadId }, item.payloadId))
      ) {
        await syncQueueStore.removeItem(item.id);
      } else if (item.payload) {
        const cleanedPayload = sanitizeForFirestore(item.payload);
        await syncQueueStore.setItem(item.id, {
          ...item,
          payload: cleanedPayload,
          status: "pending",
          attempts: 0
        });
      }
    }
  } catch (err) {
    console.error("Error purging fictitious data:", err);
  }
}

// Helper methods for Sync Queue
export async function getSyncQueue(): Promise<SyncItem[]> {
  const queue: SyncItem[] = [];
  await syncQueueStore.iterate((value: SyncItem) => {
    queue.push(value);
  });
  return queue.sort((a, b) => a.timestamp - b.timestamp);
}

export async function addToSyncQueue(item: Omit<SyncItem, "attempts" | "status">): Promise<void> {
  const newItem: SyncItem = {
    ...item,
    payload: item.payload ? sanitizeForFirestore(item.payload) : item.payload,
    attempts: 0,
    status: "pending"
  };
  await syncQueueStore.setItem(newItem.id, newItem);

  // Notify custom event for UI indicators
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sync-queue-changed"));
  }

  // Trigger real-time sequential background synchronization immediately.
  // Dynamic import avoids compilation circular dependencies with syncManager.
  if (typeof window !== "undefined") {
    import("./syncManager")
      .then(({ runSync }) => {
        runSync().catch((err) => console.error("Immediate sync execution failed:", err));
      })
      .catch((err) => console.error("Failed to load syncManager for immediate sync:", err));
  }
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  await syncQueueStore.removeItem(id);
}

export async function updateSyncItem(id: string, updates: Partial<SyncItem>): Promise<void> {
  const item = await syncQueueStore.getItem<SyncItem>(id);
  if (item) {
    const updatedItem = { ...item, ...updates };
    await syncQueueStore.setItem(id, updatedItem);
  }
}

// Helper methods for Local Sessions
export async function getLocalSessions(): Promise<any[]> {
  const sessions: any[] = [];
  const keysToDelete: string[] = [];
  await sessionsStore.iterate((value: any, key: string) => {
    if (isFictitiousSession(value, key)) {
      keysToDelete.push(key);
    } else {
      sessions.push({ ...value, id: value.id || value.uid || key });
    }
  });
  if (keysToDelete.length > 0) {
    Promise.all(keysToDelete.map((k) => sessionsStore.removeItem(k))).catch(() => {});
  }
  return sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function saveLocalSession(id: string, sessionData: any): Promise<void> {
  const cleanData = sanitizeForFirestore({ ...sessionData, id: sessionData.id || id });
  await sessionsStore.setItem(id, cleanData);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "sessions_local" } }));
  }
}

export async function getLocalSession(id: string): Promise<any | null> {
  return await sessionsStore.getItem<any>(id);
}

export async function deleteLocalSession(id: string): Promise<void> {
  await sessionsStore.removeItem(id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "sessions_local" } }));
  }
}

// Helper methods for Calendar Events
export async function getLocalEvents(): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  await calendarStore.iterate((value: CalendarEvent) => {
    events.push(value);
  });
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export async function saveLocalEvent(id: string, eventData: CalendarEvent): Promise<void> {
  await calendarStore.setItem(id, eventData);
}

export async function deleteLocalEvent(id: string): Promise<void> {
  await calendarStore.removeItem(id);
}

// Helper methods for Settings/Profile
export async function getLocalSetting<T>(key: string, defaultValue: T): Promise<T> {
  const val = await settingsStore.getItem<T>(key);
  if (val === null) return defaultValue;
  if (key === "simulated_users" && Array.isArray(val)) {
    return val.filter((u) => !isFictitiousUser(u)) as unknown as T;
  }
  return val;
}

export async function saveLocalSetting<T>(key: string, value: T): Promise<void> {
  if (key === "simulated_users" && Array.isArray(value)) {
    const cleaned = value.filter((u) => !isFictitiousUser(u)) as unknown as T;
    await settingsStore.setItem(key, cleaned);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "simulated_users" } }));
    }
    return;
  }
  await settingsStore.setItem(key, value);
}

// Helper methods for Macrocycles
export async function getLocalMacrocycles(): Promise<any[]> {
  const list: any[] = [];
  await macrocyclesStore.iterate((value: any) => {
    list.push(value);
  });
  return list;
}

export async function saveLocalMacrocycle(id: string, macrocycleData: any): Promise<void> {
  await macrocyclesStore.setItem(id, macrocycleData);
}

export async function getLocalMacrocycle(id: string): Promise<any | null> {
  return await macrocyclesStore.getItem<any>(id);
}

export async function deleteLocalMacrocycle(id: string): Promise<void> {
  await macrocyclesStore.removeItem(id);
}

