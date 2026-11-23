"use client";

import { db, auth } from "@/lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  Timestamp,
  Unsubscribe
} from "firebase/firestore";
import { getSessionArrows, getSessionHeartRateStats } from "./sessionMetrics";
export { getSessionHeartRateStats };

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
  heartRateBpm?: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  bowPoundageLbs: number;
  practiceType: string;
  bowType: string;
  autoDetectEnabled: boolean;
  sensitivityLevel?: 0 | 1 | 2;
  analysisMode?: boolean;
  analysisCalibrationJson?: string;
  lastShotTimestamp?: number;
  updatedAt: number;
}

export type WatchCommandMessage =
  | { type: "STATE_UPDATE"; payload: BiometricSessionSnapshot }
  | {
      type: "INCREMENT_ARROW";
      delta: number;
      targetArrowsCount?: number;
      source: "watch_manual" | "watch_auto" | "phone";
    }
  | {
      type: "DECREMENT_ARROW";
      delta?: number;
      targetArrowsCount?: number;
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
      payload?: {
        stepsCount?: number;
        distanceWalkedM?: number;
        activeKcal?: number;
        heartRateBpm?: number;
        avgHeartRateBpm?: number;
        maxHeartRateBpm?: number;
      };
      stepsCount?: number;
      distanceWalkedM?: number;
      activeKcal?: number;
      heartRateBpm?: number;
      avgHeartRateBpm?: number;
      maxHeartRateBpm?: number;
    }
  | { type: "TOGGLE_AUTO_DETECT"; enabled: boolean; sensitivityLevel?: 0 | 1 | 2 }
  | { type: "ANALYSIS_SHOT"; analysisShotJson: string; heartRateBpm?: number }
  | { type: "ANALYSIS_MANUAL_START"; ts?: number; source?: string }
  | { type: "ANALYSIS_MANUAL_STOP"; ts?: number; source?: string }
  | { type: "ANALYSIS_MANUAL_CAPTURE" }
  | { type: "ANALYSIS_CALIBRATE_ZERO" }
  | {
      type: "ANALYSIS_ZERO_VECTOR";
      zeroGravityVec?: [number, number, number];
      analysisShotJson?: string;
    }
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
  cloudSyncError?: string;
  watchLinked: boolean;
  watchSource: string | null;
  lastCloudSyncAt: number;
  lastWatchSeenAt: number;
}

const WATCH_CHANNEL_NAME = "archery_101010_watch_bridge_v1";
const WATCH_STORAGE_KEY = "archery_101010_watch_state_v1";
const WATCH_CMD_STORAGE_KEY = "archery_101010_watch_cmd_v1";
const WATCH_CLIENT_CODE_KEY = "archery_watch_client_pairing_code";
const PENDING_WATCH_CMDS_SESSION_KEY = "archery_pending_watch_cmds";
const PENDING_WATCH_CMD_TTL_MS = 60_000;

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
  const strideM = parsedHeight >= 100 && parsedHeight <= 230 ? (parsedHeight * 0.42) / 100 : 0.78;
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

const watchCommandListeners = new Set<(msg: WatchCommandMessage) => void>();
const seenNativeCmdIds = new Set<string>();
const pendingWatchCommands: WatchCommandPayload[] = [];
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
let lastCloudTelemetryLiveHr = 0;
let lastCloudTelemetryAvgHr = 0;
let lastCloudTelemetryMaxHr = 0;
let watchHrSum = 0;
let watchHrCount = 0;
let lastWatchHrSampleKey = "";
let activeWatchHrSessionId = "";
let lastObservedWatchHeartbeatAt = 0;

// Standalone /watch client Cloud Sync state
let activeWatchClientCode = "";
let watchClientUnsubscribe: Unsubscribe | null = null;
let watchClientCmdSeq = 0;
let latestWatchClientSteps = 0;
let latestWatchClientDistM = 0;

