"use client";

import { db, auth } from "../firebase.ts";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  type Unsubscribe
} from "firebase/firestore";
import { getSessionArrows, getSessionHeartRateStats } from "./sessionMetrics.ts";
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
const WATCH_CLIENT_SESSION_KEY = "archery_watch_client_session_v2";
const WATCH_CLIENT_DEVICE_ID_KEY = "archery_watch_client_device_id";
const PENDING_WATCH_CMDS_SESSION_KEY = "archery_pending_watch_cmds";
const PENDING_WATCH_CMD_TTL_MS = 60_000;
const WATCH_PAIRING_OPEN_MS = 115_000;
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const PAIRING_CODE_RE = /^[0-9]{6}$/;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256PureJsBytes(bytes: Uint8Array): string {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bitLen = bytes.length * 8;
  const padLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, "0"))
    .join("")
    .toLowerCase();
}

export async function computeWatchOwnerHash(uid: string): Promise<string> {
  const bytes = new TextEncoder().encode(String(uid || ""));
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    try {
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase();
    } catch {
      return sha256PureJsBytes(bytes);
    }
  }
  return sha256PureJsBytes(bytes);
}

export function generateWatchSessionToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function getOrCreateWatchClientDeviceId(): string {
  if (typeof window === "undefined") {
    return `webw-${generateWatchSessionToken().slice(0, 24)}`;
  }
  try {
    const existing = (localStorage.getItem(WATCH_CLIENT_DEVICE_ID_KEY) || "").trim();
    if (/^[A-Za-z0-9_:-]{6,80}$/.test(existing)) {
      return existing;
    }
  } catch {}
  const generated = `webw-${generateWatchSessionToken().slice(0, 24)}`;
  try {
    localStorage.setItem(WATCH_CLIENT_DEVICE_ID_KEY, generated);
  } catch {}
  return generated;
}

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
let activePhoneSessionToken = "";
let activePhoneOwnerHash = "";
let activePhonePairingCreatedAt = 0;
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
let lastKnownCloudWatchHr: {
  bpm: number;
  avgBpm: number;
  maxBpm: number;
  deviceName: string;
  nodeId: string;
  at: number;
} | null = null;

// Standalone /watch client Cloud Sync state
let activeWatchClientCode = "";
let activeWatchClientSessionToken = "";
let activeWatchClientDeviceId = "";
let watchClientUnsubscribe: Unsubscribe | null = null;
let watchClientCmdSeq = 0;
let latestWatchClientSteps = 0;
let latestWatchClientDistM = 0;
let latestWatchClientKcal = 0;

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

export function shouldAcceptCloudWatchHeartRate(
  data: Record<string, any> | null | undefined,
  nowMs: number = Date.now(),
  heartbeatChangedLive: boolean = false
): boolean {
  if (!data || typeof data !== "object") return false;
  const rawBpm =
    typeof data.watchHeartRateBpm === "number" && data.watchHeartRateBpm > 0
      ? Math.round(data.watchHeartRateBpm)
      : typeof data.lastWatchCmd?.heartRateBpm === "number" && data.lastWatchCmd.heartRateBpm > 0
      ? Math.round(data.lastWatchCmd.heartRateBpm)
      : 0;
  if (rawBpm < 30 || rawBpm > 245) return false;
  if (heartbeatChangedLive) return true;
  const hb = Number(data.watchHeartbeatAt) || 0;
  if (hb > 0 && Math.abs(nowMs - hb) <= 90_000) return true;
  const upd = Number(data.updatedAt) || 0;
  const hasWatchSource = typeof data.watchSource === "string" && data.watchSource.length > 0;
  return hasWatchSource && upd > 0 && Math.abs(nowMs - upd) <= 60_000;
}

function emitCloudWatchHrToWearBridge(
  bpm: number,
  avgBpm: number,
  maxBpm: number,
  watchSource: string | null
): void {
  if (typeof window === "undefined" || bpm < 30 || bpm > 245) return;
  const friendlyWatchName =
    watchSource === "WATCHOS"
      ? "Reloj Vinculado (Nube)"
      : watchSource && watchSource.startsWith("GARMIN")
      ? "Reloj Deportivo"
      : "Reloj Inteligente";
  const nodeId = `cloud:${watchSource || "watch"}`;
  lastKnownCloudWatchHr = {
    bpm,
    avgBpm: avgBpm >= 30 && avgBpm <= 245 ? avgBpm : 0,
    maxBpm: maxBpm >= 30 && maxBpm <= 245 ? maxBpm : 0,
    deviceName: friendlyWatchName,
    nodeId,
    at: Date.now()
  };
  try {
    (window as any).__onNativeWearHrUpdate?.({
      bpm,
      ...(lastKnownCloudWatchHr.avgBpm >= 30 ? { avgBpm: lastKnownCloudWatchHr.avgBpm } : {}),
      ...(lastKnownCloudWatchHr.maxBpm >= 30 ? { maxBpm: lastKnownCloudWatchHr.maxBpm } : {}),
      status: "ok",
      deviceName: friendlyWatchName,
      nodeId
    });
  } catch {}
}

