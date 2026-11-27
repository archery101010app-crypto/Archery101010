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
  personalPrepSec?: number;
  personalAimSec?: number;
  settleScale?: number;
  cycleCalibratedAt?: number;
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

export type AnalysisReleaseDiagnosis = "CLEAN" | "ANTICIPATION" | "DROP";

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
  holdMoa?: number;
  releaseJumpCm: number;
  preBreakCm?: number;
  followThroughPct?: number;
  releaseDiagnosis?: AnalysisReleaseDiagnosis;
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
  avgHoldMoa: number;
  avgFollowThroughPct?: number;
  rhythmStdSeconds: number;
  aimStdSeconds: number;
  rhythmConsistencyPct: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
} {
  if (!shots || shots.length === 0) {
    return {
      shotsCount: 0,
      avgStabilityPct: 0,
      avgPrepSeconds: 0,
      avgAimSeconds: 0,
      avgReleaseJumpCm: 0,
      avgHoldMoa: 0,
      rhythmStdSeconds: 0,
      aimStdSeconds: 0,
      rhythmConsistencyPct: 0
    };
  }
  let sumStab = 0;
  let sumPrep = 0;
  let sumAim = 0;
  let sumRel = 0;
  let sumMoa = 0;
  let sumFt = 0;
  let countFt = 0;
  let sumHr = 0;
  let countHr = 0;
  let maxHr = 0;

  for (const s of shots) {
    sumStab += Number(s.stabilityPct) || 0;
    sumPrep += Number(s.prepSeconds) || 0;
    sumAim += Number(s.aimSeconds) || 0;
    sumRel += Number(s.releaseJumpCm) || 0;
    const distCm = Math.max(1000, (Number(s.distanceM) || 18) * 100);
    const shotMoa =
      typeof s.holdMoa === "number" && s.holdMoa > 0
        ? s.holdMoa
        : Math.atan2(Number(s.swayRadiusCm) || 1.5, distCm) * 3437.7468;
    sumMoa += shotMoa;
    if (typeof s.followThroughPct === "number" && s.followThroughPct > 0) {
      sumFt += s.followThroughPct;
      countFt += 1;
    }
    if (typeof s.heartRateBpm === "number" && s.heartRateBpm >= 30 && s.heartRateBpm <= 245) {
      sumHr += s.heartRateBpm;
      countHr += 1;
      if (s.heartRateBpm > maxHr) maxHr = s.heartRateBpm;
    }
  }

  const n = shots.length;
  const meanAim = sumAim / n;
  const meanTotal = (sumPrep + sumAim) / n;
  let sqTotalDiff = 0;
  let sqAimDiff = 0;
  for (const s of shots) {
    const tot = (Number(s.prepSeconds) || 0) + (Number(s.aimSeconds) || 0);
    const dTot = tot - meanTotal;
    const dAim = (Number(s.aimSeconds) || 0) - meanAim;
    sqTotalDiff += dTot * dTot;
    sqAimDiff += dAim * dAim;
  }
  const rhythmStdSeconds =
    n >= 2 ? Number(Math.sqrt(sqTotalDiff / (n - 1)).toFixed(2)) : 0;
  const aimStdSeconds =
    n >= 2 ? Number(Math.sqrt(sqAimDiff / (n - 1)).toFixed(2)) : 0;
  const rhythmConsistencyPct =
    n >= 2
      ? Math.round(clamp(100 - (rhythmStdSeconds * 22 + aimStdSeconds * 10), 35, 99))
      : 99;

  const avgHr = countHr > 0 ? Math.round(sumHr / countHr) : undefined;
  const avgFt = countFt > 0 ? Math.round(sumFt / countFt) : undefined;
  return {
    shotsCount: n,
    avgStabilityPct: Math.round(sumStab / n),
    avgPrepSeconds: Number((sumPrep / n).toFixed(1)),
    avgAimSeconds: Number((sumAim / n).toFixed(1)),
    avgReleaseJumpCm: Number((sumRel / n).toFixed(1)),
    avgHoldMoa: Number(clamp(sumMoa / n, 0.4, 60).toFixed(1)),
    ...(avgFt ? { avgFollowThroughPct: avgFt } : {}),
    rhythmStdSeconds,
    aimStdSeconds,
    rhythmConsistencyPct,
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
      ? Math.max(windowStart + 700, windowSamples[bestPlateauEndIdx].t - 320)
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
  settleScale?: number;
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
    settleScale: rawSettleScale,
    heartRateBpm
  } = params;
  const settleScale =
    typeof rawSettleScale === "number" && Number.isFinite(rawSettleScale)
      ? clamp(rawSettleScale, 0.55, 1.45)
      : 1.0;

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
  let refGx = 0;
  let refGy = 0;
  let refGz = 0;
  for (const s of refList) {
    refAx += s.ax;
    refAy += s.ay;
    refAz += s.az;
    refGx += typeof s.gx === "number" ? s.gx : 0;
    refGy += typeof s.gy === "number" ? s.gy : 0;
    refGz += typeof s.gz === "number" ? s.gz : 0;
  }
  refAx /= refList.length;
  refAy /= refList.length;
  refAz /= refList.length;
  // Dynamic thermal gyroscope zero-bias estimation from quiet pre-release anchor (clamped to ±2.6 deg/s)
  const biasGx = clamp(refGx / refList.length, -0.045, 0.045);
  const biasGy = clamp(refGy / refList.length, -0.045, 0.045);
  const biasGz = clamp(refGz / refList.length, -0.045, 0.045);
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
  const forePitchWeight = Math.abs(refAz) < 7.5 ? 0.85 : 0.35;
  const faceRadiusCm = getTargetFaceRadiusCm(distanceM, bowType);
  const distCm = Math.max(1000, distanceM * 100);

  // Complementary low-pass tilt + gyro angle integration (rad) relative to anchor equilibrium
  const angles: Array<{
    t: number;
    dtSec: number;
    gx: number;
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

    const curMag = Math.hypot(cur.ax, cur.ay, cur.az);
    const alphaG = Math.abs(curMag - 9.81) > 0.45 ? 0.03 : 0.18;
    smoothAx = (1 - alphaG) * smoothAx + alphaG * cur.ax;
    smoothAy = (1 - alphaG) * smoothAy + alphaG * cur.ay;
    smoothAz = (1 - alphaG) * smoothAz + alphaG * cur.az;

    // 3D Tilt deltas (rad): includes forearm X-axis elevation pitch ((smoothAx - refAx) * forePitchWeight)
    // so vertical bow lift & pre-draw lowering are captured whether the watch face points sideways or up
    const tiltHorizRad = ((smoothAy - refAy) / refNorm) * wristSign * 0.28;
    const tiltVertRad =
      (((smoothAz - refAz) + (smoothAx - refAx) * wristSign * forePitchWeight) / refNorm) * 0.28;

    const gx = (typeof cur.gx === "number" ? cur.gx : 0) - biasGx;
    const gy = (typeof cur.gy === "number" ? cur.gy : 0) - biasGy;
    const gz = (typeof cur.gz === "number" ? cur.gz : 0) - biasGz;
    gyroYaw = 0.88 * (gyroYaw + gz * dtSec * wristSign * 0.28) + 0.12 * tiltHorizRad;
    gyroPitch = 0.88 * (gyroPitch + gy * dtSec * 0.28) + 0.12 * tiltVertRad;

    const linDelta = Math.hypot(cur.ax - smoothAx, cur.ay - smoothAy, cur.az - smoothAz);
    const gyroMag = Math.hypot(gx, gy, gz);
    const gravDelta = Math.hypot(
      smoothAx - anchorGravAx,
      smoothAy - anchorGravAy,
      smoothAz - anchorGravAz
    );

    angles.push({
      t: cur.t,
      dtSec,
      gx,
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
      gx: a.gx,
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
  // & vertical pre-draw sight alignment stay in Preparatory, while natural aiming sway & micro-twitches stay in Aiming.
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
    Math.max(faceRadiusCm * 0.21, anchorMeanRad * 2.05 + faceRadiusCm * 0.06) * settleScale,
    faceRadiusCm * 0.16,
    faceRadiusCm * 0.36
  );
  const gdLimit = clamp(Math.max(0.40, anchorMeanGd * 2.25 + 0.21) * settleScale, 0.36, 1.12);
  const gyLimit = clamp(Math.max(0.084, anchorMeanGy * 2.28 + 0.044) * settleScale, 0.078, 0.20);
  const enLimit = clamp(Math.max(0.70, anchorMeanEn * 2.28 + 0.31) * settleScale, 0.62, 1.44);
  const netDispLimitRad = clamp(Math.max(0.0175, anchorMeanGy * 0.62 + 0.0098) * settleScale, 0.015, 0.032);
  const gravDriftLimit = clamp(Math.max(0.31, anchorMeanGd * 1.78 + 0.19) * settleScale, 0.27, 0.74);
  const monotonicDriftLimitCm = Math.max(settleRadiusCm * 0.90, faceRadiusCm * 0.21 * settleScale);

  const isWindowOutOfAimAt = (endIdx: number): boolean => {
    const pjEnd = targetTraj[endIdx];
    const winEndT = pjEnd.t;
    const winStartT = winEndT - 350;
    let sumRad = 0;
    let sumEnergy = 0;
    let sumGyro = 0;
    let sumGravDelta = 0;
    let sumGxDt = 0;
    let sumGyDt = 0;
    let sumGzDt = 0;
    let pathLen350Cm = 0;
    let oldestIdx = endIdx;
    let wN = 0;
    for (let j = endIdx; j >= 0 && targetTraj[j].t >= winStartT; j--) {
      const pj = targetTraj[j];
      sumRad += Math.hypot(pj.dxCm, pj.dyCm);
      sumEnergy += pj.motionEnergy;
      sumGyro += pj.gyroMag;
      sumGravDelta += pj.gravDelta;
      sumGxDt += pj.gx * pj.dtSec;
      sumGyDt += pj.gy * pj.dtSec;
      sumGzDt += pj.gz * pj.dtSec;
      if (j < endIdx) {
        pathLen350Cm += Math.hypot(
          targetTraj[j + 1].dxCm - pj.dxCm,
          targetTraj[j + 1].dyCm - pj.dyCm
        );
      }
      oldestIdx = j;
      wN++;
    }
    const pjOldest = targetTraj[oldestIdx];
    const meanRad = sumRad / Math.max(1, wN);
    const meanEnergy = sumEnergy / Math.max(1, wN);
    const meanGyro = sumGyro / Math.max(1, wN);
    const meanGravDelta = sumGravDelta / Math.max(1, wN);
    const netGyroDispRad = Math.hypot(sumGxDt, sumGyDt, sumGzDt);
    const gravDrift350 = Math.hypot(
      pjEnd.sAx - pjOldest.sAx,
      pjEnd.sAy - pjOldest.sAy,
      pjEnd.sAz - pjOldest.sAz
    );
    const netDrift350Cm = Math.hypot(pjEnd.dxCm - pjOldest.dxCm, pjEnd.dyCm - pjOldest.dyCm);
    const oldestRadCm = Math.hypot(pjOldest.dxCm, pjOldest.dyCm);
    const directness350 = pathLen350Cm > 0.2 ? netDrift350Cm / pathLen350Cm : 0;
    const isMonotonicApproach =
      oldestRadCm > settleRadiusCm * 0.85 &&
      netDrift350Cm > monotonicDriftLimitCm &&
      directness350 >= 0.82;

    return (
      meanRad > settleRadiusCm ||
      meanGravDelta > gdLimit ||
      meanGyro > gyLimit ||
      meanEnergy > enLimit ||
      netGyroDispRad > netDispLimitRad ||
      gravDrift350 > gravDriftLimit ||
      isMonotonicApproach
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
      // True disjoint hysteresis: verify that ~650ms earlier (> 350ms window + 250ms EMA tail) the archer
      // was ALSO out of Aiming (drawing/lifting/resting), so a single mid-aim clicker twitch can NEVER touch both windows!
      let priorCheckIdx = -1;
      for (let p = i - 1; p >= 0; p--) {
        if (targetTraj[i].t - targetTraj[p].t >= 650) {
          priorCheckIdx = p;
          break;
        }
      }
      const sustainedDeparture = priorCheckIdx < 0 || isWindowOutOfAimAt(priorCheckIdx);
      if (!sustainedDeparture) {
        aimStartIdx = i;
        continue;
      }

      // Pinpoint exact entry sample inside [max(0, i - 8)..end] where wrist settled into true Aiming hold
      let exactSettle = Math.min(targetTraj.length - 3, i + 1);
      const searchFrom = Math.max(0, i - 8);
      for (let k = searchFrom; k < targetTraj.length - 2; k++) {
        const pK = targetTraj[k];
        const pAhead = targetTraj[Math.min(targetTraj.length - 2, k + 2)];
        const rK = Math.hypot(pK.dxCm, pK.dyCm);
        const rAhead = Math.hypot(pAhead.dxCm, pAhead.dyCm);
        if (
          rK <= settleRadiusCm &&
          pK.gravDelta <= gdLimit &&
          pK.gyroMag <= gyLimit &&
          rAhead <= settleRadiusCm &&
          pAhead.gravDelta <= gdLimit &&
          pAhead.gyroMag <= gyLimit
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

    const armClearlyLoweredFromSetUp = targetTraj[i].gravDelta >= 2.25;

    if (meanGyro >= 0.14 || meanEnergy >= 0.35 || sweepCmPerSec >= 9.0 || gravShift >= 0.55) {
      sawActiveRaiseSweep = true;
    } else if (
      sawActiveRaiseSweep &&
      targetTraj[aimStartIdx].t - targetTraj[i].t >= 450 &&
      ((armClearlyLoweredFromSetUp &&
        meanGyro < 0.10 &&
        meanEnergy < 0.24 &&
        sweepCmPerSec < 5.5 &&
        gravShift < 0.30) ||
        (returnedToRestingCal && meanGyro < 0.14 && gravShift < 0.40))
    ) {
      // Sustained 320ms pre-raise lowered rest reached (never breaks on an elevated Set-Up pause!)
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
  let meanAimDx = 0;
  let meanAimDy = 0;
  if (aimSlice.length > 0) {
    for (const p of aimSlice) {
      meanAimDx += p.dxCm;
      meanAimDy += p.dyCm;
    }
    meanAimDx /= aimSlice.length;
    meanAimDy /= aimSlice.length;
  }
  let sumSqCm = 0;
  for (const p of aimSlice) {
    const rx = p.dxCm - meanAimDx;
    const ry = p.dyCm - meanAimDy;
    sumSqCm += rx * rx + ry * ry;
  }
  const rmsSwayCm = aimSlice.length > 0 ? Math.sqrt(sumSqCm / aimSlice.length) : 1.5;
  const swayRadiusCm = Number(clamp(rmsSwayCm, 0.3, faceRadiusCm).toFixed(1));

  // Normalize sway relative to target size so 96% at 18m (~1.4cm) scales fairly across 18m..70m
  const normalizedSwayRatio = rmsSwayCm / faceRadiusCm; // e.g. 1.5cm / 20cm = 0.075
  const stabilityPct = Math.round(clamp(100 - normalizedSwayRatio * 82, 38, 99));

  // Distance-independent Hold Steadiness in MOA (Minutes of Angle) across critical final 1.5s pre-release hold
  const criticalSlice = targetTraj.filter((p) => p.t >= Math.max(tAimStart, tEnd - 1500));
  const moaRefSlice = criticalSlice.length >= 3 ? criticalSlice : aimSlice;
  let critMeanDx = 0;
  let critMeanDy = 0;
  if (moaRefSlice.length > 0) {
    for (const p of moaRefSlice) {
      critMeanDx += p.dxCm;
      critMeanDy += p.dyCm;
    }
    critMeanDx /= moaRefSlice.length;
    critMeanDy /= moaRefSlice.length;
  }
  let critSqCm = 0;
  for (const p of moaRefSlice) {
    const rx = p.dxCm - critMeanDx;
    const ry = p.dyCm - critMeanDy;
    critSqCm += rx * rx + ry * ry;
  }
  const critRmsCm = moaRefSlice.length > 0 ? Math.sqrt(critSqCm / moaRefSlice.length) : rmsSwayCm;
  const holdMoa = Number(clamp(Math.atan2(critRmsCm, distCm) * 3437.7468, 0.4, 60).toFixed(1));

  // Release Jump (cm) & Pre-Break vs Post-Release Follow-Through separation
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

  const preBreakAnchor = targetTraj.filter((p) => p.t >= tEnd - 650 && p.t <= tEnd - 280);
  let pbRefX = meanAimDx;
  let pbRefY = meanAimDy;
  if (preBreakAnchor.length >= 2) {
    pbRefX = preBreakAnchor.reduce((s, p) => s + p.dxCm, 0) / preBreakAnchor.length;
    pbRefY = preBreakAnchor.reduce((s, p) => s + p.dyCm, 0) / preBreakAnchor.length;
  }
  const breakSlice = targetTraj.filter((p) => p.t > tEnd - 280);
  let maxPreBreak = 0.3;
  for (const p of breakSlice) {
    const d = Math.hypot(p.dxCm - pbRefX, p.dyCm - pbRefY);
    if (d > maxPreBreak) maxPreBreak = d;
  }
  const preBreakCm = Number(clamp(maxPreBreak, 0.2, faceRadiusCm * 0.6).toFixed(1));

  const postFollowSamples = sorted.filter((s) => s.t >= tEnd + 80 && s.t <= tEnd + 340);
  let followThroughPct: number | undefined;
  if (postFollowSamples.length >= 2) {
    let fAx = 0;
    let fAy = 0;
    let fAz = 0;
    for (const s of postFollowSamples) {
      fAx += s.ax;
      fAy += s.ay;
      fAz += s.az;
    }
    fAx /= postFollowSamples.length;
    fAy /= postFollowSamples.length;
    fAz /= postFollowSamples.length;
    const followGravDrift = Math.hypot(
      fAx - anchorGravAx,
      fAy - anchorGravAy,
      fAz - anchorGravAz
    );
    followThroughPct = Math.round(
      clamp(100 - Math.max(0, followGravDrift - 0.85) * 9.5, 42, 99)
    );
  }

  const releaseDiagnosis: AnalysisReleaseDiagnosis =
    preBreakCm > faceRadiusCm * 0.16
      ? "ANTICIPATION"
      : typeof followThroughPct === "number" && followThroughPct < 72
      ? "DROP"
      : "CLEAN";

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
    holdMoa,
    releaseJumpCm,
    preBreakCm,
    ...(typeof followThroughPct === "number" ? { followThroughPct } : {}),
    releaseDiagnosis,
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
  const distanceM = Number(raw?.distanceM ?? raw?.d) || 18;
  const bowType: AnalysisBowType =
    raw?.bowType === "Compound" || raw?.bowType === "Recurve" || raw?.bowType === "Barebow"
      ? raw.bowType
      : "Barebow";
  const faceRadiusCm = getTargetFaceRadiusCm(distanceM, bowType);
  const rawPrep = Number(raw?.prepSeconds ?? raw?.prepSec);
  const rawAim = Number(raw?.aimSeconds ?? raw?.aimSec);
  const rawStab = Number(raw?.stabilityPct ?? raw?.stab);
  const rawSway = Number(raw?.swayRadiusCm ?? raw?.swayCm);
  const rawRel = Number(raw?.releaseJumpCm ?? raw?.relCm);
  const rawMoa = Number(raw?.holdMoa ?? raw?.moa);
  const rawBrk = Number(raw?.preBreakCm ?? raw?.brk);
  const rawFt = Number(raw?.followThroughPct ?? raw?.ft);
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
  const distCm = Math.max(1000, distanceM * 100);
  const holdMoa = Number(
    clamp(
      Number.isFinite(rawMoa) && rawMoa > 0
        ? rawMoa
        : Math.atan2(Math.max(0.3, swayRadiusCm), distCm) * 3437.7468,
      0.4,
      60
    ).toFixed(1)
  );
  const preBreakCm =
    Number.isFinite(rawBrk) && rawBrk > 0
      ? Number(clamp(rawBrk, 0.1, 50).toFixed(1))
      : undefined;
  const followThroughPct =
    Number.isFinite(rawFt) && rawFt > 0
      ? Math.round(clamp(rawFt, 35, 100))
      : undefined;
  const rdRaw = raw?.releaseDiagnosis ?? raw?.rd;
  const releaseDiagnosis: AnalysisReleaseDiagnosis =
    rdRaw === "ANTICIPATION" || rdRaw === "A"
      ? "ANTICIPATION"
      : rdRaw === "DROP" || rdRaw === "D"
      ? "DROP"
      : preBreakCm && preBreakCm > faceRadiusCm * 0.16
      ? "ANTICIPATION"
      : followThroughPct && followThroughPct < 72
      ? "DROP"
      : "CLEAN";
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
    distanceM,
    bowType,
    prepSeconds,
    aimSeconds,
    totalSeconds,
    stabilityPct,
    swayRadiusCm,
    holdMoa,
    releaseJumpCm,
    ...(typeof preBreakCm === "number" ? { preBreakCm } : {}),
    ...(typeof followThroughPct === "number" ? { followThroughPct } : {}),
    releaseDiagnosis,
    ...(hrRaw >= 30 && hrRaw <= 245 ? { heartRateBpm: Math.round(hrRaw) } : {}),
    prepPoints: prepPoints.length >= 2 ? prepPoints : [{ x: -0.35, y: 0.38 }, releasePoint],
    aimPoints: aimPoints.length >= 2 ? aimPoints : [releasePoint, releasePoint],
    releasePoint,
    markedImpact: raw?.markedImpact || null
  };
}

/** Encodes a shot into a < 1.2 KB compact JSON string for Wear OS / Cloud Watch transport. */
export function encodeCompactShotAnalysis(shot: AnalysisShotRecord): string {
  const rdCode =
    shot.releaseDiagnosis === "ANTICIPATION"
      ? "A"
      : shot.releaseDiagnosis === "DROP"
      ? "D"
      : "C";
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
    ...(typeof shot.holdMoa === "number" ? { moa: shot.holdMoa } : {}),
    relCm: shot.releaseJumpCm,
    ...(typeof shot.preBreakCm === "number" ? { brk: shot.preBreakCm } : {}),
    ...(typeof shot.followThroughPct === "number" ? { ft: shot.followThroughPct } : {}),
    rd: rdCode,
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
      calibratedAt: Number(parsed.calibratedAt) || Date.now(),
      ...(typeof parsed.personalPrepSec === "number" && parsed.personalPrepSec > 0
        ? { personalPrepSec: Number(clamp(parsed.personalPrepSec, 0.4, 15).toFixed(1)) }
        : {}),
      ...(typeof parsed.personalAimSec === "number" && parsed.personalAimSec > 0
        ? { personalAimSec: Number(clamp(parsed.personalAimSec, 0.5, 25).toFixed(1)) }
        : {}),
      ...(typeof parsed.settleScale === "number" && Number.isFinite(parsed.settleScale)
        ? { settleScale: Number(clamp(parsed.settleScale, 0.55, 1.45).toFixed(3)) }
        : {}),
      ...(typeof parsed.cycleCalibratedAt === "number" && parsed.cycleCalibratedAt > 0
        ? { cycleCalibratedAt: Number(parsed.cycleCalibratedAt) }
        : {})
    };
  } catch {
    return null;
  }
}

/**
 * Refines an incoming watch shot's Prep/Aim split when the archer has completed a 1-shot personal
 * cycle calibration (`cycleCalibratedAt > 0`), keeping total shot duration (`prep + aim`) exact while
 * blending out residual wrist-mount threshold bias.
 */
export function refineShotWithPersonalCycle(
  shot: AnalysisShotRecord,
  calibration?: AnalysisCalibrationProfile | null
): AnalysisShotRecord {
  if (
    !calibration ||
    !calibration.cycleCalibratedAt ||
    typeof calibration.personalPrepSec !== "number" ||
    typeof calibration.personalAimSec !== "number" ||
    calibration.personalPrepSec <= 0 ||
    calibration.personalAimSec <= 0
  ) {
    return shot;
  }
  const total = Number((shot.prepSeconds + shot.aimSeconds).toFixed(1));
  if (total < 1.2) return shot;

  const calTotal = calibration.personalPrepSec + calibration.personalAimSec;
  const calPrepRatio = clamp(calibration.personalPrepSec / Math.max(1.0, calTotal), 0.15, 0.78);
  const rawPrepRatio = shot.prepSeconds / total;
  // Only apply gentle 45% anchor-boundary correction when watch split deviates noticeably from calibrated biomechanics
  if (Math.abs(rawPrepRatio - calPrepRatio) <= 0.08) {
    return shot;
  }
  const blendedRatio = clamp(rawPrepRatio * 0.55 + calPrepRatio * 0.45, 0.14, 0.82);
  const refinedPrep = Number(clamp(total * blendedRatio, 0.4, total - 0.5).toFixed(1));
  const refinedAim = Number(Math.max(0.5, total - refinedPrep).toFixed(1));
  return {
    ...shot,
    prepSeconds: refinedPrep,
    aimSeconds: refinedAim,
    totalSeconds: Number((refinedPrep + refinedAim).toFixed(1))
  };
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
