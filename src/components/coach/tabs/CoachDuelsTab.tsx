"use client";

import React from "react";
import { UserProfile } from "@/lib/authService";
import { Trophy, ShieldAlert, Award } from "lucide-react";

interface CoachDuelsTabProps {
  athletes: UserProfile[];
  sessions: any[];
}

export default function CoachDuelsTab({ athletes, sessions }: CoachDuelsTabProps) {
  const duels = (sessions || []).filter(s => s.isDuel);

  // Group stats by athlete
  const getDuelsStandings = () => {
    const standings: Record<string, { userName: string; wins: number; losses: number; ties: number; total: number }> = {};
    
    // Initialize for all roster
    athletes.forEach(ath => {
      standings[ath.uid] = {
        userName: ath.fullName,
        wins: 0,
        losses: 0,
        ties: 0,
        total: 0
      };
    });

    // Populate from duels
    duels.forEach(d => {
      const uid = d.userId || d.userUid;
      if (standings[uid]) {
        standings[uid].total++;
        if (d.outcome === "win") standings[uid].wins++;
        else if (d.outcome === "loss") standings[uid].losses++;
        else if (d.outcome === "tie") standings[uid].ties++;
      }
    });

    return Object.values(standings)
      .sort((a, b) => b.wins - a.wins || (b.wins / (b.total || 1)) - (a.wins / (a.total || 1)));
  };

  const standings = getDuelsStandings();

  return (
    <div className="flex flex-col gap-4">
      {/* Tabla de Clasificación de Duelos (Standings) */}
      <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <Trophy size={14} className="text-cyan-neon" />
          Tabla de Rendimiento en Duelos
        </h4>

        <div className="flex flex-col gap-2 mt-1">
          {standings.map((st, idx) => {
            const winRate = st.total > 0 ? Math.round((st.wins / st.total) * 100) : 0;
            return (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/40 border border-white/[0.02]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11.6px] text-white font-bold w-4 shrink-0">#{idx + 1}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-white text-xs font-bold leading-none truncate">{st.userName || "Arquero"}</span>
                    <span className="text-[9.3px] text-white mt-1">
                      {st.wins}V - {st.losses}D - {st.ties}E · Total: {st.total}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0 pl-2">
                  <span className="text-xs font-black text-cyan-neon">{winRate}%</span>
                  <span className="text-[9.3px] text-white uppercase">Efectividad</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historial general de duelos */}
      <div className="flex flex-col gap-2.5">
        <span className="text-[11.6px] text-white font-black uppercase tracking-wider">Historial de la Arena</span>

        {duels.length === 0 ? (
          <p className="text-[12.8px] text-white text-center py-6">No se han registrado duelos en la arena aún.</p>
        ) : (
          duels.map((duel) => {
            const duelDate = new Date(duel.timestamp);
            const dateStr = isNaN(duelDate.getTime())
              ? "—"
              : duelDate.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short"
                });
            return (
              <div
                key={duel.uid || duel.id}
                className="bg-neutral-900/40 p-3.5 rounded-2xl border border-white/5 flex justify-between items-center gap-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-white text-xs font-bold leading-tight truncate">
                    {duel.userName || "Arquero"}
                  </span>
                  <span className="text-[10.5px] text-white truncate">
                    vs <span className="text-cyan-neon font-extrabold">{duel.opponent || "Rival"}</span>{duel.distance ? ` · ${duel.distance}m` : ""} · {dateStr}
                  </span>
                </div>
                
                <span className={`shrink-0 text-[10.5px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                  duel.outcome === "win"
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/20 shadow-glow-cyan"
                    : duel.outcome === "loss"
                    ? "bg-red-rival/15 text-red-rival border border-red-rival/20"
                    : "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/20"
                }`}>
                  {duel.outcome === "win" ? "Victoria" : duel.outcome === "loss" ? "Derrota" : "Empate"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
