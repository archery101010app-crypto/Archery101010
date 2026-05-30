"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  User, 
  History, 
  Trophy, 
  LineChart, 
  MessageSquare,
  Award,
  ChevronDown,
  ChevronUp,
  Plus,
  Send,
  Target
} from "lucide-react";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { RECURVE_STARS, COMPOUND_STARS } from "@/lib/starsManager";

interface AthleteDetailSheetProps {
  athlete: UserProfile | null;
  onClose: () => void;
  sessions: any[];
}

type SubTab = "PERFIL" | "SESIONES" | "RECORDS" | "DUELOS" | "TENDENCIAS" | "NOTAS";

export default function AthleteDetailSheet({ athlete, onClose, sessions }: AthleteDetailSheetProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("PERFIL");
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  
  // Coach notes state
  const [notes, setNotes] = useState<Array<{ id: string; date: number; content: string }>>([]);
  const [newNoteText, setNewNoteText] = useState("");
  const [maxStar, setMaxStar] = useState<any | null>(null);

  useEffect(() => {
    if (!athlete) return;
    const athleteUid = athlete.uid;
    async function loadCoachNotes() {
      const key = `coach_notes_${athleteUid}`;
      const savedNotes = await getLocalSetting<any[]>(key, []);
      setNotes(savedNotes);
    }
    async function loadAthleteStar() {
      try {
        const { athleteStarsStore } = await import("@/lib/db/indexedDB");
        const doc = await athleteStarsStore.getItem<any>(athleteUid);
        setMaxStar(doc);
      } catch (err) {
        console.error("Error loading athlete star in coach sheet:", err);
      }
    }
    loadCoachNotes();
    loadAthleteStar();
    setActiveTab("PERFIL"); // reset to profile tab on open
    setExpandedSessionId(null);
  }, [athlete]);

  if (!athlete) return null;

  // Filter athlete sessions and duels
  const athleteSessions = sessions.filter(s => s.userId === athlete.uid && !s.isDuel);
  const athleteDuels = sessions.filter(s => (s.userId === athlete.uid || s.userUid === athlete.uid) && s.isDuel);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;

    const newNote = {
      id: `NOTE-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      date: Date.now(),
      content: newNoteText.trim()
    };

    const updatedNotes = [newNote, ...notes];
    setNotes(updatedNotes);
    setNewNoteText("");

    const key = `coach_notes_${athlete.uid}`;
    await saveLocalSetting(key, updatedNotes);
  };

  // Rebuild PBs
  const getPBs = () => {
    const pbs: Record<string, { score: number; maxScore: number; date: number }> = {};
    athleteSessions.forEach(s => {
      const format = s.format || "Libre";
      if (!pbs[format] || s.score > pbs[format].score) {
        pbs[format] = {
          score: s.score,
          maxScore: s.maxScore || 300,
          date: s.timestamp
        };
      }
    });
    return pbs;
  };
  const pbs = getPBs();

  // Duel stats
  const wins = athleteDuels.filter(d => d.outcome === "win").length;
  const losses = athleteDuels.filter(d => d.outcome === "loss").length;
  const ties = athleteDuels.filter(d => d.outcome === "tie").length;
  const totalDuels = athleteDuels.length;
  const winRate = totalDuels > 0 ? Math.round((wins / totalDuels) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end"
    >
      {/* Tap outside to close */}
      <div className="absolute inset-0 z-0" onClick={onClose} />

      {/* Sheet Content container */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 220 }}
        className="w-full max-w-md mx-auto bg-neutral-950 border-t border-white/10 rounded-t-[32px] h-[92vh] flex flex-col z-10 overflow-hidden relative shadow-2xl"
      >
        {/* Header indicator */}
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto my-3 shrink-0" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-neutral-900 border border-white/5 text-gray-dim hover:text-white transition cursor-pointer"
        >
          <X size={16} />
        </button>

        {/* Athlete Overview Card */}
        <div className="px-5 pb-3 pt-1 flex items-center gap-3.5 shrink-0 border-b border-white/[0.05]">
          <div className="w-12 h-12 rounded-full bg-cyan-brand/20 border border-cyan-neon/40 flex items-center justify-center font-black text-sm text-cyan-neon shadow-glow-cyan uppercase">
            {athlete.fullName.substring(0, 2)}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <h3 className="text-white text-base font-black truncate uppercase tracking-wide">
              {athlete.fullName}
            </h3>
            <p className="text-[10px] text-gray-dim leading-none mt-0.5">
              {athlete.bowConfig.type} · {athlete.gender === "M" ? "Masculino" : "Femenino"} · Club {athlete.clubName || "Independiente"}
            </p>
          </div>
        </div>

        {/* Tabs navigation list */}
        <div className="flex overflow-x-auto gap-2 px-5 py-2.5 shrink-0 border-b border-white/[0.03] no-scrollbar">
          {[
            { id: "PERFIL", label: "Perfil", icon: User },
            { id: "SESIONES", label: "Sesiones", icon: History },
            { id: "RECORDS", label: "Récords", icon: Award },
            { id: "DUELOS", label: "Duelos", icon: Trophy },
            { id: "TENDENCIAS", label: "Tendencias", icon: LineChart },
            { id: "NOTAS", label: "Notas Coach", icon: MessageSquare }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SubTab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border shrink-0 cursor-pointer ${
                  active
                    ? "bg-cyan-neon/15 border-cyan-neon/30 text-cyan-neon shadow-glow-cyan"
                    : "bg-neutral-900/60 border-white/5 text-gray-dim hover:text-white"
                }`}
              >
                <Icon size={12} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tabs Content - scrollable area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-12">
          {/* TAB 1: PERFIL */}
          {activeTab === "PERFIL" && (
            <div className="flex flex-col gap-4">
              {/* World Archery Stars */}
              <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                <span className="text-[10px] text-yellow-gold font-black tracking-wider uppercase flex items-center gap-1">
                  ★ Estrellas World Archery 720
                </span>
                {maxStar ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5 bg-neutral-950/40 p-2.5 rounded-xl border border-white/5">
                      <div 
                        className="w-10 h-10 rounded-full border flex items-center justify-center text-lg font-black shrink-0"
                        style={{ 
                          borderColor: maxStar.starColor,
                          color: maxStar.starColor,
                          backgroundColor: `${maxStar.starColor}15`
                        }}
                      >
                        ★
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-white text-xs font-black uppercase tracking-wide truncate">
                          {maxStar.starName}
                        </span>
                        <span className="text-[8px] text-gray-dim mt-0.5 font-bold">
                          Récord 720: {maxStar.highestScore} pts
                        </span>
                      </div>
                    </div>

                    {/* Progress indicator */}
                    {(() => {
                      const bow = maxStar.bowType;
                      const tiers = bow === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
                      const currentLevel = maxStar.highestStarLevel;
                      
                      if (currentLevel >= 8) {
                        return (
                          <div className="bg-cyan-brand/10 border border-cyan-neon/20 p-2 rounded-xl text-[9px] text-center text-cyan-neon font-black uppercase">
                            ⭐ Estrella Máxima Alcanzada ⭐
                          </div>
                        );
                      }
                      
                      const nextStar = tiers[currentLevel];
                      const prevMin = tiers[currentLevel - 1].minScore;
                      const highestScore = maxStar.highestScore;
                      const targetMin = nextStar.minScore;
                      const percent = Math.min(100, Math.max(0, ((highestScore - prevMin) / (targetMin - prevMin)) * 100));
                      
                      return (
                        <div className="flex flex-col gap-1 mt-0.5">
                          <div className="flex justify-between text-[8px] text-gray-dim font-black uppercase">
                            <span>Siguiente Meta: {nextStar.name}</span>
                            <span className="text-white">{highestScore} / {targetMin} pts</span>
                          </div>
                          <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-white/5">
                            <div 
                              className="h-full rounded-full"
                              style={{ 
                                width: `${percent}%`,
                                backgroundColor: nextStar.color,
                                boxShadow: `0 0 8px ${nextStar.color}`
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-center bg-neutral-950/40 p-3.5 rounded-xl border border-dashed border-white/10 text-[9px] text-gray-dim font-bold uppercase">
                    Sin estrellas WA ganadas
                  </div>
                )}
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                <span className="text-[10px] text-cyan-neon font-black tracking-wider uppercase">Configuración de Arco</span>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[9px] text-gray-dim block">Tipo de Arco</span>
                    <span className="text-white text-xs font-bold">{athlete.bowConfig.type}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Potencia (Poundage)</span>
                    <span className="text-white text-xs font-bold">{athlete.bowConfig.poundage} libras</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Marca</span>
                    <span className="text-white text-xs font-bold">{athlete.bowConfig.brand || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Modelo</span>
                    <span className="text-white text-xs font-bold">{athlete.bowConfig.model || "—"}</span>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                <span className="text-[10px] text-yellow-gold font-black tracking-wider uppercase">Datos Físicos</span>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[9px] text-gray-dim block">Estatura</span>
                    <span className="text-white text-xs font-bold">{athlete.physicalData?.height || "—"} cm</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Peso</span>
                    <span className="text-white text-xs font-bold">{athlete.physicalData?.weight || "—"} kg</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Ojo Dominante</span>
                    <span className="text-white text-xs font-bold">
                      {athlete.physicalData?.dominantEye === "R" ? "Derecho" : athlete.physicalData?.dominantEye === "L" ? "Izquierdo" : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-dim block">Mano Dominante</span>
                    <span className="text-white text-xs font-bold">
                      {athlete.physicalData?.dominantHand === "R" ? "Derecha" : athlete.physicalData?.dominantHand === "L" ? "Izquierda" : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
                <span className="text-[10px] text-gray-dim font-black tracking-wider uppercase">Información de Contacto</span>
                <div>
                  <span className="text-[9px] text-gray-dim block">Correo Electrónico</span>
                  <span className="text-white text-xs font-medium">{athlete.email}</span>
                </div>
                {athlete.whatsappNumber && (
                  <div className="mt-1">
                    <span className="text-[9px] text-gray-dim block">WhatsApp</span>
                    <span className="text-white text-xs font-medium">{athlete.whatsappNumber}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SESIONES */}
          {activeTab === "SESIONES" && (
            <div className="flex flex-col gap-3">
              {athleteSessions.length === 0 ? (
                <p className="text-[11px] text-gray-dim text-center py-6">Este atleta no tiene sesiones registradas.</p>
              ) : (
                athleteSessions.map((sess) => {
                  const isExpanded = expandedSessionId === sess.id;
                  const dateStr = new Date(sess.timestamp).toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short"
                  });

                  return (
                    <div
                      key={sess.id}
                      className="bg-neutral-900/40 rounded-2xl border border-white/5 overflow-hidden transition-all duration-300"
                    >
                      <div
                        onClick={() => setExpandedSessionId(isExpanded ? null : sess.id)}
                        className="p-3.5 flex justify-between items-center cursor-pointer hover:bg-neutral-900/60 transition"
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] text-white font-extrabold uppercase">{sess.practiceType} · {sess.format}</span>
                          <span className="text-[9px] text-gray-dim mt-0.5">{dateStr} · {sess.distance}m</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col text-right">
                            <span className="text-sm font-black text-cyan-neon">{sess.score}</span>
                            <span className="text-[8px] text-gray-dim">/ {sess.maxScore || 300} pts</span>
                          </div>
                          {isExpanded ? <ChevronUp size={14} className="text-gray-dim" /> : <ChevronDown size={14} className="text-gray-dim" />}
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: "auto" }}
                            exit={{ height: 0 }}
                            className="overflow-hidden border-t border-white/[0.03] bg-neutral-950/40"
                          >
                            <div className="p-4 flex flex-col gap-4">
                              {/* Reconstructed Diana View */}
                              <div className="flex flex-col items-center gap-2">
                                <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Diana de Impactos Reconstruida</span>
                                <div className="w-48 h-48 rounded-full border border-white/5 bg-black flex items-center justify-center shadow-lg relative p-2">
                                  <svg viewBox="0 0 100 100" className="w-full h-full">
                                    <circle cx="50" cy="50" r="48" fill="white" stroke="#ccc" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="43.2" fill="white" stroke="#ccc" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="38.4" fill="black" stroke="#555" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="33.6" fill="black" stroke="#555" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="28.8" fill="#1E88E5" stroke="#1565C0" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="24" fill="#1E88E5" stroke="#1565C0" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="19.2" fill="#E53935" stroke="#C62828" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="14.4" fill="#E53935" stroke="#C62828" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="9.6" fill="#FDD835" stroke="#F57F17" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="4.8" fill="#FDD835" stroke="#F57F17" strokeWidth="0.1" />
                                    <circle cx="50" cy="50" r="1.5" fill="#FDD835" stroke="#F57F17" strokeWidth="0.1" />
                                    
                                    {sess.impacts && sess.impacts.map((imp: any, iIdx: number) => (
                                      <g key={iIdx}>
                                        <circle cx={imp.x} cy={imp.y} r="2" fill="rgba(0,0,0,0.5)" />
                                        <circle cx={imp.x} cy={imp.y} r="1.3" fill="#FFF200" stroke="black" strokeWidth="0.3px" />
                                      </g>
                                    ))}
                                  </svg>
                                </div>
                              </div>

                              {/* Ends values list */}
                              {sess.ends && (
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Desglose de Flechas por End</span>
                                  <div className="flex flex-col gap-1">
                                    {sess.ends.map((end: any, idx: number) => (
                                      <div key={idx} className="flex justify-between items-center text-[10px] bg-neutral-900/30 px-3 py-1.5 rounded-lg border border-white/[0.02]">
                                        <span className="text-gray-dim font-bold">End {idx + 1}</span>
                                        <div className="flex gap-1">
                                          {end.arrows.map((arr: string, aIdx: number) => (
                                            <span key={aIdx} className="w-5 h-5 rounded bg-neutral-950 border border-white/5 flex items-center justify-center font-extrabold text-[9px] text-white">
                                              {arr || "—"}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Session Notes */}
                              {sess.sessionNote && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] text-gray-dim font-black uppercase tracking-wider">Comentarios del Arquero</span>
                                  <div className="p-3 bg-neutral-900/50 rounded-xl border border-white/5 text-[11px] text-white italic">
                                    "{sess.sessionNote}"
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 3: RECORDS */}
          {activeTab === "RECORDS" && (
            <div className="flex flex-col gap-3">
              {Object.keys(pbs).length === 0 ? (
                <p className="text-[11px] text-gray-dim text-center py-6">Aún no hay mejores marcas registradas.</p>
              ) : (
                Object.entries(pbs).map(([format, record]) => (
                  <div key={format} className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-dim uppercase font-black tracking-wider">Ronda WA</span>
                      <span className="text-white text-base font-extrabold">{format}</span>
                      <span className="text-[9px] text-yellow-gold mt-1">
                        Establecido el {new Date(record.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-2xl font-black text-cyan-neon">{record.score}</span>
                      <span className="text-[8px] text-gray-dim">sobre {record.maxScore}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: DUELOS */}
          {activeTab === "DUELOS" && (
            <div className="flex flex-col gap-4">
              {/* Stats Panel */}
              <div className="grid grid-cols-4 gap-2 text-center bg-neutral-900/40 p-3 rounded-2xl border border-white/5">
                <div className="flex flex-col">
                  <span className="text-[8px] text-gray-dim uppercase font-bold">Total</span>
                  <span className="text-base font-black text-white">{totalDuels}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-gray-dim uppercase font-bold">Ganados</span>
                  <span className="text-base font-black text-cyan-neon">{wins}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-gray-dim uppercase font-bold">Perdidos</span>
                  <span className="text-base font-black text-red-rival">{losses}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] text-gray-dim uppercase font-bold">W/L %</span>
                  <span className="text-base font-black text-yellow-gold">{winRate}%</span>
                </div>
              </div>

              {/* Dueling history */}
              <div className="flex flex-col gap-2.5">
                <span className="text-[9px] text-gray-dim uppercase font-black tracking-wider">Historial de Eliminaciones</span>
                
                {athleteDuels.length === 0 ? (
                  <p className="text-[11px] text-gray-dim text-center py-4">No se han registrado duelos de competencia.</p>
                ) : (
                  athleteDuels.map((duel) => {
                    const dateStr = new Date(duel.timestamp).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short"
                    });
                    
                    return (
                      <div
                        key={duel.uid || duel.id}
                        className="bg-neutral-900/20 p-3.5 rounded-xl border border-white/[0.03] flex items-center justify-between"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-gray-dim uppercase">
                              {duel.distance}m
                            </span>
                            <span className="text-[10px] text-white font-extrabold">vs {duel.opponent}</span>
                          </div>
                          <span className="text-[8px] text-gray-dim">{dateStr} · {duel.opponentClubName || "Club rival"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/90 font-extrabold">{duel.score} pts</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            duel.outcome === "win"
                              ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/20 shadow-glow-cyan"
                              : duel.outcome === "loss"
                              ? "bg-red-rival/15 text-red-rival border border-red-rival/20"
                              : "bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/20"
                          }`}>
                            {duel.outcome === "win" ? "Ganó" : duel.outcome === "loss" ? "Perdió" : "Empate"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 5: TENDENCIAS */}
          {activeTab === "TENDENCIAS" && (
            <div className="flex flex-col gap-4">
              <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                <span className="text-[10px] text-cyan-neon font-black tracking-wider uppercase">Progresión de Rendimiento</span>
                
                {athleteSessions.length < 2 ? (
                  <p className="text-[11px] text-gray-dim text-center py-6">
                    Se necesitan al menos 2 sesiones de control para calcular la tendencia de rendimiento.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="w-full h-32 relative">
                      {/* Simple SVG Chart */}
                      <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible">
                        <path
                          d={`M 5,35 ${athleteSessions.slice(0, 6).reverse().map((s, idx, arr) => {
                            const step = arr.length > 1 ? 90 / (arr.length - 1) : 90;
                            const x = 5 + idx * step;
                            const pct = s.maxScore > 0 ? s.score / s.maxScore : 0;
                            const y = 38 - pct * 30; // mapping 0.5-1.0 to 38-8
                            return `L ${x},${y}`;
                          }).join(" ")}`}
                          fill="none"
                          stroke="#00E5FF"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        {athleteSessions.slice(0, 6).reverse().map((s, idx, arr) => {
                          const step = arr.length > 1 ? 90 / (arr.length - 1) : 90;
                          const x = 5 + idx * step;
                          const pct = s.maxScore > 0 ? s.score / s.maxScore : 0;
                          const y = 38 - pct * 30;
                          return (
                            <g key={idx}>
                              <circle cx={x} cy={y} r="1.5" className="fill-cyan-neon stroke-black stroke-[0.4px]" />
                              <text x={x} y={y - 2.5} fontSize="3" fontWeight="bold" fill="white" textAnchor="middle">
                                {s.score}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                    <span className="text-[8px] text-gray-dim uppercase font-black text-center mt-1">
                      Últimos 6 entrenamientos · Escala de puntuación
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-[8px] text-gray-dim uppercase block">Puntaje Promedio</span>
                  <span className="text-base font-black text-white">
                    {athleteSessions.length > 0
                      ? Math.round(athleteSessions.reduce((acc, s) => acc + s.score, 0) / athleteSessions.length)
                      : "—"}
                  </span>
                </div>
                <div className="bg-neutral-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-[8px] text-gray-dim uppercase block">Puntaje Máximo</span>
                  <span className="text-base font-black text-yellow-gold">
                    {athleteSessions.length > 0
                      ? Math.max(...athleteSessions.map(s => s.score))
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: NOTAS COACH */}
          {activeTab === "NOTAS" && (
            <div className="flex flex-col gap-4">
              {/* Form to add note */}
              <form onSubmit={handleAddNote} className="flex gap-2 shrink-0">
                <input
                  type="text"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  placeholder="Añadir una observación de técnica..."
                  className="flex-1 bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-2.5 rounded-xl outline-none placeholder:text-gray-dim focus:ring-1 focus:ring-cyan-neon/30"
                />
                <button
                  type="submit"
                  className="w-10 h-10 rounded-xl bg-cyan-neon hover:bg-cyan-brand text-black flex items-center justify-center transition cursor-pointer shrink-0"
                >
                  <Send size={15} />
                </button>
              </form>

              {/* Notes Timeline List */}
              <div className="flex flex-col gap-2.5 mt-1">
                {notes.length === 0 ? (
                  <p className="text-[11px] text-gray-dim text-center py-6">
                    No has añadido notas a este atleta. Tus anotaciones son privadas y te ayudan a estructurar su macrociclo.
                  </p>
                ) : (
                  notes.map((note) => {
                    const noteDate = new Date(note.date).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit"
                    });

                    return (
                      <div
                        key={note.id}
                        className="bg-neutral-900/50 p-3 rounded-xl border border-white/5 flex flex-col gap-1.5"
                      >
                        <p className="text-white text-xs font-medium leading-relaxed">
                          {note.content}
                        </p>
                        <span className="text-[8px] text-gray-dim self-end font-bold uppercase">
                          {noteDate}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
