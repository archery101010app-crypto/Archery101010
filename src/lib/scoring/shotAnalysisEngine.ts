/**
 * Archery 101010 — Biomechanical Shot Analysis Engine
 * Pure, deterministic physics & trajectory math for wrist IMU shot capture:
 *  - Preparatory Phase (bow raise / draw entry -> white dashed path + seconds)
 *  - Aiming Phase (anchor hold / micro-tremor -> cyan solid path + seconds)
 *  - Release Point & Follow-Through Jump (last 0.5s displacement in cm)
 *  - Stability Score (0..100% from target-plane RMS sway in cm)
 *  - Live Heart Rate at Release (from Bluetooth LE HR Sensor or Smartwatch, never simulated)
 */

export type AnalysisBowType = "Barebow" | "Recurve" | "Compound";
export type AnalysisBowWrist = "LEFT" | "RIGHT";

export interface AnalysisCalibrationProfile {
  bowType: AnalysisBowType;
  bowWrist: AnalysisBowWrist;
  distanceM: number;
  zeroGravityVec: [number, number, number];
  calibratedAt: number;
}

export interface RawImuSample {
  t: number; // ms
  ax: number; // m/s^2 (including gravity)
  ay: number;
  az: number;
  gx?: number; // rad/s
  gy?: number;
  gz?: number;
}

/** Normalized target-face point where (0,0) = center spider (+) and radius 1.0 = outer edge of Ring 1 */
export interface NormalizedTargetPoint {
  x: number; // -1.15 .. +1.15
  y: number; // -1.15 .. +1.15
}

export interface AnalysisMarkedImpact {
  x: number; // normalized -1 .. +1
  y: number; // normalized -1 .. +1
  scoreLabel: string; // "10 · X", "10", "9", ..., "1", "M"
  ringNumber: number; // 10..0
}

export interface AnalysisShotRecord {
  id: string;
  shotNumber: number;
  timestamp: number;
  distanceM: number;
  bowType: AnalysisBowType;
  prepSeconds: number;
  aimSeconds: number;
  totalSeconds: number;
  stabilityPct: number;
  swayRadiusCm: number;
  releaseJumpCm: number;
  heartRateBpm?: number;
  prepPoints: NormalizedTargetPoint[];
  aimPoints: NormalizedTargetPoint[];
  releasePoint: NormalizedTargetPoint;
  markedImpact?: AnalysisMarkedImpact | null;
}

const CALIBRATION_STORAGE_KEY = "archery101010_analysis_calibration_v1";

/** Official World Archery outer target face radius (cm) for a given shooting distance (m) and bow division. */
export function getTargetFaceRadiusCm(distanceM: number, bowType?: AnalysisBowType): number {
  if (distanceM <= 20) return 20; // 40 cm face at 18m
  if (distanceM <= 26) return 30; // 60 cm face at 25m
  if (distanceM <= 36) return 40; // 80 cm face at 30m
  if (distanceM <= 55) return bowType === "Compound" ? 40 : 61; // Compound 80 cm vs Recurve/Barebow 122 cm at 50m
  return 61; // 122 cm face at 60m / 70m
}

/** Evaluates World Archery 10-zone ring label from normalized coordinates (-1..+1 where 1.0 = outer Ring 1). */
export function evaluateNormalizedTargetImpact(
  nx: number,
  ny: number
): AnalysisMarkedImpact {
  const clampedX = Math.max(-1.08, Math.min(1.08, Number(nx.toFixed(4))));
  const clampedY = Math.max(-1.08, Math.min(1.08, Number(ny.toFixed(4))));
  const r = Math.hypot(clampedX, clampedY);

  if (r <= 0.05) {
    return { x: clampedX, y: clampedY, scoreLabel: "10 · X", ringNumber: 10 };
  }
  if (r <= 0.10) {
    return { x: clampedX, y: clampedY, scoreLabel: "10", ringNumber: 10 };
  }
  if (r > 1.0) {
    return { x: clampedX, y: clampedY, scoreLabel: "M", ringNumber: 0 };
  }
  const zone = Math.max(1, Math.min(9, 10 - Math.floor(r * 10)));
  return {
    x: clampedX,
    y: clampedY,
    scoreLabel: String(zone),
    ringNumber: zone
  };
}

export function isAnalysisSession(session: any): boolean {
  if (!session) return false;
  return (
    session.isAnalysisSession === true ||
    session.practiceType === "Análisis" ||
    session.biometrics?.isAnalysisSession === true
  );
}

export function extractAnalysisShots(session: any): AnalysisShotRecord[] {
  if (!session) return [];
  const rawList = Array.isArray(session.biometrics?.analysisShots)
    ? session.biometrics.analysisShots
    : Array.isArray(session.analysisShots)
    ? session.analysisShots
    : [];

  return rawList
    .filter((item: any) => item && typeof item === "object")
    .map((item: any, idx: number) => normalizeShotRecord(item, idx + 1));
}

