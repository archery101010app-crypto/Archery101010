"use client";

import { db, auth } from "@/lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  Unsubscribe
} from "firebase/firestore";
import { getSessionArrows } from "./sessionMetrics";

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
  sensitivityLevel?: 0 | 1 | 2;
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
  | { type: "SET_SENSITIVITY"; sensitivityLevel: 0 | 1 | 2 }
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
  | { type: "TOGGLE_AUTO_DETECT"; enabled: boolean; sensitivityLevel?: 0 | 1 | 2 }
  | { type: "FINISH_SESSION_FROM_WATCH" }
  | { type: "REQUEST_STATE" };

export type WatchCommandPayload = WatchCommandMessage & {
  cmdId?: string;
  _cmdId?: string;
  cmdSeq?: number;
  _cmdSeq?: number;
  _ts?: number;
};

export interface WatchConnectionStatus {
  isNativeAndroid: boolean;
  isNativeIos?: boolean;
  bridgeReady: boolean;
  nativeVersion?: string;
  connectedNodesCount: number;
  connectedNodes: Array<{ id: string; displayName: string; isNearby?: boolean }>;
  /** Paired watches that already have the companion watch app installed. */
  watchAppInstalledCount?: number;
  lastMessageAt: number;
  lastPongAt: number;
  hasCachedState: boolean;
}

export interface CloudWatchPairingStatus {
  pairingCode: string;
  cloudConnected: boolean;
  watchLinked: boolean;
  watchSource: string | null;
  lastCloudSyncAt: number;
  lastWatchSeenAt: number;
}

const WATCH_CHANNEL_NAME = "archery_101010_watch_bridge_v1";
const WATCH_STORAGE_KEY = "archery_101010_watch_state_v1";
const WATCH_CMD_STORAGE_KEY = "archery_101010_watch_cmd_v1";
const WATCH_CLIENT_CODE_KEY = "archery_watch_client_pairing_code";

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
 * Formats walking distance in meters into meters (mts) and feet (ft):
 * - compact: "15mts/49ft" (used in Official Telemetry Card, Session UI, History & Coach Portal)
 * - spaced: "15mts / 49ft" (used in Smartwatch & Session UI)
 */
export function formatMetersAndFeet(meters: number, spaced: boolean = false): string {
  const safeMeters = Math.max(0, Math.round(Number(meters) || 0));
  const ft = Math.round(safeMeters * 3.28084);
  const sep = spaced ? " / " : "/";
  return `${safeMeters}mts${sep}${ft}ft`;
}

