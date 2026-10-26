// Acoustic Arrow Speed Chronograph Engine (101010 Chronograph Ballistic Model)
// Calculates arrow launch velocity, kinetic energy and momentum based on acoustic time-of-flight at 18 meters.

export interface ShotResult {
  id: string;
  timestamp: number;
  distanceMeters: number;
  distanceYards: number;
  temperatureCelsius: number;
  temperatureFahrenheit: number;
  arrowMassGrains?: number;
  arrowLengthInches?: number;
  totalTimeSec: number;
  flightTimeSec: number;
  soundReturnTimeSec?: number;
  speedMps: number;
  speedFps: number;
  speedKmh: number;
  launchSpeedFps: number;
  launchSpeedMps: number;
  launchSpeedKmh: number;
  kineticEnergyFtLbs?: number;
  momentumSlugFtSec?: number;
  releasePeakSec: number;
  impactPeakSec: number;
  confidence?: number;
  waveformBins?: number[];
  releaseBin?: number;
  impactBin?: number;
  notes?: string;
}

export interface PeakDetectionResult {
  status: "OK" | "NO_RELEASE" | "NO_IMPACT";
  releaseSec: number;
  impactSec: number;
  totalTimeSec: number;
  confidence: number;
  releaseAmplitude: number;
  impactAmplitude: number;
  snrDb: number;
  waveformBins?: number[];
  releaseBin?: number;
  impactBin?: number;
  reason?: string;
}

export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5 / 9) * 10) / 10;
}

export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

/**
 * Calculates the speed of sound in air in m/s based on temperature in Celsius
 */
export function calculateSpeedOfSound(temperatureCelsius: number = 20): number {
  return 331.3 + 0.606 * temperatureCelsius;
}

/**
 * Calculates arrow flight stats & launch speed from total time between release and impact sound reception.
 * Accounts for microphone-to-bow offset (default 0.15m / 6 inches) and aerodynamic drag over 18 meters.
 */
export function calculateArrowSpeed(
  totalTimeSec: number,
  distanceMeters: number = 18.0,
  temperatureCelsius: number = 20,
  arrowMassGrains?: number,
  arrowLengthInches?: number,
  micToBowDistanceMeters: number = 0.15
): {
  flightTimeSec: number;
  speedMps: number;
  speedFps: number;
  speedKmh: number;
  launchSpeedFps: number;
  launchSpeedMps: number;
  launchSpeedKmh: number;
  soundReturnTimeSec: number;
  kineticEnergyFtLbs?: number;
  momentumSlugFtSec?: number;
} {
  const speedOfSound = calculateSpeedOfSound(temperatureCelsius);

  // The release sound travels from the bow to the phone (~0.15m),
  // while the impact sound travels from the target face at 18.0m back to the phone.
  // Therefore: Δt_measured = t_flight + (D_target / v_sound) - (d_mic / v_sound)
  const netAcousticDelaySec = Math.max(0, distanceMeters - micToBowDistanceMeters) / speedOfSound;
  const soundReturnTimeSec = netAcousticDelaySec;

  // Net arrow flight time
  const flightTimeSec = Math.max(0.02, totalTimeSec - netAcousticDelaySec);

  // Average velocity over the 18m flight path
  const speedMps = distanceMeters / flightTimeSec;
  const speedFps = speedMps * 3.28084;
  const speedKmh = speedMps * 3.6;

  // Ballistic aerodynamic drag correction over 18m:
  // v(x) = v0 * exp(-k * x) => v_avg ≈ v0 * (1 - 0.5 * k * x) => v0 ≈ v_avg * (1 + 0.5 * k * x)
  // A typical 400gr target arrow loses ~1.8% to 2.2% of its velocity over 18m (avg velocity is ~1.0% lower than launch velocity).
  const massRatio = arrowMassGrains ? Math.max(0.65, Math.min(1.45, 400 / arrowMassGrains)) : 1.0;
  const lengthRatio = arrowLengthInches ? Math.max(0.85, Math.min(1.2, arrowLengthInches / 28.5)) : 1.0;
  const distRatio = distanceMeters / 18.0;
  const avgToLaunchFactor = 0.0115 * distRatio * massRatio * lengthRatio;

  const launchSpeedFps = speedFps * (1 + avgToLaunchFactor);
  const launchSpeedMps = launchSpeedFps / 3.28084;
  const launchSpeedKmh = launchSpeedMps * 3.6;

  let kineticEnergyFtLbs: number | undefined = undefined;
  let momentumSlugFtSec: number | undefined = undefined;

  if (arrowMassGrains && arrowMassGrains > 0) {
    // Kinetic Energy (ft-lbs) = (mass_in_grains * velocity_in_fps^2) / 450240
    kineticEnergyFtLbs = (arrowMassGrains * Math.pow(launchSpeedFps, 2)) / 450240;

    // Momentum = (mass_in_grains * velocity_in_fps) / 225120
    momentumSlugFtSec = (arrowMassGrains * launchSpeedFps) / 225120;
  }

  return {
    flightTimeSec,
    speedMps,
    speedFps,
    speedKmh,
    launchSpeedFps,
    launchSpeedMps,
    launchSpeedKmh,
    soundReturnTimeSec,
    kineticEnergyFtLbs,
    momentumSlugFtSec
  };
}

