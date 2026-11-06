"use client";

import { getSessionArrows, countScoredArrows, isVolumeSession } from "./sessionMetrics";

export interface BiometricSessionSnapshot {
  sessionId: string;
  sessionActive?: boolean;
  arrowsCount: number;
  totalScore?: number;
  distanceM: number;
  arrowsPerEnd: number;
  endsCount?: number;
  completedEnds: number;
  currentEndIndex: number;
  currentEndArrows?: string[];
  stepsCount?: number;
  gpsDistanceM: number;
  distanceWalkedM: number;
  gpsActive: boolean;
  activeKcal: number;
  bowPoundageLbs: number;
  practiceType: string;
  bowType: string;
  autoDetectEnabled: boolean;
  lastShotTimestamp?: number;
  updatedAt: number;
}

export type WatchCommandMessage =
  | { type: "STATE_UPDATE"; payload: BiometricSessionSnapshot }
  | { type: "INCREMENT_ARROW"; delta: number; source: "watch_manual" | "watch_auto" | "phone" }
  | {
      type: "DECREMENT_ARROW";
      delta?: number;
      source?: "watch_manual" | "watch_auto" | "phone";
      totalScore?: number;
    }
  | { type: "UNDO_ARROW"; totalScore?: number }
  | {
      type: "SCORE_INPUT";
      payload?: { value: string; totalScore?: number };
      value?: string;
      totalScore?: number;
    }
  | { type: "NEXT_END" }
  | {
      type: "SYNC_TELEMETRY_FROM_WATCH";
      payload?: { stepsCount?: number; distanceWalkedM?: number; activeKcal?: number };
      stepsCount?: number;
      distanceWalkedM?: number;
      activeKcal?: number;
    }
  | { type: "TOGGLE_AUTO_DETECT"; enabled: boolean }
  | { type: "FINISH_SESSION_FROM_WATCH" }
  | { type: "REQUEST_STATE" };

export interface WatchConnectionStatus {
  isNativeAndroid: boolean;
  bridgeReady: boolean;
  nativeVersion?: string;
  connectedNodesCount: number;
  connectedNodes: Array<{ id: string; displayName: string; isNearby?: boolean }>;
  lastMessageAt: number;
  lastPongAt: number;
  hasCachedState: boolean;
}

const WATCH_CHANNEL_NAME = "archery_101010_watch_bridge_v1";
const WATCH_STORAGE_KEY = "archery_101010_watch_state_v1";
const WATCH_CMD_STORAGE_KEY = "archery_101010_watch_cmd_v1";

/**
 * Parses bow poundage from user profile (e.g., "38", "38 lbs", "42#")
 */
export function parseBowPoundageLbs(user?: any, sessionBowPoundage?: number): number {
  if (typeof sessionBowPoundage === "number" && sessionBowPoundage > 10 && sessionBowPoundage < 90) {
    return sessionBowPoundage;
  }
  const raw =
    user?.bowConfig?.poundage ||
    user?.bows?.[0]?.poundage ||
    user?.physicalData?.bowPoundage ||
    "";
  const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (!isNaN(parsed) && parsed >= 12 && parsed <= 85) {
    return parsed;
  }
  return 36; // Standard Olympic/Compound training default
}

/**
 * Parses athlete weight in kg from user profile (defaults to 72kg if unset)
 */
export function parseAthleteWeightKg(user?: any): number {
  const raw = user?.physicalData?.weight || "";
  const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (!isNaN(parsed) && parsed >= 30 && parsed <= 180) {
    return parsed;
  }
  return 72;
}

/**
 * Estimates walked distance in meters from step count and optional archer height (cm).
 */
export function estimateDistanceFromSteps(stepsCount: number, heightCm?: number): number {
  const safeSteps = Math.max(0, Number(stepsCount) || 0);
  const parsedHeight = Number(heightCm) || 0;
  const strideM = parsedHeight >= 100 && parsedHeight <= 230 ? (parsedHeight * 0.415) / 100 : 0.76;
  return Math.round(safeSteps * strideM);
}

/**
 * Haversine formula to compute real-world distance in meters between two GPS coordinates
 */
