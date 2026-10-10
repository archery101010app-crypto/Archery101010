"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { 
  Lock, Sparkles, Plus, Calendar, CheckCircle2, ChevronRight, 
  Trash2, ArrowUp, ArrowDown, Users, User, ArrowLeft, Layout, 
  Copy, Archive, Edit2, AlertCircle, Check, X, RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  getLocalMacrocycles, 
  saveLocalMacrocycle, 
  deleteLocalMacrocycle, 
  generateResilientId, 
  addToSyncQueue, 
  getLocalSetting,
  saveLocalSetting
} from "@/lib/db/indexedDB";
import { Macrocycle, MacrocyclePhase, PHASE_CONFIG } from "@/lib/db/macrocycleTypes";
import { syncCycleToMonthCalendar } from "@/lib/cycleCalendarSync";

interface CoachMacrocycleTabProps {
  user: UserProfile;
  onUpgrade: () => void;
}

export default function CoachMacrocycleTab({ user, onUpgrade }: CoachMacrocycleTabProps) {
  const isPro = user.plan === "PRO";

  const [macrocycles, setMacrocycles] = useState<Macrocycle[]>([]);
  const [selectedMacro, setSelectedMacro] = useState<Macrocycle | null>(null);
  
  // Roster of athletes in the club
  const [roster, setRoster] = useState<UserProfile[]>([]);

  // Modal creation states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [step, setStep] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("2026-06-01");
  const [endDate, setEndDate] = useState("2026-09-30");
  const [volumeGoal, setVolumeGoal] = useState(8000);
  const [phases, setPhases] = useState<MacrocyclePhase[]>([]);
  const [assignmentType, setAssignmentType] = useState<"club" | "group" | "individual">("club");
  const [assignedAthleteIds, setAssignedAthleteIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");

  // Month Sync Modal states
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [macroToSync, setMacroToSync] = useState<Macrocycle | null>(null);
  const [syncYear, setSyncYear] = useState(new Date().getFullYear());
  const [syncMonth, setSyncMonth] = useState(new Date().getMonth());
  const [isSyncing, setIsSyncing] = useState(false);

  const handleOpenSyncModal = (macro: Macrocycle) => {
    setMacroToSync(macro);
    setSyncYear(new Date().getFullYear());
    setSyncMonth(new Date().getMonth());
    setShowSyncModal(true);
  };

  const handleExecuteSync = async () => {
    if (!macroToSync) return;
    setIsSyncing(true);
    try {
      const summary = await syncCycleToMonthCalendar(macroToSync, syncYear, syncMonth, user);
      setShowSyncModal(false);
      alert(
        `✓ ¡Calendario Sincronizado con Éxito!\n\n` +
        `• Plan: ${summary.macrocycleName}\n` +
        `• Mes: ${summary.monthName} ${summary.year}\n` +
        `• Días planificados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
        `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
        `Tus arqueros ya pueden entrar a cada día en su calendario y ver la meta y el enfoque asignado.`
      );
    } catch (err) {
      console.error("Error syncing cycle to calendar:", err);
      alert("Hubo un error al sincronizar con el calendario.");
    } finally {
      setIsSyncing(false);
    }
  };
  useEffect(() => {
    async function loadData() {
      // Load roster of athletes
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      const athletes = allUsers.filter((u) => u.clubId === user.clubId && u.role === "archer");
      
      // If empty roster, add some default demo athletes for selection
      if (athletes.length === 0) {
        const demoAthletes: UserProfile[] = [
          {
            uid: "USR-ATHLETE-DANIELA",
            email: "daniela@archery101010.com",
            fullName: "Daniela Rivas",
            nickname: "daniela",
            birthDate: "2000-08-12",
            country: "CR",
            city: "San José",
            gender: "F",
            bowConfig: { type: "Recurve", brand: "Win&Win", model: "Wiawis", poundage: 38, defaultDistance: 70 },
            physicalData: { height: 168, weight: 58, dominantEye: "R", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-ATHLETE-CARLOS",
            email: "carlos@archery101010.com",
            fullName: "Carlos Mendoza",
            nickname: "carlos",
            birthDate: "1998-04-20",
            country: "CR",
            city: "Cartago",
            gender: "M",
            bowConfig: { type: "Compound", brand: "Hoyt", model: "Altus", poundage: 60, defaultDistance: 50 },
            physicalData: { height: 178, weight: 74, dominantEye: "R", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-ATHLETE-SEBASTIAN",
            email: "sebastian@archery101010.com",
            fullName: "Sebastián Gómez",
            nickname: "sebas",
            birthDate: "2002-11-03",
            country: "CR",
            city: "Alajuela",
            gender: "M",
            bowConfig: { type: "Barebow", brand: "Hoyt", model: "Satori", poundage: 42, defaultDistance: 18 },
            physicalData: { height: 182, weight: 81, dominantEye: "L", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          }
        ];
        const updatedUsersList = [...allUsers, ...demoAthletes];
        await saveLocalSetting("simulated_users", updatedUsersList);
        setRoster(demoAthletes);
      } else {
        setRoster(athletes);
      }

      // Load macrocycles
      const list = await getLocalMacrocycles();
      if (list.length === 0) {
        // Seed a demo macrocycle
        const demoMacro: Macrocycle = {
          id: "MAC-DEMO-1",
          name: "Preparación Temporada Indoor 2026",
          coachId: user.uid,
          clubId: user.clubId || "CLB-DEMO",
          startDate: "2026-06-01",
          endDate: "2026-09-30",
          volumeGoal: 8000,
          currentVolume: 3480,
          status: "active",
          assignmentType: "club",
          assignedAthleteIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          phases: [
            {
              id: "PHASE-D-1",
              name: "Preparación Física",
              type: "fisica",
              startDate: "2026-06-01",
              endDate: "2026-06-30",
              weeklySessionGoal: 3,
              weeklyArrowGoal: 300,
              notes: "Fuerza específica, estabilidad y cardio general.",
              color: "#8B5CF6"
            },
            {
              id: "PHASE-D-2",
              name: "Volumen de Flechas",
              type: "volumen",
              startDate: "2026-07-01",
              endDate: "2026-08-15",
              weeklySessionGoal: 4,
              weeklyArrowGoal: 600,
              notes: "Aumentar capacidad aeróbica muscular y volumen de tiro.",
              color: "#00BFFF"
            },
            {
              id: "PHASE-D-3",
              name: "Puesta a Punto",
              type: "puesta_punto",
              startDate: "2026-08-16",
              endDate: "2026-09-15",
              weeklySessionGoal: 3,
              weeklyArrowGoal: 400,
              notes: "Afinamiento de técnica y control de puntajes.",
              color: "#FFE500"
            },
            {
              id: "PHASE-D-4",
              name: "Fase Competitiva",
              type: "competitiva",
              startDate: "2026-09-16",
              endDate: "2026-09-30",
              weeklySessionGoal: 2,
              weeklyArrowGoal: 200,
              notes: "Duelos simulados y control mental competitivo.",
              color: "#FF0000"
            }
          ]
        };
        await saveLocalMacrocycle(demoMacro.id, demoMacro);
        setMacrocycles([demoMacro]);
      } else {
        setMacrocycles(list);
      }
    }

    if (isPro) {
      loadData();
    }

    const handleDbChange = (e: any) => {
      const targetStores = ["simulated_users", "macrocycles_local"];
      if (targetStores.includes(e.detail?.store) && isPro) {
        loadData();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [isPro, user]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setName("");
    setStartDate(new Date().toISOString().split("T")[0]);
    setEndDate(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
    setVolumeGoal(8000);
    setPhases([
      {
        id: "phase-init",
        name: "Preparación Física",
        type: "fisica",
        startDate: new Date().toISOString().split("T")[0],
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        weeklySessionGoal: 3,
        weeklyArrowGoal: 200,
        notes: "",
        color: PHASE_CONFIG.fisica.color
      }
    ]);
    setAssignmentType("club");
    setAssignedAthleteIds([]);
    setGroupName("");
    setStep(1);
    setShowCreateModal(true);
  };

  const handleOpenEdit = (macro: Macrocycle) => {
    setEditingId(macro.id);
    setName(macro.name);
    setStartDate(macro.startDate);
    setEndDate(macro.endDate);
    setVolumeGoal(macro.volumeGoal);
    setPhases(macro.phases);
    setAssignmentType(macro.assignmentType);
    setAssignedAthleteIds(macro.assignedAthleteIds);
    setGroupName(macro.groupName || "");
    setStep(1);
    setShowCreateModal(true);
  };

  const handleAddPhase = () => {
    const newType = "volumen";
    setPhases([
      ...phases,
      {
        id: `phase-${Date.now()}`,
        name: PHASE_CONFIG[newType].label,
        type: newType,
        startDate: startDate,
        endDate: endDate,
        weeklySessionGoal: 4,
        weeklyArrowGoal: 400,
        notes: "",
        color: PHASE_CONFIG[newType].color
      }
    ]);
  };

  const handleUpdatePhaseField = (id: string, field: keyof MacrocyclePhase, value: any) => {
    setPhases(
      phases.map((p) => {
        if (p.id === id) {
          const updated = { ...p, [field]: value };
          if (field === "type") {
            const typedVal = value as MacrocyclePhase["type"];
            updated.name = PHASE_CONFIG[typedVal].label;
            updated.color = PHASE_CONFIG[typedVal].color;
          }
          return updated;
        }
        return p;
      })
    );
  };

  const handleRemovePhase = (id: string) => {
    if (phases.length <= 1) return;
    setPhases(phases.filter((p) => p.id !== id));
  };

  const handleMovePhase = (index: number, direction: "up" | "down") => {
    const updated = [...phases];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= phases.length) return;

    // Swap
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setPhases(updated);
  };

  const handleToggleAthleteSelection = (athleteId: string) => {
    if (assignedAthleteIds.includes(athleteId)) {
      setAssignedAthleteIds(assignedAthleteIds.filter((id) => id !== athleteId));
    } else {
      setAssignedAthleteIds([...assignedAthleteIds, athleteId]);
    }
  };

  const handleSaveMacrocycle = async () => {
    if (!name.trim()) return;

    const id = editingId || generateResilientId("MAC");
    const nowStr = new Date().toISOString();

    const macrocycleData: Macrocycle = {
      id,
      name,
      coachId: user.uid,
      clubId: user.clubId || "CLB-DEMO",
      startDate,
      endDate,
      phases,
      assignmentType,
      assignedAthleteIds: assignmentType === "club" ? [] : assignedAthleteIds,
      groupName: assignmentType === "group" ? groupName : undefined,
      volumeGoal,
      currentVolume: editingId ? macrocycles.find((m) => m.id === editingId)?.currentVolume || 0 : 0,
      status: "active",
      createdAt: editingId ? macrocycles.find((m) => m.id === editingId)?.createdAt || nowStr : nowStr,
      updatedAt: nowStr
    };

    await saveLocalMacrocycle(id, macrocycleData);

    // Queue sync transaction
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "macrocycles",
      operation: editingId ? "UPDATE" : "INSERT",
      payloadId: id,
      payload: macrocycleData,
      timestamp: Date.now()
    });

    // Reload
    const list = await getLocalMacrocycles();
    setMacrocycles(list);
    setShowCreateModal(false);
    
    if (selectedMacro?.id === id) {
      setSelectedMacro(macrocycleData);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro que deseas eliminar este macrociclo?")) return;
    
    await deleteLocalMacrocycle(id);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "macrocycles",
      operation: "DELETE",
      payloadId: id,
      payload: null,
      timestamp: Date.now()
    });

    setMacrocycles(macrocycles.filter((m) => m.id !== id));
    if (selectedMacro?.id === id) setSelectedMacro(null);
  };

  const handleDuplicate = async (macro: Macrocycle) => {
    const duplicatedId = generateResilientId("MAC");
    const nowStr = new Date().toISOString();
    const duplicated: Macrocycle = {
      ...macro,
      id: duplicatedId,
      name: `${macro.name} (Copia)`,
      createdAt: nowStr,
      updatedAt: nowStr,
      currentVolume: 0
    };

    await saveLocalMacrocycle(duplicatedId, duplicated);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "macrocycles",
      operation: "INSERT",
      payloadId: duplicatedId,
      payload: duplicated,
      timestamp: Date.now()
    });

    const list = await getLocalMacrocycles();
    setMacrocycles(list);
  };

  // Determine current phase active for details / cards based on today's date
  const getCurrentPhaseType = (macro: Macrocycle): MacrocyclePhase | null => {
    const today = new Date().toISOString().split("T")[0];
    const found = macro.phases.find((p) => today >= p.startDate && today <= p.endDate);
    return found || macro.phases[0] || null;
  };

  // RENDER PAYWALL SCREEN IF FREE ACCOUNT
  if (!isPro) {
    return (
      <div className="relative min-h-[300px] bg-neutral-950/40 rounded-3xl border border-white/5 p-6 flex flex-col items-center justify-center text-center overflow-hidden">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-10" />

        <div className="flex flex-col items-center gap-3.5 z-20 max-w-xs">
          <div className="w-12 h-12 rounded-2xl bg-yellow-gold/10 border border-yellow-gold/30 flex items-center justify-center text-yellow-gold shadow-glow-yellow animate-pulse">
            <Lock size={20} />
          </div>

          <span className="text-[10px] bg-yellow-gold text-black font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            Exclusivo Coach PRO
          </span>

          <h3 className="text-white text-base font-black uppercase tracking-wide">
            Planificación de Macrociclos
          </h3>

          <p className="text-[11px] text-gray-dim leading-relaxed">
            Planifica la temporada olímpica de tu club. Diseña macrociclos con fases de preparación física, volumen, puesta a punto y competitiva. Define metas de flechas y supervisa el progreso de todo el equipo en tiempo real.
          </p>

          <button
            onClick={onUpgrade}
            className="w-full mt-3 py-3 rounded-full bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-glow-yellow hover:brightness-105 active:scale-98 transition cursor-pointer"
          >
            Adquirir Plan PRO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 relative">
      <AnimatePresence mode="wait">
        {!selectedMacro ? (
          // MAIN LIST VIEW
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-4"
          >
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-gray-dim font-black uppercase tracking-wider">Macrociclos Activos</span>
              <button
                onClick={handleOpenCreate}
                className="px-3 py-1.5 rounded-xl bg-cyan-neon text-black font-black text-[9px] uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:bg-cyan-brand transition shadow-glow-cyan"
              >
                <Plus size={12} />
                <span>Nuevo Macrociclo</span>
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {macrocycles.length === 0 ? (
                <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white/30 text-xs">
                  Aún no has planificado ningún macrociclo. Presiona "+ Nuevo Macrociclo" para iniciar.
                </div>
              ) : (
                macrocycles.map((mac) => {
                  const currentPhase = getCurrentPhaseType(mac);
                  const progress = Math.min(100, Math.round((mac.currentVolume / mac.volumeGoal) * 100));
                  return (
                    <div
                      key={mac.id}
                      onClick={() => setSelectedMacro(mac)}
                      className="bg-neutral-900/40 p-5 rounded-3xl border border-white/10 hover:border-white/20 transition duration-200 cursor-pointer flex flex-col gap-4 shadow-xl relative overflow-hidden group"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-1 max-w-[70%]">
                          <h4 className="text-white text-sm font-bold group-hover:text-cyan-neon transition-colors truncate">{mac.name}</h4>
                          <span className="text-[9px] text-gray-dim flex items-center gap-1">
                            <Calendar size={10} />
                            {mac.startDate} al {mac.endDate}
                          </span>
                        </div>
                        {currentPhase && (
                          <span 
                            style={{ 
                              color: currentPhase.color, 
                              backgroundColor: `${currentPhase.color}15`, 
                              borderColor: `${currentPhase.color}30` 
                            }}
                            className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full border"
                          >
                            Fase: {currentPhase.name}
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-[9px]">
                          <span className="text-gray-dim">Meta de Volumen de Flechas:</span>
                          <span className="text-white font-extrabold">{mac.currentVolume.toLocaleString()} / {mac.volumeGoal.toLocaleString()} ({progress}%)</span>
                        </div>
                        <div className="w-full bg-neutral-950 h-2 rounded-full overflow-hidden border border-white/5">
                          <div 
                            className="h-full rounded-full transition-all duration-500" 
                            style={{ 
                              width: `${progress}%`,
                              backgroundColor: currentPhase?.color || "#00BFFF",
                              boxShadow: `0 0 10px ${currentPhase?.color || "#00BFFF"}80`
                            }} 
                          />
                        </div>
                      </div>

                      {/* Assignment Badge */}
                      <div className="flex justify-between items-center border-t border-white/[0.03] pt-3 text-[9px] text-white/50">
                        <span className="flex items-center gap-1 font-bold">
                          {mac.assignmentType === "club" ? (
                            <>
                              <Layout size={10} />
                              <span>Todo el Club</span>
                            </>
                          ) : mac.assignmentType === "group" ? (
                            <>
                              <Users size={10} />
                              <span>Grupo: {mac.groupName}</span>
                            </>
                          ) : (
                            <>
                              <User size={10} />
                              <span>Individual ({mac.assignedAthleteIds.length} arqueros)</span>
                            </>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenSyncModal(mac);
                            }}
                            className="px-2 py-1 rounded-xl bg-yellow-gold/10 hover:bg-yellow-gold/20 text-yellow-gold border border-yellow-gold/30 text-[9px] font-black uppercase flex items-center gap-1 cursor-pointer transition shadow-glow-yellow/5"
                            title="Sincronizar calendario del mes"
                          >
                            <RefreshCw size={10} />
                            <span>Sincronizar</span>
                          </button>
                          <span className="flex items-center text-cyan-neon font-black uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                            Ver Detalles <ChevronRight size={12} />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        ) : (
          // DETAIL VIEW
          <motion.div
            key="details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col gap-5"
          >
            {/* Header controls */}
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <button
                onClick={() => setSelectedMacro(null)}
                className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Volver a Planes</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenSyncModal(selectedMacro)}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-yellow-gold/20 to-amber-500/20 hover:from-yellow-gold/30 hover:to-amber-500/30 text-yellow-gold border border-yellow-gold/35 text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition shadow-glow-yellow/10"
                  title="Sincronizar con el Calendario de la App"
                >
                  <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                  <span>Sincronizar Calendario</span>
                </button>
                <button
                  onClick={() => handleOpenEdit(selectedMacro)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer border border-white/5"
                  title="Editar Plan"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => handleDuplicate(selectedMacro)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition cursor-pointer border border-white/5"
                  title="Duplicar"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => handleDelete(selectedMacro.id)}
                  className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/10 transition cursor-pointer"
                  title="Eliminar"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Title / Dates details */}
            <div>
              <h2 className="text-lg font-black text-white leading-tight uppercase tracking-wide">{selectedMacro.name}</h2>
              <p className="text-xs text-white/40 flex items-center gap-1 mt-1">
                <Calendar size={12} />
                <span>Fechas: {selectedMacro.startDate} al {selectedMacro.endDate}</span>
              </p>
            </div>

            {/* Chronogram timeline visualization */}
            <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 shadow-xl flex flex-col gap-3.5">
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Línea de Tiempo del Macrociclo</span>
              
              {/* Visual relative duration bar */}
              <div className="h-6 w-full rounded-xl overflow-hidden flex border border-white/5">
                {selectedMacro.phases.map((phase) => {
                  const start = new Date(phase.startDate).getTime();
                  const end = new Date(phase.endDate).getTime();
                  const duration = Math.max(1, end - start);
                  return (
                    <div
                      key={phase.id}
                      style={{ 
                        backgroundColor: phase.color,
                        flexGrow: duration
                      }}
                      className="h-full border-r border-black/35 hover:brightness-110 transition relative group cursor-help"
                      title={`${phase.name}: ${phase.startDate} al ${phase.endDate}`}
                    />
                  );
                })}
              </div>

              {/* Phases list */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                {selectedMacro.phases.map((phase) => {
                  const today = new Date().toISOString().split("T")[0];
                  const isActive = today >= phase.startDate && today <= phase.endDate;

                  return (
                    <div 
                      key={phase.id}
                      className={`p-3.5 rounded-2xl border flex flex-col gap-2 relative overflow-hidden ${
                        isActive 
                          ? "bg-neutral-950/80 border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.02)]" 
                          : "bg-neutral-950/20 border-white/5"
                      }`}
                    >
                      {/* Active indicator bar */}
                      {isActive && (
                        <div 
                          style={{ backgroundColor: phase.color }}
                          className="absolute left-0 top-0 bottom-0 w-[3px]"
                        />
                      )}

                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span style={{ backgroundColor: phase.color }} className="h-2 w-2 rounded-full" />
                          {phase.name}
                        </span>
                        {isActive && (
                          <span className="text-[8px] font-black text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-full border border-cyan-neon/20 animate-pulse">
                            Fase Activa
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] bg-neutral-900/30 p-2 rounded-xl border border-white/[0.02]">
                        <div>
                          <span className="text-white/30 block uppercase font-bold text-[8px]">Sesiones/Semana</span>
                          <span className="text-white font-medium">{phase.weeklySessionGoal} sesiones</span>
                        </div>
                        <div>
                          <span className="text-white/30 block uppercase font-bold text-[8px]">Flechas/Semana</span>
                          <span className="text-white font-medium">{phase.weeklyArrowGoal} flechas</span>
                        </div>
                      </div>

                      {phase.notes && (
                        <p className="text-[10px] text-white/50 leading-relaxed italic border-t border-white/[0.03] pt-1.5 mt-0.5">
                          "{phase.notes}"
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Athlete progress table */}
            <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 shadow-xl flex flex-col gap-3">
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest flex items-center gap-1">
                <Users size={12} className="text-cyan-neon" />
                <span>Progreso de Atletas Asignados</span>
              </span>

              {roster.length === 0 ? (
                <div className="text-center py-6 text-xs text-white/30">
                  No hay arqueros asignados en el roster.
                </div>
              ) : (
                <div className="flex flex-col gap-2 mt-1">
                  {roster.map((athlete) => {
                    // Calculate random simulated progress for demo purposes
                    const athleteProgress = Math.floor(Math.random() * 4000) + 1000;
                    const pct = Math.min(100, Math.round((athleteProgress / (selectedMacro.volumeGoal / 2)) * 100));
                    
                    return (
                      <div key={athlete.uid} className="flex justify-between items-center bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center font-bold text-xs text-white/60">
                            {athlete.fullName[0]}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white block">{athlete.fullName}</span>
                            <span className="text-[9px] text-white/30 uppercase">{athlete.bowConfig?.type || ""}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-black text-white">{athleteProgress.toLocaleString()} flechas</span>
                          <span className="text-[9px] text-cyan-neon block font-bold mt-0.5">{pct}% de su meta</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Creation Modal (Full Wizard) */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShowCreateModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-lg shadow-2xl z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    {editingId ? "Editar Macrociclo" : "Nuevo Macrociclo"}
                  </h3>
                  <span className="text-[9px] text-cyan-neon font-black uppercase tracking-widest block mt-0.5">Paso {step} de 4</span>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* STEP 1: GENERAL INFO */}
              {step === 1 && (
                <div className="flex flex-col gap-3.5 py-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Nombre del Plan</label>
                    <input
                      type="text"
                      placeholder="Ej. Preparación Sala 2026"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Fecha Inicio</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Fecha Fin</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">Meta de Volumen Total (Flechas)</label>
                    <input
                      type="number"
                      value={volumeGoal}
                      onChange={(e) => setVolumeGoal(Number(e.target.value))}
                      className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs outline-none focus:border-cyan-neon"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: PHASES timeline builder */}
              {step === 2 && (
                <div className="flex flex-col gap-3 py-2 max-h-[50vh] overflow-y-auto pr-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Fases del Cronograma</span>
                    <button
                      type="button"
                      onClick={handleAddPhase}
                      className="text-[9px] bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-1 rounded-lg font-bold"
                    >
                      + Agregar Fase
                    </button>
                  </div>

                  {/* Visual Preview Timeline */}
                  <div className="h-2 w-full rounded bg-neutral-950 overflow-hidden flex border border-white/5 mb-1">
                    {phases.map((p) => (
                      <div 
                        key={p.id} 
                        style={{ backgroundColor: p.color, width: `${100 / phases.length}%` }} 
                        className="h-full border-r border-black/25"
                      />
                    ))}
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {phases.map((phase, idx) => (
                      <div key={phase.id} className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-2 relative">
                        {/* Phase Header with controls */}
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[8px] font-black text-white/30 uppercase">Fase #{idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <ArrowUp size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "down")}
                              disabled={idx === phases.length - 1}
                              className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                            >
                              <ArrowDown size={10} />
                            </button>
                            {phases.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemovePhase(phase.id)}
                                className="p-1.5 rounded bg-red-500/10 text-red-400 hover:text-red-300 ml-1.5"
                                title="Eliminar"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Phase Inputs */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Tipo de Fase</label>
                            <select
                              value={phase.type}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "type", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            >
                              {Object.entries(PHASE_CONFIG).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Nombre Custom</label>
                            <input
                              type="text"
                              value={phase.name}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "name", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            />
                          </div>

                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Inicio</label>
                            <input
                              type="date"
                              value={phase.startDate}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "startDate", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2 py-0.5 text-white text-[10px] outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Fin</label>
                            <input
                              type="date"
                              value={phase.endDate}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "endDate", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2 py-0.5 text-white text-[10px] outline-none"
                            />
                          </div>

                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Sesiones / Sem</label>
                            <input
                              type="number"
                              value={phase.weeklySessionGoal}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "weeklySessionGoal", Number(e.target.value))}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Flechas / Sem</label>
                            <input
                              type="number"
                              value={phase.weeklyArrowGoal}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "weeklyArrowGoal", Number(e.target.value))}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Notas / Indicaciones</label>
                          <textarea
                            value={phase.notes}
                            onChange={(e) => handleUpdatePhaseField(phase.id, "notes", e.target.value)}
                            rows={1.5}
                            placeholder="Indicaciones para los arqueros..."
                            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[10px] outline-none resize-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3: ASSIGNMENT */}
              {step === 3 && (
                <div className="flex flex-col gap-4 py-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Tipo de Asignación</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: "club", label: "Todo el Club", icon: Layout },
                        { id: "group", label: "Grupo", icon: Users },
                        { id: "individual", label: "Individual", icon: User }
                      ].map((card) => {
                        const CardIcon = card.icon;
                        const isSel = assignmentType === card.id;
                        return (
                          <div
                            key={card.id}
                            onClick={() => setAssignmentType(card.id as any)}
                            className={`border rounded-2xl p-4 cursor-pointer flex flex-col items-center justify-center text-center aspect-square transition ${
                              isSel
                                ? "bg-cyan-brand/20 border-cyan-neon text-white"
                                : "bg-neutral-900/40 border-white/10 hover:border-white/20 text-white/50"
                            }`}
                          >
                            <CardIcon size={20} className={isSel ? "text-cyan-neon" : "text-white/40"} />
                            <span className="text-[9px] font-black uppercase tracking-wider block mt-2.5 leading-tight">{card.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {assignmentType === "group" && (
                    <div className="flex flex-col gap-1 mt-1 animate-fadeIn">
                      <label className="text-[9px] text-white/40 uppercase font-bold">Nombre del Grupo</label>
                      <input
                        type="text"
                        placeholder="Ej. Roster Cadete, Grupo A, etc."
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none"
                      />
                    </div>
                  )}

                  {/* Checklist of simulated users/athletes */}
                  {assignmentType !== "club" && (
                    <div className="flex flex-col gap-2 animate-fadeIn mt-1 max-h-[30vh] overflow-y-auto pr-1">
                      <label className="text-[9px] text-white/50 uppercase font-black tracking-widest">Seleccionar Atletas ({assignedAthleteIds.length})</label>
                      <div className="flex flex-col gap-1.5">
                        {roster.map((athlete) => {
                          const isSel = assignedAthleteIds.includes(athlete.uid);
                          return (
                            <div
                              key={athlete.uid}
                              onClick={() => handleToggleAthleteSelection(athlete.uid)}
                              className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition ${
                                isSel
                                  ? "bg-cyan-brand/10 border-cyan-neon text-white"
                                  : "bg-neutral-950/60 border-white/5 text-white/50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded bg-white/5 border border-white/5 flex items-center justify-center font-bold text-[10px] text-white/60">
                                  {athlete.fullName[0]}
                                </div>
                                <span className="text-xs font-bold">{athlete.fullName}</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isSel}
                                readOnly
                                className="w-3.5 h-3.5 accent-cyan-neon"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: SUMMARY & CONFIRM */}
              {step === 4 && (
                <div className="flex flex-col gap-3 py-2 text-xs">
                  <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Resumen de Planificación</span>
                  
                  <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Nombre del Plan</span>
                      <span className="text-white font-extrabold text-sm uppercase">{name}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] text-white/30 uppercase font-bold">Fechas</span>
                        <span className="text-white font-medium">{startDate} al {endDate}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-white/30 uppercase font-bold">Meta de Flechas</span>
                        <span className="text-cyan-neon font-black">{volumeGoal.toLocaleString()} flechas</span>
                      </div>
                    </div>

                    <div className="flex flex-col border-t border-white/5 pt-2.5">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Fases Configuradas ({phases.length})</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {phases.map((p) => (
                          <span 
                            key={p.id} 
                            style={{ borderColor: `${p.color}30`, color: p.color, backgroundColor: `${p.color}15` }}
                            className="text-[9px] font-bold px-2 py-0.5 border rounded-full uppercase"
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col border-t border-white/5 pt-2.5">
                      <span className="text-[9px] text-white/30 uppercase font-bold">Asignación</span>
                      <span className="text-white font-medium mt-0.5">
                        {assignmentType === "club"
                          ? "Todo el Club"
                          : assignmentType === "group"
                          ? `Grupo: ${groupName} (${assignedAthleteIds.length} atletas)`
                          : `Individual (${assignedAthleteIds.length} atletas)`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex gap-2.5 border-t border-white/5 pt-4 mt-2">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className="flex-1 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase flex items-center justify-center gap-1 cursor-pointer border border-white/5"
                  >
                    <ArrowLeft size={14} />
                    <span>Atrás</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 rounded-2xl bg-transparent border border-white/5 text-white/40 hover:text-white font-bold text-xs uppercase"
                  >
                    Cancelar
                  </button>
                )}

                {step < 4 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="flex-1 py-2.5 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase flex items-center justify-center gap-1 shadow-glow-cyan cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveMacrocycle}
                    className="flex-1 py-2.5 rounded-2xl bg-green-500 text-white font-black text-xs uppercase shadow-[0_0_15px_rgba(34,197,94,0.3)] flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Sparkles size={14} />
                    <span>{editingId ? "Guardar Cambios" : "Crear Macrociclo"}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Month Sync Modal */}
      <AnimatePresence>
        {showSyncModal && macroToSync && (() => {
          const monthNames = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
          ];
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <div className="absolute inset-0" onClick={() => setShowSyncModal(false)} />
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4 text-left"
              >
                <div className="flex justify-between items-center border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-yellow-gold/15 border border-yellow-gold/30 text-yellow-gold flex items-center justify-center shadow-glow-yellow/10">
                      <RefreshCw size={15} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white uppercase tracking-wider">
                        Sincronizar Calendario
                      </h3>
                      <span className="text-[9px] text-gray-dim block">
                        Plan: <strong className="text-white">{macroToSync.name}</strong>
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowSyncModal(false)}
                    className="p-1 rounded-full text-white/40 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-3 text-xs">
                  <p className="text-[11px] text-white/70 leading-relaxed">
                    Sincroniza automáticamente este ciclo con el calendario de la app. Los arqueros podrán entrar a cada día y ver las metas de flechas y el trabajo técnico asignado.
                  </p>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/40 uppercase font-bold">Mes a Sincronizar</label>
                      <select
                        value={syncMonth}
                        onChange={(e) => setSyncMonth(Number(e.target.value))}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs outline-none focus:border-cyan-neon"
                      >
                        {monthNames.map((m, idx) => (
                          <option key={idx} value={idx}>{m}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[9px] text-white/40 uppercase font-bold">Año</label>
                      <input
                        type="number"
                        value={syncYear}
                        onChange={(e) => setSyncYear(Number(e.target.value))}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs outline-none focus:border-cyan-neon"
                      />
                    </div>
                  </div>

                  {/* Phases Preview */}
                  <div className="bg-neutral-950/60 p-3 rounded-2xl border border-white/5 flex flex-col gap-2 mt-1">
                    <span className="text-[9px] text-white/40 uppercase font-bold">Fases que se asignarán</span>
                    <div className="flex flex-wrap gap-1.5">
                      {macroToSync.phases?.map((p) => (
                        <span
                          key={p.id}
                          style={{ color: p.color, borderColor: `${p.color}30`, backgroundColor: `${p.color}15` }}
                          className="text-[9px] font-bold px-2 py-0.5 border rounded-full uppercase"
                        >
                          {p.name} ({p.weeklyArrowGoal} flechas/sem)
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={handleExecuteSync}
                    className="w-full mt-2 py-3 rounded-2xl bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-glow-yellow flex items-center justify-center gap-2 cursor-pointer hover:brightness-105 active:scale-98 transition disabled:opacity-40"
                  >
                    <Sparkles size={14} />
                    <span>{isSyncing ? "Sincronizando..." : `Sincronizar ${monthNames[syncMonth]} ${syncYear}`}</span>
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