/**
 * High-Precision Sub-Millisecond Acoustic Transient Peak Detector
 * Analyzes raw Float32Array PCM samples to locate:
 *  1) The bow release transient impulse peak
 *  2) The target impact thud transient impulse peak at 18 meters
 * Never fabricates fake measurements: returns explicit status if release or impact is missing.
 */
export function detectAudioPeaksFromPCM(
  samples: Float32Array,
  sampleRate: number,
  distanceMeters: number = 18.0,
  temperatureCelsius: number = 20,
  micToBowDistanceMeters: number = 0.15
): PeakDetectionResult {
  const soundSpeed = calculateSpeedOfSound(temperatureCelsius);
  const netAcousticDelaySec = Math.max(0, distanceMeters - micToBowDistanceMeters) / soundSpeed;

  // Realistic arrow flight speed bounds:
  // Max speed: 375 FPS (114.3 m/s) -> at 18m, flightTime = 157.5ms + 52ms sound = ~209.5ms total
  // Min speed: 110 FPS (33.5 m/s)  -> at 18m, flightTime = 537.0ms + 52ms sound = ~589.0ms total
  const minFlightTimeSec = distanceMeters / 114.3; // ~375 FPS
  const maxFlightTimeSec = distanceMeters / 33.5;  // ~110 FPS

  const minTotalTimeSec = minFlightTimeSec + netAcousticDelaySec;
  const maxTotalTimeSec = maxFlightTimeSec + netAcousticDelaySec;

  // Use 0.5 ms high-resolution frames (~22-24 samples at 44.1/48kHz)
  const frameDurationSec = 0.0005;
  const frameSize = Math.max(8, Math.floor(sampleRate * frameDurationSec));
  const numFrames = Math.floor(samples.length / frameSize);

  if (numFrames < 200) {
    return {
      status: "NO_RELEASE",
      releaseSec: 0,
      impactSec: 0,
      totalTimeSec: 0,
      confidence: 0,
      releaseAmplitude: 0,
      impactAmplitude: 0,
      snrDb: 0,
      reason: "Grabación demasiado corta para analizar el vuelo."
    };
  }

  // Compute RMS energy and Peak amplitude for each 0.5ms frame
  const framePeak = new Float32Array(numFrames);
  const frameRms = new Float32Array(numFrames);
  let globalMaxPeak = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    let sumSq = 0;
    let maxAbs = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = Math.abs(samples[start + i]);
      if (v > maxAbs) maxAbs = v;
      sumSq += v * v;
    }
    framePeak[f] = maxAbs;
    frameRms[f] = Math.sqrt(sumSq / frameSize);
    if (maxAbs > globalMaxPeak) {
      globalMaxPeak = maxAbs;
    }
  }

  // Estimate ambient noise floor using the 25th percentile of frame RMS
  const sortedRms = Array.from(frameRms).sort((a, b) => a - b);
  const ambientNoiseRms = Math.max(0.0005, sortedRms[Math.floor(sortedRms.length * 0.25)]);

  // Check if there is a real bow shot impulse significantly above ambient noise
  if (globalMaxPeak < 0.025 || globalMaxPeak < ambientNoiseRms * 5.0) {
    return {
      status: "NO_RELEASE",
      releaseSec: 0,
      impactSec: 0,
      totalTimeSec: 0,
      confidence: 0,
      releaseAmplitude: globalMaxPeak,
      impactAmplitude: 0,
      snrDb: 0,
      reason: "No se detectó el sonido de la suelta del arco."
    };
  }

  // 1. Find the Bow Release Impulse:
  // Look for the first major transient that reaches at least 35% of globalMaxPeak
  // AND has a sharp rising edge, then refine to its local maximum within the next 12ms.
  const releaseTriggerLevel = Math.max(ambientNoiseRms * 6.0, globalMaxPeak * 0.35);
  let releaseOnsetFrame = -1;

  // Ensure enough buffer remains after release to capture the impact
  const minFramesAfterRelease = Math.floor(minTotalTimeSec / frameDurationSec);
  const maxReleaseSearchFrame = Math.max(1, numFrames - minFramesAfterRelease - 10);

  for (let f = 1; f < maxReleaseSearchFrame; f++) {
    if (framePeak[f] >= releaseTriggerLevel) {
      releaseOnsetFrame = f;
      break;
    }
  }

  if (releaseOnsetFrame === -1) {
    return {
      status: "NO_RELEASE",
      releaseSec: 0,
      impactSec: 0,
      totalTimeSec: 0,
      confidence: 0,
      releaseAmplitude: globalMaxPeak,
      impactAmplitude: 0,
      snrDb: 0,
      reason: "El disparo ocurrió demasiado tarde en la ventana de captura."
    };
  }

  // Refine release peak to the exact dominant acoustic spike within [releaseOnsetFrame, +10ms]
  const releaseRefineFrames = Math.floor(0.010 / frameDurationSec);
  let releaseFrame = releaseOnsetFrame;
  let releaseMaxAmp = framePeak[releaseOnsetFrame];

  for (
    let f = releaseOnsetFrame;
    f <= Math.min(maxReleaseSearchFrame, releaseOnsetFrame + releaseRefineFrames);
    f++
  ) {
    if (framePeak[f] > releaseMaxAmp) {
      releaseMaxAmp = framePeak[f];
      releaseFrame = f;
    }
  }

  // Refine sample-exact index of the release peak inside releaseFrame
  let exactReleaseSample = releaseFrame * frameSize;
  let sampleMaxR = 0;
  for (let i = 0; i < frameSize; i++) {
    const idx = releaseFrame * frameSize + i;
    const v = Math.abs(samples[idx]);
    if (v > sampleMaxR) {
      sampleMaxR = v;
      exactReleaseSample = idx;
    }
  }
  const releaseSec = exactReleaseSample / sampleRate;

  // 2. Search for the Target Impact Transient within [minTotalTimeSec, maxTotalTimeSec] after release:
  const minImpactFrame = releaseFrame + Math.floor(minTotalTimeSec / frameDurationSec);
  const maxImpactFrame = Math.min(
    numFrames - 2,
    releaseFrame + Math.floor(maxTotalTimeSec / frameDurationSec)
  );

  if (minImpactFrame >= maxImpactFrame) {
    return {
      status: "NO_IMPACT",
      releaseSec,
      impactSec: 0,
      totalTimeSec: 0,
      confidence: 0,
      releaseAmplitude: releaseMaxAmp,
      impactAmplitude: 0,
      snrDb: 0,
      reason: "Ventana de audio insuficiente tras la suelta para captar el impacto."
    };
  }

  // Compute the local background noise floor inside the flight search window
  const searchWindowRms: number[] = [];
  for (let f = minImpactFrame; f <= maxImpactFrame; f++) {
    searchWindowRms.push(frameRms[f]);
  }
  searchWindowRms.sort((a, b) => a - b);
  const localFloorRms = Math.max(
    0.0004,
    searchWindowRms[Math.floor(searchWindowRms.length * 0.45)]
  );
  const localMadRms = Math.max(
    0.0002,
    searchWindowRms[Math.floor(searchWindowRms.length * 0.75)] - localFloorRms
  );

  // Target impact at 18m is a percussive thud:
  // Compute a transient score combining amplitude prominence above local floor and sharp onset derivative
  let bestImpactFrame = -1;
  let bestImpactScore = 0;
  let bestImpactAmp = 0;

  for (let f = minImpactFrame; f <= maxImpactFrame; f++) {
    // Average RMS in the 8ms preceding this frame (pre-onset baseline)
    const preLookback = Math.floor(0.008 / frameDurationSec); // 16 frames
    const preGap = Math.floor(0.0015 / frameDurationSec);     // 3 frames gap
    let preSum = 0;
    let preCount = 0;
    for (let p = Math.max(minImpactFrame - preLookback, f - preLookback); p < f - preGap; p++) {
      preSum += frameRms[p];
      preCount++;
    }
    const preBaseline = preCount > 0 ? preSum / preCount : localFloorRms;

    // Average RMS in the 4ms impulse burst starting at f
    const burstLen = Math.floor(0.004 / frameDurationSec); // 8 frames
    let burstMaxPeak = framePeak[f];
    let burstSumRms = 0;
    let burstCount = 0;
    for (let b = f; b < Math.min(maxImpactFrame, f + burstLen); b++) {
      if (framePeak[b] > burstMaxPeak) burstMaxPeak = framePeak[b];
      burstSumRms += frameRms[b];
      burstCount++;
    }
    const burstRms = burstCount > 0 ? burstSumRms / burstCount : frameRms[f];

    // Onset ratio (how abruptly the sound rises over the immediately preceding 8ms)
    const onsetRatio = burstRms / Math.max(localFloorRms, preBaseline);
    // Prominence above the flight window floor
    const snrOverFloor = (burstMaxPeak - localFloorRms) / Math.max(0.0003, localMadRms);

    // Must be an impulsive jump (onsetRatio >= 1.8) and clearly above the quiet flight floor
    if (onsetRatio >= 1.8 && burstMaxPeak >= localFloorRms * 2.6 && burstMaxPeak >= 0.004) {
      const score = burstMaxPeak * Math.pow(onsetRatio, 1.15);
      if (score > bestImpactScore) {
        bestImpactScore = score;
        bestImpactFrame = f;
        bestImpactAmp = burstMaxPeak;
      }
    }
  }

  if (bestImpactFrame === -1) {
    return {
      status: "NO_IMPACT",
      releaseSec,
      impactSec: 0,
      totalTimeSec: 0,
      confidence: 0,
      releaseAmplitude: releaseMaxAmp,
      impactAmplitude: 0,
      snrDb: 0,
      reason: "Se detectó el disparo pero no se escuchó con claridad el impacto en el parapeto a 18m."
    };
  }

  // Refine bestImpactFrame to the exact peak sample within the 5ms impact burst
  const impactRefineFrames = Math.floor(0.005 / frameDurationSec);
  let refinedImpactFrame = bestImpactFrame;
  let refinedImpactPeak = framePeak[bestImpactFrame];
  for (
    let f = bestImpactFrame;
    f <= Math.min(maxImpactFrame, bestImpactFrame + impactRefineFrames);
    f++
  ) {
    if (framePeak[f] > refinedImpactPeak) {
      refinedImpactPeak = framePeak[f];
      refinedImpactFrame = f;
    }
  }

  let exactImpactSample = refinedImpactFrame * frameSize;
  let sampleMaxI = 0;
  for (let i = 0; i < frameSize; i++) {
    const idx = refinedImpactFrame * frameSize + i;
    const v = Math.abs(samples[idx]);
    if (v > sampleMaxI) {
      sampleMaxI = v;
      exactImpactSample = idx;
    }
  }

  const impactSec = exactImpactSample / sampleRate;
  const totalTimeSec = impactSec - releaseSec;
  const snrDb = Math.round(20 * Math.log10(Math.max(1.1, refinedImpactPeak / localFloorRms)) * 10) / 10;
  const confidence = Math.min(0.99, Math.max(0.65, (snrDb - 6) / 20));

  // Build 80-bin normalized waveform envelope around [releaseFrame - 20ms, refinedImpactFrame + 40ms] for visual oscilloscope
  const numBins = 80;
  const startVisFrame = Math.max(0, releaseFrame - Math.floor(0.025 / frameDurationSec));
  const endVisFrame = Math.min(numFrames - 1, refinedImpactFrame + Math.floor(0.045 / frameDurationSec));
  const visSpan = Math.max(numBins, endVisFrame - startVisFrame);
  const waveformBins: number[] = [];

  for (let b = 0; b < numBins; b++) {
    const f0 = startVisFrame + Math.floor((b * visSpan) / numBins);
    const f1 = Math.max(f0 + 1, startVisFrame + Math.floor(((b + 1) * visSpan) / numBins));
    let binMax = 0;
    for (let f = f0; f < f1 && f < numFrames; f++) {
      if (framePeak[f] > binMax) binMax = framePeak[f];
    }
    // Use non-linear compression (pow 0.55) so both the near-field release and 18m far-field impact are clearly visible
    const norm = Math.min(1, Math.pow(binMax / Math.max(0.01, releaseMaxAmp), 0.55));
    waveformBins.push(Math.round(norm * 100) / 100);
  }

  const releaseBin = Math.min(
    numBins - 1,
    Math.max(0, Math.round(((releaseFrame - startVisFrame) / visSpan) * (numBins - 1)))
  );
  const impactBin = Math.min(
    numBins - 1,
    Math.max(releaseBin + 1, Math.round(((refinedImpactFrame - startVisFrame) / visSpan) * (numBins - 1)))
  );

  return {
    status: "OK",
    releaseSec,
    impactSec,
    totalTimeSec,
    confidence,
    releaseAmplitude: releaseMaxAmp,
    impactAmplitude: refinedImpactPeak,
    snrDb,
    waveformBins,
    releaseBin,
    impactBin
  };
}

/**
 * Legacy AudioBuffer wrapper around detectAudioPeaksFromPCM
 */
export function detectAudioPeaks(
  audioBuffer: AudioBuffer,
  distanceMeters: number = 18.0,
  temperatureCelsius: number = 20
): { releaseSec: number; impactSec: number; confidence: number } | null {
  const channelData = audioBuffer.getChannelData(0);
  const res = detectAudioPeaksFromPCM(channelData, audioBuffer.sampleRate, distanceMeters, temperatureCelsius);
  if (res.status !== "OK") return null;
  return {
    releaseSec: res.releaseSec,
    impactSec: res.impactSec,
    confidence: res.confidence
  };
}