export function formatKmAndMiles(meters: number, spaced: boolean = false): string {
  return formatMetersAndFeet(meters, spaced);
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

// ============================================================================
// NATIVE + BUFFERED WATCH COMMAND DISPATCHER & 6-DIGIT CLOUD PAIRING ENGINE
// ============================================================================

const nativeWatchListeners = new Set<(msg: WatchCommandMessage) => void>();
const seenNativeCmdIds = new Set<string>();
const pendingIncomingWatchMessages: WatchCommandPayload[] = [];
const watchStatusListeners = new Set<(status: WatchConnectionStatus) => void>();
const cloudPairingListeners = new Set<(status: CloudWatchPairingStatus) => void>();

let lastIosWatchStatus: WatchConnectionStatus | null = null;

// Phone-side Cloud Watch Sync state
let activePhonePairingCode = "";
let activePhonePairingUid = "";
let phoneCloudUnsubscribe: Unsubscribe | null = null;
let phoneCloudThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let lastPhoneCloudPushMs = 0;
let pendingPhoneCloudSnapshot: BiometricSessionSnapshot | null = null;
let lastPushedPhoneArrowsCount = 0;
const seenCloudCmdIds = new Set<string>();
let lastCloudTelemetrySteps = 0;
let lastCloudTelemetryDistM = 0;

// Standalone /watch client Cloud Sync state
let activeWatchClientCode = "";
let watchClientUnsubscribe: Unsubscribe | null = null;
let watchClientCmdSeq = 0;
let latestWatchClientSteps = 0;
let latestWatchClientDistM = 0;

let cloudPairingStatusState: CloudWatchPairingStatus = {
  pairingCode: "",
  cloudConnected: false,
  watchLinked: false,
  watchSource: null,
  lastCloudSyncAt: 0,
  lastWatchSeenAt: 0
};

function notifyCloudPairingStatus(patch: Partial<CloudWatchPairingStatus>): void {
  cloudPairingStatusState = { ...cloudPairingStatusState, ...patch };
  cloudPairingListeners.forEach((cb) => {
    try {
      cb(cloudPairingStatusState);
    } catch {}
  });
}

export function getCloudWatchPairingStatus(): CloudWatchPairingStatus {
  return cloudPairingStatusState;
}

export function subscribeCloudWatchPairingStatus(
  onStatus: (status: CloudWatchPairingStatus) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  cloudPairingListeners.add(onStatus);
  onStatus(cloudPairingStatusState);
  return () => {
    cloudPairingListeners.delete(onStatus);
  };
}

function getSavedSensitivityLevel(): 0 | 1 | 2 {
  if (typeof window === "undefined") return 1;
  try {
    const saved = localStorage.getItem("archery_101010_auto_sensitivity");
    if (saved === "BAJA") return 0;
    if (saved === "ALTA") return 2;
  } catch {}
  return 1;
}

function hasIosWatchBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge?.postMessage);
}

function recordSeenCmdId(id: string): boolean {
  if (!id) return false;
  if (seenNativeCmdIds.has(id)) return true;
  seenNativeCmdIds.add(id);
  if (seenNativeCmdIds.size > 150) {
    const oldest = seenNativeCmdIds.values().next().value;
    if (oldest) seenNativeCmdIds.delete(oldest);
  }
  return false;
}

function bufferIncomingWatchCommand(cmd: WatchCommandPayload): void {
  const cmdId = String(cmd.cmdId || cmd._cmdId || "");
  if (cmdId) {
    const alreadyBuffered = pendingIncomingWatchMessages.some(
      (item) => (item.cmdId || item._cmdId) === cmdId
    );
    if (alreadyBuffered) return;
  }
  if (pendingIncomingWatchMessages.length >= 100) {
    pendingIncomingWatchMessages.shift();
  }
  pendingIncomingWatchMessages.push(cmd);
}

function dispatchWatchCommandInternal(jsonOrObj: any): string {
  try {
    const parsed: WatchCommandPayload =
      typeof jsonOrObj === "string" ? JSON.parse(jsonOrObj) : jsonOrObj;
    if (!parsed || !parsed.type) return "IGNORED";

    const cmdId =
      typeof parsed.cmdId === "string" && parsed.cmdId
        ? parsed.cmdId
        : typeof parsed._cmdId === "string" && parsed._cmdId
        ? parsed._cmdId
        : "";
    if (cmdId && recordSeenCmdId(cmdId)) {
      return "DELIVERED";
    }

    if (nativeWatchListeners.size === 0) {
      if (parsed.type !== "REQUEST_STATE") {
        bufferIncomingWatchCommand(parsed);
      }
      return "DELIVERED";
    }

    nativeWatchListeners.forEach((listener) => {
      try {
        listener(parsed);
      } catch {}
    });
    return "DELIVERED";
  } catch {
    return "ERROR";
  }
}

function ensureGlobalNativeWatchDispatcher(): void {
  if (typeof window === "undefined") return;
  (window as any).__onNativeWatchMessage = dispatchWatchCommandInternal;
  (window as any).onArcheryWatchCommand = dispatchWatchCommandInternal;
}

if (typeof window !== "undefined") {
  ensureGlobalNativeWatchDispatcher();
}

