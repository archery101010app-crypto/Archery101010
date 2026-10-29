"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { 
  getLocalSessions, 
  getLocalSetting, 
  saveLocalSetting, 
  athleteStarsStore,
  getLocalEvents,
  CalendarEvent 
} from "@/lib/db/indexedDB";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Trophy, 
  Target, 
  ShieldAlert, 
  ArrowUpRight, 
  Lock, 
  Users,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Activity,
  CheckSquare,
  Square,
  Plus,
  Gauge,
  Zap,
  Swords,
  Flame,
  ChevronRight,
  Star,
  X
} from "lucide-react";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { RECURVE_STARS, COMPOUND_STARS } from "@/lib/starsManager";

import CoachPortalView from "../coach/CoachPortalView";

type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA" | "CHRONOGRAPH";

interface DashboardViewProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onNavigate: (screen: Screen, tab?: "SESSIONS" | "VOLUME") => void;
  onUserUpdate?: (updated: UserProfile) => void;
}

import { COUNTRIES } from "@/lib/countries";

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
    lastScore: 0,
    lastMax: 0,
    totalArrows: 0,
    bestScore: 0,
    bestMax: 0,
    bestDate: 0
  });

  const [todayMission, setTodayMission] = useState<CalendarEvent | null>(null);
  const [upcomingCount, setUpcomingCount] = useState<number>(0);

  const needsSetup = user.profileSetupCompleted === false || 
                     (!user.profileSetupCompleted && user.birthDate === "1995-05-15");

  const [volumePeriod, setVolumePeriod] = useState<"TOTAL" | "YEAR" | "MONTH" | "WEEK">("TOTAL");

  const getVolumeCount = (period: "TOTAL" | "YEAR" | "MONTH" | "WEEK") => {
    let total = 0;
    const now = Date.now();
    let limit = 0;
    if (period === "YEAR") limit = now - 365 * 24 * 60 * 60 * 1000;
    else if (period === "MONTH") limit = now - 30 * 24 * 60 * 60 * 1000;
    else if (period === "WEEK") limit = now - 7 * 24 * 60 * 60 * 1000;

    sessions.forEach((s) => {
      if (period === "TOTAL" || s.timestamp >= limit) {
        total += ((s.endsCount || 0) * (s.arrowsPerEnd || 0)) + (s.warmupArrows || 0);
      }
    });
    return total;
  };

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

  // Load today's mission and upcoming calendar events
  useEffect(() => {
    async function loadCalendarInfo() {
      try {
        const events = await getLocalEvents();
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        
        const todayEv = events.find(e => e.date === todayStr);
        setTodayMission(todayEv || null);

        const futureEvs = events.filter(e => e.date >= todayStr);
        setUpcomingCount(futureEvs.length);
      } catch (e) {
        console.error("Error loading calendar info:", e);
      }
    }
    loadCalendarInfo();

    const handleCalendarChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.store === "calendar_events") {
        loadCalendarInfo();
      }
    };

    window.addEventListener("local-db-change", handleCalendarChange);
    return () => {
      window.removeEventListener("local-db-change", handleCalendarChange);
    };
  }, []);

  useEffect(() => {
    async function loadStats() {
      const localSess = await getLocalSessions();
      const activeSess = localSess.filter(s => s.deletedByArcher !== true);
      setSessions(activeSess);
      
      if (activeSess.length > 0) {
        let totalArrows = 0;
        let best = 0;
        let bestMax = 300;
        let bestDate = 0;
        
        activeSess.forEach((s) => {
          totalArrows += ((s.endsCount || 0) * (s.arrowsPerEnd || 0)) + (s.warmupArrows || 0);
          if ((s.score || 0) >= best) {
            best = s.score;
            bestMax = s.maxScore || 300;
            bestDate = s.timestamp;
          }
        });

        const sortedSess = [...activeSess].sort((a, b) => b.timestamp - a.timestamp);
        const last = sortedSess[0];
        setStats({
          lastScore: last.score || 0,
          lastMax: last.maxScore || 300,
          totalArrows: totalArrows,
          bestScore: best || last.score || 0,
          bestMax: bestMax,
          bestDate: bestDate || last.timestamp || 0
        });
      } else {
        setStats({
          lastScore: 0,
          lastMax: 0,
          totalArrows: 0,
          bestScore: 0,
          bestMax: 0,
          bestDate: 0
        });
      }
    }
    loadStats();

    const handleDbChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.store === "sessions_local") {
        loadStats();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, []);

  useEffect(() => {
    async function loadAthletes() {
      if ((user.role === "coach" || user.role === "team_admin_coach") && user.clubId) {
        const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const clubArchers = list.filter(u => u.clubId === user.clubId && u.role === "archer");
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

  const clubCountryObj = COUNTRIES.find(c => c.code === user.clubCountry) || COUNTRIES.find(c => c.code === user.country) || COUNTRIES[0];

  if (coachViewMode) {
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
      className="flex flex-col gap-4 sm:gap-5 py-3 w-full max-w-full overflow-x-hidden"
    >
      {/* Titular Oficial: ARCHERY 101010 / THE APP (+12% Size) */}
      <div 
        className="w-full flex flex-col justify-center items-center pt-2 pb-3 sm:pb-5 select-none gap-1.5"
        style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
      >
        <h1 className="flex items-baseline justify-center gap-x-1.5 sm:gap-x-3.5 text-[25.8px] sm:text-[40.3px] md:text-[51.5px] leading-tight text-center whitespace-nowrap">
          <span className="text-white tracking-normal sm:tracking-wider font-extrabold">ARCHERY</span>
          <span className="inline-flex tracking-tight font-extrabold">
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </span>
        </h1>
        <span className="text-[14.8px] sm:text-[17.7px] text-white font-bold tracking-[0.38em] uppercase text-center pl-1 whitespace-nowrap">
          THE APP
        </span>
      </div>

      {/* Cabecera Editorial Limpia (Estilo Apple Fitness / WHOOP) */}
      <div className="flex items-end justify-between px-0.5 gap-3">
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-white text-lg sm:text-xl font-bold tracking-tight truncate">
              {t("helloLabel")}{user.fullName?.split(" ")[0] || user.fullName}
            </h2>
            {user.plan === "PRO" && (
              <span className="text-yellow-gold text-[11.9px] font-bold bg-yellow-gold/10 px-2 py-0.5 rounded-md border border-yellow-gold/25 tracking-wider uppercase shrink-0">
                {t("proBadge")}
              </span>
            )}
          </div>
          <p className="text-xs text-white mt-0.5 truncate flex items-center gap-1.5 font-medium">
            <span className="text-[13.2px] font-bold uppercase tracking-wider text-white shrink-0">
              {clubCountryObj.flag}
            </span>
            <span className="text-white">·</span>
            {needsSetup ? (
              <span 
                onClick={() => onNavigate("PROFILE")} 
                className="text-red-rival hover:text-red-400 font-semibold cursor-pointer border-b border-red-rival/60 truncate"
              >
                {language === "es" ? "Completar perfil" : "Complete profile"}
              </span>
            ) : (
              <span className="text-white truncate">
                {user?.bowConfig?.type === "Recurve"
                  ? "Recurvo"
                  : user?.bowConfig?.type === "Compound"
                    ? "Compuesto"
                    : user?.bowConfig?.type || "Barebow"}{" "}
                · {user?.bowConfig?.defaultDistance || 18} m
              </span>
            )}
          </p>
        </div>

        {todayMission && (
          <button
            type="button"
            onClick={() => onNavigate("CALENDAR")}
            className="h-8 px-3 rounded-full bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-[13.2px] font-semibold text-white flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors max-w-[165px]"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-neon shrink-0" />
            <span className="truncate">{todayMission.title}</span>
          </button>
        )}
      </div>

      {/* Bento Grid Principal (3 Tarjetas Limpias y Balanceadas) */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {/* 1. Progreso Semanal + Telemetría Esencial Integrada */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="col-span-2 bg-[#0D1017] rounded-2xl border border-white/[0.08] p-4 flex flex-col justify-between min-h-[180px] cursor-pointer hover:border-white/20 transition-colors duration-200 group min-w-0 overflow-hidden"
        >
          {(() => {
            const scored = sessions
              .filter((s) => !s.isVolumeOnly && !s.isDraft && s.maxScore > 0 && s.score > 0)
              .sort((a, b) => a.timestamp - b.timestamp)
              .slice(-6);

            const hasData = scored.length > 0;
            const latest = hasData ? scored[scored.length - 1] : null;
            const latestPct = latest ? Math.round((latest.score / latest.maxScore) * 100) : 0;

            const points = hasData
              ? scored.map((s, idx) => {
                  const x = scored.length === 1 ? 50 : 6 + (idx * 88) / (scored.length - 1);
                  const ratio = Math.max(0, Math.min(1, s.score / s.maxScore));
                  const y = 32 - ratio * 22;
                  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
                })
              : [
                  { x: 6, y: 27 },
                  { x: 35, y: 23 },
                  { x: 65, y: 19 },
                  { x: 94, y: 13 }
                ];

            const linePath = points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`)
              .join(" ");
            const areaPath =
              points.length > 1
                ? `${linePath} L ${points[points.length - 1].x},36 L ${points[0].x},36 Z`
                : "";

            return (
              <>
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="text-[14.5px] sm:text-xs text-white font-semibold tracking-tight truncate">
                    {t("weeklyProgress")}
                  </span>
                  {hasData ? (
                    <span className="text-xs font-bold text-white tabular-nums whitespace-nowrap shrink-0">
                      {latest.score}<span className="text-white font-medium">/{latest.maxScore}</span>{" "}
                      <span className="text-cyan-neon">({latestPct}%)</span>
                    </span>
                  ) : (
                    <span className="text-[13.2px] text-white font-medium whitespace-nowrap shrink-0">
                      {language === "es" ? "Sin rondas" : "No rounds"}
                    </span>
                  )}
                </div>

                <div className="w-full h-16 my-0.5 relative">
                  <svg viewBox="0 0 100 38" className="w-full h-full overflow-visible">
                    {areaPath && (
                      <path
                        d={areaPath}
                        fill="rgba(0, 191, 255, 0.06)"
                      />
                    )}
                    <path
                      d={linePath}
                      fill="none"
                      stroke={hasData ? "#00BFFF" : "rgba(255,255,255,0.14)"}
                      strokeWidth="1.8"
                      strokeDasharray={hasData ? undefined : "3 3"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {hasData &&
                      points.map((p, idx) => (
                        <circle
                          key={idx}
                          cx={p.x}
                          cy={p.y}
                          r="2"
                          className="fill-cyan-neon stroke-[#0D1017] stroke-[1.2px]"
                        />
                      ))}
                  </svg>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[13.2px] text-white tabular-nums">
                  <span className="truncate">
                    {language === "es" ? "Récord:" : "Best:"}{" "}
                    <strong className="text-white font-bold">
                      {stats.bestScore > 0 ? `${stats.bestScore} pts` : "—"}
                    </strong>
                  </span>
                  <span className="shrink-0">
                    {language === "es" ? "Volumen:" : "Volume:"}{" "}
                    <strong className="text-white font-bold">
                      {stats.totalArrows} fl.
                    </strong>
                  </span>
                </div>
              </>
            );
          })()}
        </motion.div>

        {/* 2. Mi Club */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-[#0D1017] rounded-2xl border border-white/[0.08] p-3.5 sm:p-4 flex flex-col items-center justify-between text-center min-h-[180px] cursor-pointer hover:border-white/20 transition-colors duration-200 group min-w-0 overflow-hidden"
          onClick={() => onNavigate("PROFILE")}
        >
          <span className="text-[14.3px] sm:text-xs text-white font-semibold tracking-tight leading-tight truncate w-full text-center">
            {language === "es" ? "Mi Club" : "My Club"}
          </span>

          <div className="w-10 h-10 rounded-xl bg-[#080A0F] flex items-center justify-center border border-white/[0.08] group-hover:border-white/20 transition-colors shrink-0">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-5 h-5 p-0.5" />
          </div>

          <div className="flex flex-col items-center gap-0.5 overflow-hidden min-w-0 w-full">
            <span className="text-white text-[14.3px] font-bold truncate w-full text-center group-hover:text-cyan-neon transition-colors">
              {user.clubName || t("myClub")}
            </span>
            <span className="text-[12.1px] text-white truncate flex items-center justify-center gap-1 font-medium w-full">
              <span className="shrink-0">{clubCountryObj.flag}</span>
              <span className="text-[11px] font-bold uppercase tracking-wide text-white shrink-0">{clubCountryObj.olympic}</span>
              <span className="text-white">·</span>
              <span className="truncate">
                {user.role === "coach" 
                  ? "Coach" 
                  : user.role === "team_admin" 
                    ? t("roleAdmin") 
                    : user.role === "team_admin_coach" 
                      ? "Admin" 
                      : user.role === "superadmin" 
                        ? "Admin" 
                        : t("roleMember")}
              </span>
            </span>
          </div>
        </motion.div>

        {/* 3. Eliminatorias Online 1v1 */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("MATCHPLAY_LOBBY")}
          className="col-span-3 bg-[#0D1017] rounded-2xl border border-white/[0.1] hover:border-cyan-neon/50 p-4 sm:p-5 cursor-pointer transition-all duration-200 relative overflow-hidden group flex flex-col gap-3"
        >
          {/* Top Accent Hairline (WA Target Trio: Cyan / Red / Gold) */}
          <div className="absolute top-0 left-0 right-0 h-[3px] flex">
            <div className="flex-1 bg-cyan-neon" />
            <div className="flex-1 bg-red-rival" />
            <div className="flex-1 bg-yellow-gold" />
          </div>

          {/* Row 1: Single-line Status Pill + Format Label */}
          <div className="flex items-center justify-between gap-2 pt-0.5 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[11.6px] font-black uppercase tracking-wide text-emerald-400 whitespace-nowrap">
                {t("liveArenaTitle")}
              </span>
            </div>

            <span className="text-[11.6px] font-bold uppercase tracking-wide text-white truncate">
              {language === "es" ? "Sets y Acumulado" : "Sets & Cumulative"}
            </span>
          </div>

          {/* Row 2: Full-width Title & Balanced Description (Centered) */}
          <div className="flex flex-col items-center gap-1 w-full text-center">
            <h3
              className="text-white text-[16.5px] sm:text-lg font-black uppercase tracking-wider leading-snug group-hover:text-cyan-neon transition-colors [text-wrap:balance] text-center"
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              {t("duelsTitle")}
            </h3>
            <p className="text-xs text-white leading-relaxed [text-wrap:pretty] text-center max-w-md">
              {t("duelsDesc")}
            </p>
          </div>

          {/* Row 3: Symmetrical 2-Column Footer (1v1 Scoreboard + Primary CTA Button) */}
          <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-white/[0.07] items-center">
            <div className="min-h-[42px] bg-[#080A0F] border border-white/[0.08] rounded-xl px-2.5 flex items-center justify-center gap-2 overflow-hidden">
              <div className="flex items-baseline gap-1">
                <span className="text-[11.6px] font-black uppercase tracking-wide text-cyan-neon">TÚ</span>
                <span className="text-xs font-black text-white tabular-nums">6</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-red-rival/15 border border-red-rival/30 text-[10.5px] font-black text-red-rival tracking-wide leading-none shrink-0">
                VS
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-black text-white tabular-nums">4</span>
                <span className="text-[11.6px] font-black uppercase tracking-wide text-yellow-gold">RIVAL</span>
              </div>
            </div>

            <div className="min-h-[42px] rounded-xl bg-cyan-neon group-hover:bg-[#19c8ff] text-black font-black text-[13.2px] sm:text-[14.3px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap px-3 overflow-hidden">
              <Swords size={14} strokeWidth={2.5} className="shrink-0" />
              <span className="truncate">{language === "es" ? "Entrar" : "Enter"}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Botón Principal de Entrenamiento (Limpio y Directo) */}
      <motion.button
        variants={cardVariants}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => onNavigate("TARGET")}
        className="w-full h-13 rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-sm sm:text-base tracking-wider uppercase transition-colors cursor-pointer flex justify-center items-center mt-1 active:scale-[0.99] text-center px-4"
      >
        <span className="truncate">{t("newSession")}</span>
      </motion.button>

      {/* Floating stars tab on the left edge */}
      <div className="fixed left-0 top-[calc(50%-112px)] -translate-y-1/2 z-[40] scale-90 origin-left">
        <button
          onClick={() => setIsStarsDrawerOpen(true)}
          className="h-36 w-8 md:w-9 flex flex-col items-center justify-between py-2.5 px-1 rounded-r-2xl bg-yellow-gold border-y border-r border-black/15 cursor-pointer text-black hover:brightness-105 transition-all duration-200 select-none overflow-hidden"
        >
          <Star size={12} strokeWidth={2.5} className="fill-black text-black shrink-0" />
          <span 
            className="text-[10.5px] font-black tracking-[0.12em] uppercase text-black whitespace-nowrap" 
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
              className="fixed top-0 left-0 h-full w-[306px] sm:w-[342px] max-w-[90vw] bg-neutral-950/95 border-r border-yellow-gold/25 shadow-[8px_0_30px_rgba(0,0,0,0.8)] z-[50] flex flex-col pt-[calc(4.5rem+env(safe-area-inset-top))] pb-6 text-left"
            >
              {/* Header */}
              <div className="px-5 pb-4 border-b border-white/5 flex items-center justify-between">
                <div>
                  <h3 className="text-white text-sm font-black uppercase tracking-wide flex items-center gap-1.5">
                    <Star size={14} className="text-yellow-gold fill-yellow-gold shrink-0" />
                    <span>Estrellas 101010</span>
                  </h3>
                  <p className="text-[11.9px] text-white uppercase tracking-wider mt-0.5">
                    Reglamento Oficial WA 720
                  </p>
                </div>
                <button
                  onClick={() => setIsStarsDrawerOpen(false)}
                  className="w-8 h-8 rounded-lg bg-neutral-900 border border-white/5 hover:border-white/10 text-white hover:text-white transition cursor-pointer flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
                <p className="text-[13.2px] text-white leading-relaxed [text-wrap:pretty]">
                  Completa una sesión oficial WA 720 (72 flechas) a distancia reglamentaria (Recurvo 70 m o Compuesto 50 m) con un puntaje mínimo de 500 para ganar estrellas.
                </p>

                {/* Bow type tabs */}
                <div className="grid grid-cols-2 gap-1 bg-[#090B0E] p-1 rounded-xl border border-white/[0.08] w-full">
                  <button
                    onClick={() => setActiveStarTab("Recurve")}
                    className={`h-8 rounded-lg text-[13.2px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition ${
                      activeStarTab === "Recurve"
                        ? "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30"
                        : "text-white hover:text-white"
                    }`}
                  >
                    Recurvo (70 m)
                  </button>
                  <button
                    onClick={() => setActiveStarTab("Compound")}
                    className={`h-8 rounded-lg text-[13.2px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition ${
                      activeStarTab === "Compound"
                        ? "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30"
                        : "text-white hover:text-white"
                    }`}
                  >
                    Compuesto (50 m)
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
                            {/* Star Icon */}
                            <div 
                              className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-transform group-hover:scale-105 ${
                                isUnlocked 
                                  ? "bg-[#0D1017] border-white/10" 
                                  : "bg-neutral-950 border-white/5"
                              }`}
                              style={{ color: star.color }}
                            >
                              <Star size={18} className="fill-current" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-black text-white group-hover:text-yellow-gold transition-colors">
                                {star.name}
                              </span>
                              <span className="text-[11.9px] text-white font-bold mt-0.5 tabular-nums">
                                Mínimo: {star.minScore} pts
                              </span>
                            </div>
                          </div>

                          {/* Right Indicator */}
                          <div>
                            {isUnlocked ? (
                              <span 
                                className="text-[10.6px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider"
                                style={{ 
                                  borderColor: `${star.color}30`, 
                                  backgroundColor: `${star.color}10`, 
                                  color: star.color 
                                }}
                              >
                                LOGRADO
                              </span>
                            ) : (
                              <div className="text-[13.2px] text-white bg-neutral-900/40 px-2 py-1 rounded-lg border border-white/5 font-black uppercase flex items-center justify-center">
                                <Lock size={11} />
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
              className="bg-[#0B0E14] border border-white/10 rounded-3xl p-6 w-full max-w-sm text-center relative overflow-hidden"
            >
              <div className="relative z-10 flex flex-col items-center">
                {/* Large Star Icon */}
                <div
                  className="w-20 h-20 flex items-center justify-center rounded-2xl bg-[#111620] border border-white/10 mb-4 relative"
                  style={{ color: selectedDetailStar.star.color }}
                >
                  <Star size={34} className="fill-current" />
                  {!selectedDetailStar.isUnlocked && (
                    <div className="absolute -bottom-1 -right-1 bg-black border border-white/10 p-1 rounded-lg text-white leading-none">
                      <Lock size={11} />
                    </div>
                  )}
                </div>

                <span className="text-[13.2px] text-yellow-gold font-black tracking-widest uppercase block mb-1">
                  REGLAMENTO OFICIAL WA
                </span>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  {selectedDetailStar.star.name}
                </h3>
                
                <div className="my-4 bg-[#111620] border border-white/[0.07] rounded-2xl px-4 py-3.5 w-full text-left flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[13.2px] text-white uppercase font-bold">Modalidad</span>
                    <span className="text-xs font-black text-white">
                      {selectedDetailStar.bowType === "Recurve" ? "Arco Recurvo" : "Arco Compuesto"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[13.2px] text-white uppercase font-bold">Distancia Oficial</span>
                    <span className="text-xs font-black text-white">
                      {selectedDetailStar.bowType === "Recurve" ? "70 metros" : "50 metros"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[13.2px] text-white uppercase font-bold">Marca Mínima</span>
                    <span className="text-xs font-black text-white tabular-nums">{selectedDetailStar.star.minScore} / 720 pts</span>
                  </div>
                  <div className="flex flex-col pt-1">
                    <div className="flex justify-between items-center text-[13.2px] text-white font-bold mb-1">
                      <span>Progreso de Puntuación</span>
                      <span className="text-white font-extrabold tabular-nums">
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
                                backgroundColor: selectedDetailStar.star.color
                              }}
                            />
                          </div>
                          <span className="text-[11.9px] font-bold text-white mt-0.5">
                            {selectedDetailStar.isUnlocked 
                              ? "Estrella obtenida y superada" 
                              : pointsNeeded > 0 
                                ? `Te faltan ${pointsNeeded} puntos para lograr esta estrella.`
                                : "Estrella lograda"
                            }
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <p className="text-[13.2px] text-white leading-relaxed px-2 [text-wrap:pretty]">
                  {selectedDetailStar.star.description || `Se obtiene con ${selectedDetailStar.star.minScore}+ puntos en la ronda WA 720.`}
                </p>

                <div className="mt-6 flex flex-col gap-2 w-full">
                  <button
                    onClick={() => {
                      setSelectedDetailStar(null);
                      setIsStarsDrawerOpen(false);
                      onNavigate("TARGET");
                    }}
                    className="w-full h-11 bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Target size={14} />
                    <span>Entrenar para Lograrlo</span>
                  </button>
                  <button
                    onClick={() => setSelectedDetailStar(null)}
                    className="w-full h-11 bg-[#111620] border border-white/10 text-white hover:text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition flex items-center justify-center whitespace-nowrap"
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
