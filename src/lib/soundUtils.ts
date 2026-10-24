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

/**
 * Sonido realista de "clock/click" mecánico de contador de flechas (Tally Counter)
 * Sintetiza la física acústica de un contador manual cromado:
 * 1. Micro-fricción de émbolo (ruido blanco moldeado con filtro pasa-altos).
 * 2. Transitorio percutor de impacto metálico (martillo de acero en alta frecuencia).
 * 3. Resonancia de cavidad interna metálica (cuerpo de acero amortiguado).
 * 4. Chasquido de trinquete de muelle secundario (pawl snap a los 12ms).
 */
export function playRealisticMechanicalClockClick() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // --- Capa 1: Micro-fricción de pulsación metálica (ruido de 5ms) ---
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.005));
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(3200, now);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.005);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(now);

    // --- Capa 2: Golpe percutor metálico principal (Transient Strike) ---
    const strikeOsc = ctx.createOscillator();
    const strikeGain = ctx.createGain();
    strikeOsc.type = "triangle";
    strikeOsc.frequency.setValueAtTime(3600, now);
    strikeOsc.frequency.exponentialRampToValueAtTime(750, now + 0.016);
    strikeGain.gain.setValueAtTime(0.7, now);
    strikeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    strikeOsc.connect(strikeGain);
    strikeGain.connect(ctx.destination);
    strikeOsc.start(now);
    strikeOsc.stop(now + 0.02);

    // --- Capa 3: Resonancia de carcasa metálica (Dual-Band Metal Body) ---
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.setValueAtTime(1350, now);
    bodyFilter.Q.setValueAtTime(9, now);

    bodyOsc.type = "sine";
    bodyOsc.frequency.setValueAtTime(1420, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(620, now + 0.035);
    bodyGain.gain.setValueAtTime(0.5, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.04);

    // --- Capa 4: Salto del trinquete secundario a los 12ms (Spring Pawl Snap) ---
    const snapOsc = ctx.createOscillator();
    const snapGain = ctx.createGain();
    snapOsc.type = "square";
    snapOsc.frequency.setValueAtTime(1050, now + 0.012);
    snapOsc.frequency.exponentialRampToValueAtTime(320, now + 0.024);

    snapGain.gain.setValueAtTime(0, now);
    snapGain.gain.setValueAtTime(0.22, now + 0.012);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.026);

    snapOsc.connect(snapGain);
    snapGain.connect(ctx.destination);
    snapOsc.start(now + 0.012);
    snapOsc.stop(now + 0.03);
  } catch (e) {
    console.warn("[Sound] Failed to play mechanical clock click:", e);
  }
}


