"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface IntroScreenProps {
  onComplete: () => void;
}

export default function IntroScreen({ onComplete }: IntroScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Show the branding animation for 6 seconds, then trigger exit transition
    const timerExit = setTimeout(() => {
      setIsExiting(true);
      const timerComplete = setTimeout(onComplete, 700);
      return () => clearTimeout(timerComplete);
    }, 6000);

    return () => clearTimeout(timerExit);
  }, [onComplete]);

  const handleSkip = () => {
    setIsExiting(true);
    setTimeout(onComplete, 400);
  };

  return (
    <div
      className={`absolute inset-0 z-[60] bg-black flex flex-col items-center justify-between py-16 px-6 overflow-hidden transition-opacity duration-700 ${
        isExiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Skip Button */}
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 z-[70] px-3.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-95 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all cursor-pointer"
      >
        Saltar
      </button>

      {/* Top Tagline in Good Times font */}
      <motion.div
        initial={{ y: -15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center"
      >
        <span 
          className="text-xs sm:text-sm text-cyan-neon font-black tracking-[0.25em] uppercase block"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          SISTEMA DE ENTRENAMIENTO
        </span>
      </motion.div>

      {/* Central HUD with concentric circles and extra-large logo */}
      <div className="relative flex items-center justify-center w-full flex-1 my-4">
        {/* Concentric HUD Rings */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute w-72 h-72 rounded-full border border-dashed border-cyan-neon/15 flex items-center justify-center pointer-events-none"
        >
          <div className="w-64 h-64 rounded-full border border-dotted border-red-rival/10" />
        </motion.div>

        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          className="absolute w-56 h-56 rounded-full border border-cyan-neon/20 border-t-transparent border-b-transparent pointer-events-none"
        />

        {/* Central glowing backdrop light */}
        <div className="absolute w-48 h-48 rounded-full bg-cyan-neon/5 blur-2xl pointer-events-none" />

        {/* Centered Extra-Large Main Logo (Protrudes outside the circles, dynamic zoom-in) */}
        <div className="relative z-10 flex flex-col items-center justify-center">
          <motion.img
            initial={{ scale: 0.05, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ 
              duration: 1.5, 
              ease: [0.34, 1.56, 0.64, 1], // Custom back-out overshoot curve for dramatic entrance
              delay: 0.2 
            }}
            src="/images/logo1.png"
            alt="Archery 101010 Logo Icon"
            className="w-80 h-80 object-contain drop-shadow-[0_0_35px_rgba(0,191,255,0.5)]"
          />
        </div>
      </div>

      {/* Bottom Slogan with curved tricolor line */}
      <div className="w-full flex flex-col items-center justify-center min-h-[80px]">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8, ease: "easeOut" }}
          className="text-white text-xs sm:text-sm font-black uppercase tracking-[0.25em] text-center"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          Your Archery App
        </motion.h1>

        {/* Dynamic tricolor underline stroke */}
        <div className="w-48 h-6 relative overflow-hidden mt-1">
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 200 20"
            className="absolute inset-0 pointer-events-none opacity-80"
          >
            <motion.path
              d="M 15,5 Q 100,14 185,5"
              fill="none"
              stroke="url(#slogan-gradient)"
              strokeWidth="2"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.5, ease: "easeInOut", delay: 1.0 }}
            />
            <defs>
              <linearGradient id="slogan-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#00BFFF" /> {/* Cyan */}
                <stop offset="50%" stopColor="#FF0000" /> {/* Red */}
                <stop offset="100%" stopColor="#FFE500" /> {/* Yellow */}
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    </div>
  );
}
