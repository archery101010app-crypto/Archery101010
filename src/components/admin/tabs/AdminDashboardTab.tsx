"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Users, UserCheck, CreditCard, Activity, Target, RefreshCw, Database } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, getLocalSessions, getSyncQueue, adCampaignsStore } from "@/lib/db/indexedDB";

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

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadRealData]);

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
      colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]",
      textColor: "text-purple-400"
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
          <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Dashboard de Administración</h2>
          <p className="text-xs text-white/50">Métricas y registros reales calculados desde la base de datos.</p>
        </div>
        <button
          onClick={loadRealData}
          disabled={isLoading}
          className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-xs font-bold transition disabled:opacity-50 cursor-pointer"
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
                <span className="text-[10px] md:text-xs font-bold text-white/60 uppercase tracking-widest">{kpi.title}</span>
                <div className={`p-2 rounded-xl border flex items-center justify-center ${kpi.colorClass}`}>
                  <Icon size={18} />
                </div>
              </div>

              <div>
                <h3 className={`text-2xl md:text-3xl font-black tracking-tight ${kpi.textColor}`}>
                  {kpi.value}
                </h3>
                <span className="text-[9px] md:text-xs text-white/40 font-medium block mt-1">{kpi.subtitle}</span>
              </div>
            </motion.div>
          );
        })}
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
            <span className="text-[10px] font-bold text-white/40">
              {recentActivities.length} {recentActivities.length === 1 ? "evento" : "eventos"}
            </span>
          </div>

          <div className="flex flex-col gap-4 mt-2">
            {recentActivities.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
                <Database size={32} className="text-white/20" />
                <p className="text-xs text-white/40 font-medium">No hay registros de actividad aún en la base de datos.</p>
                <p className="text-[10px] text-white/30">A medida que los arqueros completen entrenamientos o se registren, aparecerán aquí.</p>
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
                      <p className="text-xs text-white/80 leading-relaxed font-medium">
                        <span className="font-bold text-white">{act.user}</span> {act.action}
                      </p>
                      <span className="text-[10px] text-cyan-neon/80 font-bold mt-0.5 truncate">{act.detail}</span>
                    </div>

                    <div className="text-[9px] text-white/30 font-semibold self-start whitespace-nowrap pt-1">
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
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Conexión</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white/80 font-bold">Estado de Red</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black border ${
                  isOnline 
                    ? "text-green-400 bg-green-500/10 border-green-500/20" 
                    : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                }`}>
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2.5">
                <span className="text-xs text-white/80 font-bold">Modo Offline-First</span>
                <span className="text-[10px] text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-full font-black border border-cyan-neon/20">ACTIVO</span>
              </div>
            </div>

            <div className="bg-neutral-950/60 rounded-2xl p-4 border border-white/5 flex flex-col gap-1">
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Almacenamiento Local (IndexedDB)</span>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-white/80 font-medium">Sesiones Guardadas</span>
                <span className="text-xs text-white font-bold">{sessions.length}</span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white/80 font-medium">Cola de Sincronización</span>
                <span className={`text-xs font-bold ${syncQueueCount > 0 ? "text-amber-400" : "text-green-400"}`}>
                  {syncQueueCount} {syncQueueCount === 1 ? "Item" : "Items"}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1.5">
                <span className="text-xs text-white/80 font-medium">Campañas de Anuncios</span>
                <span className="text-xs text-white font-bold">{campaignsCount}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