function fetchCloudWatchHrOnce(code: string, sessionToken?: string): void {
  const token = sessionToken || activePhoneSessionToken;
  if (!code || !PAIRING_CODE_RE.test(code) || !token || !SESSION_TOKEN_RE.test(token)) return;
  getDoc(doc(db, "watch_sessions", token))
    .then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const nowMs = Date.now();
      const bpm =
        typeof data.watchHeartRateBpm === "number" && data.watchHeartRateBpm > 0
          ? Math.round(data.watchHeartRateBpm)
          : typeof data.lastWatchCmd?.heartRateBpm === "number"
          ? Math.round(data.lastWatchCmd.heartRateBpm)
          : 0;
      const avg =
        typeof data.watchAvgHeartRateBpm === "number" ? Math.round(data.watchAvgHeartRateBpm) : 0;
      const max =
        typeof data.watchMaxHeartRateBpm === "number" ? Math.round(data.watchMaxHeartRateBpm) : 0;
      const hb = Number(data.watchHeartbeatAt) || 0;
      const watchSource =
        typeof data.watchSource === "string" && data.watchSource ? data.watchSource : null;
      if (shouldAcceptCloudWatchHeartRate(data, nowMs, false)) {
        emitCloudWatchHrToWearBridge(bpm, avg, max, watchSource);
        notifyCloudPairingStatus({
          pairingCode: code,
          cloudConnected: true,
          cloudSyncError: "",
          watchLinked: true,
          watchSource: watchSource || "CLOUD_WATCH",
          lastWatchSeenAt: hb > 0 && hb <= nowMs ? hb : nowMs
        });
      }
    })
    .catch(() => {});
}

let pendingAuthPairingUnsub: (() => void) | null = null;
let inFlightPairingInitUid = "";
let inFlightPairingInitPromise: Promise<string> | null = null;

export function ensurePhoneWatchPairingReady(explicitUid?: string): void {
  if (typeof window === "undefined" || activeWatchClientCode) return;
  const runForUid = (resolvedUid: string) => {
    if (!resolvedUid || resolvedUid === "USR-GUEST-OFFLINE") return;
    if (
      activePhonePairingCode &&
      activePhoneSessionToken &&
      activePhonePairingUid === resolvedUid &&
      phoneCloudUnsubscribe
    ) {
      pushPairingCodeToNativeWatchBridge(activePhonePairingCode, activePhoneSessionToken);
      fetchCloudWatchHrOnce(activePhonePairingCode, activePhoneSessionToken);
      return;
    }
    if (inFlightPairingInitPromise && inFlightPairingInitUid === resolvedUid) {
      return;
    }
    inFlightPairingInitUid = resolvedUid;
    inFlightPairingInitPromise = getOrCreatePhoneWatchPairingCode(resolvedUid)
      .then((code) => {
        if (code) {
          pushPairingCodeToNativeWatchBridge(code, activePhoneSessionToken);
          fetchCloudWatchHrOnce(code, activePhoneSessionToken);
        }
        return code;
      })
      .catch(() => "")
      .finally(() => {
        if (inFlightPairingInitUid === resolvedUid) {
          inFlightPairingInitUid = "";
          inFlightPairingInitPromise = null;
        }
      });
  };

  const immediateUid = auth.currentUser?.uid || "";
  if (immediateUid) {
    runForUid(immediateUid);
    return;
  }
  if (explicitUid && explicitUid !== "USR-GUEST-OFFLINE") {
    // Also immediately listen on any cached localStorage pairing code + 256-bit sessionToken while Firebase Auth hydrates
    try {
      const cachedCode = localStorage.getItem(`archery_watch_pairing_code_${explicitUid}`) || "";
      const cachedToken = localStorage.getItem(`archery_watch_session_token_${explicitUid}`) || "";
      if (PAIRING_CODE_RE.test(cachedCode) && SESSION_TOKEN_RE.test(cachedToken)) {
        pushPairingCodeToNativeWatchBridge(cachedCode, cachedToken);
        if (!activePhonePairingCode || !activePhoneSessionToken || !phoneCloudUnsubscribe) {
          startPhonePairingSnapshotListener(cachedCode, cachedToken, explicitUid);
        }
        fetchCloudWatchHrOnce(cachedCode, cachedToken);
      }
    } catch {}
  }
  if (!pendingAuthPairingUnsub) {
    try {
      pendingAuthPairingUnsub = onAuthStateChanged(auth, (fbUser) => {
        if (fbUser?.uid) {
          const unsub = pendingAuthPairingUnsub;
          pendingAuthPairingUnsub = null;
          try {
            unsub?.();
          } catch {}
          runForUid(fbUser.uid);
        }
      });
    } catch {}
  }
}

function requestCloudWatchHeartRateInternal(): void {
  if (typeof window === "undefined" || activeWatchClientCode) return;
  const now = Date.now();
  if (lastKnownCloudWatchHr && now - lastKnownCloudWatchHr.at <= 35_000) {
    try {
      (window as any).__onNativeWearHrUpdate?.({
        bpm: lastKnownCloudWatchHr.bpm,
        ...(lastKnownCloudWatchHr.avgBpm >= 30 ? { avgBpm: lastKnownCloudWatchHr.avgBpm } : {}),
        ...(lastKnownCloudWatchHr.maxBpm >= 30 ? { maxBpm: lastKnownCloudWatchHr.maxBpm } : {}),
        status: "ok",
        deviceName: lastKnownCloudWatchHr.deviceName,
        nodeId: lastKnownCloudWatchHr.nodeId
      });
    } catch {}
  }

  ensurePhoneWatchPairingReady();
  if (activePhonePairingCode && activePhoneSessionToken) {
    fetchCloudWatchHrOnce(activePhonePairingCode, activePhoneSessionToken);
  }
}

function ensureGlobalNativeWatchDispatcher(): void {
  if (typeof window === "undefined") return;
  (window as any).__onNativeWatchMessage = dispatchWatchCommandInternal;
  (window as any).onArcheryWatchCommand = dispatchWatchCommandInternal;
  (window as any).__requestCloudWatchHeartRate = requestCloudWatchHeartRateInternal;
  (window as any).__archeryWatchListenerReady = watchCommandListeners.size > 0;
}

if (typeof window !== "undefined") {
  rehydratePendingWatchCommandsFromSession();
  ensureGlobalNativeWatchDispatcher();
}

