"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions } from "@/lib/db/indexedDB";
import { motion } from "framer-motion";
import { Trophy, Target, ShieldAlert, ArrowUpRight, Lock, Sparkles } from "lucide-react";

type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE";

interface DashboardViewProps {
  user: UserProfile;
  onNavigate: (screen: Screen) => void;
}

export default function DashboardView({ user, onNavigate }: DashboardViewProps) {
  const { t } = useLanguage();
  const [sessions, setSessions] = useState<any[]>([]);
  const [stats, setStats] = useState({
    lastScore: 275,
    lastMax: 300,
    totalPoints: 8520,
    bestScore: 291,
    bestMax: 300
  });

  useEffect(() => {
    async function loadStats() {
      const localSess = await getLocalSessions();
      setSessions(localSess);
      
      if (localSess.length > 0) {
        // Compute real stats based on local sessions database
        let total = 0;
        let best = 0;
        let bestMax = 300;
        
        localSess.forEach((s) => {
          total += s.score || 0;
          if ((s.score || 0) > best) {
            best = s.score;
            bestMax = s.maxScore || 300;
          }
        });

        const last = localSess[0];
        setStats({
          lastScore: last.score || 0,
          lastMax: last.maxScore || 300,
          totalPoints: total,
          bestScore: best || last.score || 0,
          bestMax: bestMax
        });
      }
    }
    loadStats();
  }, []);

  const lastPercentage = Math.round((stats.lastScore / stats.lastMax) * 100);
  const bestPercentage = Math.round((stats.bestScore / stats.bestMax) * 100);

  // Animation variants for Bento layout cascade
  const containerVariants: any = {
    animate: { transition: { staggerChildren: 0.05 } }
  };

  const cardVariants: any = {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-4 py-4"
    >
      {/* Welcome Banner */}
      <div className="flex flex-col mb-1">
        <h2 className="text-white text-xl font-black flex items-center gap-1.5 uppercase tracking-wide">
          <span>{t("dashHome")}</span>
          {user.plan === "PRO" && (
            <span className="text-yellow-gold text-xs font-black bg-yellow-gold/10 px-2 py-0.5 rounded-full border border-yellow-gold/20 shadow-glow-yellow animate-pulse">
              {t("proBadge")}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-dim mt-0.5">
          Hola, {user.fullName} · {user.bowConfig.type} · {user.clubName || "Independiente"}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-3 gap-3">
        {/* Widget 1: Last Session (Full width) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="col-span-3 bg-neutral-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-4 cursor-pointer hover:border-cyan-neon/30 transition-all duration-300 relative overflow-hidden group flex justify-between items-center"
        >
          <div className="flex flex-col gap-1.5 z-10">
            <span className="text-[10px] text-gray-dim font-bold tracking-widest uppercase flex items-center gap-1">
              <Target size={12} className="text-cyan-neon" />
              {t("lastSession")}
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-white">{stats.lastScore}</span>
              <span className="text-xs text-gray-dim">/ {stats.lastMax}</span>
            </div>
            <span className="text-xs text-yellow-gold font-bold">{lastPercentage}% precisión</span>
          </div>

          {/* SVG Animated Speedometer widget */}
          <div className="relative w-28 h-20 flex items-center justify-center">
            <svg className="w-24 h-24 transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r="38"
                className="stroke-neutral-800"
                strokeWidth="6"
                fill="none"
              />
              <motion.circle
                cx="48"
                cy="48"
                r="38"
                className="stroke-cyan-neon"
                strokeWidth="6"
                fill="none"
                strokeDasharray="239" // 2 * pi * r
                initial={{ strokeDashoffset: 239 }}
                animate={{ strokeDashoffset: 239 - (239 * lastPercentage) / 100 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col pt-1">
              <span className="text-sm font-black text-white">{lastPercentage}%</span>
            </div>
          </div>
          
          <ArrowUpRight size={16} className="absolute top-4 right-4 text-gray-dim group-hover:text-white transition-colors" />
        </motion.div>

        {/* Widget 2: Total Points (1/3 width) - Border gradient yellow */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-yellow-gold/20 flex flex-col justify-between aspect-square relative shadow-[0_0_12px_rgba(255,242,0,0.03)]"
        >
          <span className="text-[9px] text-yellow-gold font-black tracking-wider uppercase leading-snug">
            {t("totalPoints")}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-2xl font-black text-white tracking-tight leading-none">
              {stats.totalPoints}
            </span>
            <span className="text-[9px] text-gray-dim font-bold">puntos</span>
          </div>
        </motion.div>

        {/* Widget 3: Best Session (1/3 width) - Border gradient cian */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-cyan-brand/20 flex flex-col justify-between aspect-square relative"
        >
          <span className="text-[9px] text-cyan-brand font-black tracking-wider uppercase leading-snug">
            {t("bestSession")}
          </span>
          <div className="flex flex-col">
            <span className="text-2xl font-black text-white tracking-tight leading-none">
              {stats.bestScore}
            </span>
            <span className="text-[9px] text-gray-dim font-bold">max: {stats.bestMax}</span>
          </div>
        </motion.div>

        {/* Widget 4: Advanced Analytics (1/3 width) - Locked PRO overlay */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-white/5 flex flex-col justify-between aspect-square relative overflow-hidden group cursor-pointer"
          onClick={() => user.plan === "FREE" && onNavigate("PROFILE")}
        >
          {user.plan === "FREE" ? (
            <>
              {/* Blur locking overlay */}
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1 z-15">
                <Lock size={16} className="text-yellow-gold shadow-glow-yellow animate-pulse" />
                <span className="text-[8px] bg-yellow-gold text-black font-black px-1 py-0.5 rounded-full uppercase scale-90">
                  {t("proBadge")}
                </span>
              </div>
              <span className="text-[9px] text-gray-dim font-bold uppercase leading-none">PRO Anal.</span>
              <span className="text-[9px] text-white/40 leading-tight">Acceso bloqueado</span>
            </>
          ) : (
            <>
              <span className="text-[9px] text-yellow-gold font-bold tracking-wider uppercase leading-snug flex items-center gap-0.5">
                <Sparkles size={10} />
                PRO Anal.
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-black text-cyan-neon">98.5% PB</span>
                <span className="text-[9px] text-gray-dim leading-none">Optimizado</span>
              </div>
            </>
          )}
        </motion.div>

        {/* Widget 5: Weekly Progress Graph (2/3 width) */}
        <motion.div
          variants={cardVariants}
          className="col-span-2 bg-neutral-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-3 flex flex-col justify-between h-36"
        >
          <span className="text-[9px] text-gray-dim font-black tracking-widest uppercase">
            {t("weeklyProgress")}
          </span>
          {/* SVG Line Graph */}
          <div className="w-full h-20 mt-1 relative">
            <svg viewBox="0 0 100 40" className="w-full h-full">
              {/* Area under line */}
              <path
                d="M 5,35 L 20,30 L 40,32 L 60,22 L 80,25 L 95,12 L 95,38 L 5,38 Z"
                fill="rgba(0, 229, 255, 0.06)"
              />
              {/* Line graph */}
              <path
                d="M 5,35 L 20,30 L 40,32 L 60,22 L 80,25 L 95,12"
                fill="none"
                stroke="#00E5FF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Dots */}
              {[
                { x: 5, y: 35 },
                { x: 20, y: 30 },
                { x: 40, y: 32 },
                { x: 60, y: 22 },
                { x: 80, y: 25 },
                { x: 95, y: 12 }
              ].map((p, idx) => (
                <circle
                  key={idx}
                  cx={p.x}
                  cy={p.y}
                  r="1.8"
                  className="fill-cyan-neon stroke-black stroke-[0.8px]"
                />
              ))}
            </svg>
          </div>
        </motion.div>

        {/* Widget 6: Clubs & Programs (1/3 width) */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-3 flex flex-col justify-between h-36 cursor-pointer hover:border-cyan-neon/30 transition-all duration-300 group"
          onClick={() => onNavigate("PROFILE")}
        >
          <span className="text-[9px] text-gray-dim font-black tracking-widest uppercase leading-snug">
            {t("clubsPrograms")}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-white text-xs font-bold truncate group-hover:text-cyan-neon transition-colors">
              {user.clubName || "Mi Club"}
            </span>
            <span className="text-[9px] text-gray-dim truncate">
              {user.role === "coach" ? "Entrenador" : "Miembro"}
            </span>
          </div>
          <div className="w-8 h-8 rounded-full bg-cyan-neon/10 flex items-center justify-center text-cyan-neon border border-cyan-neon/20 shadow-glow-cyan">
            <Trophy size={14} />
          </div>
        </motion.div>
      </div>

      {/* Start session action card */}
      <motion.button
        variants={cardVariants}
        whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
        whileTap={{ scale: 0.98 }}
        onClick={() => onNavigate("TARGET")}
        className="w-full py-4 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-extrabold text-sm tracking-wider uppercase shadow-glow-cyan transition-all cursor-pointer flex justify-center items-center mt-2"
      >
        🎯 {t("newSession")}
      </motion.button>
    </motion.div>
  );
}
