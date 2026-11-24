"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  Search,
  UserPlus,
  ChevronRight,
  X,
  User,
  Filter,
  ChevronDown,
  FileSpreadsheet
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { getSessionScore, hasRealScore } from "@/lib/scoring/sessionMetrics";
import { showOledAlert } from "@/lib/oledDialog";

interface CoachAthletesTabProps {
  athletes: UserProfile[];
  onViewAthlete: (athlete: UserProfile) => void;
  sessions: any[];
  coachUid?: string;
  activeClubId?: string;
  onCreateAthlete?: (newAthlete: UserProfile) => void;
  onOpenPlanImporter?: (preselectedAthleteId?: string) => void;
}

export default function CoachAthletesTab({
  athletes,
  onViewAthlete,
  sessions,
  coachUid,
  activeClubId,
  onCreateAthlete,
  onOpenPlanImporter
}: CoachAthletesTabProps) {
  const { language, t, tx } = useLanguage();
  const isEs = language === "es";
  const [searchTerm, setSearchTerm] = useState("");
  const [bowFilter, setBowFilter] = useState<string>("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Hook into mobile back button and gestures
  React.useEffect(() => {
    if (isModalOpen) {
      return registerModalDismiss(() => setIsModalOpen(false));
    }
  }, [isModalOpen]);

  // New athlete form state
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">("Recurve");
  const [poundage, setPoundage] = useState<string>("38");
  const [defaultDistance, setDefaultDistance] = useState<number>(70);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [phone, setPhone] = useState("");
  const [initialNote, setInitialNote] = useState("");

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  // Calculate active states (strictly completed sessions for historical precision averages)
  const getAthleteStats = (uid: string) => {
    const athSess = sessions.filter(
      (s) =>
        (s.userId === uid || s.userUid === uid) &&
        !s.isDuel &&
        !s.isDraft &&
        s.deletedByArcher !== true
    );
    const isLiveNow = sessions.some(
      (s) =>
        (s.userId === uid || s.userUid === uid) &&
        !s.isDuel &&
        s.isDraft &&
        (s.updatedAt || s.timestamp || 0) >= Date.now() - SIX_HOURS_MS
    );
    const count = athSess.length;
    const lastTime = count > 0 ? Math.max(...athSess.map((s) => s.timestamp || 0)) : 0;
    const scored = athSess.filter((s) => hasRealScore(s));
    const averageScore =
      scored.length > 0
        ? Math.round(scored.reduce((sum, s) => sum + getSessionScore(s), 0) / scored.length)
        : 0;

    return { count, lastTime, averageScore, isLiveNow };
  };

  const filteredAthletes = athletes.filter((ath) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      (ath.fullName || "").toLowerCase().includes(q) ||
      (ath.email || "").toLowerCase().includes(q) ||
      (ath.nickname || "").toLowerCase().includes(q);
    const matchesBow = bowFilter === "ALL" || ath.bowConfig?.type === bowFilter;
    return matchesSearch && matchesBow;
  });

  const formatBowLabel = (type?: string) => {
    const raw =
      type === "Recurve"
        ? t("bowRecurve")
        : type === "Compound"
        ? t("bowCompound")
        : type === "Barebow"
        ? t("bowBarebow")
        : type === "Traditional"
        ? tx("Tradicional", "Traditional")
        : type || t("bowBarebow");
    return isEs ? raw : raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      await showOledAlert(
        tx(
          "Por favor ingresa el nombre completo del alumno.",
          "Please enter the athlete's full name."
        )
      );
      return;
    }

    const athUid = `USR-ATH-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;
    const cleanNick = nickname.trim() || fullName.trim().split(" ")[0].toLowerCase();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      await showOledAlert(
        tx(
          "Por favor ingresa un correo electrónico válido o déjalo vacío.",
          "Please enter a valid email address or leave it blank."
        )
      );
      return;
    }

    if (
      trimmedEmail &&
      athletes.some((existing) => (existing.email || "").toLowerCase() === trimmedEmail)
    ) {
      await showOledAlert(
        tx(
          "Ya existe un alumno registrado con ese correo electrónico.",
          "An athlete with that email address is already registered."
        )
      );
      return;
    }

    const safeSlug = cleanNick.replace(/[^a-z0-9]/gi, "").toLowerCase() || "athlete";
    const cleanEmail = trimmedEmail || `${safeSlug}.${athUid.toLowerCase()}@placeholder.local`;

    const newProfile: UserProfile = {
      uid: athUid,
      fullName: fullName.trim(),
      nickname: cleanNick,
      email: cleanEmail,
      birthDate: "2004-01-01",
      country: "CR",
      city: "San José",
      gender,
      clubId: activeClubId || null,
      clubName: null,
      bowConfig: {
        type: bowType,
        brand: brand.trim() || tx("Genérico", "Standard"),
        model: model.trim() || tx("Estándar", "Standard"),
        poundage: Number(poundage) || 30,
        defaultDistance
      },
      physicalData: {
        height: 170,
        weight: 65,
        dominantEye: "R",
        dominantHand: "R"
      },
      whatsappNumber: phone.trim() || undefined,
      role: "archer",
      plan: "FREE",
      isClubCreator: false
    };

    if (initialNote.trim()) {
      const nowTs = Date.now();
      const initialNotesArray = [
        {
          id: `NOTE-${nowTs}`,
          date: nowTs,
          content: initialNote.trim()
        }
      ];
      try {
        const { saveLocalSetting, addToSyncQueue, generateResilientId } = await import(
          "@/lib/db/indexedDB"
        );
        await saveLocalSetting(`coach_notes_${newProfile.uid}`, initialNotesArray);

        if (coachUid) {
          const noteDocId = `NOTE-${coachUid}-${newProfile.uid}`;
          const recordPayload = {
            id: noteDocId,
            coachId: coachUid,
            clubId: activeClubId || `CLB-${coachUid}`,
            type: "note" as const,
            athleteUid: newProfile.uid,
            notes: initialNotesArray,
            updatedAt: nowTs
          };
          try {
            if (typeof navigator === "undefined" || navigator.onLine) {
              const { doc, setDoc } = await import("firebase/firestore");
              const { db } = await import("@/lib/firebase");
              await setDoc(doc(db, "coach_records", noteDocId), recordPayload, { merge: true });
            }
          } catch {
            // fallback to sync queue below
          }
          await addToSyncQueue({
            id: generateResilientId("TXN"),
            collection: "coach_records",
            operation: "UPDATE",
            payloadId: noteDocId,
            payload: recordPayload,
            timestamp: nowTs
          });
        }
      } catch (noteErr) {
        console.warn("Error saving initial coach note:", noteErr);
      }
    }

    if (onCreateAthlete) {
      onCreateAthlete(newProfile);
    }

    // Reset form
    setFullName("");
    setNickname("");
    setEmail("");
    setBrand("");
    setModel("");
    setPhone("");
    setInitialNote("");
    setIsModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Grouped Coach Controls: Row 1 Actions | Row 2 Search + Bow Filter */}
      <div className="flex flex-col gap-2.5 w-full max-w-full">
        {/* Row 1: Primary & Secondary Actions grouped side-by-side */}
        <div className={`grid ${onOpenPlanImporter ? "grid-cols-2" : "grid-cols-1"} gap-2.5 w-full`}>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="h-11 px-3 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer whitespace-nowrap"
          >
            <UserPlus size={15} className="stroke-[2.5] shrink-0" />
            <span>{tx("Nuevo Alumno", "New Athlete")}</span>
          </button>

          {onOpenPlanImporter && (
            <button
              type="button"
              onClick={() => onOpenPlanImporter()}
              className="h-11 px-3 rounded-xl bg-[#0D1017] hover:bg-[#131823] border border-white/[0.12] hover:border-cyan-neon/40 text-white font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet size={15} className="text-cyan-neon shrink-0" />
              <span>{tx("Cargar Plan", "Import Plan")}</span>
            </button>
          )}
        </div>

        {/* Row 2: Unified Search + Bow Filter on a single clean line (RTL-logical) */}
        <div className="flex items-center gap-2 w-full min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-white pointer-events-none"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full h-10 bg-[#0D1017] border border-white/[0.09] focus:border-cyan-neon rounded-xl ps-9 pe-8 text-white text-xs outline-none transition placeholder:text-white/75"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                aria-label={tx("Limpiar búsqueda", "Clear search")}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-white text-xs cursor-pointer"
                title={tx("Limpiar búsqueda", "Clear search")}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="relative w-[132px] sm:w-[156px] shrink-0">
            <div className="absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-neon">
              <Filter size={12} />
            </div>
            <select
              value={bowFilter}
              onChange={(e) => setBowFilter(e.target.value)}
              aria-label={tx("Filtrar por tipo de arco", "Filter by bow type")}
              className={`w-full h-10 bg-[#0D1017] border border-white/[0.09] hover:border-cyan-neon/40 focus:border-cyan-neon text-white text-xs font-bold ps-7 pe-6 rounded-xl outline-none transition cursor-pointer appearance-none break-words leading-tight${
                isEs ? "" : " text-center"
              }`}
            >
              <option value="ALL">{t("filterAll")}</option>
              <option value="Recurve">{formatBowLabel("Recurve")}</option>
              <option value="Compound">{formatBowLabel("Compound")}</option>
              <option value="Barebow">{formatBowLabel("Barebow")}</option>
              <option value="Traditional">{formatBowLabel("Traditional")}</option>
            </select>
            <div className="absolute end-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-white">
              <ChevronDown size={13} />
            </div>
          </div>
        </div>
      </div>

      {/* Roster list with generous breathing room */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2 px-1 pt-0.5">
          <span className="text-[12px] text-white font-black uppercase tracking-wider tabular-nums">
            {tx("Alumnos", "Athletes")} ({filteredAthletes.length})
          </span>
          <span className="text-[11.5px] text-cyan-neon font-bold whitespace-nowrap">
            {tx("Toca para ver ficha", "Tap to view profile")}
          </span>
        </div>

        {filteredAthletes.length === 0 ? (
          <div className="text-center py-10 bg-[#0D1017] border border-white/[0.07] rounded-2xl flex flex-col items-center justify-center gap-2">
            <User size={28} className="text-white" />
            <p className="text-xs text-white font-bold">
              {tx(
                "No hay alumnos que coincidan con la búsqueda.",
                "No athletes match the current search."
              )}
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 text-[11.6px] text-cyan-neon uppercase tracking-wider font-extrabold border-b border-cyan-neon/50 hover:border-cyan-neon transition cursor-pointer"
            >
              {tx("+ Crear el primer alumno ahora", "+ Create your first athlete now")}
            </button>
          </div>
        ) : (
          filteredAthletes.map((ath) => {
            const stats = getAthleteStats(ath.uid);
            const isOnlineSim =
              stats.isLiveNow || stats.lastTime > Date.now() - 3 * 24 * 60 * 60 * 1000;
            const bowLabel = formatBowLabel(ath.bowConfig?.type);

            return (
              <div
                key={ath.uid}
                onClick={() => onViewAthlete(ath)}
                className="bg-[#0D1017] px-3.5 py-3.5 rounded-2xl border border-white/[0.08] hover:border-cyan-neon/30 hover:bg-[#111520] transition cursor-pointer flex justify-between items-center gap-2.5 group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[#121620] border border-white/[0.12] flex items-center justify-center font-black text-xs text-white">
                      {(ath.fullName || ath.email || "?").trim().slice(0, 2).toUpperCase() || "?"}
                    </div>
                    {isOnlineSim && (
                      <span
                        className={`absolute bottom-0 end-0 w-2.5 h-2.5 rounded-full border-2 border-[#0D1017] ${
                          stats.isLiveNow ? "bg-emerald-400" : "bg-cyan-neon"
                        }`}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-white text-[13.5px] font-extrabold leading-snug group-hover:text-cyan-neon transition-colors break-words leading-tight">
                        {ath.fullName}
                      </span>
                      {stats.isLiveNow && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider shrink-0 whitespace-nowrap">
                          ● {tx("EN VIVO", "LIVE")}
                        </span>
                      )}
                    </div>
                    <span className="text-[11.5px] text-white break-words leading-tight tabular-nums">
                      {bowLabel} · {ath.bowConfig?.poundage ? `${ath.bowConfig.poundage}#` : "—"} ·{" "}
                      {ath.bowConfig?.defaultDistance || 70}m · {stats.count}{" "}
                      {stats.count === 1
                        ? tx("control", "session")
                        : tx("controles", "sessions")}
                      {stats.averageScore > 0
                        ? ` · ${tx("Prom.", "Avg.")} ${stats.averageScore}`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {onOpenPlanImporter && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenPlanImporter(ath.uid);
                      }}
                      className="min-h-[36px] h-9 px-2.5 rounded-xl bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[11px] font-black uppercase tracking-wider flex items-center gap-1 transition cursor-pointer active:scale-95 shrink-0 whitespace-nowrap"
                      title={tx(
                        `Cargar plan mensual a ${ath.fullName}`,
                        `Assign monthly plan to ${ath.fullName}`
                      )}
                    >
                      <FileSpreadsheet size={12} className="shrink-0" aria-hidden="true" />
                      <span>{tx("Plan", "Plan")}</span>
                    </button>
                  )}
                  <ChevronRight
                    size={15}
                    className="text-white group-hover:text-cyan-neon transition-colors shrink-0 rtl:rotate-180"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL: Crear Perfil de Alumno */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-neutral-950 border border-white/10 rounded-3xl w-full max-w-md max-h-[90dvh] flex flex-col shadow-[0_15px_40px_rgba(0,0,0,0.8)] overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-neutral-900/50">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon">
                    <UserPlus size={16} />
                  </div>
                  <div>
                    <h3 className="text-white text-sm font-black uppercase tracking-wider">
                      {tx("Crear Perfil de Alumno", "Create Athlete Profile")}
                    </h3>
                    <p className="text-[11.6px] text-white">
                      {tx(
                        "Registra a un nuevo atleta bajo tu dirección",
                        "Register a new athlete on your coaching roster"
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  aria-label={tx("Cerrar formulario de alumno", "Close athlete form")}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-white hover:bg-neutral-800 transition cursor-pointer shrink-0"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Modal Form */}
              <form
                onSubmit={handleCreateSubmit}
                className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5 text-start"
              >
                {/* Nombre Completo */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    {t("fullName")} *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder=""
                    className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                  />
                </div>

                {/* Nickname & Género */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("nickname")}
                    </label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder=""
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("gender")}
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as "M" | "F")}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="M">{t("genderM")}</option>
                      <option value="F">{t("genderF")}</option>
                    </select>
                  </div>
                </div>

                {/* Tipo de Arco & Libras */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("bowType")}
                    </label>
                    <select
                      value={bowType}
                      onChange={(e) => setBowType(e.target.value as any)}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="Recurve">{formatBowLabel("Recurve")}</option>
                      <option value="Compound">{formatBowLabel("Compound")}</option>
                      <option value="Barebow">{formatBowLabel("Barebow")}</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("poundage")}
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="75"
                      value={poundage}
                      onChange={(e) => setPoundage(e.target.value)}
                      placeholder="38"
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition tabular-nums"
                    />
                  </div>
                </div>

                {/* Distancia Principal & Teléfono */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("defaultDist")}
                    </label>
                    <select
                      value={defaultDistance}
                      onChange={(e) => setDefaultDistance(Number(e.target.value))}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer tabular-nums"
                    >
                      <option value={18}>{tx("18 Metros (Sala)", "18m (Indoor)")}</option>
                      <option value={30}>{tx("30 Metros", "30m")}</option>
                      <option value={50}>{tx("50 Metros", "50m")}</option>
                      <option value={60}>{tx("60 Metros", "60m")}</option>
                      <option value={70}>{tx("70 Metros (Olímpico)", "70m (Olympic)")}</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("phoneMessagingLabel")}
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+506 8888 8888"
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition tabular-nums"
                    />
                  </div>
                </div>

                {/* Marca & Modelo */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("bowBrand")}
                    </label>
                    <input
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder={tx("Opcional", "Optional")}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      {t("bowModel")}
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={tx("Opcional", "Optional")}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                </div>

                {/* Correo Electrónico */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    {tx("Correo del Alumno (opcional)", "Athlete Email (optional)")}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={tx("alumno@ejemplo.com", "athlete@example.com")}
                    className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                  />
                </div>

                {/* Notas Iniciales */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    {tx("Notas Técnicas Iniciales", "Initial Technical Notes")}
                  </label>
                  <textarea
                    rows={2}
                    value={initialNote}
                    onChange={(e) => setInitialNote(e.target.value)}
                    placeholder={tx(
                      "Observaciones de postura, anclaje, suelta...",
                      "Stance, anchor, release observations..."
                    )}
                    className="bg-neutral-900/80 border border-white/10 rounded-xl p-2.5 text-white text-xs outline-none focus:border-cyan-neon transition resize-none"
                  />
                </div>

                {/* Submit button */}
                <div className="flex gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-900 text-white font-bold text-xs uppercase tracking-wider hover:text-white transition cursor-pointer"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition cursor-pointer"
                  >
                    {tx("Guardar Perfil", "Save Profile")}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
