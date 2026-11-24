"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCw, Minimize2, Square, X, Clock, Volume2, AlertTriangle, Radio } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getSpeechLocale, pickVoiceForLanguage } from "@/lib/i18n/regionalUtils";
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

export default function FloatingClock({ arrowsPerEnd = 3, onClockDisabledChange, onTimeUpdate }: FloatingClockProps) {
  const { language, t, tx } = useLanguage();
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  /**
   * Official World Archery Timing Presets (Book 2 Art. 7.3 & Book 3 Art. 13.4 / 15.1.1)
   * Current WA Standard: 30 seconds per arrow (90s for 3 arrows, 180s for 6 arrows)
   * Classic / Para-Archery: 40 seconds per arrow (120s for 3 arrows, 240s for 6 arrows)
   * Alternating Matchplay / Shoot-Off: 20 seconds (1 arrow)
   */
  const waOfficialPresets = [
    {
      id: "WA_90",
      label: tx("3 Flechas WA (90s)", "3 Arrows WA (90s)"),
      sub: tx("30s/flecha · Oficial", "30s/arrow · Official"),
      prep: 10,
      shoot: 90
    },
    {
      id: "WA_180",
      label: tx("6 Flechas WA (180s)", "6 Arrows WA (180s)"),
      sub: tx("30s/flecha · Oficial", "30s/arrow · Official"),
      prep: 10,
      shoot: 180
    },
    {
      id: "WA_120",
      label: tx("3 Flechas (120s)", "3 Arrows (120s)"),
      sub: tx("40s/flecha · Clásico", "40s/arrow · Classic"),
      prep: 10,
      shoot: 120
    },
    {
      id: "WA_240",
      label: tx("6 Flechas (240s)", "6 Arrows (240s)"),
      sub: tx("40s/flecha · Clásico", "40s/arrow · Classic"),
      prep: 10,
      shoot: 240
    },
    {
      id: "WA_20",
      label: tx("Duelo / 1 Flecha (20s)", "Match / 1 Arrow (20s)"),
      sub: tx("Tiro alternado WA", "Alternating WA"),
      prep: 10,
      shoot: 20
    }
  ];
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

  // Allow opening the clock overlay from top scoring header button
  useEffect(() => {
    const handleOpenClock = () => {
      if (isDisabled) {
        setIsDisabled(false);
        if (onClockDisabledChange) onClockDisabledChange(false);
      }
      setIsOverlayOpen(true);
    };
    window.addEventListener("open-archery-clock", handleOpenClock);
    return () => window.removeEventListener("open-archery-clock", handleOpenClock);
  }, [isDisabled, onClockDisabledChange]);

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
        const activeLang = languageRef.current || language || "es";
        const utterance = new SpeechSynthesisUtterance(String(num));
        utterance.lang = getSpeechLocale(activeLang);
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = pickVoiceForLanguage(voices, activeLang);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
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

  // Pure Timer ticking loop (zero side effects inside state updater)
  const lastSpokenSecRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive || isPaused) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive, isPaused]);

  // Phase transition & World Archery audio signal effect (driven cleanly by pure `timeLeft` state)
  useEffect(() => {
    if (!isActive || isPaused) return;

    if (phase === "prep") {
      if (timeLeft <= 0) {
        lastSpokenSecRef.current = null;
        setPhase("shoot");
        setTimeLeft(shootTime);
        setTotalPhaseTime(shootTime);
        playShootSignal();
      }
      return;
    }

    if (phase === "shoot") {
      if (timeLeft <= 10 && timeLeft > 0 && lastSpokenSecRef.current !== timeLeft) {
        lastSpokenSecRef.current = timeLeft;
        speakNumber(timeLeft);
      } else if (timeLeft <= 0) {
        lastSpokenSecRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setPhase("stop");
        setIsActive(false);
        playEndSignal();
      }
    }
  }, [isActive, isPaused, phase, timeLeft, shootTime]);

  // Clock Actions
  const handleStart = () => {
    triggerHaptic("confirm");
    initWAAudio();
    localStorage.setItem("relojSegsEntrada", String(prepTime));
    localStorage.setItem("relojSegsTiro", String(shootTime));

    lastSpokenSecRef.current = null;
    setPhase("prep");
    setTimeLeft(prepTime);
    setTotalPhaseTime(prepTime);
    setIsPaused(false);
    setIsActive(true);
    playPrepSignal(); // 2 beeps + Red Light
  };

  const handleEmergencyStop = () => {
    triggerHaptic("miss");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis?.cancel();
    }
    lastSpokenSecRef.current = null;
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

  const handlePauseToggle = () => {
    triggerHaptic("arrow");
    setIsPaused((prev) => !prev);
  };

  const handleResetPhase = () => {
    triggerHaptic("undo");
    lastSpokenSecRef.current = null;
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
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis?.cancel();
    }
    lastSpokenSecRef.current = null;
    setIsActive(false);
    setIsPaused(false);
    setPhase("prep");
    setTimeLeft(prepTime);
  };

  // Unmount cleanup: stop timer and cancel any active speechSynthesis countdown immediately
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

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

  // Percentage for progress bar fill
  const progressPercent = totalPhaseTime > 0 ? (timeLeft / totalPhaseTime) * 100 : 0;

  return (
    <>
      {/* Full-Screen World Archery Official Timing & Traffic Light System (No floating bubble FAB; controlled from top HUD) */}
      <AnimatePresence>
        {isOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="clock_fs"
            className="fixed inset-0 z-[9999] flex flex-col justify-between p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] overflow-y-auto transition-all duration-300 bg-black"
          >
            {/* Ambient Official Light Border when Active */}
            {(isActive || phase === "stop") && (
              <div
                className={`pointer-events-none fixed inset-0 transition-all duration-300 border-[6px] ${
                  lightState === "RED"
                    ? "border-red-600"
                    : lightState === "YELLOW"
                    ? "border-yellow-gold"
                    : "border-green-success"
                }`}
              />
            )}

            {/* Top Toolbar */}
            <div className="flex justify-between items-center w-full relative z-10 gap-2">
              <div className="flex items-center gap-2 select-none min-w-0">
                <img
                  src="/images/brand_logo_header.png"
                  srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                  alt="ARCHERY 101010"
                  className="h-3.5 sm:h-4 w-auto object-contain shrink-0"
                  draggable={false}
                />
                <span
                  className="text-white text-[15px] sm:text-[16.5px] font-black tracking-widest uppercase ps-0.5"
                  style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
                >
                  TIMER
                </span>
              </div>
              <button
                onClick={() => setIsOverlayOpen(false)}
                aria-label={t("minimize")}
                className="p-2 rounded-full bg-white/10 text-white cursor-pointer hover:bg-white/20 active:scale-95 transition shrink-0"
              >
                <Minimize2 size={20} />
              </button>
            </div>

            {/* Run Panel (Ticking State or Finished Stop State) */}
            {isActive || phase === "stop" ? (
              <div className="flex-1 flex flex-col justify-center items-center gap-5 relative z-10 my-2 w-full">
                {/* OFFICIAL WORLD ARCHERY 3-LIGHT SEMAPHORE (RED / YELLOW / GREEN) */}
                <div className="flex items-center gap-4 bg-[#0D1017] border border-white/15 px-6 py-3 rounded-full">
                  {/* RED LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "RED"
                          ? "bg-red-600 border-red-300 scale-110"
                          : "bg-red-950/30 border-red-900/30 opacity-30"
                      }`}
                    />
                  </div>
                  {/* YELLOW LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "YELLOW"
                          ? "bg-yellow-gold border-yellow-200 scale-110"
                          : "bg-yellow-950/30 border-yellow-900/30 opacity-30"
                      }`}
                    />
                  </div>
                  {/* GREEN LAMP */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full transition-all duration-200 border-2 ${
                        lightState === "GREEN"
                          ? "bg-green-success border-emerald-200 scale-110"
                          : "bg-emerald-950/30 border-emerald-900/30 opacity-30"
                      }`}
                    />
                  </div>
                </div>

                {/* Official Phase & Signal Banner */}
                <div className="text-center flex flex-col items-center gap-1 w-full max-w-md px-1">
                  <span
                    className={`max-w-full px-3 py-1.5 rounded-full text-[12px] sm:text-[13.8px] font-extrabold uppercase tracking-tight sm:tracking-wider border inline-flex items-center justify-center gap-1.5 text-center leading-snug ${
                      lightState === "RED"
                        ? "bg-white border-white text-black"
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
                    <span className="tabular-nums">
                      {phase === "prep"
                        ? tx("LUZ ROJA · LÍNEA DE TIRO (2 PITIDOS)", "RED LIGHT · SHOOTING LINE (2 BEEPS)")
                        : phase === "stop"
                        ? tx("LUZ ROJA · FIN DE TIEMPO (3 PITIDOS)", "RED LIGHT · TIME EXPIRED (3 BEEPS)")
                        : lightState === "YELLOW"
                        ? tx(
                            `LUZ AMARILLA · ÚLTIMOS ${getWarningThreshold(shootTime)}s`,
                            `YELLOW LIGHT · LAST ${getWarningThreshold(shootTime)}s`
                          )
                        : tx("LUZ VERDE · TIEMPO DE TIRO (1 PITIDO)", "GREEN LIGHT · SHOOTING TIME (1 BEEP)")}
                    </span>
                  </span>
                  <p className="text-white text-xs font-bold mt-0.5">
                    {phase === "prep"
                      ? tx("Avanza a la línea de tiro · Prohibido levantar el arco", "Walk to the shooting line · Do not raise bow")
                      : phase === "stop"
                      ? tx("Alto al fuego · Ir a anotar y recoger flechas", "Cease fire · Score and collect arrows")
                      : tx("Disparo autorizado", "Shooting authorized")}
                  </p>
                </div>

                {/* Display giant clock digits */}
                <div
                  className={`text-[min(34vw,26vh)] font-black leading-none tracking-tighter select-none font-sans tabular-nums transition-colors duration-200 ${
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
                <div className="grid grid-cols-2 sm:flex w-full max-w-md sm:max-w-none items-center gap-2 sm:gap-2.5 mt-2 sm:flex-wrap justify-center">
                  {phase !== "stop" ? (
                    <button
                      onClick={handlePauseToggle}
                      className="min-h-[46px] h-11.5 px-2.5 sm:px-5 rounded-xl bg-yellow-gold text-black font-extrabold text-[12.5px] sm:text-[13.8px] uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 text-center leading-tight sm:whitespace-nowrap cursor-pointer hover:brightness-105 active:scale-95 transition min-w-0"
                    >
                      {isPaused ? <Play size={15} className="shrink-0" /> : <Pause size={15} className="shrink-0" />}
                      <span className="min-w-0">{isPaused ? t("resume") : t("pause")}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleStart}
                      className="min-h-[46px] h-11.5 px-2.5 sm:px-5 rounded-xl bg-cyan-neon text-black font-extrabold text-[12.5px] sm:text-[13.8px] uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 text-center leading-tight sm:whitespace-nowrap cursor-pointer hover:bg-cyan-neon/90 active:scale-95 transition min-w-0"
                    >
                      <Play size={14} className="shrink-0" />
                      <span className="min-w-0">{tx("Nueva Ronda (2 Pitidos)", "New End (2 Beeps)")}</span>
                    </button>
                  )}
                  <button
                    onClick={handleResetPhase}
                    className="min-h-[46px] h-11.5 px-2.5 sm:px-5 rounded-xl bg-green-success text-white font-extrabold text-[12.5px] sm:text-[13.8px] uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 text-center leading-tight sm:whitespace-nowrap cursor-pointer hover:brightness-105 active:scale-95 transition min-w-0"
                  >
                    <RotateCw size={15} className="shrink-0" />
                    <span className="min-w-0">{t("resetPhase")}</span>
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="min-h-[46px] h-11.5 px-2.5 sm:px-5 rounded-xl bg-white/15 text-white font-extrabold text-[12.5px] sm:text-[13.8px] uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 text-center leading-tight sm:whitespace-nowrap cursor-pointer hover:bg-white/25 active:scale-95 transition min-w-0"
                  >
                    <Minimize2 size={15} className="shrink-0" />
                    <span className="min-w-0">{t("minimize")}</span>
                  </button>
                  <button
                    onClick={handleStop}
                    className="min-h-[46px] h-11.5 px-2.5 sm:px-5 rounded-xl bg-neutral-800 border border-white/20 text-white font-extrabold text-[12.5px] sm:text-[13.8px] uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 text-center leading-tight sm:whitespace-nowrap cursor-pointer hover:bg-neutral-700 active:scale-95 transition min-w-0"
                  >
                    <Square size={15} className="shrink-0" />
                    <span className="min-w-0">{tx("Configurar", "Configure")}</span>
                  </button>
                </div>

                {/* Emergency Stop / Alto al Fuego (WA Rule 13.4 - 5 rapid horn blasts) */}
                <button
                  onClick={handleEmergencyStop}
                  className="min-h-[46px] h-11.5 w-full max-w-md sm:w-auto px-4 sm:px-6 rounded-full bg-white hover:bg-neutral-200 text-black font-black text-[12.5px] sm:text-[13.8px] uppercase tracking-wider sm:tracking-widest flex items-center justify-center gap-2 text-center leading-tight whitespace-nowrap border border-white active:scale-95 transition cursor-pointer"
                  title={tx("Detención inmediata de tiro según reglamento World Archery", "Immediate emergency stop per World Archery rules")}
                >
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{tx("Alto al Fuego (5 Pitidos)", "Emergency Stop (5 Beeps)")}</span>
                </button>
              </div>
            ) : (
              // Config Panel (Idle Configuration State)
              <div className="flex-1 flex flex-col justify-center items-center w-full max-w-sm mx-auto gap-4 relative z-10 my-2">
                <div className="text-center">
                  <p className="text-white text-[12.8px]">
                    {tx(
                      "Reglamento WA: 2 pitidos (Rojo) · 1 pitido (Verde) · 30s (Amarillo) · 3 pitidos (Fin)",
                      "WA Rules: 2 beeps (Red) · 1 beep (Green) · 30s (Yellow) · 3 beeps (End)"
                    )}
                  </p>
                </div>

                {/* Official WA Quick Presets */}
                <div className="w-full bg-[#0D1017] border border-white/[0.08] rounded-2xl p-2.5 flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-black uppercase text-cyan-neon tracking-wider px-1">
                    {tx("Formatos Oficiales World Archery", "Official World Archery Formats")}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {waOfficialPresets.map((preset) => {
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
                          className={`p-2 rounded-xl border text-start transition cursor-pointer flex flex-col ${
                            preset.id === "WA_20" ? "col-span-2" : ""
                          } ${
                            isSelected
                              ? "bg-cyan-neon/15 border-cyan-neon/50 text-white"
                              : "bg-[#090B0E] border-white/[0.06] text-white hover:text-white"
                          }`}
                        >
                          <span className="text-[12.8px] font-black uppercase text-white leading-tight">
                            {preset.label}
                          </span>
                          <span className="text-[10.5px] text-cyan-neon font-bold">
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
                    <span className="text-[11.6px] font-black uppercase text-white tracking-wider flex items-center gap-1">
                      <Radio size={12} className="text-cyan-neon" />
                      {tx("Señal Acústica WA", "WA Sound Signal")}
                    </span>
                    <button
                      onClick={() => playWATestTone(soundMode)}
                      className="text-[11.6px] font-bold text-cyan-neon hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 size={12} />
                      <span>{tx("Probar", "Test")}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("horn")}
                      className={`h-9 px-2 rounded-xl font-bold text-[12.8px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "horn"
                          ? "bg-cyan-neon text-black font-extrabold"
                          : "bg-[#090B0E] text-white hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>{tx("Bocina WA", "WA Horn")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("whistle")}
                      className={`h-9 px-2 rounded-xl font-bold text-[12.8px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "whistle"
                          ? "bg-cyan-neon text-black font-extrabold"
                          : "bg-[#090B0E] text-white hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>{tx("Silbato", "Whistle")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("mute")}
                      className={`h-9 px-2 rounded-xl font-bold text-[12.8px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center whitespace-nowrap ${
                        soundMode === "mute"
                          ? "bg-red-500 text-white font-extrabold"
                          : "bg-[#090B0E] text-white hover:text-white border border-white/[0.06]"
                      }`}
                    >
                      <span>{tx("Silencio", "Mute")}</span>
                    </button>
                  </div>

                  {/* Voice countdown toggle */}
                  <div className="flex items-center justify-between border-t border-white/5 pt-2 px-1">
                    <span className="text-[11.6px] text-white font-medium">
                      {tx("Voz opcional en últimos 10s (Entrenamiento)", "Optional voice countdown in last 10s (Practice)")}
                    </span>
                    <button
                      type="button"
                      onClick={handleVoiceToggle}
                      aria-label={tx("Cuenta regresiva de voz", "Voice countdown")}
                      className={`w-10 h-5 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                        enableVoice ? "bg-cyan-neon" : "bg-neutral-800"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full bg-black transition-transform absolute top-0.5 ${
                          enableVoice ? "start-5" : "start-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Manual adjust input fields */}
                <div className="grid grid-cols-2 gap-3 w-full">
                  <div className="flex flex-col gap-1">
                    <label className="text-[12.8px] text-white text-center font-bold">
                      {t("prepSecs")}
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
                    <label className="text-[12.8px] text-white text-center font-bold">
                      {t("shootSecs")}
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
                  <Play size={28} fill="black" className="ms-1" />
                  <span className="text-[12.8px] font-black tracking-widest uppercase">{t("startClock")}</span>
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
            <div className="text-center text-[11.6px] text-white uppercase tracking-widest mt-2 relative z-10">
              Archery 101010 · World Archery Official Timing System
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
