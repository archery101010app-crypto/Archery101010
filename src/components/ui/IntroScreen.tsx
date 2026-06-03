"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface IntroScreenProps {
  onComplete: () => void;
}

export default function IntroScreen({ onComplete }: IntroScreenProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Show the branding page animation for 6 seconds, then trigger exit transition
    const timerExit = setTimeout(() => {
      setIsExiting(true);
      const timerComplete = setTimeout(onComplete, 700); // call parent onComplete after fadeout
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
      {/* Ambient background mesh of brand colors */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 30%, rgba(0, 191, 255, 0.12) 0%, transparent 50%),
                       radial-gradient(circle at 70% 70%, rgba(255, 0, 0, 0.08) 0%, transparent 50%),
                       radial-gradient(circle at 50% 50%, rgba(255, 229, 0, 0.06) 0%, transparent 40%)`
        }}
      />

      {/* Subtle tech grid backdrop */}
      <div 
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />

      {/* Skip Button */}
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 z-[70] px-3.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-95 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all cursor-pointer"
      >
        Saltar
      </button>

      {/* Top Tagline */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center"
      >
        <span className="text-[10px] text-cyan-neon/80 font-black tracking-[0.3em] uppercase block mb-1">
          SISTEMA DE ENTRENAMIENTO
        </span>
        <div className="h-[1px] w-12 bg-cyan-neon/30 mx-auto rounded-full" />
      </motion.div>

      {/* Central HUD with logos */}
      <div className="relative flex flex-col items-center justify-center w-full flex-1 my-4">
        {/* Outer HUD Rings rotating */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute w-60 h-60 rounded-full border border-dashed border-cyan-neon/15 flex items-center justify-center pointer-events-none"
        >
          <div className="w-52 h-52 rounded-full border border-dotted border-red-rival/10" />
        </motion.div>

        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute w-44 h-44 rounded-full border border-cyan-neon/20 border-t-transparent border-b-transparent pointer-events-none"
        />

        {/* Central glowing light */}
        <div className="absolute w-28 h-28 rounded-full bg-cyan-neon/5 blur-xl pointer-events-none" />

        {/* Main Logo & Text Overlay */}
        <div className="relative z-10 flex flex-col items-center gap-5">
          {/* Custom Logo Container with orbits */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            {/* Main Target Dianas Icon */}
            <motion.img
              initial={{ scale: 0, rotate: -60, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 90, damping: 12, delay: 0.3 }}
              src="/images/logo1.png"
              alt="Archery 101010 Logo Icon"
              className="w-16 h-16 object-contain z-20 drop-shadow-[0_0_15px_rgba(0,191,255,0.45)]"
            />

            {/* Orbiting side logos */}
            <motion.img
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 0.85, opacity: 0.35, x: -28, y: -20 }}
              transition={{ delay: 0.7, duration: 0.7, ease: "easeOut" }}
              src="/images/logo2.png"
              className="absolute w-10 h-10 object-contain z-10 filter hue-rotate-30"
            />

            <motion.img
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 0.85, opacity: 0.35, x: 28, y: 20 }}
              transition={{ delay: 0.8, duration: 0.7, ease: "easeOut" }}
              src="/images/logo4.png"
              className="absolute w-10 h-10 object-contain z-10 filter hue-rotate-180"
            />
          </div>

          {/* 10 10 10 Logotype */}
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5, type: "spring", stiffness: 100 }}
            className="flex flex-baseline gap-1"
          >
            <div 
              className="flex text-4xl tracking-tighter font-extrabold" 
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              <span className="text-cyan-neon">10</span>
              <span className="text-red-rival">10</span>
              <span className="text-yellow-gold">10</span>
            </div>
            <span className="text-cyan-neon/60 text-[10px] font-black tracking-wider pl-0.5 align-super">
              v1.1
            </span>
          </motion.div>
        </div>
      </div>

      {/* Bottom Slogan section replacing the signature */}
      <div className="w-full flex flex-col items-center justify-center min-h-[70px]">
        {/* White "Your Archery App" Slogan in "Good Times" font */}
        <motion.h1
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
          className="text-white text-xs sm:text-sm font-black uppercase tracking-[0.25em] text-center"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          Your Archery App
        </motion.h1>

        {/* Dynamic under-slogan line drawing itself */}
        <div className="w-48 h-6 relative overflow-hidden mt-2">
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
              transition={{ duration: 1.5, ease: "easeInOut", delay: 1.2 }}
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