export function computeAnalysisSessionSummary(shots: AnalysisShotRecord[]): {
  shotsCount: number;
  avgStabilityPct: number;
  avgPrepSeconds: number;
  avgAimSeconds: number;
  avgReleaseJumpCm: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
} {
  if (!shots || shots.length === 0) {
    return {
      shotsCount: 0,
      avgStabilityPct: 0,
      avgPrepSeconds: 0,
      avgAimSeconds: 0,
      avgReleaseJumpCm: 0
    };
  }
  let sumStab = 0;
  let sumPrep = 0;
  let sumAim = 0;
  let sumRel = 0;
  let sumHr = 0;
  let countHr = 0;
  let maxHr = 0;

  for (const s of shots) {
    sumStab += Number(s.stabilityPct) || 0;
    sumPrep += Number(s.prepSeconds) || 0;
    sumAim += Number(s.aimSeconds) || 0;
    sumRel += Number(s.releaseJumpCm) || 0;
    if (typeof s.heartRateBpm === "number" && s.heartRateBpm >= 30 && s.heartRateBpm <= 245) {
      sumHr += s.heartRateBpm;
      countHr += 1;
      if (s.heartRateBpm > maxHr) maxHr = s.heartRateBpm;
    }
  }

  const n = shots.length;
  const avgHr = countHr > 0 ? Math.round(sumHr / countHr) : undefined;
  return {
    shotsCount: n,
    avgStabilityPct: Math.round(sumStab / n),
    avgPrepSeconds: Number((sumPrep / n).toFixed(1)),
    avgAimSeconds: Number((sumAim / n).toFixed(1)),
    avgReleaseJumpCm: Number((sumRel / n).toFixed(1)),
    ...(avgHr ? { avgHeartRateBpm: avgHr } : {}),
    ...(maxHr >= 30 ? { maxHeartRateBpm: Math.round(maxHr) } : {})
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function downsamplePoints(
  pts: NormalizedTargetPoint[],
  maxPoints: number
): NormalizedTargetPoint[] {
  if (pts.length <= maxPoints) {
    return pts.map((p) => ({
      x: Number(clamp(p.x, -1.12, 1.12).toFixed(3)),
      y: Number(clamp(p.y, -1.12, 1.12).toFixed(3))
    }));
  }
  const result: NormalizedTargetPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(
      pts.length - 1,
      Math.round((i * (pts.length - 1)) / Math.max(1, maxPoints - 1))
    );
    const p = pts[idx];
    result.push({
      x: Number(clamp(p.x, -1.12, 1.12).toFixed(3)),
      y: Number(clamp(p.y, -1.12, 1.12).toFixed(3))
    });
  }
  return result;
}

function getBowReleaseThresholds(bowType: AnalysisBowType): {
  minJerk: number;
  minLinDev: number;
} {
  if (bowType === "Compound") {
    return { minJerk: 4.2, minLinDev: 3.6 };
  }
  if (bowType === "Recurve") {
    return { minJerk: 3.1, minLinDev: 2.7 };
  }
  return { minJerk: 3.6, minLinDev: 3.1 };
}

/**
 * Finds the dominant sustained aiming stillness plateau inside a manual INICIO -> FINAL window
 * so even ultra-damped bows (or late FINAL button presses after lowering the bow arm) anchor
 * `tEnd` at the true end of aiming rather than on the arm-lowering swing.
 */
function detectManualReleaseTimestamp(
  windowSamples: RawImuSample[],
  windowStart: number,
  rawEnd: number,
  bowType: AnalysisBowType,
  zeroGravityVec?: [number, number, number]
): number {
  if (windowSamples.length < 10) {
    return Math.max(windowStart + 500, rawEnd - 120);
  }

  const zNorm =
    Array.isArray(zeroGravityVec) && zeroGravityVec.length === 3
      ? Math.hypot(zeroGravityVec[0], zeroGravityVec[1], zeroGravityVec[2])
      : 0;
  const hasCalZero =
    zNorm >= 6.0 &&
    zNorm <= 13.5 &&
    !(
      Math.abs(zeroGravityVec![0]) < 0.05 &&
      Math.abs(zeroGravityVec![1]) < 0.05 &&
      Math.abs(zeroGravityVec![2] - 9.81) < 0.25
    );
  const calIsAimingPosture =
    hasCalZero &&
    Math.abs(zeroGravityVec![0]) / zNorm <= 0.55 &&
    Math.hypot(zeroGravityVec![1], zeroGravityVec![2]) >= 6.8;
  const calIsRestingPosture = hasCalZero && !calIsAimingPosture;

  const { minJerk, minLinDev } = getBowReleaseThresholds(bowType);

  // Step 1: Evaluate 350ms sliding stillness & horizontal-forearm posture across the window
  const quietMask = new Array<boolean>(windowSamples.length).fill(false);
  let bestPlateauEndIdx = -1;
  let curRunStartIdx = -1;
  let bestPlateauScore = -1;
  let anchorMeanAx = 0;
  let anchorMeanAy = 0;
  let anchorMeanAz = 9.81;

  for (let i = 0; i < windowSamples.length; i++) {
    const tEndWin = windowSamples[i].t;
    const tStartWin = tEndWin - 350;
    let sumLin = 0;
    let sumGyro = 0;
    let sumAx = 0;
    let sumAy = 0;
    let sumAz = 0;
    let minAy = Infinity;
    let maxAy = -Infinity;
    let minAz = Infinity;
    let maxAz = -Infinity;
    let n = 0;
    for (let j = i; j >= 0 && windowSamples[j].t >= tStartWin; j--) {
      const s = windowSamples[j];
      const mag = Math.hypot(s.ax, s.ay, s.az);
      sumLin += Math.abs(mag - 9.81);
      sumGyro += Math.hypot(s.gx || 0, s.gy || 0, s.gz || 0);
      sumAx += s.ax;
      sumAy += s.ay;
      sumAz += s.az;
      if (s.ay < minAy) minAy = s.ay;
      if (s.ay > maxAy) maxAy = s.ay;
      if (s.az < minAz) minAz = s.az;
      if (s.az > maxAz) maxAz = s.az;
      n++;
    }
    if (n < 4) continue;
    const meanLin = sumLin / n;
    const meanGyro = sumGyro / n;
    const mAx = sumAx / n;
    const mAy = sumAy / n;
    const mAz = sumAz / n;
    const gNorm = Math.max(4.0, Math.hypot(mAx, mAy, mAz));
    const forearmVertRatio = Math.abs(mAx) / gNorm;
    const perpGrav = Math.hypot(mAy, mAz);
    const postureValid = forearmVertRatio <= 0.80 && perpGrav >= 5.6;
    const calDist = hasCalZero
      ? Math.hypot(
          mAx - zeroGravityVec![0],
          mAy - zeroGravityVec![1],
          mAz - zeroGravityVec![2]
        )
      : 0;
    // Never reject horizontal aiming when calZero was captured in resting/starting posture ("setear el inicio");
    // instead ensure the arm has genuinely lifted out of resting posture!
    const calMatch = calIsRestingPosture ? calDist >= 1.8 : true;
    const calAimBonus = calIsAimingPosture && calDist <= 3.6 ? 150 : 0;
    const spanOk = maxAy - minAy <= 2.4 && maxAz - minAz <= 2.4;

    if (postureValid && calMatch && spanOk && meanLin <= 1.25 && meanGyro <= 0.48) {
      quietMask[i] = true;
      if (curRunStartIdx < 0) curRunStartIdx = i;
      const runDurMs = windowSamples[i].t - windowSamples[curRunStartIdx].t;
      // Favor sustained aiming plateaus (>= 450ms) that occur after initial lift
      if (runDurMs >= 450 && windowSamples[i].t - windowStart >= 650) {
        const recencyBonus = ((windowSamples[i].t - windowStart) / Math.max(1000, rawEnd - windowStart)) * 350;
        const score = runDurMs + recencyBonus + calAimBonus;
        if (score >= bestPlateauScore) {
          bestPlateauScore = score;
          bestPlateauEndIdx = i;
          anchorMeanAx = mAx;
          anchorMeanAy = mAy;
          anchorMeanAz = mAz;
        }
      }
    } else {
      curRunStartIdx = -1;
    }
  }

  // Step 2: Look for a genuine post-anchor release impulse (preceded by >= 400ms of quiet aiming posture)
  let bestSpikeTs = 0;
  const searchStartMs =
    bestPlateauEndIdx >= 0
      ? Math.max(windowStart + 700, windowSamples[bestPlateauEndIdx].t - 2200)
      : windowStart + 800;

  for (let i = 3; i < windowSamples.length; i++) {
    const s = windowSamples[i];
    if (s.t < searchStartMs) continue;
    if (rawEnd - s.t > 9000) continue;

    let maxJerk = 0;
    for (let k = 1; i - k >= 0 && (k <= 3 || s.t - windowSamples[i - k].t <= 85); k++) {
      const prev = windowSamples[i - k];
      const jump = Math.abs(
        Math.hypot(s.ax, s.ay, s.az) - Math.hypot(prev.ax, prev.ay, prev.az)
      );
      if (jump > maxJerk) maxJerk = jump;
    }
    const magNow = Math.hypot(s.ax, s.ay, s.az);
    const linDev = Math.abs(magNow - 9.81);
    const gyroNow = Math.hypot(s.gx || 0, s.gy || 0, s.gz || 0);
    const effectiveImpulse = linDev + gyroNow * 1.1;

    if (maxJerk < minJerk || effectiveImpulse < minLinDev) continue;

    // Verify the 450ms immediately before this spike [s.t - 500ms .. s.t - 55ms] was in quiet aiming anchor
    let preLinSum = 0;
    let preGyroSum = 0;
    let preAx = 0;
    let preAy = 0;
    let preAz = 0;
    let preN = 0;
    for (let j = i - 1; j >= 0 && windowSamples[j].t >= s.t - 520; j--) {
      if (windowSamples[j].t > s.t - 45) continue;
      const ps = windowSamples[j];
      preLinSum += Math.abs(Math.hypot(ps.ax, ps.ay, ps.az) - 9.81);
      preGyroSum += Math.hypot(ps.gx || 0, ps.gy || 0, ps.gz || 0);
      preAx += ps.ax;
      preAy += ps.ay;
      preAz += ps.az;
      preN++;
    }
    if (preN < 4) continue;
    const preMeanLin = preLinSum / preN;
    const preMeanGyro = preGyroSum / preN;
    if (preMeanLin > 1.35 || preMeanGyro > 0.55) continue;

    if (bestPlateauEndIdx >= 0) {
      const pAx = preAx / preN;
      const pAy = preAy / preN;
      const pAz = preAz / preN;
      const postureDrift = Math.hypot(
        pAx - anchorMeanAx,
        pAy - anchorMeanAy,
        pAz - anchorMeanAz
      );
      // Reject button-tap spikes that happen AFTER the archer already lowered the bow arm!
      if (postureDrift > 3.1) continue;
    }

    // Lock onto the FIRST valid post-anchor release onset so recoil/follow-through samples never leak into preSamples!
    if (bestSpikeTs === 0) {
      let onsetIdx = i;
      while (onsetIdx > 1 && s.t - windowSamples[onsetIdx - 1].t <= 90) {
        const prevS = windowSamples[onsetIdx - 1];
        const prevLin = Math.abs(Math.hypot(prevS.ax, prevS.ay, prevS.az) - 9.81);
        const prevGy = Math.hypot(prevS.gx || 0, prevS.gy || 0, prevS.gz || 0);
        if (prevLin <= 1.2 && prevGy <= 0.45) {
          break;
        }
        onsetIdx--;
      }
      bestSpikeTs = windowSamples[onsetIdx].t;
      break;
    }
  }

  if (bestSpikeTs > 0) {
    return bestSpikeTs;
  }

  // Step 3: Ultra-damped shot with no shock spike -> trim right at the end of the sustained aiming plateau
  if (bestPlateauEndIdx >= 0) {
    return Math.min(rawEnd - 40, windowSamples[bestPlateauEndIdx].t + 35);
  }

  return Math.max(windowStart + 500, rawEnd - 120);
}

/**
 * Reconstructs real 2D target trajectory (Preparatory + Aiming + Release) from a wrist IMU buffer
 * ending at bowstring release (`releaseTimestampMs`).
 */
export function analyzeImuShotWindow(params: {
  samples: RawImuSample[];
  releaseTimestampMs?: number;
  manualStartTimestampMs?: number;
  shotNumber: number;
  distanceM: number;
  bowType: AnalysisBowType;
  bowWrist?: AnalysisBowWrist;
  zeroGravityVec?: [number, number, number];
  heartRateBpm?: number;
}): AnalysisShotRecord | null {
  const {
    samples,
    manualStartTimestampMs,
    shotNumber,
    distanceM = 18,
    bowType = "Barebow",
    bowWrist = "LEFT",
    zeroGravityVec,
    heartRateBpm
  } = params;

  if (!samples || samples.length < 10) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const rawEnd = params.releaseTimestampMs ?? sorted[sorted.length - 1].t;
  const hasExplicitManualWindow =
    typeof manualStartTimestampMs === "number" &&
    manualStartTimestampMs > 0 &&
    rawEnd - manualStartTimestampMs >= 600;

  // In explicit INICIO -> FINAL mode, honor the archer's start timestamp (up to 30s) and trim post-shot arm drop / button tap
  const windowStart = hasExplicitManualWindow
    ? Math.max(rawEnd - 30_000, manualStartTimestampMs as number)
    : rawEnd - 10_000;

  let tEnd = rawEnd;
  if (hasExplicitManualWindow) {
    const windowCandidates = sorted.filter((s) => s.t >= windowStart && s.t <= rawEnd);
    tEnd = detectManualReleaseTimestamp(
      windowCandidates,
      windowStart,
      rawEnd,
      bowType,
      zeroGravityVec
    );
  }

  // Isolate pre-release window (excluding post-release recoil spike > -15ms)
  const preSamples = sorted.filter((s) => s.t >= windowStart && s.t <= tEnd - 15);
  if (preSamples.length < 8) return null;

  // Anchor reference gravity vector = mean of quietest pre-release 600ms window [tEnd - 900ms .. tEnd - 100ms]
  const anchorWindow = preSamples.filter((s) => s.t >= tEnd - 900 && s.t <= tEnd - 100);
  const refList = anchorWindow.length >= 4 ? anchorWindow : preSamples.slice(-8);

  let refAx = 0;
  let refAy = 0;
  let refAz = 0;
  for (const s of refList) {
    refAx += s.ax;
    refAy += s.ay;
    refAz += s.az;
  }
  refAx /= refList.length;
  refAy /= refList.length;
  refAz /= refList.length;
  const anchorGravAx = refAx;
  const anchorGravAy = refAy;
  const anchorGravAz = refAz;

  // Classify zeroGravityVec: only blend into aiming tilt reference if it matches aiming posture;
  // if captured in resting/starting posture ("Apoya el brazo 3s / setear el inicio"), use it for prep onset instead!
  let hasRestingCalZero = false;
  if (
    Array.isArray(zeroGravityVec) &&
    zeroGravityVec.length === 3 &&
    !(
      Math.abs(zeroGravityVec[0]) < 0.05 &&
      Math.abs(zeroGravityVec[1]) < 0.05 &&
      Math.abs(zeroGravityVec[2] - 9.81) < 0.25
    )
  ) {
    const zNorm = Math.hypot(zeroGravityVec[0], zeroGravityVec[1], zeroGravityVec[2]);
    if (zNorm >= 6.0 && zNorm <= 13.5) {
      const distToAnchor = Math.hypot(
        anchorGravAx - zeroGravityVec[0],
        anchorGravAy - zeroGravityVec[1],
        anchorGravAz - zeroGravityVec[2]
      );
      if (distToAnchor <= 2.2) {
        refAx = 0.85 * refAx + 0.15 * zeroGravityVec[0];
        refAy = 0.85 * refAy + 0.15 * zeroGravityVec[1];
        refAz = 0.85 * refAz + 0.15 * zeroGravityVec[2];
      } else if (distToAnchor >= 3.2) {
        hasRestingCalZero = true;
      }
    }
  }
  const refNorm = Math.max(4.0, Math.hypot(refAx, refAy, refAz));

  const wristSign = bowWrist === "RIGHT" ? -1 : 1;
  const faceRadiusCm = getTargetFaceRadiusCm(distanceM, bowType);
  const distCm = Math.max(1000, distanceM * 100);

  // Complementary low-pass tilt + gyro angle integration (rad) relative to anchor equilibrium
  const angles: Array<{
    t: number;
    dtSec: number;
    gy: number;
    gz: number;
    sAx: number;
    sAy: number;
    sAz: number;
    yawRad: number;
    pitchRad: number;
    motionEnergy: number;
    gyroMag: number;
    gravDelta: number;
  }> = [];
  let smoothAx = preSamples[0].ax;
  let smoothAy = preSamples[0].ay;
  let smoothAz = preSamples[0].az;
  let gyroYaw = 0;
  let gyroPitch = 0;

  for (let i = 0; i < preSamples.length; i++) {
    const cur = preSamples[i];
    const dtSec =
      i > 0 ? clamp((cur.t - preSamples[i - 1].t) / 1000, 0.002, 0.12) : 0.02;

    smoothAx = 0.82 * smoothAx + 0.18 * cur.ax;
    smoothAy = 0.82 * smoothAy + 0.18 * cur.ay;
    smoothAz = 0.82 * smoothAz + 0.18 * cur.az;

    // Tilt deltas (rad) orthogonal to gravity reference
    const tiltHorizRad = ((smoothAy - refAy) / refNorm) * wristSign * 0.28;
    const tiltVertRad = ((smoothAz - refAz) / refNorm) * 0.28;

    const gz = typeof cur.gz === "number" ? cur.gz : 0;
    const gy = typeof cur.gy === "number" ? cur.gy : 0;
    gyroYaw = 0.92 * (gyroYaw + gz * dtSec * wristSign * 0.35) + 0.08 * tiltHorizRad;
    gyroPitch = 0.92 * (gyroPitch + gy * dtSec * 0.35) + 0.08 * tiltVertRad;

    const linDelta = Math.hypot(cur.ax - smoothAx, cur.ay - smoothAy, cur.az - smoothAz);
    const gyroMag = Math.hypot(cur.gx || 0, gy, gz);
    const gravDelta = Math.hypot(
      smoothAx - anchorGravAx,
      smoothAy - anchorGravAy,
      smoothAz - anchorGravAz
    );

    angles.push({
      t: cur.t,
      dtSec,
      gy,
      gz,
      sAx: smoothAx,
      sAy: smoothAy,
      sAz: smoothAz,
      yawRad: tiltHorizRad * 0.65 + gyroYaw * 0.35,
      pitchRad: tiltVertRad * 0.65 + gyroPitch * 0.35,
      motionEnergy: linDelta + gyroMag * 1.6,
      gyroMag,
      gravDelta
    });
  }

  // Zero-center final aiming centroid near target center so wrist-mount offset doesn't bias ring center,
  // while preserving 100% of real entry path, sway amplitude, drift, and release jump!
  const finalAimSlice = angles.filter((a) => a.t >= tEnd - 1200);
  const centerRef = finalAimSlice.length >= 3 ? finalAimSlice : angles.slice(-5);
  const meanYaw = centerRef.reduce((s, a) => s + a.yawRad, 0) / centerRef.length;
  const meanPitch = centerRef.reduce((s, a) => s + a.pitchRad, 0) / centerRef.length;

  const targetTraj = angles.map((a) => {
    const dxCm = Math.tan(a.yawRad - meanYaw) * distCm;
    const dyCm = Math.tan(a.pitchRad - meanPitch) * distCm;
    return {
      t: a.t,
      dtSec: a.dtSec,
      gy: a.gy,
      gz: a.gz,
      sAx: a.sAx,
      sAy: a.sAy,
      sAz: a.sAz,
      dxCm,
      dyCm,
      nx: clamp(dxCm / faceRadiusCm, -1.08, 1.08),
      ny: clamp(dyCm / faceRadiusCm, -1.08, 1.08),
      motionEnergy: a.motionEnergy,
      gyroMag: a.gyroMag,
      gravDelta: a.gravDelta
    };
  });

  // Compute adaptive pre-release anchor baseline [tEnd - 850ms .. tEnd - 100ms] so slow horizontal bow draw
  // & sight alignment are separated into Preparatory, while natural aiming sway & micro-twitches stay in Aiming.
  const preRelBaseline = targetTraj.filter((p) => p.t >= tEnd - 850 && p.t <= tEnd - 100);
  const baseRef = preRelBaseline.length >= 4 ? preRelBaseline : targetTraj.slice(-6);
  const anchorMeanGd =
    baseRef.reduce((s, p) => s + p.gravDelta, 0) / Math.max(1, baseRef.length);
  const anchorMeanGy =
    baseRef.reduce((s, p) => s + p.gyroMag, 0) / Math.max(1, baseRef.length);
  const anchorMeanEn =
    baseRef.reduce((s, p) => s + p.motionEnergy, 0) / Math.max(1, baseRef.length);
  const anchorMeanRad =
    baseRef.reduce((s, p) => s + Math.hypot(p.dxCm, p.dyCm), 0) / Math.max(1, baseRef.length);

  const settleRadiusCm = clamp(
    Math.max(faceRadiusCm * 0.30, anchorMeanRad * 2.1 + faceRadiusCm * 0.08),
    faceRadiusCm * 0.30,
    faceRadiusCm * 0.42
  );
  const gdLimit = clamp(Math.max(0.85, anchorMeanGd * 2.2 + 0.35), 0.85, 1.65);
  const gyLimit = clamp(Math.max(0.19, anchorMeanGy * 2.2 + 0.08), 0.19, 0.32);
  const enLimit = clamp(Math.max(0.95, anchorMeanEn * 2.3 + 0.38), 0.95, 1.65);
  const netDispLimitRad = 0.044;

  const isWindowOutOfAimAt = (endIdx: number): boolean => {
    const winEndT = targetTraj[endIdx].t;
    const winStartT = winEndT - 350;
    let sumRad = 0;
    let sumEnergy = 0;
    let sumGyro = 0;
    let sumGravDelta = 0;
    let sumGyDt = 0;
    let sumGzDt = 0;
    let wN = 0;
    for (let j = endIdx; j >= 0 && targetTraj[j].t >= winStartT; j--) {
      const pj = targetTraj[j];
      sumRad += Math.hypot(pj.dxCm, pj.dyCm);
      sumEnergy += pj.motionEnergy;
      sumGyro += pj.gyroMag;
      sumGravDelta += pj.gravDelta;
      sumGyDt += pj.gy * pj.dtSec;
      sumGzDt += pj.gz * pj.dtSec;
      wN++;
    }
    const meanRad = sumRad / Math.max(1, wN);
    const meanEnergy = sumEnergy / Math.max(1, wN);
    const meanGyro = sumGyro / Math.max(1, wN);
    const meanGravDelta = sumGravDelta / Math.max(1, wN);
    const netGyroDispRad = Math.hypot(sumGyDt, sumGzDt);
    return (
      meanRad > settleRadiusCm ||
      meanGravDelta > gdLimit ||
      meanGyro > gyLimit ||
      meanEnergy > enLimit ||
      netGyroDispRad > netDispLimitRad
    );
  };

  // Start backward scan ~80ms before release so rising release-recoil frames at the tail never trip outOfAimWindow
  let scanStartIdx = targetTraj.length - 1;
  while (scanStartIdx > 4 && tEnd - targetTraj[scanStartIdx].t < 80) {
    scanStartIdx--;
  }
  let aimStartIdx = Math.max(0, Math.min(scanStartIdx, targetTraj.length - 4));
  for (let i = scanStartIdx; i >= 0; i--) {
    if (isWindowOutOfAimAt(i)) {
      // True hysteresis: verify that ~450ms earlier the archer was ALSO out of Aiming (drawing/lifting/resting),
      // so a brief mid-aim clicker check or wind gust preceded by steady Aiming never splits Aiming!
      let priorCheckIdx = -1;
      for (let p = i - 1; p >= 0; p--) {
        if (targetTraj[i].t - targetTraj[p].t >= 450) {
          priorCheckIdx = p;
          break;
        }
      }
      const sustainedDeparture = priorCheckIdx < 0 || isWindowOutOfAimAt(priorCheckIdx);
      if (!sustainedDeparture) {
        aimStartIdx = i;
        continue;
      }

      // Pinpoint exact entry sample inside [i..end] where wrist settled into anchor
      let exactSettle = Math.min(targetTraj.length - 3, i + 1);
      for (let k = i; k < targetTraj.length - 2; k++) {
        const rK = Math.hypot(targetTraj[k].dxCm, targetTraj[k].dyCm);
        if (
          rK <= settleRadiusCm &&
          targetTraj[k].gravDelta <= gdLimit &&
          targetTraj[k].gyroMag <= gyLimit
        ) {
          exactSettle = k;
          break;
        }
      }
      aimStartIdx = exactSettle;
      break;
    }
    aimStartIdx = i;
  }

  // Detect Preparatory Raise Start & Trim Idle Pre-Raise Dead Time:
  // Walking backwards from aimStartIdx across the active bow-raise / draw sweep,
  // stop as soon as a sustained 320ms window returns to pre-raise rest (ignoring idle wait after pressing INICIO).
  let prepStartIdx = Math.max(0, aimStartIdx - 1);
  const maxPrepLookbackMs = hasExplicitManualWindow ? 10_000 : 5_000;
  let earliestFloorIdx = 0;
  for (let i = 0; i < aimStartIdx; i++) {
    if (targetTraj[aimStartIdx].t - targetTraj[i].t <= maxPrepLookbackMs) {
      earliestFloorIdx = i;
      break;
    }
  }

  prepStartIdx = earliestFloorIdx;
  let sawActiveRaiseSweep = false;
  for (let i = aimStartIdx - 1; i >= earliestFloorIdx; i--) {
    const winEndT = targetTraj[i].t;
    const winStartT = winEndT - 320;
    let sumEnergy = 0;
    let sumGyro = 0;
    let oldestIdx = i;
    let wN = 0;
    for (let j = i; j >= 0 && targetTraj[j].t >= winStartT; j--) {
      sumEnergy += targetTraj[j].motionEnergy;
      sumGyro += targetTraj[j].gyroMag;
      oldestIdx = j;
      wN++;
    }
    const meanEnergy = sumEnergy / Math.max(1, wN);
    const meanGyro = sumGyro / Math.max(1, wN);
    const dtSpanSec = Math.max(0.05, (targetTraj[i].t - targetTraj[oldestIdx].t) / 1000);
    const sweepCmPerSec =
      Math.hypot(
        targetTraj[i].dxCm - targetTraj[oldestIdx].dxCm,
        targetTraj[i].dyCm - targetTraj[oldestIdx].dyCm
      ) / dtSpanSec;
    const gravShift = Math.hypot(
      targetTraj[i].sAx - targetTraj[oldestIdx].sAx,
      targetTraj[i].sAy - targetTraj[oldestIdx].sAy,
      targetTraj[i].sAz - targetTraj[oldestIdx].sAz
    );
    const returnedToRestingCal =
      hasRestingCalZero &&
      Math.hypot(
        targetTraj[i].sAx - zeroGravityVec![0],
        targetTraj[i].sAy - zeroGravityVec![1],
        targetTraj[i].sAz - zeroGravityVec![2]
      ) <= 1.65;

    if (meanGyro >= 0.14 || meanEnergy >= 0.35 || sweepCmPerSec >= 9.0 || gravShift >= 0.55) {
      sawActiveRaiseSweep = true;
    } else if (
      sawActiveRaiseSweep &&
      targetTraj[aimStartIdx].t - targetTraj[i].t >= 450 &&
      ((meanGyro < 0.10 && meanEnergy < 0.24 && sweepCmPerSec < 5.5 && gravShift < 0.30) ||
        (returnedToRestingCal && meanGyro < 0.14 && gravShift < 0.40))
    ) {
      // Sustained 320ms pre-raise idle rest reached -> trim all earlier dead time!
      prepStartIdx = Math.min(aimStartIdx - 1, i + 1);
      break;
    }
    prepStartIdx = i;
  }

  const tPrepStart = targetTraj[prepStartIdx].t;
  const tAimStart = targetTraj[aimStartIdx].t;
  const rawPrepSec = clamp((tAimStart - tPrepStart) / 1000, 0.4, hasExplicitManualWindow ? 10.0 : 6.5);
  const rawAimSec = clamp((tEnd - tAimStart) / 1000, 0.5, hasExplicitManualWindow ? 24.0 : 14.0);
  const prepSeconds = Number(rawPrepSec.toFixed(1));
  const aimSeconds = Number(rawAimSec.toFixed(1));
  const totalSeconds = Number((prepSeconds + aimSeconds).toFixed(1));

  const aimSlice = targetTraj.slice(aimStartIdx);
  let sumSqCm = 0;
  for (const p of aimSlice) {
    sumSqCm += p.dxCm * p.dxCm + p.dyCm * p.dyCm;
  }
  const rmsSwayCm = aimSlice.length > 0 ? Math.sqrt(sumSqCm / aimSlice.length) : 1.5;
  const swayRadiusCm = Number(clamp(rmsSwayCm, 0.3, faceRadiusCm).toFixed(1));

  // Normalize sway relative to target size so 96% at 18m (~1.4cm) scales fairly across 18m..70m
  const normalizedSwayRatio = rmsSwayCm / faceRadiusCm; // e.g. 1.5cm / 20cm = 0.075
  const stabilityPct = Math.round(clamp(100 - normalizedSwayRatio * 82, 38, 99));

  // Release Jump (cm): peak displacement in the final 0.5s before release relative to pre-release 0.5s anchor
  const lastHalfSec = targetTraj.filter((p) => p.t >= tEnd - 500);
  let releaseJumpCm = 0.6;
  if (lastHalfSec.length >= 2) {
    const startP = lastHalfSec[0];
    let maxDisp = 0;
    for (const p of lastHalfSec) {
      const d = Math.hypot(p.dxCm - startP.dxCm, p.dyCm - startP.dyCm);
      if (d > maxDisp) maxDisp = d;
    }
    releaseJumpCm = Number(clamp(maxDisp, 0.2, faceRadiusCm * 0.6).toFixed(1));
  }

  const rawPrepPts = targetTraj.slice(prepStartIdx, aimStartIdx + 1).map((p) => ({
    x: p.nx,
    y: p.ny
  }));
  const rawAimPts = aimSlice.map((p) => ({ x: p.nx, y: p.ny }));
  const lastPt = rawAimPts[rawAimPts.length - 1] || { x: 0, y: 0 };

  // Ensure Preparatory curve connects smoothly into Aiming start even if brief
  const finalPrepPts =
    rawPrepPts.length >= 2
      ? downsamplePoints(rawPrepPts, 10)
      : [
          {
            x: Number(clamp(lastPt.x - 0.38, -0.95, 0.95).toFixed(3)),
            y: Number(clamp(lastPt.y + 0.42, -0.95, 0.95).toFixed(3))
          },
          rawAimPts[0] || lastPt
        ];
  const finalAimPts = downsamplePoints(rawAimPts.length >= 2 ? rawAimPts : [lastPt, lastPt], 24);

  const validHr =
    typeof heartRateBpm === "number" && heartRateBpm >= 30 && heartRateBpm <= 245
      ? Math.round(heartRateBpm)
      : undefined;

  return {
    id: `SHOT-${tEnd}-${shotNumber}`,
    shotNumber,
    timestamp: tEnd,
    distanceM,
    bowType,
    prepSeconds,
    aimSeconds,
    totalSeconds,
    stabilityPct,
    swayRadiusCm,
    releaseJumpCm,
    ...(validHr ? { heartRateBpm: validHr } : {}),
    prepPoints: finalPrepPts,
    aimPoints: finalAimPts,
    releasePoint: {
      x: Number(lastPt.x.toFixed(3)),
      y: Number(lastPt.y.toFixed(3))
    },
    markedImpact: null
  };
}

export function normalizeShotRecord(raw: any, fallbackShotNumber = 1): AnalysisShotRecord {
  const rawPrep = Number(raw?.prepSeconds ?? raw?.prepSec);
  const rawAim = Number(raw?.aimSeconds ?? raw?.aimSec);
  const rawStab = Number(raw?.stabilityPct ?? raw?.stab);
  const rawSway = Number(raw?.swayRadiusCm ?? raw?.swayCm);
  const rawRel = Number(raw?.releaseJumpCm ?? raw?.relCm);
  const prepSeconds = Number(
    clamp(Number.isFinite(rawPrep) && rawPrep > 0 ? rawPrep : 0, 0, 20).toFixed(1)
  );
  const aimSeconds = Number(
    clamp(Number.isFinite(rawAim) && rawAim > 0 ? rawAim : 0, 0, 30).toFixed(1)
  );
  const totalSeconds = Number((prepSeconds + aimSeconds).toFixed(1));
  const stabilityPct = Math.round(
    clamp(Number.isFinite(rawStab) && rawStab > 0 ? rawStab : 0, 0, 100)
  );
  const swayRadiusCm = Number(
    clamp(Number.isFinite(rawSway) && rawSway > 0 ? rawSway : 0, 0, 60).toFixed(1)
  );
  const releaseJumpCm = Number(
    clamp(Number.isFinite(rawRel) && rawRel > 0 ? rawRel : 0, 0, 50).toFixed(1)
  );
  const hrRaw = Number(raw?.heartRateBpm ?? raw?.bpm) || 0;

  const parsePts = (arr: any): NormalizedTargetPoint[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p: any) => {
        if (Array.isArray(p) && p.length >= 2) {
          return { x: Number(p[0]) || 0, y: Number(p[1]) || 0 };
        }
        if (p && typeof p === "object") {
          return { x: Number(p.x) || 0, y: Number(p.y) || 0 };
        }
        return null;
      })
      .filter((p): p is NormalizedTargetPoint => p !== null);
  };

  const prepPoints = parsePts(raw?.prepPoints ?? raw?.p);
  const aimPoints = parsePts(raw?.aimPoints ?? raw?.a);
  const relRaw = raw?.releasePoint ?? raw?.r;
  const releasePoint: NormalizedTargetPoint = Array.isArray(relRaw)
    ? { x: Number(relRaw[0]) || 0, y: Number(relRaw[1]) || 0 }
    : relRaw && typeof relRaw === "object"
    ? { x: Number(relRaw.x) || 0, y: Number(relRaw.y) || 0 }
    : aimPoints[aimPoints.length - 1] || { x: 0, y: 0 };

  return {
    id: String(raw?.id || `SHOT-${raw?.timestamp || Date.now()}-${fallbackShotNumber}`),
    shotNumber: Number(raw?.shotNumber ?? raw?.n) || fallbackShotNumber,
    timestamp: Number(raw?.timestamp ?? raw?.ts) || Date.now(),
    distanceM: Number(raw?.distanceM ?? raw?.d) || 18,
    bowType:
      raw?.bowType === "Compound" || raw?.bowType === "Recurve" || raw?.bowType === "Barebow"
        ? raw.bowType
        : "Barebow",
    prepSeconds,
    aimSeconds,
    totalSeconds,
    stabilityPct,
    swayRadiusCm,
    releaseJumpCm,
    ...(hrRaw >= 30 && hrRaw <= 245 ? { heartRateBpm: Math.round(hrRaw) } : {}),
    prepPoints: prepPoints.length >= 2 ? prepPoints : [{ x: -0.35, y: 0.38 }, releasePoint],
    aimPoints: aimPoints.length >= 2 ? aimPoints : [releasePoint, releasePoint],
    releasePoint,
    markedImpact: raw?.markedImpact || null
  };
}

