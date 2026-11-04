"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { Award, Share2, Filter, ChevronDown, ChevronUp, User, Target, Calendar, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DIANA_PRESETS, getDianaPresetKey } from "../../scoring/ScoringView";
import { calculateDispersionStats, calculateDispersionAnalysis } from "@/lib/scoring/dispersionAnalytics";
import { isVolumeSession, getSessionArrows, getSessionScore, getSessionMaxScore, hasRealScore, countScoredArrows } from "@/lib/scoring/sessionMetrics";
import { getSessionDistanceWalkedM, getSessionActiveKcal, formatKmAndMiles } from "@/lib/scoring/biometricsEngine";

interface CoachSessionsTabProps {
  athletes: UserProfile[];
  sessions: any[];
}

export default function CoachSessionsTab({ athletes, sessions }: CoachSessionsTabProps) {
  const [subMode, setSubMode] = useState<"SCORES" | "VOLUME">("SCORES");
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

  // Filtered by selected athlete and mode (SCORES vs VOLUME)
  const filteredSessions = athleteSessions.filter(s => {
    const matchesAthlete = selectedAthleteUid === "ALL" || s.userId === selectedAthleteUid || s.userUid === selectedAthleteUid;
    if (subMode === "SCORES") {
      return matchesAthlete && hasRealScore(s);
    }
    return matchesAthlete && getSessionArrows(s) > 0;
  });

  // Calculate weekly ranking (Top 3 scores)
  const getWeeklyRanking = () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySess = athleteSessions.filter(s => s.timestamp >= oneWeekAgo && hasRealScore(s));
    
    const maxScores: Record<string, { userName: string; score: number; format: string }> = {};
    weeklySess.forEach(s => {
      const uid = s.userId || s.userUid;
      const sc = getSessionScore(s);
      if (!maxScores[uid] || sc > maxScores[uid].score) {
        maxScores[uid] = {
          userName: s.userName || "Atleta",
          score: sc,
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
      ? ranking.map((r, idx) => `${idx + 1}. ${r.userName} · ${r.score} pts (${r.format})`).join("\n")
      : "No hay registros esta semana.";

    const fullMessage = `*REPORTE DE PUNTUACIONES · 101010 THE APP*\n\n*Top Podio de la Semana:*\n${rankingText}\n\nExcelente trabajo y disciplina a todos los arqueros.\n🎯 *101010 THE APP*`;
    if (typeof window !== "undefined" && (window as any).ArcheryNativeShare?.shareWhatsAppText) {
      (window as any).ArcheryNativeShare.shareWhatsAppText(fullMessage);
      return;
    }
    const url = `whatsapp://send?text=${encodeURIComponent(fullMessage)}`;
    window.location.href = url;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Podio Semanal */}
      {ranking.length > 0 && (
        <div className="bg-[#0D0F12] p-4 rounded-2xl border border-white/[0.08] flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Award size={14} className="text-yellow-gold" />
              Podio de Puntuaciones de la Semana
            </h4>
            <button
              onClick={handleShareWhatsApp}
              className="p-2 rounded-xl bg-neutral-950 border border-white/5 text-white hover:text-white cursor-pointer transition flex items-center gap-1 text-[10.5px] font-black uppercase tracking-wider"
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
                    <span className="text-[9.3px] text-white uppercase">{rank.format}</span>
                  </div>
                </div>

                <span className="text-xs font-black text-cyan-neon">{rank.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control Filters: Selector de Alumno y Sub-pestañas Puntuaciones | Volumen */}
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
                {a.fullName} ({a.bowConfig?.type === "Recurve" ? "Recurvo" : a.bowConfig?.type === "Compound" ? "Compuesto" : (a.bowConfig?.type || "Arco")})
              </option>
            ))}
          </select>
        </div>

        {/* Selector Puntuaciones | Volumen */}
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => setSubMode("SCORES")}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              subMode === "SCORES"
                ? "bg-cyan-neon text-black font-extrabold shadow-glow-cyan"
                : "bg-neutral-950 border border-white/5 text-white hover:text-white"
            }`}
          >
            Puntuaciones
          </button>
          <button
            onClick={() => setSubMode("VOLUME")}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer ${
              subMode === "VOLUME"
                ? "bg-cyan-neon text-black font-extrabold shadow-glow-cyan"
                : "bg-neutral-950 border border-white/5 text-white hover:text-white"
            }`}
          >
            Volumen
          </button>
        </div>
      </div>

      {/* Feed Ordenado de Resultados Recibidos */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center px-1">
          <span className="text-[11.6px] text-white font-black uppercase tracking-wider">
            {subMode === "SCORES"
              ? `Puntajes Reportados (${filteredSessions.length})`
              : `Volumen por Sesión (${filteredSessions.length})`}
          </span>
          <span className="text-[10.5px] text-white">
            {subMode === "VOLUME"
              ? `Total: ${filteredSessions.reduce((acc, s) => acc + getSessionArrows(s), 0)} flechas`
              : "Orden cronológico más reciente"}
          </span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-10 bg-neutral-900/20 border border-white/5 rounded-2xl">
            <Target size={24} className="text-white mx-auto mb-2" />
            <p className="text-xs text-white font-bold">
              {subMode === "SCORES"
                ? "No hay puntuaciones reportadas aún."
                : "No hay sesiones con volumen de flechas registrado."}
            </p>
          </div>
        ) : subMode === "VOLUME" ? (
          filteredSessions.map((sess) => {
            const dateStr = new Date(sess.timestamp).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short"
            });
            const totalArrows = getSessionArrows(sess);

            return (
              <div
                key={sess.id}
                className="bg-neutral-900/40 rounded-2xl border border-white/5 p-3.5 flex justify-between items-center"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-xs text-cyan-neon shrink-0">
                    {(sess.userName || "AT").substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-white text-xs font-bold leading-tight truncate">
                      {sess.userName || "Alumno"}
                    </span>
                    <span className="text-[10.5px] text-white mt-0.5 truncate">
                      {dateStr} · {sess.practiceType || "Sesión"} · {sess.distance || 18}m · {getSessionActiveKcal(sess)} kcal · {formatKmAndMiles(getSessionDistanceWalkedM(sess), false)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col text-right shrink-0">
                  <span className="text-base font-black text-cyan-neon leading-tight tabular-nums">
                    {totalArrows}
                  </span>
                  <span className="text-[9.3px] text-white font-bold">flechas</span>
                </div>
              </div>
            );
          })
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

            const scoredArrows = countScoredArrows(sess) || (sess.endsCount && sess.arrowsPerEnd ? sess.endsCount * sess.arrowsPerEnd : 0);
            const realScore = getSessionScore(sess);
            const avgPerArrow = scoredArrows > 0 && realScore > 0 ? (realScore / scoredArrows).toFixed(1) : "—";
            const bowTypeEs = sess.bowType === "Recurve" ? "Recurvo" : sess.bowType === "Compound" ? "Compuesto" : (sess.bowType || "Arco");

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

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-white text-xs font-bold leading-tight truncate">
                          {sess.userName || "Alumno"}
                        </span>
                        <span className="text-[9.3px] bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon px-1.5 py-0.5 rounded-full font-black uppercase shrink-0">
                          {sess.practiceType}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-white mt-0.5 truncate">
                        {sess.format || "WA 720"} · {sess.distance}m · {bowTypeEs} · {getSessionActiveKcal(sess)} kcal · {formatKmAndMiles(getSessionDistanceWalkedM(sess), false)} · {dateStr} {timeStr}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="flex flex-col text-right">
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="text-base font-black text-cyan-neon leading-tight">
                          {realScore}
                        </span>
                        <span className="text-[9.3px] text-white font-bold">
                          /{getSessionMaxScore(sess)}
                        </span>
                      </div>
                      <span className="text-[9.3px] text-yellow-gold font-bold">
                        {avgPerArrow} pts/fl
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={15} className="text-cyan-neon" />
                    ) : (
                      <ChevronDown size={15} className="text-white" />
                    )}
                  </div>
                </div>

                {/* Expanded Details: Diana con Telemetría y Puntajes por End */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/5 bg-neutral-950/70 p-4 flex flex-col gap-3.5"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-[10.5px] text-white font-black uppercase tracking-wider">
                          Diana de Impactos y Telemetría
                        </span>
                        <div className="w-[212px] h-[212px] rounded-full border border-white/5 bg-black flex items-center justify-center shadow-lg relative p-2">
                          {(() => {
                            const presetType = getDianaPresetKey(sess.bowType, sess.distance, sess.format, sess.targetType);
                            const presetRings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
                            const disp = sess.impacts && sess.impacts.length > 0
                              ? calculateDispersionStats(
                                  sess.impacts,
                                  Number(sess.distance) || 18,
                                  sess.bowType,
                                  sess.format,
                                  sess.targetType
                                )
                              : null;

                            return (
                              <svg viewBox="0 0 100 100" className="w-full h-full">
                                {presetRings.map((ring, index) => (
                                  <circle
                                    key={index}
                                    cx="50"
                                    cy="50"
                                    r={ring.r}
                                    fill={ring.fill}
                                    stroke={ring.stroke}
                                    strokeWidth={0.1}
                                  />
                                ))}
                                {disp && (
                                  <g className="pointer-events-none">
                                    {disp.hullPolygon.length >= 3 && (
                                      <polygon
                                        points={disp.hullPolygon.map(p => `${p.x},${p.y}`).join(" ")}
                                        fill="rgba(0, 229, 255, 0.15)"
                                        stroke="#00E5FF"
                                        strokeWidth="0.45"
                                        strokeDasharray="1.2,0.8"
                                      />
                                    )}
                                    {disp.hullPolygon.length === 2 && (
                                      <line
                                        x1={disp.hullPolygon[0].x}
                                        y1={disp.hullPolygon[0].y}
                                        x2={disp.hullPolygon[1].x}
                                        y2={disp.hullPolygon[1].y}
                                        stroke="#00E5FF"
                                        strokeWidth="0.45"
                                        strokeDasharray="1.2,0.8"
                                      />
                                    )}
                                    <line x1={disp.centroidX - 2.2} y1={disp.centroidY} x2={disp.centroidX + 2.2} y2={disp.centroidY} stroke="#000000" strokeWidth="0.9" strokeLinecap="round" />
                                    <line x1={disp.centroidX} y1={disp.centroidY - 2.2} x2={disp.centroidX} y2={disp.centroidY + 2.2} stroke="#000000" strokeWidth="0.9" strokeLinecap="round" />
                                    <line x1={disp.centroidX - 2.0} y1={disp.centroidY} x2={disp.centroidX + 2.0} y2={disp.centroidY} stroke="#00E5FF" strokeWidth="0.55" strokeLinecap="round" />
                                    <line x1={disp.centroidX} y1={disp.centroidY - 2.0} x2={disp.centroidX} y2={disp.centroidY + 2.0} stroke="#00E5FF" strokeWidth="0.55" strokeLinecap="round" />
                                  </g>
                                )}
                                {sess.impacts && sess.impacts.map((imp: any, iIdx: number) => (
                                  <g key={iIdx}>
                                    <circle cx={imp.x} cy={imp.y} r="2" fill="rgba(0,0,0,0.5)" />
                                    <circle cx={imp.x} cy={imp.y} r="1.3" fill="#FFF200" stroke="black" strokeWidth="0.3px" />
                                  </g>
                                ))}
                              </svg>
                            );
                          })()}
                        </div>
                        {sess.impacts && sess.impacts.length > 0 && (() => {
                          const presetType = getDianaPresetKey(sess.bowType, sess.distance, sess.format, sess.targetType);
                          const analysis = calculateDispersionAnalysis(
                            sess.impacts,
                            Number(sess.distance) || 18,
                            sess.bowType || "Recurve",
                            presetType,
                            sess.format,
                            sess.targetType
                          );
                          if (!analysis) return null;
                          return (
                            <div className="w-full mt-2 bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-1.5 text-left">
                              <div className="flex items-center justify-between">
                                <span className="text-[10.5px] font-black uppercase text-cyan-neon tracking-wider">
                                  Análisis de Grupo y Mira
                                </span>
                                <span className="text-[11.6px] tabular-nums font-black text-white">
                                  Ø {analysis.spreadCm.toFixed(1)} cm
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11.6px]">
                                <span className="text-white">Centro del grupo (+):</span>
                                <span className="font-bold text-yellow-gold">
                                  {analysis.clockDirection} ({analysis.distanceFromCenterCm.toFixed(1)} cm)
                                </span>
                              </div>
                              <div className="text-[11.6px] text-white leading-snug bg-neutral-950/70 border border-white/5 rounded-xl p-2 mt-0.5">
                                <span>{analysis.adviceText}</span>
                              </div>
                            </div>
                          );
                        })()}
                        {/* KCAL y DISTANCIA RECORRIDA para el Coach */}
                        <div className="w-full grid grid-cols-2 gap-2 mt-1">
                          <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-2.5 flex flex-col">
                            <span className="text-[9.5px] font-black uppercase text-white tracking-wider">KCAL</span>
                            <span className="text-sm font-black text-white tabular-nums mt-0.5">
                              {getSessionActiveKcal(sess)} kcal
                            </span>
                          </div>
                          <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-2.5 flex flex-col">
                            <span className="text-[9.5px] font-black uppercase text-white tracking-wider">DISTANCIA RECORRIDA</span>
                            <span className="text-sm font-black text-white tabular-nums mt-0.5">
                              {formatKmAndMiles(getSessionDistanceWalkedM(sess), false)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Desglose de Series (Ends) */}
                      {sess.ends && Array.isArray(sess.ends) && sess.ends.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10.5px] text-white font-black uppercase tracking-wider">
                            Puntajes por Serie ({sess.ends.length} tandas)
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
                                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-neutral-900/80 border border-white/5 text-[12.8px]"
                                >
                                  <span className="text-[11.6px] text-white font-black tabular-nums shrink-0">
                                    {String(endIdx + 1).padStart(2, "0")}
                                  </span>
                                  <div className="flex items-center gap-1 flex-wrap justify-center">
                                    {endArrows.map((arrowVal, aIdx) => (
                                      <span
                                        key={aIdx}
                                        className={`w-5 h-5 rounded flex items-center justify-center font-black text-[10.5px] shrink-0 ${
                                          arrowVal === "X" || arrowVal === "10" || arrowVal === "9"
                                            ? "bg-yellow-gold text-black border border-yellow-gold"
                                            : arrowVal === "8" || arrowVal === "7"
                                            ? "bg-red-500 text-white border border-red-500/30"
                                            : arrowVal === "6" || arrowVal === "5"
                                            ? "bg-blue-500 text-white border border-blue-500/30"
                                            : "bg-neutral-800 text-white border border-neutral-700"
                                        }`}
                                      >
                                        {arrowVal}
                                      </span>
                                    ))}
                                  </div>
                                  <span className="text-white font-extrabold text-right text-[11.6px] shrink-0 whitespace-nowrap">
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
                          <span className="text-[9.3px] text-white font-black uppercase tracking-wider block mb-0.5">
                            Nota del Alumno:
                          </span>
                          <p className="text-[12.8px] text-white italic">
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
          <div className="text-center text-[11.6px] text-white py-4 border border-dashed border-white/5 rounded-xl">
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
                  <span className="text-xs font-black text-white w-4 text-center">
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
                    </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-white text-xs font-extrabold truncate">{rank.userName}</span>
                    <span className="text-[9.3px] text-white uppercase font-bold truncate">
                      {rank.starName} · {rank.bowType === "Recurve" ? "Recurvo" : rank.bowType === "Compound" ? "Compuesto" : (rank.bowType || "Arco")}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-black text-cyan-neon block">
                    {rank.highestScore} <span className="text-[9.3px] text-white">/ 720</span>
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
