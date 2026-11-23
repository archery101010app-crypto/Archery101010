"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate } from "@/lib/i18n/regionalUtils";
import { Trophy, Swords } from "lucide-react";

interface CoachDuelsTabProps {
  athletes: UserProfile[];
  sessions: any[];
  activeDuels?: any[];
}

export default function CoachDuelsTab({
  athletes,
  sessions,
  activeDuels = []
}: CoachDuelsTabProps) {
  const { language, t, tx } = useLanguage();
  const [filterMode, setFilterMode] = useState<"ALL" | "LIVE" | "FINISHED">("ALL");

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
        creatorName: sd.userName || t("roleAthlete"),
        playerName: sd.opponent || tx("Rival", "Opponent"),
        bowType: sd.bowType,
        distance: sd.distance,
        status: "active",
        updatedAt: sd.updatedAt || sd.timestamp
      }))
  ];

  // Group stats by athlete
  const getDuelsStandings = () => {
    const standings: Record<
      string,
      { userName: string; wins: number; losses: number; ties: number; total: number }
    > = {};

    athletes.forEach((ath) => {
      standings[ath.uid] = {
        userName: ath.fullName,
        wins: 0,
        losses: 0,
        ties: 0,
        total: 0
      };
    });

    completedDuels.forEach((d) => {
      const uid = d.userId || d.userUid;
      if (!uid) return;
      if (!standings[uid]) {
        standings[uid] = {
          userName: d.userName || t("roleAthlete"),
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

    return Object.values(standings).sort(
      (a, b) => b.wins - a.wins || b.wins / (b.total || 1) - a.wins / (a.total || 1)
    );
  };

  const standings = getDuelsStandings();

  const formatBowLabel = (bow?: string) => {
    if (!bow || bow === "Recurve") return t("bowRecurve");
    if (bow === "Compound") return t("bowCompound");
    if (bow === "Barebow") return t("bowBarebow");
    return bow;
  };

  const showLiveSection =
    filterMode === "LIVE" || (filterMode === "ALL" && liveArenaMatches.length > 0);
  const showFinishedSection = filterMode === "ALL" || filterMode === "FINISHED";

  return (
    <div className="flex flex-col gap-4">
      {/* Compact Filter Pills: Todos | En Vivo | Finalizados */}
      <div className="grid grid-cols-3 gap-1.5 bg-[#0A0B0E] p-1 rounded-2xl border border-white/[0.08]">
        {[
          {
            id: "ALL",
            label: t("filterAll"),
            count: liveArenaMatches.length + completedDuels.length
          },
          { id: "LIVE", label: tx("En Vivo", "Live"), count: liveArenaMatches.length },
          { id: "FINISHED", label: tx("Finalizados", "Finished"), count: completedDuels.length }
        ].map((pill) => {
          const active = filterMode === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setFilterMode(pill.id as "ALL" | "LIVE" | "FINISHED")}
              className={`py-2 px-1 sm:px-1.5 rounded-xl text-[11.5px] sm:text-[12px] font-black uppercase tracking-[-0.02em] sm:tracking-wider transition flex items-center justify-center gap-0.5 sm:gap-1 cursor-pointer tabular-nums whitespace-nowrap ${
                active ? "bg-cyan-neon text-black" : "text-white hover:bg-white/[0.05]"
              }`}
            >
              <span>{pill.label}</span>
              <span className={`text-[11px] ${active ? "text-black/80" : "text-cyan-neon"}`}>
                ({pill.count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Arena en Vivo (active_duels en tiempo real) */}
      {showLiveSection && (
        <div className="bg-[#0B0E14] p-4 rounded-3xl border border-emerald-500/30 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0">
              <Swords size={14} className="text-emerald-400 shrink-0" />
              <span className="break-words leading-tight">
                {tx("Arena de Duelos en Vivo", "Live Duels Arena")}
              </span>
            </h4>
            <span className="shrink-0 whitespace-nowrap text-[9.5px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider tabular-nums">
              ● {liveArenaMatches.length} {tx("EN CURSO", "ACTIVE")}
            </span>
          </div>

          {liveArenaMatches.length === 0 ? (
            <p className="text-xs text-white text-center py-4 bg-neutral-950/50 border border-white/5 rounded-2xl">
              {tx("No hay duelos en vivo en este momento.", "No live duels right now.")}
            </p>
          ) : (
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
                    <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-white text-xs font-black min-w-0 break-words leading-tight">
                          {match.creatorName || t("roleAthlete")}
                        </span>
                        <span className="text-[10px] text-white/60 font-bold uppercase shrink-0">
                          vs
                        </span>
                        <span className="text-cyan-neon text-xs font-black min-w-0 break-words leading-tight">
                          {match.playerName || tx("Esperando rival...", "Waiting for opponent...")}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-white/80 tabular-nums break-words leading-tight">
                        {formatBowLabel(match.bowType)}
                        {match.distance ? ` · ${match.distance}m` : ""}
                        {currentSetNum ? ` · Set ${currentSetNum}` : ""}
                      </span>
                    </div>

                    <span
                      className={`shrink-0 whitespace-nowrap text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                        isWaiting
                          ? "bg-yellow-gold/15 border-yellow-gold/35 text-yellow-gold"
                          : "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                      }`}
                    >
                      {isWaiting ? tx("ESPERANDO", "WAITING") : `● ${tx("EN VIVO", "LIVE")}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showFinishedSection && (
        <>
          {/* Tabla de Clasificación de Duelos (Standings) */}
          <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/10 flex flex-col gap-3">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Trophy size={14} className="text-cyan-neon shrink-0" />
              <span>{tx("Tabla de Rendimiento en Duelos", "Duels Standings")}</span>
            </h4>

            <div className="flex flex-col gap-2 mt-1">
              {standings.length === 0 ? (
                <p className="text-xs text-white/75 text-center py-4">
                  {tx(
                    "Aún no hay atletas vinculados en la tabla de duelos.",
                    "No linked athletes in duels standings yet."
                  )}
                </p>
              ) : (
                standings.map((st, idx) => {
                  const winRate = st.total > 0 ? Math.round((st.wins / st.total) * 100) : 0;
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/40 border border-white/[0.04]"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[11.6px] text-white font-bold w-5 shrink-0 tabular-nums">
                          #{idx + 1}
                        </span>
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-white text-xs font-bold leading-tight break-words">
                            {st.userName || t("roleAthlete")}
                          </span>
                          <span className="text-[9.5px] text-white mt-1 tabular-nums">
                            {tx(
                              `${st.wins}V - ${st.losses}D - ${st.ties}E · Total: ${st.total}`,
                              `${st.wins}W - ${st.losses}L - ${st.ties}T · Total: ${st.total}`
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0 ps-2">
                        <span className="text-xs font-black text-cyan-neon tabular-nums">
                          {winRate}%
                        </span>
                        <span className="text-[9.3px] text-white uppercase">
                          {tx("Efectividad", "Win Rate")}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Historial general de duelos */}
          <div className="flex flex-col gap-2.5">
            <span className="text-[11.6px] text-white font-black uppercase tracking-wider">
              {tx("Historial de la Arena", "Arena History")}
            </span>

            {completedDuels.length === 0 ? (
              <p className="text-[12.8px] text-white text-center py-6 bg-neutral-900/20 border border-white/5 rounded-2xl">
                {tx(
                  "No se han registrado duelos finalizados en la arena aún.",
                  "No completed duels recorded in the arena yet."
                )}
              </p>
            ) : (
              completedDuels.map((duel) => {
                const duelDate = new Date(duel.timestamp);
                const dateStr = isNaN(duelDate.getTime())
                  ? "—"
                  : formatRegionalDate(duelDate, language, {
                      day: "numeric",
                      month: "short"
                    });
                return (
                  <div
                    key={duel.uid || duel.id}
                    className="bg-neutral-900/40 p-3.5 rounded-2xl border border-white/5 flex justify-between items-center gap-2"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-white text-xs font-bold leading-tight break-words">
                        {duel.userName || t("roleAthlete")}
                      </span>
                      <span className="text-[10.5px] text-white break-words leading-tight tabular-nums">
                        vs{" "}
                        <span className="text-cyan-neon font-extrabold">
                          {duel.opponent || tx("Rival", "Opponent")}
                        </span>
                        {duel.distance ? ` · ${duel.distance}m` : ""} · {dateStr}
                      </span>
                    </div>

                    <span
                      className={`shrink-0 whitespace-nowrap text-[11.8px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                        duel.outcome === "win"
                          ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/25"
                          : duel.outcome === "loss"
                          ? "bg-white text-black border border-white"
                          : "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/25"
                      }`}
                    >
                      {duel.outcome === "win"
                        ? tx("Victoria", "Win")
                        : duel.outcome === "loss"
                        ? tx("Derrota", "Loss")
                        : tx("Empate", "Tie")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
