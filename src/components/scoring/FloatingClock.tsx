"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCw, Minimize2, Square, X, Clock, Volume2, AlertTriangle, Radio } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { 
  initWAAudio, 
  playWA2Beeps, 
  playWA1Beep, 
  playWA3Beeps, 
  playWA5EmergencyBeeps, 
  playWATestTone, 
  WASoundMode 
} from "@/lib/audio/waAudioSignals";
import { triggerHaptic } from "@/lib/haptics";
import { useWakeLock } from "@/lib/useWakeLock";

interface FloatingClockProps {
  arrowsPerEnd?: number;
  onClockDisabledChange?: (disabled: boolean) => void;
  // Exposes current clock time to inline mini widget
  onTimeUpdate?: (timeStr: string, phase: "prep" | "shoot" | "stop" | null, isOver: boolean, isWarn: boolean) => void;
}

/**
 * Official World Archery Timing Presets (Book 2 Art. 7.3 & Book 3 Art. 13.4 / 15.1.1)
 * Current WA Standard: 30 seconds per arrow (90s for 3 arrows, 180s for 6 arrows)
 * Classic / Para-Archery: 40 seconds per arrow (120s for 3 arrows, 240s for 6 arrows)
 * Alternating Matchplay / Shoot-Off: 20 seconds (1 arrow)
 */
const WA_OFFICIAL_PRESETS = [
  { id: "WA_90", label: "3 Flechas WA (90s)", sub: "30s/flecha · Oficial", prep: 10, shoot: 90 },
  { id: "WA_180", label: "6 Flechas WA (180s)", sub: "30s/flecha · Oficial", prep: 10, shoot: 180 },
  { id: "WA_120", label: "3 Flechas (120s)", sub: "40s/flecha · Clásico", prep: 10, shoot: 120 },
  { id: "WA_240", label: "6 Flechas (240s)", sub: "40s/flecha · Clásico", prep: 10, shoot: 240 },
  { id: "WA_20", label: "Duelo / 1 Flecha (20s)", sub: "Tiro alternado WA", prep: 10, shoot: 20 }
];