export function calculateHaversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Computes the automatic indoor/range fallback walking distance in meters
 * based on completed ends (or arrow cadence in Volume mode) × shooting distance × 2 (round trip to target).
 */
export function calculateFallbackDistanceM(params: {
  isVolume: boolean;
  arrowsCount: number;
  completedEndsCount: number;
  distanceM: number;
  arrowsPerEnd?: number;
}): number {
  const dist = Math.max(5, Number(params.distanceM) || 18);
  const perEnd = Math.max(1, Number(params.arrowsPerEnd) || 6);

  if (params.isVolume) {
    const virtualEnds = Math.floor(Math.max(0, params.arrowsCount) / perEnd);
    return Math.round(virtualEnds * dist * 2);
  }

  // For scored/practice sessions: each completed end (or group of arrowsPerEnd) represents a round trip (2x distance)
  const endsByArrows = Math.floor(Math.max(0, params.arrowsCount) / perEnd);
  const effectiveEnds = Math.max(params.completedEndsCount || 0, endsByArrows);
  return Math.round(effectiveEnds * dist * 2);
}

/**
 * Computes Active Calories (kcal) combining biomechanical bow draw work + range walking expenditure.
 */
export function calculateActiveKcal(params: {
  arrowsCount: number;
  distanceWalkedM: number;
  bowPoundageLbs?: number;
  athleteWeightKg?: number;
}): number {
  const arrows = Math.max(0, Number(params.arrowsCount) || 0);
  const walkedM = Math.max(0, Number(params.distanceWalkedM) || 0);
  const poundage = params.bowPoundageLbs && params.bowPoundageLbs > 0 ? params.bowPoundageLbs : 36;
  const weightKg = params.athleteWeightKg && params.athleteWeightKg > 0 ? params.athleteWeightKg : 72;

  if (arrows === 0 && walkedM < 10) return 0;

  // Biomechanical energy per shot (draw + full-draw isometric hold + postural stabilization)
  const kcalPerArrow = 0.56 + poundage * 0.0165;
  const bowEnergyKcal = arrows * kcalPerArrow;

  // Walking energy expenditure (~0.78 kcal per kg per km walked on flat/grass range)
  const walkEnergyKcal = (walkedM / 1000) * weightKg * 0.78;

  if (arrows <= 0 && walkedM <= 0) return 0;
  return Math.max(0, Math.round(bowEnergyKcal + walkEnergyKcal));
}

export function calculateArcheryKcal(params: {
  arrowsShot?: number;
  arrowsCount?: number;
  drawWeightLbs?: number;
  bowPoundageLbs?: number;
  distanceWalkedM: number;
  durationMinutes?: number;
  archerWeightKg?: number;
  athleteWeightKg?: number;
}): number {
  return calculateActiveKcal({
    arrowsCount: params.arrowsShot ?? params.arrowsCount ?? 0,
    distanceWalkedM: params.distanceWalkedM,
    bowPoundageLbs: params.drawWeightLbs ?? params.bowPoundageLbs,
    athleteWeightKg: params.archerWeightKg ?? params.athleteWeightKg
  });
}

/**
 * Formats meters into kilometers and miles:
 * - compact: "0.00km/0.00mi" (used in Official Telemetry Card)
 * - spaced: "0.00km / 0.00mi" (used in Smartwatch & Session UI)
 */
export function formatKmAndMiles(meters: number, spaced: boolean = false): string {
  const safeMeters = Math.max(0, Number(meters) || 0);
  const km = safeMeters / 1000;
  const mi = safeMeters / 1609.344;
  const sep = spaced ? " / " : "/";
  return `${km.toFixed(2)}km${sep}${mi.toFixed(2)}mi`;
}

/**
 * Extracts the session's real walked distance in meters (GPS + live movement during session, never derived from arrow ends)
 */