let cloudPairingStatusState: CloudWatchPairingStatus = {
  pairingCode: "",
  cloudConnected: false,
  cloudSyncError: "",
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

function getWatchCmdTimestampMs(cmd: WatchCommandPayload): number {
  const rawTs = Number((cmd as any)?._ts || (cmd as any)?.ts || 0);
  return Number.isFinite(rawTs) && rawTs > 0 ? rawTs : 0;
}

function persistPendingWatchCommandsToSession(): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    for (let i = pendingWatchCommands.length - 1; i >= 0; i--) {
      const ts = getWatchCmdTimestampMs(pendingWatchCommands[i]);
      if (!ts || now - ts >= PENDING_WATCH_CMD_TTL_MS) {
        pendingWatchCommands.splice(i, 1);
      }
    }
    if (pendingWatchCommands.length === 0) {
      sessionStorage.removeItem(PENDING_WATCH_CMDS_SESSION_KEY);
    } else {
      sessionStorage.setItem(
        PENDING_WATCH_CMDS_SESSION_KEY,
        JSON.stringify(pendingWatchCommands)
      );
    }
  } catch {}
}

function rehydratePendingWatchCommandsFromSession(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(PENDING_WATCH_CMDS_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      sessionStorage.removeItem(PENDING_WATCH_CMDS_SESSION_KEY);
      return;
    }
    const now = Date.now();
    let mutated = false;
    for (const item of parsed) {
      if (!item || typeof item !== "object" || !item.type || item.type === "REQUEST_STATE") {
        mutated = true;
        continue;
      }
      const ts = getWatchCmdTimestampMs(item as WatchCommandPayload);
      if (!ts || now - ts >= PENDING_WATCH_CMD_TTL_MS) {
        mutated = true;
        continue;
      }
      const cmdId = String(item.cmdId || item._cmdId || "");
      if (cmdId) {
        recordSeenCmdId(cmdId);
        const alreadyQueued = pendingWatchCommands.some(
          (existing) => (existing.cmdId || existing._cmdId) === cmdId
        );
        if (alreadyQueued) continue;
      }
      if (pendingWatchCommands.length >= 100) {
        pendingWatchCommands.shift();
      }
      pendingWatchCommands.push(item as WatchCommandPayload);
    }
    if (mutated) {
      persistPendingWatchCommandsToSession();
    }
  } catch {}
}

