"use client";

export type WASoundMode = "horn" | "whistle" | "mute";

let globalAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!globalAudioCtx) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        globalAudioCtx = new AudioCtx();
      }
    } catch (e) {
      console.warn("AudioContext initialization error", e);
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === "suspended") {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
}

export function initWAAudio() {
  getAudioContext();
}

/**
 * Plays a single burst of sound based on selected World Archery mode
 */
export function playWABurst(
  mode: WASoundMode,
  freq: number = 780,
  durationSec: number = 0.45,
  volume: number = 0.8
) {
  if (mode === "mute") return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    if (mode === "horn") {
      // WA Electronic Tournament Horn / Buzzer
      // Dual oscillator with square wave & harmonic to produce rich, penetrating arena sound
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(freq, now);

      osc2.type = "square";
      osc2.frequency.setValueAtTime(freq * 1.5, now);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2800, now);

      // Envelope: punchy attack, solid sustain, crisp cutoff
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.9, now + 0.02);
      gainNode.gain.setValueAtTime(volume * 0.9, now + durationSec - 0.03);
      gainNode.gain.linearRampToValueAtTime(0, now + durationSec);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durationSec);
      osc2.stop(now + durationSec);
    } else if (mode === "whistle") {
      // WA Referee Fox40 Style Whistle
      // High pitch with subtle frequency modulation
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gainNode = ctx.createGain();

      const whistleFreq = Math.max(freq, 2400);
      osc.type = "sine";
      osc.frequency.setValueAtTime(whistleFreq, now);

      // Vibrato LFO
      lfo.frequency.setValueAtTime(32, now);
      lfoGain.gain.setValueAtTime(75, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume * 0.7, now + 0.03);
      gainNode.gain.setValueAtTime(volume * 0.7, now + durationSec - 0.04);
      gainNode.gain.linearRampToValueAtTime(0, now + durationSec);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      lfo.start(now);
      osc.start(now);
      lfo.stop(now + durationSec);
      osc.stop(now + durationSec);
    }
  } catch (err) {
    console.warn("Failed to play WA audio burst", err);
  }
}

/**
 * 2 Pitidos: Entrada a la línea de tiro (Preparación 10 segundos)
 */
export function playWA2Beeps(mode: WASoundMode) {
  if (mode === "mute") return;
  playWABurst(mode, 760, 0.42, 0.85);
  setTimeout(() => {
    playWABurst(mode, 760, 0.42, 0.85);
  }, 620);
}

/**
 * 1 Pitido Largo: Inicio del tiempo de tiro (Disparar)
 */
export function playWA1Beep(mode: WASoundMode) {
  if (mode === "mute") return;
  playWABurst(mode, 860, 0.85, 0.95);
}

/**
 * 3 Pitidos: Fin del tiempo de tiro (Detenerse y avanzar a la diana)
 */
export function playWA3Beeps(mode: WASoundMode) {
  if (mode === "mute") return;
  playWABurst(mode, 680, 0.38, 0.85);
  setTimeout(() => {
    playWABurst(mode, 680, 0.38, 0.85);
  }, 560);
  setTimeout(() => {
    playWABurst(mode, 680, 0.38, 0.85);
  }, 1120);
}

/**
 * 5 Pitidos Rápidos: Alto al fuego inmediato / Emergencia en la línea de tiro
 * World Archery Rule: 5 o más pitidos detienen el tiro de inmediato.
 */
export function playWA5EmergencyBeeps(mode: WASoundMode) {
  if (mode === "mute") return;
  const beepDur = 0.22;
  const gap = 340;
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      playWABurst(mode, 920, beepDur, 1.0);
    }, i * gap);
  }
}

/**
 * Alerta de 30 Segundos Restantes
 */
export function playWAWarning30s(mode: WASoundMode) {
  if (mode === "mute") return;
  playWABurst(mode, 540, 0.25, 0.6);
  setTimeout(() => {
    playWABurst(mode, 540, 0.25, 0.6);
  }, 320);
}

/**
 * Prueba de Sonido para altavoz Bluetooth o celular
 */
export function playWATestTone(mode: WASoundMode) {
  const testMode: WASoundMode = mode === "mute" ? "horn" : mode;
  playWABurst(testMode, 820, 0.5, 0.9);
}