export function getSessionDistanceWalkedM(session: any): number {
  if (!session) return 0;
  if (typeof session.gpsDistanceM === "number" && session.gpsDistanceM >= 0) {
    return Math.round(session.gpsDistanceM);
  }
  if (typeof session.distanceWalkedM === "number" && session.distanceWalkedM >= 0) {
    return Math.round(session.distanceWalkedM);
  }
  if (typeof session.biometrics?.gpsDistanceM === "number" && session.biometrics.gpsDistanceM >= 0) {
    return Math.round(session.biometrics.gpsDistanceM);
  }
  if (typeof session.biometrics?.distanceWalkedM === "number" && session.biometrics.distanceWalkedM >= 0) {
    return Math.round(session.biometrics.distanceWalkedM);
  }
  return 0;
}

/**
 * Extracts or computes the session's active calories (kcal) (for stored sessions in History, Coach Portal, or Share Card)
 */
export function getSessionActiveKcal(session: any, userProfile?: any): number {
  if (!session) return 0;
  if (typeof session.activeKcal === "number" && session.activeKcal > 0) {
    return Math.round(session.activeKcal);
  }
  if (typeof session.biometrics?.activeKcal === "number" && session.biometrics.activeKcal > 0) {
    return Math.round(session.biometrics.activeKcal);
  }
  const arrows = getSessionArrows(session);
  const distanceWalkedM = getSessionDistanceWalkedM(session);
  const poundage = parseBowPoundageLbs(userProfile, session.bowPoundageLbs);
  const weightKg = parseAthleteWeightKg(userProfile);

  return calculateActiveKcal({
    arrowsCount: arrows,
    distanceWalkedM,
    bowPoundageLbs: poundage,
    athleteWeightKg: weightKg
  });
}

/**
 * Broadcasts or persists Smartwatch state updates so open smartwatches (Wear OS, Garmin IQ, Watch browser)
 * and the main session view stay synchronized with zero latency.
 */
export function publishWatchState(snapshot: BiometricSessionSnapshot): void {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(snapshot);
  try {
    localStorage.setItem(WATCH_STORAGE_KEY, serialized);
  } catch {}
  try {
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel(WATCH_CHANNEL_NAME);
      ch.postMessage({ type: "STATE_UPDATE", payload: snapshot } satisfies WatchCommandMessage);
      ch.close();
    }
  } catch {}
  try {
    // Also notify native Android Wear OS / Garmin Connect IQ bridge if present in APK WebView
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(serialized);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(serialized);
    }
  } catch {}
}

export function readStoredWatchState(): BiometricSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BiometricSessionSnapshot;
  } catch {
    return null;
  }
}

export function sendWatchCommand(cmd: WatchCommandMessage): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ ...cmd, _ts: Date.now() });
  try {
    localStorage.setItem(WATCH_CMD_STORAGE_KEY, payload);
  } catch {}
  try {
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel(WATCH_CHANNEL_NAME);
      ch.postMessage(cmd);
      ch.close();
    }
  } catch {}
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.sendWatchCommand) {
      bridge.sendWatchCommand(payload);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(payload);
    } else if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(payload);
    }
  } catch {}
}

const nativeWatchListeners = new Set<(msg: WatchCommandMessage) => void>();
const seenNativeCmdIds = new Set<string>();
const watchStatusListeners = new Set<(status: WatchConnectionStatus) => void>();

function ensureGlobalNativeWatchDispatcher(): void {
  if (typeof window === "undefined") return;
  const dispatch = (jsonOrObj: any) => {
    try {
      const parsed: any =
        typeof jsonOrObj === "string" ? JSON.parse(jsonOrObj) : jsonOrObj;
      if (!parsed || !parsed.type) return;
      if (parsed._cmdId && typeof parsed._cmdId === "string") {
        if (seenNativeCmdIds.has(parsed._cmdId)) return;
        seenNativeCmdIds.add(parsed._cmdId);
        if (seenNativeCmdIds.size > 120) {
          const first = seenNativeCmdIds.values().next().value;
          if (first) seenNativeCmdIds.delete(first);
        }
      }
      nativeWatchListeners.forEach((listener) => {
        try {
          listener(parsed as WatchCommandMessage);
        } catch {}
      });
    } catch {}
  };
  (window as any).__onNativeWatchMessage = dispatch;
  (window as any).onArcheryWatchCommand = dispatch;
}