function bufferIncomingWatchCommand(cmd: WatchCommandPayload): void {
  const now = Date.now();
  const stamped: WatchCommandPayload = {
    ...cmd,
    _ts: getWatchCmdTimestampMs(cmd) || now
  };
  const cmdId = String(stamped.cmdId || stamped._cmdId || "");
  if (cmdId) {
    const alreadyBuffered = pendingWatchCommands.some(
      (item) => (item.cmdId || item._cmdId) === cmdId
    );
    if (alreadyBuffered) return;
  }
  if (pendingWatchCommands.length >= 100) {
    pendingWatchCommands.shift();
  }
  pendingWatchCommands.push(stamped);
  persistPendingWatchCommandsToSession();
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

    if (watchCommandListeners.size === 0) {
      if (parsed.type !== "REQUEST_STATE") {
        bufferIncomingWatchCommand(parsed);
      }
      return "DELIVERED";
    }

    watchCommandListeners.forEach((listener) => {
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
  (window as any).__archeryWatchListenerReady = watchCommandListeners.size > 0;
}

if (typeof window !== "undefined") {
  rehydratePendingWatchCommandsFromSession();
  ensureGlobalNativeWatchDispatcher();
}

const WATCH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildPhoneCloudSessionFields(
  snapshot: BiometricSessionSnapshot | null,
  uid: string
): Record<string, any> {
  const s = snapshot || readStoredWatchState();
  const endsCount = Math.round(clampNum(s?.endsCount, 12, 1, 1000));
  const arrowsPerEnd = Math.round(clampNum(s?.arrowsPerEnd, 6, 1, 100));
  const currentEnd = Math.round(clampNum((Number(s?.currentEndIndex) || 0) + 1, 1, 1, 1000));
  const currentEndArrows = Array.isArray(s?.currentEndArrows)
    ? s!.currentEndArrows!.slice(0, 12).map((v) => String(v))
    : [];
  const sensitivityLevel: 0 | 1 | 2 =
    s?.sensitivityLevel === 0 || s?.sensitivityLevel === 1 || s?.sensitivityLevel === 2
      ? s.sensitivityLevel
      : getSavedSensitivityLevel();
  const now = Date.now();
  const expiresAtMs = now + WATCH_SESSION_TTL_MS;

  return {
    userId: String(uid).slice(0, 128),
    sessionId: String(s?.sessionId || "LIVE").slice(0, 128),
    sessionActive: s ? s.sessionActive !== false : true,
    arrowsCount: Math.round(clampNum(s?.arrowsCount, 0, 0, 10000)),
    totalScore: Math.round(clampNum(s?.totalScore, 0, 0, 100000)),
    roundScoreMax: Math.round(clampNum(endsCount * arrowsPerEnd * 10, 720, 0, 100000)),
    distanceM: Math.round(clampNum(s?.distanceM, 18, 0, 500)),
    arrowsPerEnd,
    currentEnd,
    totalEnds: endsCount,
    currentEndArrows,
    stepsCount: Math.round(clampNum(s?.stepsCount, 0, 0, 1000000)),
    distanceWalkedM: Math.round(clampNum(s?.distanceWalkedM, 0, 0, 1000000)),
    caloriesBurnedKcal: Math.round(clampNum(s?.activeKcal, 0, 0, 100000)),
    autoDetectEnabled: false,
    sensitivityLevel,
    bowPoundageLbs: Math.round(clampNum(s?.bowPoundageLbs, 36, 10, 200)),
    bowType: String(s?.bowType || "Recurve").slice(0, 40),
    practiceType: String(s?.practiceType || "Práctica").slice(0, 60),
    analysisMode: Boolean(s?.analysisMode || s?.practiceType === "Análisis"),
    ...(typeof s?.analysisCalibrationJson === "string"
      ? { analysisCalibrationJson: s.analysisCalibrationJson.slice(0, 950) }
      : {}),
    updatedAt: now,
    expiresAt: expiresAtMs,
    expireAt: Timestamp.fromMillis(expiresAtMs)
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
  lastObservedWatchHeartbeatAt = 0;
  let isInitialSnapshot = true;

  notifyCloudPairingStatus({
    pairingCode: code
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
      const watchHeartbeatAt = Number(data.watchHeartbeatAt) || 0;
      const heartbeatChangedLive =
        !isInitialSnapshot && watchHeartbeatAt > 0 && watchHeartbeatAt !== lastObservedWatchHeartbeatAt;
      if (watchHeartbeatAt > 0) {
        lastObservedWatchHeartbeatAt = watchHeartbeatAt;
      }
      const heartbeatRecent =
        watchHeartbeatAt > 0 && Math.abs(now - watchHeartbeatAt) <= 5 * 60 * 1000;

      if (!cloudPairingStatusState.cloudConnected || cloudPairingStatusState.cloudSyncError) {
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          cloudSyncError: ""
        });
      }

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
        if (watchSource && heartbeatRecent) {
          notifyCloudPairingStatus({
            pairingCode: code,
            cloudConnected: true,
            cloudSyncError: "",
            watchLinked: true,
            watchSource,
            lastWatchSeenAt: now
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

      const docSessionId = typeof data.sessionId === "string" ? data.sessionId : "";
      if (
        data.sessionActive === false ||
        (docSessionId && activeWatchHrSessionId && docSessionId !== activeWatchHrSessionId)
      ) {
        watchHrSum = 0;
        watchHrCount = 0;
        lastWatchHrSampleKey = "";
        lastCloudTelemetryLiveHr = 0;
        lastCloudTelemetryAvgHr = 0;
        lastCloudTelemetryMaxHr = 0;
      }
      if (docSessionId && data.sessionActive !== false) {
        activeWatchHrSessionId = docSessionId;
      }

      const incomingSteps =
        typeof data.watchStepsCount === "number" ? Math.max(0, Math.round(data.watchStepsCount)) : -1;
      const incomingDistM =
        typeof data.watchDistanceM === "number" ? Math.max(0, Math.round(data.watchDistanceM)) : -1;
      const incomingHrBpm =
        typeof data.watchHeartRateBpm === "number" ? Math.max(0, Math.round(data.watchHeartRateBpm)) : 0;
      const rawWatchAvgHr =
        typeof data.watchAvgHeartRateBpm === "number"
          ? Math.max(0, Math.round(data.watchAvgHeartRateBpm))
          : 0;
      const rawWatchMaxHr =
        typeof data.watchMaxHeartRateBpm === "number"
          ? Math.max(0, Math.round(data.watchMaxHeartRateBpm))
          : 0;

      let incomingAvgHr = 0;
      if (rawWatchAvgHr >= 30 && rawWatchAvgHr <= 250) {
        incomingAvgHr = rawWatchAvgHr;
      } else if (data.sessionActive !== false && incomingHrBpm >= 30 && incomingHrBpm <= 250) {
        const sampleKey = `${watchHeartbeatAt}|${incomingCmdId}|${incomingHrBpm}`;
        if (sampleKey !== lastWatchHrSampleKey) {
          lastWatchHrSampleKey = sampleKey;
          watchHrSum += incomingHrBpm;
          watchHrCount += 1;
        }
        incomingAvgHr = watchHrCount > 0 ? Math.round(watchHrSum / watchHrCount) : 0;
      }
      const incomingMaxHr = Math.max(
        rawWatchMaxHr >= 30 && rawWatchMaxHr <= 250 ? rawWatchMaxHr : 0,
        incomingHrBpm >= 30 && incomingHrBpm <= 250 ? incomingHrBpm : 0,
        incomingAvgHr
      );

      const isFreshCloudWatchHr =
        data.sessionActive !== false &&
        incomingHrBpm >= 30 &&
        incomingHrBpm <= 245 &&
        (heartbeatChangedLive ||
          (watchHeartbeatAt > 0 && Math.abs(now - watchHeartbeatAt) <= 35_000) ||
          (docUpdatedAt > 0 && Math.abs(now - docUpdatedAt) <= 35_000 && Boolean(watchSource)));

      if (isFreshCloudWatchHr && typeof window !== "undefined") {
        const friendlyWatchName =
          watchSource === "WATCHOS"
            ? "Reloj Vinculado (Nube)"
            : watchSource === "GARMIN"
            ? "Reloj Deportivo (Nube)"
            : "Reloj Inteligente";
        try {
          (window as any).__onNativeWearHrUpdate?.({
            bpm: incomingHrBpm,
            status: "ok",
            deviceName: friendlyWatchName,
            nodeId: `cloud:${watchSource || "watch"}`
          });
        } catch {}
      }

      if (incomingSteps === 0 && incomingDistM === 0 && data.sessionActive === false) {
        lastCloudTelemetrySteps = 0;
        lastCloudTelemetryDistM = 0;
        lastCloudTelemetryLiveHr = 0;
        lastCloudTelemetryAvgHr = 0;
        lastCloudTelemetryMaxHr = 0;
        watchHrSum = 0;
        watchHrCount = 0;
        lastWatchHrSampleKey = "";
        activeWatchHrSessionId = "";
      } else if (
        (incomingSteps > lastCloudTelemetrySteps && incomingSteps > 0) ||
        (incomingDistM > lastCloudTelemetryDistM && incomingDistM > 0) ||
        (isFreshCloudWatchHr && incomingHrBpm !== lastCloudTelemetryLiveHr) ||
        (incomingAvgHr >= 30 &&
          incomingAvgHr <= 250 &&
          (incomingAvgHr !== lastCloudTelemetryAvgHr || incomingMaxHr > lastCloudTelemetryMaxHr))
      ) {
        if (incomingSteps > lastCloudTelemetrySteps) lastCloudTelemetrySteps = incomingSteps;
        if (incomingDistM > lastCloudTelemetryDistM) lastCloudTelemetryDistM = incomingDistM;
        if (isFreshCloudWatchHr) lastCloudTelemetryLiveHr = incomingHrBpm;
        if (incomingAvgHr >= 30 && incomingAvgHr <= 250) {
          lastCloudTelemetryAvgHr = incomingAvgHr;
        }
        if (incomingMaxHr >= 30 && incomingMaxHr <= 250 && incomingMaxHr > lastCloudTelemetryMaxHr) {
          lastCloudTelemetryMaxHr = incomingMaxHr;
        }
        const hrPatch =
          lastCloudTelemetryAvgHr >= 30
            ? {
                heartRateBpm: incomingHrBpm >= 30 ? incomingHrBpm : lastCloudTelemetryAvgHr,
                avgHeartRateBpm: lastCloudTelemetryAvgHr,
                maxHeartRateBpm: Math.max(lastCloudTelemetryAvgHr, lastCloudTelemetryMaxHr)
              }
            : {};
        dispatchWatchCommandInternal({
          type: "SYNC_TELEMETRY_FROM_WATCH",
          stepsCount: lastCloudTelemetrySteps,
          distanceWalkedM: lastCloudTelemetryDistM,
          ...hrPatch,
          payload: {
            stepsCount: lastCloudTelemetrySteps,
            distanceWalkedM: lastCloudTelemetryDistM,
            ...hrPatch
          }
        });
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          watchLinked: true,
          watchSource: watchSource || "CLOUD_WATCH",
          lastWatchSeenAt: now
        });
      } else if (watchSource && (heartbeatChangedLive || heartbeatRecent)) {
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          cloudSyncError: "",
          watchLinked: true,
          watchSource,
          lastWatchSeenAt: heartbeatChangedLive
            ? now
            : Math.max(cloudPairingStatusState.lastWatchSeenAt, watchHeartbeatAt > now ? now : watchHeartbeatAt)
        });
      } else if (
        cloudPairingStatusState.watchLinked &&
        watchHeartbeatAt > 0 &&
        Math.abs(now - watchHeartbeatAt) > 5 * 60 * 1000 &&
        now - cloudPairingStatusState.lastWatchSeenAt > 5 * 60 * 1000
      ) {
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          watchLinked: false
        });
      }
    },
    (err: any) => {
      notifyCloudPairingStatus({
        cloudConnected: false,
        cloudSyncError: String(err?.code || "LISTENER_ERROR")
      });
    }
  );
}