/** Encodes a shot into a < 1.2 KB compact JSON string for Wear OS / Cloud Watch transport. */
export function encodeCompactShotAnalysis(shot: AnalysisShotRecord): string {
  const compact = {
    id: shot.id,
    n: shot.shotNumber,
    ts: shot.timestamp,
    d: shot.distanceM,
    bowType: shot.bowType,
    prepSec: shot.prepSeconds,
    aimSec: shot.aimSeconds,
    stab: shot.stabilityPct,
    swayCm: shot.swayRadiusCm,
    relCm: shot.releaseJumpCm,
    ...(shot.heartRateBpm ? { bpm: shot.heartRateBpm } : {}),
    p: downsamplePoints(shot.prepPoints, 10).map((pt) => [
      Number(pt.x.toFixed(3)),
      Number(pt.y.toFixed(3))
    ]),
    a: downsamplePoints(shot.aimPoints, 22).map((pt) => [
      Number(pt.x.toFixed(3)),
      Number(pt.y.toFixed(3))
    ]),
    r: [Number(shot.releasePoint.x.toFixed(3)), Number(shot.releasePoint.y.toFixed(3))]
  };
  return JSON.stringify(compact);
}

export function decodeCompactShotAnalysis(
  jsonStr: string,
  fallbackShotNumber = 1
): AnalysisShotRecord | null {
  if (!jsonStr || typeof jsonStr !== "string") return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeShotRecord(parsed, fallbackShotNumber);
  } catch {
    return null;
  }
}