export function subscribeWatchMessages(
  onMessage: (msg: WatchCommandMessage) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let channel: BroadcastChannel | null = null;
  try {
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(WATCH_CHANNEL_NAME);
      channel.onmessage = (ev) => {
        if (ev?.data && ev.data.type) {
          onMessage(ev.data as WatchCommandMessage);
        }
      };
    }
  } catch {}

  const handleStorage = (e: StorageEvent) => {
    if (e.key === WATCH_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as BiometricSessionSnapshot;
        onMessage({ type: "STATE_UPDATE", payload: parsed });
      } catch {}
    } else if (e.key === WATCH_CMD_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue) as WatchCommandMessage;
        if (parsed && parsed.type) {
          onMessage(parsed);
        }
      } catch {}
    }
  };

  window.addEventListener("storage", handleStorage);

  // Register listener in the multi-subscriber Set (never overwrites or deletes other subscribers)
  nativeWatchListeners.add(onMessage);
  ensureGlobalNativeWatchDispatcher();

  // Flush any commands queued natively while WebView was loading or paused
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.flushPendingWatchCommands) {
      bridge.flushPendingWatchCommands();
    }
  } catch {}

  return () => {
    window.removeEventListener("storage", handleStorage);
    nativeWatchListeners.delete(onMessage);
    if (channel) {
      try {
        channel.close();
      } catch {}
    }
  };
}

function parseWatchStatusPayload(raw: any): WatchConnectionStatus {
  const isNativeAndroid =
    typeof window !== "undefined" &&
    Boolean((window as any).ArcheryNativeAuth || (window as any).Capacitor?.isNativePlatform?.());
  const bridge = typeof window !== "undefined" ? (window as any).ArcheryWatchNativeBridge : null;
  if (!bridge) {
    return {
      isNativeAndroid,
      bridgeReady: false,
      connectedNodesCount: 0,
      connectedNodes: [],
      lastMessageAt: 0,
      lastPongAt: 0,
      hasCachedState: false
    };
  }
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw || {};
    const nodes = Array.isArray(obj.connectedNodes) ? obj.connectedNodes : [];
    return {
      isNativeAndroid: true,
      bridgeReady: true,
      nativeVersion: obj.nativeVersion || "2.63+",
      connectedNodesCount:
        typeof obj.connectedNodesCount === "number" ? obj.connectedNodesCount : nodes.length,
      connectedNodes: nodes,
      lastMessageAt: Number(obj.lastMessageAt) || 0,
      lastPongAt: Number(obj.lastPongAt) || 0,
      hasCachedState: Boolean(obj.hasCachedState)
    };
  } catch {
    return {
      isNativeAndroid: true,
      bridgeReady: true,
      connectedNodesCount: 0,
      connectedNodes: [],
      lastMessageAt: 0,
      lastPongAt: 0,
      hasCachedState: false
    };
  }
}

export function requestNativeWatchStatus(): WatchConnectionStatus {
  if (typeof window === "undefined") {
    return {
      isNativeAndroid: false,
      bridgeReady: false,
      connectedNodesCount: 0,
      connectedNodes: [],
      lastMessageAt: 0,
      lastPongAt: 0,
      hasCachedState: false
    };
  }
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.getWatchConnectionStatus) {
      const jsonStr = bridge.getWatchConnectionStatus();
      return parseWatchStatusPayload(jsonStr);
    }
  } catch {}
  return parseWatchStatusPayload(null);
}

export function pingNativeWatch(): void {
  if (typeof window === "undefined") return;
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.pingWatch) {
      bridge.pingWatch();
    }
  } catch {}
  sendWatchCommand({ type: "REQUEST_STATE" });
}

export function subscribeWatchConnectionStatus(
  onStatus: (status: WatchConnectionStatus) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  watchStatusListeners.add(onStatus);
  (window as any).__onWatchConnectionStatus = (raw: any) => {
    const status = parseWatchStatusPayload(raw);
    watchStatusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch {}
    });
  };
  const initial = requestNativeWatchStatus();
  onStatus(initial);
  return () => {
    watchStatusListeners.delete(onStatus);
  };
}