// 70h TTL (safely inside Firestore Rules 72h cap) so archers' codes stay valid across consecutive days
const WATCH_SESSION_TTL_MS = 70 * 60 * 60 * 1000;

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function buildPhoneCloudSessionFields(
  snapshot: BiometricSessionSnapshot | null,
  uid: string,
  sessionToken: string,
  pairingCode: string
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
    sessionToken,
    ...(PAIRING_CODE_RE.test(pairingCode) ? { pairingCode } : {}),
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

function startPhonePairingSnapshotListener(
  code: string,
  sessionToken: string,
  uid: string
): void {
  if (
    phoneCloudUnsubscribe &&
    activePhonePairingCode === code &&
    activePhoneSessionToken === sessionToken &&
    activePhonePairingUid === uid
  ) {
    return;
  }
  if (phoneCloudUnsubscribe) {
    try {
      phoneCloudUnsubscribe();
    } catch {}
    phoneCloudUnsubscribe = null;
  }
  activePhonePairingCode = code;
  activePhoneSessionToken = sessionToken;
  activePhonePairingUid = uid;
  lastObservedWatchHeartbeatAt = 0;
  let isInitialSnapshot = true;

  notifyCloudPairingStatus({
    pairingCode: code
  });
  pushPairingCodeToNativeWatchBridge(code, sessionToken);

  const sessionRef = doc(db, "watch_sessions", sessionToken);
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
      const wasInitialSnapshot = isInitialSnapshot;
      const heartbeatChangedLive =
        !wasInitialSnapshot && watchHeartbeatAt > 0 && watchHeartbeatAt !== lastObservedWatchHeartbeatAt;
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

      if (wasInitialSnapshot) {
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

      const isFreshCloudWatchHr = shouldAcceptCloudWatchHeartRate(
        data,
        now,
        heartbeatChangedLive
      );

      if (isFreshCloudWatchHr) {
        emitCloudWatchHrToWearBridge(incomingHrBpm, incomingAvgHr, incomingMaxHr, watchSource);
      }

      if (incomingSteps === 0 && incomingDistM === 0 && data.sessionActive === false) {
        lastCloudTelemetrySteps = 0;
        lastCloudTelemetryDistM = 0;
        lastCloudTelemetryAvgHr = 0;
        lastCloudTelemetryMaxHr = 0;
        if (!isFreshCloudWatchHr) {
          lastCloudTelemetryLiveHr = 0;
          lastKnownCloudWatchHr = null;
        } else {
          lastCloudTelemetryLiveHr = incomingHrBpm;
          dispatchWatchCommandInternal({
            type: "HEART_RATE",
            heartRateBpm: incomingHrBpm,
            status: "ok",
            deviceName:
              watchSource && watchSource.startsWith("GARMIN")
                ? "Reloj Deportivo"
                : "Reloj Inteligente"
          });
          notifyCloudPairingStatus({
            pairingCode: code,
            cloudConnected: true,
            cloudSyncError: "",
            watchLinked: true,
            watchSource: watchSource || "CLOUD_WATCH",
            lastWatchSeenAt: now
          });
        }
        watchHrSum = 0;
        watchHrCount = 0;
        lastWatchHrSampleKey = "";
        activeWatchHrSessionId = "";
      } else if (
        (incomingSteps > lastCloudTelemetrySteps && incomingSteps > 0) ||
        (incomingDistM > lastCloudTelemetryDistM && incomingDistM > 0) ||
        (isFreshCloudWatchHr && (heartbeatChangedLive || incomingHrBpm !== lastCloudTelemetryLiveHr)) ||
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
        const effectiveAvgHr =
          lastCloudTelemetryAvgHr >= 30
            ? lastCloudTelemetryAvgHr
            : isFreshCloudWatchHr
            ? incomingHrBpm
            : 0;
        const hrPatch =
          effectiveAvgHr >= 30 || isFreshCloudWatchHr
            ? {
                heartRateBpm: isFreshCloudWatchHr ? incomingHrBpm : effectiveAvgHr,
                avgHeartRateBpm: effectiveAvgHr,
                maxHeartRateBpm: Math.max(
                  effectiveAvgHr,
                  lastCloudTelemetryMaxHr,
                  isFreshCloudWatchHr ? incomingHrBpm : 0
                )
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

async function allocateFreshPairingCode(ownerHash: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const existing = await getDoc(doc(db, "watch_pairings", candidate));
      if (!existing.exists() || existing.data()?.ownerHash === ownerHash) {
        return candidate;
      }
    } catch (err: any) {
      const errCode = String(err?.code || "");
      const isPermDenied =
        errCode === "permission-denied" ||
        String(err?.message || "").toLowerCase().includes("missing or insufficient permissions");
      if (isPermDenied) {
        // Another user owns a claimed/expired watch_pairings doc at this 6-digit code; retry!
        continue;
      }
      return candidate;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function writeOrRefreshWatchPairingDoc(
  code: string,
  sessionToken: string,
  ownerHash: string,
  reopenIfClaimed: boolean = true
): Promise<boolean> {
  if (
    !PAIRING_CODE_RE.test(code) ||
    !SESSION_TOKEN_RE.test(sessionToken) ||
    !/^[a-f0-9]{64}$/.test(ownerHash)
  ) {
    return false;
  }
  const pairingRef = doc(db, "watch_pairings", code);
  const now = Date.now();

  if (!reopenIfClaimed) {
    try {
      const existing = await getDoc(pairingRef);
      if (existing.exists()) {
        const d = existing.data() || {};
        if (d.ownerHash === ownerHash && d.sessionToken === sessionToken && d.claimed === true) {
          return true;
        }
        if (typeof d.createdAt === "number" && d.createdAt > 0) {
          activePhonePairingCreatedAt = d.createdAt;
        }
      }
    } catch {}
  }

  const createdAt = activePhonePairingCreatedAt > 0 ? activePhonePairingCreatedAt : now;
  activePhonePairingCreatedAt = createdAt;

  await setDoc(pairingRef, {
    pairingCode: code,
    sessionToken,
    ownerHash,
    pairingOpenUntil: now + WATCH_PAIRING_OPEN_MS,
    claimed: false,
    watchDeviceId: "",
    createdAt,
    updatedAt: now
  });
  return true;
}

function pushPairingCodeToNativeWatchBridge(code: string, sessionToken?: string): void {
  if (typeof window === "undefined" || !PAIRING_CODE_RE.test(code)) return;
  try {
    const stored = readStoredWatchState();
    const resolvedToken = sessionToken || activePhoneSessionToken;
    const payload = JSON.stringify({
      ...(stored || { sessionActive: true }),
      pairingCode: code,
      ...(SESSION_TOKEN_RE.test(resolvedToken) ? { sessionToken: resolvedToken } : {}),
      updatedAt: Date.now()
    });
    const bridge = (window as any).ArcheryWatchNativeBridge;
    if (bridge?.onSessionTelemetryUpdate) {
      bridge.onSessionTelemetryUpdate(payload);
    } else if (bridge?.syncTelemetryToWatch) {
      bridge.syncTelemetryToWatch(payload);
    }
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "onSessionTelemetryUpdate", payload });
    }
  } catch {}
}

/**
 * Generates or restores the archer's 6-digit Cloud Watch Pairing Code (`100000`–`999999`)
 * paired with a 256-bit URL-safe `sessionToken` (`watch_sessions/{sessionToken}` + ephemeral
 * `watch_pairings/{pairingCode}` <= 120s window), and listens in real time for watch commands.
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

  const codeStorageKey = `archery_watch_pairing_code_${effectiveUid}`;
  const tokenStorageKey = `archery_watch_session_token_${effectiveUid}`;
  const ownerHash = await computeWatchOwnerHash(effectiveUid);
  activePhoneOwnerHash = ownerHash;

  let prevSavedCode = "";
  let prevSavedToken = "";
  try {
    prevSavedCode = (localStorage.getItem(codeStorageKey) || "").trim();
    prevSavedToken = (localStorage.getItem(tokenStorageKey) || "").trim();
  } catch {}

  let code = "";
  let sessionToken = "";
  let isFreshAllocation = false;

  if (!forceRegenerate && PAIRING_CODE_RE.test(prevSavedCode) && SESSION_TOKEN_RE.test(prevSavedToken)) {
    code = prevSavedCode;
    sessionToken = prevSavedToken;
  } else {
    code = await allocateFreshPairingCode(ownerHash);
    sessionToken = generateWatchSessionToken();
    activePhonePairingCreatedAt = Date.now();
    isFreshAllocation = true;
    try {
      localStorage.setItem(codeStorageKey, code);
      localStorage.setItem(tokenStorageKey, sessionToken);
    } catch {}
    if (forceRegenerate) {
      if (PAIRING_CODE_RE.test(prevSavedCode) && prevSavedCode !== code) {
        deleteDoc(doc(db, "watch_pairings", prevSavedCode)).catch(() => {});
      }
      if (SESSION_TOKEN_RE.test(prevSavedToken) && prevSavedToken !== sessionToken) {
        deleteDoc(doc(db, "watch_sessions", prevSavedToken)).catch(() => {});
      }
    }
  }

  let persisted = false;
  let lastErrorCode = "";

  try {
    const payload = buildPhoneCloudSessionFields(
      readStoredWatchState(),
      effectiveUid,
      sessionToken,
      code
    );
    // Always use { merge: true } without watchDeviceId so claimed watch bindings are preserved!
    await setDoc(doc(db, "watch_sessions", sessionToken), payload, { merge: true });
    await writeOrRefreshWatchPairingDoc(
      code,
      sessionToken,
      ownerHash,
      isFreshAllocation || forceRegenerate
    );
    persisted = true;
  } catch (err: any) {
    lastErrorCode = String(err?.code || err?.message || "SYNC_FAILED");
    // Self-heal: if an old localStorage code/token collided, expired, or had legacy fields rejected
    // by Firestore Rules, automatically rotate to a clean 6-digit code + fresh 256-bit sessionToken!
    for (let retry = 0; retry < 2 && !persisted; retry++) {
      try {
        const rotatedCode = await allocateFreshPairingCode(ownerHash);
        const rotatedToken = generateWatchSessionToken();
        activePhonePairingCreatedAt = Date.now();
        const cleanPayload = buildPhoneCloudSessionFields(
          readStoredWatchState(),
          effectiveUid,
          rotatedToken,
          rotatedCode
        );
        await setDoc(doc(db, "watch_sessions", rotatedToken), cleanPayload, { merge: true });
        await writeOrRefreshWatchPairingDoc(rotatedCode, rotatedToken, ownerHash, true);
        code = rotatedCode;
        sessionToken = rotatedToken;
        persisted = true;
        lastErrorCode = "";
        try {
          localStorage.setItem(codeStorageKey, code);
          localStorage.setItem(tokenStorageKey, sessionToken);
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
    pushPairingCodeToNativeWatchBridge(code, sessionToken);
  } else {
    notifyCloudPairingStatus({
      pairingCode: code,
      cloudConnected: false,
      cloudSyncError: lastErrorCode || "SYNC_FAILED"
    });
  }

  startPhonePairingSnapshotListener(code, sessionToken, effectiveUid);
  return code;
}

/**
 * Refreshes `watch_pairings/{pairingCode}.pairingOpenUntil` (`Date.now() + 115000`) so watches
 * can claim the 256-bit `sessionToken` within the 120s window while pairing UI is open.
 * When `reopenIfClaimed` is false (periodic background refresh), preserves `claimed: true` if
 * a watch already claimed the current `sessionToken`.
 */
export async function refreshPhoneWatchPairingWindow(
  uid?: string,
  reopenIfClaimed: boolean = false
): Promise<string> {
  if (typeof window === "undefined" || activeWatchClientCode) return "";
  const authUid = auth.currentUser?.uid || "";
  const effectiveUid = authUid || (uid && uid !== "USR-GUEST-OFFLINE" ? uid : "");
  if (!effectiveUid || !authUid) return "";

  if (
    !activePhonePairingCode ||
    !activePhoneSessionToken ||
    activePhonePairingUid !== effectiveUid ||
    !PAIRING_CODE_RE.test(activePhonePairingCode) ||
    !SESSION_TOKEN_RE.test(activePhoneSessionToken)
  ) {
    return getOrCreatePhoneWatchPairingCode(effectiveUid, false);
  }

  const ownerHash = activePhoneOwnerHash || (await computeWatchOwnerHash(effectiveUid));
  activePhoneOwnerHash = ownerHash;
  pushPairingCodeToNativeWatchBridge(activePhonePairingCode, activePhoneSessionToken);

  try {
    if (
      reopenIfClaimed &&
      (lastObservedWatchHeartbeatAt === 0 || Date.now() - lastObservedWatchHeartbeatAt > 45_000)
    ) {
      // Allow a freshly reinstalled watch app (with a new watchDeviceId) to bind cleanly without HTTP 403
      await setDoc(
        doc(db, "watch_sessions", activePhoneSessionToken),
        {
          userId: effectiveUid,
          sessionToken: activePhoneSessionToken,
          pairingCode: activePhonePairingCode,
          watchDeviceId: "",
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          updatedAt: Date.now()
        },
        { merge: true }
      ).catch(() => {});
    }
    await writeOrRefreshWatchPairingDoc(
      activePhonePairingCode,
      activePhoneSessionToken,
      ownerHash,
      reopenIfClaimed
    );
    pushPairingCodeToNativeWatchBridge(activePhonePairingCode, activePhoneSessionToken);
    return activePhonePairingCode;
  } catch (err: any) {
    const errCode = String(err?.code || "");
    if (errCode === "permission-denied" || errCode === "not-found") {
      return getOrCreatePhoneWatchPairingCode(effectiveUid, true);
    }
    return activePhonePairingCode;
  }
}

function flushPhoneSnapshotToCloudImmediate(
  snapshot: BiometricSessionSnapshot,
  uid: string,
  code: string,
  sessionToken: string
): void {
  if (!SESSION_TOKEN_RE.test(sessionToken)) return;
  if (phoneCloudThrottleTimer) {
    clearTimeout(phoneCloudThrottleTimer);
    phoneCloudThrottleTimer = null;
  }
  pendingPhoneCloudSnapshot = null;
  lastPhoneCloudPushMs = Date.now();
  lastPushedPhoneArrowsCount = Math.max(0, Number(snapshot.arrowsCount) || 0);

  const fields = buildPhoneCloudSessionFields(snapshot, uid, sessionToken, code);
  if (snapshot.sessionActive === false) {
    // Reset cumulative session counters, but NEVER wipe instantaneous wrist watchHeartRateBpm
    // so SessionConfigView and BleHeartRateModal continue showing live pulse between rounds!
    fields.watchStepsCount = 0;
    fields.watchDistanceM = 0;
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

  setDoc(doc(db, "watch_sessions", sessionToken), fields, { merge: true })
    .then(() => {
      notifyCloudPairingStatus({
        lastCloudSyncAt: Date.now(),
        cloudConnected: true,
        cloudSyncError: ""
      });
    })
    .catch((err: any) => {
      const errCode = String(err?.code || "");
      if (errCode === "permission-denied" || errCode === "not-found") {
        getOrCreatePhoneWatchPairingCode(uid, true).catch(() => {});
      }
    });
}

let lastPushedAnalysisCalSig = "";
let lastPushedSessionActive: boolean | null = null;
let lastPushedSessionId = "";

function schedulePhoneCloudWatchPush(snapshot: BiometricSessionSnapshot): void {
  if (typeof window === "undefined") return;
  // Never overwrite phone session fields from the standalone /watch companion view
  if (activeWatchClientCode) return;

  const uid = auth.currentUser?.uid || "";
  if (!uid) return;

  if (!activePhonePairingCode || !activePhoneSessionToken || activePhonePairingUid !== uid) {
    try {
      const savedCode = localStorage.getItem(`archery_watch_pairing_code_${uid}`) || "";
      const savedToken = localStorage.getItem(`archery_watch_session_token_${uid}`) || "";
      if (PAIRING_CODE_RE.test(savedCode) && SESSION_TOKEN_RE.test(savedToken)) {
        startPhonePairingSnapshotListener(savedCode, savedToken, uid);
      } else {
        ensurePhoneWatchPairingReady(uid);
        return;
      }
    } catch {}
  }

  if (!activePhonePairingCode || !activePhoneSessionToken) return;

  const nextSessionActive = snapshot.sessionActive !== false;
  const nextSessionId = String(snapshot.sessionId || "");
  const sessionLifecycleChanged =
    nextSessionActive !== lastPushedSessionActive || nextSessionId !== lastPushedSessionId;
  lastPushedSessionActive = nextSessionActive;
  lastPushedSessionId = nextSessionId;

  const nextCalSig = `${Boolean(snapshot.analysisMode)}|${snapshot.analysisCalibrationJson || ""}`;
  const calChanged = nextCalSig !== lastPushedAnalysisCalSig;
  if (calChanged) {
    lastPushedAnalysisCalSig = nextCalSig;
  }

  const isImmediateEvent =
    sessionLifecycleChanged ||
    calChanged ||
    snapshot.sessionActive === false ||
    (snapshot.arrowsCount === 0 && lastPushedPhoneArrowsCount > 0);
  const elapsed = Date.now() - lastPhoneCloudPushMs;

  if (isImmediateEvent || elapsed >= 800) {
    flushPhoneSnapshotToCloudImmediate(
      snapshot,
      uid,
      activePhonePairingCode,
      activePhoneSessionToken
    );
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
      if (latest && currentUid && activePhonePairingCode && activePhoneSessionToken) {
        flushPhoneSnapshotToCloudImmediate(
          latest,
          currentUid,
          activePhonePairingCode,
          activePhoneSessionToken
        );
      }
    }, waitMs);
  }
}

interface CachedWatchClientSession {
  pairingCode: string;
  sessionToken: string;
  watchDeviceId: string;
}

function readCachedWatchClientSession(): CachedWatchClientSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WATCH_CLIENT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      PAIRING_CODE_RE.test(String(parsed.pairingCode || "")) &&
      SESSION_TOKEN_RE.test(String(parsed.sessionToken || "")) &&
      typeof parsed.watchDeviceId === "string" &&
      parsed.watchDeviceId.length >= 1 &&
      parsed.watchDeviceId.length <= 80
    ) {
      return {
        pairingCode: String(parsed.pairingCode),
        sessionToken: String(parsed.sessionToken),
        watchDeviceId: String(parsed.watchDeviceId)
      };
    }
  } catch {}
  return null;
}

