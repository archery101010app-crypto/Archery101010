"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, deleteLocalSession, addToSyncQueue, generateResilientId, getLocalSession, saveLocalSession } from "@/lib/db/indexedDB";
import { runSync } from "@/lib/db/syncManager";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Filter, Target, Trash2, ArrowLeft, Share2, Award, FileText, ChevronRight, Camera } from "lucide-react";
import { DIANA_PRESETS, getDianaPresetKey } from "../scoring/ScoringView";
import { calculateDispersionStats, calculateDispersionAnalysis } from "@/lib/scoring/dispersionAnalytics";
import { shareTargetShotChart } from "@/lib/scoring/targetImageGenerator";

interface HistoryViewProps {
  user: UserProfile;
  initialTab?: "SESSIONS" | "VOLUME";
  onBack: () => void;
}

export default function HistoryView({ user, initialTab, onBack }: HistoryViewProps) {
  const { language, t } = useLanguage();
  
  // Data State
  const [sessions, setSessions] = useState<any[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<any[]>([]);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  
  // Navigation State
  const [activeTab, setActiveTab] = useState<"SESSIONS" | "VOLUME">(initialTab || "SESSIONS");
  
  // Filter States
  const [dateFilter, setDateFilter] = useState<"7DAYS" | "MONTH" | "ALL">("ALL");
  const [practiceFilter, setPracticeFilter] = useState<string>("ALL");
  const [bowFilter, setBowFilter] = useState<string>("ALL");
  
  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const handleShareSessionShotChart = async (session: any) => {
    if (!session) return;
    if (session.impacts && session.impacts.length > 0) {
      setIsGeneratingImage(true);
      try {
        const archerName = user.nickname || user.fullName || "Arquero";
        const presetType = getDianaPresetKey(session.bowType, session.distance, session.format, session.targetType);
        const tens = (session.ends || []).reduce((acc: number, e: any) => acc + (e.arrows || []).filter((a: string) => a === "10" || a === "X").length, 0);
        const xs = (session.ends || []).reduce((acc: number, e: any) => acc + (e.arrows || []).filter((a: string) => a === "X").length, 0);
        const dispersion = calculateDispersionAnalysis(
          session.impacts,
          Number(session.distance) || 18,
          session.bowType || "Recurve",
          presetType,
          session.format,
          session.targetType
        );
        const dateStr = new Date(session.timestamp).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

        await shareTargetShotChart({
          impacts: session.impacts,
          presetType,
          score: session.score || 0,
          maxScore: session.maxScore || 300,
          tensCount: tens,
          xsCount: xs,
          distanceM: Number(session.distance) || 18,
          bowType: session.bowType || "Recurve",
          archerName,
          dateStr,
          dispersion
        });
      } catch (err) {
        console.error("Error sharing target shot chart from History:", err);
      } finally {
        setIsGeneratingImage(false);
      }
    } else {
      const bowLabel = session.bowType === "Recurve" ? "Recurvo" : session.bowType === "Compound" ? "Compuesto" : (session.bowType || "Barebow");
      const text = `🎯 *ARCHERY 101010 - Planilla de Tiro*\n🏹 *Arquero:* ${user.fullName || "Arquero"}\n📋 *Formato:* ${session.format} · ${bowLabel} · ${session.distance}m\n🏆 *Puntaje:* ${session.score} / ${session.maxScore} pts (${session.maxScore > 0 ? Math.round((session.score / session.maxScore) * 100) : 0}%)`;
      if (typeof navigator !== "undefined" && navigator.share) {
        navigator.share({ title: "Planilla - Archery 101010", text }).catch(() => {});
      } else {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank");
      }
    }
  };

  const loadSessions = async () => {
    const list = await getLocalSessions();
    setSessions(list);
    setFilteredSessions(list);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  // Filter application trigger
  useEffect(() => {
    let result = [...sessions].filter(s => s.deletedByArcher !== true);

    // 1. Date range filter
    const now = Date.now();
    if (dateFilter === "7DAYS") {
      const limit = now - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((s) => s.timestamp >= limit);
    } else if (dateFilter === "MONTH") {
      const limit = now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((s) => s.timestamp >= limit);
    }

    // 2. Practice Type filter
    if (practiceFilter !== "ALL") {
      result = result.filter((s) => s.practiceType === practiceFilter);
    }

    // 3. Bow Type filter
    if (bowFilter !== "ALL") {
      result = result.filter((s) => s.bowType === bowFilter);
    }

    setFilteredSessions(result);
  }, [dateFilter, practiceFilter, bowFilter, sessions]);

  // Personal Best (Best Score) calculation separated by format + bowType + distance + maxScore
  const getCategoryKey = (s: any) =>
    `${s.bowType || "Recurve"}_${s.format || "Libre"}_${s.distance || 18}_${s.maxScore || 300}`;

  const pbByCategory = React.useMemo(() => {
    const map: Record<string, number> = {};
    sessions
      .filter((s) => !s.deletedByArcher)
      .forEach((s) => {
        const key = getCategoryKey(s);
        const sc = s.score || 0;
        if (sc > 0 && (!map[key] || sc > map[key])) {
          map[key] = sc;
        }
      });
    return map;
  }, [sessions]);

  const isSessionPB = (s: any): boolean => {
    const key = getCategoryKey(s);
    const best = pbByCategory[key] || 0;
    return best > 0 && s.score === best;
  };

  const handleDelete = async (id: string) => {
    try {
      const session = await getLocalSession(id);
      if (!session) return;

      if (session.isDraft) {
        // Borrado físico para borradores locales
        await deleteLocalSession(id);
      } else {
        // Borrado lógico (suave) para sesiones completadas
        const updatedSession = { ...session, deletedByArcher: true };
        await saveLocalSession(id, updatedSession);
        
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "UPDATE",
          payloadId: id,
          payload: updatedSession,
          timestamp: Date.now()
        });
      }

      // Trigger sync in background
      runSync();

      setSelectedSession(null);
      setConfirmDeleteId(null);
      
      // Reload sessions list
      loadSessions();
    } catch (e) {
      console.error("Could not delete session", e);
    }
  };

  const getArrowColorClass = (val: string) => {
    if (val === "X" || val === "10" || val === "9") return "bg-yellow-gold text-black border-yellow-gold/20";
    if (val === "8" || val === "7") return "bg-red-500 text-white border-red-500/20";
    if (val === "6" || val === "5") return "bg-blue-500 text-white border-blue-500/20";
    if (val === "4" || val === "3") return "bg-neutral-900 border-neutral-700 text-white";
    if (val === "M") return "bg-red-rival text-white border-red-rival/20";
    return "bg-white text-black border-white/20";
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Volume stats calculations
  const calculateVolumeStats = () => {
    let total = 0;
    let recurve = 0;
    let compound = 0;
    let barebow = 0;
    let control = 0;
    let practice = 0;
    let volume = 0;

    sessions.forEach((s) => {
      if (s.deletedByArcher) return;
      const arrows = (s.endsCount || 0) * (s.arrowsPerEnd || 0);
      total += arrows;
      
      if (s.bowType === "Recurve") recurve += arrows;
      else if (s.bowType === "Compound") compound += arrows;
      else if (s.bowType === "Barebow") barebow += arrows;

      if (s.practiceType === "Control") control += arrows;
      else if (s.practiceType === "Práctica") practice += arrows;
      else if (s.practiceType === "Volumen") volume += arrows;
    });

    return { total, recurve, compound, barebow, control, practice, volume };
  };

  const volStats = calculateVolumeStats();

  return (
    <div className="flex flex-col gap-4 py-4 min-h-full">
      {/* Header with Navigation Tabs */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-white text-lg font-black uppercase tracking-wide">
              {t("historyTitle")}
            </h2>
            <p className="text-[10px] text-gray-dim uppercase tracking-wider">Historial</p>
          </div>
        </div>

        {/* Tab Selector Buttons */}
        <div className="flex bg-neutral-900 p-0.5 rounded-full border border-gray-border">
          <button
            onClick={() => setActiveTab("SESSIONS")}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide cursor-pointer transition ${
              activeTab === "SESSIONS" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            Sesiones
          </button>
          <button
            onClick={() => setActiveTab("VOLUME")}
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide cursor-pointer transition ${
              activeTab === "VOLUME" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            Volumen
          </button>
        </div>
      </div>

      {activeTab === "SESSIONS" ? (
        <>
          {/* Filter Panel */}
          <div className="bg-neutral-900/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
            {/* Date Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-[10px] text-gray-dim font-bold uppercase tracking-wider min-w-[46px] shrink-0">
                Fecha:
              </span>
              <div className="flex gap-1.5">
                {[
                  { id: "ALL", label: t("allTime") },
                  { id: "7DAYS", label: t("last7Days") },
                  { id: "MONTH", label: t("thisMonth") }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setDateFilter(f.id as any)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold cursor-pointer transition shrink-0 whitespace-nowrap ${
                      dateFilter === f.id
                        ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30 shadow-glow-cyan"
                        : "bg-neutral-950 border border-white/5 text-gray-dim"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Practice Type Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-[10px] text-gray-dim font-bold uppercase tracking-wider min-w-[46px] shrink-0">
                Tipo:
              </span>
              <div className="flex gap-1.5">
                {[
                  { id: "ALL", label: t("filterAll") },
                  { id: "Control", label: t("practiceControl") },
                  { id: "Práctica", label: t("practicePractice") },
                  { id: "Volumen", label: t("practiceVolume") }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setPracticeFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold cursor-pointer transition shrink-0 whitespace-nowrap ${
                      practiceFilter === f.id
                        ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30 shadow-glow-cyan"
                        : "bg-neutral-950 border border-white/5 text-gray-dim"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bow Type Filters */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] text-gray-dim font-bold uppercase tracking-wider min-w-[46px] shrink-0">
                Arco:
              </span>
              <div className="flex gap-1.5">
                {[
                  { id: "ALL", label: t("filterAll") },
                  { id: "Recurve", label: "Recurvo" },
                  { id: "Compound", label: "Compuesto" },
                  { id: "Barebow", label: "Barebow" }
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setBowFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold cursor-pointer transition shrink-0 whitespace-nowrap ${
                      bowFilter === f.id
                        ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30 shadow-glow-cyan"
                        : "bg-neutral-950 border border-white/5 text-gray-dim"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Session list items */}
          <div className="flex-1 flex flex-col gap-2.5">
            {filteredSessions.length === 0 ? (
              <div className="text-center py-10 text-gray-dim text-xs">
                No se encontraron sesiones registradas.
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isPB = isSessionPB(session);
                
                return (
                  <motion.div
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    whileHover={{ scale: 1.01 }}
                    className="bg-neutral-900/60 backdrop-blur border border-white/10 p-4 rounded-2xl cursor-pointer hover:border-cyan-neon/20 transition-all duration-200 flex items-center justify-between group"
                  >
                    <div className="flex flex-col gap-1 w-[70%] min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-dim font-bold">{formatDate(session.timestamp)}</span>
                        <span className="text-[8px] bg-neutral-950 text-cyan-neon px-1.5 py-0.5 rounded border border-cyan-neon/10 font-bold uppercase">
                          {session.practiceType === "Control" ? t("practiceControl") : session.practiceType}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="text-xl font-black text-white">{session.score}</span>
                        <span className="text-[10px] text-gray-dim">/ {session.maxScore}</span>
                        {session.maxScore > 0 && (
                          <span className="text-[11px] text-yellow-gold font-bold ml-1">
                            {Math.round((session.score / session.maxScore) * 100)}%
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-dim truncate">
                        {session.format} · {session.bowType === "Recurve" ? "Recurvo" : session.bowType === "Compound" ? "Compuesto" : session.bowType} · {session.distance}m
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPB && (
                        <span className="bg-yellow-gold/15 text-yellow-gold font-black border border-yellow-gold/25 text-[8px] px-2 py-0.5 rounded-full shadow-glow-yellow animate-pulse uppercase">
                          🏆 PB
                        </span>
                      )}
                      <ChevronRight size={16} className="text-gray-dim group-hover:text-white transition-colors" />
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* VOLUME TAB VIEW */
        <div className="flex-1 flex flex-col gap-4">
          
          {/* Card Volume Giant */}
          <div className="bg-neutral-900/40 p-5 rounded-3xl border border-white/5 flex flex-col gap-1.5 relative overflow-hidden shadow-sm">
            <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase">
              Volumen Acumulado
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-white">{volStats.total}</span>
              <span className="text-xs text-gray-dim font-bold">flechas registradas</span>
            </div>
            <p className="text-[10px] text-gray-dim leading-relaxed">
              Cada tiro registrado en tus prácticas libres, de volumen o controles oficiales suma a tu carga total.
            </p>
          </div>

          {/* Volume by Bow & Practice Type */}
          <div className="grid grid-cols-2 gap-3">
            
            {/* Widget: Arco Volumen */}
            <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-[9px] text-yellow-gold font-black tracking-wider uppercase">Por Tipo de Arco</span>
              
              <div className="flex flex-col gap-2.5">
                {[
                  { name: "Recurve", val: volStats.recurve },
                  { name: "Compound", val: volStats.compound },
                  { name: "Barebow", val: volStats.barebow }
                ].map((item) => {
                  const percent = volStats.total > 0 ? Math.round((item.val / volStats.total) * 100) : 0;
                  return (
                    <div key={item.name} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] font-bold text-white">
                        <span>{item.name}</span>
                        <span className="text-yellow-gold">{item.val} ({percent}%)</span>
                      </div>
                      <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-white/5">
                        <div
                          className="bg-yellow-gold h-full rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Widget: Práctica Volumen */}
            <div className="bg-neutral-900/60 border border-white/10 rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-[9px] text-cyan-brand font-black tracking-wider uppercase">Por Práctica</span>
              
              <div className="flex flex-col gap-2.5">
                {[
                  { name: "Control", val: volStats.control },
                  { name: "Práctica", val: volStats.practice },
                  { name: "Volumen", val: volStats.volume }
                ].map((item) => {
                  const percent = volStats.total > 0 ? Math.round((item.val / volStats.total) * 100) : 0;
                  return (
                    <div key={item.name} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] font-bold text-white">
                        <span>{item.name}</span>
                        <span className="text-cyan-neon">{item.val} ({percent}%)</span>
                      </div>
                      <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-white/5">
                        <div
                          className="bg-cyan-neon h-full rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Simplied List of Volume sessions */}
          <div className="flex flex-col gap-2">
            <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1">
              Registro Histórico de Carga
            </h4>
            
            <div className="flex flex-col gap-2">
              {sessions.filter(s => s.deletedByArcher !== true).length === 0 ? (
                <div className="text-center py-8 text-gray-dim text-xs">
                  No hay sesiones para calcular volumen.
                </div>
              ) : (
                sessions.filter(s => s.deletedByArcher !== true).map((s) => {
                  const arrows = (s.endsCount || 0) * (s.arrowsPerEnd || 0);
                  return (
                    <div
                      key={s.id}
                      className="bg-neutral-900/40 border border-white/5 p-3.5 rounded-2xl flex justify-between items-center"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-gray-500 font-bold">{formatDate(s.timestamp)}</span>
                        <span className="text-xs font-bold text-white uppercase">{s.format} ({s.distance}m)</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-black text-cyan-neon">+{arrows}</span>
                        <span className="text-[9px] text-gray-dim block font-bold uppercase">{s.practiceType}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      )}

      {/* DETAILED EXPANDED SESSION MODAL (Full screen overlay) */}
      <AnimatePresence>
        {selectedSession && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black-oled overflow-y-auto p-5 flex flex-col gap-5 pt-10"
          >
            {/* Top Toolbar */}
            <div className="flex justify-between items-center">
              <button
                onClick={() => setSelectedSession(null)}
                className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleShareSessionShotChart(selectedSession)}
                  disabled={isGeneratingImage}
                  className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-cyan-neon hover:border-cyan-neon transition cursor-pointer disabled:opacity-50"
                  title="Compartir Foto Diana HD o Planilla"
                >
                  <Share2 size={16} />
                </button>
                <button
                  onClick={() => setConfirmDeleteId(selectedSession.id)}
                  className="p-2 rounded-xl bg-neutral-900 border border-red-rival/20 text-red-rival cursor-pointer"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Title / Header */}
            <div>
              <h3 className="text-white text-lg font-black uppercase tracking-wide">
                Detalle de Entrenamiento
              </h3>
              <p className="text-xs text-gray-dim mt-0.5">
                {formatDate(selectedSession.timestamp)} · {selectedSession.format}
              </p>
            </div>

            {/* Giant Score Summary */}
            <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/5 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="text-[9px] text-gray-dim font-bold uppercase tracking-widest">Puntos Totales</span>
                <span className="text-3xl font-black text-white">
                  {selectedSession.score} <span className="text-xs text-gray-dim">/ {selectedSession.maxScore}</span>
                </span>
              </div>
              <div className="text-right">
                <span className="text-[9px] text-gray-dim font-bold uppercase tracking-widest">Precisión</span>
                <p className="text-2xl font-black text-yellow-gold leading-tight">
                  {selectedSession.maxScore > 0 ? Math.round((selectedSession.score / selectedSession.maxScore) * 100) : 0}%
                </p>
              </div>
            </div>

            {/* Metadata Chips Grid */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-neutral-900/30 border border-white/5 p-2 rounded-xl text-center">
                <span className="text-[8px] text-gray-dim uppercase block">Distancia</span>
                <span className="text-xs font-extrabold text-cyan-neon mt-0.5 block">{selectedSession.distance}m</span>
              </div>
              <div className="bg-neutral-900/30 border border-white/5 p-2 rounded-xl text-center">
                <span className="text-[8px] text-gray-dim uppercase block">Arco</span>
                <span className="text-xs font-extrabold text-cyan-neon mt-0.5 block truncate">
                  {selectedSession.bowType === "Recurve" ? "Recurvo" : selectedSession.bowType === "Compound" ? "Compuesto" : selectedSession.bowType}
                </span>
              </div>
              <div className="bg-neutral-900/30 border border-white/5 p-2 rounded-xl text-center">
                <span className="text-[8px] text-gray-dim uppercase block">Tipo</span>
                <span className="text-xs font-extrabold text-cyan-neon mt-0.5 block truncate">
                  {selectedSession.practiceType === "Control" ? t("practiceControl") : selectedSession.practiceType}
                </span>
              </div>
              <div className="bg-neutral-900/30 border border-white/5 p-2 rounded-xl text-center">
                <span className="text-[8px] text-gray-dim uppercase block">Rondas</span>
                <span className="text-xs font-extrabold text-cyan-neon mt-0.5 block">{selectedSession.endsCount} Ends</span>
              </div>
            </div>

            {/* Bloques y Fatiga report (para WA600/720 en Historial) */}
            {selectedSession.blockStats && (
              <div className="bg-neutral-900/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2 text-xs">
                <span className="text-[9px] text-gray-dim uppercase font-bold">Rendimiento por Bloques</span>
                <div className="flex justify-between text-white/80">
                  <span>Bloque 1 (Primera Mitad):</span>
                  <span className="font-extrabold text-cyan-neon">{selectedSession.blockStats.b1Score} pts</span>
                </div>
                {selectedSession.blockStats.completedB2 ? (
                  <>
                    <div className="flex justify-between text-white/80">
                      <span>Bloque 2 (Segunda Mitad):</span>
                      <span className="font-extrabold text-cyan-neon">{selectedSession.blockStats.b2Score} pts</span>
                    </div>
                    <div className="flex justify-between border-t border-white/5 pt-1.5 mt-0.5">
                      <span>Consistencia:</span>
                      <span className={`font-black uppercase text-[10px] ${selectedSession.blockStats.diff < 0 ? "text-red-500" : "text-cyan-neon"}`}>
                        {selectedSession.blockStats.diff > 0 ? `+${selectedSession.blockStats.diff}` : selectedSession.blockStats.diff} pts {selectedSession.blockStats.diff < 0 ? "(Fatiga)" : "(Excelente)"}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-yellow-gold italic mt-0.5 border-t border-white/5 pt-1">
                    Sesión finalizada anticipadamente (Bloque 2 no realizado).
                  </div>
                )}
              </div>
            )}

            {/* Ends breakdown lists */}
            <div className="bg-neutral-900/40 border border-white/5 rounded-2xl overflow-hidden p-4 flex flex-col gap-3">
              <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                <FileText size={14} className="text-cyan-neon" />
                Desglose de Rondas
              </h4>
              <div className="flex flex-col gap-2">
                {selectedSession.ends?.map((e: any, idx: number) => (
                  <div key={idx} className="flex flex-col border-b border-gray-border/20 pb-2 last:border-b-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-dim font-bold">End {idx + 1}</span>
                      <div className="flex items-center gap-1">
                        {e.arrows.map((a: string, arrowIdx: number) => (
                          <div
                            key={arrowIdx}
                            className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs border ${getArrowColorClass(
                              a
                            )}`}
                          >
                            {a}
                          </div>
                        ))}
                      </div>
                      <span className="text-xs font-extrabold text-white min-w-[28px] text-right">
                        {e.arrows.reduce((acc: number, val: string) => acc + (val === "X" || val === "10" ? 10 : val === "M" || val === "" ? 0 : Number(val)), 0)}
                      </span>
                    </div>
                    {e.note && (
                      <p className="text-[10px] text-gray-dim italic mt-1 pl-1">
                        📝 "{e.note}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Target SVG Impact Map (Overlay plots of shots) */}
            {selectedSession.impacts && selectedSession.impacts.length > 0 && (
              <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 items-center">
                <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 self-start">
                  <Target size={14} className="text-cyan-neon" />
                  {t("impactsMap")}
                </h4>
                {(() => {
                  const presetType = getDianaPresetKey(selectedSession.bowType, selectedSession.distance, selectedSession.format, selectedSession.targetType);
                  const presetRings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
                  const disp = calculateDispersionStats(
                    selectedSession.impacts,
                    Number(selectedSession.distance) || 18,
                    selectedSession.bowType,
                    selectedSession.format,
                    selectedSession.targetType
                  );
                  
                  return (
                    <>
                      <svg
                        viewBox="0 0 100 100"
                        className="w-full max-w-[242px] aspect-square rounded-full border-2 border-neutral-800 bg-black overflow-visible relative mt-2"
                      >
                        {presetRings.map((ring, index) => (
                          <circle
                            key={index}
                            cx="50"
                            cy="50"
                            r={ring.r}
                            fill={ring.fill}
                            stroke={ring.stroke}
                            strokeWidth={ring.v === "X" ? 0.15 : 0.2}
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
                        
                        {selectedSession.impacts.map((imp: any, idx: number) => (
                          <g key={idx}>
                            <circle cx={imp.x} cy={imp.y} r="1.4" className="fill-yellow-gold stroke-black stroke-[0.3px]" />
                            <text x={imp.x} y={imp.y + 0.5} textAnchor="middle" fontSize="1.3" fontWeight="black" fill="black">
                              {imp.value === "X" ? "X" : imp.value}
                            </text>
                          </g>
                        ))}
                      </svg>
                      {disp && (
                        <div className="w-full grid grid-cols-2 gap-2 mt-2 text-center">
                          <div className="bg-neutral-950/60 border border-white/5 rounded-xl p-2">
                            <span className="text-[8px] text-gray-dim uppercase font-bold block">Agrupación Real</span>
                            <span className="text-xs font-black text-cyan-neon">{disp.groupRadiusCm} cm</span>
                          </div>
                          <div className="bg-neutral-950/60 border border-white/5 rounded-xl p-2">
                            <span className="text-[8px] text-gray-dim uppercase font-bold block">Centro (+) vs X</span>
                            <span className="text-xs font-black text-white">
                              {Math.hypot(disp.offsetCmX, disp.offsetCmY).toFixed(1)} cm
                            </span>
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleShareSessionShotChart(selectedSession)}
                        disabled={isGeneratingImage}
                        className="w-full py-3 mt-1 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.2)] transition active:scale-95 cursor-pointer disabled:opacity-50"
                      >
                        <Camera size={15} />
                        <span>{isGeneratingImage ? "Generando Foto HD..." : "Compartir Foto Diana (HD)"}</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Session final Notes sumary card */}
            {selectedSession.sessionNote && (
              <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-1.5">
                <span className="text-xs text-gray-dim font-bold uppercase tracking-wider">
                  Notas de la Sesión
                </span>
                <p className="text-xs text-white leading-relaxed italic">
                  "{selectedSession.sessionNote}"
                </p>
              </div>
            )}

            {/* Bottom spacer */}
            <div className="h-10" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* CONFIRM DELETE MODAL OVERLAY */}
      <AnimatePresence>
        {confirmDeleteId && (
          <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-neutral-900 border border-gray-border rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
              <h3 className="text-white text-base font-black uppercase">¿Eliminar Sesión?</h3>
              <p className="text-xs text-gray-dim">
                Esta acción no se puede deshacer. Se eliminará también de la nube cuando te conectes.
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="flex-1 py-3 rounded-full bg-red-rival text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 py-3 rounded-full bg-transparent border border-gray-border text-gray-dim hover:text-white font-bold text-xs uppercase cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
