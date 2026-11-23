"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate } from "@/lib/i18n/regionalUtils";
import {
  Award,
  Share2,
  ChevronDown,
  ChevronUp,
  User,
  Target,
  Star,
  Search,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DIANA_PRESETS, getDianaPresetKey } from "../../scoring/ScoringView";
import {
  calculateDispersionStats,
  calculateDispersionAnalysis
} from "@/lib/scoring/dispersionAnalytics";
import {
  isVolumeSession,
  isAnalysisOnlySession,
  getSessionArrows,
  getSessionScore,
  getSessionMaxScore,
  hasRealScore,
  countScoredArrows,
  getSessionHeartRateStats
} from "@/lib/scoring/sessionMetrics";
import {
  getSessionDistanceWalkedM,
  getSessionActiveKcal,
  formatKmAndMiles
} from "@/lib/scoring/biometricsEngine";
import { AnalysisHistoryListSection } from "@/components/analysis/AnalysisInspectorShared";

interface CoachSessionsTabProps {
  athletes: UserProfile[];
  sessions: any[];
}

export default function CoachSessionsTab({ athletes, sessions }: CoachSessionsTabProps) {
  const { language, t, tx } = useLanguage();
  const isEs = language === "es";
  const [subMode, setSubMode] = useState<"SCORES" | "VOLUME" | "ANALYSIS">("SCORES");
  const [selectedAthleteUid, setSelectedAthleteUid] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");
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

  const getLiveSafeArrows = (s: any): number => {
    if (s?.isDraft) {
      return Math.max(
        Number(s.totalArrowsVolume) || 0,
        countScoredArrows(s) + (Number(s.warmupArrows) || 0)
      );
    }
    return getSessionArrows(s);
  };

  const formatBowLabel = (bow?: string) => {
    const raw =
      !bow || bow === "Recurve"
        ? t("bowRecurve")
        : bow === "Compound"
        ? t("bowCompound")
        : bow === "Barebow"
        ? t("bowBarebow")
        : bow;
    return isEs ? raw : raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  const formatPracticeType = (rawType?: string, fallback?: string) => {
    if (isEs) return rawType || fallback || "";
    if (!rawType) return fallback || "";
    const raw =
      rawType === "Control"
        ? t("practiceControl")
        : rawType === "Práctica"
        ? t("practicePractice")
        : rawType === "Volumen"
        ? t("practiceVolume")
        : rawType === "Análisis"
        ? t("navAnalysis")
        : rawType;
    return raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  const formatSessionFormat = (rawFormat?: string, fallback?: string) => {
    if (isEs) return rawFormat || fallback || "";
    const f = rawFormat || fallback || "";
    if (f === "Libre") return "Custom";
    return f.replace(/\(Bloque\s*(\d+)\)/gi, "(Block $1)");
  };

  // Only real shooting sessions (not duels)
  const athleteSessions = sessions.filter((s) => !s.isDuel && s.deletedByArcher !== true);

  // Filtered by selected athlete, search term, and mode (SCORES vs VOLUME)
  const filteredSessions = athleteSessions
    .filter((s) => {
      const matchesAthlete =
        selectedAthleteUid === "ALL" ||
        s.userId === selectedAthleteUid ||
        s.userUid === selectedAthleteUid;
      if (!matchesAthlete) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const hay = `${s.userName || ""} ${s.format || ""} ${s.practiceType || ""} ${
          s.distance || ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (s.isDraft) {
        if (subMode === "SCORES") return !isVolumeSession(s) && !isAnalysisOnlySession(s);
        return true;
      }
      if (subMode === "SCORES") {
        return hasRealScore(s);
      }
      return getSessionArrows(s) > 0;
    })
    .sort((a, b) => {
      if (Boolean(a.isDraft) !== Boolean(b.isDraft)) return a.isDraft ? -1 : 1;
      return (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0);
    });

  // Calculate weekly ranking (Top 3 scores — strictly completed non-draft sessions)
  const getWeeklyRanking = () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklySess = athleteSessions.filter(
      (s) => !s.isDraft && s.timestamp >= oneWeekAgo && hasRealScore(s)
    );

    const maxScores: Record<string, { userName: string; score: number; format: string }> = {};
    weeklySess.forEach((s) => {
      const uid = s.userId || s.userUid;
      const sc = getSessionScore(s);
      if (!maxScores[uid] || sc > maxScores[uid].score) {
        maxScores[uid] = {
          userName: s.userName || t("roleAthlete"),
          score: sc,
          format: formatSessionFormat(s.format, "WA 720")
        };
      }
    });

    return Object.values(maxScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  };

  const ranking = getWeeklyRanking();

  const handleSharePodium = () => {
    const rankingText =
      ranking.length > 0
        ? ranking.map((r, idx) => `${idx + 1}. ${r.userName} · ${r.score} pts (${r.format})`).join("\n")
        : tx("No hay registros esta semana.", "No scores logged this week.");

    const fullMessage = tx(
      `*REPORTE DE PUNTUACIONES · 101010 THE APP*\n\n*Top Podio de la Semana:*\n${rankingText}\n\nExcelente trabajo y disciplina a todos los arqueros.\n🎯 *101010 THE APP*`,
      `*SCORE REPORT · 101010 THE APP*\n\n*Weekly Top Podium:*\n${rankingText}\n\nGreat work and discipline from all archers.\n🎯 *101010 THE APP*`
    );
    if (typeof window !== "undefined" && (window as any).ArcheryNativeShare?.shareWhatsAppText) {
      (window as any).ArcheryNativeShare.shareWhatsAppText(fullMessage);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ text: fullMessage }).catch(() => {});
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
          <div className="flex justify-between items-center gap-2">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 min-w-0 flex-1">
              <Award size={14} className="text-yellow-gold shrink-0" />
              <span className="leading-snug">
                {tx("Podio de Puntuaciones de la Semana", "Weekly Score Podium")}
              </span>
            </h4>
            <button
              onClick={handleSharePodium}
              className="p-2 rounded-xl bg-neutral-950 border border-white/5 text-white hover:text-white cursor-pointer transition flex items-center gap-1 text-[10.5px] font-black uppercase tracking-wider shrink-0"
            >
              <Share2 size={10} className="shrink-0" />
              <span>{t("share")}</span>
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {ranking.map((rank, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-neutral-950/60 border border-white/[0.03]"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs tabular-nums shrink-0 ${
                      idx === 0
                        ? "bg-yellow-gold text-black"
                        : idx === 1
                        ? "bg-neutral-300 text-black"
                        : "bg-amber-600 text-white"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-white text-xs font-bold break-words leading-tight">{rank.userName}</span>
                    <span className="text-[9.3px] text-white uppercase break-words leading-tight">{rank.format}</span>
                  </div>
                </div>

                <span className="text-xs font-black text-cyan-neon tabular-nums shrink-0 whitespace-nowrap">
                  {rank.score} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control Filters: Buscador RTL + Selector de Alumno + Sub-pestañas Puntuaciones | Volumen */}
      <div className="bg-neutral-900/50 p-3 rounded-2xl border border-white/5 flex flex-col gap-2.5">
        <div className="relative w-full">
          <Search
            size={14}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-white pointer-events-none"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={tx(
              "Buscar por alumno, formato WA o distancia...",
              "Search by athlete, WA format or distance..."
            )}
            className="w-full h-9 bg-neutral-950 border border-white/10 focus:border-cyan-neon rounded-xl ps-9 pe-8 text-white text-xs outline-none transition placeholder:text-white/65"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              aria-label={tx("Limpiar búsqueda", "Clear search")}
              className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-white cursor-pointer"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-between items-stretch sm:items-center">
          {/* Selector de Alumno Específico */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <User size={13} className="text-cyan-neon shrink-0" />
            <select
              value={selectedAthleteUid}
              onChange={(e) => setSelectedAthleteUid(e.target.value)}
              className="bg-neutral-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs outline-none flex-1 min-w-0 break-words leading-tight cursor-pointer"
            >
              <option value="ALL">
                {tx(`Todos los Alumnos (${athletes.length})`, `All Athletes (${athletes.length})`)}
              </option>
              {athletes.map((a) => (
                <option key={a.uid} value={a.uid}>
                  {a.fullName} ({formatBowLabel(a.bowConfig?.type)})
                </option>
              ))}
            </select>
          </div>

          {/* Selector Puntuaciones | Volumen | Análisis */}
          <div className="grid grid-cols-3 sm:flex gap-1.5 shrink-0">
            <button
              onClick={() => setSubMode("SCORES")}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-center transition-all cursor-pointer break-words leading-tight ${
                subMode === "SCORES"
                  ? "bg-cyan-neon text-black font-extrabold"
                  : "bg-neutral-950 border border-white/5 text-white hover:text-white"
              }`}
            >
              {tx("Puntuaciones", "Scores")}
            </button>
            <button
              onClick={() => setSubMode("VOLUME")}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-center transition-all cursor-pointer break-words leading-tight ${
                subMode === "VOLUME"
                  ? "bg-cyan-neon text-black font-extrabold"
                  : "bg-neutral-950 border border-white/5 text-white hover:text-white"
              }`}
            >
              {t("practiceVolume")}
            </button>
            <button
              onClick={() => setSubMode("ANALYSIS")}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider text-center transition-all cursor-pointer break-words leading-tight ${
                subMode === "ANALYSIS"
                  ? "bg-cyan-neon text-black font-extrabold"
                  : "bg-neutral-950 border border-white/5 text-white hover:text-white"
              }`}
            >
              {t("navAnalysis")}
            </button>
          </div>
        </div>
      </div>

      {/* Feed Ordenado de Resultados Recibidos */}
      {subMode === "ANALYSIS" ? (
        <AnalysisHistoryListSection
          sessions={athleteSessions.filter(
            (s) =>
              selectedAthleteUid === "ALL" ||
              s.userId === selectedAthleteUid ||
              s.userUid === selectedAthleteUid
          )}
          isCoachResultsView={true}
        />
      ) : (
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center gap-2 flex-wrap px-1">
          <span className="text-[11.6px] text-white font-black uppercase tracking-wider tabular-nums">
            {subMode === "SCORES"
              ? `${tx("Puntajes Reportados", "Reported Scores")} (${filteredSessions.length})`
              : `${tx("Volumen por Sesión", "Session Volume")} (${filteredSessions.length})`}
          </span>
          <span className="text-[10.5px] text-white tabular-nums">
            {subMode === "VOLUME"
              ? `Total: ${filteredSessions.reduce(
                  (acc, s) => acc + getLiveSafeArrows(s),
                  0
                )} ${t("arrowsLabel")}`
              : tx("Orden cronológico más reciente", "Most recent first")}
          </span>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-10 bg-neutral-900/20 border border-white/5 rounded-2xl">
            <Target size={24} className="text-white mx-auto mb-2" />
            <p className="text-xs text-white font-bold">
              {subMode === "SCORES"
                ? tx("No hay puntuaciones reportadas aún.", "No reported scores yet.")
                : tx(
                    "No hay sesiones con volumen de flechas registrado.",
                    "No sessions with logged arrow volume yet."
                  )}
            </p>
          </div>
        ) : subMode === "VOLUME" ? (
          filteredSessions.map((sess) => {
            const sessAthlete = athletes.find(
              (a) =>
                a.uid === sess.athleteId || a.uid === sess.userId || a.uid === sess.userUid
            );
            const dateStr = formatRegionalDate(sess.updatedAt || sess.timestamp, language, {
              weekday: "short",
              day: "numeric",
              month: "short"
            });
            const totalArrows = getLiveSafeArrows(sess);

            return (
              <div
                key={sess.id}
                className={`bg-neutral-900/40 rounded-2xl border p-3.5 flex justify-between items-center gap-2 ${
                  sess.isDraft ? "border-emerald-500/35" : "border-white/5"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-xs text-cyan-neon shrink-0">
                    {(sess.userName || "AT").substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-xs font-bold leading-tight break-words">
                        {sess.userName || t("roleAthlete")}
                      </span>
                      {sess.isDraft && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider shrink-0">
                          ● {tx("EN VIVO", "LIVE")}
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] text-white mt-0.5 break-words leading-tight tabular-nums">
                      {dateStr} · {formatPracticeType(sess.practiceType, t("navSession"))} · {sess.distance || 18}m ·{" "}
                      {getSessionActiveKcal(sess, sessAthlete)} kcal ·{" "}
                      {formatKmAndMiles(getSessionDistanceWalkedM(sess), false)}
                      {(() => {
                        const hr = getSessionHeartRateStats(sess);
                        return hr.avgHeartRateBpm ? ` · ${hr.avgHeartRateBpm} BPM` : "";
                      })()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col text-end shrink-0">
                  <span className="text-base font-black text-cyan-neon leading-tight tabular-nums">
                    {totalArrows}
                  </span>
                  <span className="text-[9.3px] text-white font-bold">{t("arrowsLabel")}</span>
                </div>
              </div>
            );
          })
        ) : (
          filteredSessions.map((sess) => {
            const sessAthlete = athletes.find(
              (a) =>
                a.uid === sess.athleteId || a.uid === sess.userId || a.uid === sess.userUid
            );
            const isExpanded = expandedSessionId === sess.id;
            const sessTs = sess.updatedAt || sess.timestamp;
            const dateStr = formatRegionalDate(sessTs, language, {
              weekday: "short",
              day: "numeric",
              month: "short"
            });
            const timeStr = new Date(sessTs).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit"
            });

            const scoredArrows = sess.isDraft
              ? countScoredArrows(sess)
              : countScoredArrows(sess) ||
                (sess.endsCount && sess.arrowsPerEnd ? sess.endsCount * sess.arrowsPerEnd : 0);
            const realScore = getSessionScore(sess);
            const avgPerArrow =
              scoredArrows > 0 && realScore > 0 ? (realScore / scoredArrows).toFixed(1) : "—";
            const bowTypeLabel = formatBowLabel(sess.bowType);

            return (
              <div
                key={sess.id}
                className={`bg-neutral-900/40 rounded-2xl border overflow-hidden transition-all duration-300 hover:border-cyan-neon/20 ${
                  sess.isDraft ? "border-emerald-500/35" : "border-white/5"
                }`}
              >
                {/* Header card */}
                <div
                  onClick={() => setExpandedSessionId(isExpanded ? null : sess.id)}
                  className="p-3.5 flex justify-between items-center gap-2 cursor-pointer hover:bg-neutral-900/60 transition"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center font-black text-xs text-cyan-neon shrink-0">
                      {(sess.userName || "AT").substring(0, 2).toUpperCase()}
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-white text-xs font-bold leading-tight break-words">
                          {sess.userName || t("roleAthlete")}
                        </span>
                        {sess.isDraft && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider shrink-0">
                            ● {tx("EN VIVO", "LIVE")}
                          </span>
                        )}
                        <span className="text-[9.3px] bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon px-1.5 py-0.5 rounded-full font-black uppercase shrink-0">
                          {formatPracticeType(sess.practiceType, t("practiceControl"))}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-white mt-0.5 break-words leading-tight tabular-nums">
                        {formatSessionFormat(sess.format, "WA 720")} · {sess.distance || 18}m · {bowTypeLabel}
                        {sess.isDraft
                          ? ` · ${scoredArrows} ${tx("fl. en curso", "arr. live")}`
                          : ` · ${getSessionActiveKcal(sess, sessAthlete)} kcal · ${formatKmAndMiles(
                              getSessionDistanceWalkedM(sess),
                              false
                            )}`}{" "}
                        {(() => {
                          const hr = getSessionHeartRateStats(sess);
                          return hr.avgHeartRateBpm ? `· ${hr.avgHeartRateBpm} BPM ` : "";
                        })()}
                        · {dateStr} {timeStr}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="flex flex-col text-end tabular-nums">
                      <div className="flex items-baseline gap-1 justify-end">
                        <span className="text-base font-black text-cyan-neon leading-tight">
                          {realScore}
                        </span>
                        <span className="text-[9.3px] text-white font-bold">
                          /{getSessionMaxScore(sess)}
                        </span>
                      </div>
                      <span className="text-[9.3px] text-yellow-gold font-bold">
                        {avgPerArrow} {tx("pts/fl", "pts/arr")}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={15} className="text-cyan-neon shrink-0" />
                    ) : (
                      <ChevronDown size={15} className="text-white shrink-0" />
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
                          {t("impactsMap")}
                        </span>
                        <div className="w-[212px] h-[212px] rounded-full border border-white/5 bg-black flex items-center justify-center shadow-lg relative p-2">
                          {(() => {
                            const presetType = getDianaPresetKey(
                              sess.bowType,
                              sess.distance,
                              sess.format,
                              sess.targetType
                            );
                            const presetRings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
                            const disp =
                              sess.impacts && sess.impacts.length > 0
                                ? calculateDispersionStats(
                                    sess.impacts,
                                    Number(sess.distance) || 18,
                                    sess.bowType,
                                    sess.format,
                                    sess.targetType,
                                    language
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
                                        points={disp.hullPolygon
                                          .map((p) => `${p.x},${p.y}`)
                                          .join(" ")}
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
                                    <line
                                      x1={disp.centroidX - 2.2}
                                      y1={disp.centroidY}
                                      x2={disp.centroidX + 2.2}
                                      y2={disp.centroidY}
                                      stroke="#000000"
                                      strokeWidth="0.9"
                                      strokeLinecap="round"
                                    />
                                    <line
                                      x1={disp.centroidX}
                                      y1={disp.centroidY - 2.2}
                                      x2={disp.centroidX}
                                      y2={disp.centroidY + 2.2}
                                      stroke="#000000"
                                      strokeWidth="0.9"
                                      strokeLinecap="round"
                                    />
                                    <line
                                      x1={disp.centroidX - 2.0}
                                      y1={disp.centroidY}
                                      x2={disp.centroidX + 2.0}
                                      y2={disp.centroidY}
                                      stroke="#00E5FF"
                                      strokeWidth="0.55"
                                      strokeLinecap="round"
                                    />
                                    <line
                                      x1={disp.centroidX}
                                      y1={disp.centroidY - 2.0}
                                      x2={disp.centroidX}
                                      y2={disp.centroidY + 2.0}
                                      stroke="#00E5FF"
                                      strokeWidth="0.55"
                                      strokeLinecap="round"
                                    />
                                  </g>
                                )}
                                {sess.impacts &&
                                  sess.impacts.map((imp: any, iIdx: number) => (
                                    <g key={iIdx}>
                                      <circle cx={imp.x} cy={imp.y} r="2" fill="rgba(0,0,0,0.5)" />
                                      <circle
                                        cx={imp.x}
                                        cy={imp.y}
                                        r="1.3"
                                        fill="#FFF200"
                                        stroke="black"
                                        strokeWidth="0.3px"
                                      />
                                    </g>
                                  ))}
                              </svg>
                            );
                          })()}
                        </div>
                        {sess.impacts &&
                          sess.impacts.length > 0 &&
                          (() => {
                            const presetType = getDianaPresetKey(
                              sess.bowType,
                              sess.distance,
                              sess.format,
                              sess.targetType
                            );
                            const analysis = calculateDispersionAnalysis(
                              sess.impacts,
                              Number(sess.distance) || 18,
                              sess.bowType || "Recurve",
                              presetType,
                              sess.format,
                              sess.targetType,
                              language
                            );
                            if (!analysis) return null;
                            return (
                              <div className="w-full mt-2 bg-neutral-900/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-1.5 text-start">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10.5px] font-black uppercase text-cyan-neon tracking-wider">
                                    {tx(
                                      "Análisis de Grupo y Mira",
                                      "Grouping & Sight Analysis"
                                    )}
                                  </span>
                                  <span className="text-[11.6px] tabular-nums font-black text-white shrink-0">
                                    Ø {analysis.spreadCm.toFixed(1)} cm
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[11.6px]">
                                  <span className="text-white">
                                    {tx("Centro del grupo (+):", "Group center (+):")}
                                  </span>
                                  <span className="font-bold text-yellow-gold tabular-nums text-end">
                                    {analysis.clockDirection} (
                                    {analysis.distanceFromCenterCm.toFixed(1)} cm)
                                  </span>
                                </div>
                                <div className="text-[11.6px] text-white leading-snug bg-neutral-950/70 border border-white/5 rounded-xl p-2 mt-0.5">
                                  <span>{analysis.adviceText}</span>
                                </div>
                              </div>
                            );
                          })()}
                        {/* KCAL, DISTANCIA RECORRIDA y PULSACIONES para el Coach */}
                        {(() => {
                          const hr = getSessionHeartRateStats(sess);
                          return (
                            <div className={`w-full grid ${hr.avgHeartRateBpm ? "grid-cols-3" : "grid-cols-2"} gap-2 mt-1`}>
                              <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-2.5 flex flex-col min-w-0">
                                <span className="text-[9.5px] font-black uppercase text-white tracking-wider break-words leading-tight">
                                  {t("cardCalories")}
                                </span>
                                <span className="text-sm font-black text-white tabular-nums mt-0.5 break-words leading-tight">
                                  {getSessionActiveKcal(sess, sessAthlete)} kcal
                                </span>
                              </div>
                              <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-2.5 flex flex-col min-w-0">
                                <span className="text-[9.5px] font-black uppercase text-white tracking-wider break-words leading-tight">
                                  {t("cardWalked")}
                                </span>
                                <span className="text-sm font-black text-white tabular-nums mt-0.5 break-words leading-tight">
                                  {formatKmAndMiles(getSessionDistanceWalkedM(sess), false)}
                                </span>
                              </div>
                              {hr.avgHeartRateBpm && (
                                <div className="bg-neutral-900/70 border border-white/10 rounded-xl p-2.5 flex flex-col min-w-0">
                                  <span className="text-[9.5px] font-black uppercase text-white tracking-wider break-words leading-tight">
                                    {t("cardHeartRate")}
                                  </span>
                                  <span className="text-sm font-black text-white tabular-nums mt-0.5 break-words leading-tight">
                                    {hr.avgHeartRateBpm} BPM
                                  </span>
                                  {hr.maxHeartRateBpm && (
                                    <span className="text-[9px] font-bold text-yellow-gold tabular-nums break-words leading-tight">
                                      {tx("Máx", "Max")} {hr.maxHeartRateBpm}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Desglose de Series (Ends) */}
                      {sess.ends && Array.isArray(sess.ends) && sess.ends.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10.5px] text-white font-black uppercase tracking-wider tabular-nums">
                            {tx(
                              `Puntajes por Serie (${sess.ends.length} tandas)`,
                              `End Breakdown (${sess.ends.length} ends)`
                            )}
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {sess.ends.map((endItem: any, endIdx: number) => {
                              const endArrows: string[] = Array.isArray(endItem.arrows)
                                ? endItem.arrows
                                : [];
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
                                        className={`w-5 h-5 rounded flex items-center justify-center font-black text-[10.5px] tabular-nums shrink-0 ${
                                          arrowVal === "X" ||
                                          arrowVal === "10" ||
                                          arrowVal === "9"
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
                                  <span className="text-white font-extrabold text-end text-[11.6px] tabular-nums shrink-0 whitespace-nowrap">
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
                            {tx("Nota del Alumno:", "Athlete Note:")}
                          </span>
                          <p className="text-[12.8px] text-white italic select-text">
                            &ldquo;{sess.sessionNote}&rdquo;
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
      )}

      {/* Clasificación de Estrellas 101010 */}
      <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/5 flex flex-col gap-3 mt-2">
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <span className="text-yellow-gold text-sm">★</span>
          <span>{tx("Clasificación de Estrellas 101010 del Equipo", "Team 101010 Stars Leaderboard")}</span>
        </h4>

        {starRanking.length === 0 ? (
          <div className="text-center text-[11.6px] text-white py-4 border border-dashed border-white/5 rounded-xl">
            {tx(
              "Aún ningún arquero del roster ha ganado una Estrella 101010 (720).",
              "No archer on the roster has unlocked a 101010 Star (720) yet."
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {starRanking.map((rank, idx) => (
              <div
                key={rank.userId}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0E0E12]/80 border border-white/5"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="text-xs font-black text-white w-5 text-center tabular-nums shrink-0">
                    #{idx + 1}
                  </span>

                  <div
                    className="w-9 h-9 rounded-full border flex items-center justify-center text-xs font-black shrink-0"
                    style={{
                      borderColor: rank.starColor,
                      color: rank.starColor,
                      backgroundColor: `${rank.starColor}15`
                    }}
                    title={rank.starName}
                  >
                    <Star size={16} className="fill-current" />
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-white text-xs font-extrabold break-words leading-tight">
                      {rank.userName}
                    </span>
                    <span className="text-[9.3px] text-white uppercase font-bold break-words leading-tight">
                      {rank.starName} · {formatBowLabel(rank.bowType)}
                    </span>
                  </div>
                </div>

                <div className="text-end shrink-0 tabular-nums">
                  <span className="text-xs font-black text-cyan-neon block whitespace-nowrap">
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
