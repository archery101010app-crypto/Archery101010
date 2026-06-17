"use client";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("AudioContext is only available in browser env");
  }
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * 1 Pitido agudo (1000Hz, 300ms) - Señal de Tiro Oficial WA
 */
export function playWABeepStart() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1000, ctx.currentTime);

    // Smooth envelope to avoid speaker clicks
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
    gain.gain.setValueAtTime(0.5, ctx.currentTime + 0.28);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn("[Sound] Failed to play start beep:", e);
  }
}

/**
 * 1 Pitido corto (800Hz, 80ms) - Alerta de Tiempo Limite
 */
export function playWABeepWarning() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.01);
    gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.07);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {
    console.warn("[Sound] Failed to play warning beep:", e);
  }
}

/**
 * 3 Pitidos cortos (1000Hz, 120ms cada uno, pausa 100ms) - Fin de Turno WA
 */
export function playWABeepEnd() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Generate 3 sequential oscillators/gain envelopes
    for (let i = 0; i < 3; i++) {
      const startTime = now + i * 0.22; // 120ms sound + 100ms pause
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(1000, startTime);

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.02);
      gain.gain.setValueAtTime(0.5, startTime + 0.10);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.12);
    }
  } catch (e) {
    console.warn("[Sound] Failed to play end beep:", e);
  }
}

/**
 * Ruido blanco filtrado (250ms) - Efecto estática Walkie-Talkie
 */
export function playRadioStatic() {
  try {
    const ctx = getAudioContext();
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill with random noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Crunch filter (bandpass filter centered around 1200Hz)
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.03);
    gain.gain.setValueAtTime(0.15, ctx.currentTime + 0.20);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
    noise.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn("[Sound] Failed to play radio static:", e);
  }
}

let ringInterval: any = null;
let activeRingOscillators: { osc1: OscillatorNode; osc2: OscillatorNode; gainNode: GainNode }[] = [];

/**
 * Inicia el repique de llamada en bucle (tono dual oscilatorio 400Hz + 450Hz)
 */
export function startRingingSound() {
  stopRingingSound();
  try {
    const ctx = getAudioContext();
    const playRing = () => {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(400, now);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(450, now);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.25, now + 0.05);
      gainNode.gain.setValueAtTime(0.25, now + 1.2);
      gainNode.gain.linearRampToValueAtTime(0, now + 1.3);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 1.3);
      osc2.start(now);
      osc2.stop(now + 1.3);

      const item = { osc1, osc2, gainNode };
      activeRingOscillators.push(item);
      setTimeout(() => {
        activeRingOscillators = activeRingOscillators.filter((i) => i !== item);
      }, 1500);
    };

    playRing();
    ringInterval = setInterval(playRing, 3000);
  } catch (e) {
    console.warn("[Sound] Failed to play ringing sound:", e);
  }
}

/**
 * Detiene el repique de llamada
 */
export function stopRingingSound() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  activeRingOscillators.forEach((item) => {
    try {
      item.osc1.stop();
      item.osc2.stop();
      item.gainNode.disconnect();
    } catch (e) {}
  });
  activeRingOscillators = [];
}