function buildPhoneCloudSessionFields(
  snapshot: BiometricSessionSnapshot | null,
  uid: string
): Record<string, any> {
  const s = snapshot || readStoredWatchState();
  const endsCount = Math.max(1, Number(s?.endsCount) || 12);
  const arrowsPerEnd = Math.max(1, Number(s?.arrowsPerEnd) || 6);
  const currentEnd = Math.max(1, (Number(s?.currentEndIndex) || 0) + 1);
  const currentEndArrows = Array.isArray(s?.currentEndArrows)
    ? s!.currentEndArrows!.slice(0, 12).map((v) => String(v))
    : [];
  const sensitivityLevel: 0 | 1 | 2 =
    s?.sensitivityLevel === 0 || s?.sensitivityLevel === 1 || s?.sensitivityLevel === 2
      ? s.sensitivityLevel
      : getSavedSensitivityLevel();

  return {
    userId: uid,
    sessionId: String(s?.sessionId || "LIVE"),
    sessionActive: s ? s.sessionActive !== false : true,
    arrowsCount: Math.max(0, Number(s?.arrowsCount) || 0),
    totalScore: Math.max(0, Number(s?.totalScore) || 0),
    roundScoreMax: endsCount * arrowsPerEnd * 10,
    distanceM: Math.max(5, Number(s?.distanceM) || 18),
    arrowsPerEnd,
    currentEnd,
    totalEnds: endsCount,
    currentEndArrows,
    stepsCount: Math.max(0, Number(s?.stepsCount) || 0),
    distanceWalkedM: Math.max(0, Math.round(Number(s?.distanceWalkedM) || 0)),
    caloriesBurnedKcal: Math.max(0, Math.round(Number(s?.activeKcal) || 0)),
    autoDetectEnabled: s ? Boolean(s.autoDetectEnabled) : true,
    sensitivityLevel,
    bowPoundageLbs: Math.max(10, Number(s?.bowPoundageLbs) || 36),
    practiceType: String(s?.practiceType || "Práctica"),
    updatedAt: Date.now()
  };
}