async function allocateFreshPairingCode(effectiveUid: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const existing = await getDoc(doc(db, "watch_sessions", candidate));
      if (!existing.exists() || existing.data()?.userId === effectiveUid) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function pushPairingCodeToNativeWatchBridge(code: string): void {
  if (typeof window === "undefined" || !/^[1-9]\d{5}$/.test(code)) return;
  try {
    const stored = readStoredWatchState();
    const payload = JSON.stringify({
      ...(stored || { sessionActive: true }),
      pairingCode: code,
      updatedAt: Date.now()
    });
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(payload);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(payload);
    }
  } catch {}
}

/**
 * Generates or restores the archer's 6-digit Cloud Watch Pairing Code (`100000`–`999999`),
 * persists `watch_sessions/{code}` in Firestore (auto-rotating if an old cached code is rejected
 * or expired), and listens in real time for Wear OS / Connect IQ / Web Watch commands.
 */
export async function getOrCreatePhoneWatchPairingCode(
  uid?: string,
  forceRegenerate: boolean = false
): Promise<string> {
  if (typeof window === "undefined") return "";
  const authUid = auth.currentUser?.uid || "";
  const effectiveUid = authUid || (uid && uid !== "USR-GUEST-OFFLINE" ? uid : "");
  if (!effectiveUid || !authUid) {
    notifyCloudPairingStatus({
      cloudConnected: false,
      cloudSyncError: "AUTH_REQUIRED"
    });
    return "";
  }

  const storageKey = `archery_watch_pairing_code_${effectiveUid}`;
  let code = "";
  let isFreshAllocation = false;
  if (!forceRegenerate) {
    try {
      const saved = localStorage.getItem(storageKey) || "";
      if (/^[1-9]\d{5}$/.test(saved)) {
        code = saved;
      }
    } catch {}
  }

  if (!code) {
    code = await allocateFreshPairingCode(effectiveUid);
    isFreshAllocation = true;
    try {
      localStorage.setItem(storageKey, code);
    } catch {}
  }

  const payload = buildPhoneCloudSessionFields(readStoredWatchState(), effectiveUid);
  let persisted = false;
  let lastErrorCode = "";

  try {
    if (isFreshAllocation || forceRegenerate) {
      await setDoc(doc(db, "watch_sessions", code), payload);
    } else {
      await setDoc(doc(db, "watch_sessions", code), payload, { merge: true });
    }
    persisted = true;
  } catch (err: any) {
    lastErrorCode = String(err?.code || err?.message || "SYNC_FAILED");
    // Self-heal: if an old localStorage code expired, collided, or had legacy fields rejected by
    // Firestore Rules, automatically rotate to a clean brand-new 6-digit code!
    for (let retry = 0; retry < 2 && !persisted; retry++) {
      try {
        const rotated = await allocateFreshPairingCode(effectiveUid);
        const cleanPayload = buildPhoneCloudSessionFields(readStoredWatchState(), effectiveUid);
        await setDoc(doc(db, "watch_sessions", rotated), cleanPayload);
        code = rotated;
        persisted = true;
        lastErrorCode = "";
        try {
          localStorage.setItem(storageKey, code);
        } catch {}
      } catch (retryErr: any) {
        lastErrorCode = String(retryErr?.code || retryErr?.message || "SYNC_FAILED");
      }
    }
  }

  if (persisted) {
    notifyCloudPairingStatus({
      pairingCode: code,
      cloudConnected: true,
      cloudSyncError: "",
      watchLinked: forceRegenerate ? false : cloudPairingStatusState.watchLinked,
      lastCloudSyncAt: Date.now()
    });
    pushPairingCodeToNativeWatchBridge(code);
  } else {
    notifyCloudPairingStatus({
      pairingCode: code,
      cloudConnected: false,
      cloudSyncError: lastErrorCode || "SYNC_FAILED"
    });
  }

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
    fields.watchHeartRateBpm = 0;
    fields.watchAvgHeartRateBpm = 0;
    fields.watchMaxHeartRateBpm = 0;
    lastCloudTelemetrySteps = 0;
    lastCloudTelemetryDistM = 0;
    lastCloudTelemetryAvgHr = 0;
    lastCloudTelemetryMaxHr = 0;
    watchHrSum = 0;
    watchHrCount = 0;
    lastWatchHrSampleKey = "";
    activeWatchHrSessionId = "";
  }

  setDoc(doc(db, "watch_sessions", code), fields, { merge: true })
    .then(() => {
      notifyCloudPairingStatus({ lastCloudSyncAt: Date.now(), cloudConnected: true });
    })
    .catch(() => {});
}

