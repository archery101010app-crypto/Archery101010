// Acoustic Arrow Speed Chronograph Engine (EchoChrono™ Ballistic Model)
// Calculates arrow launch velocity, kinetic energy and momentum based on acoustic time-of-flight at 20 yards.

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
  notes?: string;
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
 * Uses aerodynamic drag modeling over the specified distance (default 20 yards / 18.288 m).
 */
export function calculateArrowSpeed(
  totalTimeSec: number,
  distanceMeters: number = 18.0,
  temperatureCelsius: number = 20,
  arrowMassGrains?: number,
  arrowLengthInches?: number
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
  const soundReturnTimeSec = distanceMeters / speedOfSound;

  // Net arrow flight time = total elapsed time - sound return delay from target face to phone microphone
  const flightTimeSec = Math.max(0.01, totalTimeSec - soundReturnTimeSec);

  // Average velocity over the course of flight
  const speedMps = distanceMeters / flightTimeSec;
  const speedFps = speedMps * 3.28084;
  const speedKmh = speedMps * 3.6;

  // Aerodynamic drag correction for 20 yards to determine true Launch (Muzzle) Speed
  // Standard carbon hunting/target arrows lose approx ~2.0% - 2.5% velocity over 20 yards
  const massRatio = arrowMassGrains ? Math.max(0.7, Math.min(1.4, 400 / arrowMassGrains)) : 1.0;
  const lengthRatio = arrowLengthInches ? Math.max(0.85, Math.min(1.2, arrowLengthInches / 28.5)) : 1.0;
  const dragFactor = 0.021 * massRatio * lengthRatio;

  const launchSpeedFps = speedFps * (1 + dragFactor);
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
 * Web Audio API Peak Detector Helper
 * Analyzes audio buffer data to estimate release click peak and impact thud peak
 */
export function detectAudioPeaks(
  audioBuffer: AudioBuffer,
  distanceMeters: number = 18.0,
  temperatureCelsius: number = 20
): { releaseSec: number; impactSec: number; confidence: number } | null {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const soundSpeed = calculateSpeedOfSound(temperatureCelsius);

  // Theoretical bounds for arrow speeds (120 fps to 360 fps)
  const minFlightTime = distanceMeters / 115; // ~ 370 fps
  const soundReturnTime = distanceMeters / soundSpeed;
  const minTotalTime = minFlightTime + soundReturnTime;

  const maxFlightTime = distanceMeters / 35; // ~ 115 fps
  const maxTotalTime = maxFlightTime + soundReturnTime;

  // Find absolute maximum peak for baseline calibration
  let maxAmp = 0;
  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > maxAmp) maxAmp = abs;
  }

  if (maxAmp < 0.04) return null; // Too quiet, no shot sound

  const threshold = maxAmp * 0.28;
  const windowSize = Math.floor(sampleRate * 0.005); // 5ms window

  // Envelope array
  const envelope: number[] = [];
  for (let i = 0; i < channelData.length; i += windowSize) {
    let sum = 0;
    for (let j = 0; j < windowSize && i + j < channelData.length; j++) {
      sum += Math.abs(channelData[i + j]);
    }
    envelope.push(sum / windowSize);
  }

  // Find first peak above threshold (String Release)
  let releaseIdx = -1;
  for (let k = 0; k < envelope.length; k++) {
    if (envelope[k] > threshold) {
      releaseIdx = k;
      break;
    }
  }

  if (releaseIdx === -1) return null;

  const releaseSec = (releaseIdx * windowSize) / sampleRate;

  // Search for second peak (Target Impact) within expected time window
  const minSearchIdx = releaseIdx + Math.floor((minTotalTime * sampleRate) / windowSize);
  const maxSearchIdx = Math.min(envelope.length - 1, releaseIdx + Math.floor((maxTotalTime * sampleRate) / windowSize));

  let impactIdx = -1;
  let maxImpactVal = 0;

  for (let k = minSearchIdx; k <= maxSearchIdx; k++) {
    if (envelope[k] > maxImpactVal && envelope[k] > maxAmp * 0.18) {
      maxImpactVal = envelope[k];
      impactIdx = k;
    }
  }

  // Fallback: search anywhere after minSearchIdx if initial window had noise
  if (impactIdx === -1) {
    for (let k = minSearchIdx; k < envelope.length; k++) {
      if (envelope[k] > maxImpactVal && envelope[k] > maxAmp * 0.15) {
        maxImpactVal = envelope[k];
        impactIdx = k;
      }
    }
  }

  if (impactIdx === -1 || impactIdx <= releaseIdx) {
    // Default estimated impact peak (~ 275 fps compound bow)
    const defaultTotalTime = (distanceMeters / 83.8) + soundReturnTime;
    return {
      releaseSec: Math.max(0, releaseSec),
      impactSec: Math.max(releaseSec + 0.18, releaseSec + defaultTotalTime),
      confidence: 0.5
    };
  }

  const impactSec = (impactIdx * windowSize) / sampleRate;

  return {
    releaseSec,
    impactSec,
    confidence: 0.90
  };
}
