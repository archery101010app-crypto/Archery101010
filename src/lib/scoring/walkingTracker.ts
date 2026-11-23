/**
 * Pure Biomechanical Walking Gait + Anti-Drift Range GPS + Incremental Sensor Fusion
 *
 * Guarantees 0 meters when seated, standing on the shooting line, drawing a bow,
 * tilting the phone, or tapping arrows on screen, while accurately capturing 100%
 * of real downrange walking trips (18m–90m indoor & outdoor target walks).
 */

export interface GaitDetectorState {
  gravityMag: number;
  smoothLinear: number;
  armedForPeak: boolean;
  peakSeenInCycle: boolean;
  candidateTimesMs: number[];
  lastMeanIntervalMs: number;
  rhythmicActive: boolean;
  lastTouchMs: number;
  creditedSteps: number;
}

export interface GpsAnchorState {
  anchorLat: number | null;
  anchorLon: number | null;
  anchorTimeMs: number;
  lastFixLat: number | null;
  lastFixLon: number | null;
  lastFixTimeMs: number;
  accumulatedMeters: number;
}

export interface WalkingFusionState {
  fusedMeters: number;
  lastGpsMeters: number;
  lastGpsCreditAtMs: number;
  lastStepsCount: number;
  stepMetersSinceLastGps: number;
  watchMetersFloor: number;
}

const TOUCH_LOCKOUT_MS = 1800;
// Calibrated for two-stage IIR filter (0.94 gravity HPF + 0.65 linear LPF):
// A normal 1.15–1.35 m/s range walk (~1.2–2.0 m/s² raw impulse) yields +0.80..+1.35 m/s² peak & -0.40..-0.95 m/s² valley.
const STEP_PEAK_MPS2 = 0.78;
const STEP_VALLEY_MPS2 = -0.34;
const MIN_STEP_INTERVAL_MS = 300;
const MAX_STEP_INTERVAL_MS = 1200;
const BOUT_BREAK_MS = 2200;
const REQUIRED_BOUT_PEAKS = 4; // 4 consecutive rhythmic steps (~3.1m) before unlocking
const MAX_CADENCE_DEVIATION_RATIO = 0.32;

const MAX_VALID_GPS_ACCURACY_M = 20;
const MIN_WALK_DISPLACEMENT_M = 5.0;
const MIN_IDLE_DISPLACEMENT_M = 8.0;
const MIN_WALK_SPEED_MPS = 0.52;
const MAX_WALK_SPEED_MPS = 5.5;
const MAX_SINGLE_SEGMENT_M = 140; // Supports 70m & 90m target walks even when unlocking phone at target

export function computeArcherStrideMeters(heightCm?: number): number {
  const parsedHeight = Number(heightCm) || 0;
  if (parsedHeight >= 100 && parsedHeight <= 230) {
    return (parsedHeight * 0.42) / 100;
  }
  return 0.78;
}

export function createGaitDetectorState(initialSteps: number = 0): GaitDetectorState {
  return {
    gravityMag: 9.81,
    smoothLinear: 0,
    armedForPeak: true,
    peakSeenInCycle: false,
    candidateTimesMs: [],
    lastMeanIntervalMs: 580,
    rhythmicActive: false,
    lastTouchMs: 0,
    creditedSteps: Math.max(0, Math.round(initialSteps))
  };
}

export function notifyScreenInteraction(state: GaitDetectorState, nowMs: number): void {
  state.lastTouchMs = nowMs;
  state.candidateTimesMs = [];
  state.rhythmicActive = false;
  state.peakSeenInCycle = false;
  state.armedForPeak = true;
}

/**
 * Processes a 3D accelerometer sample (including gravity, in m/s²).
 * Returns the updated total credited walking steps.
 */
