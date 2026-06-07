"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, getLocalSetting, saveLocalSetting, athleteStarsStore } from "@/lib/db/indexedDB";
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
import { RECURVE_STARS, COMPOUND_STARS } from "@/lib/starsManager";

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

  const [athleteStar, setAthleteStar] = useState<any | null>(null);
  const [isStarsDrawerOpen, setIsStarsDrawerOpen] = useState(false);
  const [activeStarTab, setActiveStarTab] = useState<"Recurve" | "Compound">("Recurve");
  const [selectedDetailStar, setSelectedDetailStar] = useState<any | null>(null);

  const [stats, setStats] = useState({
    lastScore: 275,
    lastMax: 300,
    totalArrows: 0,
    bestScore: 0,
    bestMax: 300,
    bestDate: 0
  });

  // Load athlete highest star status
  useEffect(() => {
    async function loadAthleteStar() {
      try {
        const starDoc = await athleteStarsStore.getItem<any>(user.uid);
        setAthleteStar(starDoc);
        
        // Default star tab based on user bow configuration
        if (user.bowConfig?.type === "Compound") {
          setActiveStarTab("Compound");
        } else {
          setActiveStarTab("Recurve");
        }
      } catch (err) {
        console.error("Error loading athlete star doc:", err);
      }
    }
    loadAthleteStar();
  }, [user]);

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
      if ((user.role === "coach" || user.role === "team_admin_coach") && user.clubId) {
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

  if ((user.role === "coach" || user.role === "team_admin_coach") && coachViewMode) {
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
          <span>{t("helloLabel")}{user.fullName} · {user.bowConfig.type} ·</span>
          <span className="flex items-center gap-0.5">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-3.5 h-3.5" />
            <span className="underline decoration-cyan-neon/30">{user.clubName || t("independentLabel")}</span>
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
          {(() => {
            // Check if last session is WA 720 and if star earned
            const lastSessionStarInfo = (() => {
              if (sessions.length === 0) return null;
              const last = sessions[0];
              const totalArrows = ((last.endsCount || 0) * (last.arrowsPerEnd || 0));
              const isWA720 = totalArrows === 72 && (
                (user.bowConfig.type === "Recurve" && last.distance === 70) ||
                (user.bowConfig.type === "Compound" && last.distance === 50)
              );
              
              if (!isWA720) {
                return { status: "not_eligible", text: t("notEligibleStar"), color: "#6b7280" };
              }
              
              if (last.score >= 500) {
                const stars = user.bowConfig.type === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
                const qualified = stars.filter((s: any) => last.score >= s.minScore);
                if (qualified.length > 0) {
                  const sessionStar = qualified[qualified.length - 1];
                  return { 
                    status: "earned", 
                    text: `${t("starUnlocked")}: ${sessionStar.name}`,
                    color: sessionStar.color 
                  };
                }
              }
              
              return { status: "not_reached", text: t("starNotReached"), color: "#ef4444" };
            })();

            return (
              <>
                <div className="flex flex-col gap-1.5 z-10">
                  <span className="text-[10px] text-gray-dim font-bold tracking-widest uppercase flex items-center gap-1">
                    <Target size={12} className="text-cyan-neon" />
                    {t("lastSession")}
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-white">{stats.lastScore}</span>
                    <span className="text-xs text-gray-dim">/ {stats.lastMax}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-yellow-gold font-bold">{lastPercentage}% {t("precisionLabel")}</span>
                    {lastSessionStarInfo && (
                      <span className="text-[9px] font-bold flex items-center gap-0.5 mt-1" style={{ color: lastSessionStarInfo.color }}>
                        <span className="text-[10px]">★</span>
                        <span>{lastSessionStarInfo.text}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 96 96" className="w-24 h-24 transform -rotate-90">
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
                  <div className="absolute inset-0 flex items-center justify-center flex-col">
                    <span className="text-sm font-black text-white">{lastPercentage}%</span>
                  </div>
                </div>
              </>
            );
          })()}
          
          <ArrowUpRight size={16} className="absolute top-4 right-4 text-gray-dim group-hover:text-white transition-colors" />
        </motion.div>

        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY", "VOLUME")}
          className="col-span-1 bg-neutral-900/60 backdrop-blur-md rounded-2xl p-3 border border-yellow-gold/20 flex flex-col justify-between aspect-square relative shadow-[0_0_12px_rgba(255,242,0,0.03)] cursor-pointer hover:border-yellow-gold/50 transition-all duration-300 group"
        >
          <span className="text-[9px] text-yellow-gold font-black tracking-wider uppercase leading-snug">
            {t("totalVolume")}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-2xl font-black text-white tracking-tight leading-none">
              {stats.totalArrows}
            </span>
            <span className="text-[9px] text-gray-dim font-bold">{t("arrowsLabel")}</span>
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
              <span className="text-[9px] text-gray-dim font-bold uppercase leading-none">{t("proStats")}</span>
              <span className="text-[9px] text-white/40 leading-tight">{t("blockedAccess")}</span>
            </>
          ) : (
            <>
              <span className="text-[9px] text-yellow-gold font-bold tracking-wider uppercase leading-snug flex items-center gap-0.5">
                <Sparkles size={10} />
                {t("proStats")}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-black text-cyan-neon">98.5% PB</span>
                <span className="text-[9px] text-gray-dim leading-none">{t("optimized")}</span>
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
              {user.clubName || t("myClub")}
            </span>
            <span className="text-[8px] text-gray-dim truncate flex items-center gap-1 mt-0.5">
              <span>{clubFlag}</span>
              <span>
                {user.role === "coach" 
                  ? "Coach" 
                  : user.role === "team_admin" 
                    ? t("roleAdmin") 
                    : user.role === "team_admin_coach" 
                      ? "Admin / Coach" 
                      : user.role === "superadmin" 
                        ? "Super Admin" 
                        : t("roleMember")}
              </span>
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
              {t("liveArenaTitle")}
            </span>
            <h3 className="text-white text-base font-black uppercase tracking-wide mt-1">
              {t("duelsTitle")}
            </h3>
            <p className="text-[10px] text-gray-dim leading-snug mt-0.5">
              {t("duelsDesc")}
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

      {/* Floating stars tab on the left edge */}
      <div className="fixed left-0 top-[40%] -translate-y-1/2 z-[40]">
        <button
          onClick={() => setIsStarsDrawerOpen(true)}
          className="flex flex-col items-center justify-center gap-2 py-4 px-1 rounded-r-2xl bg-gradient-to-b from-amber-500 via-yellow-gold to-yellow-600 border-y border-r border-yellow-gold/40 shadow-[4px_0_15px_rgba(255,229,0,0.2)] cursor-pointer text-black hover:brightness-110 hover:shadow-[4px_0_20px_rgba(255,229,0,0.35)] transition-all duration-300 w-8 md:w-9 select-none"
        >
          <motion.span
            animate={{ scale: [1, 1.25, 1], rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            className="text-lg text-black font-extrabold"
          >
            ★
          </motion.span>
          <span 
            className="text-[8.5px] font-black tracking-[0.2em] uppercase" 
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
          >
            Estrellas 101010
          </span>
        </button>
      </div>

      {/* Drawer Backdrop and Drawer Container */}
      <AnimatePresence>
        {isStarsDrawerOpen && (
          <>
            <div 
              onClick={() => setIsStarsDrawerOpen(false)}
              className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed top-0 left-0 h-full w-[340px] sm:w-[380px] max-w-[90vw] bg-neutral-950/95 border-r border-yellow-gold/25 shadow-[8px_0_30px_rgba(0,0,0,0.8)] z-[50] flex flex-col pt-[calc(4.5rem+env(safe-area-inset-top))] pb-6 text-left"
            >
              {/* Header */}
              <div className="px-5 pb-4 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="text-white text-sm font-black uppercase tracking-wide flex items-center gap-1.5">
                    <span className="text-yellow-gold">★</span>
                    <span>Estrellas 101010</span>
                  </h3>
                  <p className="text-[9px] text-gray-dim uppercase tracking-wider mt-0.5">
                    Reglamento Oficial WA 720
                  </p>
                </div>
                <button
                  onClick={() => setIsStarsDrawerOpen(false)}
                  className="p-1.5 rounded-lg bg-neutral-900 border border-white/5 hover:border-white/10 text-gray-dim hover:text-white transition cursor-pointer text-xs font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
                <p className="text-[10px] text-gray-dim leading-relaxed">
                  Completa una sesión oficial WA 720 (72 flechas) a distancia reglamentaria (Recurvo 70m o Compuesto 50m) con un puntaje mínimo de 500 para ganar estrellas.
                </p>

                {/* Bow type tabs */}
                <div className="flex bg-neutral-905 p-0.5 rounded-lg border border-white/5 w-full bg-neutral-900">
                  <button
                    onClick={() => setActiveStarTab("Recurve")}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition ${
                      activeStarTab === "Recurve"
                        ? "bg-yellow-gold/10 text-yellow-gold border border-yellow-gold/20"
                        : "text-gray-dim hover:text-white"
                    }`}
                  >
                    Recurvo (70m)
                  </button>
                  <button
                    onClick={() => setActiveStarTab("Compound")}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition ${
                      activeStarTab === "Compound"
                        ? "bg-yellow-gold/10 text-yellow-gold border border-yellow-gold/20"
                        : "text-gray-dim hover:text-white"
                    }`}
                  >
                    Compuesto (50m)
                  </button>
                </div>

                {/* Stars List */}
                <div className="flex flex-col gap-2.5">
                  {(() => {
                    const list = activeStarTab === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
                    const unlockedLevel = athleteStar && athleteStar.bowType === activeStarTab
                      ? athleteStar.highestStarLevel
                      : 0;

                    return list.map((star) => {
                      const isUnlocked = unlockedLevel >= star.level;
                      return (
                        <div
                          key={star.level}
                          onClick={() => setSelectedDetailStar({ star, bowType: activeStarTab, isUnlocked })}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                            isUnlocked
                              ? "bg-neutral-900/50 border-white/10 hover:border-yellow-gold/30 hover:bg-neutral-900"
                              : "bg-neutral-950/20 border-white/5 opacity-55 hover:opacity-80"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Glowing Star Icon */}
                            <div 
                              className={`w-10 h-10 rounded-xl flex items-center justify-center border text-lg transition-transform group-hover:scale-105 ${
                                isUnlocked 
                                  ? "bg-neutral-900 border-white/5 shadow-md" 
                                  : "bg-neutral-950 border-white/5"
                              }`}
                              style={{ color: star.color, textShadow: isUnlocked ? `0 0 10px ${star.color}` : "none" }}
                            >
                              ★
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-black text-white group-hover:text-yellow-gold transition-colors">
                                {star.name}
                              </span>
                              <span className="text-[9px] text-gray-dim font-bold mt-0.5">
                                Mínimo: {star.minScore} pts
                              </span>
                            </div>
                          </div>

                          {/* Right Indicator */}
                          <div>
                            {isUnlocked ? (
                              <span 
                                className="text-[8px] font-black px-2 py-0.5 rounded-full border"
                                style={{ 
                                  borderColor: `${star.color}30`, 
                                  backgroundColor: `${star.color}10`, 
                                  color: star.color 
                                }}
                              >
                                LOGRADO
                              </span>
                            ) : (
                              <div className="text-[10px] text-gray-dim bg-neutral-900/40 px-2 py-1 rounded-lg border border-white/5 font-black uppercase">
                                🔒
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Detail Star Modal Overlay */}
      <AnimatePresence>
        {selectedDetailStar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-950 border border-yellow-gold/30 rounded-3xl p-6 w-full max-w-sm text-center relative shadow-[0_0_50px_rgba(255,229,0,0.15)] overflow-hidden"
            >
              <div 
                className="absolute inset-0 opacity-15 pointer-events-none"
                style={{ background: `radial-gradient(circle, ${selectedDetailStar.star.color} 0%, transparent 70%)` }}
              />

              <div className="relative z-10 flex flex-col items-center">
                {/* Large Glowing Star Icon */}
                <motion.div
                  animate={selectedDetailStar.isUnlocked ? { 
                    scale: [1, 1.15, 1],
                    rotate: [0, 10, -10, 0]
                  } : {}}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="w-24 h-24 flex items-center justify-center rounded-2xl bg-neutral-900 border border-white/5 shadow-2xl text-5xl mb-4 relative"
                  style={{ 
                    color: selectedDetailStar.star.color, 
                    textShadow: `0 0 20px ${selectedDetailStar.star.color}`
                  }}
                >
                  ★
                  {!selectedDetailStar.isUnlocked && (
                    <div className="absolute -bottom-1 -right-1 bg-black border border-white/10 px-1.5 py-0.5 rounded-lg text-xs leading-none">
                      🔒
                    </div>
                  )}
                </motion.div>

                <span className="text-[10px] text-yellow-gold font-black tracking-widest uppercase block mb-1">
                  REGLAMENTO OFICIAL WA
                </span>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  {selectedDetailStar.star.name}
                </h3>
                
                <div className="my-4 bg-neutral-900/60 border border-white/5 rounded-2xl px-4 py-3.5 w-full text-left flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[10px] text-gray-dim uppercase font-bold">Modalidad</span>
                    <span className="text-xs font-black text-white">
                      {selectedDetailStar.bowType === "Recurve" ? "Arco Recurvo" : "Arco Compuesto"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[10px] text-gray-dim uppercase font-bold">Distancia Oficial</span>
                    <span className="text-xs font-black text-white">
                      {selectedDetailStar.bowType === "Recurve" ? "70 metros" : "50 metros"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[10px] text-gray-dim uppercase font-bold">Marca Mínima</span>
                    <span className="text-xs font-black text-white">{selectedDetailStar.star.minScore} / 720 pts</span>
                  </div>
                  <div className="flex flex-col pt-1">
                    <div className="flex justify-between items-center text-[10px] text-gray-dim font-bold mb-1">
                      <span>Progreso de Puntuación</span>
                      <span className="text-white font-extrabold">
                        {athleteStar && athleteStar.bowType === selectedDetailStar.bowType
                          ? `${athleteStar.highestScore} pts`
                          : "Sin Récord"
                        }
                      </span>
                    </div>
                    {/* Progress bar towards this star */}
                    {(() => {
                      const userBest = athleteStar && athleteStar.bowType === selectedDetailStar.bowType
                        ? athleteStar.highestScore
                        : 0;
                      const percentage = Math.min(100, Math.round((userBest / selectedDetailStar.star.minScore) * 100));
                      const pointsNeeded = selectedDetailStar.star.minScore - userBest;

                      return (
                        <div className="flex flex-col gap-1">
                          <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-white/5">
                            <div 
                              className="h-full rounded-full transition-all duration-500"
                              style={{ 
                                width: `${percentage}%`,
                                backgroundColor: selectedDetailStar.star.color,
                                boxShadow: `0 0 6px ${selectedDetailStar.star.color}`
                              }}
                            />
                          </div>
                          <span className="text-[9px] font-bold text-gray-dim mt-0.5">
                            {selectedDetailStar.isUnlocked 
                              ? "✓ ¡Estrella obtenida y superada!" 
                              : pointsNeeded > 0 
                                ? `Te faltan ${pointsNeeded} puntos para lograr esta estrella.`
                                : "✓ ¡Estrella lograda!"
                            }
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <p className="text-[10px] text-gray-dim leading-relaxed px-2">
                  {selectedDetailStar.star.description || `Logrado con ${selectedDetailStar.star.minScore}+ puntos en la ronda WA 720.`}
                </p>

                <div className="mt-6 flex flex-col gap-2 w-full">
                  <button
                    onClick={() => {
                      setSelectedDetailStar(null);
                      setIsStarsDrawerOpen(false);
                      onNavigate("TARGET");
                    }}
                    className="w-full py-3 bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-glow-yellow hover:brightness-110 active:scale-95 transition"
                  >
                    🎯 Entrenar para Lograrlo
                  </button>
                  <button
                    onClick={() => setSelectedDetailStar(null)}
                    className="w-full py-3 bg-neutral-900 border border-white/10 text-gray-dim hover:text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition"
                  >
                    Volver al Listado
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
