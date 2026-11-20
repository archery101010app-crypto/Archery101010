"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Play, Send, Trash2 } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate } from "@/lib/i18n/regionalUtils";
import AnalysisDianaSvg from "./AnalysisDianaSvg";
import {
  AnalysisShotRecord,
  computeAnalysisSessionSummary,
  extractAnalysisShots,
  isAnalysisSession
} from "@/lib/scoring/shotAnalysisEngine";

function renderImpactBadge(shot: AnalysisShotRecord) {
  const imp = shot.markedImpact;
  if (!imp) {
    return (
      <span className="h-[23px] px-1.5 rounded-[6px] bg-[#131722] border border-white/[0.10] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
        —
      </span>
    );
  }
  const isGold = imp.ringNumber >= 9;
  const isRed = imp.ringNumber >= 7 && imp.ringNumber <= 8;
  const isBlue = imp.ringNumber >= 5 && imp.ringNumber <= 6;
  const cls = isGold
    ? "bg-[#FFE500] text-black"
    : isRed
    ? "bg-[#FF1E1E] text-white"
    : isBlue
    ? "bg-[#00BFFF] text-black"
    : "bg-white text-black";
  return (
    <span
      className={`h-[23px] px-1.5 rounded-[6px] text-[11px] font-black flex items-center justify-center tabular-nums whitespace-nowrap ${cls}`}
    >
      {imp.scoreLabel}
    </span>
  );
}

/**
 * Athlete / Results History "Análisis" Tab View
 * Matches approved `analisis-historial-atleta-4k.png` 100%.
 */
