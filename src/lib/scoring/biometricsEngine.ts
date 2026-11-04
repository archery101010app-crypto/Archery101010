"use client";

import { getSessionArrows, countScoredArrows, isVolumeSession } from "./sessionMetrics";

export interface BiometricSessionSnapshot {
  sessionId: string;
  arrowsCount: number;
  distanceM: number;
  arrowsPerEnd: number;
  completedEnds: number;
  currentEndIndex: number;
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
  | { type: "TOGGLE_AUTO_DETECT"; enabled: boolean }
  | { type: "FINISH_SESSION_FROM_WATCH" }
  | { type: "REQUEST_STATE" };

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

  return Math.max(1, Math.round(bowEnergyKcal + walkEnergyKcal));
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
 * Extracts or computes the session's walked distance in meters (for stored sessions in History, Coach Portal, or Share Card)
 */
export function getSessionDistanceWalkedM(session: any): number {
  if (!session) return 0;
  if (typeof session.distanceWalkedM === "number" && session.distanceWalkedM > 0) {
    return Math.round(session.distanceWalkedM);
  }
  const arrows = getSessionArrows(session);
  const distM = Number(session.distance) || 18;
  const perEnd = Number(session.arrowsPerEnd) || 6;
  const completedEnds = Array.isArray(session.ends)
    ? session.ends.filter((e: any) => Array.isArray(e?.arrows) && e.arrows.some((a: string) => a !== "" && a !== undefined)).length
    : 0;

  return calculateFallbackDistanceM({
    isVolume: isVolumeSession(session),
    arrowsCount: arrows,
    completedEndsCount: completedEnds,
    distanceM: distM,
    arrowsPerEnd: perEnd
  });
}

/**
 * Extracts or computes the session's active calories (kcal) (for stored sessions in History, Coach Portal, or Share Card)
 */
export function getSessionActiveKcal(session: any, userProfile?: any): number {
  if (!session) return 0;
  if (typeof session.activeKcal === "number" && session.activeKcal > 0) {
    return Math.round(session.activeKcal);
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
  try {
    localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(snapshot));
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
    if ((window as any).ArcheryWatchNativeBridge?.onSessionTelemetryUpdate) {
      (window as any).ArcheryWatchNativeBridge.onSessionTelemetryUpdate(JSON.stringify(snapshot));
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
  try {
    localStorage.setItem(
      WATCH_CMD_STORAGE_KEY,
      JSON.stringify({ ...cmd, _ts: Date.now() })
    );
  } catch {}
  try {
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel(WATCH_CHANNEL_NAME);
      ch.postMessage(cmd);
      ch.close();
    }
  } catch {}
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

  // Expose global callback for Native Wear OS / Garmin Connect IQ BLE receiver
  (window as any).onArcheryWatchCommand = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr) as WatchCommandMessage;
      if (parsed && parsed.type) onMessage(parsed);
    } catch {}
  };

  return () => {
    window.removeEventListener("storage", handleStorage);
    if (channel) {
      try {
        channel.close();
      } catch {}
    }
  };
}
