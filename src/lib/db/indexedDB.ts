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

// Types
export interface SyncItem {
  id: string; // unique transaction id, e.g. "TXN-1716800..."
  collection: string; // e.g. "sessions", "users", "clubs"
  operation: "INSERT" | "UPDATE" | "DELETE";
  payloadId: string; // the ID of the document being modified
  payload: any; // the actual data to write/modify
  timestamp: number;
  attempts: number;
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
}

// Generate unique text-based IDs (prefix + timestamp + random chars)
export function generateResilientId(prefix: string): string {
  const timestamp = Date.now();
  const randomChars = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${randomChars}`;
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
    attempts: 0,
    status: "pending"
  };
  await syncQueueStore.setItem(newItem.id, newItem);
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
  await sessionsStore.iterate((value: any) => {
    sessions.push(value);
  });
  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveLocalSession(id: string, sessionData: any): Promise<void> {
  await sessionsStore.setItem(id, sessionData);
}

export async function getLocalSession(id: string): Promise<any | null> {
  return await sessionsStore.getItem<any>(id);
}

export async function deleteLocalSession(id: string): Promise<void> {
  await sessionsStore.removeItem(id);
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
  return val !== null ? val : defaultValue;
}

export async function saveLocalSetting<T>(key: string, value: T): Promise<void> {
  await settingsStore.setItem(key, value);
}
