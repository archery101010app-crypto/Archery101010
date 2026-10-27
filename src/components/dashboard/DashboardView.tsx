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
  Sparkles,
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
  ChevronRight
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
        let clubArchers = list.filter(u => u.clubId === user.clubId && u.role === "archer");
        
        if (clubArchers.length === 0) {
          const demoArchers: UserProfile[] = [
            {
              uid: "USR-D-ATHLETE-1",
              email: "daniela@archery101010.com",
              fullName: "Daniela Solano",
              nickname: "daniela",
              birthDate: "2002-08-12",
              country: user.country,
              city: "San José",
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
              nickname: "carlos",
              birthDate: "1998-04-25",
              country: user.country,
              city: "Cartago",
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
              nickname: "sebas",
              birthDate: "2005-11-03",
              country: user.country,
              city: "Alajuela",
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
      className="flex flex-col gap-5 sm:gap-6 py-4 w-full max-w-full overflow-x-hidden"
    >
      {/* Titular Oficial: ARCHERY APP / by 101010 (+25% de tamaño) */}
      <div 
        className="w-full flex flex-col justify-center items-center pt-2 pb-5 sm:pb-7 select-none gap-1.5"
        style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
      >
        <h1 className="flex flex-wrap items-baseline justify-center gap-x-2.5 sm:gap-x-4 text-[26px] sm:text-[38px] md:text-[48px] leading-tight text-center">
          <span className="text-white tracking-widest font-extrabold">ARCHERY</span>
          <span className="inline-flex tracking-tight font-extrabold">
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </span>
        </h1>
        <span className="text-[10px] sm:text-[12px] md:text-[14px] text-white/80 font-bold tracking-[0.45em] uppercase text-center pl-1">
          THE APP
        </span>
      </div>

      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-white text-lg font-bold tracking-tight">
              {t("dashHome")}
            </h2>
            {user.plan === "PRO" && (
              <span className="text-yellow-gold text-[10px] font-bold bg-yellow-gold/10 px-2 py-0.5 rounded-md border border-yellow-gold/25 tracking-wider uppercase">
                {t("proBadge")}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {t("helloLabel")}{user.fullName} · {needsSetup ? (
              <span 
                onClick={() => onNavigate("PROFILE")} 
                className="text-red-rival hover:text-red-400 font-semibold cursor-pointer border-b border-red-rival/60 ml-1"
                title={language === "es" ? "Configura tu perfil de arquero aquí" : "Setup your archer profile here"}
              >
                {user?.bowConfig?.type === "Recurve" ? "Recurvo" : user?.bowConfig?.type === "Compound" ? "Compuesto" : (user?.bowConfig?.type || "Barebow")} ({language === "es" ? "Completar perfil" : "Complete profile"})
              </span>
            ) : (
              <span className="text-neutral-300 font-medium">{user?.bowConfig?.type === "Recurve" ? "Recurvo" : user?.bowConfig?.type === "Compound" ? "Compuesto" : (user?.bowConfig?.type || "Barebow")}</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 sm:gap-5">
        {/* Progreso Semanal (Conectado a sesiones reales) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="col-span-2 bg-[#0D0F12] rounded-2xl border border-white/[0.08] p-4 flex flex-col justify-between h-36 cursor-pointer hover:border-white/20 transition-colors duration-200 group"
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
                  const y = 34 - ratio * 24;
                  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
                })
              : [
                  { x: 6, y: 28 },
                  { x: 35, y: 24 },
                  { x: 65, y: 20 },
                  { x: 94, y: 14 }
                ];

            const linePath = points
              .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`)
              .join(" ");
            const areaPath =
              points.length > 1
                ? `${linePath} L ${points[points.length - 1].x},38 L ${points[0].x},38 Z`
                : "";

            return (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-neutral-400 font-semibold tracking-tight">
                    {t("weeklyProgress")}
                  </span>
                  {hasData ? (
                    <span className="text-xs font-bold text-white tabular-nums">
                      {latest.score} <span className="text-neutral-500 font-medium">/ {latest.maxScore}</span>{" "}
                      <span className="text-cyan-neon ml-0.5">({latestPct}%)</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-neutral-500 font-medium">
                      {language === "es" ? "Sin rondas aún" : "No rounds yet"}
                    </span>
                  )}
                </div>
                <div className="w-full h-20 mt-1 relative">
                  <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible">
                    {areaPath && (
                      <path
                        d={areaPath}
                        fill="rgba(0, 191, 255, 0.06)"
                      />
                    )}
                    <path
                      d={linePath}
                      fill="none"
                      stroke={hasData ? "#00BFFF" : "rgba(255,255,255,0.15)"}
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
                          className="fill-cyan-neon stroke-[#0D0F12] stroke-[1.2px]"
                        />
                      ))}
                  </svg>
                </div>
              </>
            );
          })()}
        </motion.div>

        {/* Clubes y Programas */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-[#0D0F12] rounded-2xl border border-white/[0.08] p-4 flex flex-col justify-between h-36 cursor-pointer hover:border-white/20 transition-colors duration-200 group"
          onClick={() => onNavigate("PROFILE")}
        >
          <span className="text-xs text-neutral-400 font-semibold tracking-tight leading-snug">
            {t("clubsPrograms")}
          </span>
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <span className="text-white text-xs font-bold truncate group-hover:text-cyan-neon transition-colors">
              {user.clubName || t("myClub")}
            </span>
            <span className="text-[11px] text-neutral-400 truncate flex items-center gap-1 mt-0.5">
              <span>{clubFlag}</span>
              <span className="truncate">
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
          <div className="w-9 h-9 rounded-xl bg-neutral-950 flex items-center justify-center border border-white/[0.07] group-hover:border-white/20 transition-colors">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-6 h-6 p-0.5" />
          </div>
        </motion.div>

        {/* Duelos de Eliminación */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("MATCHPLAY_LOBBY")}
          className="col-span-3 bg-[#0D0F12] rounded-2xl border border-white/[0.08] p-4 cursor-pointer hover:border-white/20 transition-colors duration-200 relative overflow-hidden group flex justify-between items-center h-28"
        >
          <div className="flex flex-col gap-1 z-10 w-[78%]">
            <span className="text-[11px] text-cyan-neon font-semibold tracking-tight flex items-center gap-1.5">
              <span className="inline-flex rounded-full h-1.5 w-1.5 bg-cyan-neon" />
              {t("liveArenaTitle")}
            </span>
            <h3 className="text-white text-base font-bold tracking-tight mt-0.5 group-hover:text-cyan-neon transition-colors">
              {t("duelsTitle")}
            </h3>
            <p className="text-xs text-neutral-400 leading-snug">
              {t("duelsDesc")}
            </p>
          </div>

          <div className="w-11 h-11 rounded-xl bg-neutral-950 border border-white/[0.07] flex items-center justify-center text-cyan-neon group-hover:border-white/20 transition-colors shrink-0">
            <Trophy size={19} strokeWidth={2} />
          </div>
          
          <ArrowUpRight size={15} className="absolute top-3.5 right-3.5 text-neutral-500 group-hover:text-white transition-colors" />
        </motion.div>
      </div>

      <motion.button
        variants={cardVariants}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => onNavigate("TARGET")}
        className="w-full py-4 rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-base sm:text-lg tracking-wide uppercase transition-colors cursor-pointer flex justify-center items-center gap-2.5 mt-2 active:scale-[0.99]"
      >
        <Target size={20} strokeWidth={2.5} className="text-black shrink-0" />
        <span>{t("newSession")}</span>
      </motion.button>

      {/* Floating stars tab on the left edge */}
      <div className="fixed left-0 top-[calc(50%-112px)] -translate-y-1/2 z-[40] scale-90 origin-left">
        <button
          onClick={() => setIsStarsDrawerOpen(true)}
          className="h-28 w-8 md:w-9 flex flex-col items-center justify-between py-2.5 px-1 rounded-r-2xl bg-yellow-gold border-y border-r border-black/15 cursor-pointer text-black hover:brightness-105 transition-all duration-200 select-none"
        >
          <span className="text-sm text-black font-black leading-none">
            ★
          </span>
          <span 
            className="text-[8px] font-black tracking-[0.18em] uppercase text-black" 
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
                  {selectedDetailStar.star.description || `Se obtiene con ${selectedDetailStar.star.minScore}+ puntos en la ronda WA 720.`}
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