export function AnalysisHistoryListSection({
  sessions,
  isCoachResultsView = false,
  onDeleteSession
}: {
  sessions: any[];
  isCoachResultsView?: boolean;
  onDeleteSession?: (sessionId: string) => void;
}) {
  const { language, t, tx } = useLanguage();

  const analysisSessions = sessions
    .filter((s) => s && s.deletedByArcher !== true && !s.isDraft && isAnalysisSession(s))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const [expandedId, setExpandedId] = useState<string | null>(
    () => analysisSessions[0]?.id || null
  );
  const [selectedShotBySess, setSelectedShotBySess] = useState<Record<string, number>>({});
  const [replayBySess, setReplayBySess] = useState<Record<string, number>>({});

  const allShots = analysisSessions.flatMap((s) => extractAnalysisShots(s));
  const globalSummary = computeAnalysisSessionSummary(allShots);

  const getBowLabel = (b?: string) => {
    if (b === "Recurve") return t("bowRecurve");
    if (b === "Compound") return t("bowCompound");
    if (b === "Barebow") return t("bowBarebow");
    return b || "Barebow";
  };

  if (analysisSessions.length === 0) {
    return (
      <div className="bg-[#0D1017]/80 border border-white/[0.08] rounded-3xl py-12 px-6 flex flex-col items-center justify-center text-center gap-1.5 my-2">
        <span className="text-white font-extrabold text-sm">
          {tx("Aún no hay sesiones de análisis guardadas", "No saved analysis sessions yet")}
        </span>
        <span className="text-white text-xs max-w-[280px]">
          {tx(
            "Tus sesiones registradas desde la pestaña Análisis con tu reloj inteligente aparecerán aquí.",
            "Sessions recorded from the Analysis tab with your smartwatch will appear here."
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 4-Column Period Averages Summary Strip */}
      <div className="bg-gradient-to-b from-[#10141E] to-[#090C12] border border-white/[0.11] rounded-[20px] p-3 grid grid-cols-4 gap-1.5">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-white truncate">
            {tx("Estabilidad", "Stability")}
          </span>
          <span className="text-[18px] font-black text-white tabular-nums leading-tight">
            {globalSummary.avgStabilityPct}
            <span className="text-[11px] font-bold ml-0.5">%</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5 min-w-0 border-l border-white/[0.08] pl-2">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-white truncate">
            {tx("Prep. Media", "Avg Prep")}
          </span>
          <span className="text-[18px] font-black text-white tabular-nums leading-tight">
            {globalSummary.avgPrepSeconds.toFixed(1)}
            <span className="text-[11px] font-bold ml-0.5">s</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5 min-w-0 border-l border-white/[0.08] pl-2">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-white truncate">
            {tx("Apuntado", "Aiming")}
          </span>
          <span className="text-[18px] font-black text-white tabular-nums leading-tight">
            {globalSummary.avgAimSeconds.toFixed(1)}
            <span className="text-[11px] font-bold ml-0.5">s</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5 min-w-0 border-l border-white/[0.08] pl-2">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-white truncate">
            {tx("Suelta", "Release")}
          </span>
          <span className="text-[18px] font-black text-white tabular-nums leading-tight">
            {globalSummary.avgReleaseJumpCm.toFixed(1)}
            <span className="text-[11px] font-bold ml-0.5">cm</span>
          </span>
        </div>
      </div>

      {/* Expandable Saved Analysis Sessions */}
      {analysisSessions.map((sess) => {
        const shots = extractAnalysisShots(sess);
        const sessSummary = computeAnalysisSessionSummary(shots);
        const isOpen = expandedId === sess.id;
        const activeShotIdx = Math.min(
          Math.max(0, selectedShotBySess[sess.id] ?? 0),
          Math.max(0, shots.length - 1)
        );
        const activeShot = shots[activeShotIdx] || null;
        const dateLabel = formatRegionalDate(sess.timestamp, language, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        });

        if (!isOpen) {
          return (
            <button
              key={sess.id}
              type="button"
              onClick={() => setExpandedId(sess.id)}
              className="w-full bg-[#0B0E14] border border-white/[0.08] hover:border-white/[0.18] rounded-[18px] px-3.5 py-3 flex items-center justify-between gap-2 text-left cursor-pointer transition"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isCoachResultsView && sess.userName && (
                    <span className="text-[9.5px] bg-[#00BFFF]/15 border border-[#00BFFF]/30 text-[#00BFFF] px-1.5 py-0.5 rounded font-black uppercase">
                      {sess.userName}
                    </span>
                  )}
                  <span className="text-[14px] font-extrabold text-white">{dateLabel}</span>
                </div>
                <span className="text-[12px] font-semibold text-white tabular-nums truncate">
                  {getBowLabel(sess.bowType)} · {sess.distance || 18}m · {shots.length}{" "}
                  {tx("flechas", "arrows")}
                  {sessSummary.avgHeartRateBpm ? ` · ${sessSummary.avgHeartRateBpm} BPM` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[15.5px] font-black text-white tabular-nums">
                  {sessSummary.avgStabilityPct}%
                </span>
                <ChevronRight size={16} aria-hidden="true" className="text-white" />
              </div>
            </button>
          );
        }

        return (
          <div
            key={sess.id}
            className="bg-[#0B0E15] border border-white/[0.12] rounded-[24px] p-3.5 flex flex-col gap-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="flex flex-col gap-0.5 text-left min-w-0 cursor-pointer"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isCoachResultsView && sess.userName && (
                    <span className="text-[9.5px] bg-[#00BFFF]/15 border border-[#00BFFF]/30 text-[#00BFFF] px-1.5 py-0.5 rounded font-black uppercase">
                      {sess.userName}
                    </span>
                  )}
                  <span className="text-[15px] font-black text-white">{dateLabel}</span>
                  <ChevronDown size={15} aria-hidden="true" className="text-white" />
                </div>
                <span className="text-[12px] font-semibold text-white tabular-nums">
                  {getBowLabel(sess.bowType)} · {sess.distance || 18}m · {shots.length}{" "}
                  {tx("flechas", "arrows")}
                </span>
              </button>

              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-[32px] px-2.5 rounded-[10px] bg-[#141925] border border-[#00BFFF]/40 text-[13.5px] font-black text-white flex items-center tabular-nums">
                  {sessSummary.avgStabilityPct}%
                </div>
                {onDeleteSession && (
                  <button
                    type="button"
                    onClick={() => onDeleteSession(sess.id)}
                    aria-label={t("delete")}
                    className="w-8 h-8 rounded-[10px] bg-white text-black flex items-center justify-center cursor-pointer shrink-0"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {/* Diana + Replay Inspector Row */}
            {activeShot && (
              <div className="bg-[#06080D] border border-white/[0.08] rounded-[18px] p-3 flex items-center gap-3">
                <div className="w-[132px] h-[132px] shrink-0 flex items-center justify-center">
                  <AnalysisDianaSvg
                    shot={activeShot}
                    sizePx={132}
                    replayTrigger={replayBySess[sess.id] || 0}
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between bg-[#0C1018] border border-white/[0.09] rounded-[10px] px-2 py-1">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedShotBySess((prev) => ({
                          ...prev,
                          [sess.id]: (activeShotIdx - 1 + shots.length) % shots.length
                        }))
                      }
                      className="px-1.5 text-[14px] font-black text-white cursor-pointer"
                    >
                      ‹
                    </button>
                    <span className="text-[12.5px] font-black text-white tabular-nums">
                      {tx("Tiro", "Shot")} {activeShot.shotNumber} / {shots.length}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedShotBySess((prev) => ({
                          ...prev,
                          [sess.id]: (activeShotIdx + 1) % shots.length
                        }))
                      }
                      className="px-1.5 text-[14px] font-black text-white cursor-pointer"
                    >
                      ›
                    </button>
                  </div>

                  <div className="flex flex-col gap-1 text-[11.5px] font-bold text-white tabular-nums">
                    <div className="flex justify-between">
                      <span>{tx("Prep. / Apunt.", "Prep / Aim")}</span>
                      <span>
                        {activeShot.prepSeconds.toFixed(1)}s · {activeShot.aimSeconds.toFixed(1)}s
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{tx("Suelta / Pulso", "Release / HR")}</span>
                      <span>
                        {activeShot.releaseJumpCm.toFixed(1)} cm ·{" "}
                        {activeShot.heartRateBpm ? `${activeShot.heartRateBpm} BPM` : "—"}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setReplayBySess((prev) => ({
                        ...prev,
                        [sess.id]: (prev[sess.id] || 0) + 1
                      }))
                    }
                    className="h-[34px] rounded-[10px] bg-white text-black text-[11.5px] font-black flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition"
                  >
                    <Play size={12} fill="#000000" aria-hidden="true" />
                    <span>{tx("Repetir Tiro", "Replay Shot")}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Shot-by-Shot Table */}
            {shots.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-[44px_52px_1fr_1fr_42px_42px] gap-1.5 px-2 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white">
                  <span>{tx("Tiro", "Shot")}</span>
                  <span className="text-center">{tx("Diana", "Ring")}</span>
                  <span className="text-right">{tx("Prep.", "Prep")}</span>
                  <span className="text-right">{tx("Apunt.", "Aim")}</span>
                  <span className="text-right">BPM</span>
                  <span className="text-right">{tx("Estab.", "Stab.")}</span>
                </div>

                {shots.map((s, idx) => {
                  const isSel = idx === activeShotIdx;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setSelectedShotBySess((prev) => ({ ...prev, [sess.id]: idx }))
                      }
                      className={`h-[40px] rounded-[12px] px-2 grid grid-cols-[44px_52px_1fr_1fr_42px_42px] items-center gap-1.5 text-[11.5px] font-bold text-white tabular-nums cursor-pointer transition ${
                        isSel
                          ? "bg-[#0E131D] border border-[#00BFFF]/45"
                          : "bg-[#07090E] border border-white/[0.07]"
                      }`}
                    >
                      <span className="font-extrabold text-left whitespace-nowrap">
                        {tx("Tiro", "Shot")} {s.shotNumber}
                      </span>
                      <div>{renderImpactBadge(s)}</div>
                      <span className="text-right">{s.prepSeconds.toFixed(1)} s</span>
                      <span className="text-right">{s.aimSeconds.toFixed(1)} s</span>
                      <span className="text-right">{s.heartRateBpm || "—"}</span>
                      <span className="text-right font-black">{s.stabilityPct}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Coach PRO Athlete Detail Sheet "Análisis" Sub-Tab Inspector
 * Matches approved `analisis-coach-pro-4k.png` 100%.
 */
export function CoachAthleteAnalysisInspector({
  athleteFirstName,
  sessions,
  savedNotes = [],
  noteSentAck = false,
  noteText,
  onNoteTextChange,
  onSendNote
}: {
  athleteFirstName: string;
  sessions: any[];
  savedNotes?: Array<{ id: string; date: number; content: string }>;
  noteSentAck?: boolean;
  noteText: string;
  onNoteTextChange: (val: string) => void;
  onSendNote: (e: React.FormEvent) => void;
}) {
  const { language, tx } = useLanguage();

  const athleteAnalysisSessions = sessions
    .filter((s) => s && s.deletedByArcher !== true && isAnalysisSession(s))
    .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));

  const [selectedSessionIdx, setSelectedSessionIdx] = useState<number>(0);
  const [selectedShotIdx, setSelectedShotIdx] = useState<number>(0);
  const [replayNonce, setReplayNonce] = useState<number>(0);

  if (athleteAnalysisSessions.length === 0) {
    return (
      <div className="bg-[#0B0E15] border border-white/[0.08] rounded-2xl p-6 text-center flex flex-col gap-1.5">
        <span className="text-white font-extrabold text-sm">
          {tx("Sin sesiones de análisis registradas", "No analysis sessions recorded yet")}
        </span>
        <span className="text-white text-xs">
          {tx(
            "Cuando el alumno registre tiros en la pestaña Análisis con su reloj inteligente, aparecerán aquí flecha por flecha.",
            "When the athlete records shots in the Analysis tab with their smartwatch, they will appear here arrow by arrow."
          )}
        </span>
      </div>
    );
  }

  const safeSessIdx = Math.min(selectedSessionIdx, athleteAnalysisSessions.length - 1);
  const activeSess = athleteAnalysisSessions[safeSessIdx];
  const shots = extractAnalysisShots(activeSess);
  const safeShotIdx = Math.min(selectedShotIdx, Math.max(0, shots.length - 1));
  const activeShot = shots[safeShotIdx] || null;

  const prepPct = activeShot
    ? Math.round(
        (activeShot.prepSeconds / Math.max(0.5, activeShot.prepSeconds + activeShot.aimSeconds)) *
          100
      )
    : 30;

  return (
    <div className="flex flex-col gap-3">
      {/* Session Selector (when multiple sessions exist) */}
      {athleteAnalysisSessions.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {athleteAnalysisSessions.slice(0, 6).map((s, idx) => {
            const dStr = formatRegionalDate(s.timestamp, language, {
              day: "numeric",
              month: "short"
            });
            const isSel = idx === safeSessIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelectedSessionIdx(idx);
                  setSelectedShotIdx(0);
                }}
                className={`min-h-[32px] px-3 rounded-lg text-[11px] font-extrabold whitespace-nowrap shrink-0 cursor-pointer tabular-nums border ${
                  isSel
                    ? "bg-white text-black border-white font-black"
                    : "bg-[#090C12] text-white border-white/[0.09]"
                }`}
              >
                {s.isDraft ? `● ${tx("En Vivo", "Live")}` : dStr} · {s.distance || 18}m
              </button>
            );
          })}
        </div>
      )}

      {activeShot && (
        <>
          {/* Coach Shot Inspector Card */}
          <section className="bg-[#0B0E15] border border-white/[0.09] rounded-[24px] p-3.5 flex flex-col items-center gap-3">
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 bg-[#06080D] border border-white/[0.10] rounded-[11px] px-2 py-1">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedShotIdx((i) => (i - 1 + shots.length) % shots.length)
                  }
                  className="px-1.5 text-sm font-black text-white cursor-pointer"
                >
                  ‹
                </button>
                <span className="text-[13px] font-black text-white tabular-nums">
                  {tx("Tiro", "Shot")} {activeShot.shotNumber} / {shots.length}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedShotIdx((i) => (i + 1) % shots.length)}
                  className="px-1.5 text-sm font-black text-white cursor-pointer"
                >
                  ›
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="h-[28px] px-2.5 rounded-[8px] bg-[#121621] border border-white/[0.10] text-[11.5px] font-extrabold text-white flex items-center tabular-nums">
                  {activeShot.distanceM || activeSess.distance || 18}m
                </span>
                {renderImpactBadge(activeShot)}
              </div>
            </div>

            <AnalysisDianaSvg
              shot={activeShot}
              sizePx={242}
              replayTrigger={replayNonce}
            />

            <button
              type="button"
              onClick={() => setReplayNonce((n) => n + 1)}
              className="w-full min-h-[40px] rounded-[13px] bg-white hover:bg-neutral-100 text-black text-[13px] font-black flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99] transition tabular-nums"
            >
              <Play size={13} fill="#000000" aria-hidden="true" />
              <span>
                {tx(
                  `Repetir movimiento del Tiro ${activeShot.shotNumber}`,
                  `Replay Shot ${activeShot.shotNumber} motion`
                )}
              </span>
            </button>
          </section>

          {/* Objective Phase + Metrics Row */}
          <section className="bg-[#0D1017] border border-white/[0.08] rounded-[18px] p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-white tabular-nums">
              <span>
                {tx("Datos objetivos", "Objective data")} · {tx("Tiro", "Shot")}{" "}
                {activeShot.shotNumber}
              </span>
              <span>
                {tx("Ritmo total", "Total rhythm")} {activeShot.totalSeconds.toFixed(1)} s
              </span>
            </div>

            <div className="grid grid-cols-[1fr_1px_1fr_1px_1fr_1px_1fr] items-center gap-2 tabular-nums">
              <div className="flex flex-col">
                <span className="text-[9.5px] font-extrabold uppercase text-white">
                  {tx("Prep.", "Prep")}
                </span>
                <span className="text-[18px] font-black text-white">
                  {activeShot.prepSeconds.toFixed(1)}
                  <span className="text-[10.5px] font-bold ml-0.5">s</span>
                </span>
              </div>
              <span className="w-[1px] h-[28px] bg-white/[0.09]" />
              <div className="flex flex-col">
                <span className="text-[9.5px] font-extrabold uppercase text-white">
                  {tx("Apunt.", "Aim")}
                </span>
                <span className="text-[18px] font-black text-white">
                  {activeShot.aimSeconds.toFixed(1)}
                  <span className="text-[10.5px] font-bold ml-0.5">s</span>
                </span>
              </div>
              <span className="w-[1px] h-[28px] bg-white/[0.09]" />
              <div className="flex flex-col">
                <span className="text-[9.5px] font-extrabold uppercase text-white">
                  {tx("Suelta", "Release")}
                </span>
                <span className="text-[18px] font-black text-white">
                  {activeShot.releaseJumpCm.toFixed(1)}
                  <span className="text-[10.5px] font-bold ml-0.5">cm</span>
                </span>
              </div>
              <span className="w-[1px] h-[28px] bg-white/[0.09]" />
              <div className="flex flex-col">
                <span className="text-[9.5px] font-extrabold uppercase text-white">
                  {tx("Pulso", "HR")}
                </span>
                <span className="text-[18px] font-black text-white">
                  {activeShot.heartRateBpm || "—"}
                </span>
              </div>
            </div>

            <div className="w-full h-[4.5px] flex gap-1">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${Math.max(12, Math.min(80, prepPct))}%` }}
              />
              <div className="flex-1 h-full rounded-full bg-[#00BFFF]" />
            </div>
          </section>

          {/* Shot-by-Shot Table */}
          <section className="bg-[#0D1017] border border-white/[0.08] rounded-[20px] p-3 flex flex-col gap-1.5">
            <div className="grid grid-cols-[44px_52px_1fr_1fr_42px_42px] gap-1.5 px-2 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white">
              <span>{tx("Tiro", "Shot")}</span>
              <span className="text-center">{tx("Diana", "Ring")}</span>
              <span className="text-right">{tx("Prep.", "Prep")}</span>
              <span className="text-right">{tx("Apunt.", "Aim")}</span>
              <span className="text-right">BPM</span>
              <span className="text-right">{tx("Estab.", "Stab.")}</span>
            </div>

            {shots.map((s, idx) => {
              const isSel = idx === safeShotIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedShotIdx(idx)}
                  className={`h-[40px] rounded-[12px] px-2 grid grid-cols-[44px_52px_1fr_1fr_42px_42px] items-center gap-1.5 text-[11.5px] font-bold text-white tabular-nums cursor-pointer transition ${
                    isSel
                      ? "bg-[#0E131D] border border-[#00BFFF]/45"
                      : "bg-[#07090E] border border-white/[0.07]"
                  }`}
                >
                  <span className="font-extrabold text-left whitespace-nowrap">
                    {tx("Tiro", "Shot")} {s.shotNumber}
                  </span>
                  <div>{renderImpactBadge(s)}</div>
                  <span className="text-right">{s.prepSeconds.toFixed(1)} s</span>
                  <span className="text-right">{s.aimSeconds.toFixed(1)} s</span>
                  <span className="text-right">{s.heartRateBpm || "—"}</span>
                  <span className="text-right font-black">{s.stabilityPct}%</span>
                </button>
              );
            })}
          </section>

          {/* Direct Human Coach Note Input */}
          <form
            onSubmit={onSendNote}
            className="min-h-[46px] bg-[#0B0E15] border border-white/[0.10] rounded-[14px] pl-3.5 pr-1.5 py-1 flex items-center justify-between gap-2"
          >
            <input
              type="text"
              value={noteText}
              onChange={(e) => onNoteTextChange(e.target.value)}
              placeholder={tx(
                `Escribir nota técnica para ${athleteFirstName}...`,
                `Write technical note for ${athleteFirstName}...`
              )}
              className="flex-1 min-w-0 bg-transparent text-white text-[12.5px] font-medium outline-none placeholder:text-white/75"
            />
            <button
              type="submit"
              className="h-[34px] px-3.5 rounded-[10px] bg-[#00BFFF] hover:brightness-105 text-black text-[12px] font-black flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition"
            >
              <Send size={12} aria-hidden="true" />
              <span>{tx("Enviar", "Send")}</span>
            </button>
          </form>

          {noteSentAck && (
            <div className="px-3 py-1.5 rounded-[10px] bg-[#051810] border border-[#00C853]/45 text-white text-[11.5px] font-extrabold tracking-wide text-center">
              ✓ {tx("Nota técnica enviada al atleta", "Technical note sent to athlete")}
            </div>
          )}

          {savedNotes.length > 0 && (
            <div className="bg-[#0B0E15] border border-white/[0.08] rounded-[16px] p-3 flex flex-col gap-1.5">
              <span className="text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white">
                {tx("Notas técnicas enviadas", "Sent technical notes")}
              </span>
              {savedNotes.slice(0, 3).map((n) => (
                <div
                  key={n.id}
                  className="bg-[#07090E] border border-white/[0.06] rounded-[11px] px-2.5 py-2 flex flex-col gap-0.5"
                >
                  <span className="text-[12px] font-semibold text-white leading-snug break-words">
                    {n.content}
                  </span>
                  <span className="text-[9.8px] font-bold text-white/70 tabular-nums">
                    {formatRegionalDate(n.date, language)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