function startPhonePairingSnapshotListener(code: string, uid: string): void {
  if (phoneCloudUnsubscribe && activePhonePairingCode === code && activePhonePairingUid === uid) {
    return;
  }
  if (phoneCloudUnsubscribe) {
    try {
      phoneCloudUnsubscribe();
    } catch {}
    phoneCloudUnsubscribe = null;
  }
  activePhonePairingCode = code;
  activePhonePairingUid = uid;
  let isInitialSnapshot = true;

  notifyCloudPairingStatus({
    pairingCode: code,
    cloudConnected: true
  });

  const sessionRef = doc(db, "watch_sessions", code);
  phoneCloudUnsubscribe = onSnapshot(
    sessionRef,
    (snap) => {
      if (!snap.exists()) {
        isInitialSnapshot = false;
        return;
      }
      const data = snap.data() || {};
      const now = Date.now();
      const watchSource = typeof data.watchSource === "string" && data.watchSource ? data.watchSource : null;
      const incomingCmdId = typeof data.lastWatchCmdId === "string" ? data.lastWatchCmdId : "";
      const docUpdatedAt = Number(data.updatedAt) || 0;

      if (isInitialSnapshot) {
        isInitialSnapshot = false;
        // Prevent replaying stale commands from older sessions on initial attach
        if (incomingCmdId && (docUpdatedAt === 0 || now - docUpdatedAt > 25000)) {
          seenCloudCmdIds.add(incomingCmdId);
        }
        if (typeof data.watchStepsCount === "number") {
          lastCloudTelemetrySteps = Math.max(0, data.watchStepsCount);
        }
        if (typeof data.watchDistanceM === "number") {
          lastCloudTelemetryDistM = Math.max(0, data.watchDistanceM);
        }
        if (watchSource && docUpdatedAt > 0 && now - docUpdatedAt <= 10 * 60 * 1000) {
          notifyCloudPairingStatus({
            pairingCode: code,
            cloudConnected: true,
            watchLinked: true,
            watchSource,
            lastWatchSeenAt: docUpdatedAt
          });
        }
      }

      if (incomingCmdId && !seenCloudCmdIds.has(incomingCmdId)) {
        seenCloudCmdIds.add(incomingCmdId);
        if (seenCloudCmdIds.size > 120) {
          const first = seenCloudCmdIds.values().next().value;
          if (first) seenCloudCmdIds.delete(first);
        }

        let parsedCmd: any = data.lastWatchCmd;
        if (typeof parsedCmd === "string") {
          try {
            parsedCmd = JSON.parse(parsedCmd);
          } catch {
            parsedCmd = null;
          }
        }
        if (parsedCmd && typeof parsedCmd === "object" && parsedCmd.type) {
          dispatchWatchCommandInternal({
            ...parsedCmd,
            cmdId: incomingCmdId,
            _cmdId: incomingCmdId
          });
        }

        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          watchLinked: true,
          watchSource: watchSource || "CLOUD_WATCH",
          lastWatchSeenAt: now
        });
      }

      const incomingSteps =
        typeof data.watchStepsCount === "number" ? Math.max(0, Math.round(data.watchStepsCount)) : -1;
      const incomingDistM =
        typeof data.watchDistanceM === "number" ? Math.max(0, Math.round(data.watchDistanceM)) : -1;

      if (incomingSteps === 0 && incomingDistM === 0 && data.sessionActive === false) {
        lastCloudTelemetrySteps = 0;
        lastCloudTelemetryDistM = 0;
      } else if (
        (incomingSteps > lastCloudTelemetrySteps && incomingSteps > 0) ||
        (incomingDistM > lastCloudTelemetryDistM && incomingDistM > 0)
      ) {
        if (incomingSteps > lastCloudTelemetrySteps) lastCloudTelemetrySteps = incomingSteps;
        if (incomingDistM > lastCloudTelemetryDistM) lastCloudTelemetryDistM = incomingDistM;
        dispatchWatchCommandInternal({
          type: "SYNC_TELEMETRY_FROM_WATCH",
          stepsCount: lastCloudTelemetrySteps,
          distanceWalkedM: lastCloudTelemetryDistM,
          payload: {
            stepsCount: lastCloudTelemetrySteps,
            distanceWalkedM: lastCloudTelemetryDistM
          }
        });
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          watchLinked: true,
          watchSource: watchSource || "CLOUD_WATCH",
          lastWatchSeenAt: now
        });
      } else if (watchSource && docUpdatedAt > 0 && now - docUpdatedAt <= 90_000) {
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          watchLinked: true,
          watchSource,
          lastWatchSeenAt: Math.max(cloudPairingStatusState.lastWatchSeenAt, docUpdatedAt)
        });
      }
    },
    () => {
      notifyCloudPairingStatus({ cloudConnected: false });
    }
  );
}

/**
 * Generates or restores the archer's 6-digit Cloud Watch Pairing Code (`100000`–`999999`),
 * persists `watch_sessions/{code}` in Firestore, and listens in real time for Garmin / Web Watch commands.
 */
export async function getOrCreatePhoneWatchPairingCode(
  uid?: string,
  forceRegenerate: boolean = false
): Promise<string> {
  if (typeof window === "undefined") return "";
  const effectiveUid = uid || auth.currentUser?.uid || "";
  if (!effectiveUid) return "";

  const storageKey = `archery_watch_pairing_code_${effectiveUid}`;
  let code = "";
  if (!forceRegenerate) {
    try {
      const saved = localStorage.getItem(storageKey) || "";
      if (/^[1-9]\d{5}$/.test(saved)) {
        code = saved;
      }
    } catch {}
  }

  if (!code) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = String(Math.floor(100000 + Math.random() * 900000));
      try {
        const existing = await getDoc(doc(db, "watch_sessions", candidate));
        if (!existing.exists() || existing.data()?.userId === effectiveUid) {
          code = candidate;
          break;
        }
      } catch {
        code = candidate;
        break;
      }
    }
    if (!code) {
      code = String(Math.floor(100000 + Math.random() * 900000));
    }
    try {
      localStorage.setItem(storageKey, code);
    } catch {}
  }

  const payload = buildPhoneCloudSessionFields(readStoredWatchState(), effectiveUid);
  try {
    await setDoc(doc(db, "watch_sessions", code), payload, { merge: true });
    notifyCloudPairingStatus({
      pairingCode: code,
      cloudConnected: true,
      lastCloudSyncAt: Date.now()
    });
  } catch {}

  startPhonePairingSnapshotListener(code, effectiveUid);
  return code;
}