function writeCachedWatchClientSession(entry: CachedWatchClientSession): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WATCH_CLIENT_SESSION_KEY, JSON.stringify(entry));
    localStorage.setItem(WATCH_CLIENT_CODE_KEY, entry.pairingCode);
  } catch {}
}

function clearCachedWatchClientSessionTokenOnly(): void {
  activeWatchClientSessionToken = "";
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(WATCH_CLIENT_SESSION_KEY);
  } catch {}
}

export function getActiveWatchClientPairingCode(): string {
  if (activeWatchClientCode) return activeWatchClientCode;
  if (typeof window === "undefined") return "";
  const cached = readCachedWatchClientSession();
  if (cached?.pairingCode) return cached.pairingCode;
  try {
    const saved = localStorage.getItem(WATCH_CLIENT_CODE_KEY) || "";
    if (PAIRING_CODE_RE.test(saved)) return saved;
  } catch {}
  return "";
}

export function pauseWatchClientSubscription(): void {
  if (watchClientUnsubscribe) {
    try {
      watchClientUnsubscribe();
    } catch {}
    watchClientUnsubscribe = null;
  }
}

export function disconnectWatchClientPairingCode(): void {
  pauseWatchClientSubscription();
  activeWatchClientCode = "";
  activeWatchClientSessionToken = "";
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(WATCH_CLIENT_CODE_KEY);
      localStorage.removeItem(WATCH_CLIENT_SESSION_KEY);
    }
  } catch {}
  notifyCloudPairingStatus({
    pairingCode: "",
    cloudConnected: false,
    cloudSyncError: "",
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
 * Connects a standalone `/watch` browser companion via the Spark-safe 256-bit handshake:
 * 1) Reuses cached `{ pairingCode, sessionToken, watchDeviceId }` when valid;
 * 2) Otherwise claims `watch_pairings/{pairingCode}` atomically (`claimed: true`, `watchDeviceId`, `watchSource: "WEB_WATCH"`);
 * 3) Subscribes & sends whitelisted watch telemetry to `watch_sessions/{sessionToken}`.
 */
