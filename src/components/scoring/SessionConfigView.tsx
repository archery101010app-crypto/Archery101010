import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions, deleteLocalSession } from "@/lib/db/indexedDB";
import { ArrowLeft, Target, Settings, ChevronDown, Check, Trash2, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";

interface SessionConfigViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartSession: (config: any) => void;
}

const DISTANCES = [18, 30, 50, 60, 70, 90];

export default function SessionConfigView({ user, onBack, onStartSession }: SessionConfigViewProps) {
  const { language, t } = useLanguage();
  const [draftSession, setDraftSession] = useState<any | null>(null);

  // Configuration States
  const [practiceType, setPracticeType] = useState<"Control" | "Práctica" | "Volumen">("Práctica");
  const [format, setFormat] = useState<"WA 300" | "WA 720" | "Libre">("WA 300");
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(user.bowConfig.type || "Barebow");
  const [distance, setDistance] = useState(user.bowConfig.defaultDistance || 18);
  const [autoScore, setAutoScore] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(true);
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
  const handleFormatChange = (newFormat: "WA 300" | "WA 720" | "Libre") => {
    setFormat(newFormat);
    if (newFormat === "WA 300") {
      setEndsCount(10);
      setArrowsPerEnd(3);
    } else if (newFormat === "WA 720") {
      setEndsCount(12);
      setArrowsPerEnd(6);
    }
  };

  const handleStart = () => {
    onStartSession({
      practiceType,
      format,
      bowType,
      distance,
      autoScore,
      includeNotes,
      endsCount,
      arrowsPerEnd,
      maxScore: endsCount * arrowsPerEnd * 10 // e.g. 10 * 3 * 10 = 300
    });
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
    <div className="flex flex-col gap-5 py-4 min-h-full">
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
      <div className="flex-1 flex flex-col gap-5">
        {/* Draft Restore Alert Card */}
        {draftSession && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 rounded-2xl border border-yellow-gold/30 bg-yellow-gold/5 flex flex-col gap-3 shadow-glow-yellow/5 relative overflow-hidden"
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
                onClick={() => setPracticeType(type)}
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
              onChange={(e) => handleFormatChange(e.target.value as any)}
              className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-4 py-3.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan transition duration-200 appearance-none"
            >
              <option value="WA 300" className="bg-black text-white">WA 300 (10 Ends x 3 Flechas)</option>
              <option value="WA 720" className="bg-black text-white">WA 720 (12 Ends x 6 Flechas)</option>
              <option value="Libre" className="bg-black text-white">Ajuste Libre / Manual</option>
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-dim pointer-events-none" />
          </div>
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
            {t("distance")} (m)
          </label>
          <div className="grid grid-cols-6 gap-1.5">
            {DISTANCES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDistance(d)}
                className={`py-2.5 rounded-xl border text-xs font-black transition-all duration-200 cursor-pointer ${
                  distance === d
                    ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                    : "border-white/10 bg-neutral-900/40 text-gray-dim hover:text-white"
                }`}
              >
                {d}
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

        {/* Toggles */}
        <div className="flex flex-col gap-3.5 mt-2 bg-neutral-900/30 p-4 rounded-2xl border border-white/5">
          <div className="flex justify-between items-center">
            <div className="flex flex-col gap-0.5">
              <span className="text-white text-sm font-bold">{t("autoScore")}</span>
              <span className="text-[10px] text-gray-dim leading-none">Avanzar al siguiente end automáticamente</span>
            </div>
            <button
              type="button"
              onClick={() => setAutoScore(!autoScore)}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                autoScore ? "bg-cyan-neon" : "bg-gray-border"
              }`}
            >
              <motion.div
                layout
                className="w-5 h-5 bg-white rounded-full absolute top-0.5"
                style={{ left: autoScore ? "22px" : "2px" }}
              />
            </button>
          </div>

          <div className="flex justify-between items-center">
            <div className="flex flex-col gap-0.5">
              <span className="text-white text-sm font-bold">{t("includeNotes")}</span>
              <span className="text-[10px] text-gray-dim leading-none">Habilitar notas en ends y sumario</span>
            </div>
            <button
              type="button"
              onClick={() => setIncludeNotes(!includeNotes)}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                includeNotes ? "bg-cyan-neon" : "bg-gray-border"
              }`}
            >
              <motion.div
                layout
                className="w-5 h-5 bg-white rounded-full absolute top-0.5"
                style={{ left: includeNotes ? "22px" : "2px" }}
              />
            </button>
          </div>
        </div>

        {/* Start button */}
        <motion.button
          whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
          whileTap={{ scale: 0.98 }}
          onClick={handleStart}
          className="w-full py-4 mt-auto rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-extrabold text-sm tracking-wider uppercase shadow-glow-cyan cursor-pointer flex justify-center items-center gap-1.5"
        >
          <Target size={16} />
          <span>{t("startSessionBtn")}</span>
        </motion.button>
      </div>
    </div>
  );
}