function flushPhoneSnapshotToCloudImmediate(snapshot: BiometricSessionSnapshot, uid: string, code: string): void {
  if (phoneCloudThrottleTimer) {
    clearTimeout(phoneCloudThrottleTimer);
    phoneCloudThrottleTimer = null;
  }
  pendingPhoneCloudSnapshot = null;
  lastPhoneCloudPushMs = Date.now();
  lastPushedPhoneArrowsCount = Math.max(0, Number(snapshot.arrowsCount) || 0);

  const fields = buildPhoneCloudSessionFields(snapshot, uid);
  if (snapshot.sessionActive === false) {
    fields.watchStepsCount = 0;
    fields.watchDistanceM = 0;
    lastCloudTelemetrySteps = 0;
    lastCloudTelemetryDistM = 0;
  }

  setDoc(doc(db, "watch_sessions", code), fields, { merge: true })
    .then(() => {
      notifyCloudPairingStatus({ lastCloudSyncAt: Date.now(), cloudConnected: true });
    })
    .catch(() => {});
}

function schedulePhoneCloudWatchPush(snapshot: BiometricSessionSnapshot): void {
  if (typeof window === "undefined") return;
  // Never overwrite phone session fields from the standalone /watch companion view
  if (activeWatchClientCode) return;

  const uid = auth.currentUser?.uid || "";
  if (!uid) return;

  if (!activePhonePairingCode || activePhonePairingUid !== uid) {
    try {
      const saved = localStorage.getItem(`archery_watch_pairing_code_${uid}`) || "";
      if (/^[1-9]\d{5}$/.test(saved)) {
        startPhonePairingSnapshotListener(saved, uid);
      }
    } catch {}
  }

  if (!activePhonePairingCode) return;

  const isImmediateEvent =
    snapshot.sessionActive === false ||
    (snapshot.arrowsCount === 0 && lastPushedPhoneArrowsCount > 0);
  const elapsed = Date.now() - lastPhoneCloudPushMs;

  if (isImmediateEvent || elapsed >= 800) {
    flushPhoneSnapshotToCloudImmediate(snapshot, uid, activePhonePairingCode);
    return;
  }

  pendingPhoneCloudSnapshot = snapshot;
  if (!phoneCloudThrottleTimer) {
    const waitMs = Math.max(80, 800 - elapsed);
    phoneCloudThrottleTimer = setTimeout(() => {
      phoneCloudThrottleTimer = null;
      const latest = pendingPhoneCloudSnapshot;
      pendingPhoneCloudSnapshot = null;
      const currentUid = auth.currentUser?.uid || "";
      if (latest && currentUid && activePhonePairingCode) {
        flushPhoneSnapshotToCloudImmediate(latest, currentUid, activePhonePairingCode);
      }
    }, waitMs);
  }
}

export function getActiveWatchClientPairingCode(): string {
  if (activeWatchClientCode) return activeWatchClientCode;
  if (typeof window === "undefined") return "";
  try {
    const saved = localStorage.getItem(WATCH_CLIENT_CODE_KEY) || "";
    if (/^[1-9]\d{5}$/.test(saved)) return saved;
  } catch {}
  return "";
}

export function disconnectWatchClientPairingCode(): void {
  if (watchClientUnsubscribe) {
    try {
      watchClientUnsubscribe();
    } catch {}
    watchClientUnsubscribe = null;
  }
  activeWatchClientCode = "";
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(WATCH_CLIENT_CODE_KEY);
    }
  } catch {}
  notifyCloudPairingStatus({
    pairingCode: "",
    cloudConnected: false,
    watchLinked: false,
    watchSource: null
  });
}

