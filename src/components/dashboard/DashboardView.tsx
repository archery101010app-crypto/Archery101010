"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Trophy, 
  Target, 
  ShieldAlert, 
  ArrowUpRight, 
  Lock, 
  Sparkles,
  Users,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Activity,
  CheckSquare,
  Square,
  Plus
} from "lucide-react";
import ClubLogoIcon from "../ui/ClubLogoIcon";

import CoachPortalView from "../coach/CoachPortalView";

type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA";

interface DashboardViewProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onNavigate: (screen: Screen, tab?: "SESSIONS" | "VOLUME") => void;
  onUserUpdate?: (updated: UserProfile) => void;
}

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

export default function DashboardView({ user, coachViewMode = false, onNavigate, onUserUpdate }: DashboardViewProps) {
  const { language, t } = useLanguage();
  const [sessions, setSessions] = useState<any[]>([]);
  const [athletes, setAthletes] = useState<UserProfile[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});

  const [stats, setStats] = useState({
    lastScore: 275,
    lastMax: 300,
    totalArrows: 0,
    bestScore: 0,
    bestMax: 300,
    bestDate: 0
  });

  useEffect(() => {
    async function loadStats() {
      const localSess = await getLocalSessions();
      setSessions(localSess);
      
      if (localSess.length > 0) {
        let totalArrows = 0;
        let best = 0;
        let bestMax = 300;
        let bestDate = 0;
        
        localSess.forEach((s) => {
          totalArrows += ((s.endsCount || 0) * (s.arrowsPerEnd || 0)) + (s.warmupArrows || 0);
          if ((s.score || 0) >= best) {
            best = s.score;
            bestMax = s.maxScore || 300;
            bestDate = s.timestamp;
          }
        });

        const last = localSess[0];
        setStats({
          lastScore: last.score || 0,
          lastMax: last.maxScore || 300,
          totalArrows: totalArrows,
          bestScore: best || last.score || 0,
          bestMax: bestMax,
          bestDate: bestDate || last.timestamp || 0
        });
      }
    }
    loadStats();
  }, []);

  useEffect(() => {
    async function loadAthletes() {
      if (user.role === "coach" && user.clubId) {
        const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
        let clubArchers = list.filter(u => u.clubId === user.clubId && u.role === "archer");
        
        if (clubArchers.length === 0) {
          const demoArchers: UserProfile[] = [
            {
              uid: "USR-D-ATHLETE-1",
              email: "daniela@archery101010.com",
              fullName: "Daniela Solano",
              birthDate: "2002-08-12",
              country: user.country,
              gender: "F",
              bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 42, defaultDistance: 70 },
              physicalData: { height: 168, weight: 58, dominantEye: "R", dominantHand: "R" },
              clubId: user.clubId,
              clubName: user.clubName,
              clubLogo: user.clubLogo,
              clubCountry: user.clubCountry,
              role: "archer",
              plan: "FREE",
              isClubCreator: false
            },
            {
              uid: "USR-D-ATHLETE-2",
              email: "carlos@archery101010.com",
              fullName: "Carlos Ruiz",
              birthDate: "1998-04-25",
              country: user.country,
              gender: "M",
              bowConfig: { type: "Compound", brand: "Mathews", model: "TRX", poundage: 58, defaultDistance: 50 },
              physicalData: { height: 178, weight: 76, dominantEye: "R", dominantHand: "R" },
              clubId: user.clubId,
              clubName: user.clubName,
              clubLogo: user.clubLogo,
              clubCountry: user.clubCountry,
              role: "archer",
              plan: "FREE",
              isClubCreator: false
            },
            {
              uid: "USR-D-ATHLETE-3",
              email: "sebastian@archery101010.com",
              fullName: "Sebastián Castro",
              birthDate: "2005-11-03",
              country: user.country,
              gender: "M",
              bowConfig: { type: "Barebow", brand: "Gillo", model: "G1", poundage: 36, defaultDistance: 18 },
              physicalData: { height: 172, weight: 64, dominantEye: "L", dominantHand: "R" },
              clubId: user.clubId,
              clubName: user.clubName,
              clubLogo: user.clubLogo,
              clubCountry: user.clubCountry,
              role: "archer",
              plan: "FREE",
              isClubCreator: false
            }
          ];

          const updatedList = [...list, ...demoArchers];
          await saveLocalSetting("simulated_users", updatedList);
          clubArchers = demoArchers;
        }
        
        setAthletes(clubArchers);

        const dateKey = new Date().toISOString().split("T")[0];
        const savedAttendance = await getLocalSetting<Record<string, boolean>>(`attendance_${user.clubId}_${dateKey}`, {});
        setAttendance(savedAttendance);
      }
    }
    loadAthletes();
  }, [user, coachViewMode]);

  const toggleAttendance = async (athleteUid: string) => {
    const nextAttendance = {
      ...attendance,
      [athleteUid]: !attendance[athleteUid]
    };
    setAttendance(nextAttendance);

    const dateKey = new Date().toISOString().split("T")[0];
    await saveLocalSetting(`attendance_${user.clubId}_${dateKey}`, nextAttendance);
  };

  const lastPercentage = stats.lastMax > 0 ? Math.round((stats.lastScore / stats.lastMax) * 100) : 0;
  const containerVariants: any = {
    animate: { transition: { staggerChildren: 0.05 } }
  };

  const cardVariants: any = {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }
  };

  const clubFlag = COUNTRIES.find(c => c.code === user.clubCountry)?.flag || COUNTRIES.find(c => c.code === user.country)?.flag || "🇨🇷";
  const clubCountryName = COUNTRIES.find(c => c.code === user.clubCountry)?.name || COUNTRIES.find(c => c.code === user.country)?.name || "Costa Rica";

  if (user.role === "coach" && coachViewMode) {
    return (
      <CoachPortalView
        user={user}
        onNavigate={onNavigate}
        onUserUpdate={onUserUpdate}
      />
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-4 py-4"
    >
      <div className="flex flex-col mb-1">
        <h2 className="text-white text-xl font-black flex items-center gap-1.5 uppercase tracking-wide">
          <span>{t("dashHome")}</span>
          {user.plan === "PRO" && (
            <span className="text-yellow-gold text-xs font-black bg-yellow-gold/10 px-2 py-0.5 rounded-full border border-yellow-gold/20 shadow-glow-yellow animate-pulse">
              {t("proBadge")}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-dim mt-0.5 flex items-center gap-1">
          <span>Hola, {user.fullName} · {user.bowConfig.type} ·</span>
          <span className="flex items-center gap-0.5">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-3.5 h-3.5" />
            <span className="underline decoration-cyan-neon/30">{user.clubName || "Independiente"}</span>
            <span>{clubFlag}</span>
          </span>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
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
                strokeDasharray="239"
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

        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY", "VOLUME")}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-yellow-gold/20 flex flex-col justify-between aspect-square relative shadow-[0_0_12px_rgba(255,242,0,0.03)] cursor-pointer hover:border-yellow-gold/50 transition-all duration-300 group"
        >
          <span className="text-[9px] text-yellow-gold font-black tracking-wider uppercase leading-snug">
            Volumen Total
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-2xl font-black text-white tracking-tight leading-none">
              {stats.totalArrows}
            </span>
            <span className="text-[9px] text-gray-dim font-bold">flechas</span>
          </div>
          <ArrowUpRight size={12} className="absolute top-3 right-3 text-gray-dim group-hover:text-white transition-colors" />
        </motion.div>

        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-cyan-brand/20 flex flex-col justify-between aspect-square relative cursor-pointer hover:border-cyan-brand/50 transition-all duration-300 group"
        >
          <span className="text-[9px] text-cyan-brand font-black tracking-wider uppercase leading-snug">
            {t("bestSession")}
          </span>
          <div className="flex flex-col">
            <span className="text-2xl font-black text-white tracking-tight leading-none">
              {stats.bestScore}
            </span>
            <span className="text-[9px] text-gray-dim font-bold leading-tight">max: {stats.bestMax}</span>
            {stats.bestDate > 0 && (
              <span className="text-[8px] text-yellow-gold font-bold mt-0.5">
                {new Date(stats.bestDate).toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
                  month: "short",
                  day: "numeric"
                })}
              </span>
            )}
          </div>
          <ArrowUpRight size={12} className="absolute top-3 right-3 text-gray-dim group-hover:text-white transition-colors" />
        </motion.div>

        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-white/5 flex flex-col justify-between aspect-square relative overflow-hidden group cursor-pointer"
          onClick={() => user.plan === "FREE" && onNavigate("PROFILE")}
        >
          {user.plan === "FREE" ? (
            <>
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

        <motion.div
          variants={cardVariants}
          className="col-span-2 bg-neutral-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-3 flex flex-col justify-between h-36"
        >
          <span className="text-[9px] text-gray-dim font-black tracking-widest uppercase">
            {t("weeklyProgress")}
          </span>
          <div className="w-full h-20 mt-1 relative">
            <svg viewBox="0 0 100 40" className="w-full h-full">
              <path
                d="M 5,35 L 20,30 L 40,32 L 60,22 L 80,25 L 95,12 L 95,38 L 5,38 Z"
                fill="rgba(0, 229, 255, 0.06)"
              />
              <path
                d="M 5,35 L 20,30 L 40,32 L 60,22 L 80,25 L 95,12"
                fill="none"
                stroke="#00E5FF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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

        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-3 flex flex-col justify-between h-36 cursor-pointer hover:border-cyan-neon/30 transition-all duration-300 group"
          onClick={() => onNavigate("PROFILE")}
        >
          <span className="text-[9px] text-gray-dim font-black tracking-widest uppercase leading-snug">
            {t("clubsPrograms")}
          </span>
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <span className="text-white text-xs font-bold truncate group-hover:text-cyan-neon transition-colors">
              {user.clubName || "Mi Club"}
            </span>
            <span className="text-[8px] text-gray-dim truncate flex items-center gap-1 mt-0.5">
              <span>{clubFlag}</span>
              <span>{user.role === "coach" ? "Entrenador" : "Miembro"}</span>
            </span>
          </div>
          <div className="w-9 h-9 rounded-xl bg-neutral-950 flex items-center justify-center border border-white/5 group-hover:border-cyan-neon/20 transition-all">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-6 h-6 p-0.5" />
          </div>
        </motion.div>

        {/* NEW Bento Card: Duelos de Eliminación */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("MATCHPLAY_LOBBY")}
          className="col-span-3 bg-gradient-to-r from-violet-950/40 via-purple-950/30 to-red-950/20 backdrop-blur-md rounded-3xl border border-purple-500/25 p-4 cursor-pointer hover:border-purple-400/40 transition-all duration-300 relative overflow-hidden group flex justify-between items-center h-28 shadow-[0_0_15px_rgba(168,85,247,0.05)]"
        >
          {/* Subtle light effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-transparent opacity-50 group-hover:opacity-80 transition-opacity" />
          
          <div className="flex flex-col gap-1 z-10 w-[70%]">
            <span className="text-[9px] text-purple-300 font-black tracking-widest uppercase flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-505 bg-red-500"></span>
              </span>
              En Vivo · Arena Competitiva
            </span>
            <h3 className="text-white text-base font-black uppercase tracking-wide mt-1">
              ⚔️ Duelos de Eliminación
            </h3>
            <p className="text-[10px] text-gray-dim leading-snug mt-0.5">
              Reta a otros arqueros a duelos en vivo (Set System o Acumulado) y pon a prueba tu precisión bajo presión.
            </p>
          </div>

          <div className="w-12 h-12 rounded-2xl bg-neutral-950/80 border border-purple-500/30 flex items-center justify-center text-purple-400 group-hover:text-purple-300 group-hover:border-purple-400/60 group-hover:scale-105 shadow-[0_0_15px_rgba(168,85,247,0.1)] transition-all">
            <Trophy size={20} className="animate-bounce [animation-duration:3s]" />
          </div>
          
          <ArrowUpRight size={16} className="absolute top-4 right-4 text-gray-dim group-hover:text-white transition-colors" />
        </motion.div>
      </div>

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
