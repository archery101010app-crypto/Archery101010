"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCw, Minimize2, Square, X, Clock, Volume2, VolumeX, AlertTriangle, Radio } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { 
  initWAAudio, 
  playWA2Beeps, 
  playWA1Beep, 
  playWA3Beeps, 
  playWA5EmergencyBeeps, 
  playWAWarning30s, 
  playWATestTone, 
  WASoundMode 
} from "@/lib/audio/waAudioSignals";
import { triggerHaptic } from "@/lib/haptics";
import { useWakeLock } from "@/lib/useWakeLock";

interface FloatingClockProps {
  onClockDisabledChange?: (disabled: boolean) => void;
  // Exposes current clock time to inline mini widget
  onTimeUpdate?: (timeStr: string, phase: "prep" | "shoot" | null, isOver: boolean, isWarn: boolean) => void;
}

export default function FloatingClock({ onClockDisabledChange, onTimeUpdate }: FloatingClockProps) {
  const { t } = useLanguage();
  // Config
  const [prepTime, setPrepTime] = useState(10);
  const [shootTime, setShootTime] = useState(120);
  const [soundMode, setSoundMode] = useState<WASoundMode>("horn");
  const [enableVoice, setEnableVoice] = useState(true);
  
  // State
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false); // "Sin Reloj"
  useWakeLock(isActive); // Keep display awake during active countdown/timer
  const [phase, setPhase] = useState<"prep" | "shoot">("prep");
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

  // Load presets from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPrep = localStorage.getItem("relojSegsEntrada");
      const savedShoot = localStorage.getItem("relojSegsTiro");
      const savedMode = localStorage.getItem("relojSoundMode") as WASoundMode;
      const savedVoice = localStorage.getItem("relojVoice");
      if (savedPrep) setPrepTime(Number(savedPrep));
      if (savedShoot) setShootTime(Number(savedShoot));
      if (savedMode && ["horn", "whistle", "mute"].includes(savedMode)) {
        setSoundMode(savedMode);
      }
      if (savedVoice !== null) {
        setEnableVoice(savedVoice === "true");
      }
    }
  }, []);

  // Sync to parent mini clock view
  useEffect(() => {
    if (onTimeUpdate) {
      if (!isActive) {
        onTimeUpdate("", null, false, false);
      } else {
        const isWarn = phase === "shoot" && timeLeft <= 30 && timeLeft > 0;
        onTimeUpdate(formatTime(timeLeft), phase, timeLeft <= 0, isWarn);
      }
    }
  }, [timeLeft, phase, isActive, onTimeUpdate]);

  // Whistles & Beeps definitions via World Archery synthesizer
  const playPrepSignal = () => {
    playWA2Beeps(soundMode);
  };

  const playShootSignal = () => {
    playWA1Beep(soundMode);
  };

  const playEndSignal = () => {
    playWA3Beeps(soundMode);
  };

  const playWarningBeep = () => {
    playWAWarning30s(soundMode);
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
          // Warning beeps in preparation phase (last 3 seconds)
          if (nextVal <= 3 && nextVal > 0) {
            playWarningBeep();
          }
          
          if (nextVal <= 0) {
            // Transition to shoot phase: 1 solid whistle/horn blast
            setPhase("shoot");
            setTimeLeft(shootTime);
            setTotalPhaseTime(shootTime);
            playShootSignal();
            return shootTime;
          }
        } else {
          // Warning at 30 seconds remaining
          if (nextVal === 30) {
            playWarningBeep();
          }
          
          // Speech synthesis for final 10 seconds of shooting time
          if (nextVal <= 10 && nextVal > 0) {
            speakNumber(nextVal);
          }

          if (nextVal <= 0) {
            // Timer expired: 3 whistles/horn blasts to stop
            if (timerRef.current) clearInterval(timerRef.current);
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
    playPrepSignal();

    startTimerLoop();
  };

  const handleEmergencyStop = () => {
    triggerHaptic("miss");
    if (timerRef.current) clearInterval(timerRef.current);
    setIsActive(false);
    setIsPaused(false);
    setPhase("prep");
    setTimeLeft(prepTime);
    playWA5EmergencyBeeps(soundMode);
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
    setTimeLeft(phase === "prep" ? prepTime : shootTime);
    setTotalPhaseTime(phase === "prep" ? prepTime : shootTime);
    setIsPaused(false);
    if (!isActive) {
      setIsActive(true);
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

  // Color logic for full-screen overlay based on phase
  const getFaseDataAttribute = () => {
    if (timeLeft <= 0) return "over";
    if (phase === "shoot" && timeLeft <= 30) return "warn";
    return phase;
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

  return (
    <>
      {/* Floating Action Button (FAB) */}
      <motion.button
        onClick={() => setIsOverlayOpen(true)}
        animate={isActive ? { scale: [1, 1.05, 1] } : {}}
        transition={isActive ? { repeat: Infinity, duration: 1.5 } : {}}
        className={`fixed bottom-[72px] right-4 z-40 w-[62px] h-[62px] rounded-full flex flex-col items-center justify-center shadow-2xl cursor-pointer ${
          isActive
            ? "bg-green-success text-white shadow-[0_0_15px_rgba(0,200,83,0.4)]"
            : "bg-cyan-brand text-white shadow-[0_0_15px_rgba(0,162,232,0.3)] animate-fab-pulse"
        }`}
      >
        <Clock size={24} />
        {isActive && (
          <span className="text-[10px] font-black mt-0.5 leading-none">
            {formatTime(timeLeft)}
          </span>
        )}
      </motion.button>

      {/* Full-Screen Tabata Overlay */}
      <AnimatePresence>
        {isOverlayOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id="clock_fs"
            data-fase={getFaseDataAttribute()}
            className="fixed inset-0 z-[9999] flex flex-col justify-between p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-y-auto transition-all duration-300"
          >
            {/* Top Toolbar */}
            <div className="flex justify-between items-center w-full">
              <span className="text-white/60 font-black text-xs tracking-widest uppercase">
                Archery 101010 Timer
              </span>
              <button
                onClick={() => setIsOverlayOpen(false)}
                aria-label="Minimizar reloj"
                className="p-2 rounded-full bg-white/10 text-white cursor-pointer hover:bg-white/20 transition"
              >
                <Minimize2 size={20} />
              </button>
            </div>

            {/* Run Panel (Ticking State) */}
            {isActive ? (
              <div className="flex-1 flex flex-col justify-center items-center gap-8">
                {/* Labels */}
                <div className="text-center">
                  <h2 className="text-white/80 font-black text-lg md:text-xl tracking-[0.15em] uppercase">
                    {phase === "prep" ? t("phasePrep") : t("phaseShoot")}
                  </h2>
                  <p className="text-white/60 text-sm md:text-base font-medium mt-1">
                    {phase === "prep" ? t("statePrep") : t("stateShoot")}
                  </p>
                </div>

                {/* Display giant clock digits */}
                <div className="text-[min(34vw,28vh)] font-black text-white leading-none tracking-tighter select-none font-mono drop-shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
                  {formatTime(timeLeft)}
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-[500px] h-4 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-100 ${
                      timeLeft <= 0
                        ? "bg-red-rival"
                        : phase === "shoot" && timeLeft <= 30
                        ? "bg-yellow-gold"
                        : "bg-green-success"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Ticking Controls */}
                <div className="flex items-center gap-3 mt-4 flex-wrap justify-center">
                  <button
                    onClick={handlePauseToggle}
                    className="px-5 py-3 rounded-2xl bg-yellow-gold text-black font-black text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    {isPaused ? <Play size={15} /> : <Pause size={15} />}
                    <span>{isPaused ? t("resume") : t("pause")}</span>
                  </button>
                  <button
                    onClick={handleResetPhase}
                    className="px-5 py-3 rounded-2xl bg-green-success text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    <RotateCw size={15} />
                    <span>{t("resetPhase")}</span>
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="px-5 py-3 rounded-2xl bg-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-lg hover:bg-white/25 active:scale-95 transition"
                  >
                    <Minimize2 size={15} />
                    <span>{t("minimize")}</span>
                  </button>
                  <button
                    onClick={handleStop}
                    className="px-5 py-3 rounded-2xl bg-neutral-800 border border-white/20 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-lg hover:bg-neutral-700 active:scale-95 transition"
                  >
                    <Square size={15} />
                    <span>{t("stop")}</span>
                  </button>
                </div>

                {/* Emergency Stop / Alto al Fuego (WA Rule 13.4 - 5 rapid horn blasts) */}
                <button
                  onClick={handleEmergencyStop}
                  className="px-6 py-3 rounded-full bg-red-600/90 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest flex items-center gap-2 border border-red-400/40 shadow-[0_0_20px_rgba(239,68,68,0.5)] active:scale-95 transition cursor-pointer"
                  title="Detención inmediata de tiro según reglamento World Archery"
                >
                  <AlertTriangle size={16} />
                  <span>🚨 Alto al Fuego (5 Pitidos)</span>
                </button>
              </div>
            ) : (
              // Config Panel (Idle Configuration State)
              <div className="flex-1 flex flex-col justify-center items-center w-full max-w-sm mx-auto gap-5">
                <div className="text-center">
                  <h2 className="text-white text-2xl font-black tracking-wide uppercase">
                    {t("clockTitle")}
                  </h2>
                  <p className="text-gray-dim text-xs mt-0.5">
                    Señales oficiales World Archery & temporizador
                  </p>
                </div>

                {/* Sound Mode Selector Pills */}
                <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-2.5 flex flex-col gap-2">
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
                      className={`py-2 px-1 rounded-xl font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-0.5 ${
                        soundMode === "horn"
                          ? "bg-cyan-neon text-black shadow-glow-cyan"
                          : "bg-white/5 text-gray-dim hover:text-white border border-white/5"
                      }`}
                    >
                      <span>📢 Bocina WA</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("whistle")}
                      className={`py-2 px-1 rounded-xl font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-0.5 ${
                        soundMode === "whistle"
                          ? "bg-cyan-neon text-black shadow-glow-cyan"
                          : "bg-white/5 text-gray-dim hover:text-white border border-white/5"
                      }`}
                    >
                      <span>🎷 Silbato</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSoundModeChange("mute")}
                      className={`py-2 px-1 rounded-xl font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex flex-col items-center gap-0.5 ${
                        soundMode === "mute"
                          ? "bg-red-500 text-white"
                          : "bg-white/5 text-gray-dim hover:text-white border border-white/5"
                      }`}
                    >
                      <span>🔇 Silencio</span>
                    </button>
                  </div>

                  {/* Voice countdown toggle */}
                  <div className="flex items-center justify-between border-t border-white/5 pt-2 px-1">
                    <span className="text-[11px] text-white/80 font-medium">
                      Cuenta regresiva de voz (últimos 10s)
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/70 text-center font-bold">
                      {t("prepSecs")}
                    </label>
                    <input
                      type="number"
                      value={prepTime}
                      onChange={(e) => setPrepTime(Math.max(5, Number(e.target.value)))}
                      min="5"
                      max="30"
                      className="w-full bg-white/10 border border-white/20 text-white text-center text-xl font-black py-2.5 rounded-2xl outline-none focus:border-cyan-neon focus:bg-white/15 transition duration-200"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-white/70 text-center font-bold">
                      {t("shootSecs")}
                    </label>
                    <input
                      type="number"
                      value={shootTime}
                      onChange={(e) => setShootTime(Math.max(30, Number(e.target.value)))}
                      min="30"
                      max="300"
                      className="w-full bg-white/10 border border-white/20 text-white text-center text-xl font-black py-2.5 rounded-2xl outline-none focus:border-cyan-neon focus:bg-white/15 transition duration-200"
                    />
                  </div>
                </div>

                {/* GIANT START BUTTON (130x130px) */}
                <motion.button
                  onClick={handleStart}
                  whileHover={{ scale: 1.06, boxShadow: "0 0 30px rgba(0,229,255,0.4)" }}
                  whileTap={{ scale: 0.92 }}
                  className="w-[130px] h-[130px] rounded-full bg-gradient-to-br from-cyan-brand to-cyan-neon border-4 border-white/10 shadow-[0_10px_25px_rgba(0,162,232,0.3)] flex flex-col items-center justify-center gap-1 cursor-pointer text-white"
                >
                  <Play size={30} fill="white" className="ml-1" />
                  <span className="text-xs font-black tracking-widest uppercase">{t("startClock")}</span>
                </motion.button>

                {/* Sin Reloj & Cerrar Action Toggles */}
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={handleDisableToggle}
                    className="w-full py-3 rounded-2xl bg-yellow-gold/80 hover:bg-yellow-gold text-black font-black text-xs uppercase tracking-wider transition cursor-pointer"
                  >
                    🚫 {t("noClock")}
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <X size={14} />
                    <span>{t("closeClock")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Brand */}
            <div className="text-center text-[10px] text-white/30 uppercase tracking-widest mt-4">
              Archery 101010 Olympic System
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
