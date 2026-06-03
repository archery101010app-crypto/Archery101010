"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface IntroScreenProps {
  onComplete: () => void;
}

export default function IntroScreen({ onComplete }: IntroScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Show the minimal branding animation for 6 seconds, then trigger exit transition
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

      {/* Top Tagline in Good Times font, a bit larger */}
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

      {/* Central Clean Logo & Logotype */}
      <div className="relative flex flex-col items-center justify-center w-full flex-1 my-4">
        {/* Main Logo & Text Overlay (Strictly minimal, no HUD, no orbits, no grids) */}
        <div className="relative z-10 flex flex-col items-center gap-6">
          {/* Main Logo Icon */}
          <motion.img
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 80, damping: 15, delay: 0.2 }}
            src="/images/logo1.png"
            alt="Archery 101010 Logo Icon"
            className="w-20 h-20 object-contain drop-shadow-[0_0_20px_rgba(0,191,255,0.3)]"
          />

          {/* 10 10 10 Logotype */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 90 }}
            className="flex flex-baseline gap-1"
          >
            <div 
              className="flex text-5xl tracking-tighter font-extrabold" 
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              <span className="text-cyan-neon">10</span>
              <span className="text-red-rival">10</span>
              <span className="text-yellow-gold">10</span>
            </div>
            <span className="text-cyan-neon/60 text-xs font-black tracking-wider pl-0.5 align-super">
              v1.1
            </span>
          </motion.div>
        </div>
      </div>

      {/* Bottom Slogan */}
      <div className="w-full flex flex-col items-center justify-center min-h-[50px]">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8, ease: "easeOut" }}
          className="text-white text-xs sm:text-sm font-black uppercase tracking-[0.25em] text-center"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          Your Archery App
        </motion.h1>
      </div>
    </div>
  );
}
