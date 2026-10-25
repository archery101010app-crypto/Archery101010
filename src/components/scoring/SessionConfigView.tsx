import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, deleteLocalSession, getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { ArrowLeft, Target, ChevronDown, Trash2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SessionConfigViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartSession: (config: any) => void;
}

const DISTANCES = [18, 30, 50, 60, 70];

export default function SessionConfigView({ user, onBack, onStartSession }: SessionConfigViewProps) {
  const { language, t } = useLanguage();
  const [draftSession, setDraftSession] = useState<any | null>(null);

  // Configuration States
  const [showPracticeInfoModal, setShowPracticeInfoModal] = useState(false);
  const [practiceInfoType, setPracticeInfoType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [dontShowAgainPractice, setDontShowAgainPractice] = useState(false);

  const [practiceType, setPracticeType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [format, setFormat] = useState<string>("Libre");
  const [targetType, setTargetType] = useState<string>("WA 300");
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(user?.bowConfig?.type || "Barebow");
  const [distance, setDistance] = useState(
    user?.bowConfig?.defaultDistance && user.bowConfig.defaultDistance <= 70 
      ? user.bowConfig.defaultDistance 
      : 18
  );
  const [endsCount, setEndsCount] = useState(10);
  const [arrowsPerEnd, setArrowsPerEnd] = useState(3);

  // Search for draft sessions on mount
  useEffect(() => {
    async function checkDrafts() {
      const list = await getLocalSessions();
      const draft = list.find((s) => s.isDraft === true);
      if (draft) {
        setDraftSession(draft);
      }
    }
    checkDrafts();
  }, []);

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

  const handleStart = () => {
    onStartSession({
      practiceType,
      format,
      targetType: format === "Vegas 300" || targetType === "Vegas 300" ? "Vegas 300" : "WA 300",
      bowType,
      distance,
      autoScore: true,
      includeNotes: true,
      endsCount,
      arrowsPerEnd,
      maxScore: endsCount * arrowsPerEnd * 10,
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
    if (draftSession && confirm("¿Estás seguro de que quieres descartar esta sesión pausada? Se perderá todo tu progreso.")) {
      await deleteLocalSession(draftSession.id);
      setDraftSession(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-2 min-h-full w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-neutral-900 border border-gray-border hover:border-white/10 text-gray-dim hover:text-white cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-white text-lg font-black uppercase tracking-wide">
            {t("newSession")}
          </h2>
          <p className="text-[10px] text-gray-dim uppercase tracking-wider">Configuración</p>
        </div>
      </div>

      {/* Configuration Form wrapper */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Draft Restore Alert Card */}
        {draftSession && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-2xl border border-yellow-gold/30 bg-yellow-gold/5 flex flex-col gap-3 shadow-sm relative overflow-hidden"
          >
            <div className="flex justify-between items-start">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-yellow-gold font-black tracking-widest uppercase flex items-center gap-1.5 animate-pulse">
                  <RotateCcw size={11} />
                  Sesión Pausada
                </span>
                <h4 className="text-white text-xs font-bold mt-1">
                  {draftSession.format} · {draftSession.distance}m · {draftSession.bowType}
                </h4>
                <p className="text-[9px] text-gray-dim">
                  Pausado el {new Date(draftSession.timestamp).toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </p>
              </div>
              <button
                onClick={handleDiscardDraft}
                className="p-1.5 rounded-lg border border-red-rival/20 bg-red-rival/5 text-red-rival hover:bg-red-rival/10 transition cursor-pointer"
                title="Descartar Borrador"
              >
                <Trash2 size={13} />
              </button>
            </div>
            
            <button
              onClick={handleResumeDraft}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-extrabold text-xs uppercase tracking-wider flex justify-center items-center gap-1.5 cursor-pointer shadow-md hover:brightness-105 transition"
            >
              <RotateCcw size={13} />
              <span>Reanudar Entrenamiento</span>
            </button>
          </motion.div>
        )}

        {/* Practice Type Chips */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {t("practiceType")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["Control", "Práctica", "Volumen"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={async () => {
                  const hide = await getLocalSetting(`hide_info_practice_${type}`, false);
                  if (hide) {
                    setPracticeType(type);
                  } else {
                    setPracticeInfoType(type);
                    setDontShowAgainPractice(false);
                    setShowPracticeInfoModal(true);
                  }
                }}
                className={`py-3 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
                  practiceType === type
                    ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                    : "border-white/10 bg-neutral-900/40 text-gray-dim hover:text-white"
                }`}
              >
                {type === "Control" ? t("practiceControl") : type === "Práctica" ? t("practicePractice") : t("practiceVolume")}
              </button>
            ))}
          </div>
        </div>

        {/* Format Select */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {t("sessionFormat")}
          </label>
          <div className="relative">
            <select
              value={format}
              onChange={(e) => handleFormatChange(e.target.value)}
              className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-4 py-3.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan transition duration-200 appearance-none font-bold"
            >
              <option value="Libre" className="bg-black text-white">Ajuste libre</option>
              <option value="WA 360" className="bg-black text-white">WA 360</option>
              <option value="WA 720" className="bg-black text-white">WA 720</option>
              <option value="WA 300" className="bg-black text-white">
                WA 300 {bowType === "Compound" ? "(10 Reducido Oficial)" : ""}
              </option>
              <option value="Vegas 300" className="bg-black text-white">
                Vegas 300 {bowType === "Compound" ? "(10 Completo)" : ""}
              </option>
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-dim pointer-events-none" />
          </div>
          {format !== "Libre" && (
            <p className="text-[10px] text-cyan-neon font-mono font-bold px-1">
              {endsCount} Ends × {arrowsPerEnd} Flechas ({endsCount * arrowsPerEnd * 10} pts máx)
            </p>
          )}

          {/* Selector de Diana específica para Compuesto 18m en Ajuste Libre */}
          {bowType === "Compound" && distance === 18 && format === "Libre" && (
            <div className="flex flex-col gap-1.5 mt-1 p-2.5 rounded-xl bg-neutral-900/50 border border-white/5">
              <label className="text-[10px] text-cyan-neon font-bold uppercase tracking-wider">
                Diana 18m Compuesto
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTargetType("WA 300")}
                  className={`py-2 px-2.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                    targetType === "WA 300"
                      ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                      : "border-white/10 bg-neutral-950/60 text-gray-dim hover:text-white"
                  }`}
                >
                  WA 300 (10 Pequeño)
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType("Vegas 300")}
                  className={`py-2 px-2.5 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                    targetType === "Vegas 300"
                      ? "border-cyan-neon bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                      : "border-white/10 bg-neutral-950/60 text-gray-dim hover:text-white"
                  }`}
                >
                  Vegas 300 (10 Completo)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bow Type Chips */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {t("bowType")}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["Recurve", "Compound", "Barebow"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setBowType(type)}
                className={`py-3 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
                  bowType === type
                    ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                    : "border-white/10 bg-neutral-900/40 text-gray-dim hover:text-white"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Distance Chips presets */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {t("distance")}
          </label>
          <div className="grid grid-cols-5 gap-2 w-full">
            {DISTANCES.map((d) => (
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
                className={`py-3 rounded-xl border text-xs sm:text-sm font-black transition-all duration-200 cursor-pointer flex items-center justify-center text-center ${
                  distance === d
                    ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                    : "border-white/10 bg-neutral-900/40 text-gray-dim hover:text-white"
                }`}
              >
                {d}m
              </button>
            ))}
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
              <label className="text-xs text-gray-dim font-bold">{t("rounds")} (Ends)</label>
              <div className="flex items-center bg-neutral-900/60 border border-cyan-brand rounded-xl">
                <button
                  type="button"
                  onClick={() => setEndsCount(Math.max(1, endsCount - 1))}
                  className="px-3.5 py-3 text-cyan-neon font-black text-lg cursor-pointer"
                >
                  -
                </button>
                <span className="flex-1 text-center font-bold text-white text-sm">{endsCount}</span>
                <button
                  type="button"
                  onClick={() => setEndsCount(endsCount + 1)}
                  className="px-3.5 py-3 text-cyan-neon font-black text-lg cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-dim font-bold">Flechas / End</label>
              <div className="flex items-center bg-neutral-900/60 border border-cyan-brand rounded-xl">
                <button
                  type="button"
                  onClick={() => setArrowsPerEnd(Math.max(1, arrowsPerEnd - 1))}
                  className="px-3.5 py-3 text-cyan-neon font-black text-lg cursor-pointer"
                >
                  -
                </button>
                <span className="flex-1 text-center font-bold text-white text-sm">{arrowsPerEnd}</span>
                <button
                  type="button"
                  onClick={() => setArrowsPerEnd(Math.min(12, arrowsPerEnd + 1))}
                  className="px-3.5 py-3 text-cyan-neon font-black text-lg cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Start button */}
        <motion.button
          whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
          whileTap={{ scale: 0.98 }}
          onClick={handleStart}
          className="w-full py-3.5 mt-2 mb-4 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-extrabold text-sm tracking-wider uppercase shadow-glow-cyan cursor-pointer flex justify-center items-center gap-1.5"
        >
          <Target size={16} />
          <span>{t("startSessionBtn")}</span>
        </motion.button>
      </div>

      {/* MODAL: Practice Info Explanation */}
      <AnimatePresence>
        {showPracticeInfoModal && (
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-left">
              <div>
                <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase">
                  Metodología de Práctica
                </span>
                <h3 className="text-white text-base font-black uppercase mt-1">
                  Modo: {practiceInfoType === "Control" ? t("practiceControl") : practiceInfoType}
                </h3>
              </div>

              <p className="text-xs text-gray-dim leading-relaxed">
                {practiceInfoType === "Control" && (
                  "Simulación estricta de competencia. Con tiempos oficiales, planilla de puntuación reglamentaria, diana activa y sin interrupciones. Ideal para evaluar tu nivel en torneos."
                )}
                {practiceInfoType === "Práctica" && (
                  "Entrenamiento regular y libre. Registra tus tiros con flexibilidad para analizar agrupamientos y técnica. Las notas por end están habilitadas."
                )}
                {practiceInfoType === "Volumen" && (
                  "Registra la estadística correspondiente a la cantidad de flechas lanzadas en la sesión"
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
                <label htmlFor="dontShowAgain" className="text-[10px] text-gray-dim font-bold cursor-pointer uppercase select-none">
                  No volver a mostrar
                </label>
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={handleConfirmPracticeInfo}
                  className="flex-1 py-3 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer"
                >
                  Entendido, Iniciar
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
