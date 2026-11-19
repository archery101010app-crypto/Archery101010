/**
 * Pure Biomechanical Walking Gait + Anti-Drift GPS Displacement Tracker
 *
 * Guarantees 0 meters when seated, standing on the shooting line, drawing a bow,
 * tilting the phone, or tapping arrows on screen, while accurately tracking real
 * downrange walking trips (e.g., 18m–70m target walks).
 */

export interface GaitDetectorState {
  gravityMag: number;
  smoothLinear: number;
  armedForPeak: boolean;
  peakSeenInCycle: boolean;
  candidateTimesMs: number[];
  rhythmicActive: boolean;
  lastTouchMs: number;
  creditedSteps: number;
}

export interface GpsAnchorState {
  anchorLat: number | null;
  anchorLon: number | null;
  anchorTimeMs: number;
  accumulatedMeters: number;
}

const TOUCH_LOCKOUT_MS = 1800;
const STEP_PEAK_MPS2 = 1.85;
const STEP_VALLEY_MPS2 = -0.80;
const MIN_STEP_INTERVAL_MS = 360;
const MAX_STEP_INTERVAL_MS = 950;
const BOUT_BREAK_MS = 1500;
const REQUIRED_BOUT_PEAKS = 6; // 6 consecutive rhythmic steps (~4.5m) before unlocking
const MAX_CADENCE_DEVIATION_RATIO = 0.24;

const MAX_VALID_GPS_ACCURACY_M = 14;
const MIN_ANCHOR_DISPLACEMENT_M = 8.0;
const MIN_WALK_SPEED_MPS = 0.55;
const MAX_WALK_SPEED_MPS = 5.5;

export function createGaitDetectorState(initialSteps: number = 0): GaitDetectorState {
  return {
    gravityMag: 9.81,
    smoothLinear: 0,
    armedForPeak: true,
    peakSeenInCycle: false,
    candidateTimesMs: [],
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

  // Require full bipedal sinusoidal cycle: Peak (>= +1.85 m/s²) followed by Valley (<= -0.80 m/s²)
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
 * Processes a GPS coordinate fix using an anti-jitter radius anchor.
 * Indoor / coarse fixes (accuracy > 14m) and stationary GPS drift are strictly rejected.
 */
export function processGpsCoordinateFix(
  state: GpsAnchorState,
  lat: number,
  lon: number,
  accuracyM: number | null | undefined,
  nowMs: number
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
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
  }

  const deltaM = haversineMeters(state.anchorLat, state.anchorLon, lat, lon);
  const dtSec = Math.max(0.5, (nowMs - state.anchorTimeMs) / 1000);
  const speedMps = deltaM / dtSec;

  // Reject teleportation jumps (> 60m single jump or > 5.5 m/s) by re-anchoring without adding fake distance
  if (deltaM > 60 || speedMps > MAX_WALK_SPEED_MPS) {
    state.anchorLat = lat;
    state.anchorLon = lon;
    state.anchorTimeMs = nowMs;
    return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
  }

  const minDisplacementM = Math.max(MIN_ANCHOR_DISPLACEMENT_M, accuracyM * 1.25);
  if (deltaM >= minDisplacementM) {
    if (speedMps >= MIN_WALK_SPEED_MPS) {
      state.accumulatedMeters += deltaM;
    }
    // Always advance anchor once outside minDisplacementM even if drift was ultra-slow (< 0.55 m/s)
    // so slow multi-minute GPS drift never accumulates into a step!
    state.anchorLat = lat;
    state.anchorLon = lon;
    state.anchorTimeMs = nowMs;
  }

  return { accumulatedMeters: state.accumulatedMeters, hasSatelliteLock: true };
}