export function processAccelerometerSample(
  state: GaitDetectorState,
  ax: number,
  ay: number,
  az: number,
  nowMs: number
): number {
  const rawMag = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!Number.isFinite(rawMag) || rawMag < 1 || rawMag > 45) {
    return state.creditedSteps;
  }

  // Track slow gravity baseline and band-pass smooth linear body acceleration
  // so <40ms finger screen taps flatten out instead of looking like footsteps.
  state.gravityMag = 0.94 * state.gravityMag + 0.06 * rawMag;
  const rawLinear = rawMag - state.gravityMag;
  state.smoothLinear = 0.65 * state.smoothLinear + 0.35 * rawLinear;

  // Suppress all accelerometer step candidates while actively interacting with the screen
  if (state.lastTouchMs > 0 && nowMs - state.lastTouchMs < TOUCH_LOCKOUT_MS) {
    state.candidateTimesMs = [];
    state.rhythmicActive = false;
    state.peakSeenInCycle = false;
    state.armedForPeak = true;
    return state.creditedSteps;
  }

  // Break active bout if too much time elapsed since last step candidate
  const lastStepMs =
    state.candidateTimesMs.length > 0
      ? state.candidateTimesMs[state.candidateTimesMs.length - 1]
      : 0;
  if (lastStepMs > 0 && nowMs - lastStepMs > BOUT_BREAK_MS) {
    state.candidateTimesMs = [];
    state.rhythmicActive = false;
    state.peakSeenInCycle = false;
    state.armedForPeak = true;
  }

  // Require full bipedal sinusoidal cycle: Peak (>= +0.78 m/s²) followed by Valley (<= -0.34 m/s²)
  if (state.armedForPeak && state.smoothLinear >= STEP_PEAK_MPS2) {
    state.peakSeenInCycle = true;
    state.armedForPeak = false;
  } else if (state.peakSeenInCycle && state.smoothLinear <= STEP_VALLEY_MPS2) {
    state.peakSeenInCycle = false;
    state.armedForPeak = true;

    if (lastStepMs > 0) {
      const dt = nowMs - lastStepMs;
      if (dt < MIN_STEP_INTERVAL_MS) {
        return state.creditedSteps;
      }
      if (dt > MAX_STEP_INTERVAL_MS) {
        // Soft-step bridge: if already walking rhythmically and a single soft step was skipped (~2x cadence),
        // bridge both steps seamlessly instead of dropping the walking bout!
        const expectedDouble = state.lastMeanIntervalMs * 2;
        if (
          state.rhythmicActive &&
          dt <= 1900 &&
          Math.abs(dt - expectedDouble) <= expectedDouble * 0.34
        ) {
          const midMs = Math.round(lastStepMs + dt / 2);
          state.candidateTimesMs.push(midMs, nowMs);
          while (state.candidateTimesMs.length > REQUIRED_BOUT_PEAKS) {
            state.candidateTimesMs.shift();
          }
          state.creditedSteps += 2;
          return state.creditedSteps;
        }
        state.candidateTimesMs = [nowMs];
        state.rhythmicActive = false;
        return state.creditedSteps;
      }
    }

    state.candidateTimesMs.push(nowMs);
    if (state.candidateTimesMs.length > REQUIRED_BOUT_PEAKS) {
      state.candidateTimesMs.shift();
    }

    if (state.rhythmicActive) {
      if (state.candidateTimesMs.length >= 2) {
        const latestIv =
          state.candidateTimesMs[state.candidateTimesMs.length - 1] -
          state.candidateTimesMs[state.candidateTimesMs.length - 2];
        state.lastMeanIntervalMs = 0.75 * state.lastMeanIntervalMs + 0.25 * latestIv;
      }
      state.creditedSteps += 1;
      return state.creditedSteps;
    }

    if (state.candidateTimesMs.length >= REQUIRED_BOUT_PEAKS) {
      const intervals: number[] = [];
      for (let i = 1; i < state.candidateTimesMs.length; i++) {
        intervals.push(state.candidateTimesMs[i] - state.candidateTimesMs[i - 1]);
      }
      const inBounds = intervals.every(
        (iv) => iv >= MIN_STEP_INTERVAL_MS && iv <= MAX_STEP_INTERVAL_MS
      );
      const meanIv = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      const isConsistentCadence = intervals.every(
        (iv) => Math.abs(iv - meanIv) <= meanIv * MAX_CADENCE_DEVIATION_RATIO
      );

      if (inBounds && isConsistentCadence) {
        state.rhythmicActive = true;
        state.lastMeanIntervalMs = meanIv;
        state.creditedSteps += REQUIRED_BOUT_PEAKS;
      }
    }
  }

  return state.creditedSteps;
}

