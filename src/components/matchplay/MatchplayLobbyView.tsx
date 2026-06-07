"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Trophy, Search, Plus, Play, ShieldAlert, Users, Trash2 } from "lucide-react";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { getLocalSessions, deleteLocalSession } from "@/lib/db/indexedDB";

interface MatchplayLobbyViewProps {
  user: UserProfile;
  onBack: () => void;
  onStartDuel: (config: any) => void;
}

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

// Active mock rivals for elimination duels
const RIVAL_LIST = [
  {
    uid: "RIV-1",
    fullName: "Daniela Solano",
    country: "CR",
    clubName: "Club Halcones",
    clubLogo: "2",
    clubCountry: "CR",
    bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 42, defaultDistance: 70 },
    rating: "9.1",
    status: "online"
  },
  {
    uid: "RIV-2",
    fullName: "Carlos Ruiz",
    country: "MX",
    clubName: "Nock Archery",
    clubLogo: "3",
    clubCountry: "MX",
    bowConfig: { type: "Compound", brand: "Mathews", model: "TRX", poundage: 58, defaultDistance: 50 },
    rating: "9.4",
    status: "online"
  },
  {
    uid: "RIV-3",
    fullName: "Laura Archer",
    country: "ES",
    clubName: "Real Arquería",
    clubLogo: "1",
    clubCountry: "ES",
    bowConfig: { type: "Recurve", brand: "Win&Win", model: "Wiawis", poundage: 44, defaultDistance: 70 },
    rating: "9.6",
    status: "online"
  },
  {
    uid: "RIV-4",
    fullName: "Sebastián Castro",
    country: "CR",
    clubName: "Club Halcones",
    clubLogo: "2",
    clubCountry: "CR",
    bowConfig: { type: "Barebow", brand: "Gillo", model: "G1", poundage: 36, defaultDistance: 18 },
    rating: "8.2",
    status: "busy"
  },
  {
    uid: "RIV-5",
    fullName: "Mateo Pérez",
    country: "CO",
    clubName: "Flechas Andinas",
    clubLogo: "4",
    clubCountry: "CO",
    bowConfig: { type: "Compound", brand: "PSE", model: "Supra", poundage: 56, defaultDistance: 50 },
    rating: "8.9",
    status: "online"
  }
];

