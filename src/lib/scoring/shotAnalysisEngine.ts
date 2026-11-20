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

/**
 * Reconstructs real 2D target trajectory (Preparatory + Aiming + Release) from a wrist IMU buffer
 * ending at bowstring release (`releaseTimestampMs`).
 */
export function analyzeImuShotWindow(params: {
  samples: RawImuSample[];
  releaseTimestampMs?: number;
  shotNumber: number;
  distanceM: number;
  bowType: AnalysisBowType;
  bowWrist?: AnalysisBowWrist;
  zeroGravityVec?: [number, number, number];
  heartRateBpm?: number;
}): AnalysisShotRecord | null {
  const {
    samples,
    shotNumber,
    distanceM = 18,
    bowType = "Barebow",
    bowWrist = "LEFT",
    zeroGravityVec,
    heartRateBpm
  } = params;

  if (!samples || samples.length < 12) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const tEnd = params.releaseTimestampMs ?? sorted[sorted.length - 1].t;
  // Isolate pre-release window (up to 10.0s before release, excluding post-release recoil spike > -25ms)
  const preSamples = sorted.filter((s) => s.t >= tEnd - 10_000 && s.t <= tEnd - 15);
  if (preSamples.length < 10) return null;

  // Anchor reference gravity vector = mean of quietest pre-release 450ms window [tEnd - 650ms .. tEnd - 120ms]
  const anchorWindow = preSamples.filter((s) => s.t >= tEnd - 700 && s.t <= tEnd - 100);
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
  // Blend calibrated resting zero-gravity baseline (when non-synthetic) to stabilize wrist mount tilt reference
  if (
    Array.isArray(zeroGravityVec) &&
    zeroGravityVec.length === 3 &&
    (Math.abs(zeroGravityVec[0]) > 0.01 || Math.abs(zeroGravityVec[1]) > 0.01)
  ) {
    const zNorm = Math.hypot(zeroGravityVec[0], zeroGravityVec[1], zeroGravityVec[2]);
    if (zNorm >= 4.0 && zNorm <= 15.0) {
      refAx = 0.88 * refAx + 0.12 * zeroGravityVec[0];
      refAy = 0.88 * refAy + 0.12 * zeroGravityVec[1];
      refAz = 0.88 * refAz + 0.12 * zeroGravityVec[2];
    }
  }
  const refNorm = Math.max(4.0, Math.hypot(refAx, refAy, refAz));

  const wristSign = bowWrist === "RIGHT" ? -1 : 1;
  const faceRadiusCm = getTargetFaceRadiusCm(distanceM, bowType);
  const distCm = Math.max(1000, distanceM * 100);

  // Complementary low-pass tilt + gyro angle integration (rad) relative to anchor equilibrium
  const angles: Array<{ t: number; yawRad: number; pitchRad: number; motionEnergy: number }> = [];
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

    angles.push({
      t: cur.t,
      yawRad: tiltHorizRad * 0.65 + gyroYaw * 0.35,
      pitchRad: tiltVertRad * 0.65 + gyroPitch * 0.35,
      motionEnergy: linDelta + gyroMag * 1.6
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
      dxCm,
      dyCm,
      nx: clamp(dxCm / faceRadiusCm, -1.08, 1.08),
      ny: clamp(dyCm / faceRadiusCm, -1.08, 1.08),
      motionEnergy: a.motionEnergy
    };
  });

  // Detect Aim Settle Start: walk backwards from release until target displacement exceeds aim envelope (or motionEnergy spikes during bow raise)
  const settleRadiusCm = faceRadiusCm * 0.36;
  let aimStartIdx = Math.max(0, targetTraj.length - 6);
  for (let i = targetTraj.length - 1; i >= 0; i--) {
    const radialCm = Math.hypot(targetTraj[i].dxCm, targetTraj[i].dyCm);
    if (radialCm > settleRadiusCm || targetTraj[i].motionEnergy > 2.8) {
      aimStartIdx = Math.min(targetTraj.length - 3, i + 1);
      break;
    }
    aimStartIdx = i;
  }

  // Detect Preparatory Raise Start: walk backwards from aimStartIdx across the entire bow-lift/draw sweep
  // until both angular target sweep rate and motionEnergy drop to pre-lift rest (or max 4.5s window).
  let prepStartIdx = Math.max(0, aimStartIdx - 1);
  for (let i = aimStartIdx - 1; i >= 0; i--) {
    if (targetTraj[aimStartIdx].t - targetTraj[i].t > 4500) {
      prepStartIdx = i;
      break;
    }
    const lookbackIdx = Math.max(0, i - 3);
    const dtSpanSec = Math.max(0.04, (targetTraj[i].t - targetTraj[lookbackIdx].t) / 1000);
    const sweepRateCmPerSec =
      Math.hypot(
        targetTraj[i].dxCm - targetTraj[lookbackIdx].dxCm,
        targetTraj[i].dyCm - targetTraj[lookbackIdx].dyCm
      ) / dtSpanSec;
    if (
      aimStartIdx - i > 6 &&
      i > lookbackIdx &&
      sweepRateCmPerSec < 6.0 &&
      targetTraj[i].motionEnergy < 0.22
    ) {
      prepStartIdx = i;
      break;
    }
    prepStartIdx = i;
  }

  const tPrepStart = targetTraj[prepStartIdx].t;
  const tAimStart = targetTraj[aimStartIdx].t;
  const rawPrepSec = clamp((tAimStart - tPrepStart) / 1000, 0.5, 6.5);
  const rawAimSec = clamp((tEnd - tAimStart) / 1000, 0.7, 14.0);
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