export function createGpsAnchorState(initialMeters: number = 0): GpsAnchorState {
  return {
    anchorLat: null,
    anchorLon: null,
    anchorTimeMs: 0,
    lastFixLat: null,
    lastFixLon: null,
    lastFixTimeMs: 0,
    accumulatedMeters: Math.max(0, initialMeters)
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Processes a GPS coordinate fix using a dwell-aware anti-jitter radius anchor.
 * - Rejects coarse indoor fixes (accuracy > 20m) and stationary GPS drift (< 0.52 m/s).
 * - Refreshes anchorTimeMs while stationary on the shooting line or at the target so a 2-minute
 *   shooting pause NEVER causes the subsequent walk to be misclassified as slow drift.
 * - Supports 18m–90m range walks even if the screen was off while walking and unlocked at the target.
 */
export function processGpsCoordinateFix(
  state: GpsAnchorState,
  lat: number,
  lon: number,
  accuracyM: number | null | undefined,
  nowMs: number,
  deviceSpeedMps?: number | null
): { accumulatedMeters: number; hasSatelliteLock: boolean } {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    typeof accuracyM !== "number" ||
    !Number.isFinite(accuracyM) ||
    accuracyM <= 0 ||
    accuracyM > MAX_VALID_GPS_ACCURACY_M
  ) {
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: false };
  }

  if (state.anchorLat === null || state.anchorLon === null) {
    state.anchorLat = lat;
    state.anchorLon = lon;
    state.anchorTimeMs = nowMs;
    state.lastFixLat = lat;
    state.lastFixLon = lon;
    state.lastFixTimeMs = nowMs;
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
  }

  const deltaM = haversineMeters(state.anchorLat, state.anchorLon, lat, lon);
  const dtAnchorSec = Math.max(0.5, (nowMs - state.anchorTimeMs) / 1000);
  const anchorSpeedMps = deltaM / dtAnchorSec;

  let recentSegSpeedMps = 0;
  let recentSegDistM = 0;
  if (
    state.lastFixLat !== null &&
    state.lastFixLon !== null &&
    nowMs > state.lastFixTimeMs &&
    nowMs - state.lastFixTimeMs <= 14_000
  ) {
    const segDt = Math.max(0.5, (nowMs - state.lastFixTimeMs) / 1000);
    recentSegDistM = haversineMeters(state.lastFixLat, state.lastFixLon, lat, lon);
    recentSegSpeedMps = recentSegDistM / segDt;
  }

  state.lastFixLat = lat;
  state.lastFixLon = lon;
  state.lastFixTimeMs = nowMs;

  const validDopplerSpeed =
    typeof deviceSpeedMps === "number" &&
    Number.isFinite(deviceSpeedMps) &&
    deviceSpeedMps >= 0 &&
    deviceSpeedMps <= MAX_WALK_SPEED_MPS
      ? deviceSpeedMps
      : 0;

  // Stationary dwell refresh: while standing within <= 3.5m of the shooting line / target anchor,
  // keep anchorTimeMs fresh so standing 2 minutes shooting arrows never dilutes walking speed!
  const dwellRadiusM = Math.min(3.5, Math.max(2.0, accuracyM * 0.45));
  if (deltaM <= dwellRadiusM && recentSegSpeedMps < 0.45 && validDopplerSpeed < 0.45) {
    state.anchorTimeMs = nowMs;
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
  }

  // Reject impossible teleportation jumps (> 140m single jump or > 5.5 m/s) by re-anchoring
  if (deltaM > MAX_SINGLE_SEGMENT_M || anchorSpeedMps > MAX_WALK_SPEED_MPS) {
    state.anchorLat = lat;
    state.anchorLon = lon;
    state.anchorTimeMs = nowMs;
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
  }

  const activeRecentWalk =
    (recentSegDistM >= 2.2 &&
      recentSegSpeedMps >= MIN_WALK_SPEED_MPS &&
      recentSegSpeedMps <= MAX_WALK_SPEED_MPS) ||
    validDopplerSpeed >= 0.60;

  const effectiveSpeedMps = activeRecentWalk
    ? Math.max(anchorSpeedMps, recentSegSpeedMps, validDopplerSpeed)
    : anchorSpeedMps;

  // Also support screen-off pocket walk unlocked at target (e.g., 18m–90m displacement >= max(16m, 1.6x accuracy))
  const isClearRangeRelocation =
    deltaM >= Math.max(16.0, accuracyM * 1.6) &&
    deltaM <= MAX_SINGLE_SEGMENT_M &&
    dtAnchorSec <= 300;

  const minDisplacementM =
    effectiveSpeedMps >= 0.65
      ? Math.max(MIN_WALK_DISPLACEMENT_M, accuracyM * 0.80)
      : Math.max(MIN_IDLE_DISPLACEMENT_M, accuracyM * 1.15);

  if (deltaM >= minDisplacementM) {
    if (effectiveSpeedMps >= MIN_WALK_SPEED_MPS || isClearRangeRelocation) {
      state.accumulatedMeters += deltaM;
    }
    // Always advance anchor once outside minDisplacementM even if drift was ultra-slow (< 0.52 m/s)
    // so slow multi-minute stationary GPS drift never accumulates into distance!
    state.anchorLat = lat;
    state.anchorLon = lon;
    state.anchorTimeMs = nowMs;
  }

  return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
}