export default function FloatingClock({ arrowsPerEnd = 3, onClockDisabledChange, onTimeUpdate }: FloatingClockProps) {
  const { t } = useLanguage();
  // Default to current WA 30s/arrow rule: 90s for 3 arrows, 180s for 6 arrows
  const defaultShootByArrows = arrowsPerEnd === 6 ? 180 : 90;

  // Config
  const [prepTime, setPrepTime] = useState(10);
  const [shootTime, setShootTime] = useState(defaultShootByArrows);
  const [soundMode, setSoundMode] = useState<WASoundMode>("horn");
  const [enableVoice, setEnableVoice] = useState(false); // Disabled by default for pure WA tournament compliance
  
  // State
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false); // "Sin Reloj"
  useWakeLock(isActive); // Keep display awake during active countdown/timer
  const [phase, setPhase] = useState<"prep" | "shoot" | "stop">("prep");
  const [timeLeft, setTimeLeft] = useState(10);
  const [totalPhaseTime, setTotalPhaseTime] = useState(10);

  // Audio Context Ref
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (seconds: number) => {
    const s = Math.max(0, seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  // Warning threshold according to WA rules:
  // Last 30 seconds for standard ends (90s, 120s, 180s, 240s), or last 5 seconds for 20s alternating shots
  const getWarningThreshold = (totalShootSecs: number) => (totalShootSecs <= 30 ? 5 : 30);

  // Load presets from localStorage on mount and adapt to arrowsPerEnd
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPrep = localStorage.getItem("relojSegsEntrada");
      const savedMode = localStorage.getItem("relojSoundMode") as WASoundMode;
      const savedVoice = localStorage.getItem("relojVoice");
      if (savedPrep) setPrepTime(Number(savedPrep));
      // Sync default shootTime with the session's arrowsPerEnd (90s for 3 arrows, 180s for 6 arrows)
      setShootTime(arrowsPerEnd === 6 ? 180 : 90);
      if (savedMode && ["horn", "whistle", "mute"].includes(savedMode)) {
        setSoundMode(savedMode);
      }
      if (savedVoice !== null) {
        setEnableVoice(savedVoice === "true");
      }
    }
  }, [arrowsPerEnd]);

  // Official World Archery Light Color ("RED" | "YELLOW" | "GREEN")
  const getOfficialLightState = (): "RED" | "YELLOW" | "GREEN" => {
    if (phase === "prep" || phase === "stop" || timeLeft <= 0) {
      return "RED"; // Red light: Wait on line (10s prep) or Cease fire (0:00)
    }
    const warnSecs = getWarningThreshold(shootTime);
    if (phase === "shoot" && timeLeft <= warnSecs) {
      return "YELLOW"; // Yellow/Amber light: Last 30 seconds visual warning
    }
    return "GREEN"; // Green light: Shooting in progress
  };

  const lightState = getOfficialLightState();

  // Sync to parent mini clock view
  useEffect(() => {
    if (onTimeUpdate) {
      if (!isActive && phase !== "stop") {
        onTimeUpdate("", null, false, false);
      } else {
        const warnSecs = getWarningThreshold(shootTime);
        const isWarn = phase === "shoot" && timeLeft <= warnSecs && timeLeft > 0;
        const isOver = phase === "stop" || timeLeft <= 0;
        onTimeUpdate(formatTime(timeLeft), phase, isOver, isWarn);
      }
    }
  }, [timeLeft, phase, isActive, shootTime, onTimeUpdate]);

  // Official World Archery Sound Signals (Book 3, Art. 15.1.1):
  // - 2 sound signals: Athletes go to the shooting line (10s preparation, RED light)
  // - 1 sound signal: Start of shooting time (GREEN light)
  // - 0 sound signals at 30s warning (Visual transition to YELLOW light only)
  // - 3 sound signals: End of shooting time (RED light, stop shooting)
  // - 5+ sound signals: Emergency stop shooting immediately (RED light)
  const playPrepSignal = () => {
    playWA2Beeps(soundMode);
  };

  const playShootSignal = () => {
    playWA1Beep(soundMode);
  };

  const playEndSignal = () => {
    playWA3Beeps(soundMode);
  };

  // Text-To-Speech Synthesizer (optional countdown)
  const speakNumber = (num: number) => {
    if (!enableVoice) return;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        const utterance = new SpeechSynthesisUtterance(String(num));
        utterance.lang = "es-ES";
        utterance.rate = 1.25;
        utterance.pitch = 1.0;
        utterance.volume = 0.95;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn("Speech synthesis failed", e);
      }
    }
  };

  // Core Timer ticking loop
  const startTimerLoop = () => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (isPaused) return prev;

        const nextVal = prev - 1;

        if (phase === "prep") {
          // Official WA: No intermediate beeps during 10s prep. At 0, 1 blast starts shooting (Green light).
          if (nextVal <= 0) {
            setPhase("shoot");
            setTimeLeft(shootTime);
            setTotalPhaseTime(shootTime);
            playShootSignal();
            return shootTime;
          }
        } else if (phase === "shoot") {
          // Official WA: At 30s remaining, light turns Yellow silently (no horn blast).
          // Optional voice countdown if enabled by user for solo training:
          if (nextVal <= 10 && nextVal > 0) {
            speakNumber(nextVal);
          }

          if (nextVal <= 0) {
            // Timer expired: 3 blasts to stop shooting & light turns RED
            if (timerRef.current) clearInterval(timerRef.current);
            setPhase("stop");
            setIsActive(false);
            playEndSignal();
            return 0;
          }
        }

        return nextVal;
      });
    }, 1000);
  };

  // Clock Actions
  const handleStart = () => {
    triggerHaptic("confirm");
    initWAAudio();
    localStorage.setItem("relojSegsEntrada", String(prepTime));
    localStorage.setItem("relojSegsTiro", String(shootTime));

    setIsActive(true);
    setIsPaused(false);
    setPhase("prep");
    setTimeLeft(prepTime);
    setTotalPhaseTime(prepTime);
    playPrepSignal(); // 2 beeps + Red Light

    startTimerLoop();
  };

  const handleEmergencyStop = () => {
    triggerHaptic("miss");
    if (timerRef.current) clearInterval(timerRef.current);
    setIsActive(false);
    setIsPaused(false);
    setPhase("stop");
    setTimeLeft(0);
    playWA5EmergencyBeeps(soundMode); // 5 rapid blasts + Red Light
  };

  const handleSoundModeChange = (mode: WASoundMode) => {
    triggerHaptic("tick");
    initWAAudio();
    setSoundMode(mode);
    localStorage.setItem("relojSoundMode", mode);
    playWATestTone(mode);
  };

  const handleVoiceToggle = () => {
    triggerHaptic("tick");
    const next = !enableVoice;
    setEnableVoice(next);
    localStorage.setItem("relojVoice", String(next));
  };

  useEffect(() => {
    if (isActive && !isPaused) {
      startTimerLoop();
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isActive, isPaused, phase, prepTime, shootTime]);

  const handlePauseToggle = () => {
    triggerHaptic("arrow");
    setIsPaused(!isPaused);
  };

  const handleResetPhase = () => {
    triggerHaptic("undo");
    const nextPhase = phase === "stop" ? "prep" : phase;
    setPhase(nextPhase);
    setTimeLeft(nextPhase === "prep" ? prepTime : shootTime);
    setTotalPhaseTime(nextPhase === "prep" ? prepTime : shootTime);
    setIsPaused(false);
    if (!isActive) {
      setIsActive(true);
      if (nextPhase === "prep") playPrepSignal();
      else playShootSignal();
    }
  };

  const handleStop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsActive(false);
    setIsPaused(false);
    setPhase("prep");
    setTimeLeft(prepTime);
  };

  const handleDisableToggle = () => {
    const nextState = !isDisabled;
    setIsDisabled(nextState);
    if (onClockDisabledChange) {
      onClockDisabledChange(nextState);
    }
    if (nextState) {
      handleStop();
      setIsOverlayOpen(false);
    }
  };

  if (isDisabled) {
    return (
      <button
        onClick={handleDisableToggle}
        className="fixed bottom-[72px] right-4 z-40 w-12 h-12 rounded-full bg-neutral-900 border border-gray-border text-gray-dim flex items-center justify-center cursor-pointer shadow-lg hover:text-white"
        title="Activar Reloj"
      >
        <Clock size={20} />
      </button>
    );
  }

  // Percentage for progress bar fill
  const progressPercent = totalPhaseTime > 0 ? (timeLeft / totalPhaseTime) * 100 : 0;

  // FAB color reflects official WA light when active
  const fabColorClass = isActive
    ? lightState === "RED"
      ? "bg-red-600 text-white"
      : lightState === "YELLOW"
      ? "bg-yellow-gold text-black"
      : "bg-green-success text-white"
    : "bg-[#121620] border border-white/15 text-cyan-neon";

  return (
    <>
      {/* Floating Action Button (FAB) */}
      <motion.button
        onClick={() => setIsOverlayOpen(true)}
        animate={isActive ? { scale: [1, 1.05, 1] } : {}}
        transition={isActive ? { repeat: Infinity, duration: 1.5 } : {}}
        className={`fixed bottom-[72px] right-4 z-40 w-[62px] h-[62px] rounded-full flex flex-col items-center justify-center shadow-2xl cursor-pointer ${fabColorClass}`}
      >
        <Clock size={24} />
        {isActive && (
          <span className="text-[10px] font-black mt-0.5 leading-none">
            {formatTime(timeLeft)}
          </span>
        )}
      </motion.button>

      {/* Full-Screen World Archery Official Timing & Traffic Light System */}
      <AnimatePresence>
        {isOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="clock_fs"
            className="fixed inset-0 z-[9999] flex flex-col justify-between p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] overflow-y-auto transition-all duration-300 bg-black"
          >
            {/* Ambient Official Light Border & Top Glow when Active */}
            {(isActive || phase === "stop") && (
              <div
                className={`pointer-events-none fixed inset-0 transition-all duration-300 border-[6px] ${
                  lightState === "RED"
                    ? "border-red-600 shadow-[inset_0_0_90px_rgba(220,38,38,0.35)]"
                    : lightState === "YELLOW"
                    ? "border-yellow-gold shadow-[inset_0_0_90px_rgba(255,229,0,0.30)]"
                    : "border-green-success shadow-[inset_0_0_90px_rgba(0,200,83,0.30)]"
                }`}
              />
            )}

            {/* Top Toolbar */}
            <div className="flex justify-between items-center w-full relative z-10">
              <div 
                className="flex items-center gap-1.5 select-none"
                style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
              >
                <span className="text-white text-xs sm:text-sm font-black tracking-wider uppercase">
                  ARCHERY
                </span>
                <div className="flex items-center tracking-tight font-extrabold text-xs sm:text-sm">
                  <span className="text-cyan-neon">10</span>
                  <span className="text-red-rival">10</span>
                  <span className="text-yellow-gold">10</span>
                </div>
                <span className="text-white/80 text-[11px] sm:text-xs font-black tracking-widest uppercase pl-0.5">
                  WA TIMER
                </span>
              </div>
              <button
                onClick={() => setIsOverlayOpen(false)}
                aria-label="Minimizar reloj"
                className="p-2 rounded-full bg-white/10 text-white cursor-pointer hover:bg-white/20 active:scale-95 transition"
              >
                <Minimize2 size={20} />
              </button>
            </div>

            {/* Run Panel (Ticking State or Finished Stop State) */}
            {isActive || phase === "stop" ? (
              <div className="flex-1 flex flex-col justify-center items-center gap-5 relative z-10 my-2">
                {/* OFFICIAL WORLD ARCHERY 3-LIGHT SEMAPHORE (RED / YELLOW / GREEN) */}
                <div className="flex items-center gap-4 bg-neutral-950/95 border border-white/15 px-6 py-3 rounded-full shadow-2xl">
                  {/* RED LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "RED"
                          ? "bg-red-600 border-red-300 shadow-[0_0_25px_#ef4444,0_0_50px_#dc2626] scale-110"
                          : "bg-red-950/30 border-red-900/30 opacity-30"
                      }`}
                    />
                  </div>
                  {/* YELLOW LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "YELLOW"
                          ? "bg-yellow-gold border-yellow-200 shadow-[0_0_25px_#FFE500,0_0_50px_#FFE500] scale-110"
                          : "bg-yellow-950/30 border-yellow-900/30 opacity-30"
                      }`}
                    />
                  </div>
                  {/* GREEN LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "GREEN"
                          ? "bg-green-success border-emerald-200 shadow-[0_0_25px_#00C853,0_0_50px_#00C853] scale-110"
                          : "bg-emerald-950/30 border-emerald-900/30 opacity-30"
                      }`}
                    />
                  </div>
                </div>

                {/* Official Phase & Signal Banner */}
                <div className="text-center flex flex-col items-center gap-1">
                  <span
                    className={`px-4 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider border inline-flex items-center justify-center gap-2 whitespace-nowrap ${
                      lightState === "RED"
                        ? "bg-red-600/20 border-red-500/50 text-red-400"
                        : lightState === "YELLOW"
                        ? "bg-yellow-gold/20 border-yellow-gold/50 text-yellow-gold"
                        : "bg-green-success/20 border-green-success/50 text-green-success"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        lightState === "RED"
                          ? "bg-red-500"
                          : lightState === "YELLOW"
                          ? "bg-yellow-gold"
                          : "bg-green-success"
                      }`}
                    />
                    <span>
                      {phase === "prep"
                        ? "LUZ ROJA · LÍNEA DE TIRO (2 PITIDOS)"
                        : phase === "stop"
                        ? "LUZ ROJA · FIN DE TIEMPO (3 PITIDOS)"
                        : lightState === "YELLOW"
                        ? `LUZ AMARILLA · ÚLTIMOS ${getWarningThreshold(shootTime)}s`
                        : "LUZ VERDE · TIEMPO DE TIRO (1 PITIDO)"}
                    </span>
                  </span>
                  <p className="text-white/70 text-xs font-bold mt-0.5">
                    {phase === "prep"
                      ? "Avanza a la línea de tiro · Prohibido levantar el arco"
                      : phase === "stop"
                      ? "Alto al fuego · Ir a anotar y recoger flechas"
                      : "Disparo autorizado"}
                  </p>
                </div>

                {/* Display giant clock digits */}
                <div
                  className={`text-[min(34vw,26vh)] font-black leading-none tracking-tighter select-none font-mono tabular-nums transition-colors duration-200 ${
                    lightState === "RED"
                      ? "text-red-500"
                      : lightState === "YELLOW"
                      ? "text-yellow-gold"
                      : "text-green-success"
                  }`}
                >
                  {formatTime(timeLeft)}
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-[500px] h-4 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      lightState === "RED"
                        ? "bg-red-600"
                        : lightState === "YELLOW"
                        ? "bg-yellow-gold"
                        : "bg-green-success"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Ticking Controls */}
                <div className="flex items-center gap-2.5 mt-2 flex-wrap justify-center">
                  {phase !== "stop" ? (
                    <button
                      onClick={handlePauseToggle}
                      className="h-11 px-5 rounded-xl bg-yellow-gold text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer hover:brightness-105 active:scale-95 transition"
                    >
                      {isPaused ? <Play size={15} /> : <Pause size={15} />}
                      <span>{isPaused ? t("resume") : t("pause")}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleStart}
                      className="h-11 px-5 rounded-xl bg-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-cyan-neon/90 active:scale-95 transition"
                    >
                      <Play size={15} />
                      <span>Nueva Ronda (2 Pitidos)</span>
                    </button>
                  )}
                  <button
                    onClick={handleResetPhase}
                    className="h-11 px-5 rounded-xl bg-green-success text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer hover:brightness-105 active:scale-95 transition"
                  >
                    <RotateCw size={15} />
                    <span>{t("resetPhase")}</span>
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="h-11 px-5 rounded-xl bg-white/15 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-white/25 active:scale-95 transition"
                  >
                    <Minimize2 size={15} />
                    <span>{t("minimize")}</span>
                  </button>
                  <button
                    onClick={handleStop}
                    className="h-11 px-5 rounded-xl bg-neutral-800 border border-white/20 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-neutral-700 active:scale-95 transition"
                  >
                    <Square size={15} />
                    <span>Configurar</span>
                  </button>
                </div>

                {/* Emergency Stop / Alto al Fuego (WA Rule 13.4 - 5 rapid horn blasts) */}
                <button
                  onClick={handleEmergencyStop}
                  className="h-11 px-6 rounded-full bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs uppercase tracking-widest flex items-center justify-center gap-2 whitespace-nowrap border border-red-400/40 active:scale-95 transition cursor-pointer"
                  title="Detención inmediata de tiro según reglamento World Archery"
                >
                  <AlertTriangle size={16} />
                  <span>Alto al Fuego (5 Pitidos)</span>
                </button>
              </div>
            ) : (
              // Config Panel (Idle Configuration State)
              <div className="flex-1 flex flex-col justify-center items-center w-full max-w-sm mx-auto gap-4 relative z-10 my-2">
                <div className="text-center">
                  <h2 className="text-white text-xl font-black tracking-wide uppercase">
                    Reloj Oficial World Archery
                  </h2>
                  <p className="text-gray-dim text-[11px] mt-0.5">
                    Reglamento WA: 2 pitidos (Rojo) · 1 pitido (Verde) · 30s (Amarillo) · 3 pitidos (Fin)
                  </p>
                </div>

                {/* Official WA Quick Presets */}
                <div className="w-full bg-[#0D1017] border border-white/[0.08] rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <span className="text-[9px] font-black uppercase text-cyan-neon tracking-wider px-1">
                    Formatos Oficiales World Archery
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {WA_OFFICIAL_PRESETS.map((preset) => {
                      const isSelected = shootTime === preset.shoot && prepTime === preset.prep;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            triggerHaptic("tick");
                            setPrepTime(preset.prep);
                            setShootTime(preset.shoot);
                          }}
                          className={`p-2 rounded-xl border text-left transition cursor-pointer flex flex-col ${
                            preset.id === "WA_20" ? "col-span-2" : ""
                          } ${
                            isSelected
                              ? "bg-cyan-neon/15 border-cyan-neon/50 text-white"
                              : "bg-[#090B0E] border-white/[0.06] text-gray-dim hover:text-white"
                          }`}
                        >
                          <span className="text-[11px] font-black uppercase text-white leading-tight">
                            {preset.label}
                          </span>
                          <span className="text-[9px] text-cyan-neon/80 font-bold">
                            {preset.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Sound Mode Selector Pills */}
                <div className="w-full bg-[#0D1017] border border-white/[0.08] rounded-2xl p-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase text-gray-dim tracking-wider flex items-center gap-1">
                      <Radio size={12} className="text-cyan-neon" />
                      Señal Acústica WA
                    </span>
                    <button
                      onClick={() => playWATestTone(soundMode)}
                      className="text-[10px] font-bold text-cyan-neon hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 size={12} />
                      <span>Probar</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("horn")}
                      className={`h-9 px-2 rounded-xl font-bold text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "horn"
                          ? "bg-cyan-neon text-black font-extrabold"
                          : "bg-[#090B0E] text-gray-dim hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>Bocina WA</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("whistle")}
                      className={`h-9 px-2 rounded-xl font-bold text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "whistle"
                          ? "bg-cyan-neon text-black font-extrabold"
                          : "bg-[#090B0E] text-gray-dim hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>Silbato</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("mute")}
                      className={`h-9 px-2 rounded-xl font-bold text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "mute"
                          ? "bg-red-500 text-white font-extrabold"
                          : "bg-[#090B0E] text-gray-dim hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>Silencio</span>
                    </button>
                  </div>

                  {/* Voice countdown toggle */}
                  <div className="flex items-center justify-between border-t border-white/5 pt-2 px-1">
                    <span className="text-[10px] text-white/70 font-medium">
                      Voz opcional en últimos 10s (Entrenamiento)
                    </span>
                    <button
                      type="button"
                      onClick={handleVoiceToggle}
                      aria-label="Cuenta regresiva de voz"
                      className={`w-10 h-5 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                        enableVoice ? "bg-cyan-neon" : "bg-neutral-800"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-black transition-transform absolute top-0.5 ${
                          enableVoice ? "left-5" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Manual adjust input fields */}
                <div className="grid grid-cols-2 gap-3 w-full">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-white/70 text-center font-bold">
                      Preparación (Rojo · s)
                    </label>
                    <input
                      type="number"
                      value={prepTime}
                      onChange={(e) => setPrepTime(Math.max(5, Number(e.target.value)))}
                      min="5"
                      max="30"
                      className="w-full bg-[#0D1017] border border-white/[0.12] text-white text-center text-lg font-black py-2 rounded-2xl outline-none focus:border-cyan-neon tabular-nums transition duration-200"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-white/70 text-center font-bold">
                      Tiro (Verde/Amarillo · s)
                    </label>
                    <input
                      type="number"
                      value={shootTime}
                      onChange={(e) => setShootTime(Math.max(10, Number(e.target.value)))}
                      min="10"
                      max="300"
                      className="w-full bg-[#0D1017] border border-white/[0.12] text-white text-center text-lg font-black py-2 rounded-2xl outline-none focus:border-cyan-neon tabular-nums transition duration-200"
                    />
                  </div>
                </div>

                {/* GIANT START BUTTON */}
                <motion.button
                  onClick={handleStart}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.94 }}
                  className="w-[112px] h-[112px] rounded-full bg-cyan-neon hover:bg-[#19c8ff] border-4 border-white/10 flex flex-col items-center justify-center gap-1 cursor-pointer text-black"
                >
                  <Play size={28} fill="black" className="ml-1" />
                  <span className="text-[11px] font-black tracking-widest uppercase">{t("startClock")}</span>
                </motion.button>

                {/* Sin Reloj & Cerrar Action Toggles */}
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    onClick={handleDisableToggle}
                    className="w-full h-11 rounded-2xl bg-yellow-gold hover:brightness-105 text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer"
                  >
                    {t("noClock")}
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="w-full h-11 rounded-2xl bg-[#0D1017] border border-white/[0.1] hover:bg-white/[0.06] text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap transition cursor-pointer"
                  >
                    <X size={14} />
                    <span>{t("closeClock")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Brand */}
            <div className="text-center text-[10px] text-white/30 uppercase tracking-widest mt-2 relative z-10">
              Archery 101010 · World Archery Official Timing System
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