function mapCloudDocToSnapshot(data: Record<string, any>): BiometricSessionSnapshot {
  const totalEnds = Math.max(1, Number(data.totalEnds) || 12);
  const currentEnd = Math.max(1, Number(data.currentEnd) || 1);
  const walkedM = Math.max(
    0,
    Math.round(Math.max(Number(data.distanceWalkedM) || 0, Number(data.watchDistanceM) || 0))
  );
  const steps = Math.max(
    0,
    Math.round(Math.max(Number(data.stepsCount) || 0, Number(data.watchStepsCount) || 0))
  );
  return {
    sessionId: String(data.sessionId || "WATCH-CLOUD"),
    sessionActive: data.sessionActive !== false,
    arrowsCount: Math.max(0, Number(data.arrowsCount) || 0),
    totalScore: Math.max(0, Number(data.totalScore) || 0),
    distanceM: Math.max(5, Number(data.distanceM) || 18),
    arrowsPerEnd: Math.max(1, Number(data.arrowsPerEnd) || 6),
    endsCount: totalEnds,
    completedEnds: Math.max(0, currentEnd - 1),
    currentEndIndex: Math.max(0, currentEnd - 1),
    currentEndArrows: Array.isArray(data.currentEndArrows)
      ? data.currentEndArrows.map((x: any) => String(x))
      : [],
    stepsCount: steps,
    gpsDistanceM: walkedM,
    distanceWalkedM: walkedM,
    gpsActive: true,
    activeKcal: Math.max(0, Math.round(Number(data.caloriesBurnedKcal) || 0)),
    bowPoundageLbs: Math.max(10, Number(data.bowPoundageLbs) || 36),
    practiceType: String(data.practiceType || "Práctica"),
    bowType: "Compound",
    autoDetectEnabled: data.autoDetectEnabled !== false,
    sensitivityLevel:
      data.sensitivityLevel === 0 || data.sensitivityLevel === 1 || data.sensitivityLevel === 2
        ? data.sensitivityLevel
        : 1,
    updatedAt: Number(data.updatedAt) || Date.now()
  };
}

/**
 * Connects a standalone `/watch` browser companion to `watch_sessions/{code}` in real time.
 */
export async function connectWatchClientToPairingCode(
  code: string
): Promise<{ ok: boolean; snapshot?: BiometricSessionSnapshot; error?: string }> {
  const cleanCode = String(code || "").replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9]\d{5}$/.test(cleanCode)) {
    return { ok: false, error: "Ingresa un código válido de 6 dígitos" };
  }

  const sessionRef = doc(db, "watch_sessions", cleanCode);
  let initialSnapshot: BiometricSessionSnapshot | undefined;

  try {
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) {
      return { ok: false, error: "Código no encontrado. Abre el panel Reloj en tu teléfono." };
    }
    initialSnapshot = mapCloudDocToSnapshot(snap.data() || {});
  } catch {
    return { ok: false, error: "Sin conexión para verificar el código." };
  }

  if (watchClientUnsubscribe) {
    try {
      watchClientUnsubscribe();
    } catch {}
    watchClientUnsubscribe = null;
  }

  activeWatchClientCode = cleanCode;
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(WATCH_CLIENT_CODE_KEY, cleanCode);
    }
  } catch {}

  if (initialSnapshot) {
    try {
      localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(initialSnapshot));
    } catch {}
    dispatchWatchCommandInternal({ type: "STATE_UPDATE", payload: initialSnapshot });
  }

  try {
    await updateDoc(sessionRef, {
      watchSource: "WEB_WATCH",
      updatedAt: Date.now()
    });
  } catch {}

  notifyCloudPairingStatus({
    pairingCode: cleanCode,
    cloudConnected: true,
    watchLinked: true,
    watchSource: "WEB_WATCH",
    lastCloudSyncAt: Date.now(),
    lastWatchSeenAt: Date.now()
  });

  watchClientUnsubscribe = onSnapshot(
    sessionRef,
    (snap) => {
      if (!snap.exists()) return;
      const mapped = mapCloudDocToSnapshot(snap.data() || {});
      if (mapped.sessionActive === false) {
        latestWatchClientSteps = 0;
        latestWatchClientDistM = 0;
      }
      try {
        localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(mapped));
      } catch {}
      notifyCloudPairingStatus({
        pairingCode: cleanCode,
        cloudConnected: true,
        watchLinked: true,
        watchSource: "WEB_WATCH",
        lastCloudSyncAt: Date.now(),
        lastWatchSeenAt: Date.now()
      });
      nativeWatchListeners.forEach((listener) => {
        try {
          listener({ type: "STATE_UPDATE", payload: mapped });
        } catch {}
      });
    },
    () => {
      notifyCloudPairingStatus({ cloudConnected: false, watchLinked: false });
    }
  );

  return { ok: true, snapshot: initialSnapshot };
}

