"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { Award, Share2, Filter, ChevronDown, ChevronUp, User, Target, Calendar, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DIANA_PRESETS } from "../../scoring/ScoringView";

interface CoachSessionsTabProps {
  athletes: UserProfile[];
  sessions: any[];
}

export default function CoachSessionsTab({ athletes, sessions }: CoachSessionsTabProps) {
  const [filterType, setFilterType] = useState<string>("ALL");
  const [selectedAthleteUid, setSelectedAthleteUid] = useState<string>("ALL");
  const [starRanking, setStarRanking] = useState<any[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  useEffect(() => {
    async function loadStars() {
      try {
        const { athleteStarsStore } = await import("@/lib/db/indexedDB");
        const list: any[] = [];
        await athleteStarsStore.iterate((value: any) => {
          if (athletes.some((a) => a.uid === value.userId)) {
            list.push(value);
          }
        });
        
        list.sort((a, b) => {
          if (b.highestStarLevel !== a.highestStarLevel) {
            return b.highestStarLevel - a.highestStarLevel;
          }
          return b.highestScore - a.highestScore;
        });
        
        setStarRanking(list);
      } catch (err) {
        console.error("Error loading star ranking:", err);
      }
    }
    loadStars();
  }, [athletes, sessions]);

  // Only real shooting sessions (not duels)
  const athleteSessions = sessions.filter(s => !s.isDuel && s.deletedByArcher !== true);

  // Filtered by selected athlete and practice type
  const filteredSessions = athleteSessions.filter(s => {
    const matchesAthlete = selectedAthleteUid === "ALL" || s.userId === selectedAthleteUid || s.userUid === selectedAthleteUid;
    const matchesType = filterType === "ALL" || s.practiceType === filterType;
    return matchesAthlete && matchesType;
  });

  // Calculate weekly ranking (Top 3 scores)
  const getWeeklyRanking = () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySess = athleteSessions.filter(s => s.timestamp >= oneWeekAgo);
    
    const maxScores: Record<string, { userName: string; score: number; format: string }> = {};
    weeklySess.forEach(s => {
      const uid = s.userId || s.userUid;
      if (!maxScores[uid] || s.score > maxScores[uid].score) {
        maxScores[uid] = {
          userName: s.userName || "Atleta",
          score: s.score,
          format: s.format || "WA 720"
        };
      }
    });

    return Object.values(maxScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  };

  const ranking = getWeeklyRanking();

  const handleShareWhatsApp = () => {
    const rankingText = ranking.length > 0 
      ? ranking.map((r, idx) => `${idx + 1}. 🏹 ${r.userName} - ${r.score} pts (${r.format})`).join("\n")
      : "No hay registros esta semana.";

    const fullMessage = `*REPORTE DE PUNTUACIONES - ARCHERY 101010*\n\n🏆 *Top Podio de la Semana:*\n${rankingText}\n\n¡Excelente trabajo y disciplina a todos los arqueros! 💪🎯`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Podio Semanal */}
      {ranking.length > 0 && (
        <div className="bg-gradient-to-br from-yellow-gold/15 via-neutral-900/40 to-neutral-900/60 p-4 rounded-3xl border border-yellow-gold/20 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Award size={14} className="text-yellow-gold animate-bounce" />
              Podio de Puntuaciones de la Semana
            </h4>
            <button
              onClick={handleShareWhatsApp}
              className="p-2 rounded-xl bg-neutral-950 border border-white/5 text-gray-dim hover:text-white cursor-pointer transition flex items-center gap-1 text-[9px] font-black uppercase tracking-wider"
            >
              <Share2 size={10} />
              <span>Compartir</span>
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {ranking.map((rank, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950/60 border border-white/[0.03]"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs ${
                    idx === 0 
                      ? "bg-yellow-gold text-black shadow-glow-yellow" 
                      : idx === 1 
                      ? "bg-neutral-300 text-black" 
                      : "bg-amber-600 text-white"
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-white text-xs font-bold">{rank.userName}</span>
                    <span className="text-[8px] text-gray-dim uppercase">{rank.format}</span>
                  </div>
                </div>

                <span className="text-xs font-black text-cyan-neon">{rank.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control Filters: Selector de Alumno y Tipo de Práctica */}
      <div className="bg-neutral-900/50 p-3 rounded-2xl border border-white/5 flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
        {/* Selector de Alumno Específico */}
        <div className="flex items-center gap-2 flex-1">
          <User size={13} className="text-cyan-neon shrink-0" />
          <select
            value={selectedAthleteUid}
            onChange={(e) => setSelectedAthleteUid(e.target.value)}
            className="bg-neutral-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs outline-none flex-1 cursor-pointer"
          >
            <option value="ALL">Todos los Alumnos ({athletes.length})</option>
            {athletes.map((a) => (
              <option key={a.uid} value={a.uid}>
                {a.fullName} ({a.bowConfig?.type || "Arco"})
              </option>
            ))}
          </select>
        </div>

        {/* Tipo de Práctica */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar shrink-0">
          {["ALL", "Control", "Práctica", "Torneo", "Volumen"].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                filterType === type
                  ? "bg-cyan-neon text-black font-extrabold shadow-glow-cyan"
                  : "bg-neutral-950 border border-white/5 text-gray-dim hover:text-white"
              }`}
            >
              {type === "ALL" ? "Todos" : type}
            </button>
          ))}
        </div>
      </div>

      {/* Feed Ordenado de Resultados Recibidos */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center px-1">
          <span className="text-[10px] text-gray-dim font-black uppercase tracking-wider">
            Resultados de Puntos Recibidos ({filteredSessions.length})
          </span>
          <span className="text-[9px] text-gray-dim">
            Orden cronológico más reciente
          </span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-10 bg-neutral-900/20 border border-white/5 rounded-2xl">
            <Target size={24} className="text-gray-dim/40 mx-auto mb-2" />
            <p className="text-xs text-white/80 font-bold">No hay resultados que coincidan con los filtros.</p>
            <p className="text-[10px] text-gray-dim mt-1">Los alumnos registrados enviarán sus puntuaciones aquí al finalizar cada sesión.</p>
          </div>
        ) : (
          filteredSessions.map((sess) => {
            const isExpanded = expandedSessionId === sess.id;
            const dateStr = new Date(sess.timestamp).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short"
            });
            const timeStr = new Date(sess.timestamp).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit"
            });

            // Calculate arrows and average
            const totalArrows = sess.arrowsTotal || (sess.endsCount && sess.arrowsPerEnd ? sess.endsCount * sess.arrowsPerEnd : (sess.ends ? sess.ends.reduce((acc: number, end: any) => acc + (end.arrows ? end.arrows.length : 0), 0) : 0));
            const avgPerArrow = totalArrows > 0 && sess.score > 0 ? (sess.score / totalArrows).toFixed(1) : "—";

            // Count 10s and Xs
            let count10 = 0;
            let countX = 0;
            if (sess.ends && Array.isArray(sess.ends)) {
              sess.ends.forEach((e: any) => {
                if (e.arrows && Array.isArray(e.arrows)) {
                  e.arrows.forEach((v: string) => {
                    if (v === "10") count10++;
                    if (v === "X") countX++;
                  });
                }
              });
            }

            return (
              <div
                key={sess.id}
                className="bg-neutral-900/40 rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-cyan-neon/20"
              >
                {/* Header card */}
                <div
                  onClick={() => setExpandedSessionId(isExpanded ? null : sess.id)}
                  className="p-3.5 flex justify-between items-center cursor-pointer hover:bg-neutral-900/60 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-xs text-cyan-neon shrink-0">
                      {(sess.userName || "AT").substring(0, 2).toUpperCase()}
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-xs font-bold leading-tight">
                          {sess.userName || "Alumno"}
                        </span>
                        <span className="text-[8px] bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon px-1.5 py-0.2 rounded-full font-black uppercase">
                          {sess.practiceType}
                        </span>
                      </div>
                      <span className="text-[9px] text-gray-dim mt-0.5">
                        {sess.format || "WA 720"} · {sess.distance}m · {sess.bowType || "Arco"} · {dateStr} {timeStr}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col text-right">
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="text-base font-black text-cyan-neon leading-tight">
                          {sess.score}
                        </span>
                        <span className="text-[8px] text-gray-dim font-bold">
                          /{sess.maxScore || 720}
                        </span>
                      </div>
                      <span className="text-[8px] text-yellow-gold font-bold">
                        {avgPerArrow} pts/fl
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={15} className="text-cyan-neon" />
                    ) : (
                      <ChevronDown size={15} className="text-gray-dim" />
                    )}
                  </div>
                </div>

                {/* Expanded Details: Series, Flechas, Notas e Impactos */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/5 bg-neutral-950/70 p-4 flex flex-col gap-3.5"
                    >
                      {/* Metric capsules */}
                      <div className="grid grid-cols-4 gap-2 text-center bg-neutral-900/60 p-2.5 rounded-xl border border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[8px] text-gray-dim uppercase font-bold">Flechas</span>
                          <span className="text-xs font-black text-white">{totalArrows}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[8px] text-gray-dim uppercase font-bold">Promedio</span>
                          <span className="text-xs font-black text-cyan-neon">{avgPerArrow}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[8px] text-gray-dim uppercase font-bold">10s</span>
                          <span className="text-xs font-black text-yellow-gold">{count10}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[8px] text-gray-dim uppercase font-bold">Xs</span>
                          <span className="text-xs font-black text-amber-500">{countX}</span>
                        </div>
                      </div>

                      {/* Desglose de Series (Ends) */}
                      {sess.ends && Array.isArray(sess.ends) && sess.ends.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">
                            Desglose de Series ({sess.ends.length} tandas)
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {sess.ends.map((endItem: any, endIdx: number) => {
                              const endArrows: string[] = Array.isArray(endItem.arrows) ? endItem.arrows : [];
                              const endScore = endArrows.reduce((sum, v) => {
                                if (v === "X" || v === "10") return sum + 10;
                                if (v === "M") return sum;
                                return sum + (Number(v) || 0);
                              }, 0);

                              return (
                                <div
                                  key={endIdx}
                                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-neutral-900/80 border border-white/5 text-[11px]"
                                >
                                  <span className="text-[9px] text-gray-dim font-bold w-12">
                                    Serie #{endIdx + 1}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {endArrows.map((arrowVal, aIdx) => (
                                      <span
                                        key={aIdx}
                                        className={`w-5 h-5 rounded flex items-center justify-center font-black text-[9px] ${
                                          arrowVal === "X" || arrowVal === "10"
                                            ? "bg-yellow-gold/20 text-yellow-gold border border-yellow-gold/30"
                                            : arrowVal === "9" || arrowVal === "8"
                                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                            : arrowVal === "7" || arrowVal === "6"
                                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                            : "bg-neutral-800 text-gray-300 border border-neutral-700"
                                        }`}
                                      >
                                        {arrowVal}
                                      </span>
                                    ))}
                                  </div>
                                  <span className="text-white font-extrabold w-8 text-right text-[10px]">
                                    {endScore} pts
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Nota del Alumno */}
                      {sess.sessionNote && (
                        <div className="bg-neutral-900/50 p-2.5 rounded-xl border border-white/5">
                          <span className="text-[8px] text-gray-dim font-black uppercase tracking-wider block mb-0.5">
                            Nota del Alumno:
                          </span>
                          <p className="text-[11px] text-white/90 italic">
                            "{sess.sessionNote}"
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>

      {/* Clasificación de Estrellas 101010 */}
      <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/5 flex flex-col gap-3 mt-2">
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <span className="text-yellow-gold text-sm">★</span>
          Clasificación de Estrellas 101010 del Equipo
        </h4>

        {starRanking.length === 0 ? (
          <div className="text-center text-[10px] text-gray-dim py-4 border border-dashed border-white/5 rounded-xl">
            Aún ningún arquero del roster ha ganado una Estrella 101010 (720).
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {starRanking.map((rank, idx) => (
              <div 
                key={rank.userId}
                className="flex items-center justify-between p-2.5 rounded-xl bg-[#0E0E12]/80 border border-white/5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-black text-white/50 w-4 text-center">
                    #{idx + 1}
                  </span>
                  
                  <div 
                    className="w-7 h-7 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
                    style={{ 
                      borderColor: rank.starColor,
                      color: rank.starColor,
                      backgroundColor: `${rank.starColor}15`
                    }}
                    title={rank.starName}
                  >
                    ★
                  </div>

                  <div className="flex flex-col">
                    <span className="text-white text-xs font-extrabold">{rank.userName}</span>
                    <span className="text-[8px] text-gray-dim uppercase font-bold">
                      {rank.starName} · {rank.bowType}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-black text-cyan-neon block">
                    {rank.highestScore} <span className="text-[8px] text-gray-dim">/ 720</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
