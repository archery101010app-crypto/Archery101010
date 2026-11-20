import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate } from "@/lib/i18n/regionalUtils";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, deleteLocalSession, saveLocalSetting } from "@/lib/db/indexedDB";
import { showOledConfirm } from "@/lib/oledDialog";
import { ArrowLeft, Trash2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import BleHeartRateModal from "@/components/watch/BleHeartRateModal";
import {
  BleHeartRateStatus,
  getBleHeartRateStatus,
  resetBleHeartRateSessionStats,
  subscribeBleHeartRate,
  tryAutoReconnectBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

interface SessionConfigViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartSession: (config: any) => void;
}

const DISTANCES = [18, 30, 50, 60, 70];

export default function SessionConfigView({ user, onBack, onStartSession }: SessionConfigViewProps) {
  const { language, t, tx } = useLanguage();
  const [draftSession, setDraftSession] = useState<any | null>(null);

  // Configuration States
  const [showPracticeInfoModal, setShowPracticeInfoModal] = useState(false);
  const [practiceInfoType, setPracticeInfoType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [dontShowAgainPractice, setDontShowAgainPractice] = useState(false);
  const [showBleHrModal, setShowBleHrModal] = useState(false);
  const [bleHrStatus, setBleHrStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());

  useEffect(() => {
    resetBleHeartRateSessionStats(0, 0);
    tryAutoReconnectBleHeartRate();
    return subscribeBleHeartRate((next) => setBleHrStatus(next));
  }, []);

  const [practiceType, setPracticeType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [format, setFormat] = useState<string>("Libre");
  const [targetType, setTargetType] = useState<string>("WA 300");
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(user?.bowConfig?.type || "Barebow");

  const defaultMeters =
    user?.bowConfig?.defaultDistance && user.bowConfig.defaultDistance <= 70
      ? user.bowConfig.defaultDistance
      : 18;

  const [distance, setDistance] = useState<number>(defaultMeters);
  const [endsCount, setEndsCount] = useState(10);
  const [arrowsPerEnd, setArrowsPerEnd] = useState(3);

  // Search for draft sessions on mount
  useEffect(() => {
    async function checkDrafts() {
      const list = await getLocalSessions();
      const draft = list
        .filter(
          (s) =>
            s.isDraft === true &&
            !s.isDuel &&
            !s.isAnalysisSession &&
            s.practiceType !== "Análisis" &&
            !s.biometrics?.isAnalysisSession &&
            (s.userId === user.uid || s.userUid === user.uid)
        )
        .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0))[0];
      if (draft) {
        setDraftSession(draft);
      }
    }
    checkDrafts();
  }, [user.uid]);

  // Automatically adjust parameters based on Format selection
  const handleFormatChange = (newFormat: string) => {
    setFormat(newFormat);
    if (newFormat === "Libre") {
      setEndsCount(10);
      setArrowsPerEnd(3);
    } else if (newFormat === "WA 360") {
      if (distance === 18) {
        setEndsCount(12);
        setArrowsPerEnd(3);
      } else {
        setEndsCount(6);
        setArrowsPerEnd(6);
      }
    } else if (newFormat === "WA 720") {
      setEndsCount(12);
      setArrowsPerEnd(6);
      if (distance === 18) {
        setDistance(bowType === "Compound" ? 50 : 70);
      }
    } else if (newFormat === "WA 300") {
      setEndsCount(10);
      setArrowsPerEnd(3);
      setDistance(18);
      setTargetType("WA 300");
    } else if (newFormat === "Vegas 300") {
      setEndsCount(10);
      setArrowsPerEnd(3);
      setDistance(18);
      setTargetType("Vegas 300");
    }
  };

  const maxAllowedEnds = Math.min(60, Math.max(1, Math.floor(200 / Math.max(1, arrowsPerEnd))));

  const handleStart = () => {
    const safeArrowsPerEnd = Math.min(12, Math.max(1, arrowsPerEnd));
    const safeMaxEnds = Math.min(60, Math.max(1, Math.floor(200 / safeArrowsPerEnd)));
    const safeEndsCount = Math.min(safeMaxEnds, Math.max(1, endsCount));
    onStartSession({
      practiceType,
      format,
      targetType: format === "Vegas 300" || targetType === "Vegas 300" ? "Vegas 300" : "WA 300",
      bowType,
      distance,
      distanceUnit: "m",
      distanceValue: distance,
      autoScore: true,
      includeNotes: true,
      endsCount: safeEndsCount,
      arrowsPerEnd: safeArrowsPerEnd,
      maxScore: Math.min(2000, safeEndsCount * safeArrowsPerEnd * 10),
      warmupArrows: 0
    });
  };

  const handleConfirmPracticeInfo = async () => {
    setPracticeType(practiceInfoType);
    if (dontShowAgainPractice) {
      await saveLocalSetting(`hide_info_practice_${practiceInfoType}`, true);
    }
    setShowPracticeInfoModal(false);
  };

  const handleResumeDraft = () => {
    if (draftSession) {
      onStartSession({
        ...draftSession,
        draftId: draftSession.id,
        isDraft: true
      });
    }
  };

  const handleDiscardDraft = async () => {
    if (
      draftSession &&
      (await showOledConfirm(
        tx(
          "¿Estás seguro de que quieres descartar esta sesión pausada? Se perderá todo tu progreso.",
          "Are you sure you want to discard this paused session? All progress will be lost."
        ),
        {
          confirmLabel: tx("Descartar", "Discard"),
          cancelLabel: t("cancel")
        }
      ))
    ) {
      await deleteLocalSession(draftSession.id);
      try {
        const { addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "DELETE",
          payloadId: draftSession.id,
          payload: null,
          timestamp: Date.now()
        });
      } catch (err) {
        console.warn("Draft cloud delete deferred:", err);
      }
      setDraftSession(null);
    }
  };

  const getLocalizedBowName = (type?: string) => {
    const raw =
      type === "Recurve"
        ? t("bowRecurve")
        : type === "Compound"
        ? t("bowCompound")
        : type === "Barebow"
        ? t("bowBarebow")
        : type || t("bowBarebow");
    return raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  return (
    <div className="flex flex-col gap-4 py-2 min-h-full w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/15 text-white hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h2 className="text-white text-[21.1px] sm:text-[23.8px] font-black uppercase tracking-wide truncate leading-tight">
            {t("newSession")}
          </h2>
          <p className="text-[13.9px] text-white uppercase tracking-wider truncate">
            {tx("Configuración", "Configuration")}
          </p>
        </div>
      </div>

      {/* Configuration Form wrapper */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Bluetooth Heart Rate Sensor Quick Connect Bar (directly below Configuration, above Practice Type) */}
        <div className="bg-[#0B0E14] border border-white/[0.10] rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  bleHrStatus.state === "connected"
                    ? "bg-[#00C853]"
                    : bleHrStatus.state === "scanning" || bleHrStatus.state === "connecting"
                    ? "bg-[#00BFFF]"
                    : "bg-[#6E7785]"
                }`}
              />
              <span className="text-[12.6px] min-[390px]:text-[14.3px] sm:text-[15.2px] font-extrabold text-white uppercase tracking-[-0.01em] leading-tight whitespace-nowrap truncate">
                {t("bleHrTitle")}
              </span>
            </div>
            <span className="text-[11.2px] min-[390px]:text-[12.6px] sm:text-[13.5px] font-medium text-white tracking-[-0.01em] leading-snug mt-0.5 tabular-nums truncate">
              {bleHrStatus.state === "connected"
                ? `${
                    bleHrStatus.currentBpm >= 30 ? `${bleHrStatus.currentBpm} BPM · ` : ""
                  }${bleHrStatus.deviceName || tx("Conectado en vivo", "Connected live")}`
                : t("bleHrSubtitle")}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowBleHrModal(true)}
            className={`min-h-[36px] px-2.5 rounded-lg font-black text-[12.7px] uppercase tracking-[0.03em] shrink-0 cursor-pointer transition active:scale-95 tabular-nums ${
              bleHrStatus.state === "connected"
                ? "bg-[#051810] border border-[#00C853]/55 text-white"
                : "bg-[#101006] border border-[#FFE500] text-white hover:bg-[#181808]"
            }`}
          >
            {bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
              ? `${bleHrStatus.currentBpm} BPM`
              : t("bleHrConnect")}
          </button>
        </div>

        {/* Draft Restore Alert Card */}
        {draftSession && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-2xl border border-yellow-gold/30 bg-[#0D1017] flex flex-col gap-3 shadow-sm relative overflow-hidden"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[13.9px] text-yellow-gold font-black tracking-widest uppercase flex items-center gap-1.5">
                  <RotateCcw size={13} />
                  {tx("Sesión Pausada", "Paused Session")}
                </span>
                <h4 className="text-white text-[18.4px] font-bold mt-1 truncate tabular-nums">
                  {draftSession.format === "Libre" ? tx("Libre", "Custom") : draftSession.format} ·{" "}
                  {`${Math.round(Number(draftSession.distance) || 18)}m`} ·{" "}
                  {getLocalizedBowName(draftSession.bowType)}
                </h4>
                <p className="text-[13.9px] text-white tabular-nums">
                  {tx("Pausado el", "Paused on")}{" "}
                  {formatRegionalDate(draftSession.timestamp, language, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </p>
              </div>
              <button
                onClick={handleDiscardDraft}
                className="w-8 h-8 rounded-lg border border-white bg-white text-black hover:bg-neutral-200 flex items-center justify-center shrink-0 transition cursor-pointer"
                title={tx("Descartar Borrador", "Discard Draft")}
              >
                <Trash2 size={14} />
              </button>
            </div>
            
            <button
              onClick={handleResumeDraft}
              className="w-full h-11 px-3 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-[16px] min-[390px]:text-[18.4px] leading-none uppercase tracking-wider flex justify-center items-center gap-1.5 whitespace-nowrap cursor-pointer transition"
            >
              <RotateCcw size={15} />
              <span>{tx("Reanudar Entrenamiento", "Resume Training")}</span>
            </button>
          </motion.div>
        )}

        {/* Practice Type Chips */}
        <div className="flex flex-col gap-2">
          <label className="text-[16.7px] text-white font-bold uppercase tracking-wider">
            {t("practiceType")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["Control", "Práctica", "Volumen"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setPracticeType(type)}
                className={`h-12 px-1 sm:px-2 rounded-xl border text-[14.5px] min-[390px]:text-[16.5px] sm:text-[18.7px] leading-none tracking-tight font-bold flex items-center justify-center text-center whitespace-nowrap truncate transition-all duration-200 cursor-pointer ${
                  practiceType === type
                    ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon"
                    : "border-white/10 bg-[#0D0F12] text-white hover:text-white"
                }`}
              >
                {type === "Control" ? t("practiceControl") : type === "Práctica" ? t("practicePractice") : t("practiceVolume")}
              </button>
            ))}
          </div>
          <p className="text-[15.4px] text-white leading-snug px-1">
            {practiceType === "Control" &&
              tx(
                "Simulación oficial de torneo con tiempos, diana activa y planilla reglamentaria.",
                "Official tournament simulation with timing, interactive target, and official scorecard."
              )}
            {practiceType === "Práctica" &&
              tx(
                "Entrenamiento libre con análisis de agrupación y notas por ronda.",
                "Open practice with grouping analytics and end notes."
              )}
            {practiceType === "Volumen" &&
              tx(
                "Contador rápido de carga física de flechas sin puntuación en diana.",
                "Fast arrow volume counter for physical load without target scoring."
              )}
          </p>
        </div>

        {/* Format Chips */}
        <div className="flex flex-col gap-2">
          <label className="text-[16.7px] text-white font-bold uppercase tracking-wider">
            {t("sessionFormat")}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { id: "Libre", label: tx("Libre", "Custom") },
              { id: "WA 720", label: "WA 720" },
              { id: "WA 360", label: "WA 360" },
              { id: "WA 300", label: "WA 300" },
              { id: "Vegas 300", label: "Vegas 300" }
            ].map((fmt, idx) => (
              <button
                key={fmt.id}
                type="button"
                onClick={() => handleFormatChange(fmt.id)}
                className={`h-11 px-1 sm:px-2 rounded-xl border text-[16.5px] sm:text-[18.7px] leading-none tracking-tight font-bold flex items-center justify-center text-center whitespace-nowrap truncate tabular-nums transition-all duration-200 cursor-pointer ${
                  idx === 4 ? "col-span-2 sm:col-span-1" : ""
                } ${
                  format === fmt.id
                    ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon"
                    : "border-white/10 bg-[#0D0F12] text-white hover:text-white"
                }`}
              >
                {fmt.label}
              </button>
            ))}
          </div>
          {format !== "Libre" && (
            <p className="text-[13.9px] text-cyan-neon tabular-nums font-bold px-1">
              {endsCount} {t("rounds")} × {arrowsPerEnd} {t("arrowsLabel")} ({endsCount * arrowsPerEnd * 10} pts {tx("máx", "max")})
              {bowType === "Compound" && format === "WA 300"
                ? tx(" · 10 Reducido Oficial", " · Official Inner 10")
                : ""}
              {bowType === "Compound" && format === "Vegas 300"
                ? tx(" · 10 Completo", " · Full 10 Ring")
                : ""}
            </p>
          )}
        </div>

        {/* Bow Type Chips */}
        <div className="flex flex-col gap-2">
          <label className="text-[16.7px] text-white font-bold uppercase tracking-wider">
            {t("bowType")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["Recurve", "Compound", "Barebow"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setBowType(type)}
                className={`h-12 px-1 sm:px-2 rounded-xl border text-[14.5px] min-[390px]:text-[16.5px] sm:text-[18.7px] leading-none tracking-tight font-bold flex items-center justify-center text-center whitespace-nowrap truncate transition-all duration-200 cursor-pointer ${
                  bowType === type
                    ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon"
                    : "border-white/10 bg-[#0D0F12] text-white hover:text-white"
                }`}
              >
                {getLocalizedBowName(type)}
              </button>
            ))}
          </div>
        </div>

        {/* Distance Chips presets (meters only) */}
        <div className="flex flex-col gap-2">
          <label className="text-[16.7px] text-white font-bold uppercase tracking-wider">
            {t("distance")}
          </label>
          <div className="grid grid-cols-5 gap-2 w-full">
            {DISTANCES.map((d) => {
              const isSelected = distance === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDistance(d);
                    if (format === "WA 360") {
                      if (d === 18) {
                        setEndsCount(12);
                        setArrowsPerEnd(3);
                      } else {
                        setEndsCount(6);
                        setArrowsPerEnd(6);
                      }
                    }
                  }}
                  className={`h-12 px-1 sm:px-2 rounded-xl border text-[16.5px] sm:text-[18.7px] leading-none tracking-tight font-black transition-all duration-200 cursor-pointer flex items-center justify-center text-center tabular-nums whitespace-nowrap ${
                    isSelected
                      ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon"
                      : "border-white/10 bg-[#0D0F12] text-white hover:text-white"
                  }`}
                >
                  {`${d}m`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Ends & Arrows Counter (For Free adjustment) */}
        {format === "Libre" && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-[16.7px] text-white font-bold">{t("rounds")}</label>
              <div className="h-12 flex items-center bg-[#0D0F12] border border-white/10 rounded-xl">
                <button
                  type="button"
                  onClick={() => setEndsCount(Math.max(1, endsCount - 1))}
                  className="px-3.5 py-3 text-cyan-neon font-black text-[23px] leading-none cursor-pointer"
                >
                  -
                </button>
                <span className="flex-1 text-center font-bold text-white text-[18.4px] leading-none tabular-nums">{endsCount}</span>
                <button
                  type="button"
                  onClick={() => setEndsCount(Math.min(maxAllowedEnds, endsCount + 1))}
                  disabled={endsCount >= maxAllowedEnds}
                  className="px-3.5 py-3 text-cyan-neon font-black text-[23px] leading-none cursor-pointer disabled:opacity-35"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[16.7px] text-white font-bold">{tx("Flechas", "Arrows")}</label>
              <div className="h-12 flex items-center bg-[#0D0F12] border border-white/10 rounded-xl">
                <button
                  type="button"
                  onClick={() => setArrowsPerEnd(Math.max(1, arrowsPerEnd - 1))}
                  className="px-3.5 py-3 text-cyan-neon font-black text-[23px] leading-none cursor-pointer"
                >
                  -
                </button>
                <span className="flex-1 text-center font-bold text-white text-[18.4px] leading-none tabular-nums">{arrowsPerEnd}</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextArrows = Math.min(12, arrowsPerEnd + 1);
                    const nextMaxEnds = Math.min(60, Math.max(1, Math.floor(200 / nextArrows)));
                    setArrowsPerEnd(nextArrows);
                    if (endsCount > nextMaxEnds) {
                      setEndsCount(nextMaxEnds);
                    }
                  }}
                  disabled={arrowsPerEnd >= 12}
                  className="px-3.5 py-3 text-cyan-neon font-black text-[23px] leading-none cursor-pointer disabled:opacity-35"
                >
                  +
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Start button */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleStart}
          className="w-full px-3 py-4 mt-2 mb-4 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[16px] min-[390px]:text-[18.4px] leading-none tracking-widest uppercase cursor-pointer flex justify-center items-center transition-colors"
        >
          <span>{t("startSessionBtn")}</span>
        </motion.button>
      </div>

      <BleHeartRateModal
        isOpen={showBleHrModal}
        onClose={() => setShowBleHrModal(false)}
      />

      {/* MODAL: Practice Info Explanation */}
      <AnimatePresence>
        {showPracticeInfoModal && (
          <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-[#0A0B0E] border border-white/10 rounded-2xl p-6 w-full max-w-xs flex flex-col gap-4 text-left">
              <div>
                <span className="text-[11.6px] text-cyan-neon font-black tracking-widest uppercase">
                  {tx("Metodología de Práctica", "Practice Methodology")}
                </span>
                <h3 className="text-white text-base font-black uppercase mt-1">
                  {tx("Modo:", "Mode:")}{" "}
                  {practiceInfoType === "Control"
                    ? t("practiceControl")
                    : practiceInfoType === "Práctica"
                    ? t("practicePractice")
                    : t("practiceVolume")}
                </h3>
              </div>

              <p className="text-xs text-white leading-relaxed">
                {practiceInfoType === "Control" &&
                  tx(
                    "Simulación estricta de competencia. Con tiempos oficiales, planilla de puntuación reglamentaria, diana activa y sin interrupciones. Ideal para evaluar tu nivel en torneos.",
                    "Strict competition simulation with official timing, regulatory scorecard, active target, and zero interruptions. Ideal for tournament readiness."
                  )}
                {practiceInfoType === "Práctica" &&
                  tx(
                    "Entrenamiento regular y libre. Registra tus tiros con flexibilidad para analizar agrupamientos y técnica. Las notas por end están habilitadas.",
                    "Flexible open practice. Record shots to analyze groupings and form with per-end notes enabled."
                  )}
                {practiceInfoType === "Volumen" &&
                  tx(
                    "Registra la estadística correspondiente a la cantidad de flechas lanzadas en la sesión.",
                    "Tracks total arrows shot during the session for physical volume statistics."
                  )}
              </p>

              <div className="flex items-center gap-2 border-t border-white/5 pt-3">
                <input
                  type="checkbox"
                  id="dontShowAgain"
                  checked={dontShowAgainPractice}
                  onChange={(e) => setDontShowAgainPractice(e.target.checked)}
                  className="rounded border-neutral-700 bg-neutral-950 text-cyan-neon focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="dontShowAgain" className="text-[11.6px] text-white font-bold cursor-pointer uppercase select-none">
                  {tx("No volver a mostrar", "Don't show again")}
                </label>
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={handleConfirmPracticeInfo}
                  className="flex-1 py-3 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {tx("Entendido, Iniciar", "Got it, Start")}
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
