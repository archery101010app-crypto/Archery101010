"use client";

import React from "react";
import { UserProfile } from "@/lib/authService";
import { motion } from "framer-motion";
import { 
  Users, 
  Activity, 
  CheckSquare, 
  Calendar, 
  AlertTriangle,
  ArrowRight,
  Plus,
  Target
} from "lucide-react";
import { isVolumeSession, getSessionArrows, getSessionScore, countScoredArrows } from "@/lib/scoring/sessionMetrics";

interface CoachOverviewTabProps {
  user: UserProfile;
  athletes: UserProfile[];
  attendance: Record<string, boolean>;
  onToggleAttendance: (uid: string) => void;
  recentActivities: any[];
  onViewAthlete: (athlete: UserProfile) => void;
  onNavigate: (screen: string) => void;
}

export default function CoachOverviewTab({
  user,
  athletes,
  attendance,
  onToggleAttendance,
  recentActivities,
  onViewAthlete,
  onNavigate
}: CoachOverviewTabProps) {
  const presentCount = Object.values(attendance).filter(Boolean).length;

  const getSafeActivityArrows = (act: any): number => {
    if (act?.isDraft) {
      return Math.max(
        Number(act.totalArrowsVolume) || 0,
        countScoredArrows(act) + (Number(act.warmupArrows) || 0)
      );
    }
    return getSessionArrows(act);
  };
  
  // Find inactive athletes (no session in last 7 days)
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const inactiveAthletes = athletes.filter(ath => {
    const athActivities = recentActivities.filter(a => a.userId === ath.uid || a.userUid === ath.uid);
    if (athActivities.length === 0) return true;
    const lastActivity = Math.max(...athActivities.map(a => a.updatedAt || a.timestamp || 0));
    return lastActivity < oneWeekAgo;
  });

  const formatBowTypeEs = (type?: string) => {
    if (!type || type === "Recurve") return "Recurvo";
    if (type === "Compound") return "Compuesto";
    return type;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Saludo de contexto */}
      <div className="bg-[#0D0F12] p-4 rounded-2xl border border-white/[0.08]">
        <h3 className="text-white text-sm font-bold">
          ¡Hola, Coach {user.fullName}!
        </h3>
        <p className="text-[12.8px] text-white mt-1">
          Tu equipo tiene <span className="text-cyan-neon font-bold tabular-nums">{athletes.length} atletas activos</span> esta semana. Aquí tienes el resumen del día para tus alumnos.
        </p>
      </div>

      {/* Bento Grid de Métricas */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <div className="bg-neutral-900/60 backdrop-blur-md p-3 rounded-2xl border border-white/5 flex flex-col justify-between h-24 min-w-0">
          <span className="text-[10.5px] text-white font-black uppercase tracking-wider truncate">Atletas</span>
          <div className="flex flex-col min-w-0">
            <span className="text-2xl font-black text-white truncate tabular-nums">{athletes.length}</span>
            <span className="text-[9.3px] text-white truncate">Registrados</span>
          </div>
        </div>
        <div className="bg-neutral-900/60 backdrop-blur-md p-3 rounded-2xl border border-white/5 flex flex-col justify-between h-24 min-w-0">
          <span className="text-[10.5px] text-white font-black uppercase tracking-wider truncate">Volumen total</span>
          <div className="flex flex-col min-w-0">
            <span className="text-2xl font-black text-cyan-neon truncate tabular-nums">
              {recentActivities.reduce((acc, act) => acc + getSafeActivityArrows(act), 0)}
            </span>
            <span className="text-[9.3px] text-white truncate">Flechas tiradas</span>
          </div>
        </div>
        <div className="bg-neutral-900/60 backdrop-blur-md p-3 rounded-2xl border border-white/5 flex flex-col justify-between h-24 min-w-0">
          <span className="text-[10.5px] text-white font-black uppercase tracking-wider truncate">Asistencia</span>
          <div className="flex flex-col min-w-0">
            <span className="text-2xl font-black text-yellow-gold truncate tabular-nums">{presentCount}</span>
            <span className="text-[9.3px] text-white truncate">Presentes hoy</span>
          </div>
        </div>
      </div>

      {/* Asistencia del Día */}
      <div className="bg-neutral-900/40 backdrop-blur-md p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2">
          <div className="min-w-0">
            <h4 className="text-white text-xs font-black uppercase tracking-wider">Control de Asistencia del Día</h4>
            <p className="text-[10.5px] text-white mt-0.5">Marca los arqueros que asisten al entrenamiento de hoy</p>
          </div>
          <span className="text-[11.6px] px-2.5 py-0.5 rounded-full bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon font-black shrink-0 whitespace-nowrap tabular-nums">
            {presentCount} / {athletes.length}
          </span>
        </div>

        <div className="flex flex-col gap-2 mt-1">
          {athletes.map((ath) => {
            const isPresent = !!attendance[ath.uid];
            return (
              <div
                key={ath.uid}
                onClick={() => onToggleAttendance(ath.uid)}
                className={`flex justify-between items-center gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isPresent
                    ? "border-cyan-neon/30 bg-cyan-neon/5"
                    : "border-white/[0.03] bg-neutral-950/20"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-[11.6px] text-white shrink-0">
                    {ath.fullName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-white text-xs font-bold leading-tight truncate">{ath.fullName}</span>
                    <span className="text-[10.5px] text-white mt-0.5 truncate tabular-nums">{formatBowTypeEs(ath.bowConfig?.type)} · {ath.bowConfig?.poundage ? `${ath.bowConfig.poundage}#` : "—"}</span>
                  </div>
                </div>
                <div className="text-white shrink-0">
                  {isPresent ? (
                    <span className="text-[10.5px] bg-cyan-neon text-black font-extrabold px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                      Presente
                    </span>
                  ) : (
                    <span className="text-[10.5px] bg-neutral-900 text-white font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-white/5 whitespace-nowrap">
                      Ausente
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inactividad Alertas */}
      {inactiveAthletes.length > 0 && (
        <div className="bg-neutral-900/50 border border-white/15 p-3 rounded-2xl flex items-start gap-2.5">
          <AlertTriangle className="text-white shrink-0 mt-0.5" size={16} />
          <div className="flex flex-col">
            <span className="text-white text-xs font-bold">Atletas sin actividad esta semana</span>
            <p className="text-[10.5px] text-white mt-0.5">
              Los siguientes arqueros no han registrado tiros en los últimos 7 días:
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {inactiveAthletes.map(ath => (
                <button
                  key={ath.uid}
                  onClick={() => onViewAthlete(ath)}
                  className="text-[10.5px] bg-white text-black hover:bg-neutral-200 border border-white px-2.5 py-0.5 rounded-full font-black transition cursor-pointer"
                >
                  {ath.fullName} → </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Feed de Actividad Reciente */}
      <div className="bg-neutral-900/40 backdrop-blur-md p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider">Actividad Reciente del Equipo</h4>
        
        <div className="flex flex-col gap-3 mt-1 relative before:absolute before:left-3.5 before:top-2.5 before:bottom-2.5 before:w-[1px] before:bg-white/10">
          {recentActivities.length === 0 ? (
            <p className="text-[11.6px] text-white text-center py-2">No hay actividad reciente registrada.</p>
          ) : (
            recentActivities.map((act) => {
              const actTime = act.updatedAt || act.timestamp || Date.now();
              const dateStr = new Date(actTime).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short"
              });
              const liveArrows = getSafeActivityArrows(act);
              
              return (
                <div key={act.id || act.uid} className="flex gap-3 relative">
                  {/* Timeline dot */}
                  <div
                    className={`w-7 h-7 rounded-full bg-[#0D0F12] border flex items-center justify-center z-10 shrink-0 ${
                      act.isDraft
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-white/10 text-cyan-neon"
                    }`}
                  >
                    <Target size={12} />
                  </div>
                  
                  <div className="flex-1 flex flex-col">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-white text-xs font-bold leading-tight truncate">
                          {act.userName || "Arquero"}
                        </span>
                        {act.isDraft && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider shrink-0">
                            ● EN VIVO
                          </span>
                        )}
                      </div>
                      <span className="text-[9.3px] text-white font-bold uppercase shrink-0">{dateStr}</span>
                    </div>
                    <p className="text-[11.6px] text-white mt-0.5 tabular-nums">
                      {act.isDraft ? (
                        <span>
                          Tirando sesión en vivo ({act.format || act.practiceType || "Práctica"}) ·{" "}
                          <span className="text-emerald-400 font-extrabold">
                            {getSessionScore(act) > 0 ? `${getSessionScore(act)} pts · ` : ""}
                            {liveArrows} flechas
                          </span>
                        </span>
                      ) : act.isDuel ? (
                        <span>
                          Completó un Duelo con <span className="text-cyan-neon font-extrabold">{act.opponent}</span> · Resultado:{" "}
                          <span className={act.outcome === "win" ? "text-cyan-neon font-black" : act.outcome === "loss" ? "text-red-rival font-black" : "text-yellow-gold font-black"}>
                            {act.outcome === "win" ? "Ganó" : act.outcome === "loss" ? "Perdió" : "Empató"}
                          </span>
                        </span>
                      ) : isVolumeSession(act) ? (
                        <span>
                          Registró sesión de <span className="text-white font-bold">Volumen</span> ·{" "}
                          <span className="text-cyan-neon font-extrabold">{liveArrows} flechas</span>
                        </span>
                      ) : (
                        <span>
                          Registró sesión de <span className="text-white font-bold">{act.practiceType}</span> ({act.format}) ·{" "}
                          <span className="text-cyan-neon font-extrabold">{getSessionScore(act)} pts</span>
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Programar Control Botón */}
      <button
        onClick={() => onNavigate("CALENDAR")}
        className="w-full py-4 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs tracking-wider uppercase transition-all cursor-pointer flex justify-center items-center gap-2"
      >
        <Calendar size={14} />
        <span>Programar Control en Calendario</span>
      </button>
    </div>
  );
}
