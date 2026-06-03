"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface IntroScreenProps {
  onComplete: () => void;
}

const scenes = [
  {
    id: "field",
    image: "/images/archery_field.png",
    tagline: "EL CAMPO",
    desc: "Donde el viento y la mente se encuentran",
    colorClass: "text-cyan-neon",
    accentColor: "#00BFFF",
  },
  {
    id: "recurve",
    image: "/images/recurve_bow.png",
    tagline: "RECURVO",
    desc: "Precisión olímpica y tensión pura",
    colorClass: "text-cyan-neon",
    accentColor: "#00BFFF",
  },
  {
    id: "compound",
    image: "/images/compound_bow.png",
    tagline: "COMPUESTO",
    desc: "Potencia, tecnología y estabilidad letal",
    colorClass: "text-red-rival",
    accentColor: "#FF0000",
  },
  {
    id: "barebow",
    image: "/images/barebow.png",
    tagline: "BAREBOW",
    desc: "Instinto puro, sin ayudas, solo tú",
    colorClass: "text-yellow-gold",
    accentColor: "#FFE500",
  },
];

export default function IntroScreen({ onComplete }: IntroScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Stage timings:
    // Step 0 (Field): 1.6s
    // Step 1 (Recurve): 0.9s
    // Step 2 (Compound): 0.9s
    // Step 3 (Barebow): 0.9s
    // Step 4 (Branding & Signature): 2.4s
    // Total = 6.7 seconds
    
    const timers = [
      setTimeout(() => setCurrentStep(1), 1600), // to recurve
      setTimeout(() => setCurrentStep(2), 2500), // to compound
      setTimeout(() => setCurrentStep(3), 3400), // to barebow
      setTimeout(() => setCurrentStep(4), 4300), // to branding
      setTimeout(() => {
        setIsExiting(true);
        setTimeout(onComplete, 800); // trigger final exit callback after fadeout
      }, 6700),
    ];

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [onComplete]);

  const handleSkip = () => {
    setIsExiting(true);
    setTimeout(onComplete, 500);
  };

  const currentScene = currentStep < 4 ? scenes[currentStep] : null;

  return (
    <div
      className={`absolute inset-0 z-[60] bg-black flex flex-col items-center justify-center overflow-hidden transition-opacity duration-700 ${
        isExiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Subtle background tech grid */}
      <div 
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
        }}
      />

      {/* Skip Button */}
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 z-[70] px-3.5 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-95 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white transition-all cursor-pointer"
      >
        Saltar
      </button>

      {/* Scenes 0 to 3: Field and Bows */}
      <AnimatePresence mode="wait">
        {currentStep < 4 && currentScene && (
          <motion.div
            key={currentScene.id}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="absolute inset-0 flex flex-col items-center justify-center"
          >
            {/* Background Image with Zoom Parallax */}
            <motion.div
              initial={{ scale: 1.15, filter: "brightness(0.3) blur(2px)" }}
              animate={{ scale: 1, filter: "brightness(0.55) blur(0px)" }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${currentScene.image})` }}
            />

            {/* Glowing Accent Ring Overlaid */}
            <div 
              className="absolute inset-0 pointer-events-none opacity-20"
              style={{
                background: `radial-gradient(circle at center, transparent 30%, ${currentScene.accentColor} 100%)`
              }}
            />

            {/* Content Text HUD Overlay */}
            <div className="relative z-10 text-center px-6 flex flex-col items-center">
              {/* Step indicator bar */}
              <div className="flex gap-1.5 mb-6 justify-center w-32">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className={`h-0.5 rounded-full transition-all duration-300 ${
                      idx === currentStep 
                        ? "w-8" 
                        : idx < currentStep 
                        ? "w-2 bg-white/50" 
                        : "w-2 bg-white/10"
                    }`}
                    style={{
                      backgroundColor: idx === currentStep ? currentScene.accentColor : undefined
                    }}
                  />
                ))}
              </div>

              {/* Tagline */}
              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
                className={`text-2xl font-black tracking-[0.2em] uppercase ${currentScene.colorClass}`}
              >
                {currentScene.tagline}
              </motion.h2>

              {/* Small HUD Divider line */}
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "60px" }}
                exit={{ width: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className="h-[1px] my-3"
                style={{ backgroundColor: currentScene.accentColor }}
              />

              {/* Description */}
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ delay: 0.4, duration: 0.4 }}
                className="text-xs text-white/80 font-medium tracking-wide max-w-[280px] leading-relaxed"
              >
                {currentScene.desc}
              </motion.p>
            </div>
          </motion.div>
        )}

        {/* Step 4: Final Branding, Logo collage and Signature */}
        {currentStep === 4 && (
          <motion.div
            key="branding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 flex flex-col items-center justify-between py-16 px-6 bg-black-oled"
          >
            {/* Top Branding label */}
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="text-center"
            >
              <span className="text-[10px] text-cyan-neon font-black tracking-[0.3em] uppercase block mb-1">
                SISTEMA DE ENTRENAMIENTO
              </span>
              <div className="h-0.5 w-12 bg-cyan-neon/30 mx-auto rounded-full" />
            </motion.div>

            {/* Central HUD with logos */}
            <div className="relative flex flex-col items-center justify-center w-full flex-1 my-4">
              {/* Outer HUD Rings */}
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

              {/* Glowing Target Ring Backdrop */}
              <div className="absolute w-28 h-28 rounded-full bg-cyan-neon/5 blur-xl pointer-events-none" />

              {/* Main Logo & Text Overlay */}
              <div className="relative z-10 flex flex-col items-center gap-4">
                {/* Custom Logo Container animating images */}
                <div className="relative w-24 h-24 flex items-center justify-center">
                  {/* Floating decorative elements representing targets */}
                  <motion.img
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 100, delay: 0.3 }}
                    src="/images/logo1.png"
                    alt="Archery 101010 Logo Icon"
                    className="w-16 h-16 object-contain z-20 drop-shadow-[0_0_12px_rgba(0,191,255,0.4)]"
                  />

                  {/* Behind Secondary Badges for extra detail */}
                  <motion.img
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 0.85, opacity: 0.35, x: -28, y: -20 }}
                    transition={{ delay: 0.6, duration: 0.6 }}
                    src="/images/logo2.png"
                    className="absolute w-10 h-10 object-contain z-10 filter hue-rotate-30"
                  />

                  <motion.img
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 0.85, opacity: 0.35, x: 28, y: 20 }}
                    transition={{ delay: 0.7, duration: 0.6 }}
                    src="/images/logo4.png"
                    className="absolute w-10 h-10 object-contain z-10 filter hue-rotate-180"
                  />
                </div>

                {/* 10 10 10 Logotype */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5, type: "spring" }}
                  className="flex flex-baseline gap-1"
                >
                  <div 
                    className="flex text-3xl tracking-tighter font-extrabold" 
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

                {/* Subtitle */}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5 }}
                  transition={{ delay: 0.8 }}
                  className="text-[9px] text-white font-black tracking-[0.4em] uppercase"
                >
                  ARCHERY COMPANION
                </motion.p>
              </div>
            </div>

            {/* Bottom Cursive Signature for Rodrigo Saborío */}
            <div className="w-full flex flex-col items-center justify-center min-h-[80px]">
              {/* Dynamic cursive text signature */}
              <motion.div
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.08,
                      delayChildren: 0.9,
                    }
                  }
                }}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-center select-none"
              >
                {/* Split the name into letters for organic handwriting effect */}
                {"Rodrigo Saborío".split("").map((letter, index) => (
                  <motion.span
                    key={index}
                    variants={{
                      hidden: { opacity: 0, y: 5, scale: 0.8 },
                      visible: { 
                        opacity: 1, 
                        y: 0, 
                        scale: 1,
                        transition: { type: "spring", stiffness: 120, damping: 12 }
                      }
                    }}
                    className="text-3xl sm:text-4xl text-white font-normal"
                    style={{ 
                      fontFamily: "'Herr Von Muellerhoff', cursive",
                      marginRight: letter === " " ? "10px" : "-1px"
                    }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </motion.div>

              {/* Underline stroke drawing itself */}
              <div className="w-48 h-6 relative overflow-hidden mt-0.5">
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 200 20"
                  className="absolute inset-0 pointer-events-none opacity-80"
                >
                  <motion.path
                    d="M 12,5 Q 85,15 188,4 Q 100,10 30,12"
                    fill="none"
                    stroke="url(#sig-gradient)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.4, ease: "easeInOut", delay: 1.8 }}
                  />
                  <defs>
                    <linearGradient id="sig-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00BFFF" /> {/* Cyan */}
                      <stop offset="50%" stopColor="#FF0000" /> {/* Red */}
                      <stop offset="100%" stopColor="#FFE500" /> {/* Yellow */}
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Sub-label under signature */}
              <motion.span
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 0.35, y: 0 }}
                transition={{ delay: 2.2, duration: 0.5 }}
                className="text-[8px] text-white tracking-[0.25em] uppercase font-bold"
              >
                PRODUCER & CREATOR
              </motion.span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