export async function connectWatchClientToPairingCode(
  code: string
): Promise<{ ok: boolean; snapshot?: BiometricSessionSnapshot; error?: string }> {
  const cleanCode = String(code || "").replace(/\D/g, "").slice(0, 6);
  if (!PAIRING_CODE_RE.test(cleanCode)) {
    return { ok: false, error: "Ingresa un código válido de 6 dígitos" };
  }

  const cached = readCachedWatchClientSession();
  const watchDeviceId =
    cached && cached.pairingCode === cleanCode && cached.watchDeviceId
      ? cached.watchDeviceId
      : getOrCreateWatchClientDeviceId();
  let resolvedToken =
    cached && cached.pairingCode === cleanCode && SESSION_TOKEN_RE.test(cached.sessionToken)
      ? cached.sessionToken
      : "";

  let initialSnapshot: BiometricSessionSnapshot | undefined;

  if (resolvedToken) {
    try {
      const existingSnap = await getDoc(doc(db, "watch_sessions", resolvedToken));
      if (existingSnap.exists()) {
        const sData = existingSnap.data() || {};
        const lockedDevice = typeof sData.watchDeviceId === "string" ? sData.watchDeviceId : "";
        if (!lockedDevice || lockedDevice === watchDeviceId) {
          initialSnapshot = mapCloudDocToSnapshot(sData);
        } else {
          clearCachedWatchClientSessionTokenOnly();
          resolvedToken = "";
        }
      } else {
        clearCachedWatchClientSessionTokenOnly();
        resolvedToken = "";
      }
    } catch (err: any) {
      const isPermDenied =
        err?.code === "permission-denied" ||
        String(err?.message || "").toLowerCase().includes("missing or insufficient permissions");
      if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
        clearCachedWatchClientSessionTokenOnly();
        resolvedToken = "";
      } else {
        return { ok: false, error: "Sin conexión para verificar el código." };
      }
    }
  }

  if (!resolvedToken) {
    try {
      const pairingRef = doc(db, "watch_pairings", cleanCode);
      const pairingSnap = await getDoc(pairingRef);
      if (!pairingSnap.exists()) {
        return {
          ok: false,
          error: "Código no encontrado o ventana cerrada. Abre el panel Reloj en tu teléfono."
        };
      }
      const pData = pairingSnap.data() || {};
      const candidateToken = String(pData.sessionToken || "").trim();
      if (!SESSION_TOKEN_RE.test(candidateToken)) {
        return {
          ok: false,
          error: "Código expirado o inválido. Genera un código nuevo en tu teléfono."
        };
      }

      // Single-use atomic claim with ONLY the exact keys allowed by Firestore Rules
      await updateDoc(pairingRef, {
        claimed: true,
        watchDeviceId,
        watchSource: "WEB_WATCH",
        updatedAt: Date.now()
      });

      resolvedToken = candidateToken;
      writeCachedWatchClientSession({
        pairingCode: cleanCode,
        sessionToken: resolvedToken,
        watchDeviceId
      });

      const sessionSnap = await getDoc(doc(db, "watch_sessions", resolvedToken));
      if (!sessionSnap.exists()) {
        clearCachedWatchClientSessionTokenOnly();
        return {
          ok: false,
          error: "Sesión no encontrada. Abre el panel Reloj en tu teléfono."
        };
      }
      initialSnapshot = mapCloudDocToSnapshot(sessionSnap.data() || {});
    } catch (err: any) {
      const isPermDenied =
        err?.code === "permission-denied" ||
        String(err?.message || "").toLowerCase().includes("missing or insufficient permissions");
      if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
        clearCachedWatchClientSessionTokenOnly();
        return {
          ok: false,
          error: "Código expirado o ya reclamado. Abre el panel Reloj en tu teléfono para renovarlo."
        };
      }
      return { ok: false, error: "Sin conexión para verificar el código." };
    }
  }

  pauseWatchClientSubscription();

  activeWatchClientCode = cleanCode;
  activeWatchClientSessionToken = resolvedToken;
  activeWatchClientDeviceId = watchDeviceId;
  writeCachedWatchClientSession({
    pairingCode: cleanCode,
    sessionToken: resolvedToken,
    watchDeviceId
  });

  const sessionRef = doc(db, "watch_sessions", resolvedToken);

  try {
    const hbNow = Date.now();
    await updateDoc(sessionRef, {
      watchDeviceId,
      watchSource: "WEB_WATCH",
      watchHeartbeatAt: hbNow,
      updatedAt: hbNow
    });
  } catch (hbErr: any) {
    const isPermDenied =
      hbErr?.code === "permission-denied" ||
      String(hbErr?.message || "").toLowerCase().includes("missing or insufficient permissions");
    if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
      clearCachedWatchClientSessionTokenOnly();
      activeWatchClientSessionToken = "";
      return {
        ok: false,
        error: "Este código ya está vinculado a otro reloj. Genera un código nuevo en tu teléfono."
      };
    }
  }

  if (initialSnapshot) {
    try {
      localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(initialSnapshot));
    } catch {}
    dispatchWatchCommandInternal({ type: "STATE_UPDATE", payload: initialSnapshot });
  }

  notifyCloudPairingStatus({
    pairingCode: cleanCode,
    cloudConnected: true,
    cloudSyncError: "",
    watchLinked: true,
    watchSource: "WEB_WATCH",
    lastCloudSyncAt: Date.now(),
    lastWatchSeenAt: Date.now()
  });

  watchClientUnsubscribe = onSnapshot(
    sessionRef,
    (snap) => {
      if (!snap.exists()) {
        clearCachedWatchClientSessionTokenOnly();
        notifyCloudPairingStatus({
          cloudConnected: false,
          watchLinked: false,
          cloudSyncError: "SESSION_EXPIRED"
        });
        return;
      }
      const mapped = mapCloudDocToSnapshot(snap.data() || {});
      if (mapped.sessionActive === false) {
        latestWatchClientSteps = 0;
        latestWatchClientDistM = 0;
        latestWatchClientKcal = 0;
      }
      try {
        localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(mapped));
      } catch {}
      notifyCloudPairingStatus({
        pairingCode: cleanCode,
        cloudConnected: true,
        cloudSyncError: "",
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
    (snapErr: any) => {
      const isPermDenied =
        snapErr?.code === "permission-denied" ||
        String(snapErr?.message || "").toLowerCase().includes("missing or insufficient permissions");
      if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
        clearCachedWatchClientSessionTokenOnly();
        activeWatchClientSessionToken = "";
      }
      notifyCloudPairingStatus({
        cloudConnected: false,
        watchLinked: false,
        cloudSyncError: isPermDenied ? "SESSION_EXPIRED" : "OFFLINE"
      });
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
      activePhonePairingCode && PAIRING_CODE_RE.test(activePhonePairingCode)
        ? JSON.stringify({
            ...snapshot,
            pairingCode: activePhonePairingCode,
            ...(SESSION_TOKEN_RE.test(activePhoneSessionToken)
              ? { sessionToken: activePhoneSessionToken }
              : {})
          })
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
    if (typeof cmd.delta === "number") out.delta = Math.round(clampNum(cmd.delta, 0, -20, 20));
    if (typeof cmd.source === "string") out.source = cmd.source.slice(0, 24);
    if ("totalScore" in cmd && typeof cmd.totalScore === "number") {
      out.totalScore = Math.round(clampNum(cmd.totalScore, 0, 0, 100000));
    }
  } else if (cmd.type === "UNDO_ARROW") {
    if (typeof cmd.totalScore === "number") {
      out.totalScore = Math.round(clampNum(cmd.totalScore, 0, 0, 100000));
    }
  } else if (cmd.type === "SET_SENSITIVITY") {
    out.sensitivityLevel = Math.round(clampNum(cmd.sensitivityLevel, 1, 0, 10));
  } else if (cmd.type === "SCORE_INPUT") {
    const val = cmd.payload?.value ?? cmd.value;
    const tot = cmd.payload?.totalScore ?? cmd.totalScore;
    if (val !== undefined) out.value = String(val).slice(0, 12);
    if (typeof tot === "number") out.totalScore = Math.round(clampNum(tot, 0, 0, 100000));
  } else if (cmd.type === "SYNC_TELEMETRY_FROM_WATCH") {
    const st = cmd.stepsCount ?? cmd.payload?.stepsCount;
    const dm = cmd.distanceWalkedM ?? cmd.payload?.distanceWalkedM;
    const kc = cmd.activeKcal ?? cmd.payload?.activeKcal;
    if (typeof st === "number") out.stepsCount = Math.round(clampNum(st, 0, 0, 1000000));
    if (typeof dm === "number") out.distanceWalkedM = Math.round(clampNum(dm, 0, 0, 1000000));
    if (typeof kc === "number") out.activeKcal = Math.round(clampNum(kc, 0, 0, 100000));
  } else if (cmd.type === "TOGGLE_AUTO_DETECT") {
    out.enabled = Boolean(cmd.enabled);
    if (typeof cmd.sensitivityLevel === "number") {
      out.sensitivityLevel = Math.round(clampNum(cmd.sensitivityLevel, 1, 0, 10));
    }
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
      ).slice(0, 240);
    } else if (typeof cmd.analysisShotJson === "string") {
      out.analysisShotJson = cmd.analysisShotJson.slice(0, 240);
    }
  }

  const bounded: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(out).slice(0, 10)) {
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

  // Route standalone /watch commands over 256-bit watch_sessions/{sessionToken} when linked
  if (
    activeWatchClientCode &&
    SESSION_TOKEN_RE.test(activeWatchClientSessionToken) &&
    cmd.type !== "REQUEST_STATE" &&
    cmd.type !== "STATE_UPDATE"
  ) {
    const deviceId = activeWatchClientDeviceId || getOrCreateWatchClientDeviceId();
    activeWatchClientDeviceId = deviceId;

    const telemetryPatch: Record<string, any> = {
      lastWatchCmd: buildCompactCloudWatchCmd(cmd, cmdId, now),
      lastWatchCmdId: cmdId.slice(0, 64),
      lastWatchCmdSeq: watchClientCmdSeq,
      watchStepsCount: latestWatchClientSteps,
      watchDistanceM: latestWatchClientDistM,
      watchCaloriesKcal: latestWatchClientKcal,
      watchSource: "WEB_WATCH",
      watchDeviceId: deviceId,
      watchHeartbeatAt: now,
      updatedAt: now
    };

    if (cmd.type === "SYNC_TELEMETRY_FROM_WATCH") {
      const st = cmd.stepsCount ?? cmd.payload?.stepsCount;
      const dm = cmd.distanceWalkedM ?? cmd.payload?.distanceWalkedM;
      const kc = cmd.activeKcal ?? cmd.payload?.activeKcal;
      const hr = cmd.heartRateBpm ?? cmd.payload?.heartRateBpm;
      const avgHr = cmd.avgHeartRateBpm ?? cmd.payload?.avgHeartRateBpm;
      const maxHr = cmd.maxHeartRateBpm ?? cmd.payload?.maxHeartRateBpm;
      if (typeof st === "number") {
        latestWatchClientSteps = Math.round(clampNum(st, 0, 0, 1000000));
        telemetryPatch.watchStepsCount = latestWatchClientSteps;
      }
      if (typeof dm === "number") {
        latestWatchClientDistM = Math.round(clampNum(dm, 0, 0, 1000000));
        telemetryPatch.watchDistanceM = latestWatchClientDistM;
      }
      if (typeof kc === "number") {
        latestWatchClientKcal = Math.round(clampNum(kc, 0, 0, 100000));
        telemetryPatch.watchCaloriesKcal = latestWatchClientKcal;
      }
      if (typeof hr === "number" && hr >= 30 && hr <= 250) {
        telemetryPatch.watchHeartRateBpm = Math.round(hr);
      }
      if (typeof avgHr === "number" && avgHr >= 30 && avgHr <= 250) {
        telemetryPatch.watchAvgHeartRateBpm = Math.round(avgHr);
      }
      if (typeof maxHr === "number" && maxHr >= 30 && maxHr <= 250) {
        telemetryPatch.watchMaxHeartRateBpm = Math.round(maxHr);
      }
    } else if (cmd.type === "ANALYSIS_SHOT") {
      if (typeof cmd.heartRateBpm === "number" && cmd.heartRateBpm >= 30 && cmd.heartRateBpm <= 250) {
        telemetryPatch.watchHeartRateBpm = Math.round(cmd.heartRateBpm);
      }
    } else if (cmd.type === "ANALYSIS_CALIBRATE_ZERO") {
      telemetryPatch.calibrateZeroAt = now;
    } else if (
      cmd.type === "ANALYSIS_ZERO_VECTOR" &&
      Array.isArray(cmd.zeroGravityVec) &&
      cmd.zeroGravityVec.length === 3
    ) {
      telemetryPatch.zeroGravityVec = cmd.zeroGravityVec.map((v) =>
        clampNum(v, 0, -100000, 100000)
      );
    }

    updateDoc(doc(db, "watch_sessions", activeWatchClientSessionToken), telemetryPatch).catch(
      (err: any) => {
        const isPermDenied =
          err?.code === "permission-denied" ||
          err?.code === "not-found" ||
          String(err?.message || "").toLowerCase().includes("missing or insufficient permissions");
        if (isPermDenied && (typeof navigator === "undefined" || navigator.onLine)) {
          clearCachedWatchClientSessionTokenOnly();
          activeWatchClientSessionToken = "";
          notifyCloudPairingStatus({
            cloudConnected: false,
            watchLinked: false,
            cloudSyncError: "SESSION_EXPIRED"
          });
        }
      }
    );
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
    const iosHandler = (window as any).webkit?.messageHandlers?.ArcheryWatchNativeBridge;
    if (iosHandler?.postMessage) {
      iosHandler.postMessage({ action: "installAppOnWatch" });
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
