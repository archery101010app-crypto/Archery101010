"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Users, UserCheck, CreditCard, Activity, Target, RefreshCw, Database, Globe2, PieChart, Award, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, getLocalSessions, getSyncQueue, adCampaignsStore } from "@/lib/db/indexedDB";
import { COUNTRIES_MAP as COUNTRIES } from "@/lib/countries";

interface RealActivityItem {
  id: string;
  user: string;
  action: string;
  detail: string;
  timeAgo: string;
  timestamp: number;
  icon: any;
  iconColor: string;
}

function formatTimeAgo(timestamp?: number | string): string {
  if (!timestamp) return "Fecha no registrada";
  const num = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  if (isNaN(num) || num <= 0) return "Fecha no registrada";
  const diffSec = Math.floor((Date.now() - num) / 1000);
  if (diffSec < 60) return "hace un momento";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "ayer";
  if (diffDays < 30) return `hace ${diffDays} días`;
  return new Date(num).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export default function AdminDashboardTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [syncQueueCount, setSyncQueueCount] = useState<number>(0);
  const [campaignsCount, setCampaignsCount] = useState<number>(0);
  const [recentActivities, setRecentActivities] = useState<RealActivityItem[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadRealData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Load real registered users from IndexedDB
      let userList = await getLocalSetting<UserProfile[]>("simulated_users", []);

      // If online, fetch real users from Firestore and merge
      if (typeof navigator !== "undefined") {
        setIsOnline(navigator.onLine);
        if (navigator.onLine) {
          try {
            const { collection, getDocs } = await import("firebase/firestore");
            const { db } = await import("@/lib/firebase");
            const snap = await getDocs(collection(db, "users"));
            const remoteMap = new Map<string, UserProfile>();
            snap.forEach((docSnap) => {
              const u = docSnap.data() as UserProfile;
              if (u && (u.uid || u.email)) {
                remoteMap.set(u.uid || u.email, u);
              }
            });
            // Merge
            userList.forEach((u) => {
              if (u.uid && !remoteMap.has(u.uid)) {
                remoteMap.set(u.uid, u);
              }
            });
            userList = Array.from(remoteMap.values());
          } catch (err) {
            console.warn("Could not fetch remote users, using local cache:", err);
          }
        }
      }

      setUsers(userList);

      // 2. Load real training sessions
      const localSessions = await getLocalSessions();
      setSessions(localSessions);

      // 3. Load real sync queue count
      const queue = await getSyncQueue();
      setSyncQueueCount(queue.length);

      // 4. Load real campaigns count
      const campaignKeys = await adCampaignsStore.keys();
      setCampaignsCount(campaignKeys.length);

      // 5. Load real subscription audit logs (purging any legacy dummy entries)
      const auditLogs = await getLocalSetting<any[]>("sub_audit_logs", []);
      const cleanAuditLogs = auditLogs.filter((l) => l.id !== "LOG-1" && l.id !== "LOG-2");

      // 6. Build authentic activity timeline
      const activities: RealActivityItem[] = [];

      // Add real training sessions
      localSessions.slice(0, 15).forEach((s) => {
        const ts = s.timestamp || (s.date ? new Date(s.date).getTime() : 0);
        const arrowsCount = s.totalArrows || s.arrows?.length || s.arrowScores?.length || 0;
        const score = s.totalScore ?? s.score ?? 0;
        activities.push({
          id: `session-${s.id || ts}`,
          user: s.archerName || s.athleteName || s.userName || "Arquero",
          action: "completó sesión de entrenamiento",
          detail: `${arrowsCount} flechas${s.distance ? ` a ${s.distance}m` : ""}${s.bowType ? ` (${s.bowType})` : ""} • ${score} pts`,
          timeAgo: formatTimeAgo(ts),
          timestamp: ts,
          icon: Activity,
          iconColor: "text-cyan-neon"
        });
      });

      // Add real user registrations
      userList.forEach((u) => {
        const ts = u.createdAt || 0;
        if (ts > 0) {
          const roleLabel =
            u.role === "team_admin_coach"
              ? "Coach y Administrador"
              : u.role === "coach"
              ? "Coach"
              : u.role === "superadmin"
              ? "SuperAdmin"
              : "Arquero";
          activities.push({
            id: `user-${u.uid}`,
            user: u.fullName || u.email || "Usuario",
            action: "se registró en la plataforma",
            detail: `${roleLabel} • Arco: ${u.bowConfig?.type || "Sin definir"}${u.country ? ` • ${u.country}` : ""}`,
            timeAgo: formatTimeAgo(ts),
            timestamp: ts,
            icon: Users,
            iconColor: "text-green-400"
          });
        }
      });

      // Add real subscription logs
      cleanAuditLogs.forEach((l) => {
        const ts = l.timestamp ? new Date(l.timestamp).getTime() : 0;
        activities.push({
          id: `sub-${l.id}`,
          user: l.userName || "Usuario",
          action: `cambió plan a ${l.newPlan}`,
          detail: l.reason || "Actualización de suscripción",
          timeAgo: formatTimeAgo(ts),
          timestamp: ts,
          icon: CreditCard,
          iconColor: "text-yellow-gold"
        });
      });

      // Sort by newest first
      activities.sort((a, b) => b.timestamp - a.timestamp);
      setRecentActivities(activities.slice(0, 10));
    } catch (err) {
      console.error("Error loading real admin dashboard data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRealData();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleDbChange = (e: any) => {
      if (!e.detail || e.detail.store === "simulated_users" || e.detail.store === "sessions_local") {
        loadRealData();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("local-db-change", handleDbChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [loadRealData]);

  // Helper to compute exact age from birthDate
  const calculateAge = (birthDate?: string): number | null => {
    if (!birthDate) return null;
    const parts = birthDate.split("-");
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    const today = new Date();
    let age = today.getFullYear() - year;
    const m = today.getMonth() - month;
    if (m < 0 || (m === 0 && today.getDate() < day)) {
      age--;
    }
    return age >= 0 && age <= 115 ? age : null;
  };

  // Compute demographic & commercial intelligence metrics
  const totalUsersCount = Math.max(users.length, 1);

  // 1. Gender breakdown
  const maleCount = users.filter((u) => u.gender === "M").length;
  const femaleCount = users.filter((u) => u.gender === "F").length;
  const otherGenderCount = users.filter((u) => u.gender && u.gender !== "M" && u.gender !== "F").length;

  // 2. Age & WA Category breakdown
  const validAges: number[] = [];
  let catU18 = 0;
  let catU21 = 0;
  let catSenior = 0;
  let catMaster = 0;

  users.forEach((u) => {
    const age = calculateAge(u.birthDate);
    if (age !== null) {
      validAges.push(age);
      if (age < 18) catU18++;
      else if (age < 21) catU21++;
      else if (age < 50) catSenior++;
      else catMaster++;
    }
  });

  const avgAge =
    validAges.length > 0
      ? Math.round(validAges.reduce((acc, a) => acc + a, 0) / validAges.length)
      : 0;
  const totalAgesCount = Math.max(validAges.length, 1);

  // 3. Top Countries & Cities
  const countryMap = new Map<string, number>();
  const cityMap = new Map<string, { city: string; countryCode: string; count: number }>();

  users.forEach((u) => {
    const cCode = (u.country || "CR").toUpperCase();
    countryMap.set(cCode, (countryMap.get(cCode) || 0) + 1);

    const cleanCity = (u.city || "").trim();
    if (cleanCity) {
      const cityKey = `${cleanCity.toLowerCase()}_${cCode}`;
      const existing = cityMap.get(cityKey);
      if (existing) {
        existing.count += 1;
      } else {
        cityMap.set(cityKey, { city: cleanCity, countryCode: cCode, count: 1 });
      }
    }
  });

  const topCountries = Array.from(countryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topCities = Array.from(cityMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 4. Bow Type & Brand Market Share
  const recurveCount = users.filter((u) => u.bowConfig?.type === "Recurve").length;
  const compoundCount = users.filter((u) => u.bowConfig?.type === "Compound").length;
  const barebowCount = users.filter((u) => !u.bowConfig?.type || u.bowConfig?.type === "Barebow").length;

  const brandMap = new Map<string, number>();
  users.forEach((u) => {
    const brand = (u.bowConfig?.brand || "").trim();
    if (brand) {
      const key = brand.charAt(0).toUpperCase() + brand.slice(1);
      brandMap.set(key, (brandMap.get(key) || 0) + 1);
    }
  });
  const topBrands = Array.from(brandMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Compute metrics from real state
  const now = Date.now();
  const recentActiveUsers = users.filter((u) => {
    const ts = u.lastActiveAt || u.createdAt;
    if (!ts) return false;
    return now - ts <= 48 * 3600 * 1000;
  });

  const proUsers = users.filter((u) => u.plan === "PRO");

  const kpis = [
    {
      title: "Arqueros Registrados",
      value: users.length.toString(),
      subtitle: users.length === 1 ? "1 cuenta en la base de datos" : `${users.length} cuentas en la base de datos`,
      icon: Users,
      colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-[0_0_15px_rgba(0,191,255,0.1)]",
      textColor: "text-cyan-neon"
    },
    {
      title: "Activos Recientes",
      value: recentActiveUsers.length.toString(),
      subtitle: recentActiveUsers.length === 0 ? "Sin actividad en 48h" : "Actividad en últimas 48 horas",
      icon: UserCheck,
      colorClass: "text-green-500 bg-green-500/10 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]",
      textColor: "text-green-400"
    },
    {
      title: "Cuentas PRO",
      value: proUsers.length.toString(),
      subtitle: `${proUsers.length} de ${users.length} usuarios con plan PRO`,
      icon: CreditCard,
      colorClass: "text-yellow-gold bg-yellow-gold/10 border-yellow-gold/20 shadow-[0_0_15px_rgba(255,229,0,0.1)]",
      textColor: "text-yellow-400"
    },
    {
      title: "Sesiones de Tiro",
      value: sessions.length.toString(),
      subtitle: sessions.length === 1 ? "1 entrenamiento guardado" : `${sessions.length} entrenamientos guardados`,
      icon: Target,
      colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]",
      textColor: "text-cyan-neon"
    }
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 25 } }
  };

  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-col gap-6 w-full p-4 md:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider">Dashboard de Administración</h2>
          <p className="text-xs text-white">Métricas y registros reales calculados desde la base de datos.</p>
        </div>
        <button
          onClick={loadRealData}
          disabled={isLoading}
          className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white hover:text-white hover:bg-white/10 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin text-cyan-neon" : ""} />
          <span>{isLoading ? "Actualizando..." : "Actualizar Datos"}</span>
        </button>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={idx}
              variants={item}
              className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden group hover:border-white/20 transition-all duration-300 shadow-xl"
            >
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              
              <div className="flex justify-between items-start mb-4">
                <span className="text-[11.6px] md:text-xs font-bold text-white uppercase tracking-widest">{kpi.title}</span>
                <div className={`p-2 rounded-xl border flex items-center justify-center ${kpi.colorClass}`}>
                  <Icon size={18} />
                </div>
              </div>

              <div>
                <h3 className={`text-2xl md:text-3xl font-black tracking-tight ${kpi.textColor}`}>
                  {kpi.value}
                </h3>
                <span className="text-[10.5px] md:text-xs text-white font-medium block mt-1">{kpi.subtitle}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Demographic & Commercial Intelligence Section */}
      <div className="flex flex-col gap-3 mt-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-cyan-neon uppercase tracking-wider flex items-center gap-2">
            <PieChart size={16} />
            <span>Estadística Demográfica e Inteligencia Comercial</span>
          </h3>
          <span className="text-[11px] font-bold text-white/70">
            Datos en vivo ({users.length} suscriptores)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          {/* Card 1: Age & WA Categories */}
          <motion.div
            variants={item}
            className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-black text-white uppercase tracking-wider">Edad y Categoría WA</span>
              <span className="text-xs font-black text-yellow-gold bg-yellow-gold/10 border border-yellow-gold/20 px-2 py-0.5 rounded-full">
                Prom: {avgAge > 0 ? `${avgAge} años` : "N/D"}
              </span>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              {[
                { label: "Sub-18 (<18)", count: catU18, color: "bg-cyan-neon" },
                { label: "Sub-21 (18-20)", count: catU21, color: "bg-emerald-400" },
                { label: "Mayor (21-49)", count: catSenior, color: "bg-yellow-gold" },
                { label: "Master (50+)", count: catMaster, color: "bg-red-rival" }
              ].map((cat) => {
                const pct = validAges.length > 0 ? Math.round((cat.count / totalAgesCount) * 100) : 0;
                return (
                  <div key={cat.label} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white font-semibold">{cat.label}</span>
                      <span className="text-white font-bold tabular-nums">
                        {cat.count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full ${cat.color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Card 2: Gender Breakdown */}
          <motion.div
            variants={item}
            className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-black text-white uppercase tracking-wider">Distribución por Género</span>
              <Users size={14} className="text-cyan-neon" />
            </div>

            <div className="flex flex-col gap-2.5 text-xs my-auto">
              {[
                { label: "Masculino (M)", count: maleCount, color: "bg-cyan-neon" },
                { label: "Femenino (F)", count: femaleCount, color: "bg-pink-500" },
                { label: "Otro (O)", count: otherGenderCount, color: "bg-purple-400" }
              ].map((g) => {
                const pct = users.length > 0 ? Math.round((g.count / totalUsersCount) * 100) : 0;
                return (
                  <div key={g.label} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white font-semibold">{g.label}</span>
                      <span className="text-white font-bold tabular-nums">
                        {g.count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full ${g.color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Card 3: Top Countries & Cities */}
          <motion.div
            variants={item}
            className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-black text-white uppercase tracking-wider">Top Países y Ciudades</span>
              <Globe2 size={14} className="text-cyan-neon" />
            </div>

            <div className="flex flex-col gap-1.5 text-[11px]">
              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-neon">Países Principales</span>
              {topCountries.length === 0 ? (
                <span className="text-white/60">Sin datos</span>
              ) : (
                topCountries.slice(0, 3).map(([code, count]) => {
                  const cInfo = COUNTRIES[code] || { flag: "🌐", name: code };
                  const pct = Math.round((count / totalUsersCount) * 100);
                  return (
                    <div key={code} className="flex items-center justify-between">
                      <span className="text-white font-medium truncate">
                        {cInfo.flag} {cInfo.name}
                      </span>
                      <span className="text-white font-bold tabular-nums">
                        {count} ({pct}%)
                      </span>
                    </div>
                  );
                })
              )}

              <span className="text-[10px] font-black uppercase tracking-wider text-yellow-gold mt-1.5 flex items-center gap-1">
                <MapPin size={10} />
                <span>Ciudades Principales</span>
              </span>
              {topCities.length === 0 ? (
                <span className="text-white/60">Sin ciudades registradas</span>
              ) : (
                topCities.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-white font-medium truncate">
                      {item.city} ({item.countryCode})
                    </span>
                    <span className="text-yellow-gold font-bold tabular-nums">{item.count}</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* Card 4: Bow Market Share & Top Brands */}
          <motion.div
            variants={item}
            className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-black text-white uppercase tracking-wider">Arcos y Marcas</span>
              <Award size={14} className="text-yellow-gold" />
            </div>

            <div className="flex flex-col gap-1.5 text-[11px]">
              {[
                { label: "Recurvo", count: recurveCount, color: "text-cyan-neon" },
                { label: "Compuesto", count: compoundCount, color: "text-yellow-gold" },
                { label: "Barebow / Raso", count: barebowCount, color: "text-emerald-400" }
              ].map((b) => {
                const pct = users.length > 0 ? Math.round((b.count / totalUsersCount) * 100) : 0;
                return (
                  <div key={b.label} className="flex items-center justify-between">
                    <span className="text-white font-medium">{b.label}</span>
                    <span className={`font-bold tabular-nums ${b.color}`}>
                      {b.count} ({pct}%)
                    </span>
                  </div>
                );
              })}

              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-neon mt-1.5">
                Top Marcas Registradas
              </span>
              {topBrands.length === 0 ? (
                <span className="text-white/60">Sin marcas registradas</span>
              ) : (
                topBrands.slice(0, 3).map(([brand, count]) => (
                  <div key={brand} className="flex items-center justify-between">
                    <span className="text-white font-medium truncate">{brand}</span>
                    <span className="text-white font-bold tabular-nums">{count} arq.</span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Main Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full mt-2">
        {/* Real Activity Timeline */}
        <motion.div
          variants={item}
          className="lg:col-span-2 bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4"
        >
          <div className="flex justify-between items-center border-b border-white/5 pb-3">
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-cyan-neon" />
              <span>Actividad Registrada en Base de Datos</span>
            </h3>
            <span className="text-[11.6px] font-bold text-white">
              {recentActivities.length} {recentActivities.length === 1 ? "evento" : "eventos"}
            </span>
          </div>

          <div className="flex flex-col gap-4 mt-2">
            {recentActivities.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
                <Database size={32} className="text-white" />
                <p className="text-xs text-white font-medium">No hay registros de actividad aún en la base de datos.</p>
                <p className="text-[11.6px] text-white">A medida que los arqueros completen entrenamientos o se registren, aparecerán aquí.</p>
              </div>
            ) : (
              recentActivities.map((act, index) => {
                const ActIcon = act.icon;
                return (
                  <div key={act.id} className="flex gap-4 relative">
                    {index !== recentActivities.length - 1 && (
                      <div className="absolute left-[18px] top-9 bottom-[-16px] w-[1px] bg-white/5" />
                    )}

                    <div className={`w-9 h-9 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center flex-shrink-0 ${act.iconColor}`}>
                      <ActIcon size={16} />
                    </div>

                    <div className="flex-1 flex flex-col justify-center min-w-0">
                      <p className="text-xs text-white leading-relaxed font-medium">
                        <span className="font-bold text-white">{act.user}</span> {act.action}
                      </p>
                      <span className="text-[11.6px] text-cyan-neon font-bold mt-0.5 truncate">{act.detail}</span>
                    </div>

                    <div className="text-[10.5px] text-white font-semibold self-start whitespace-nowrap pt-1">
                      {act.timeAgo}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>

        {/* Real System & Sync Status */}
        <motion.div
          variants={item}
          className="bg-neutral-900/40 backdrop-blur-md border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4"
        >
          <h3 className="text-sm font-black text-white uppercase tracking-wider border-b border-white/5 pb-3">
            Estado de Sincronización
          </h3>

          <div className="flex flex-col gap-4 mt-2">
            <div className="bg-neutral-950/60 rounded-2xl p-4 border border-white/5">
              <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Conexión</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white font-bold">Estado de Red</span>
                <span className={`text-[11.6px] px-2 py-0.5 rounded-full font-black border ${
                  isOnline 
                    ? "text-green-400 bg-green-500/10 border-green-500/20" 
                    : "text-yellow-gold bg-amber-500/10 border-amber-500/20"
                }`}>
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2.5">
                <span className="text-xs text-white font-bold">Modo Offline-First</span>
                <span className="text-[11.6px] text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-full font-black border border-cyan-neon/20">ACTIVO</span>
              </div>
            </div>

            <div className="bg-neutral-950/60 rounded-2xl p-4 border border-white/5 flex flex-col gap-1">
              <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Almacenamiento Local (IndexedDB)</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white font-medium">Sesiones Guardadas</span>
                <span className="text-xs text-white font-bold">{sessions.length}</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white font-medium">Cola de Sincronización</span>
                <span className={`text-xs font-bold ${syncQueueCount > 0 ? "text-yellow-gold" : "text-green-400"}`}>
                  {syncQueueCount} {syncQueueCount === 1 ? "Item" : "Items"}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white font-medium">Campañas de Anuncios</span>
                <span className="text-xs text-white font-bold">{campaignsCount}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