let lastPushedAnalysisCalSig = "";

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

  const nextCalSig = `${Boolean(snapshot.analysisMode)}|${snapshot.analysisCalibrationJson || ""}`;
  const calChanged = nextCalSig !== lastPushedAnalysisCalSig;
  if (calChanged) {
    lastPushedAnalysisCalSig = nextCalSig;
  }

  const isImmediateEvent =
    calChanged ||
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
    ...(Number(data.watchHeartRateBpm) >= 30 && Number(data.watchHeartRateBpm) <= 245
      ? { heartRateBpm: Math.round(Number(data.watchHeartRateBpm)) }
      : {}),
    bowPoundageLbs: Math.max(10, Number(data.bowPoundageLbs) || 36),
    practiceType: String(data.practiceType || "Práctica"),
    bowType: String(data.bowType || "Compound"),
    autoDetectEnabled: data.autoDetectEnabled !== false,
    analysisMode: Boolean(data.analysisMode || data.practiceType === "Análisis"),
    ...(typeof data.analysisCalibrationJson === "string"
      ? { analysisCalibrationJson: data.analysisCalibrationJson }
      : {}),
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
  } catch (err: any) {
    const isPermDenied =
      err?.code === "permission-denied" ||
      String(err?.message || "").toLowerCase().includes("missing or insufficient permissions");
    if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
      return {
        ok: false,
        error: "Código no encontrado o expirado. Abre Vincular Reloj en tu teléfono."
      };
    }
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
    const hbNow = Date.now();
    await updateDoc(sessionRef, {
      watchSource: "WEB_WATCH",
      watchHeartbeatAt: hbNow,
      updatedAt: hbNow
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
      watchCommandListeners.forEach((listener) => {
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
    // Notify native Android Wear OS bridge or iOS WKWebView WatchConnectivity bridge
    const nativePayload =
      activePhonePairingCode && /^[1-9]\d{5}$/.test(activePhonePairingCode)
        ? JSON.stringify({ ...snapshot, pairingCode: activePhonePairingCode })
        : serialized;
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(nativePayload);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(nativePayload);
    }
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "onSessionTelemetryUpdate", payload: nativePayload });
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

function buildCompactCloudWatchCmd(
  cmd: WatchCommandMessage,
  cmdId: string,
  now: number
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    type: String(cmd.type || "").slice(0, 40),
    cmdId: String(cmdId || "").slice(0, 64),
    _ts: now
  };

  if (cmd.type === "INCREMENT_ARROW" || cmd.type === "DECREMENT_ARROW") {
    if (typeof cmd.delta === "number") out.delta = Math.round(cmd.delta);
    if (typeof cmd.source === "string") out.source = cmd.source.slice(0, 24);
    if ("totalScore" in cmd && typeof cmd.totalScore === "number") {
      out.totalScore = Math.max(0, Math.round(cmd.totalScore));
    }
  } else if (cmd.type === "UNDO_ARROW") {
    if (typeof cmd.totalScore === "number") {
      out.totalScore = Math.max(0, Math.round(cmd.totalScore));
    }
  } else if (cmd.type === "SET_SENSITIVITY") {
    out.sensitivityLevel = cmd.sensitivityLevel;
  } else if (cmd.type === "SCORE_INPUT") {
    const val = cmd.payload?.value ?? cmd.value;
    const tot = cmd.payload?.totalScore ?? cmd.totalScore;
    if (val !== undefined) out.value = String(val).slice(0, 12);
    if (typeof tot === "number") out.totalScore = Math.max(0, Math.round(tot));
  } else if (cmd.type === "SYNC_TELEMETRY_FROM_WATCH") {
    const st = cmd.stepsCount ?? cmd.payload?.stepsCount;
    const dm = cmd.distanceWalkedM ?? cmd.payload?.distanceWalkedM;
    const kc = cmd.activeKcal ?? cmd.payload?.activeKcal;
    if (typeof st === "number") out.stepsCount = Math.max(0, Math.round(st));
    if (typeof dm === "number") out.distanceWalkedM = Math.max(0, Math.round(dm));
    if (typeof kc === "number") out.activeKcal = Math.max(0, Math.round(kc));
  } else if (cmd.type === "TOGGLE_AUTO_DETECT") {
    out.enabled = Boolean(cmd.enabled);
    if (typeof cmd.sensitivityLevel === "number") out.sensitivityLevel = cmd.sensitivityLevel;
  } else if (cmd.type === "ANALYSIS_SHOT") {
    if (typeof cmd.analysisShotJson === "string") {
      out.analysisShotJson = cmd.analysisShotJson.slice(0, 3400);
    }
    if (typeof cmd.heartRateBpm === "number" && cmd.heartRateBpm >= 30 && cmd.heartRateBpm <= 250) {
      out.heartRateBpm = Math.round(cmd.heartRateBpm);
    }
  } else if (cmd.type === "ANALYSIS_MANUAL_START" || cmd.type === "ANALYSIS_MANUAL_STOP") {
    if (typeof cmd.ts === "number" && cmd.ts > 0) {
      out.ts = Math.round(cmd.ts);
    }
    if (typeof cmd.source === "string") {
      out.source = cmd.source.slice(0, 32);
    }
  } else if (cmd.type === "ANALYSIS_ZERO_VECTOR") {
    if (Array.isArray(cmd.zeroGravityVec) && cmd.zeroGravityVec.length === 3) {
      out.analysisShotJson = JSON.stringify(
        cmd.zeroGravityVec.map((n) => Number((Number(n) || 0).toFixed(3)))
      );
    } else if (typeof cmd.analysisShotJson === "string") {
      out.analysisShotJson = cmd.analysisShotJson.slice(0, 240);
    }
  }

  const bounded: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(out).slice(0, 8)) {
    const maxLen = k === "analysisShotJson" ? 3400 : 64;
    bounded[k.slice(0, 32)] = typeof v === "string" ? v.slice(0, maxLen) : v;
  }
  return bounded;
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
      lastWatchCmd: buildCompactCloudWatchCmd(cmd, cmdId, now),
      lastWatchCmdId: cmdId.slice(0, 64),
      lastWatchCmdSeq: watchClientCmdSeq,
      watchStepsCount: latestWatchClientSteps,
      watchDistanceM: latestWatchClientDistM,
      watchSource: "WEB_WATCH",
      watchHeartbeatAt: now,
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
  watchCommandListeners.add(onMessage);
  ensureGlobalNativeWatchDispatcher();
  (window as any).__archeryWatchListenerReady = watchCommandListeners.size > 0;

  // Rehydrate & immediately flush any non-expired (< 60_000ms) commands buffered before this listener mounted
  rehydratePendingWatchCommandsFromSession();
  if (pendingWatchCommands.length > 0 && watchCommandListeners.size > 0) {
    const now = Date.now();
    const buffered = pendingWatchCommands.splice(0, pendingWatchCommands.length);
    let deliveredToActiveListener = false;
    buffered.forEach((cmd) => {
      const ts = getWatchCmdTimestampMs(cmd);
      if (ts && now - ts < PENDING_WATCH_CMD_TTL_MS) {
        try {
          onMessage(cmd);
          deliveredToActiveListener = true;
        } catch {}
      }
    });
    if (deliveredToActiveListener || pendingWatchCommands.length === 0) {
      try {
        sessionStorage.removeItem(PENDING_WATCH_CMDS_SESSION_KEY);
      } catch {}
    }
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
    watchCommandListeners.delete(onMessage);
    if (typeof window !== "undefined") {
      (window as any).__archeryWatchListenerReady = watchCommandListeners.size > 0;
      if (watchCommandListeners.size === 0) {
        // Keep __onNativeWatchMessage active so incoming commands go into pendingWatchCommands + sessionStorage
        ensureGlobalNativeWatchDispatcher();
      }
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
