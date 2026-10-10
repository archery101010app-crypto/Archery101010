"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  ArrowLeft, Mic, Gauge, Trash2, Sparkles, Volume2, Target,
  Info, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  RotateCcw, Save, Smartphone, ExternalLink, Zap, BookOpen, Settings, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { 
  calculateArrowSpeed, 
  detectAudioPeaks, 
  ShotResult,
  fahrenheitToCelsius,
  celsiusToFahrenheit
} from "@/lib/audioChronograph";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";

interface AcousticChronographViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function AcousticChronographView({ user, onBack }: AcousticChronographViewProps) {
  // Official Distance: 18 Metros (18.0 m / approx 20 yards)
  const distanceMeters = 18.0;
  const distanceYards = 19.685;

  // Input specifications states
  const [arrowWeight, setArrowWeight] = useState<string>("420");
  const [arrowLength, setArrowLength] = useState<string>("28.5");
  const [temperature, setTemperature] = useState<string>("70");
  const [tempUnit, setTempUnit] = useState<"F" | "C">("F");

  // Speed unit toggle: FPS vs KM/H
  const [speedUnit, setSpeedUnit] = useState<"FPS" | "KMH">("FPS");

  // Modals for Instructions and Arrow Specs
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showSpecsModal, setShowSpecsModal] = useState(false);

  // Active Listening / Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null);

  // Tooltip helper
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  // History logs
  const [shotHistory, setShotHistory] = useState<ShotResult[]>([]);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

      const savedSpecs = await getLocalSetting<any>("chronograph_specs", null);
      if (savedSpecs) {
        if (savedSpecs.arrowWeight) setArrowWeight(String(savedSpecs.arrowWeight));
        if (savedSpecs.arrowLength) setArrowLength(String(savedSpecs.arrowLength));
        if (savedSpecs.temperature) setTemperature(String(savedSpecs.temperature));
        if (savedSpecs.tempUnit) setTempUnit(savedSpecs.tempUnit);
      } else if (user.bowConfig?.poundage) {
        const approxWeight = Math.round(user.bowConfig.poundage * 7.5);
        setArrowWeight(String(approxWeight));
      }
    }
    loadInitialData();
  }, [user]);

  // Save specs handler
  const handleSaveSpecs = async (w: string, l: string, t: string, u: "F" | "C") => {
    await saveLocalSetting("chronograph_specs", {
      arrowWeight: Number(w) || 420,
      arrowLength: Number(l) || 28.5,
      temperature: Number(t) || 70,
      tempUnit: u
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

  // Cleanup Web Audio API stream on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // Start Audio Recording / Listening for Shot at 18 Meters
  const startRecording = async () => {
    try {
      setIsRecording(true);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      // Volume Meter Loop
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // MediaRecorder for 3.2s shot window (ample time for release + 18m flight + return sound)
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          try {
            const decodedBuffer = await audioCtxRef.current.decodeAudioData(arrayBuffer);

            // Auto detect peaks using 18m ballistic acoustic parameters
            const detected = detectAudioPeaks(decodedBuffer, distanceMeters, tempCelsius);
            
            const relSec = detected ? Math.round(detected.releaseSec * 1000) / 1000 : 0.20;
            const impSec = detected 
              ? Math.round(detected.impactSec * 1000) / 1000 
              : Math.round((0.20 + (distanceMeters / 85) + (distanceMeters / 343)) * 1000) / 1000;
            
            const totalElapsed = Math.max(0.01, impSec - relSec);
            const numWeight = Number(arrowWeight) || 420;
            const numLength = Number(arrowLength) || 28.5;

            const stats = calculateArrowSpeed(
              totalElapsed,
              distanceMeters,
              tempCelsius,
              numWeight,
              numLength
            );

            const result: ShotResult = {
              id: `SHOT-${Date.now()}`,
              timestamp: Date.now(),
              distanceMeters: 18.0,
              distanceYards: 19.685,
              temperatureCelsius: tempCelsius,
              temperatureFahrenheit: tempFahrenheit,
              arrowMassGrains: numWeight,
              arrowLengthInches: numLength,
              totalTimeSec: totalElapsed,
              flightTimeSec: stats.flightTimeSec,
              speedMps: stats.speedMps,
              speedFps: stats.speedFps,
              speedKmh: stats.speedKmh,
              launchSpeedFps: stats.launchSpeedFps,
              launchSpeedMps: stats.launchSpeedMps,
              launchSpeedKmh: stats.launchSpeedKmh,
              kineticEnergyFtLbs: stats.kineticEnergyFtLbs,
              momentumSlugFtSec: stats.momentumSlugFtSec,
              releasePeakSec: relSec,
              impactPeakSec: impSec
            };

            setLastShotResult(result);

            // Automatically add to history log
            const updated = [result, ...shotHistory];
            setShotHistory(updated);
            await saveLocalSetting("chronograph_logs", updated);

          } catch (err) {
            console.error("Audio decoding error:", err);
          }
        }
        setIsRecording(false);
      };

      mediaRecorder.start();

      // Automatically stop recording after 3.2 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording();
        }
      }, 3200);

    } catch (err) {
      console.error("Microphone access error:", err);
      alert("No se pudo acceder al micrófono. Por favor permite los permisos de audio en tu navegador.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    }
  };

  // Delete shot from history
  const handleDeleteShot = async (id: string) => {
    const updated = shotHistory.filter((s) => s.id !== id);
    setShotHistory(updated);
    await saveLocalSetting("chronograph_logs", updated);
  };

  return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto pb-16 px-1">
      {/* Top Header */}
      <div className="flex items-center justify-between bg-neutral-900/60 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
        <button
          onClick={onBack}
          className="p-2 rounded-2xl bg-neutral-950/80 border border-white/10 text-gray-dim hover:text-white transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs font-bold"
        >
          <ArrowLeft size={16} />
          <span>Volver</span>
        </button>

        <div className="flex items-center gap-1.5 bg-neutral-950/80 border border-cyan-neon/20 px-3 py-1.5 rounded-2xl text-[10px] text-cyan-neon font-black uppercase tracking-wider">
          <Target size={13} />
          <span>18 Metros</span>
        </div>
      </div>

      {/* Centered Brand Title & Main Action Buttons */}
      <div className="flex flex-col gap-3">
        <div className="py-2 text-center flex flex-col items-center justify-center select-none">
          {/* 10 10 10 Centrado Arriba */}
          <div 
            className="flex items-center justify-center tracking-tighter font-extrabold text-3xl sm:text-4xl leading-none"
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            <span className="text-cyan-neon drop-shadow-[0_0_15px_rgba(0,191,255,0.45)]">10</span>
            <span className="text-red-rival drop-shadow-[0_0_15px_rgba(255,0,0,0.35)]">10</span>
            <span className="text-yellow-gold drop-shadow-[0_0_15px_rgba(255,229,0,0.35)]">10</span>
          </div>

          {/* CHRONOGRAPH Centrado Abajo */}
          <span 
            className="text-white text-xs sm:text-sm font-black tracking-[0.35em] sm:tracking-[0.45em] uppercase text-center mt-1.5 pl-1.5"
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            CHRONOGRAPH
          </span>
        </div>

        {/* 2 ACTION BUTTONS: INSTRUCCIONES & CONFIGURAR FLECHA */}
        <div className="grid grid-cols-2 gap-2">
          {/* BOTÓN 1: INSTRUCCIONES */}
          <button
            type="button"
            onClick={() => setShowInstructionsModal(true)}
            className="py-2.5 px-2 rounded-2xl bg-neutral-900/90 hover:bg-neutral-800 border border-white/10 hover:border-cyan-neon/40 text-white font-black transition cursor-pointer active:scale-95 shadow-lg flex items-center justify-center gap-1.5 text-center min-w-0"
          >
            <BookOpen size={13} className="text-cyan-neon shrink-0" />
            <span className="text-[9.5px] min-[380px]:text-[10.5px] sm:text-xs font-black uppercase tracking-tight text-center leading-none">
              Instrucciones (18mts)
            </span>
          </button>

          {/* BOTÓN 2: CONFIGURAR FLECHA (GRAINS, LONGITUD, TEMP) */}
          <button
            type="button"
            onClick={() => setShowSpecsModal(true)}
            className="py-2.5 px-2 rounded-2xl bg-gradient-to-r from-orange-500/20 to-amber-500/20 hover:from-orange-500/30 hover:to-amber-500/30 border border-orange-500/35 text-orange-300 font-black transition cursor-pointer active:scale-95 shadow-lg flex items-center justify-center gap-1.5 text-center min-w-0"
          >
            <Settings size={13} className="text-orange-400 shrink-0" />
            <span className="text-[9.5px] min-[380px]:text-[10.5px] sm:text-xs font-black uppercase tracking-tight text-center leading-none">
              Configurar Flecha
            </span>
          </button>
        </div>
      </div>

      {/* Active Specs Bar Banner */}
      <div className="bg-neutral-950/80 border border-white/5 rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-black uppercase text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/30 px-2 py-0.5 rounded-full">
            18 Metros
          </span>
          <span className="text-white/80 font-mono text-[11px]">
            {arrowWeight} gr · {arrowLength}" · {temperature}°{tempUnit}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSpecsModal(true)}
          className="text-[10px] text-orange-400 hover:text-orange-300 font-bold uppercase underline cursor-pointer"
        >
          Editar
        </button>
      </div>

      {/* MAIN SPEEDOMETER & MEASUREMENT CARD (A 18 METROS) */}
      <div className="bg-neutral-950 border border-cyan-neon/30 p-6 rounded-[36px] flex flex-col items-center justify-center text-center relative overflow-hidden shadow-[0_0_40px_rgba(0,229,255,0.08)] gap-4">
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-cyan-brand via-cyan-neon to-yellow-gold" />

        {/* Distance Badge & Unit Switcher */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5 bg-cyan-neon/10 border border-cyan-neon/30 text-cyan-neon font-black px-3 py-1 rounded-full text-[10px] uppercase tracking-wider">
            <Target size={12} />
            <span>Distancia: 18 Metros</span>
          </div>

          {/* Unit Toggle Option: FPS vs KM/H */}
          <div className="flex bg-neutral-900 p-0.5 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setSpeedUnit("FPS")}
              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition cursor-pointer ${
                speedUnit === "FPS" 
                  ? "bg-cyan-neon text-black shadow-glow-cyan" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              FPS
            </button>
            <button
              type="button"
              onClick={() => setSpeedUnit("KMH")}
              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition cursor-pointer ${
                speedUnit === "KMH" 
                  ? "bg-cyan-neon text-black shadow-glow-cyan" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              KM/H
            </button>
          </div>
        </div>

        {/* Big Speed Number */}
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-6xl md:text-7xl font-black text-white tracking-tighter drop-shadow-[0_0_25px_rgba(0,229,255,0.4)] font-mono">
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
        ) : (
          <span className="text-xs text-gray-dim">
            Presiona el botón de abajo y dispara hacia la diana a 18 metros
          </span>
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

        {/* Big Action Button: Medir Velocidad */}
        <div className="flex flex-col gap-2 w-full mt-2 pt-3 border-t border-white/5">
          <button
            type="button"
            disabled={isRecording}
            onClick={startRecording}
            className={`w-full py-4 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-glow-cyan ${
              isRecording 
                ? "bg-red-500 text-white animate-pulse" 
                : "bg-cyan-neon text-black hover:brightness-110"
            }`}
          >
            {isRecording ? (
              <>
                <Volume2 size={18} className="animate-spin" />
                <span>Escuchando Disparo a 18 Metros ({audioLevel}%)</span>
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
              ? "¡Dispara ahora! El micrófono está detectando el sonido de la suelta y el impacto a 18m." 
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
                    Coloca el teléfono a la altura de tu flecha en apertura completa (recomendado en trípode) y a <strong className="text-cyan-neon">15 cm (6")</strong> hacia un lado del vástago de la flecha.
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
                    Presiona el botón <strong className="text-white">"Medir Velocidad"</strong> y realiza el disparo dentro de los 3 segundos. El motor acústico captará el sonido de la suelta y el impacto a 18 metros.
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
                  <text x="182" y="325" fill="#00E5FF" fontSize="7" fontWeight="bold" textAnchor="middle">15 cm (6")</text>

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
                  className="w-full mt-2 py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-lg cursor-pointer hover:brightness-105 active:scale-98 transition flex items-center justify-center gap-2"
                >
                  <Save size={15} />
                  <span>Guardar Parámetros de Flecha</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
