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
      className={`absolute inset-0 z-[60] bg-black flex flex-col items-center justify-between py-16 px-0 overflow-hidden transition-opacity duration-700 ${
        isExiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Skip Button */}
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 z-[70] px-3.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-95 text-[9px] font-black uppercase tracking-widest text-white hover:text-white transition-all cursor-pointer"
      >
        Saltar
      </button>

      {/* Top spacing placeholder */}
      <div className="h-2" />

      {/* Central HUD with concentric circles and giant full-width logo */}
      <div className="relative flex items-center justify-center w-full flex-1 my-2 px-0">
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

        {/* Centered Logo 101010 */}
        <div className="relative z-10 flex items-center justify-center w-[76.5%] mx-auto px-0">
          <motion.img
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ 
              duration: 1.5, 
              ease: [0.25, 1, 0.5, 1],
              delay: 0.15 
            }}
            src="/images/logo_final.png?v=7"
            alt="Archery 101010 Logo"
            className="w-full h-auto max-h-[290px] object-contain"
          />
        </div>
      </div>

      {/* Bottom Slogan - subido 10% y 20% más grande texto y línea */}
      <div className="w-full flex flex-col items-center justify-center min-h-[90px] px-6 -translate-y-8 sm:-translate-y-12">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.8, ease: "easeOut" }}
          className="text-white text-[15px] sm:text-[18px] font-black uppercase tracking-[0.28em] text-center"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          Your Archery App
        </motion.h1>

        {/* Dynamic tricolor underline stroke - 20% más grande */}
        <div className="w-[235px] sm:w-[265px] h-7 relative overflow-hidden mt-1.5">
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 200 20"
            className="absolute inset-0 pointer-events-none opacity-85"
          >
            <motion.path
              d="M 12,5 Q 100,15 188,5"
              fill="none"
              stroke="url(#slogan-gradient)"
              strokeWidth="2.5"
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
