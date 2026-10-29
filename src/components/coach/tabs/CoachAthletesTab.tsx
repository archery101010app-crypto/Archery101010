"use client";

import React, { useState } from "react";
import { UserProfile } from "@/lib/authService";
import { Search, UserPlus, ChevronRight, X, User, Target, Phone, Mail, Filter, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";

interface CoachAthletesTabProps {
  athletes: UserProfile[];
  onViewAthlete: (athlete: UserProfile) => void;
  sessions: any[];
  onCreateAthlete?: (newAthlete: UserProfile) => void;
}

export default function CoachAthletesTab({ 
  athletes, 
  onViewAthlete, 
  sessions,
  onCreateAthlete 
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

  // Calculate active states
  const getAthleteStats = (uid: string) => {
    const athSess = sessions.filter(s => s.userId === uid || s.userUid === uid);
    const count = athSess.length;
    const lastTime = count > 0 ? Math.max(...athSess.map(s => s.timestamp)) : 0;
    const averageScore = athSess.filter(s => !s.isDuel).length > 0
      ? Math.round(athSess.filter(s => !s.isDuel).reduce((sum, s) => sum + s.score, 0) / athSess.filter(s => !s.isDuel).length)
      : 0;

    return { count, lastTime, averageScore };
  };

  const filteredAthletes = athletes.filter(ath => {
    const matchesSearch = (ath.fullName || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (ath.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (ath.nickname || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBow = bowFilter === "ALL" || ath.bowConfig?.type === bowFilter;
    return matchesSearch && matchesBow;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      alert("Por favor ingresa el nombre completo del alumno.");
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
      clubId: null,
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
      import("@/lib/db/indexedDB").then(({ saveLocalSetting }) => {
        saveLocalSetting(`coach_notes_${newProfile.uid}`, [
          {
            id: `NOTE-${Date.now()}`,
            date: Date.now(),
            content: initialNote.trim()
          }
        ]);
      });
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
      {/* Top Action Bar: Search, Filters and Create Button */}
      <div className="flex flex-col gap-2.5 w-full max-w-full">
        {/* Row 1: Search Input (Full width, easy to tap on mobile) */}
        <div className="w-full bg-neutral-900/60 border border-white/5 rounded-xl px-3 py-2.5 flex items-center gap-2 min-w-0">
          <Search size={15} className="text-white shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre o alias..."
            className="bg-transparent border-none text-white text-xs outline-none flex-1 min-w-0 placeholder:text-white"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="text-white hover:text-white text-xs p-0.5 cursor-pointer"
              title="Limpiar búsqueda"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Row 2: Bow Filter Box & Create Athlete Button (100% visible, no cut-off) */}
        <div className="flex items-center gap-2 w-full justify-between min-w-0">
          {/* Bow Selector Dropdown Box */}
          <div className="relative flex-1 min-w-0">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-cyan-neon">
              <Filter size={13} />
            </div>
            <select
              value={bowFilter}
              onChange={(e) => setBowFilter(e.target.value)}
              className="w-full bg-neutral-900/80 border border-white/10 hover:border-cyan-neon/40 focus:border-cyan-neon text-white text-xs pl-8 pr-7 py-2.5 rounded-xl outline-none transition cursor-pointer appearance-none truncate font-medium"
            >
              <option value="ALL">Todos los Arcos</option>
              <option value="Recurve">Arco Recurvo</option>
              <option value="Compound">Arco Compuesto</option>
              <option value="Barebow">Arco Barebow</option>
              <option value="Traditional">Arco Tradicional</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white">
              <ChevronDown size={14} />
            </div>
          </div>

          {/* Primary CTA: Create Athlete Profile */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-extrabold text-xs uppercase tracking-wider active:scale-95 transition cursor-pointer shrink-0"
          >
            <UserPlus size={14} className="stroke-[2.5]" />
            <span>Crear Alumno</span>
          </button>
        </div>
      </div>

      {/* Roster list */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between items-center px-1">
          <span className="text-[11.6px] text-white font-black uppercase tracking-wider">
            Alumnos Registrados ({filteredAthletes.length})
          </span>
          <span className="text-[10.5px] text-cyan-neon/80 font-bold">
            Toca a un alumno para ver sus puntuaciones
          </span>
        </div>

        {filteredAthletes.length === 0 ? (
          <div className="text-center py-10 bg-neutral-900/20 border border-white/5 rounded-2xl flex flex-col items-center justify-center gap-2">
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
            const isOnlineSim = stats.lastTime > (Date.now() - 3 * 24 * 60 * 60 * 1000); // active in last 3 days
            
            return (
              <div
                key={ath.uid}
                onClick={() => onViewAthlete(ath)}
                className="bg-neutral-900/40 p-3.5 rounded-2xl border border-white/5 hover:border-cyan-neon/20 hover:bg-neutral-900/60 transition cursor-pointer flex justify-between items-center gap-2 group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[#121620] border border-white/10 flex items-center justify-center font-black text-xs text-white">
                      {ath.fullName.substring(0, 2).toUpperCase()}
                    </div>
                    {isOnlineSim && (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-cyan-neon border-2 border-[#0B0D12]" />
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-xs font-bold leading-tight group-hover:text-cyan-neon transition-colors truncate">
                        {ath.fullName}
                      </span>
                      {ath.nickname && (
                        <span className="text-[10.5px] text-white font-medium truncate">
                          (@{ath.nickname})
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] text-white mt-0.5 truncate">
                      {ath.bowConfig?.type === "Recurve" ? "Recurvo" : ath.bowConfig?.type === "Compound" ? "Compuesto" : (ath.bowConfig?.type || "Barebow")} · {ath.bowConfig?.poundage ? `${ath.bowConfig.poundage}#` : "—"} · {ath.bowConfig?.defaultDistance || 70}m · {stats.count} {stats.count === 1 ? "control" : "controles"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {stats.averageScore > 0 && (
                    <div className="flex flex-col text-right shrink-0">
                      <span className="text-xs font-black text-yellow-gold whitespace-nowrap">{stats.averageScore} pts</span>
                      <span className="text-[9.3px] text-white leading-none">Promedio</span>
                    </div>
                  )}
                  <ChevronRight size={14} className="text-white group-hover:text-cyan-neon transition-colors shrink-0" />
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
              className="bg-neutral-950 border border-white/10 rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col shadow-[0_15px_40px_rgba(0,0,0,0.8)] overflow-hidden"
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
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Apodo / Alias
                    </label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder=""
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Género
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as "M" | "F")}
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="M">Masculino</option>
                      <option value="F">Femenino</option>
                    </select>
                  </div>
                </div>

                {/* Tipo de Arco & Libras */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Tipo de Arco
                    </label>
                    <select
                      value={bowType}
                      onChange={(e) => setBowType(e.target.value as any)}
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value="Recurve">Recurvo</option>
                      <option value="Compound">Compuesto</option>
                      <option value="Barebow">Barebow</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Potencia (Libras #)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="75"
                      value={poundage}
                      onChange={(e) => setPoundage(e.target.value)}
                      placeholder="Ej. 38"
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                </div>

                {/* Distancia Principal & Correo */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Distancia Reglamentaria
                    </label>
                    <select
                      value={defaultDistance}
                      onChange={(e) => setDefaultDistance(Number(e.target.value))}
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition cursor-pointer"
                    >
                      <option value={18}>18 Metros (Sala)</option>
                      <option value={30}>30 Metros</option>
                      <option value={50}>50 Metros</option>
                      <option value={60}>60 Metros</option>
                      <option value={70}>70 Metros (Olímpico)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+506 8888 8888"
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                </div>

                {/* Marca & Modelo */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Marca de Arco (opcional)
                    </label>
                    <input
                      type="text"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="Hoyt / Win&Win / Mathews"
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11.6px] text-white font-black uppercase tracking-wider">
                      Modelo (opcional)
                    </label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Formula XD / TRX"
                      className="bg-neutral-900/80 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon transition"
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
                    className="flex-1 py-2.5 rounded-xl bg-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 transition shadow-glow-cyan cursor-pointer"
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
