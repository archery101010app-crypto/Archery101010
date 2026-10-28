"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, Mic, Gauge, Trash2, Volume2, Target,
  Info, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  RotateCcw, Save, Smartphone, ExternalLink, Zap, BookOpen, Settings, X, ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { 
  calculateArrowSpeed, 
  detectAudioPeaksFromPCM, 
  ShotResult,
  fahrenheitToCelsius,
  celsiusToFahrenheit
} from "@/lib/audioChronograph";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { triggerHaptic } from "@/lib/haptics";

interface AcousticChronographViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function AcousticChronographView({ user, onBack }: AcousticChronographViewProps) {
  // Configurable Distance: 18m (official default), 10m, or 5m
  const [distanceMeters, setDistanceMeters] = useState<number>(18.0);
  const distanceYards = Math.round(distanceMeters * 1.09361 * 100) / 100;

  // Input specifications states
  const [arrowWeight, setArrowWeight] = useState<string>("420");
  const [arrowLength, setArrowLength] = useState<string>("28.5");
  const [temperature, setTemperature] = useState<string>("70");
  const [tempUnit, setTempUnit] = useState<"F" | "C">("F");

  // Speed unit toggle: FPS vs KM/H
  const [speedUnit, setSpeedUnit] = useState<"FPS" | "KMH">("FPS");

