"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { Search, UserPlus, ChevronRight, X, User, Target, Phone, Mail, Filter, ChevronDown, FileSpreadsheet } from "lucide-react";
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
    const athSess = sessions.filter(s => (s.userId === uid || s.userUid === uid) && !s.isDuel && !s.isDraft && s.deletedByArcher !== true);
    const isLiveNow = sessions.some(
      (s) =>
        (s.userId === uid || s.userUid === uid) &&
        !s.isDuel &&
        s.isDraft &&
        (s.updatedAt || s.timestamp || 0) >= Date.now() - SIX_HOURS_MS
    );
    const count = athSess.length;
    const lastTime = count > 0 ? Math.max(...athSess.map(s => s.timestamp || 0)) : 0;
    const scored = athSess.filter((s) => hasRealScore(s));
    const averageScore = scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + getSessionScore(s), 0) / scored.length)
      : 0;

    return { count, lastTime, averageScore, isLiveNow };
  };

  const filteredAthletes = athletes.filter(ath => {
    const matchesSearch = (ath.fullName || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (ath.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (ath.nickname || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBow = bowFilter === "ALL" || ath.bowConfig?.type === bowFilter;
    return matchesSearch && matchesBow;
  });

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      await showOledAlert("Por favor ingresa el nombre completo del alumno.");
      return;
    }

    const cleanNick = nickname.trim() || fullName.trim().split(" ")[0].toLowerCase();
    const cleanEmail = email.trim() || `${cleanNick}.${Date.now().toString().slice(-4)}@archery101010.com`;

    const newProfile: UserProfile = {
      uid: `USR-ATH-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
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
        brand: brand.trim() || "Genérico",
        model: model.trim() || "Estándar",
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
        const { saveLocalSetting, addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
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
            <span>Nuevo Alumno</span>
          </button>

          {onOpenPlanImporter && (
            <button
              type="button"
              onClick={() => onOpenPlanImporter()}
              className="h-11 px-3 rounded-xl bg-[#0D1017] hover:bg-[#131823] border border-white/[0.12] hover:border-cyan-neon/40 text-white font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet size={15} className="text-cyan-neon shrink-0" />
              <span>Cargar Plan</span>
            </button>
          )}
        </div>

        {/* Row 2: Unified Search + Bow Filter on a single clean line */}
        <div className="flex items-center gap-2 w-full min-w-0">
          <div className="flex-1 min-w-0 h-10 bg-[#0D1017] border border-white/[0.09] focus-within:border-cyan-neon rounded-xl px-3 flex items-center gap-2 transition">
            <Search size={14} className="text-white shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar alumno..."
              className="bg-transparent border-none text-white text-xs outline-none flex-1 min-w-0 placeholder:text-white"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="text-white text-xs p-0.5 cursor-pointer shrink-0"
                title="Limpiar búsqueda"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="relative w-[132px] sm:w-[156px] shrink-0">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-neon">
              <Filter size={12} />
            </div>
            <select
              value={bowFilter}
              onChange={(e) => setBowFilter(e.target.value)}
              aria-label="Filtrar por tipo de arco"
              className="w-full h-10 bg-[#0D1017] border border-white/[0.09] hover:border-cyan-neon/40 focus:border-cyan-neon text-white text-xs font-bold pl-7 pr-6 rounded-xl outline-none transition cursor-pointer appearance-none truncate"
            >
              <option value="ALL">Todos</option>
              <option value="Recurve">Recurvo</option>
              <option value="Compound">Compuesto</option>
              <option value="Barebow">Barebow</option>
              <option value="Traditional">Tradicional</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-white">
              <ChevronDown size={13} />
            </div>
          </div>
        </div>
      </div>

      {/* Roster list with generous breathing room */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2 px-1 pt-0.5">
          <span className="text-[12px] text-white font-black uppercase tracking-wider tabular-nums">
            Alumnos ({filteredAthletes.length})
          </span>
          <span className="text-[11.5px] text-cyan-neon font-bold whitespace-nowrap">
            Toca para ver ficha
          </span>
        </div>

        {filteredAthletes.length === 0 ? (
          <div className="text-center py-10 bg-[#0D1017] border border-white/[0.07] rounded-2xl flex flex-col items-center justify-center gap-2">
            <User size={28} className="text-white" />
            <p className="text-xs text-white font-bold">No hay alumnos que coincidan con la búsqueda.</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 text-[11.6px] text-cyan-neon uppercase tracking-wider font-extrabold border-b border-cyan-neon/50 hover:border-cyan-neon transition cursor-pointer"
            >
              + Crear el primer alumno ahora
            </button>
          </div>
        ) : (
          filteredAthletes.map((ath) => {
            const stats = getAthleteStats(ath.uid);
            const isOnlineSim = stats.isLiveNow || stats.lastTime > (Date.now() - 3 * 24 * 60 * 60 * 1000);
            const bowLabel =
              ath.bowConfig?.type === "Recurve"
                ? "Recurvo"
                : ath.bowConfig?.type === "Compound"
                ? "Compuesto"
                : ath.bowConfig?.type || "Barebow";

            return (
              <div
                key={ath.uid}
                onClick={() => onViewAthlete(ath)}
                className="bg-[#0D1017] px-3.5 py-3.5 rounded-2xl border border-white/[0.08] hover:border-cyan-neon/30 hover:bg-[#111520] transition cursor-pointer flex justify-between items-center gap-2.5 group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[#121620] border border-white/[0.12] flex items-center justify-center font-black text-xs text-white">
                      {ath.fullName.substring(0, 2).toUpperCase()}
                    </div>
                    {isOnlineSim && (
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0D1017] ${
                          stats.isLiveNow ? "bg-emerald-400" : "bg-cyan-neon"
                        }`}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-white text-[13.5px] font-extrabold leading-snug group-hover:text-cyan-neon transition-colors truncate">
                        {ath.fullName}
                      </span>
                      {stats.isLiveNow && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 font-black uppercase tracking-wider shrink-0 whitespace-nowrap">
                          ● EN VIVO
                        </span>
                      )}
                    </div>
                    <span className="text-[11.5px] text-white truncate tabular-nums">
                      {bowLabel} · {ath.bowConfig?.poundage ? `${ath.bowConfig.poundage}#` : "—"} · {ath.bowConfig?.defaultDistance || 70}m · {stats.count} {stats.count === 1 ? "control" : "controles"}
                      {stats.averageScore > 0 ? ` · Prom. ${stats.averageScore}` : ""}
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
                      className="h-8 px-2.5 rounded-xl bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[11px] font-black uppercase tracking-wider flex items-center gap-1 transition cursor-pointer active:scale-95 shrink-0 whitespace-nowrap"
                      title={`Cargar plan Excel/Sheets a ${ath.fullName}`}
                    >
                      <FileSpreadsheet size={12} className="shrink-0" />
                      <span>Plan</span>
                    </button>
                  )}
                  <ChevronRight size={15} className="text-white group-hover:text-cyan-neon transition-colors shrink-0" />
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
                      Crear Perfil de Alumno
                    </h3>
                    <p className="text-[11.6px] text-white">
                      Registra a un nuevo atleta bajo tu dirección
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-white hover:text-white hover:bg-neutral-800 transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5 text-left">
                {/* Nombre Completo */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    Nombre Completo *
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
                      Apodo / Alias
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
                      Género
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as "M" | "F")}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="M">Masculino</option>
                      <option value="F">Femenino</option>
                    </select>
                  </div>
                </div>

                {/* Tipo de Arco & Libras */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      Tipo de Arco
                    </label>
                    <select
                      value={bowType}
                      onChange={(e) => setBowType(e.target.value as any)}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="Recurve">Recurvo</option>
                      <option value="Compound">Compuesto</option>
                      <option value="Barebow">Barebow</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      Potencia (Libras #)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="75"
                      value={poundage}
                      onChange={(e) => setPoundage(e.target.value)}
                      placeholder="Ej. 38"
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition tabular-nums"
                    />
                  </div>
                </div>

                {/* Distancia Principal & Correo */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      Distancia Reglamentaria
                    </label>
                    <select
                      value={defaultDistance}
                      onChange={(e) => setDefaultDistance(Number(e.target.value))}
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer tabular-nums"
                    >
                      <option value={18}>18 Metros (Sala)</option>
                      <option value={30}>30 Metros</option>
                      <option value={50}>50 Metros</option>
                      <option value={60}>60 Metros</option>
                      <option value={70}>70 Metros (Olímpico)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      Teléfono / WhatsApp
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
                      Marca de Arco (opcional)
                    </label>
                    <input
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="Ej. Marca deportiva"
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <label className="min-h-[30px] flex items-end text-[12.6px] leading-tight text-white font-black uppercase tracking-wider">
                      Modelo (opcional)
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Ej. Modelo de competencia"
                      className="w-full min-w-0 bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                </div>

                {/* Correo Electrónico */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    Correo del Alumno (opcional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alumno@ejemplo.com"
                    className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                  />
                </div>

                {/* Notas Iniciales */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                    Notas Técnicas Iniciales
                  </label>
                  <textarea
                    rows={2}
                    value={initialNote}
                    onChange={(e) => setInitialNote(e.target.value)}
                    placeholder="Observaciones de postura, anclaje, suelta..."
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
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition cursor-pointer"
                  >
                    Guardar Perfil
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
