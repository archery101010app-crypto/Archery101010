"use client";

import React from "react";
import { UserProfile } from "@/lib/authService";
import { Trophy, Swords } from "lucide-react";

interface CoachDuelsTabProps {
  athletes: UserProfile[];
  sessions: any[];
  activeDuels?: any[];
}

export default function CoachDuelsTab({ athletes, sessions, activeDuels = [] }: CoachDuelsTabProps) {
  const completedDuels = (sessions || []).filter(
    (s) => s.isDuel && !s.isDraft && s.deletedByArcher !== true
  );

  const liveDraftDuels = (sessions || []).filter(
    (s) => s.isDuel && s.isDraft && s.deletedByArcher !== true
  );

  const liveArenaMatches = [
    ...activeDuels.filter((d) => d && (d.status === "active" || d.status === "waiting")),
    ...liveDraftDuels
      .filter((sd) => !activeDuels.some((ad) => ad.id === sd.duelRoomId || ad.id === sd.id))
      .map((sd) => ({
        id: sd.id,
        creatorUid: sd.userId || sd.userUid,
        creatorName: sd.userName || "Arquero",
        playerName: sd.opponent || "Rival",
        bowType: sd.bowType,
        distance: sd.distance,
        status: "active",
        updatedAt: sd.updatedAt || sd.timestamp
      }))
  ];

  // Group stats by athlete
  const getDuelsStandings = () => {
    const standings: Record<string, { userName: string; wins: number; losses: number; ties: number; total: number }> = {};

    // Initialize for all roster
    athletes.forEach((ath) => {
      standings[ath.uid] = {
        userName: ath.fullName,
        wins: 0,
        losses: 0,
        ties: 0,
        total: 0
      };
    });

    // Populate from completed duels
    completedDuels.forEach((d) => {
      const uid = d.userId || d.userUid;
      if (!uid) return;
      if (!standings[uid]) {
        standings[uid] = {
          userName: d.userName || "Arquero",
          wins: 0,
          losses: 0,
          ties: 0,
          total: 0
        };
      }
      standings[uid].total++;
      if (d.outcome === "win") standings[uid].wins++;
      else if (d.outcome === "loss") standings[uid].losses++;
      else if (d.outcome === "tie") standings[uid].ties++;
    });

    return Object.values(standings)
      .sort((a, b) => b.wins - a.wins || (b.wins / (b.total || 1)) - (a.wins / (a.total || 1)));
  };

  const standings = getDuelsStandings();

  const formatBowEs = (bow?: string) => {
    if (!bow || bow === "Recurve") return "Recurvo";
    if (bow === "Compound") return "Compuesto";
    return bow;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Arena en Vivo (active_duels en tiempo real) */}
      {liveArenaMatches.length > 0 && (
        <div className="bg-[#0B0E14] p-4 rounded-3xl border border-emerald-500/30 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Swords size={14} className="text-emerald-400" />
              <span>Arena de Duelos en Vivo</span>
            </h4>
            <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider tabular-nums">
              ● {liveArenaMatches.length} EN CURSO
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {liveArenaMatches.map((match) => {
              const isWaiting = match.status === "waiting";
              const currentSetNum =
                typeof match.currentSetIndex === "number" ? match.currentSetIndex + 1 : null;
              return (
                <div
                  key={match.id}
                  className="bg-[#06080C] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-2"
                >
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-xs font-black truncate">
                        {match.creatorName || "Arquero"}
                      </span>
                      <span className="text-[10px] text-white/60 font-bold uppercase">vs</span>
                      <span className="text-cyan-neon text-xs font-black truncate">
                        {match.playerName || "Esperando rival..."}
                      </span>
                    </div>
                    <span className="text-[10.5px] text-white/80 tabular-nums">
                      {formatBowEs(match.bowType)}
                      {match.distance ? ` · ${match.distance}m` : ""}
                      {currentSetNum ? ` · Set ${currentSetNum}` : ""}
                    </span>
                  </div>

                  <span
                    className={`shrink-0 text-[9.5px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                      isWaiting
                        ? "bg-yellow-gold/15 border-yellow-gold/35 text-yellow-gold"
                        : "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                    }`}
                  >
                    {isWaiting ? "ESPERANDO" : "● EN VIVO"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla de Clasificación de Duelos (Standings) */}
      <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <Trophy size={14} className="text-cyan-neon" />
          Tabla de Rendimiento en Duelos
        </h4>

        <div className="flex flex-col gap-2 mt-1">
          {standings.length === 0 ? (
            <p className="text-xs text-white/75 text-center py-4">
              Aún no hay atletas vinculados en la tabla de duelos.
            </p>
          ) : (
            standings.map((st, idx) => {
              const winRate = st.total > 0 ? Math.round((st.wins / st.total) * 100) : 0;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/40 border border-white/[0.04]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11.6px] text-white font-bold w-5 shrink-0 tabular-nums">#{idx + 1}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="text-white text-xs font-bold leading-none truncate">{st.userName || "Arquero"}</span>
                      <span className="text-[9.5px] text-white mt-1 tabular-nums">
                        {st.wins}V - {st.losses}D - {st.ties}E · Total: {st.total}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0 pl-2">
                    <span className="text-xs font-black text-cyan-neon tabular-nums">{winRate}%</span>
                    <span className="text-[9.3px] text-white uppercase">Efectividad</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Historial general de duelos */}
      <div className="flex flex-col gap-2.5">
        <span className="text-[11.6px] text-white font-black uppercase tracking-wider">Historial de la Arena</span>

        {completedDuels.length === 0 ? (
          <p className="text-[12.8px] text-white text-center py-6 bg-neutral-900/20 border border-white/5 rounded-2xl">
            No se han registrado duelos finalizados en la arena aún.
          </p>
        ) : (
          completedDuels.map((duel) => {
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
                  <span className="text-[10.5px] text-white truncate tabular-nums">
                    vs <span className="text-cyan-neon font-extrabold">{duel.opponent || "Rival"}</span>{duel.distance ? ` · ${duel.distance}m` : ""} · {dateStr}
                  </span>
                </div>

                <span className={`shrink-0 text-[10.5px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                  duel.outcome === "win"
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/25"
                    : duel.outcome === "loss"
                    ? "bg-white text-black border border-white"
                    : "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/25"
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
