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
      className="flex flex-col gap-4 py-4 w-full max-w-full overflow-x-hidden"
    >
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex flex-col min-w-0">
          <h2 className="text-white text-xl font-black flex items-center gap-1.5 uppercase tracking-wide">
            <span>{t("dashHome")}</span>
            {user.plan === "PRO" && (
              <span className="text-yellow-gold text-xs font-black bg-yellow-gold/10 px-2 py-0.5 rounded-full border border-yellow-gold/20 shadow-glow-yellow animate-pulse">
                {t("proBadge")}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-dim mt-0.5">
            {t("helloLabel")}{user.fullName} · {needsSetup ? (
              <span 
                onClick={() => onNavigate("PROFILE")} 
                className="animate-pulse text-red-rival hover:text-red-400 font-extrabold cursor-pointer border-b border-dashed border-red-rival ml-1"
                title={language === "es" ? "¡Configura tu perfil de arquero aquí!" : "Setup your archer profile here!"}
              >
                {user?.bowConfig?.type === "Recurve" ? "Recurvo" : user?.bowConfig?.type === "Compound" ? "Compuesto" : (user?.bowConfig?.type || "Barebow")} ({language === "es" ? "Configurar Perfil ⚠️" : "Setup Profile ⚠️"})
              </span>
            ) : (
              <span>{user?.bowConfig?.type === "Recurve" ? "Recurvo" : user?.bowConfig?.type === "Compound" ? "Compuesto" : (user?.bowConfig?.type || "Barebow")}</span>
            )}
          </p>
        </div>

        {/* Club & Country Badge */}
        <div className="flex items-center gap-2.5 bg-neutral-900/80 border border-white/10 rounded-2xl px-3 py-1.5 shadow-[0_0_15px_rgba(0,229,255,0.05)] hover:border-cyan-neon/30 transition-all duration-300">
          <div className="w-8 h-8 rounded-xl bg-neutral-950 border border-white/5 flex items-center justify-center relative shrink-0 shadow-inner group">
            <ClubLogoIcon logo={user.clubLogo || "0"} className="w-6 h-6 p-0.5" />
            <span className="absolute -bottom-1.5 -right-1.5 text-sm drop-shadow-md">{clubFlag}</span>
          </div>
          <div className="flex flex-col text-left">
            <span className="text-[10px] font-black text-white leading-none truncate max-w-[120px]">
              {user.clubName || t("independentLabel")}
            </span>
            <span className="text-[8px] text-cyan-neon font-bold mt-1.5 uppercase tracking-wider leading-none">
              {clubCountryName}
            </span>
          </div>
        </div>
      </div>

      {/* 🎯 HERO ARENA OLÍMPICA */}
      <motion.div
        variants={cardVariants}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-neutral-900/90 via-neutral-950 to-neutral-900/95 border border-cyan-500/25 p-5 shadow-[0_0_30px_rgba(0,229,255,0.08)] backdrop-blur-xl group"
      >
        {/* Ambient Glows */}
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4">
          {/* Top Tag & Stats Badge */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-cyan-500/10 text-cyan-neon border border-cyan-500/25 shadow-[0_0_10px_rgba(0,229,255,0.15)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
              </span>
              {language === "es" ? "Arena Olímpica 101010" : "Olympic Arena 101010"}
            </span>

            <div className="flex items-center gap-2">
              {stats.bestScore > 0 && (
                <span className="text-[10px] font-black text-yellow-gold bg-yellow-gold/10 px-2.5 py-0.5 rounded-full border border-yellow-gold/20 flex items-center gap-1">
                  <span>★ PB</span>
                  <span className="text-white">{stats.bestScore}</span>
                </span>
              )}
            </div>
          </div>

          {/* Central Row: Description + Interactive Target */}
          <div className="flex flex-col sm:flex-row items-center gap-5 justify-between py-1">
            <div className="flex flex-col text-center sm:text-left items-center sm:items-start flex-1 min-w-0">
              <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase leading-none">
                {language === "es" ? "¿Listo para tirar?" : "Ready to Shoot?"}
              </h3>
              <p className="text-xs text-gray-dim mt-2 leading-relaxed max-w-sm">
                {language === "es" 
                  ? "Registra tus rondas con diana reglamentaria WA o conteo libre, impactos exactos y cálculo automático."
                  : "Track rounds with official WA targets or free count, arrow impact coordinates, and live stats."}
              </p>

              {/* Dynamic Mission / Coach Assignment or Streak Capsule */}
              {todayMission ? (
                <div 
                  onClick={() => onNavigate("CALENDAR")}
                  className="mt-3.5 w-full bg-cyan-950/40 border border-cyan-500/30 rounded-2xl p-2.5 flex items-center justify-between gap-2.5 hover:border-cyan-neon/60 transition cursor-pointer group/m"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-neon shrink-0">
                      <Target size={16} />
                    </div>
                    <div className="flex flex-col min-w-0 text-left">
                      <span className="text-[9px] font-black uppercase text-cyan-neon tracking-wider flex items-center gap-1 truncate">
                        <span>🎯 {language === "es" ? "Misión de Hoy" : "Today's Mission"}</span>
                        {todayMission.targetArrows && (
                          <span className="text-white/80">· {todayMission.targetArrows} {language === "es" ? "flechas" : "arrows"}</span>
                        )}
                      </span>
                      <span className="text-xs font-bold text-white truncate">
                        {todayMission.title}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-cyan-neon group-hover/m:translate-x-0.5 transition-transform shrink-0" />
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-dim bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                  <Flame size={13} className="text-amber-400" />
                  <span>
                    {stats.totalArrows > 0 
                      ? `${stats.totalArrows.toLocaleString()} ${language === "es" ? "flechas acumuladas en tu historial" : "arrows accumulated in your history"}` 
                      : (language === "es" ? "Inicia tu primer entrenamiento oficial" : "Start your first official training")}
                  </span>
                </div>
              )}
            </div>

            {/* Target Graphic (Interactive World Archery Olympic Target) */}
            <motion.div
              whileHover={{ scale: 1.05, rotate: 3 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              onClick={() => onNavigate("TARGET")}
              className="relative w-32 h-32 sm:w-36 sm:h-36 shrink-0 cursor-pointer select-none"
              title={language === "es" ? "Toca para abrir la diana" : "Tap to open target"}
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500/20 via-yellow-500/20 to-red-500/20 blur-md animate-pulse" />
              
              <svg viewBox="0 0 160 160" className="w-full h-full relative drop-shadow-[0_0_15px_rgba(0,229,255,0.25)]">
                {/* 1 & 2 White rings */}
                <circle cx="80" cy="80" r="76" fill="#F3F4F6" stroke="#9CA3AF" strokeWidth="1" />
                <circle cx="80" cy="80" r="68.4" fill="#F3F4F6" stroke="#D1D5DB" strokeWidth="0.8" />
                
                {/* 3 & 4 Black rings */}
                <circle cx="80" cy="80" r="60.8" fill="#1F2937" stroke="#4B5563" strokeWidth="1" />
                <circle cx="80" cy="80" r="53.2" fill="#111827" stroke="#374151" strokeWidth="0.8" />
                
                {/* 5 & 6 Blue rings */}
                <circle cx="80" cy="80" r="45.6" fill="#0284C7" stroke="#38BDF8" strokeWidth="1" />
                <circle cx="80" cy="80" r="38" fill="#0EA5E9" stroke="#7DD3FC" strokeWidth="0.8" />
                
                {/* 7 & 8 Red rings */}
                <circle cx="80" cy="80" r="30.4" fill="#DC2626" stroke="#F87171" strokeWidth="1" />
                <circle cx="80" cy="80" r="22.8" fill="#EF4444" stroke="#FCA5A5" strokeWidth="0.8" />
                
                {/* 9 & 10 Gold rings */}
                <circle cx="80" cy="80" r="15.2" fill="#EAB308" stroke="#FDE047" strokeWidth="1" />
                <circle cx="80" cy="80" r="7.6" fill="#FACC15" stroke="#FEF08A" strokeWidth="0.8" />
                
                {/* X-Ring Center Crosshair */}
                <line x1="80" y1="74" x2="80" y2="86" stroke="#854D0E" strokeWidth="0.8" strokeLinecap="round" />
                <line x1="74" y1="80" x2="86" y2="80" stroke="#854D0E" strokeWidth="0.8" strokeLinecap="round" />
                
                {/* High-tech Arrow Impact Point in the 10/X */}
                <circle cx="81.5" cy="78.5" r="2.2" fill="#00E5FF" stroke="#000000" strokeWidth="0.6" className="drop-shadow-[0_0_6px_#00E5FF]" />
                <circle cx="81.5" cy="78.5" r="4.5" fill="none" stroke="#00E5FF" strokeWidth="0.5" opacity="0.6" />
              </svg>
            </motion.div>
          </div>

          {/* Primary Action Button inside the Hero */}
          <motion.button
            whileHover={{ scale: 1.015, filter: "brightness(1.1)" }}
            whileTap={{ scale: 0.985 }}
            onClick={() => onNavigate("TARGET")}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-cyan-neon to-cyan-400 text-black font-black text-sm tracking-wider uppercase shadow-[0_0_20px_rgba(0,229,255,0.4)] hover:shadow-[0_0_30px_rgba(0,229,255,0.6)] transition-all cursor-pointer flex items-center justify-center gap-2 mt-1"
          >
            <Target size={18} className="text-black" />
            <span>{language === "es" ? "Iniciar Ronda de Tiro" : "Start Shooting Round"}</span>
            <ArrowUpRight size={16} className="text-black" />
          </motion.button>
        </div>
      </motion.div>

      {/* 🚀 BENTO GRID DE MODOS CLAVE */}
      <div className="grid grid-cols-2 gap-3">
        {/* CARD 1: ⚔️ Duelos 1 vs 1 (Matchplay) */}
        <motion.div
          variants={cardVariants}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("MATCHPLAY_LOBBY")}
          className="bg-gradient-to-br from-purple-950/50 via-neutral-900/80 to-neutral-950 rounded-2xl border border-purple-500/25 p-3.5 cursor-pointer hover:border-purple-400/60 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between min-h-[135px] shadow-[0_0_15px_rgba(168,85,247,0.06)]"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none group-hover:bg-purple-500/20 transition-all" />
          
          <div className="flex items-center justify-between w-full z-10">
            <div className="w-9 h-9 rounded-xl bg-purple-900/40 border border-purple-500/30 flex items-center justify-center text-purple-300 group-hover:scale-110 group-hover:text-purple-200 transition-all shadow-[0_0_10px_rgba(168,85,247,0.2)]">
              <Swords size={18} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-wider text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
              <span>1 vs 1</span>
            </span>
          </div>

          <div className="flex flex-col z-10 mt-3">
            <span className="text-white text-sm font-black uppercase tracking-wide group-hover:text-purple-300 transition-colors">
              {language === "es" ? "Duelos 1 vs 1" : "1 vs 1 Duels"}
            </span>
            <span className="text-[9.5px] text-gray-dim leading-snug mt-0.5 line-clamp-2">
              {language === "es" ? "Matchplay y series de eliminación directa" : "Matchplay and direct elimination sets"}
            </span>
          </div>

          <div className="flex items-center justify-end w-full mt-1 z-10">
            <span className="text-[9px] font-bold text-purple-400 group-hover:text-purple-300 flex items-center gap-0.5">
              <span>{language === "es" ? "Entrar" : "Enter"}</span>
              <ArrowUpRight size={12} />
            </span>
          </div>
        </motion.div>

        {/* CARD 2: ⏱️ Cronógrafo Balístico */}
        <motion.div
          variants={cardVariants}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("CHRONOGRAPH")}
          className="bg-gradient-to-br from-amber-950/40 via-neutral-900/80 to-neutral-950 rounded-2xl border border-amber-500/25 p-3.5 cursor-pointer hover:border-amber-400/60 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between min-h-[135px] shadow-[0_0_15px_rgba(245,158,11,0.06)]"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none group-hover:bg-amber-500/20 transition-all" />
          
          <div className="flex items-center justify-between w-full z-10">
            <div className="w-9 h-9 rounded-xl bg-amber-900/40 border border-amber-500/30 flex items-center justify-center text-amber-300 group-hover:scale-110 group-hover:text-amber-200 transition-all shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <Gauge size={18} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-wider text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              FPS · m/s
            </span>
          </div>

          <div className="flex flex-col z-10 mt-3">
            <span className="text-white text-sm font-black uppercase tracking-wide group-hover:text-amber-300 transition-colors">
              {language === "es" ? "Cronógrafo" : "Chronograph"}
            </span>
            <span className="text-[9.5px] text-gray-dim leading-snug mt-0.5 line-clamp-2">
              {language === "es" ? "Medición balística acústica de velocidad" : "Acoustic ballistic arrow speed tracking"}
            </span>
          </div>

          <div className="flex items-center justify-end w-full mt-1 z-10">
            <span className="text-[9px] font-bold text-amber-400 group-hover:text-amber-300 flex items-center gap-0.5">
              <span>{language === "es" ? "Medir" : "Measure"}</span>
              <ArrowUpRight size={12} />
            </span>
          </div>
        </motion.div>

        {/* CARD 3: 📅 Mi Calendario & Plan */}
        <motion.div
          variants={cardVariants}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("CALENDAR")}
          className="bg-gradient-to-br from-sky-950/40 via-neutral-900/80 to-neutral-950 rounded-2xl border border-sky-500/25 p-3.5 cursor-pointer hover:border-sky-400/60 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between min-h-[135px] shadow-[0_0_15px_rgba(14,165,233,0.06)]"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/10 rounded-full blur-xl pointer-events-none group-hover:bg-sky-500/20 transition-all" />
          
          <div className="flex items-center justify-between w-full z-10">
            <div className="w-9 h-9 rounded-xl bg-sky-900/40 border border-sky-500/30 flex items-center justify-center text-sky-300 group-hover:scale-110 group-hover:text-sky-200 transition-all shadow-[0_0_10px_rgba(14,165,233,0.2)]">
              <Calendar size={18} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-wider text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
              {upcomingCount > 0 
                ? `${upcomingCount} ${language === "es" ? "eventos" : "events"}` 
                : (language === "es" ? "Plan Activo" : "Active Plan")}
            </span>
          </div>

          <div className="flex flex-col z-10 mt-3">
            <span className="text-white text-sm font-black uppercase tracking-wide group-hover:text-sky-300 transition-colors">
              {language === "es" ? "Calendario & Plan" : "Calendar & Plan"}
            </span>
            <span className="text-[9.5px] text-gray-dim leading-snug mt-0.5 line-clamp-2">
              {language === "es" ? "Macrociclos, torneos y tareas del coach" : "Macrocycles, tournaments and coach tasks"}
            </span>
          </div>

          <div className="flex items-center justify-end w-full mt-1 z-10">
            <span className="text-[9px] font-bold text-sky-400 group-hover:text-sky-300 flex items-center gap-0.5">
              <span>{language === "es" ? "Ver Plan" : "View Plan"}</span>
              <ArrowUpRight size={12} />
            </span>
          </div>
        </motion.div>

        {/* CARD 4: 📊 Historial & Estadísticas */}
        <motion.div
          variants={cardVariants}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("HISTORY")}
          className="bg-gradient-to-br from-emerald-950/40 via-neutral-900/80 to-neutral-950 rounded-2xl border border-emerald-500/25 p-3.5 cursor-pointer hover:border-emerald-400/60 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between min-h-[135px] shadow-[0_0_15px_rgba(16,185,129,0.06)]"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl pointer-events-none group-hover:bg-emerald-500/20 transition-all" />
          
          <div className="flex items-center justify-between w-full z-10">
            <div className="w-9 h-9 rounded-xl bg-emerald-900/40 border border-emerald-500/30 flex items-center justify-center text-emerald-300 group-hover:scale-110 group-hover:text-emerald-200 transition-all shadow-[0_0_10px_rgba(16,185,129,0.2)]">
              <TrendingUp size={18} />
            </div>
            <span className="text-[8px] font-black uppercase tracking-wider text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              {sessions.length} {language === "es" ? "sesiones" : "sessions"}
            </span>
          </div>

          <div className="flex flex-col z-10 mt-3">
            <span className="text-white text-sm font-black uppercase tracking-wide group-hover:text-emerald-300 transition-colors">
              {language === "es" ? "Historial & Récords" : "History & Records"}
            </span>
            <span className="text-[9.5px] text-gray-dim leading-snug mt-0.5 line-clamp-2">
              {stats.bestScore > 0 
                ? `${language === "es" ? "Récord Personal" : "Personal Best"}: ${stats.bestScore} pts` 
                : (language === "es" ? "Récords, volumen y evolución" : "Records, volume and evolution")}
            </span>
          </div>

          <div className="flex items-center justify-end w-full mt-1 z-10">
            <span className="text-[9px] font-bold text-emerald-400 group-hover:text-emerald-300 flex items-center gap-0.5">
              <span>{language === "es" ? "Explorar" : "Explore"}</span>
              <ArrowUpRight size={12} />
            </span>
          </div>
        </motion.div>
      </div>

      {/* 🌟 BANNER OFICIAL ESTRELLAS 101010 */}
      <motion.div
        variants={cardVariants}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => setIsStarsDrawerOpen(true)}
        className="w-full bg-gradient-to-r from-amber-500/15 via-neutral-900/90 to-yellow-500/10 border border-yellow-gold/30 rounded-2xl p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:border-yellow-gold/60 transition-all duration-300 shadow-[0_0_20px_rgba(255,229,0,0.06)] group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 via-yellow-gold to-yellow-600 p-0.5 shadow-[0_0_15px_rgba(255,229,0,0.25)] flex items-center justify-center shrink-0 group-hover:rotate-6 transition-transform">
            <div className="w-full h-full bg-neutral-950 rounded-[14px] flex items-center justify-center">
              <span className="text-yellow-gold text-lg font-black leading-none drop-shadow-md">★</span>
            </div>
          </div>
          <div className="flex flex-col text-left min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-white text-xs font-black uppercase tracking-wider">
                {athleteStar?.highestStar 
                  ? `${language === "es" ? "Estrella Actual" : "Current Star"}: ${athleteStar.highestStar.name}`
                  : (language === "es" ? "Estrellas 101010 Oficiales" : "Official 101010 Stars")}
              </span>
              <span className="text-[8px] bg-yellow-gold/20 text-yellow-gold font-bold px-2 py-0.5 rounded-full border border-yellow-gold/30 uppercase">
                WA 720
              </span>
            </div>
            <span className="text-[10px] text-gray-dim leading-snug truncate mt-0.5">
              {athleteStar?.highestStar 
                ? `${athleteStar.highestStar.score} pts · ${athleteStar.highestStar.bowType}` 
                : (language === "es" ? "Tira 72 flechas a 70m/50m y desbloquea insignias oficiales" : "Shoot 72 arrows at 70m/50m to unlock official stars")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] font-black text-yellow-gold shrink-0">
          <span>{language === "es" ? "Ver Insignias" : "View Stars"}</span>
          <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </motion.div>

      {/* Floating stars tab on the left edge */}
      <div className="fixed left-0 top-[40%] -translate-y-1/2 z-[40] scale-90 origin-left">
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