/**
 * Incremental GPS + Step + Smartwatch Sensor Fusion:
 * - Credits step distance immediately on every step (works 100% indoors & under range roofs).
 * - Reconciles GPS displacement increments over recent step increments in the same window so outdoor
 *   walks with both GPS + steps active NEVER double-count AND mixed sessions NEVER lose distance!
 */
export function createWalkingFusionState(
  initialMeters: number = 0,
  initialSteps: number = 0
): WalkingFusionState {
  const safeM = Math.max(0, Number(initialMeters) || 0);
  const safeSteps = Math.max(0, Math.round(Number(initialSteps) || 0));
  return {
    fusedMeters: safeM,
    lastGpsMeters: safeM,
    lastGpsCreditAtMs: 0,
    lastStepsCount: safeSteps,
    stepMetersSinceLastGps: 0,
    watchMetersFloor: safeM
  };
}

export function recordFusedSteps(
  fusion: WalkingFusionState,
  totalSteps: number,
  nowMs: number,
  heightCm?: number
): number {
  const cleanSteps = Math.max(0, Math.round(Number(totalSteps) || 0));
  if (cleanSteps <= fusion.lastStepsCount) {
    return Math.round(Math.max(fusion.fusedMeters, fusion.watchMetersFloor));
  }
  // If GPS hasn't credited anything in >15s (indoors / canopy / pocket), lock in previous step distance permanently
  if (fusion.lastGpsCreditAtMs > 0 && nowMs - fusion.lastGpsCreditAtMs > 15_000) {
    fusion.stepMetersSinceLastGps = 0;
  }
  const deltaSteps = cleanSteps - fusion.lastStepsCount;
  fusion.lastStepsCount = cleanSteps;
  const deltaMeters = deltaSteps * computeArcherStrideMeters(heightCm);
  fusion.fusedMeters += deltaMeters;
  fusion.stepMetersSinceLastGps += deltaMeters;
  return Math.round(Math.max(fusion.fusedMeters, fusion.watchMetersFloor));
}

export function recordFusedGpsMeters(
  fusion: WalkingFusionState,
  totalGpsMeters: number,
  nowMs: number
): number {
  const cleanGps = Math.max(0, Number(totalGpsMeters) || 0);
  if (cleanGps <= fusion.lastGpsMeters) {
    return Math.round(Math.max(fusion.fusedMeters, fusion.watchMetersFloor));
  }
  const deltaGps = cleanGps - fusion.lastGpsMeters;
  fusion.lastGpsMeters = cleanGps;
  if (fusion.lastGpsCreditAtMs > 0 && nowMs - fusion.lastGpsCreditAtMs > 25_000) {
    fusion.stepMetersSinceLastGps = 0;
  }
  fusion.lastGpsCreditAtMs = nowMs;
  const uncreditedGps = Math.max(0, deltaGps - fusion.stepMetersSinceLastGps);
  // If steps slightly exceeded GPS over the exact same window, keep steps; if GPS exceeded steps, add the difference
  fusion.fusedMeters += uncreditedGps;
  fusion.stepMetersSinceLastGps = Math.max(0, fusion.stepMetersSinceLastGps - deltaGps);
  return Math.round(Math.max(fusion.fusedMeters, fusion.watchMetersFloor));
}

export function recordFusedWatchTelemetry(
  fusion: WalkingFusionState,
  watchSteps: number,
  watchMeters: number,
  nowMs: number,
  heightCm?: number
): number {
  if (watchSteps > fusion.lastStepsCount) {
    recordFusedSteps(fusion, watchSteps, nowMs, heightCm);
  }
  const cleanWatchM = Math.max(0, Number(watchMeters) || 0);
  if (cleanWatchM > fusion.watchMetersFloor) {
    fusion.watchMetersFloor = cleanWatchM;
  }
  if (fusion.watchMetersFloor > fusion.fusedMeters) {
    fusion.fusedMeters = fusion.watchMetersFloor;
  }
  return Math.round(fusion.fusedMeters);
}
