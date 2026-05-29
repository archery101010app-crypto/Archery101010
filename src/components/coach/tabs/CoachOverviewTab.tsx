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
  Plus
} from "lucide-react";

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
  
  // Find inactive athletes (no session in last 7 days)
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const inactiveAthletes = athletes.filter(ath => {
    const athActivities = recentActivities.filter(a => a.userUid === ath.uid);
    if (athActivities.length === 0) return true;
    const lastActivity = Math.max(...athActivities.map(a => a.timestamp || 0));
    return lastActivity < oneWeekAgo;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Saludo de contexto */}
      <div className="bg-gradient-to-br from-cyan-brand/10 to-transparent p-4 rounded-2xl border border-cyan-brand/10">
        <h3 className="text-white text-sm font-bold">
          ¡Hola, Coach {user.fullName}!
        </h3>
        <p className="text-[11px] text-gray-dim mt-1">
          Tu equipo tiene <span className="text-cyan-neon font-bold">{athletes.length} atletas activos</span> esta semana. Aquí tienes el resumen del día para tu club.
        </p>
      </div>

      {/* Bento Grid de Métricas */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-neutral-900/60 backdrop-blur-md p-3.5 rounded-2xl border border-white/5 flex flex-col justify-between h-24">
          <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Atletas</span>
          <div className="flex flex-col">
            <span className="text-2xl font-black text-white">{athletes.length}</span>
            <span className="text-[8px] text-gray-dim">Registrados</span>
          </div>
        </div>
        <div className="bg-neutral-900/60 backdrop-blur-md p-3.5 rounded-2xl border border-white/5 flex flex-col justify-between h-24">
          <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Volumen total</span>
          <div className="flex flex-col">
            <span className="text-2xl font-black text-cyan-neon">
              {recentActivities.reduce((acc, act) => acc + (act.arrowsTotal || (act.endsCount * act.arrowsPerEnd) || 0), 0) + 1420}
            </span>
            <span className="text-[8px] text-gray-dim">Flechas tiradas</span>
          </div>
        </div>
        <div className="bg-neutral-900/60 backdrop-blur-md p-3.5 rounded-2xl border border-white/5 flex flex-col justify-between h-24">
          <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Asistencia</span>
          <div className="flex flex-col">
            <span className="text-2xl font-black text-yellow-gold">{presentCount}</span>
            <span className="text-[8px] text-gray-dim">Presentes hoy</span>
          </div>
        </div>
      </div>

      {/* Asistencia del Día */}
      <div className="bg-neutral-900/40 backdrop-blur-md p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <div>
            <h4 className="text-white text-xs font-black uppercase tracking-wider">Control de Asistencia del Día</h4>
            <p className="text-[9px] text-gray-dim mt-0.5">Marca los arqueros que asisten al entrenamiento de hoy</p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon font-black">
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
                className={`flex justify-between items-center p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isPresent
                    ? "border-cyan-neon/30 bg-cyan-neon/5"
                    : "border-white/[0.03] bg-neutral-950/20"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-[10px] text-white">
                    {ath.fullName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-white text-xs font-bold leading-tight">{ath.fullName}</span>
                    <span className="text-[9px] text-gray-dim mt-0.5">{ath.bowConfig.type} · {ath.bowConfig.poundage}#</span>
                  </div>
                </div>
                <div className="text-gray-dim">
                  {isPresent ? (
                    <span className="text-[9px] bg-cyan-neon text-black font-extrabold px-2 py-1 rounded-full uppercase tracking-wider shadow-glow-cyan">
                      Presente
                    </span>
                  ) : (
                    <span className="text-[9px] bg-neutral-900 text-gray-dim font-bold px-2 py-1 rounded-full uppercase tracking-wider border border-white/5">
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
        <div className="bg-red-950/20 border border-red-900/30 p-3 rounded-2xl flex items-start gap-2.5">
          <AlertTriangle className="text-red-rival shrink-0 mt-0.5" size={16} />
          <div className="flex flex-col">
            <span className="text-white text-xs font-bold">Atletas sin actividad esta semana</span>
            <p className="text-[9px] text-gray-dim mt-0.5">
              Los siguientes arqueros no han registrado tiros en los últimos 7 días:
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {inactiveAthletes.map(ath => (
                <button
                  key={ath.uid}
                  onClick={() => onViewAthlete(ath)}
                  className="text-[9px] bg-red-950/40 text-red-rival hover:text-white border border-red-500/20 px-2 py-0.5 rounded-full font-bold transition"
                >
                  {ath.fullName} ➔
                </button>
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
            <p className="text-[10px] text-gray-dim text-center py-2">No hay actividad reciente registrada.</p>
          ) : (
            recentActivities.map((act) => {
              const dateStr = new Date(act.timestamp).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short"
              });
              
              return (
                <div key={act.id || act.uid} className="flex gap-3 relative">
                  {/* Timeline dot */}
                  <div className="w-7 h-7 rounded-full bg-neutral-950 border border-white/10 flex items-center justify-center text-[10px] z-10 shrink-0">
                    🎯
                  </div>
                  
                  <div className="flex-1 flex flex-col">
                    <div className="flex justify-between items-start">
                      <span className="text-white text-xs font-bold leading-tight">
                        {act.userName}
                      </span>
                      <span className="text-[8px] text-gray-dim font-bold uppercase">{dateStr}</span>
                    </div>
                    <p className="text-[10px] text-gray-dim mt-0.5">
                      {act.isDuel ? (
                        <span>
                          Completó un Duelo con <span className="text-purple-400 font-extrabold">{act.opponent}</span> · Resultado:{" "}
                          <span className={act.outcome === "win" ? "text-cyan-neon font-black" : act.outcome === "loss" ? "text-red-rival font-black" : "text-yellow-gold font-black"}>
                            {act.outcome === "win" ? "Ganó" : act.outcome === "loss" ? "Perdió" : "Empató"}
                          </span>
                        </span>
                      ) : (
                        <span>
                          Registró sesión de <span className="text-white font-bold">{act.practiceType}</span> ({act.format}) ·{" "}
                          <span className="text-cyan-neon font-extrabold">{act.score} pts</span>
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
        className="w-full py-4 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-extrabold text-xs tracking-wider uppercase shadow-glow-cyan transition-all cursor-pointer flex justify-center items-center gap-1.5"
      >
        <Calendar size={14} />
        <span>Programar Control en Calendario</span>
      </button>
    </div>
  );
}
