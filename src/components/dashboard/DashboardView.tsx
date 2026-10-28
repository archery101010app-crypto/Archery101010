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

const COUNTRIES = [
  { code: "CR", olympic: "CRC", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", olympic: "ESP", name: "España", flag: "🇪🇸" },
  { code: "MX", olympic: "MEX", name: "México", flag: "🇲🇽" },
  { code: "CO", olympic: "COL", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", olympic: "ARG", name: "Argentina", flag: "🇦🇷" },
  { code: "US", olympic: "USA", name: "United States", flag: "🇺🇸" }
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
      className="flex flex-col gap-3.5 sm:gap-4 py-3 w-full max-w-full overflow-x-hidden"
    >
      {/* 1. Titular Oficial de Marca: ARCHERY 101010 / THE APP */}
      <div 
        className="w-full flex flex-col justify-center items-center pt-1 pb-2 select-none gap-1.5"
        style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
      >
        <span className="font-sans text-[8px] sm:text-[9px] text-white/40 font-black tracking-[0.32em] uppercase text-center whitespace-nowrap">
          OLYMPIC &amp; WA PERFORMANCE SYSTEM
        </span>
        <h1 className="flex items-baseline justify-center gap-x-2 sm:gap-x-3.5 text-[23px] sm:text-[36px] md:text-[46px] leading-tight text-center whitespace-nowrap">
          <span className="text-white tracking-wider font-extrabold">ARCHERY</span>
          <span className="inline-flex tracking-tight font-extrabold">
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </span>
        </h1>
        {/* Tricolor Brand Signature Hairline */}
        <div className="w-24 sm:w-32 h-[2px] flex rounded-full overflow-hidden my-0.5">
          <div className="flex-1 bg-cyan-neon" />
          <div className="flex-1 bg-red-rival" />
          <div className="flex-1 bg-yellow-gold" />
        </div>
        <span className="text-[9px] sm:text-[11px] text-white/75 font-bold tracking-[0.42em] uppercase text-center pl-1 whitespace-nowrap">
          THE APP
        </span>
      </div>

      {/* 2. Tarjeta de Identidad del Atleta y Nivel Estrellas 101010 */}
      <motion.div
        variants={cardVariants}
        className="bg-[#0D1017] rounded-2xl border border-white/[0.09] p-3 sm:p-3.5 flex items-center justify-between gap-2.5"
      >
        <div
          onClick={() => onNavigate("PROFILE")}
          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-xl bg-[#080A0F] border border-cyan-neon/35 flex items-center justify-center text-cyan-neon font-black text-xs shrink-0 group-hover:border-cyan-neon transition-colors">
            {(user.fullName || "AR").substring(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-white text-xs sm:text-sm font-black tracking-tight truncate">
                {user.fullName?.split(" ")[0] || user.fullName}
              </span>
              {user.plan === "PRO" && (
                <span className="text-yellow-gold text-[8px] font-black bg-yellow-gold/10 px-1.5 py-0.5 rounded border border-yellow-gold/25 tracking-wider uppercase shrink-0">
                  {t("proBadge")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-white/55 font-medium truncate mt-0.5">
              <span className="shrink-0">{clubCountryObj.flag}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-neon/90 shrink-0">
                {clubCountryObj.olympic}
              </span>
              <span className="text-white/25">·</span>
              {needsSetup ? (
                <span className="text-red-rival font-bold truncate">
                  {language === "es" ? "Completar perfil" : "Complete profile"}
                </span>
              ) : (
                <span className="text-white/75 font-semibold truncate">
                  {user?.bowConfig?.type === "Recurve"
                    ? "Recurvo"
                    : user?.bowConfig?.type === "Compound"
                      ? "Compuesto"
                      : user?.bowConfig?.type || "Barebow"}{" "}
                  · {user?.bowConfig?.defaultDistance || 18} m
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsStarsDrawerOpen(true)}
          className="h-9 px-3 rounded-xl bg-[#080A0F] border border-yellow-gold/30 hover:border-yellow-gold/60 text-yellow-gold font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors whitespace-nowrap"
        >
          <Star size={12} strokeWidth={2.5} className="fill-yellow-gold text-yellow-gold shrink-0" />
          <span>
            {athleteStar?.highestStarLevel
              ? `Nivel ${athleteStar.highestStarLevel}`
              : "Estrellas"}
          </span>
        </button>
      </motion.div>

      {/* 3. Centro de Mando Principal: Nueva Sesión + Accesos Rápidos (Calendario y Cronógrafo) */}
      <motion.div
        variants={cardVariants}
        className="flex flex-col gap-2"
      >
        <button
          type="button"
          onClick={() => onNavigate("TARGET")}
          className="w-full bg-cyan-neon hover:bg-[#19c8ff] text-black rounded-2xl p-3.5 sm:p-4 cursor-pointer transition-all active:scale-[0.99] flex items-center justify-between gap-3 group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-black/15 flex items-center justify-center shrink-0">
              <Target size={20} strokeWidth={2.5} className="text-black" />
            </div>
            <div className="flex flex-col text-left min-w-0">
              <span className="text-sm sm:text-base font-black uppercase tracking-wider text-black leading-tight whitespace-nowrap">
                {t("newSession")}
              </span>
              <span className="text-[10px] font-bold text-black/70 truncate">
                {language === "es"
                  ? "Planilla WA · Diana interactiva y reloj oficial"
                  : "WA Scorecard · Interactive target & official clock"}
              </span>
            </div>
          </div>
          <div className="h-9 px-3 rounded-xl bg-black text-cyan-neon font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 shrink-0 whitespace-nowrap">
            <span>{language === "es" ? "Tirar" : "Shoot"}</span>
            <ChevronRight size={13} strokeWidth={2.5} />
          </div>
        </button>

        {/* Barra de Acceso Rápido en 1 Toque: Misión de Hoy (Calendario) + Cronógrafo */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate("CALENDAR")}
            className="h-10 bg-[#0D1017] hover:border-cyan-neon/40 border border-white/[0.08] rounded-xl px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Calendar size={13} className="text-cyan-neon shrink-0" />
              <span className="text-[10px] font-bold text-white/85 truncate">
                {todayMission
                  ? todayMission.title
                  : language === "es"
                    ? "Plan y Calendario"
                    : "Plan & Calendar"}
              </span>
            </div>
            <ChevronRight size={12} className="text-white/40 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate("CHRONOGRAPH")}
            className="h-10 bg-[#0D1017] hover:border-yellow-gold/40 border border-white/[0.08] rounded-xl px-3 flex items-center justify-between gap-2 cursor-pointer transition-colors min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Gauge size={13} className="text-yellow-gold shrink-0" />
              <span className="text-[10px] font-bold text-white/85 truncate">
                {language === "es" ? "Cronógrafo FPS" : "FPS Chronograph"}
              </span>
            </div>
            <ChevronRight size={12} className="text-white/40 shrink-0" />
          </button>
        </div>
      </motion.div>

      {/* 4. Telemetría Rápida 101010 (Tricolor Cyan / Red / Gold) */}
      <div className="grid grid-cols-3 gap-2.5">
        {/* Card 1: Última Sesión (Cyan) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="bg-[#0D1017] rounded-2xl border border-white/[0.08] hover:border-cyan-neon/40 p-3 flex flex-col justify-between cursor-pointer transition-colors relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-neon" />
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] font-black uppercase tracking-wider text-white/50 whitespace-nowrap">
              {language === "es" ? "Última" : "Latest"}
            </span>
            <Activity size={11} className="text-cyan-neon shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1 min-w-0">
            <span className="text-lg sm:text-xl font-black text-white tabular-nums leading-none truncate">
              {stats.lastScore > 0 ? stats.lastScore : "—"}
            </span>
            {stats.lastMax > 0 && stats.lastScore > 0 && (
              <span className="text-[9px] font-bold text-white/40 tabular-nums shrink-0">
                /{stats.lastMax}
              </span>
            )}
          </div>
          <span className="text-[9px] font-bold text-cyan-neon tabular-nums truncate">
            {stats.lastScore > 0 ? `${lastPercentage}% ${t("precisionLabel")}` : (language === "es" ? "Sin registro" : "No record")}
          </span>
        </motion.div>

        {/* Card 2: Volumen de Flechas (Red Rival) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY", "VOLUME")}
          className="bg-[#0D1017] rounded-2xl border border-white/[0.08] hover:border-red-rival/40 p-3 flex flex-col justify-between cursor-pointer transition-colors relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-red-rival" />
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] font-black uppercase tracking-wider text-white/50 whitespace-nowrap">
              {language === "es" ? "Volumen" : "Volume"}
            </span>
            <Flame size={11} className="text-red-rival shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1 min-w-0">
            <span className="text-lg sm:text-xl font-black text-white tabular-nums leading-none truncate">
              {stats.totalArrows}
            </span>
          </div>
          <span className="text-[9px] font-bold text-white/55 truncate">
            {language === "es" ? "Flechas totales" : "Total arrows"}
          </span>
        </motion.div>

        {/* Card 3: Mejor Marca Personal (Yellow Gold) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="bg-[#0D1017] rounded-2xl border border-white/[0.08] hover:border-yellow-gold/40 p-3 flex flex-col justify-between cursor-pointer transition-colors relative overflow-hidden min-w-0"
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-yellow-gold" />
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9px] font-black uppercase tracking-wider text-white/50 whitespace-nowrap">
              {language === "es" ? "Récord" : "Best"}
            </span>
            <Trophy size={11} className="text-yellow-gold shrink-0" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1 min-w-0">
            <span className="text-lg sm:text-xl font-black text-yellow-gold tabular-nums leading-none truncate">
              {stats.bestScore > 0 ? stats.bestScore : "—"}
            </span>
            {stats.bestMax > 0 && stats.bestScore > 0 && (
              <span className="text-[9px] font-bold text-white/40 tabular-nums shrink-0">
                /{stats.bestMax}
              </span>
            )}
          </div>
          <span className="text-[9px] font-bold text-white/55 truncate">
            {t("personalBest")}
          </span>
        </motion.div>
      </div>

      {/* 5. Bento Grid Principal: Progreso Semanal + Mi Club + Eliminatorias Online */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {/* Progreso Semanal (Conectado a sesiones reales) */}
        <motion.div
          variants={cardVariants}
          onClick={() => onNavigate("HISTORY")}
          className="col-span-2 bg-[#0D1017] rounded-2xl border border-white/[0.08] p-3.5 sm:p-4 flex flex-col justify-between h-36 cursor-pointer hover:border-white/20 transition-colors duration-200 group min-w-0"
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
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <TrendingUp size={12} className="text-cyan-neon shrink-0" />
                    <span className="text-[11px] sm:text-xs text-white/80 font-bold tracking-tight truncate">
                      {t("weeklyProgress")}
                    </span>
                  </div>
                  {hasData ? (
                    <span className="text-[10px] sm:text-xs font-black text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/25 px-1.5 py-0.5 rounded-md tabular-nums whitespace-nowrap shrink-0">
                      {latestPct}%
                    </span>
                  ) : (
                    <span className="text-[10px] text-neutral-500 font-medium whitespace-nowrap shrink-0">
                      {language === "es" ? "Sin rondas" : "No rounds"}
                    </span>
                  )}
                </div>
                <div className="w-full h-20 mt-1 relative">
                  <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible">
                    <line x1="0" y1="12" x2="100" y2="12" stroke="rgba(255,255,255,0.04)" strokeWidth="0.6" />
                    <line x1="0" y1="24" x2="100" y2="24" stroke="rgba(255,255,255,0.04)" strokeWidth="0.6" />
                    <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(255,255,255,0.04)" strokeWidth="0.6" />
                    {areaPath && (
                      <path
                        d={areaPath}
                        fill="rgba(0, 191, 255, 0.08)"
                      />
                    )}
                    <path
                      d={linePath}
                      fill="none"
                      stroke={hasData ? "#00BFFF" : "rgba(255,255,255,0.15)"}
                      strokeWidth="2"
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
                          r="2.2"
                          className="fill-cyan-neon stroke-[#0D1017] stroke-[1.2px]"
                        />
                      ))}
                  </svg>
                </div>
              </>
            );
          })()}
        </motion.div>

        {/* Mi Club */}
        <motion.div
          variants={cardVariants}
          className="col-span-1 bg-[#0D1017] rounded-2xl border border-white/[0.08] p-3.5 sm:p-4 flex flex-col justify-between h-36 cursor-pointer hover:border-white/20 transition-colors duration-200 group min-w-0"
          onClick={() => onNavigate("PROFILE")}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] sm:text-xs text-white/80 font-bold tracking-tight leading-tight truncate">
              {language === "es" ? "Mi Club" : "My Club"}
            </span>
            <ArrowUpRight size={12} className="text-white/35 group-hover:text-cyan-neon transition-colors shrink-0" />
          </div>
          <div className="w-9 h-9 rounded-xl bg-[#080A0F] flex items-center justify-center border border-white/[0.08] group-hover:border-cyan-neon/30 transition-colors">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-5 h-5 p-0.5" />
          </div>
          <div className="flex flex-col gap-0.5 overflow-hidden min-w-0">
            <span className="text-white text-[11px] sm:text-xs font-black truncate group-hover:text-cyan-neon transition-colors">
              {user.clubName || t("myClub")}
            </span>
            <span className="text-[9px] text-neutral-400 truncate flex items-center gap-1 font-medium">
              <span className="shrink-0">{clubCountryObj.flag}</span>
              <span className="text-[8px] font-bold uppercase tracking-wider text-cyan-neon/90 shrink-0">{clubCountryObj.olympic}</span>
              <span className="text-white/30">·</span>
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

        {/* Eliminatorias Online 1v1 (Featured Competitive Card - SIN CAMBIOS) */}
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

          {/* Row 1: Single-line Status Pill + Format Label (Guaranteed no line break) */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 whitespace-nowrap">
                {t("liveArenaTitle")}
              </span>
            </div>

            <span className="text-[9px] font-bold uppercase tracking-wider text-white/45 whitespace-nowrap">
              {language === "es" ? "Sets y Acumulado" : "Sets & Cumulative"}
            </span>
          </div>

          {/* Row 2: Full-width Title & Balanced Description (Never collides with side boxes) */}
          <div className="flex flex-col gap-1 w-full text-left">
            <h3
              className="text-white text-[15px] sm:text-lg font-black uppercase tracking-wider leading-snug group-hover:text-cyan-neon transition-colors [text-wrap:balance]"
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              {t("duelsTitle")}
            </h3>
            <p className="text-xs text-white/65 leading-relaxed [text-wrap:pretty]">
              {t("duelsDesc")}
            </p>
          </div>

          {/* Row 3: Symmetrical 2-Column Footer (1v1 Scoreboard + Primary CTA Button) */}
          <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-white/[0.07] items-center">
            <div className="h-10 bg-[#080A0F] border border-white/[0.08] rounded-xl px-3 flex items-center justify-center gap-2.5">
              <div className="flex items-baseline gap-1">
                <span className="text-[9px] font-black uppercase tracking-wider text-cyan-neon">TÚ</span>
                <span className="text-xs font-black text-white tabular-nums">6</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-red-rival/15 border border-red-rival/30 text-[8px] font-black text-red-rival tracking-wider leading-none">
                VS
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-black text-white/80 tabular-nums">4</span>
                <span className="text-[9px] font-black uppercase tracking-wider text-yellow-gold">RIVAL</span>
              </div>
            </div>

            <div className="h-10 rounded-xl bg-cyan-neon group-hover:bg-[#19c8ff] text-black font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap px-3">
              <Swords size={13} strokeWidth={2.5} className="shrink-0" />
              <span>{language === "es" ? "Entrar 1 vs 1" : "Enter 1v1"}</span>
              <ChevronRight size={13} strokeWidth={2.5} className="shrink-0" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Floating stars tab on the left edge */}
      <div className="fixed left-0 top-[calc(50%-112px)] -translate-y-1/2 z-[40] scale-90 origin-left">
        <button
          onClick={() => setIsStarsDrawerOpen(true)}
          className="h-28 w-8 md:w-9 flex flex-col items-center justify-between py-2.5 px-1 rounded-r-2xl bg-yellow-gold border-y border-r border-black/15 cursor-pointer text-black hover:brightness-105 transition-all duration-200 select-none"
        >
          <Star size={12} strokeWidth={2.5} className="fill-black text-black shrink-0" />
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
                    <Star size={14} className="text-yellow-gold fill-yellow-gold shrink-0" />
                    <span>Estrellas 101010</span>
                  </h3>
                  <p className="text-[9px] text-gray-dim uppercase tracking-wider mt-0.5">
                    Reglamento Oficial WA 720
                  </p>
                </div>
                <button
                  onClick={() => setIsStarsDrawerOpen(false)}
                  className="w-8 h-8 rounded-lg bg-neutral-900 border border-white/5 hover:border-white/10 text-gray-dim hover:text-white transition cursor-pointer flex items-center justify-center"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
                <p className="text-[10px] text-gray-dim leading-relaxed [text-wrap:pretty]">
                  Completa una sesión oficial WA 720 (72 flechas) a distancia reglamentaria (Recurvo 70 m o Compuesto 50 m) con un puntaje mínimo de 500 para ganar estrellas.
                </p>

                {/* Bow type tabs */}
                <div className="grid grid-cols-2 gap-1 bg-[#090B0E] p-1 rounded-xl border border-white/[0.08] w-full">
                  <button
                    onClick={() => setActiveStarTab("Recurve")}
                    className={`h-8 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition ${
                      activeStarTab === "Recurve"
                        ? "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30"
                        : "text-gray-dim hover:text-white"
                    }`}
                  >
                    Recurvo (70 m)
                  </button>
                  <button
                    onClick={() => setActiveStarTab("Compound")}
                    className={`h-8 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition ${
                      activeStarTab === "Compound"
                        ? "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30"
                        : "text-gray-dim hover:text-white"
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
                              <span className="text-[9px] text-gray-dim font-bold mt-0.5 tabular-nums">
                                Mínimo: {star.minScore} pts
                              </span>
                            </div>
                          </div>

                          {/* Right Indicator */}
                          <div>
                            {isUnlocked ? (
                              <span 
                                className="text-[8px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider"
                                style={{ 
                                  borderColor: `${star.color}30`, 
                                  backgroundColor: `${star.color}10`, 
                                  color: star.color 
                                }}
                              >
                                LOGRADO
                              </span>
                            ) : (
                              <div className="text-[10px] text-gray-dim bg-neutral-900/40 px-2 py-1 rounded-lg border border-white/5 font-black uppercase flex items-center justify-center">
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
                    <div className="absolute -bottom-1 -right-1 bg-black border border-white/10 p-1 rounded-lg text-gray-dim leading-none">
                      <Lock size={11} />
                    </div>
                  )}
                </div>

                <span className="text-[10px] text-yellow-gold font-black tracking-widest uppercase block mb-1">
                  REGLAMENTO OFICIAL WA
                </span>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  {selectedDetailStar.star.name}
                </h3>
                
                <div className="my-4 bg-[#111620] border border-white/[0.07] rounded-2xl px-4 py-3.5 w-full text-left flex flex-col gap-2">
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
                    <span className="text-xs font-black text-white tabular-nums">{selectedDetailStar.star.minScore} / 720 pts</span>
                  </div>
                  <div className="flex flex-col pt-1">
                    <div className="flex justify-between items-center text-[10px] text-gray-dim font-bold mb-1">
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
                          <span className="text-[9px] font-bold text-gray-dim mt-0.5">
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

                <p className="text-[10px] text-gray-dim leading-relaxed px-2 [text-wrap:pretty]">
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
                    className="w-full h-11 bg-[#111620] border border-white/10 text-gray-dim hover:text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition flex items-center justify-center whitespace-nowrap"
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
