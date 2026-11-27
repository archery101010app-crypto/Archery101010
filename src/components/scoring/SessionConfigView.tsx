import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate, formatShootingDistance, metersToYards } from "@/lib/i18n/regionalUtils";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, deleteLocalSession } from "@/lib/db/indexedDB";
import { showOledConfirm } from "@/lib/oledDialog";
import { ArrowLeft, ChevronDown, ChevronUp, Play, RotateCcw, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import BleHeartRateModal from "@/components/watch/BleHeartRateModal";
import { ensurePhoneWatchPairingReady } from "@/lib/scoring/biometricsEngine";
import {
  BleHeartRateStatus,
  getBleHeartRateStatus,
  requestWatchAppHeartRate,
  resetBleHeartRateSessionStats,
  subscribeBleHeartRate,
  tryAutoReconnectBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

interface SessionConfigViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartSession: (config: any) => void;
  onOpenAnalysis?: () => void;
}

const PRIMARY_DISTANCES = [18, 30, 50, 70];
const EXTRA_DISTANCES = [25, 40, 60, 90];
const LAST_SETUP_STORAGE_PREFIX = "archery101010_last_session_cfg_";

interface SavedQuickSetup {
  practiceType: "Control" | "Práctica" | "Volumen";
  format: string;
  targetType: string;
  bowType: "Recurve" | "Compound" | "Barebow";
  distance: number;
  endsCount: number;
  arrowsPerEnd: number;
}

export default function SessionConfigView({
  user,
  onBack,
  onStartSession,
  onOpenAnalysis
}: SessionConfigViewProps) {
  const { language, unitSystem, t, tx } = useLanguage();
  const isEs = language === "es";
  const [draftSession, setDraftSession] = useState<any | null>(null);

  // Heart Rate Quick Connect States (preserved at top of screen)
  const [showBleHrModal, setShowBleHrModal] = useState(false);
  const [bleHrStatus, setBleHrStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());

  useEffect(() => {
    resetBleHeartRateSessionStats(0, 0);
    ensurePhoneWatchPairingReady(user?.uid);
    tryAutoReconnectBleHeartRate();
    requestWatchAppHeartRate();
    const unsub = subscribeBleHeartRate((next) => setBleHrStatus(next));
    const watchPoll = setInterval(() => {
      if (getBleHeartRateStatus().state !== "connected") {
        ensurePhoneWatchPairingReady(user?.uid);
        requestWatchAppHeartRate({ unmute: false });
      }
    }, 4500);
    return () => {
      clearInterval(watchPoll);
      unsub();
    };
  }, [user?.uid]);

  const defaultMeters =
    user?.bowConfig?.defaultDistance && user.bowConfig.defaultDistance <= 90
      ? user.bowConfig.defaultDistance
      : 18;

  const [practiceType, setPracticeType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [format, setFormat] = useState<string>("Libre");
  const [targetType, setTargetType] = useState<string>("WA 300");
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(
    user?.bowConfig?.type || "Barebow"
  );
  const [distance, setDistance] = useState<number>(defaultMeters);
  const [endsCount, setEndsCount] = useState(10);
  const [arrowsPerEnd, setArrowsPerEnd] = useState(3);
  const [isCustomOpen, setIsCustomOpen] = useState(true);
  const [showCustomDistance, setShowCustomDistance] = useState<boolean>(
    !PRIMARY_DISTANCES.includes(defaultMeters)
  );

  // Hydrate last used setup (localStorage -> fallback to latest completed local session) + check active draft
  useEffect(() => {
    let cancelled = false;
    const storageKey = `${LAST_SETUP_STORAGE_PREFIX}${user?.uid || "default"}`;

    const applySavedSetup = (cfg: Partial<SavedQuickSetup>) => {
      if (
        cfg.practiceType === "Control" ||
        cfg.practiceType === "Práctica" ||
        cfg.practiceType === "Volumen"
      ) {
        setPracticeType(cfg.practiceType);
      }
      if (typeof cfg.format === "string" && cfg.format.trim()) {
        setFormat(cfg.format);
      }
      if (typeof cfg.targetType === "string" && cfg.targetType.trim()) {
        setTargetType(cfg.targetType);
      }
      if (cfg.bowType === "Recurve" || cfg.bowType === "Compound" || cfg.bowType === "Barebow") {
        setBowType(cfg.bowType);
      }
      if (typeof cfg.distance === "number" && cfg.distance >= 5 && cfg.distance <= 150) {
        const roundedDist = Math.round(cfg.distance);
        setDistance(roundedDist);
        setShowCustomDistance(!PRIMARY_DISTANCES.includes(roundedDist));
      }
      if (typeof cfg.endsCount === "number" && cfg.endsCount >= 1 && cfg.endsCount <= 60) {
        setEndsCount(Math.round(cfg.endsCount));
      }
      if (typeof cfg.arrowsPerEnd === "number" && cfg.arrowsPerEnd >= 1 && cfg.arrowsPerEnd <= 12) {
        setArrowsPerEnd(Math.round(cfg.arrowsPerEnd));
      }
    };

    let hydratedFromStorage = false;
    try {
      const rawSaved = localStorage.getItem(storageKey);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as Partial<SavedQuickSetup>;
        if (parsed && typeof parsed === "object") {
          applySavedSetup(parsed);
          hydratedFromStorage = true;
        }
      }
    } catch {}

    async function checkDraftsAndRecentSetup() {
      const list = await getLocalSessions();
      if (cancelled) return;
      const userSessions = list
        .filter(
          (s) =>
            !s.isDuel &&
            !s.isAnalysisSession &&
            s.practiceType !== "Análisis" &&
            !s.biometrics?.isAnalysisSession &&
            (s.userId === user.uid || s.userUid === user.uid) &&
            !s.deletedByArcher
        )
        .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));

      const draft = userSessions.find((s) => s.isDraft === true);
      if (draft) {
        setDraftSession(draft);
      }

      if (!hydratedFromStorage) {
        const latestCompleted = userSessions.find((s) => !s.isDraft);
        if (latestCompleted) {
          applySavedSetup({
            practiceType:
              latestCompleted.isVolumeOnly || latestCompleted.practiceType === "Volumen"
                ? "Volumen"
                : latestCompleted.practiceType === "Control"
                ? "Control"
                : "Práctica",
            format: latestCompleted.format || "Libre",
            targetType: latestCompleted.targetType || "WA 300",
            bowType: latestCompleted.bowType || user?.bowConfig?.type || "Barebow",
            distance: Number(latestCompleted.distance) || defaultMeters,
            endsCount: Number(latestCompleted.endsCount) || 10,
            arrowsPerEnd: Number(latestCompleted.arrowsPerEnd) || 3
          });
        }
      }
    }
    checkDraftsAndRecentSetup();
    return () => {
      cancelled = true;
    };
  }, [user.uid, user?.bowConfig?.type, defaultMeters]);

  const persistLastSetup = (nextCfg: SavedQuickSetup) => {
    try {
      const storageKey = `${LAST_SETUP_STORAGE_PREFIX}${user?.uid || "default"}`;
      localStorage.setItem(storageKey, JSON.stringify(nextCfg));
    } catch {}
  };

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
      setDistance(bowType === "Compound" ? 50 : 70);
      setShowCustomDistance(false);
    } else if (newFormat === "WA 300") {
      setEndsCount(10);
      setArrowsPerEnd(3);
      setDistance(18);
      setTargetType("WA 300");
      setShowCustomDistance(false);
    } else if (newFormat === "Vegas 300") {
      setEndsCount(10);
      setArrowsPerEnd(3);
      setDistance(18);
      setTargetType("Vegas 300");
      setShowCustomDistance(false);
    }
  };

  const maxAllowedEnds = Math.min(60, Math.max(1, Math.floor(200 / Math.max(1, arrowsPerEnd))));

  const launchWithPracticeType = (selectedPracticeType: "Control" | "Práctica" | "Volumen") => {
    const safeArrowsPerEnd = Math.min(12, Math.max(1, arrowsPerEnd));
    const safeMaxEnds = Math.min(60, Math.max(1, Math.floor(200 / safeArrowsPerEnd)));
    const safeEndsCount = Math.min(safeMaxEnds, Math.max(1, endsCount));
    const resolvedTargetType =
      format === "Vegas 300" || targetType === "Vegas 300" ? "Vegas 300" : "WA 300";
    const useImperialDistance = format === "Libre" && unitSystem === "imperial";

    persistLastSetup({
      practiceType: selectedPracticeType,
      format,
      targetType: resolvedTargetType,
      bowType,
      distance,
      endsCount: safeEndsCount,
      arrowsPerEnd: safeArrowsPerEnd
    });

    onStartSession({
      practiceType: selectedPracticeType,
      format,
      targetType: resolvedTargetType,
      bowType,
      distance,
      distanceUnit: useImperialDistance ? "yd" : "m",
      distanceValue: useImperialDistance ? Math.round(metersToYards(distance)) : distance,
      autoScore: true,
      includeNotes: true,
      endsCount: safeEndsCount,
      arrowsPerEnd: safeArrowsPerEnd,
      maxScore: Math.min(2000, safeEndsCount * safeArrowsPerEnd * 10),
      warmupArrows: 0
    });
  };

  const handleStart = () => {
    launchWithPracticeType(practiceType);
  };

  const handleQuickVolume = () => {
    launchWithPracticeType("Volumen");
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

  const getLocalizedPracticeName = (type: "Control" | "Práctica" | "Volumen") => {
    const raw =
      type === "Control"
        ? t("practiceControl")
        : type === "Práctica"
        ? t("practicePractice")
        : t("practiceVolume");
    return isEs ? raw : raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  const targetFaceSummary = (() => {
    if (format === "Vegas 300" || format === "WA 300" || distance <= 25) {
      return tx("Diana 40 cm", "40 cm Face");
    }
    if (distance <= 55) {
      return tx("Diana 80 cm", "80 cm Face");
    }
    return tx("Diana 122 cm", "122 cm Face");
  })();

  const formattedCurrentDistance = formatShootingDistance(
    distance,
    format === "Libre" ? unitSystem : "metric"
  );

  const isCustomDistanceSelected = showCustomDistance || !PRIMARY_DISTANCES.includes(distance);

  return (
    <div className="flex flex-col gap-3.5 py-2 min-h-full w-full max-w-full overflow-x-hidden font-sans">
      {/* Compact Top Back Header */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="w-10 h-10 rounded-xl bg-[#0D1017] border border-white/[0.10] hover:border-white/20 text-white flex items-center justify-center shrink-0 cursor-pointer transition"
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="min-w-0">
          <h2 className="text-white text-[20px] sm:text-[22px] font-extrabold uppercase tracking-wide break-words leading-tight">
            {t("newSession")}
          </h2>
        </div>
      </div>

      {/* Preserved Top Heart Rate Quick Connect Bar */}
      <div className="bg-[#0B0E14] border border-white/[0.12] rounded-2xl px-3.5 py-3 flex items-center justify-between gap-3">
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                bleHrStatus.state === "connected"
                  ? "bg-[#00C853]"
                  : bleHrStatus.state === "scanning" || bleHrStatus.state === "connecting"
                  ? "bg-[#00BFFF]"
                  : "bg-[#6E7785]"
              }`}
            />
            <span
              className={`text-[15.5px] min-[390px]:text-[16.5px] sm:text-[17.5px] font-bold text-white uppercase tracking-wider ${
                isEs ? "leading-none" : "leading-snug py-0.5 pe-0.5"
              } leading-tight break-words`}
            >
              {t("bleHrTitle")}
            </span>
          </div>
          {bleHrStatus.state === "connected" && (
            <span className="text-[12.5px] font-semibold text-white leading-snug mt-1 tabular-nums break-words ps-4.5">
              {`${
                bleHrStatus.currentBpm >= 30 ? `${bleHrStatus.currentBpm} BPM · ` : ""
              }${bleHrStatus.deviceName || tx("Conectado en vivo", "Connected live")}`}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowBleHrModal(true)}
          className={`min-h-[42px] px-4 rounded-xl font-bold text-[14px] min-[390px]:text-[14.8px] uppercase tracking-[0.04em] shrink-0 cursor-pointer transition active:scale-95 tabular-nums ${
            bleHrStatus.state === "connected"
              ? "bg-[#051810] border border-[#00C853]/65 text-white"
              : "bg-[#101006] border border-[#FFE500] text-white hover:bg-[#181808]"
          }`}
        >
          {bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
            ? `${bleHrStatus.currentBpm} BPM`
            : t("bleHrConnect")}
        </button>
      </div>

      {/* Paused Draft Session Restore Card (if present) */}
      {draftSession && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-2xl border border-[#FFE500]/35 bg-[#0B0E14] flex flex-col gap-3 relative overflow-hidden"
        >
          <div className="flex justify-between items-start gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[13px] text-[#FFE500] font-extrabold tracking-widest uppercase flex items-center gap-1.5">
                <RotateCcw size={13} />
                {tx("Sesión Pausada", "Paused Session")}
              </span>
              <h4 className="text-white text-[18px] font-bold mt-1 break-words leading-tight tabular-nums">
                {draftSession.format === "Libre" ? tx("Libre", "Custom") : draftSession.format} ·{" "}
                {formatShootingDistance(
                  Number(draftSession.distance) || 18,
                  draftSession.format === "Libre" ? unitSystem : "metric",
                  draftSession.distanceUnit,
                  draftSession.distanceValue
                )}{" "}
                · {getLocalizedBowName(draftSession.bowType)}
              </h4>
              <p className="text-[13px] text-white tabular-nums">
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
              type="button"
              onClick={handleDiscardDraft}
              className="w-8 h-8 rounded-lg border border-white bg-white text-black hover:bg-neutral-200 flex items-center justify-center shrink-0 transition cursor-pointer"
              title={tx("Descartar Borrador", "Discard Draft")}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleResumeDraft}
            className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[#FFE500] hover:brightness-105 text-black font-extrabold text-[15.5px] min-[390px]:text-[17px] text-center leading-tight uppercase tracking-wider flex justify-center items-center gap-1.5 cursor-pointer transition"
          >
            <RotateCcw size={15} className="shrink-0" />
            <span className="text-center leading-tight">
              {tx("Reanudar Entrenamiento", "Resume Training")}
            </span>
          </button>
        </motion.div>
      )}

      {/* CARD 1: 1-TAP QUICK SHOOT HERO CHASSIS */}
      <div className="bg-[#070B12] border border-[#00BFFF]/35 rounded-[24px] p-4 sm:p-5 flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] sm:text-[13px] font-extrabold uppercase tracking-[0.08em] text-[#00BFFF] leading-tight break-words">
            {tx("Última configuración", "Last setup")}
          </span>
          <span className="px-3 py-1 rounded-full border border-[#00BFFF]/50 bg-[#041523] text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-[#00BFFF] leading-none shrink-0 tabular-nums">
            {tx("1 toque", "1 tap")}
          </span>
        </div>

        <h3 className="text-[22px] min-[390px]:text-[24px] sm:text-[26px] font-extrabold text-white leading-tight break-words tabular-nums">
          {`${getLocalizedPracticeName(practiceType)} · ${formattedCurrentDistance} · ${getLocalizedBowName(
            bowType
          )}`}
        </h3>

        {/* Compact Spec Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-[#0D1119] border border-white/[0.10] text-[13px] font-bold text-white leading-tight tabular-nums">
            {practiceType === "Volumen"
              ? tx("Carga libre de flechas", "Open arrow load")
              : `${endsCount} ${t("rounds")} × ${arrowsPerEnd} ${t("arrowsLabel")}`}
          </span>
          {practiceType !== "Volumen" && (
            <span className="px-3 py-1.5 rounded-xl bg-[#0D1119] border border-white/[0.10] text-[13px] font-bold text-white leading-tight tabular-nums">
              {targetFaceSummary}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-xl bg-[#0D1119] border border-white/[0.10] text-[13px] font-bold text-white leading-tight tabular-nums">
            {format === "Libre"
              ? tx("Formato Libre", "Custom Format")
              : `${tx("Formato", "Format")} ${format}`}
          </span>
        </div>

        {/* Primary 1-Tap Launch CTA */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.985 }}
          onClick={handleStart}
          className="w-full min-h-[56px] px-4 py-3.5 rounded-2xl bg-[#00BFFF] hover:bg-[#19C8FF] text-black font-black text-[16.5px] min-[390px]:text-[18px] tracking-[0.05em] uppercase flex items-center justify-center gap-2.5 cursor-pointer transition-colors"
        >
          <Play size={18} fill="currentColor" strokeWidth={2} className="shrink-0" />
          <span className="text-center leading-tight">
            {tx("Iniciar ahora", "Start now")}
          </span>
        </motion.button>

        {/* Secondary 1-Tap Quick Launchers: Quick Volume + Shot Analysis */}
        <div
          className={`grid ${
            onOpenAnalysis ? "grid-cols-2" : "grid-cols-1"
          } gap-2.5`}
        >
          <button
            type="button"
            onClick={handleQuickVolume}
            className="min-h-[48px] px-3 py-2 rounded-2xl bg-[#0D1119] hover:bg-[#131924] border border-white/[0.11] text-white font-bold text-[13.5px] min-[390px]:text-[14.5px] flex items-center justify-center gap-2 text-center leading-tight cursor-pointer transition active:scale-[0.98]"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#FFE500] shrink-0" />
            <span className="break-words leading-tight">
              {tx("Volumen rápido", "Quick Volume")}
            </span>
          </button>

          {onOpenAnalysis && (
            <button
              type="button"
              onClick={onOpenAnalysis}
              className="min-h-[48px] px-3 py-2 rounded-2xl bg-[#0D1119] hover:bg-[#131924] border border-white/[0.11] text-white font-bold text-[13.5px] min-[390px]:text-[14.5px] flex items-center justify-center gap-2 text-center leading-tight cursor-pointer transition active:scale-[0.98]"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#00BFFF] shrink-0" />
              <span className="break-words leading-tight">
                {tx("Análisis de tiro", "Shot Analysis")}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* CARD 2: COLLAPSIBLE CUSTOMIZE SESSION PANEL */}
      <div className="bg-[#080B11] border border-white/[0.10] rounded-[24px] p-4 sm:p-5 flex flex-col gap-4 mb-4">
        <button
          type="button"
          onClick={() => setIsCustomOpen((prev) => !prev)}
          aria-expanded={isCustomOpen}
          className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
        >
          <span className="text-[15px] sm:text-[16px] font-extrabold uppercase tracking-[0.06em] text-white leading-tight break-words">
            {tx("Personalizar sesión", "Customize session")}
          </span>
          <span className="inline-flex items-center gap-1 text-[13.5px] font-bold text-[#00BFFF] shrink-0">
            <span>{isCustomOpen ? tx("Ocultar", "Hide") : tx("Editar", "Edit")}</span>
            {isCustomOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {isCustomOpen && (
          <div className="flex flex-col gap-4 pt-0.5">
            {/* 1. MODALIDAD */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-white">
                {tx("Modalidad", "Mode")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["Práctica", "Control", "Volumen"] as const).map((type) => {
                  const active = practiceType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setPracticeType(type)}
                      className={`min-h-[46px] px-2 py-1.5 rounded-xl border text-[13.5px] min-[390px]:text-[15px] font-bold flex items-center justify-center text-center leading-tight break-words transition cursor-pointer ${
                        active
                          ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                          : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                      }`}
                    >
                      <span className="block break-words leading-tight max-w-full text-center">
                        {getLocalizedPracticeName(type)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. FORMATO OFICIAL */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-white">
                {tx("Formato oficial", "Official format")}
              </label>
              <div className="grid grid-cols-2 min-[360px]:grid-cols-4 gap-2">
                {[
                  { id: "Libre", label: tx("Libre", "Custom") },
                  { id: "WA 720", label: "WA 720" },
                  { id: "WA 360", label: "WA 360" },
                  { id: "WA 300", label: "WA 300" }
                ].map((fmt) => {
                  const active = format === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => handleFormatChange(fmt.id)}
                      className={`min-h-[44px] px-2 py-1.5 rounded-xl border text-[14px] min-[390px]:text-[15px] font-bold flex items-center justify-center text-center leading-tight break-words tabular-nums transition cursor-pointer ${
                        active
                          ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                          : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                      }`}
                    >
                      {fmt.label}
                    </button>
                  );
                })}
              </div>

              {/* Indoor Vegas 300 option cleanly accessible */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleFormatChange("Vegas 300")}
                  className={`min-h-[38px] px-3.5 py-1 rounded-xl border text-[13px] font-bold flex items-center justify-center text-center leading-tight tabular-nums transition cursor-pointer ${
                    format === "Vegas 300"
                      ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                      : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                  }`}
                >
                  Vegas 300
                </button>
                {format !== "Libre" && (
                  <span className="text-[12.5px] font-bold text-[#00BFFF] tabular-nums text-right leading-tight break-words">
                    {endsCount} × {arrowsPerEnd} ({endsCount * arrowsPerEnd * 10} pts)
                    {bowType === "Compound" && format === "WA 300"
                      ? tx(" · 10 Reducido", " · Inner 10")
                      : ""}
                    {bowType === "Compound" && format === "Vegas 300"
                      ? tx(" · 10 Completo", " · Full 10")
                      : ""}
                  </span>
                )}
              </div>
            </div>

            {/* 3. DISTANCIA (18 m | 30 m | 50 m | 70 m | Otro) */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-white">
                {t("distance")}
              </label>
              <div className="grid grid-cols-5 gap-1.5 sm:gap-2 w-full">
                {PRIMARY_DISTANCES.map((d) => {
                  const isSelected = !showCustomDistance && distance === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setShowCustomDistance(false);
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
                      className={`min-h-[44px] px-1 py-1.5 rounded-xl border text-[13.5px] min-[390px]:text-[15px] font-extrabold flex items-center justify-center text-center leading-tight tabular-nums transition cursor-pointer ${
                        isSelected
                          ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                          : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                      }`}
                    >
                      {formatShootingDistance(d, format === "Libre" ? unitSystem : "metric")}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setShowCustomDistance((prev) => !prev)}
                  className={`min-h-[44px] px-1 py-1.5 rounded-xl border text-[13px] min-[390px]:text-[14px] font-bold flex items-center justify-center text-center leading-tight break-words transition cursor-pointer ${
                    isCustomDistanceSelected
                      ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                      : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                  }`}
                >
                  {tx("Otro", "Other")}
                </button>
              </div>

              {isCustomDistanceSelected && (
                <div className="bg-[#0B0E15] border border-white/[0.10] rounded-2xl p-3 flex flex-col gap-2.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {EXTRA_DISTANCES.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setDistance(d);
                          if (format === "WA 360") {
                            setEndsCount(6);
                            setArrowsPerEnd(6);
                          }
                        }}
                        className={`min-h-[38px] px-1 rounded-lg border text-[13px] font-bold tabular-nums cursor-pointer transition ${
                          distance === d
                            ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                            : "border-white/[0.10] bg-[#0D1017] text-white"
                        }`}
                      >
                        {formatShootingDistance(d, format === "Libre" ? unitSystem : "metric")}
                      </button>
                    ))}
                  </div>
                  <div className="h-11 flex items-center bg-[#0D1017] border border-white/[0.10] rounded-xl">
                    <button
                      type="button"
                      onClick={() => setDistance((prev) => Math.max(5, prev - 5))}
                      className="px-4 py-2 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center font-extrabold text-white text-[16px] tabular-nums">
                      {formattedCurrentDistance}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDistance((prev) => Math.min(120, prev + 5))}
                      className="px-4 py-2 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 4. TIPO DE ARCO */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-extrabold uppercase tracking-[0.08em] text-white">
                {t("bowType")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["Recurve", "Compound", "Barebow"] as const).map((type) => {
                  const active = bowType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setBowType(type);
                        if (format === "WA 720") {
                          setDistance(type === "Compound" ? 50 : 70);
                          setShowCustomDistance(false);
                        }
                      }}
                      className={`min-h-[44px] px-2 py-1.5 rounded-xl border text-[13.5px] min-[390px]:text-[15px] font-bold flex items-center justify-center text-center leading-tight break-words transition cursor-pointer ${
                        active
                          ? "border-[#00BFFF] bg-[#041B2D] text-[#00BFFF]"
                          : "border-white/[0.10] bg-[#0D1017] text-white hover:border-white/20"
                      }`}
                    >
                      <span className="block break-words leading-tight max-w-full text-center">
                        {getLocalizedBowName(type)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. TANDAS Y FLECHAS (Formato Libre) */}
            {format === "Libre" && practiceType !== "Volumen" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-white">
                    {t("rounds")}
                  </label>
                  <div className="h-11 flex items-center bg-[#0D1017] border border-white/[0.10] rounded-xl">
                    <button
                      type="button"
                      onClick={() => setEndsCount(Math.max(1, endsCount - 1))}
                      className="px-3.5 py-2.5 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center font-extrabold text-white text-[16.5px] leading-none tabular-nums">
                      {endsCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEndsCount(Math.min(maxAllowedEnds, endsCount + 1))}
                      disabled={endsCount >= maxAllowedEnds}
                      className="px-3.5 py-2.5 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer disabled:opacity-35"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-white">
                    {tx("Flechas", "Arrows")}
                  </label>
                  <div className="h-11 flex items-center bg-[#0D1017] border border-white/[0.10] rounded-xl">
                    <button
                      type="button"
                      onClick={() => setArrowsPerEnd(Math.max(1, arrowsPerEnd - 1))}
                      className="px-3.5 py-2.5 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center font-extrabold text-white text-[16.5px] leading-none tabular-nums">
                      {arrowsPerEnd}
                    </span>
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
                      className="px-3.5 py-2.5 text-[#00BFFF] font-black text-[20px] leading-none cursor-pointer disabled:opacity-35"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <BleHeartRateModal
        isOpen={showBleHrModal}
        userUid={user?.uid}
        onClose={() => setShowBleHrModal(false)}
      />
    </div>
  );
}