  // Modals for Instructions, Arrow Specs, and Google Play Microphone Disclosure
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showSpecsModal, setShowSpecsModal] = useState(false);
  const [showMicDisclosure, setShowMicDisclosure] = useState(false);
  const [hasAcceptedMicDisclosure, setHasAcceptedMicDisclosure] = useState(false);

  // Active Listening / Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [listenStage, setListenStage] = useState<"IDLE" | "SETTLING" | "ARMED" | "CAPTURING_IMPACT">("IDLE");
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Tooltip helper
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // History logs
  const [shotHistory, setShotHistory] = useState<ShotResult[]>([]);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Temperature calculations
  const tempCelsius = tempUnit === "F" 
    ? fahrenheitToCelsius(Number(temperature) || 70) 
    : (Number(temperature) || 20);

  const tempFahrenheit = tempUnit === "F" 
    ? (Number(temperature) || 70) 
    : celsiusToFahrenheit(Number(temperature) || 20);

  // Load saved specs & history from IndexedDB on mount
  useEffect(() => {
    async function loadInitialData() {
      const logs = await getLocalSetting<ShotResult[]>("chronograph_logs", []);
      setShotHistory(logs);

      const micAccepted = await getLocalSetting<boolean>("accepted_mic_disclosure_v1", false);
      setHasAcceptedMicDisclosure(micAccepted);

      const savedSpecs = await getLocalSetting<any>("chronograph_specs", null);
      if (savedSpecs) {
        if (savedSpecs.arrowWeight) setArrowWeight(String(savedSpecs.arrowWeight));
        if (savedSpecs.arrowLength) setArrowLength(String(savedSpecs.arrowLength));
        if (savedSpecs.temperature) setTemperature(String(savedSpecs.temperature));
        if (savedSpecs.tempUnit) setTempUnit(savedSpecs.tempUnit);
        if (savedSpecs.distanceMeters) setDistanceMeters(Number(savedSpecs.distanceMeters));
      } else if (user.bowConfig?.poundage) {
        const approxWeight = Math.round(user.bowConfig.poundage * 7.5);
        setArrowWeight(String(approxWeight));
      }
    }
    loadInitialData();
  }, [user]);

  // Save specs handler
  const handleSaveSpecs = async (w: string, l: string, t: string, u: "F" | "C", dist: number = distanceMeters) => {
    await saveLocalSetting("chronograph_specs", {
      arrowWeight: Number(w) || 420,
      arrowLength: Number(l) || 28.5,
      temperature: Number(t) || 70,
      tempUnit: u,
      distanceMeters: dist
    });
  };

  const handleToggleTempUnit = () => {
    const nextUnit = tempUnit === "F" ? "C" : "F";
    const curVal = Number(temperature) || 0;
    const converted = tempUnit === "F" 
      ? fahrenheitToCelsius(curVal) 
      : celsiusToFahrenheit(curVal);

    setTempUnit(nextUnit);
    setTemperature(String(converted));
    handleSaveSpecs(arrowWeight, arrowLength, String(converted), nextUnit);
  };

  // Permission request with Google Play Prominent Disclosure
  const handleRequestMeasurement = () => {
    triggerHaptic("tick");
    if (isRecording) {
      stopRecording();
      setDetectionError(null);
      return;
    }
    if (!hasAcceptedMicDisclosure) {
      setShowMicDisclosure(true);
      return;
    }
    startRecording();
  };

  const handleAcceptMicDisclosure = async () => {
    triggerHaptic("confirm");
    setHasAcceptedMicDisclosure(true);
    setShowMicDisclosure(false);
    await saveLocalSetting("accepted_mic_disclosure_v1", true);
    startRecording();
  };

  // Start Raw PCM Audio Listening & Triggered Shot Capture at 18 Meters
  const startRecording = async () => {
    try {
      setDetectionError(null);
      setIsRecording(true);
      setListenStage("SETTLING");

      // Disable AGC, Noise Suppression & Echo Cancellation so percussive bow & target transients are NOT filtered out
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        },
        video: false
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioCtxRef.current = audioCtx;
      const sampleRate = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Volume Meter Loop (Time-Domain Peak Level)
      const timeDomainArray = new Float32Array(analyser.fftSize);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(timeDomainArray);
        let maxPeak = 0;
        for (let i = 0; i < timeDomainArray.length; i++) {
          const abs = Math.abs(timeDomainArray[i]);
          if (abs > maxPeak) maxPeak = abs;
        }
        setAudioLevel(Math.min(100, Math.round(Math.pow(maxPeak, 0.6) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Raw PCM Capture using ScriptProcessorNode (2048 samples ≈ 42ms per callback)
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const startTimeMs = performance.now();
      const settlingGuardMs = 450; // Ignore initial screen tap / finger noise
      const postTriggerDurationSec = 0.72; // 720ms after bow shot covers arrows down to 110 FPS at 18m
      const targetCaptureSamples = Math.ceil(sampleRate * (0.08 + postTriggerDurationSec));

      let isTriggered = false;
      let preTriggerChunk = new Float32Array(Math.ceil(sampleRate * 0.08)); // 80ms pre-trigger rolling buffer
      let capturedChunks: Float32Array[] = [];
      let capturedSampleCount = 0;
      let rollingAmbientRms = 0.004;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(input.length);
        chunk.set(input);

        const elapsedMs = performance.now() - startTimeMs;

        // 1. Settling guard: ignore first 450ms (button tap noise)
        if (elapsedMs < settlingGuardMs) {
          return;
        }

        // Transition UI badge from SETTLING to ARMED
        if (!isTriggered) {
          setListenStage((prev) => (prev === "SETTLING" ? "ARMED" : prev));
        }

        // Compute chunk peak & RMS
        let chunkPeak = 0;
        let sumSq = 0;
        for (let i = 0; i < chunk.length; i++) {
          const v = Math.abs(chunk[i]);
          if (v > chunkPeak) chunkPeak = v;
          sumSq += v * v;
        }
        const chunkRms = Math.sqrt(sumSq / chunk.length);

        if (!isTriggered) {
          // Check if this chunk contains the sharp acoustic impulse of the bow release
          const triggerThreshold = Math.max(0.038, rollingAmbientRms * 5.5);
          if (chunkPeak >= triggerThreshold) {
            isTriggered = true;
            setListenStage("CAPTURING_IMPACT");
            capturedChunks.push(new Float32Array(preTriggerChunk));
            capturedChunks.push(chunk);
            capturedSampleCount = preTriggerChunk.length + chunk.length;
          } else {
            // Update rolling ambient RMS floor & shift pre-trigger buffer
            rollingAmbientRms = rollingAmbientRms * 0.85 + chunkRms * 0.15;
            if (chunk.length >= preTriggerChunk.length) {
              preTriggerChunk.set(chunk.subarray(chunk.length - preTriggerChunk.length));
            } else {
              preTriggerChunk.copyWithin(0, chunk.length);
              preTriggerChunk.set(chunk, preTriggerChunk.length - chunk.length);
            }
          }
        } else {
          // Already triggered by bow shot: accumulate post-shot samples until 720ms window completes
          capturedChunks.push(chunk);
          capturedSampleCount += chunk.length;

          if (capturedSampleCount >= targetCaptureSamples) {
            // Combine chunks into a contiguous Float32Array
            const fullBuffer = new Float32Array(capturedSampleCount);
            let offset = 0;
            for (const c of capturedChunks) {
              fullBuffer.set(c, offset);
              offset += c.length;
            }

            stopRecording();
            processCapturedShotPCM(fullBuffer, sampleRate);
          }
        }
      };

      // Safety timeout: keep listening in ARMED state for up to 20 seconds for the archer to aim & shoot
      timeoutRef.current = setTimeout(() => {
        stopRecording();
        setDetectionError(
          "No se detectó ningún disparo en 20 segundos. Presiona Medir Velocidad cuando estés listo en la línea de tiro."
        );
      }, 20000);
    } catch (err) {
      console.error("Microphone access error:", err);
      alert("No se pudo acceder al micrófono. Por favor permite los permisos de audio en tu teléfono.");
      stopRecording();
    }
  };

  const processCapturedShotPCM = async (pcmSamples: Float32Array, sampleRate: number) => {
    const detection = detectAudioPeaksFromPCM(
      pcmSamples,
      sampleRate,
      distanceMeters,
      tempCelsius,
      0.15
    );

    if (detection.status !== "OK") {
      triggerHaptic("tick");
      setDetectionError(
        detection.reason ||
          "No se pudo distinguir el impacto en la diana a 18m. Asegúrate de que el teléfono esté a 15 cm del arco y que el impacto en el parapeto sea audible."
      );
      return;
    }

    const numWeight = Number(arrowWeight) || 420;
    const numLength = Number(arrowLength) || 28.5;

    const stats = calculateArrowSpeed(
      detection.totalTimeSec,
      distanceMeters,
      tempCelsius,
      numWeight,
      numLength,
      0.15
    );

    const result: ShotResult = {
      id: `SHOT-${Date.now()}`,
      timestamp: Date.now(),
      distanceMeters,
      distanceYards,
      temperatureCelsius: tempCelsius,
      temperatureFahrenheit: tempFahrenheit,
      arrowMassGrains: numWeight,
      arrowLengthInches: numLength,
      totalTimeSec: detection.totalTimeSec,
      flightTimeSec: stats.flightTimeSec,
      soundReturnTimeSec: stats.soundReturnTimeSec,
      speedMps: stats.speedMps,
      speedFps: stats.speedFps,
      speedKmh: stats.speedKmh,
      launchSpeedFps: stats.launchSpeedFps,
      launchSpeedMps: stats.launchSpeedMps,
      launchSpeedKmh: stats.launchSpeedKmh,
      kineticEnergyFtLbs: stats.kineticEnergyFtLbs,
      momentumSlugFtSec: stats.momentumSlugFtSec,
      releasePeakSec: detection.releaseSec,
      impactPeakSec: detection.impactSec,
      confidence: detection.confidence,
      waveformBins: detection.waveformBins,
      releaseBin: detection.releaseBin,
      impactBin: detection.impactBin
    };

    triggerHaptic("confirm");
    setLastShotResult(result);

    setShotHistory((prev) => {
      const updated = [result, ...prev];
      saveLocalSetting("chronograph_logs", updated);
      return updated;
    });
  };

  const stopRecording = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    setIsRecording(false);
    setListenStage("IDLE");
    setAudioLevel(0);
  };

  // Cleanup Web Audio API stream on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // Delete shot from history
  const handleDeleteShot = async (id: string) => {
    const updated = shotHistory.filter((s) => s.id !== id);
    setShotHistory(updated);
    await saveLocalSetting("chronograph_logs", updated);
  };

  return (
    <div className="flex flex-col gap-4 py-4 max-w-xl mx-auto pb-16 px-1 w-full max-w-full overflow-x-hidden">
      {/* Top Header (Matched with Calendar / Home header style & height) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-[#0D1017] border border-white/[0.08] text-gray-dim hover:text-white flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-white text-base sm:text-lg font-black uppercase tracking-wide leading-tight truncate">
                Cronógrafo
              </h2>
            </div>
            <p className="text-[10px] text-gray-dim uppercase tracking-wider truncate">
              Medición Balística
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-[#0D1017] border border-cyan-neon/25 h-9 px-3 rounded-xl text-[10px] text-cyan-neon font-black uppercase tracking-wider shrink-0 whitespace-nowrap">
          <Target size={13} />
          <span>{distanceMeters} Metros</span>
        </div>
      </div>

      {/* Main Action Buttons */}
      <div className="flex flex-col gap-3">
        {/* 2 ACTION BUTTONS: INSTRUCCIONES & CONFIGURAR FLECHA */}
        <div className="grid grid-cols-2 gap-2">
          {/* BOTÓN 1: INSTRUCCIONES */}
          <button
            type="button"
            onClick={() => setShowInstructionsModal(true)}
            className="h-11 px-2.5 rounded-2xl bg-[#0D1017] hover:bg-neutral-800 border border-white/[0.08] hover:border-cyan-neon/40 text-white font-black transition cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 text-center min-w-0 whitespace-nowrap"
          >
            <BookOpen size={13} className="text-cyan-neon shrink-0" />
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-tight text-center leading-none">
              Instrucciones (18 m)
            </span>
          </button>

          {/* BOTÓN 2: CONFIGURAR FLECHA (GRAINS, LONGITUD, TEMP) */}
          <button
            type="button"
            onClick={() => setShowSpecsModal(true)}
            className="h-11 px-2.5 rounded-2xl bg-[#0D1017] hover:bg-neutral-800 border border-white/[0.08] hover:border-yellow-gold/40 text-white font-black transition cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 text-center min-w-0 whitespace-nowrap"
          >
            <Settings size={13} className="text-yellow-gold shrink-0" />
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-tight text-center leading-none">
              Configurar Flecha
            </span>
          </button>
        </div>
      </div>

      {/* Active Specs Bar Banner */}
      <div className="bg-[#0D0F12] border border-white/[0.08] rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-black uppercase text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/30 px-2 py-0.5 rounded-full">
            {distanceMeters} Metros
          </span>
          <span className="text-white/80 font-mono text-[11px] tabular-nums">
            {arrowWeight} gr · {arrowLength}" · {temperature}°{tempUnit}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSpecsModal(true)}
          className="text-[10px] text-yellow-gold hover:text-white font-bold uppercase underline cursor-pointer"
        >
          Editar
        </button>
      </div>

      {/* MAIN SPEEDOMETER & MEASUREMENT CARD */}
      <div className="bg-[#0D0F12] border border-white/[0.08] p-6 rounded-3xl flex flex-col items-center justify-center text-center relative overflow-hidden gap-4">
        {/* Distance Selector Pills (5m, 10m, 18m) & Unit Switcher */}
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-xl border border-white/10">
            {[5, 10, 18].map((dist) => (
              <button
                key={dist}
                type="button"
                disabled={isRecording}
                onClick={() => {
                  triggerHaptic("tick");
                  setDistanceMeters(dist);
                  handleSaveSpecs(arrowWeight, arrowLength, temperature, tempUnit, dist);
                }}
                className={`h-7 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap tabular-nums transition cursor-pointer ${
                  distanceMeters === dist
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/40"
                    : "text-gray-dim hover:text-white"
                }`}
              >
                {dist} m
              </button>
            ))}
          </div>

          {/* Unit Toggle Option: FPS vs KM/H */}
          <div className="flex bg-[#090B0E] p-1 rounded-xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setSpeedUnit("FPS")}
              className={`h-7 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer ${
                speedUnit === "FPS" 
                  ? "bg-cyan-neon text-black" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              FPS
            </button>
            <button
              type="button"
              onClick={() => setSpeedUnit("KMH")}
              className={`h-7 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer ${
                speedUnit === "KMH" 
                  ? "bg-cyan-neon text-black" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              KM/H
            </button>
          </div>
        </div>

        {/* Big Speed Number */}
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-6xl md:text-7xl font-black text-white tracking-tighter font-mono tabular-nums">
            {lastShotResult 
              ? (speedUnit === "FPS" 
                  ? Math.round(lastShotResult.launchSpeedFps) 
                  : Math.round(lastShotResult.launchSpeedKmh))
              : "---"}
          </span>
          <span className="text-cyan-neon text-2xl font-black uppercase tracking-wider">
            {speedUnit}
          </span>
        </div>

        {/* Secondary Speed Info or Status */}
        {lastShotResult ? (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-neutral-900/80 border border-white/10 text-xs font-bold">
              {speedUnit === "FPS" ? (
                <>
                  <span className="text-white">{lastShotResult.launchSpeedKmh.toFixed(1)} <span className="text-gray-dim text-[10px]">km/h</span></span>
                  <span className="text-gray-border">•</span>
                  <span className="text-white">{lastShotResult.launchSpeedMps.toFixed(1)} <span className="text-gray-dim text-[10px]">m/s</span></span>
                </>
              ) : (
                <>
                  <span className="text-white">{Math.round(lastShotResult.launchSpeedFps)} <span className="text-gray-dim text-[10px]">FPS</span></span>
                  <span className="text-gray-border">•</span>
                  <span className="text-white">{lastShotResult.launchSpeedMps.toFixed(1)} <span className="text-gray-dim text-[10px]">m/s</span></span>
                </>
              )}
            </div>
            <span className="text-[10px] text-cyan-neon/80 font-mono">
              Vuelo neto: {(lastShotResult.flightTimeSec * 1000).toFixed(1)} ms · Retorno sonido: {((lastShotResult.soundReturnTimeSec ?? (lastShotResult.totalTimeSec - lastShotResult.flightTimeSec)) * 1000).toFixed(1)} ms
            </span>
          </div>
        ) : (
          <span className="text-xs text-gray-dim">
            Presiona el botón de abajo y dispara hacia la diana a 18 metros
          </span>
        )}

        {/* Honest Diagnostic Warning if No Shot or Impact Detected */}
        {detectionError && (
          <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-start gap-2.5 text-left">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-amber-200 leading-snug font-medium">
              {detectionError}
            </span>
          </div>
        )}

        {/* Ballistics Row: Kinetic Energy & Momentum */}
        {lastShotResult && (
          <div className="grid grid-cols-2 gap-3 w-full bg-neutral-900/60 p-3 rounded-2xl border border-white/5 text-xs">
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-white/40 uppercase font-bold tracking-wider">Energía Cinética</span>
              <span className="text-white font-black text-sm mt-0.5">
                {lastShotResult.kineticEnergyFtLbs ? `${lastShotResult.kineticEnergyFtLbs.toFixed(1)} ft-lbs` : "—"}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-white/40 uppercase font-bold tracking-wider">Momento</span>
              <span className="text-cyan-neon font-black text-sm mt-0.5">
                {lastShotResult.momentumSlugFtSec ? `${lastShotResult.momentumSlugFtSec.toFixed(3)} slug-ft/s` : "—"}
              </span>
            </div>
          </div>
        )}

        {/* Acoustic Oscilloscope Waveform (Visualizes Release & Impact Transients) */}
        {lastShotResult?.waveformBins && lastShotResult.waveformBins.length > 0 && (
          <div className="w-full bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider">
              <span className="text-cyan-neon flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cyan-neon inline-block" />
                Suelta (0 ms)
              </span>
              <span className="text-white/40">Onda Acústica ({lastShotResult.distanceMeters}m)</span>
              <span className="text-yellow-gold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-gold inline-block" />
                Impacto (+{(lastShotResult.totalTimeSec * 1000).toFixed(0)} ms)
              </span>
            </div>
            <svg viewBox="0 0 240 44" className="w-full h-11 overflow-visible">
              {lastShotResult.waveformBins.map((amp, idx) => {
                const isRel = idx === lastShotResult.releaseBin;
                const isImp = idx === lastShotResult.impactBin;
                const barH = Math.max(2, amp * 36);
                const x = idx * 3 + 1;
                const y = 40 - barH;
                const fill = isRel
                  ? "#00E5FF"
                  : isImp
                  ? "#FFE500"
                  : idx > (lastShotResult.releaseBin ?? 0) && idx < (lastShotResult.impactBin ?? 0)
                  ? "rgba(0, 229, 255, 0.35)"
                  : "rgba(255, 255, 255, 0.18)";
                return (
                  <g key={idx}>
                    <rect x={x} y={y} width="2" height={barH} rx="1" fill={fill} />
                    {(isRel || isImp) && (
                      <circle cx={x + 1} cy={Math.max(3, y - 3)} r="2.2" fill={isRel ? "#00E5FF" : "#FFE500"} />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Big Action Button: Medir Velocidad */}
        <div className="flex flex-col gap-2 w-full mt-2 pt-3 border-t border-white/5">
          <button
            type="button"
            onClick={handleRequestMeasurement}
            className={`w-full h-12 rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-[0.99] cursor-pointer ${
              isRecording 
                ? listenStage === "CAPTURING_IMPACT"
                  ? "bg-amber-500 text-black animate-pulse"
                  : "bg-red-500 text-white animate-pulse" 
                : "bg-cyan-neon text-black hover:bg-cyan-neon/90"
            }`}
          >
            {isRecording ? (
              <>
                <Volume2 size={18} className="animate-spin" />
                <span>
                  {listenStage === "SETTLING"
                    ? "Calibrando silencio..."
                    : listenStage === "CAPTURING_IMPACT"
                    ? "¡Disparo detectado! Midiendo impacto a 18m..."
                    : `Armado: Esperando tu Disparo (${audioLevel}%) · Toca para cancelar`}
                </span>
              </>
            ) : (
              <>
                <Mic size={18} />
                <span>Medir Velocidad (Disparar a 18m)</span>
              </>
            )}
          </button>
          <span className="text-[10px] text-gray-dim text-center">
            {isRecording 
              ? "Tienes hasta 20 segundos para apuntar con calma y disparar. Se activará al detectar la suelta." 
              : "Distancia reglamentaria: 18 metros medidos con cinta métrica."}
          </span>
        </div>
      </div>

      {/* SESSION HISTORY A 18 METROS */}
      <div className="bg-neutral-950 border border-white/10 rounded-3xl p-5 flex flex-col gap-3 shadow-xl">
        <div className="flex justify-between items-center">
          <span className="text-xs font-black uppercase tracking-wider text-white">
            Historial de Mediciones
          </span>
          <span className="text-[10px] text-gray-dim">
            {shotHistory.length} {shotHistory.length === 1 ? "tiro" : "tiros"}
          </span>
        </div>

        {shotHistory.length === 0 ? (
          <div className="py-8 text-center text-gray-dim text-xs leading-relaxed border border-dashed border-white/5 rounded-2xl">
            Aún no hay disparos registrados. Realiza tu primer tiro para calcular la velocidad de salida.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto pr-1">
            {shotHistory.map((s) => (
              <div
                key={s.id}
                className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex justify-between items-center"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-base font-black">
                      {Math.round(s.launchSpeedFps)} <span className="text-cyan-neon text-xs">FPS</span>
                    </span>
                    <span className="text-white/40 text-[10px] font-bold">
                      ({Math.round(s.launchSpeedKmh)} km/h)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[9px] text-gray-dim mt-0.5">
                    <span>18m</span>
                    <span>•</span>
                    <span>{s.arrowMassGrains || 420} gr</span>
                    <span>•</span>
                    <span>{s.arrowLengthInches || 28.5}"</span>
                    <span>•</span>
                    <span>{s.temperatureFahrenheit || 70}°F</span>
                    {s.kineticEnergyFtLbs && (
                      <>
                        <span>•</span>
                        <span className="text-orange-400 font-bold">{s.kineticEnergyFtLbs.toFixed(1)} ft-lbs</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteShot(s.id)}
                  className="p-2 text-gray-dim hover:text-red-400 hover:bg-red-500/10 rounded-xl transition cursor-pointer"
                  title="Eliminar registro"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: INSTRUCCIONES DE USO A 18 METROS Y DIAGRAMA BALÍSTICO            */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showInstructionsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShowInstructionsModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-2xl z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto text-left"
            >
              {/* Header */}
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-cyan-neon/15 border border-cyan-neon/30 text-cyan-neon">
                    <BookOpen size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Instrucciones de Uso
                    </h3>
                    <span className="text-[10px] text-cyan-neon font-bold">
                      Distancia Oficial: 18 Metros (18m / 20yd)
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowInstructionsModal(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Step-by-Step Instructions */}
              <div className="flex flex-col gap-3 text-xs leading-relaxed text-gray-dim">
                <div className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="text-white font-bold text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-cyan-neon text-black font-black flex items-center justify-center text-[10px]">1</span>
                    <span>Medir la distancia exacta con cinta métrica</span>
                  </h4>
                  <p className="text-[11px] pl-6 text-white/70">
                    Coloca el teléfono exactamente a <strong className="text-white">18 metros (18.0 m / 60 ft)</strong> de la cara de la diana. Usa cinta métrica (los telémetros no son exactos para el teléfono).
                  </p>
                </div>

                <div className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="text-white font-bold text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-cyan-neon text-black font-black flex items-center justify-center text-[10px]">2</span>
                    <span>Posición del Teléfono</span>
                  </h4>
                  <p className="text-[11px] pl-6 text-white/70">
                    Coloca el teléfono a la altura de tu flecha en apertura completa (recomendado en trípode) y a <strong className="text-cyan-neon">15 cm (6 pulg)</strong> hacia un lado del vástago de la flecha.
                  </p>
                </div>

                <div className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="text-white font-bold text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-cyan-neon text-black font-black flex items-center justify-center text-[10px]">3</span>
                    <span>Alineación del Arquero</span>
                  </h4>
                  <p className="text-[11px] pl-6 text-white/70">
                    Párate de modo que en apertura completa el culatín y el tope de cuerda queden alineados con la línea de 18 metros y parejos con el micrófono del teléfono.
                  </p>
                </div>

                <div className="bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <h4 className="text-white font-bold text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-cyan-neon text-black font-black flex items-center justify-center text-[10px]">4</span>
                    <span>Disparo y Cálculo por Sonido</span>
                  </h4>
                  <p className="text-[11px] pl-6 text-white/70">
                    Presiona el botón <strong className="text-white">&ldquo;Medir Velocidad&rdquo;</strong>; el cronógrafo quedará armado hasta por 20 segundos esperando a que apuntes con calma y dispares. Al detectar la suelta, capturará automáticamente el impacto a 18 metros.
                  </p>
                </div>
              </div>

              {/* DIAGRAMA OFICIAL A 18 METROS (SVG) */}
              <div className="bg-[#050507] border border-white/10 rounded-2xl p-4 flex flex-col items-center relative overflow-hidden">
                <span className="text-[9px] font-black uppercase text-white/40 tracking-widest self-start mb-2">
                  Diagrama Oficial a 18 Metros
                </span>

                <svg viewBox="0 0 320 450" className="w-full max-w-sm h-auto select-none">
                  {/* Target at top */}
                  <rect x="60" y="20" width="200" height="18" rx="4" fill="#1C1C20" stroke="#333338" strokeWidth="1.5" />
                  <line x1="70" y1="29" x2="250" y2="29" stroke="#555" strokeWidth="1" strokeDasharray="4 3" />
                  <circle cx="160" cy="29" r="4" fill="#E65100" />
                  <text x="160" y="14" fill="#FFFFFF" fontSize="10" fontWeight="900" textAnchor="middle" letterSpacing="2">
                    DIANA (TARGET)
                  </text>

                  {/* Flight trajectory */}
                  <line x1="160" y1="36" x2="160" y2="340" stroke="#00E5FF" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                  <polygon points="160,40 156,48 164,48" fill="#00E5FF" />

                  {/* 18m distance dimension line */}
                  <line x1="240" y1="29" x2="240" y2="350" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />
                  <line x1="235" y1="29" x2="245" y2="29" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />
                  <line x1="235" y1="350" x2="245" y2="350" stroke="#FFFFFF" strokeWidth="1" opacity="0.4" />

                  {/* 18m text callout */}
                  <text x="250" y="180" fill="#FFFFFF" fontSize="16" fontWeight="900">18 m</text>
                  <text x="250" y="196" fill="#00E5FF" fontSize="10" fontWeight="700">18 Metros</text>
                  <text x="250" y="210" fill="#888888" fontSize="8">60 ft · 20 yd</text>
                  <text x="250" y="226" fill="#E65100" fontSize="8" fontWeight="800">DISTANCIA EXACTA</text>
                  <text x="250" y="238" fill="#E65100" fontSize="8" fontWeight="800">con cinta métrica</text>

                  {/* 18 METERS LINE */}
                  <line x1="20" y1="350" x2="300" y2="350" stroke="#555555" strokeWidth="1.2" strokeDasharray="5 4" />
                  <text x="30" y="344" fill="#888888" fontSize="8" fontWeight="900" letterSpacing="1">
                    LÍNEA MEDIDA DE 18 METROS
                  </text>

                  {/* Arrow shaft at full draw */}
                  <line x1="160" y1="290" x2="160" y2="390" stroke="#CCCCCC" strokeWidth="2.5" />
                  <polygon points="160,285 157,294 163,294" fill="#999999" />
                  <rect x="153" y="315" width="14" height="22" rx="4" fill="#333338" stroke="#555" strokeWidth="1" />
                  <text x="172" y="325" fill="#888" fontSize="8">empuñadura arco</text>

                  {/* Vanes & String stop */}
                  <path d="M154,385 C154,395 160,402 160,402 C160,402 166,395 166,385 Z" fill="#E65100" />
                  <circle cx="160" cy="350" r="7" fill="none" stroke="#E65100" strokeWidth="1.5" />
                  <circle cx="160" cy="350" r="2.5" fill="#E65100" />

                  {/* Phone */}
                  <rect x="205" y="336" width="18" height="30" rx="3" fill="#18181C" stroke="#00E5FF" strokeWidth="1.5" />
                  <circle cx="214" cy="360" r="1.5" fill="#00E5FF" />
                  <text x="214" y="378" fill="#FFFFFF" fontSize="8" fontWeight="bold" textAnchor="middle">Teléfono</text>

                  {/* 15 cm lateral gap */}
                  <line x1="160" y1="330" x2="205" y2="330" stroke="#FFFFFF" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5" />
                  <text x="182" y="325" fill="#00E5FF" fontSize="7" fontWeight="bold" textAnchor="middle">15 cm (6 pulg)</text>

                  {/* Callouts */}
                  <text x="25" y="310" fill="#E65100" fontSize="8" fontWeight="bold">Tope de cuerda aquí</text>
                  <text x="25" y="320" fill="#777" fontSize="7">en la línea de 18m</text>
                  <line x1="95" y1="316" x2="150" y2="340" stroke="#E65100" strokeWidth="0.8" opacity="0.6" />

                  <text x="25" y="380" fill="#E65100" fontSize="8" fontWeight="bold">El culatín sale aquí</text>
                  <text x="25" y="390" fill="#777" fontSize="7">parejo con el teléfono</text>
                  <line x1="95" y1="384" x2="152" y2="355" stroke="#E65100" strokeWidth="0.8" opacity="0.6" />

                  <text x="160" y="430" fill="#555" fontSize="8" textAnchor="middle" fontStyle="italic">
                    (flecha mostrada en apertura completa a 18 metros)
                  </text>
                </svg>
              </div>

              {/* Botón de Entendido */}
              <button
                type="button"
                onClick={() => setShowInstructionsModal(false)}
                className="w-full py-3 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer"
              >
                Entendido, Cerrar Instrucciones
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: CONFIGURAR FLECHA (CASILLAS DE ENTRADA: GRAINS, LONGITUD, TEMP)   */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showSpecsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShowSpecsModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4 text-left"
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400">
                    <Settings size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Datos de la Flecha y Entorno
                    </h3>
                    <span className="text-[10px] text-gray-dim">
                      Distancia configurada: 18 Metros
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowSpecsModal(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col gap-3.5">
                {/* 1. CASILLA: Arrow Weight (Grains) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-between justify-between">
                    <label className="text-xs font-bold text-white">
                      Peso de la Flecha (Grains - gr)
                    </label>
                    <span className="text-[10px] text-orange-400 font-mono">Total en Grains</span>
                  </div>
                  <input
                    type="number"
                    min={150}
                    max={950}
                    value={arrowWeight}
                    onChange={(e) => setArrowWeight(e.target.value)}
                    placeholder="Total arrow weight in grains (ej. 420)"
                    className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon font-medium"
                  />
                  <span className="text-[9px] text-gray-dim">
                    Peso completo de la flecha armada (tubo + punta + culatín + plumas). 1 gramo = 15.4 grains.
                  </span>
                </div>

                {/* 2. CASILLA: Arrow Length (Inches) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-between justify-between">
                    <label className="text-xs font-bold text-white">
                      Longitud de la Flecha (Pulgadas - in)
                    </label>
                    <span className="text-[10px] text-orange-400 font-mono">Ranura a punta</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min={18}
                    max={36}
                    value={arrowLength}
                    onChange={(e) => setArrowLength(e.target.value)}
                    placeholder="Nock groove to tip in inches (ej. 28.5)"
                    className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon font-medium"
                  />
                  <span className="text-[9px] text-gray-dim">
                    Medida desde el fondo de la ranura del culatín hasta el extremo de la punta de tiro en pulgadas.
                  </span>
                </div>

                {/* 3. CASILLA: Temperature (°F o °C) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white">
                      Temperatura Aproximada ({tempUnit === "F" ? "°F" : "°C"})
                    </label>
                    <button
                      type="button"
                      onClick={handleToggleTempUnit}
                      className="text-[9px] font-black uppercase text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/30 px-2 py-0.5 rounded-full hover:bg-cyan-neon/20 transition cursor-pointer"
                    >
                      Cambiar a {tempUnit === "F" ? "°C" : "°F"}
                    </button>
                  </div>
                  <input
                    type="number"
                    step="1"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder={tempUnit === "F" ? "Temperatura en Fahrenheit (ej. 70)" : "Temperatura en Celsius (ej. 21)"}
                    className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-4 py-3 text-white text-xs outline-none focus:border-cyan-neon font-medium"
                  />
                  <span className="text-[9px] text-gray-dim">
                    La temperatura del aire determina la velocidad exacta del sonido a 18 metros.
                  </span>
                </div>

                {/* Botón Guardar Especificaciones */}
                <button
                  type="button"
                  onClick={() => {
                    handleSaveSpecs(arrowWeight, arrowLength, temperature, tempUnit);
                    setShowSpecsModal(false);
                  }}
                  className="w-full mt-2 py-3.5 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider cursor-pointer active:scale-98 transition flex items-center justify-center gap-2"
                >
                  <Save size={15} />
                  <span>Guardar Parámetros de Flecha</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal de Permiso de Micrófono (Google Play Prominent Disclosure) */}
        {showMicDisclosure && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-900 border border-cyan-neon/30 p-6 rounded-3xl max-w-sm w-full flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon shrink-0">
                  <Mic size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Acceso al Micrófono</h3>
                  <span className="text-[10px] text-cyan-neon font-bold">Privacidad y Procesamiento 100% Local</span>
                </div>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed">
                <strong>Archery 101010</strong> utiliza el micrófono exclusivamente para captar el intervalo acústico entre la suelta de la flecha y su impacto en la diana a 18 metros, calculando así su velocidad de vuelo (FPS).
              </p>

              <div className="bg-neutral-950 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5 text-[11px] text-neutral-300">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold mb-0.5">
                  <ShieldCheck size={15} />
                  <span>Garantía de Privacidad y Seguridad:</span>
                </div>
                <span>• El audio se procesa en tiempo real dentro de tu propio teléfono.</span>
                <span>• NUNCA se graba voz humana ni se guardan archivos de audio.</span>
                <span>• Ningún dato acústico se comparte ni se transmite por internet.</span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMicDisclosure(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-neutral-400 text-xs font-bold hover:text-white transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAcceptMicDisclosure}
                  className="flex-1 py-3 rounded-xl bg-cyan-neon text-black text-xs font-black uppercase tracking-wider hover:brightness-110 shadow-glow-cyan transition cursor-pointer"
                >
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