export default function MatchplayLobbyView({ user, onBack, onStartDuel }: MatchplayLobbyViewProps) {
  const [activeTab, setActiveTab] = useState<"SEARCH" | "DRAFTS" | "HISTORY">("SEARCH");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  const [bowFilter, setBowFilter] = useState<string>("ALL");
  const [distanceFilter, setDistanceFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Custom configuration for custom created room
  const [customBow, setCustomBow] = useState<"Recurve" | "Compound" | "Barebow">(user.bowConfig.type);
  const [customDistance, setCustomDistance] = useState<number>(user.bowConfig.defaultDistance || 70);
  const [botLevel, setBotLevel] = useState<"Rookie" | "Medium" | "High" | "Olympic">("Medium");

  const handleDeleteDraft = async (id: string) => {
    if (!window.confirm("¿Seguro que deseas eliminar este duelo activo permanentemente?")) {
      return;
    }
    try {
      await deleteLocalSession(id);
      // Reload list
      const localSess = await getLocalSessions();
      const duelSessions = localSess.filter(
        (s) => s.isDuel === true && s.userUid === user.uid && s.deletedByArcher !== true
      );
      setDrafts(duelSessions.filter((s) => s.isDraft === true));
    } catch (err) {
      console.error("Error deleting draft:", err);
    }
  };

  // Fetch drafts and completed history from IndexedDB
  useEffect(() => {
    async function loadDuels() {
      try {
        const localSess = await getLocalSessions();
        const duelSessions = localSess.filter(
          (s) => s.isDuel === true && s.userUid === user.uid && s.deletedByArcher !== true
        );
        
        const activeDrafts = duelSessions.filter((s) => s.isDraft === true);
        const completedHistory = duelSessions.filter((s) => !s.isDraft);
        
        setDrafts(activeDrafts);
        setHistory(completedHistory);
      } catch (err) {
        console.error("Error loading duels:", err);
      }
    }
    loadDuels();
  }, [user, activeTab]);

  const containerVariants: any = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const cardVariants: any = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }
  };

  // Filter rivals
  const filteredRivals = RIVAL_LIST.filter((riv) => {
    const matchesSearch = riv.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          riv.clubName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBow = bowFilter === "ALL" || riv.bowConfig.type === bowFilter;
    
    let matchesDist = true;
    if (distanceFilter !== "ALL") {
      matchesDist = riv.bowConfig.defaultDistance === Number(distanceFilter);
    }

    return matchesSearch && matchesBow && matchesDist;
  });

  const handleStartSimulatedDuel = (rival: typeof RIVAL_LIST[0]) => {
    const matchConfig = {
      id: `MATCH-${Date.now()}`,
      bowType: rival.bowConfig.type,
      distance: rival.bowConfig.defaultDistance,
      system: rival.bowConfig.type === "Compound" ? "cumulative" : "set",
      rival: {
        uid: rival.uid,
        fullName: rival.fullName,
        country: rival.country,
        clubName: rival.clubName,
        clubLogo: rival.clubLogo,
        clubCountry: rival.clubCountry,
        rating: Number(rival.rating)
      }
    };
    onStartDuel(matchConfig);
  };

  const handleCreateRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const botRatings = {
      Rookie: 7.2,
      Medium: 8.3,
      High: 9.2,
      Olympic: 9.8
    };
    
    const botNames = {
      Rookie: "Bot Novato 🟢",
      Medium: "Arquero Medio 🔵",
      High: "Alto Nivel 🟡",
      Olympic: "Campeón Olímpico 🔴"
    };

    const matchConfig = {
      id: `MATCH-${Date.now()}`,
      bowType: customBow,
      distance: customDistance,
      system: customBow === "Compound" ? "cumulative" : "set",
      rival: {
        uid: `RIV-BOT-${botLevel.toUpperCase()}`,
        fullName: botNames[botLevel],
        country: "ES",
        clubName: "101010 Academy",
        clubLogo: "2",
        clubCountry: "ES",
        rating: botRatings[botLevel]
      }
    };
    onStartDuel(matchConfig);
  };

  const handleJoinRoomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode) return;

    const isCompound = joinCode.toUpperCase().includes("C");
    const matchConfig = {
      id: `MATCH-JOIN-${Date.now()}`,
      bowType: isCompound ? "Compound" : "Recurve",
      distance: isCompound ? 50 : 70,
      system: isCompound ? "cumulative" : "set",
      rival: {
        uid: "RIV-BOT-JOINED",
        fullName: "Desafiante Incógnito",
        country: "MX",
        clubName: "Lobby Archery",
        clubLogo: "1",
        clubCountry: "MX",
        rating: 9.2
      }
    };
    onStartDuel(matchConfig);
  };

  return (
    <div className="flex flex-col gap-5 py-4 min-h-full relative overflow-hidden">
      {/* Background neon blobs */}
      <div className="absolute top-[-10%] left-[-20%] w-[80%] aspect-square rounded-full bg-purple-500/10 blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-20%] w-[80%] aspect-square rounded-full bg-cyan-neon/5 blur-[120px] pointer-events-none z-0" />

      {/* Header */}
      <div className="flex items-center gap-3 z-10">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-neutral-900/60 backdrop-blur-md border border-white/10 text-gray-dim hover:text-white cursor-pointer transition"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-white text-lg font-black uppercase tracking-wide flex items-center gap-1.5">
            ⚔️ Duelos de Eliminación
          </h2>
          <p className="text-[10px] text-purple-400 uppercase tracking-widest font-black">
            Lobby de Competencia 1v1
          </p>
        </div>
      </div>

      {/* Stats / Intro banner */}
      <div className="bg-gradient-to-r from-purple-950/40 via-neutral-900/60 to-cyan-950/20 backdrop-blur-md border border-purple-500/20 p-4 rounded-3xl z-10 flex items-center justify-between shadow-[0_4px_24px_rgba(168,85,247,0.08)]">
        <div className="flex flex-col gap-1 w-[70%]">
          <h3 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1">
            <Trophy size={14} className="text-yellow-gold" />
            Normas Olímpicas WA
          </h3>
          <p className="text-[10px] text-gray-dim leading-snug">
            Recurvo compite a sets de 6 puntos. Compuesto compite por puntos acumulados de 15 flechas.
          </p>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[9px] text-gray-dim uppercase font-black">Tu Nivel</span>
          <span className="text-lg font-black text-cyan-neon tracking-tight">9.0 RMS</span>
        </div>
      </div>

      {/* Lobby Tab Bar */}
      <div className="flex bg-neutral-900 border border-white/5 p-0.5 rounded-xl z-10 relative">
        <button
          onClick={() => setActiveTab("SEARCH")}
          className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
            activeTab === "SEARCH"
              ? "bg-purple-600 text-white shadow-glow-purple"
              : "text-gray-dim hover:text-white"
          }`}
        >
          Buscar
        </button>
        <button
          onClick={() => setActiveTab("DRAFTS")}
          className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all relative ${
            activeTab === "DRAFTS"
              ? "bg-purple-600 text-white shadow-glow-purple"
              : "text-gray-dim hover:text-white"
          }`}
        >
          Activos
          {drafts.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-cyan-neon border border-neutral-950 text-black text-[9px] font-black flex items-center justify-center shadow-glow-cyan animate-pulse">
              {drafts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("HISTORY")}
          className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
            activeTab === "HISTORY"
              ? "bg-purple-600 text-white shadow-glow-purple"
              : "text-gray-dim hover:text-white"
          }`}
        >
          Historial
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === "SEARCH" && (
        <div className="flex flex-col gap-4 z-10">
          {/* Room Controls (Create / Join) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setIsCreatingRoom(!isCreatingRoom)}
              className="bg-neutral-900/60 backdrop-blur-md border border-white/5 hover:border-purple-500/30 p-3 rounded-2xl flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition group"
            >
              <Plus size={18} className="text-purple-400 group-hover:scale-110 transition" />
              <span className="text-[10px] text-white font-bold uppercase tracking-wider">Crear Duelo</span>
            </button>
            
            <div className="bg-neutral-900/60 backdrop-blur-md border border-white/5 p-3 rounded-2xl flex flex-col justify-center gap-1">
              <form onSubmit={handleJoinRoomSubmit} className="flex gap-1.5 items-center w-full">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Código Duelo"
                  className="flex-1 bg-neutral-950 border border-white/5 focus:border-cyan-neon text-white text-[10px] p-2 rounded-xl outline-none transition uppercase text-center font-mono"
                />
                <button
                  type="submit"
                  className="p-2 rounded-xl bg-cyan-neon/10 border border-cyan-neon/20 hover:border-cyan-neon text-cyan-neon cursor-pointer transition active:scale-95 shrink-0"
                  title="Unirse"
                >
                  <Play size={10} className="fill-current" />
                </button>
              </form>
            </div>
          </div>

          {/* Create Room Drawer Form */}
          <AnimatePresence>
            {isCreatingRoom && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-neutral-900/40 border border-white/10 rounded-3xl p-4 flex flex-col gap-3 overflow-hidden shadow-inner"
              >
                <h4 className="text-white text-xs font-black uppercase tracking-wider">Configuración del Duelo</h4>
                <form onSubmit={handleCreateRoomSubmit} className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] text-gray-dim font-bold uppercase">Formato de Arco</span>
                      <select
                        value={customBow}
                        onChange={(e) => setCustomBow(e.target.value as any)}
                        className="w-full bg-neutral-950 border border-white/5 text-white text-xs p-2 rounded-xl outline-none"
                      >
                        <option value="Recurve">Recurvo (Set System)</option>
                        <option value="Compound">Compuesto (Acumulado)</option>
                        <option value="Barebow">Barebow (Set System)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[8px] text-gray-dim font-bold uppercase">Distancia</span>
                      <select
                        value={customDistance}
                        onChange={(e) => setCustomDistance(Number(e.target.value))}
                        className="w-full bg-neutral-950 border border-white/5 text-white text-xs p-2 rounded-xl outline-none"
                      >
                        <option value="18">18 metros</option>
                        <option value="50">50 metros</option>
                        <option value="70">70 metros</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Bot Level Selector */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] text-gray-dim font-bold uppercase">Nivel del Bot Oponente</span>
                    <select
                      value={botLevel}
                      onChange={(e) => setBotLevel(e.target.value as any)}
                      className="w-full bg-neutral-950 border border-white/5 text-white text-xs p-2.5 rounded-xl outline-none focus:border-purple-500/50 transition"
                    >
                      <option value="Rookie">Novato (Rookie Bot - 7.2 RMS)</option>
                      <option value="Medium">Nivel Medio (Medium Archer Bot - 8.3 RMS)</option>
                      <option value="High">Alto Nivel (High Level Bot - 9.2 RMS)</option>
                      <option value="Olympic">Arquero Olímpico (Olympic Bot - 9.8 RMS)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider cursor-pointer hover:brightness-105 active:scale-98 transition shadow-[0_0_15px_rgba(168,85,247,0.15)] text-center"
                  >
                    Lanzar Duelo y Esperar Rival
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search and Filters */}
          <div className="flex flex-col gap-2">
            <div className="relative flex items-center">
              <span className="absolute left-3 text-gray-dim">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar arquero o club..."
                className="w-full bg-neutral-900/60 border border-white/5 text-white text-xs pl-10 pr-4 py-2.5 rounded-xl outline-none focus:border-purple-500/40 transition duration-150"
              />
            </div>

            {/* Filter Badges */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setBowFilter("ALL")}
                className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition shrink-0 border cursor-pointer ${
                  bowFilter === "ALL"
                    ? "bg-purple-500/10 border-purple-500 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.1)]"
                    : "bg-neutral-900/40 border-white/5 text-gray-dim"
                }`}
              >
                Todos los Arcos
              </button>
              {["Recurve", "Compound", "Barebow"].map((bow) => (
                <button
                  key={bow}
                  onClick={() => setBowFilter(bow)}
                  className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition shrink-0 border cursor-pointer ${
                    bowFilter === bow
                      ? "bg-purple-500/10 border-purple-500 text-purple-300 shadow-[0_0_8px_rgba(168,85,247,0.1)]"
                      : "bg-neutral-900/40 border-white/5 text-gray-dim"
                  }`}
                >
                  {bow}
                </button>
              ))}
              <div className="w-[1px] bg-white/10 shrink-0 my-0.5 mx-1" />
              <button
                onClick={() => setDistanceFilter("ALL")}
                className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition shrink-0 border cursor-pointer ${
                  distanceFilter === "ALL"
                    ? "bg-cyan-neon/10 border-cyan-neon text-cyan-neon shadow-[0_0_8px_rgba(0,229,255,0.1)]"
                    : "bg-neutral-900/40 border-white/5 text-gray-dim"
                }`}
              >
                Todas las Dist.
              </button>
              {["18", "50", "70"].map((dist) => (
                <button
                  key={dist}
                  onClick={() => setDistanceFilter(dist)}
                  className={`px-3 py-1 rounded-full text-[9px] font-black uppercase transition shrink-0 border cursor-pointer ${
                    distanceFilter === dist
                      ? "bg-cyan-neon/10 border-cyan-neon text-cyan-neon shadow-[0_0_8px_rgba(0,229,255,0.1)]"
                      : "bg-neutral-900/40 border-white/5 text-gray-dim"
                  }`}
                >
                  {dist}m
                </button>
              ))}
            </div>
          </div>

          {/* Rivals List */}
          <div className="flex flex-col gap-2.5 flex-1">
            <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
              <Users size={13} className="text-purple-400" />
              Arqueros en Línea ({filteredRivals.length})
            </h4>

            <motion.div
              variants={containerVariants}
              initial="initial"
              animate="animate"
              className="flex flex-col gap-2.5"
            >
              <AnimatePresence>
                {filteredRivals.length === 0 ? (
                  <motion.div
                    variants={cardVariants}
                    className="bg-neutral-900/40 border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2"
                  >
                    <ShieldAlert size={20} className="text-gray-dim" />
                    <p className="text-[10px] text-gray-dim">No se encontraron oponentes con los filtros seleccionados.</p>
                  </motion.div>
                ) : (
                  filteredRivals.map((riv) => {
                    const flag = COUNTRIES.find((c) => c.code === riv.country)?.flag || "🇨🇷";
                    return (
                      <motion.div
                        key={riv.uid}
                        variants={cardVariants}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-neutral-900/60 backdrop-blur-md border border-white/5 rounded-2xl p-3 flex justify-between items-center hover:border-purple-500/25 hover:shadow-[0_0_12px_rgba(168,85,247,0.03)] transition-all duration-200"
                      >
                        <div className="flex items-center gap-3 w-[70%]">
                          {/* Avatar with country flag */}
                          <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center text-white font-black text-xs">
                              {riv.fullName.substring(0, 2).toUpperCase()}
                            </div>
                            <span className="absolute bottom-0 right-0 text-[10px]">{flag}</span>
                          </div>
                          
                          {/* Rival Details */}
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white text-xs font-bold truncate">{riv.fullName}</span>
                              <span className="text-[8px] px-1 py-0.2 rounded bg-neutral-950 text-purple-400 font-extrabold uppercase shrink-0">
                                {riv.bowConfig.type}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-1 mt-0.5 truncate text-[9px] text-gray-dim">
                              <ClubLogoIcon logo={riv.clubLogo} className="w-3 h-3 shrink-0" />
                              <span className="truncate">{riv.clubName}</span>
                              <span>·</span>
                              <span className="shrink-0">{riv.bowConfig.defaultDistance}m</span>
                            </div>
                          </div>
                        </div>

                        {/* Retar CTA */}
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="text-[9px] text-cyan-neon font-black tracking-tight">{riv.rating} RMS</span>
                          <button
                            onClick={() => handleStartSimulatedDuel(riv)}
                            disabled={riv.status === "busy"}
                            className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider cursor-pointer active:scale-95 transition flex items-center gap-1 shrink-0 ${
                              riv.status === "busy"
                                ? "bg-neutral-950 text-gray-dim border border-white/5 cursor-not-allowed"
                                : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-glow-purple border border-purple-400/20"
                            }`}
                          >
                            <span>Retar</span>
                            <Play size={8} className="fill-current" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      )}

      {activeTab === "DRAFTS" && (
        <div className="flex flex-col gap-4 z-10 flex-1">
          <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
            <Users size={13} className="text-purple-400" />
            Duelos en Progreso ({drafts.length})
          </h4>
          
          <div className="flex flex-col gap-2.5">
            {drafts.length === 0 ? (
              <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2">
                <ShieldAlert size={20} className="text-gray-dim" />
                <p className="text-[10px] text-gray-dim">No tienes duelos activos guardados.</p>
              </div>
            ) : (
              drafts.map((dr) => (
                <div
                  key={dr.uid}
                  className="bg-neutral-900/60 backdrop-blur-md border border-white/5 rounded-2xl p-3.5 flex justify-between items-center hover:border-purple-500/25 transition-all duration-200"
                >
                  <div className="flex flex-col gap-1 w-[70%]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white text-xs font-bold">vs {dr.opponent}</span>
                      <span className="text-[8px] px-1 py-0.2 rounded bg-neutral-950 text-cyan-neon font-extrabold uppercase">
                        {dr.bowConfig.type}
                      </span>
                    </div>
                    <span className="text-[9px] text-gray-dim truncate mt-0.5">
                      {dr.opponentClubName} · Set {dr.currentEnd + 1} · {dr.distance}m
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleDeleteDraft(dr.uid)}
                      className="p-2 rounded-full border border-white/10 hover:border-red-rival/30 text-gray-dim hover:text-red-rival cursor-pointer transition active:scale-95"
                      title="Eliminar Duelo"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => {
                        onStartDuel({
                          ...dr.config,
                          id: dr.uid,
                          currentEnd: dr.currentEnd,
                          currentArrow: dr.currentArrow,
                          userTiros: dr.userTiros,
                          rivalTiros: dr.rivalTiros,
                          userSetPoints: dr.userSetPoints,
                          rivalSetPoints: dr.rivalSetPoints,
                          isShootOff: dr.isShootOff,
                          userShootOffShot: dr.userShootOffShot,
                          rivalShootOffShot: dr.rivalShootOffShot,
                          duelFinished: dr.duelFinished,
                          impacts: dr.impacts
                        });
                      }}
                      className="px-3 py-1.5 rounded-full bg-cyan-neon text-black font-black text-[9px] uppercase tracking-wider cursor-pointer hover:brightness-110 transition active:scale-95 flex items-center gap-1 shadow-glow-cyan"
                    >
                      Reanudar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === "HISTORY" && (
        <div className="flex flex-col gap-4 z-10 flex-1">
          <h4 className="text-white text-xs font-black uppercase tracking-wider pl-1 flex items-center gap-1.5">
            <Trophy size={13} className="text-purple-400" />
            Historial de Duelos ({history.length})
          </h4>
          
          <div className="flex flex-col gap-2.5">
            {history.length === 0 ? (
              <div className="bg-neutral-900/40 border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center text-center gap-2">
                <ShieldAlert size={20} className="text-gray-dim" />
                <p className="text-[10px] text-gray-dim">No has completado ningún duelo todavía.</p>
              </div>
            ) : (
              history.map((h) => {
                const flag = COUNTRIES.find((c) => c.code === h.opponentCountry)?.flag || "🇲🇽";
                return (
                  <div
                    key={h.uid}
                    className="bg-neutral-900/60 backdrop-blur-md border border-white/5 rounded-2xl p-3.5 flex justify-between items-center"
                  >
                    <div className="flex flex-col gap-1 w-[70%]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-xs font-bold">vs {h.opponent} {flag}</span>
                        <span className="text-[8px] px-1 py-0.2 rounded bg-neutral-950 text-purple-400 font-extrabold uppercase">
                          {h.bowConfig.type}
                        </span>
                      </div>
                      <span className="text-[9px] text-gray-dim mt-0.5">
                        Puntos: {h.score} pts · {h.distance}m · {new Date(h.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        h.outcome === "win"
                          ? "bg-green-500/10 border-green-500/30 text-green-400 shadow-[0_0_8px_rgba(34,197,94,0.1)]"
                          : h.outcome === "loss"
                          ? "bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.1)]"
                          : "bg-gray-500/10 border-gray-500/30 text-gray-400"
                      }`}>
                        {h.outcome === "win" ? "Victoria" : h.outcome === "loss" ? "Derrota" : "Empate"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      
      {/* Bottom spacer */}
      <div className="h-6" />
    </div>
  );
}
