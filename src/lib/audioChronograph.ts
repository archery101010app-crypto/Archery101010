// Acoustic Arrow Speed Chronograph Engine
// Calculates arrow velocity based on acoustic time-of-flight between string release and target impact.

export interface ShotResult {
  id: string;
  timestamp: number;
  distanceMeters: number;
  distanceYards: number;
  temperatureCelsius: number;
  arrowMassGrains?: number;
  totalTimeSec: number;
  flightTimeSec: number;
  speedMps: number;
  speedFps: number;
  speedKmh: number;
  kineticEnergyFtLbs?: number;
  momentumSlugFtSec?: number;
  releasePeakSec: number;
  impactPeakSec: number;
}

/**
 * Calculates the speed of sound in air in m/s based on temperature in Celsius
 */
export function calculateSpeedOfSound(temperatureCelsius: number = 20): number {
  return 331.3 + 0.606 * temperatureCelsius;
}

/**
 * Calculates arrow flight stats from total time between release and impact sound reception
 * @param totalTimeSec Elapsed time between string release click and impact sound reaching microphone at bow
 * @param distanceMeters Distance from shooter to target in meters
 * @param temperatureCelsius Ambient air temperature in °C
 * @param arrowMassGrains Optional arrow mass in grains (1 gram = 15.4324 grains)
 */
export function calculateArrowSpeed(
  totalTimeSec: number,
  distanceMeters: number,
  temperatureCelsius: number = 20,
  arrowMassGrains?: number
): {
  flightTimeSec: number;
  speedMps: number;
  speedFps: number;
  speedKmh: number;
  soundReturnTimeSec: number;
  kineticEnergyFtLbs?: number;
  momentumSlugFtSec?: number;
} {
  const speedOfSound = calculateSpeedOfSound(temperatureCelsius);
  const soundReturnTimeSec = distanceMeters / speedOfSound;

  // Net arrow flight time = total elapsed time - sound return delay from target to microphone
  const flightTimeSec = Math.max(0.01, totalTimeSec - soundReturnTimeSec);

  // Average velocity = distance / flight time
  const speedMps = distanceMeters / flightTimeSec;
  const speedFps = speedMps * 3.28084;
  const speedKmh = speedMps * 3.6;

  let kineticEnergyFtLbs: number | undefined = undefined;
  let momentumSlugFtSec: number | undefined = undefined;

  if (arrowMassGrains && arrowMassGrains > 0) {
    // Kinetic Energy (ft-lbs) = (mass_in_grains * velocity_in_fps^2) / 450240
    kineticEnergyFtLbs = (arrowMassGrains * Math.pow(speedFps, 2)) / 450240;
    
    // Momentum = (mass_in_grains * velocity_in_fps) / 225120
    momentumSlugFtSec = (arrowMassGrains * speedFps) / 225120;
  }

  return {
    flightTimeSec,
    speedMps,
    speedFps,
    speedKmh,
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
  distanceMeters: number,
  temperatureCelsius: number = 20
): { releaseSec: number; impactSec: number; confidence: number } | null {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const soundSpeed = calculateSpeedOfSound(temperatureCelsius);

  // Theoretical minimum flight time assuming 350 fps (approx max bow speed ~ 100 m/s)
  const minFlightTime = distanceMeters / 110; 
  const soundReturnTime = distanceMeters / soundSpeed;
  const minTotalTime = minFlightTime + soundReturnTime;

  // Theoretical maximum flight time assuming 120 fps (~ 36 m/s)
  const maxFlightTime = distanceMeters / 30;
  const maxTotalTime = maxFlightTime + soundReturnTime;

  // Find absolute maximum peak for initial calibration threshold
  let maxAmp = 0;
  for (let i = 0; i < channelData.length; i++) {
    const abs = Math.abs(channelData[i]);
    if (abs > maxAmp) maxAmp = abs;
  }

  if (maxAmp < 0.05) return null; // Too quiet

  const threshold = maxAmp * 0.25;
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

  // Find first peak above threshold (Release)
  let releaseIdx = -1;
  for (let k = 0; k < envelope.length; k++) {
    if (envelope[k] > threshold) {
      releaseIdx = k;
      break;
    }
  }

  if (releaseIdx === -1) return null;

  const releaseSec = (releaseIdx * windowSize) / sampleRate;

  // Search for second peak (Impact) within expected time window
  const minSearchIdx = releaseIdx + Math.floor((minTotalTime * sampleRate) / windowSize);
  const maxSearchIdx = Math.min(envelope.length - 1, releaseIdx + Math.floor((maxTotalTime * sampleRate) / windowSize));

  let impactIdx = -1;
  let maxImpactVal = 0;

  for (let k = minSearchIdx; k <= maxSearchIdx; k++) {
    if (envelope[k] > maxImpactVal && envelope[k] > maxAmp * 0.15) {
      maxImpactVal = envelope[k];
      impactIdx = k;
    }
  }

  // Fallback: if no peak within range, search anywhere after minSearchIdx
  if (impactIdx === -1) {
    for (let k = minSearchIdx; k < envelope.length; k++) {
      if (envelope[k] > maxImpactVal) {
        maxImpactVal = envelope[k];
        impactIdx = k;
      }
    }
  }

  if (impactIdx === -1 || impactIdx <= releaseIdx) {
    // Default estimated impact peak
    const defaultTotalTime = (distanceMeters / 60) + soundReturnTime; // ~ 200 fps estimate
    return {
      releaseSec: Math.max(0, releaseSec),
      impactSec: Math.max(releaseSec + 0.1, releaseSec + defaultTotalTime),
      confidence: 0.5
    };
  }

  const impactSec = (impactIdx * windowSize) / sampleRate;

  return {
    releaseSec,
    impactSec,
    confidence: 0.85
  };
}