/**
 * Broadcasts or persists Smartwatch state updates so open smartwatches (Wear OS, Connect IQ, WatchOS, Web Watch)
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
    // Notify native Android Wear OS bridge or Apple iOS WKWebView WatchConnectivity bridge
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(serialized);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(serialized);
    }
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "onSessionTelemetryUpdate", payload: serialized });
    }
  } catch {}

  schedulePhoneCloudWatchPush(snapshot);
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
  watchClientCmdSeq += 1;
  const now = Date.now();
  const cmdId = `wcmd-${now}-${watchClientCmdSeq}`;
  const enrichedObj: WatchCommandPayload = {
    ...cmd,
    cmdId,
    _cmdId: cmdId,
    cmdSeq: watchClientCmdSeq,
    _cmdSeq: watchClientCmdSeq,
    _ts: now
  };
  const payload = JSON.stringify(enrichedObj);

  // Pre-register our own outgoing cmdId so local BroadcastChannel/Cloud echo won't double-fire
  recordSeenCmdId(cmdId);

  try {
    localStorage.setItem(WATCH_CMD_STORAGE_KEY, payload);
  } catch {}
  try {
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel(WATCH_CHANNEL_NAME);
      ch.postMessage(enrichedObj);
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
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "sendWatchCommand", payload });
    }
  } catch {}

  // Route standalone /watch commands over 6-Digit Cloud Watch Sync when linked
  if (activeWatchClientCode && cmd.type !== "REQUEST_STATE" && cmd.type !== "STATE_UPDATE") {
    if (cmd.type === "SYNC_TELEMETRY_FROM_WATCH") {
      const st = cmd.stepsCount ?? cmd.payload?.stepsCount;
      const dm = cmd.distanceWalkedM ?? cmd.payload?.distanceWalkedM;
      if (typeof st === "number") latestWatchClientSteps = Math.max(0, Math.round(st));
      if (typeof dm === "number") latestWatchClientDistM = Math.max(0, Math.round(dm));
    }
    updateDoc(doc(db, "watch_sessions", activeWatchClientCode), {
      lastWatchCmd: JSON.parse(payload),
      lastWatchCmdId: cmdId,
      lastWatchCmdSeq: watchClientCmdSeq,
      watchStepsCount: latestWatchClientSteps,
      watchDistanceM: latestWatchClientDistM,
      watchSource: "WEB_WATCH",
      updatedAt: now
    }).catch(() => {});
  }
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
        const parsed = JSON.parse(e.newValue) as WatchCommandPayload;
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
  (window as any).__archeryWatchListenerReady = true;

  // Immediately flush any commands buffered in JS before this listener mounted
  if (pendingIncomingWatchMessages.length > 0) {
    const buffered = pendingIncomingWatchMessages.splice(0, pendingIncomingWatchMessages.length);
    buffered.forEach((cmd) => {
      try {
        onMessage(cmd);
      } catch {}
    });
  }

  // Notify native Android / iOS bridges that JS listener is ready and flush any natively queued commands
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.notifyWatchListenerReady) {
      bridge.notifyWatchListenerReady();
    } else if (bridge?.flushPendingWatchCommands) {
      bridge.flushPendingWatchCommands();
    }
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "notifyWatchListenerReady" });
      iosHandler.postMessage({ action: "flushPendingWatchCommands" });
    }
  } catch {}

  return () => {
    window.removeEventListener("storage", handleStorage);
    nativeWatchListeners.delete(onMessage);
    if (nativeWatchListeners.size === 0 && typeof window !== "undefined") {
      // Keep __onNativeWatchMessage active so incoming commands go into pendingIncomingWatchMessages
      ensureGlobalNativeWatchDispatcher();
    }
    if (channel) {
      try {
        channel.close();
      } catch {}
    }
  };
}

function parseWatchStatusPayload(raw: any): WatchConnectionStatus {
  const iosBridgeAvailable = hasIosWatchBridge();
  const androidBridge =
    typeof window !== "undefined" ? (window as any).ArcheryWatchNativeBridge : null;
  const isNativeAndroid =
    !iosBridgeAvailable &&
    typeof window !== "undefined" &&
    Boolean(androidBridge || (window as any).ArcheryNativeAuth);

  if (!androidBridge && !iosBridgeAvailable && !raw) {
    return {
      isNativeAndroid: false,
      isNativeIos: false,
      bridgeReady: false,
      connectedNodesCount: 0,
      connectedNodes: [],
      lastMessageAt: 0,
      lastPongAt: 0,
      hasCachedState: false
    };
  }

  if (!raw && iosBridgeAvailable && lastIosWatchStatus) {
    return lastIosWatchStatus;
  }

  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw || {};
    const isNativeIos = Boolean(obj.isNativeIos) || (iosBridgeAvailable && !androidBridge);
    const nodes = Array.isArray(obj.connectedNodes) ? obj.connectedNodes : [];
    const parsedStatus: WatchConnectionStatus = {
      isNativeAndroid: isNativeIos ? false : Boolean(obj.isNativeAndroid ?? isNativeAndroid),
      isNativeIos,
      bridgeReady: true,
      nativeVersion: obj.nativeVersion || "2.88+",
      connectedNodesCount:
        typeof obj.connectedNodesCount === "number" ? obj.connectedNodesCount : nodes.length,
      connectedNodes: nodes,
      watchAppInstalledCount:
        typeof obj.watchAppInstalledCount === "number"
          ? obj.watchAppInstalledCount
          : isNativeIos
          ? typeof obj.connectedNodesCount === "number"
            ? obj.connectedNodesCount
            : nodes.length
          : undefined,
      lastMessageAt: Number(obj.lastMessageAt) || 0,
      lastPongAt: Number(obj.lastPongAt) || 0,
      hasCachedState: Boolean(obj.hasCachedState)
    };
    if (isNativeIos) {
      lastIosWatchStatus = parsedStatus;
    }
    return parsedStatus;
  } catch {
    return {
      isNativeAndroid,
      isNativeIos: iosBridgeAvailable,
      bridgeReady: Boolean(androidBridge || iosBridgeAvailable),
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
      isNativeIos: false,
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
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "requestStatus" });
      return lastIosWatchStatus || parseWatchStatusPayload({ isNativeIos: true });
    }
  } catch {}
  return parseWatchStatusPayload(null);
}

/**
 * Opens the app store listing of the companion watch app directly on the paired watch.
 * Returns false when the native bridge does not support it (web / older builds).
 */
export function installAppOnWatch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.installAppOnWatch) {
      bridge.installAppOnWatch();
      return true;
    }
  } catch {}
  return false;
}

export function pingNativeWatch(): void {
  if (typeof window === "undefined") return;
  try {
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.pingWatch) {
      bridge.pingWatch();
    }
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "pingWatch" });
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
