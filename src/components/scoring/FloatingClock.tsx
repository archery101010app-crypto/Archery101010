"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, RotateCw, Minimize2, Square, X, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/contexts/LanguageContext";

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
  
  // State
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false); // "Sin Reloj"
  const [phase, setPhase] = useState<"prep" | "shoot">("prep");
  const [timeLeft, setTimeLeft] = useState(10);
  const [totalPhaseTime, setTotalPhaseTime] = useState(10);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load presets from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPrep = localStorage.getItem("relojSegsEntrada");
      const savedShoot = localStorage.getItem("relojSegsTiro");
      if (savedPrep) setPrepTime(Number(savedPrep));
      if (savedShoot) setShootTime(Number(savedShoot));
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

  // Audio context initializer
  const initAudio = () => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.error("Web Audio API not supported", e);
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
  };

  // Web Audio Synth Beeper
  const beep = (freq: number, duration: number, volume: number) => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.frequency.value = freq;
      osc.type = "square";
      const now = ctx.currentTime;

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.03);
      gainNode.gain.setValueAtTime(volume, now + duration - 0.06);
      gainNode.gain.linearRampToValueAtTime(0, now + duration);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn("Beep synthesis failed", e);
    }
  };

  // Whistles & Beeps definitions
  const playPrepSignal = () => {
    beep(660, 1.0, 0.7);
    setTimeout(() => beep(660, 1.0, 0.7), 1200); // 2 long whistles
  };

  const playShootSignal = () => {
    beep(880, 1.2, 0.8); // 1 long whistle
  };

  const playEndSignal = () => {
    beep(440, 0.9, 0.8);
    setTimeout(() => beep(440, 0.9, 0.8), 1050);
    setTimeout(() => beep(440, 0.9, 0.8), 2100); // 3 whistles
  };

  const playWarningBeep = () => {
    beep(550, 0.18, 0.4);
  };

  // Text-To-Speech Synthesizer
  const speakNumber = (num: number) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        const utterance = new SpeechSynthesisUtterance(String(num));
        utterance.lang = "es-ES";
        utterance.rate = 1.2;
        utterance.pitch = 1.0;
        utterance.volume = 0.9;
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
            // Transition to shoot phase
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
            // Timer expired
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
    initAudio();
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
    setIsPaused(!isPaused);
  };

  const handleResetPhase = () => {
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

  const formatTime = (seconds: number) => {
    const s = Math.max(0, seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
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
            className="fixed inset-0 z-[9999] flex flex-col justify-between p-6 transition-all duration-300"
          >
            {/* Top Toolbar */}
            <div className="flex justify-between items-center w-full">
              <span className="text-white/60 font-black text-xs tracking-widest uppercase">
                Archery 101010 Timer
              </span>
              <button
                onClick={() => setIsOverlayOpen(false)}
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
                <div className="flex items-center gap-4 mt-4 flex-wrap justify-center">
                  <button
                    onClick={handlePauseToggle}
                    className="px-6 py-3.5 rounded-2xl bg-yellow-gold text-black font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    {isPaused ? <Play size={16} /> : <Pause size={16} />}
                    <span>{isPaused ? t("resume") : t("pause")}</span>
                  </button>
                  <button
                    onClick={handleResetPhase}
                    className="px-6 py-3.5 rounded-2xl bg-green-success text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    <RotateCw size={16} />
                    <span>{t("resetPhase")}</span>
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="px-6 py-3.5 rounded-2xl bg-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg hover:bg-white/25 active:scale-95 transition"
                  >
                    <Minimize2 size={16} />
                    <span>{t("minimize")}</span>
                  </button>
                  <button
                    onClick={handleStop}
                    className="px-6 py-3.5 rounded-2xl bg-red-rival text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-lg hover:brightness-110 active:scale-95 transition"
                  >
                    <Square size={16} />
                    <span>{t("stop")}</span>
                  </button>
                </div>
              </div>
            ) : (
              // Config Panel (Idle Configuration State)
              <div className="flex-1 flex flex-col justify-center items-center w-full max-w-sm mx-auto gap-8">
                <div className="text-center">
                  <h2 className="text-white text-2xl font-black tracking-wide uppercase">
                    {t("clockTitle")}
                  </h2>
                  <p className="text-gray-dim text-xs mt-1">
                    Ajusta los segundos libremente
                  </p>
                </div>

                {/* Manual adjust input fields */}
                <div className="grid grid-cols-2 gap-4 w-full">
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
                      className="w-full bg-white/10 border border-white/20 text-white text-center text-xl font-black py-3 rounded-2xl outline-none focus:border-cyan-neon focus:bg-white/15 transition duration-200"
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
                      className="w-full bg-white/10 border border-white/20 text-white text-center text-xl font-black py-3 rounded-2xl outline-none focus:border-cyan-neon focus:bg-white/15 transition duration-200"
                    />
                  </div>
                </div>

                {/* GIANT START BUTTON (140x140px) */}
                <motion.button
                  onClick={handleStart}
                  whileHover={{ scale: 1.06, boxShadow: "0 0 30px rgba(0,229,255,0.4)" }}
                  whileTap={{ scale: 0.92 }}
                  className="w-[140px] h-[140px] rounded-full bg-gradient-to-br from-cyan-brand to-cyan-neon border-4 border-white/10 shadow-[0_10px_25px_rgba(0,162,232,0.3)] flex flex-col items-center justify-center gap-1 cursor-pointer text-white"
                >
                  <Play size={32} fill="white" className="ml-1" />
                  <span className="text-xs font-black tracking-widest uppercase">{t("startClock")}</span>
                </motion.button>

                {/* Sin Reloj & Cerrar Action Toggles */}
                <div className="flex flex-col gap-2 w-full mt-4">
                  <button
                    onClick={handleDisableToggle}
                    className="w-full py-3.5 rounded-2xl bg-yellow-gold/80 hover:bg-yellow-gold text-black font-black text-xs uppercase tracking-wider transition cursor-pointer"
                  >
                    🚫 {t("noClock")}
                  </button>
                  <button
                    onClick={() => setIsOverlayOpen(false)}
                    className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
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