export function loadSavedAnalysisCalibration(
  defaultBowType?: string,
  defaultDistanceM?: number,
  dominantHand?: string,
  userUid?: string
): AnalysisCalibrationProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const scopedKey = userUid ? `${CALIBRATION_STORAGE_KEY}_${userUid}` : CALIBRATION_STORAGE_KEY;
    const raw =
      localStorage.getItem(scopedKey) ||
      (!userUid ? null : localStorage.getItem(CALIBRATION_STORAGE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.calibratedAt) return null;
    return {
      bowType:
        parsed.bowType === "Compound" || parsed.bowType === "Recurve" || parsed.bowType === "Barebow"
          ? parsed.bowType
          : (defaultBowType as AnalysisBowType) || "Barebow",
      bowWrist:
        parsed.bowWrist === "RIGHT" || parsed.bowWrist === "LEFT"
          ? parsed.bowWrist
          : dominantHand === "L"
          ? "RIGHT"
          : "LEFT",
      distanceM: Number(parsed.distanceM) || defaultDistanceM || 18,
      zeroGravityVec: Array.isArray(parsed.zeroGravityVec) && parsed.zeroGravityVec.length === 3
        ? [
            Number(parsed.zeroGravityVec[0]) || 0,
            Number(parsed.zeroGravityVec[1]) || 0,
            Number(parsed.zeroGravityVec[2]) || 9.81
          ]
        : [0, 0, 9.81],
      calibratedAt: Number(parsed.calibratedAt) || Date.now()
    };
  } catch {
    return null;
  }
}

export function saveAnalysisCalibration(
  profile: AnalysisCalibrationProfile,
  userUid?: string
): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(profile);
    if (userUid) {
      localStorage.setItem(`${CALIBRATION_STORAGE_KEY}_${userUid}`, serialized);
    }
    localStorage.setItem(CALIBRATION_STORAGE_KEY, serialized);
  } catch {}
}
