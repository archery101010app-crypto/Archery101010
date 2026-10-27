"use client";

import React, { useState, useEffect } from "react";
import { UserProfile } from "@/lib/authService";
import { 
  Lock, Sparkles, Plus, Calendar, CheckCircle2, ChevronRight, 
  Trash2, ArrowUp, ArrowDown, Users, User, ArrowLeft, Layout, 
  Copy, Archive, Edit2, AlertCircle, Check, X, RefreshCw,
  FileSpreadsheet, Download, UploadCloud, ClipboardPaste, HelpCircle
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
import { Macrocycle, MacrocyclePhase, ETAPA_COLORS, PHASE_CONFIG } from "@/lib/db/macrocycleTypes";
import { syncCycleToMonthCalendar, saveDailyEntriesToCalendar, syncEntireMacrocycleToCalendar } from "@/lib/cycleCalendarSync";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { 
  parseSpreadsheetData, 
  ParsedCycleResult, 
  downloadSampleTemplate, 
  downloadDailySampleTemplate,
  fetchGoogleSheetCsv,
  exportCycleToCsv 
} from "@/lib/cycleImporter";

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

  // Smart Spreadsheet Import Modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPlanName, setImportPlanName] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedCycleResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [sheetUrlInput, setSheetUrlInput] = useState("");
  const [isFetchingSheet, setIsFetchingSheet] = useState(false);

  // Hook into mobile back button and edge-swipe gestures
  useEffect(() => {
    if (showCreateModal) {
      return registerModalDismiss(() => setShowCreateModal(false));
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (showImportModal) {
      return registerModalDismiss(() => setShowImportModal(false));
    }
  }, [showImportModal]);

  useEffect(() => {
    if (showSyncModal) {
      return registerModalDismiss(() => setShowSyncModal(false));
    }
  }, [showSyncModal]);

  useEffect(() => {
    if (selectedMacro) {
      return registerModalDismiss(() => setSelectedMacro(null));
    }
  }, [selectedMacro]);

  const handleOpenImportModal = () => {
    setImportText("");
    setImportPlanName("");
    setImportPreview(null);
    setImportError(null);
    setSheetUrlInput("");
    setShowImportModal(true);
  };

  const handleFetchGoogleSheet = async () => {
    if (!sheetUrlInput.trim()) return;
    setIsFetchingSheet(true);
    setImportError(null);
    const res = await fetchGoogleSheetCsv(sheetUrlInput);
    setIsFetchingSheet(false);
    if (res.ok && res.csv) {
      handleParseImport(res.csv);
    } else {
      setImportError(res.error || "No se pudo leer el enlace de Google Sheets.");
    }
  };

  const handleParseImport = (textToParse: string, nameOverride?: string) => {
    setImportText(textToParse);
    setImportError(null);
    if (!textToParse.trim()) {
      setImportPreview(null);
      return;
    }
    // If user pasted a Google Sheets URL directly into the textarea, fetch it automatically!
    if (textToParse.trim().startsWith("https://docs.google.com/spreadsheets/")) {
      setSheetUrlInput(textToParse.trim());
      fetchGoogleSheetCsv(textToParse.trim()).then((res) => {
        if (res.ok && res.csv) {
          handleParseImport(res.csv, nameOverride);
        } else {
          setImportError(res.error || "No se pudo leer el enlace de Google Sheets.");
        }
      });
      return;
    }
    const currentName = nameOverride !== undefined ? nameOverride : (importPlanName || "Plan de Entrenamiento 2026");
    const result = parseSpreadsheetData(textToParse, currentName);
    if (result.success && (result.stages.length > 0 || result.dailyEntries.length > 0)) {
      setImportPreview(result);
      if (!importPlanName && !nameOverride) {
        setImportPlanName(result.planName);
      }
    } else {
      setImportPreview(null);
      setImportError(result.error || "No se detectaron datos válidos. Verifica las columnas de tu Excel o Sheets.");
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          handleParseImport(text);
          return;
        }
      }
      alert("Copia las celdas en tu Excel o Google Sheets y pégalas directamente en el recuadro de texto.");
    } catch {
      alert("Pega directamente el contenido copiado en el campo de texto.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
        setImportPlanName(cleanName);
        handleParseImport(content, cleanName);
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!importPreview || (importPreview.stages.length === 0 && importPreview.dailyEntries.length === 0)) return;
    const id = generateResilientId("MAC");
    const nowStr = new Date().toISOString();
    const finalName = importPlanName.trim() || importPreview.planName || "Plan Importado";

    const newCycle: Macrocycle = {
      id,
      name: finalName,
      coachId: user.uid,
      clubId: user.clubId || "CLB-DEMO",
      startDate: importPreview.startDate,
      endDate: importPreview.endDate,
      phases: importPreview.stages,
      assignmentType: "club",
      assignedAthleteIds: [],
      volumeGoal: importPreview.totalVolumeGoal,
      currentVolume: 0,
      status: "active",
      createdAt: nowStr,
      updatedAt: nowStr
    };

    await saveLocalMacrocycle(id, newCycle);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "macrocycles",
      operation: "INSERT",
      payloadId: id,
      payload: newCycle,
      timestamp: Date.now()
    });

    const list = await getLocalMacrocycles();
    setMacrocycles(list);
    setShowImportModal(false);
    setSelectedMacro(newCycle);

    if (importPreview.mode === "daily" && importPreview.dailyEntries.length > 0) {
      const summary = await saveDailyEntriesToCalendar(importPreview.dailyEntries, newCycle, user);
      alert(
        `✓ ¡Plan Día por Día "${finalName}" Importado y Publicado en el Calendario!\n\n` +
        `• Días exactos cargados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
        `• Rango: ${importPreview.startDate} al ${importPreview.endDate}\n` +
        `• Flechas totales programadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
        `Cada fecha ya tiene su actividad, meta de flechas y notas exactas en el Calendario.`
      );
    } else {
      const summary = await syncEntireMacrocycleToCalendar(newCycle, user);
      alert(
        `✓ ¡Plan "${finalName}" Importado y Sincronizado Día por Día!\n\n` +
        `• Etapas cargadas: ${importPreview.stages.length}\n` +
        `• Días generados en el calendario: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
        `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
        `Tus arqueros ya pueden tocar cualquier día en su Calendario para ver la meta y el enfoque asignado.`
      );
    }
  };

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

      // Load macrocycles (filtrando y eliminando cualquier residuo de demo indoor 2026)
      const list = await getLocalMacrocycles();
      const cleanList: Macrocycle[] = [];
      for (const macro of list) {
        const isIndoorDemo = macro.id === "MAC-DEMO-1" || 
          (macro.name || "").toLowerCase().includes("indoor 2026") ||
          (macro.name || "").toLowerCase().includes("preparación indoor") ||
          (macro.name || "").toLowerCase().includes("preparacion indoor");
        if (isIndoorDemo) {
          await deleteLocalMacrocycle(macro.id);
        } else {
          cleanList.push(macro);
        }
      }
      setMacrocycles(cleanList);
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
        id: "etapa-init",
        name: "Etapa 1",
        startDate: new Date().toISOString().split("T")[0],
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        weeklySessionGoal: 3,
        weeklyArrowGoal: 200,
        notes: "",
        color: ETAPA_COLORS[0].color
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
    const nextIdx = phases.length;
    const color = ETAPA_COLORS[nextIdx % ETAPA_COLORS.length].color;
    setPhases([
      ...phases,
      {
        id: `etapa-${Date.now()}`,
        name: `Etapa ${nextIdx + 1}`,
        startDate: startDate,
        endDate: endDate,
        weeklySessionGoal: 4,
        weeklyArrowGoal: 400,
        notes: "",
        color: color
      }
    ]);
  };

  const handleUpdatePhaseField = (id: string, field: keyof MacrocyclePhase, value: any) => {
    setPhases(
      phases.map((p) => {
        if (p.id === id) {
          return { ...p, [field]: value };
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
    if (!confirm("¿Seguro que deseas eliminar este ciclo?")) return;
    
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
            Planificación de Ciclos
          </h3>

          <p className="text-[11px] text-gray-dim leading-relaxed">
            Planifica la temporada de tu club. Diseña ciclos con etapas personalizadas según tus objetivos, define metas de flechas y supervisa el progreso de todo el equipo en tiempo real.
          </p>

          <button
            onClick={onUpgrade}
            className="w-full mt-3 py-3 rounded-full bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-glow-yellow hover:brightness-105 active:scale-98 transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Sparkles size={14} />
            <span>Activar Plan PRO Gratis (Promo Lanzamiento) ✦</span>
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
              <span className="text-[10px] text-gray-dim font-black uppercase tracking-wider">Ciclos Activos</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenImportModal}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900 border border-white/10 text-white hover:text-emerald-400 font-black text-[9px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition hover:border-emerald-500/30 shadow-sm"
                  title="Importar plan copiado de Excel o Google Sheets"
                >
                  <FileSpreadsheet size={12} className="text-emerald-400" />
                  <span>Importar Excel / Sheets</span>
                </button>
                <button
                  onClick={handleOpenCreate}
                  className="px-3 py-1.5 rounded-xl bg-cyan-neon text-black font-black text-[9px] uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:bg-cyan-brand transition shadow-glow-cyan"
                >
                  <Plus size={12} />
                  <span>+ Ciclo</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {macrocycles.length === 0 ? (
                <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white/30 text-xs">
                  Aún no has planificado ningún ciclo. Presiona "+ Ciclo" para iniciar.
                </div>
              ) : (
                macrocycles.map((mac) => {
                  const currentPhase = getCurrentPhaseType(mac);
                  const progress = mac.volumeGoal > 0 ? Math.min(100, Math.round((mac.currentVolume / mac.volumeGoal) * 100)) : 0;
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
                            Etapa: {currentPhase.name}
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
                            className="px-2 py-1 rounded-xl bg-yellow-gold/10 hover:bg-yellow-gold/20 text-yellow-gold border border-yellow-gold/30 text-[9px] font-black uppercase flex items-center gap-1 cursor-pointer transition shadow-sm"
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
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-yellow-gold/20 to-amber-500/20 hover:from-yellow-gold/30 hover:to-amber-500/30 text-yellow-gold border border-yellow-gold/35 text-[10px] font-black uppercase flex items-center gap-1.5 cursor-pointer transition shadow-sm"
                  title="Sincronizar con el Calendario de la App"
                >
                  <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                  <span>Sincronizar Calendario</span>
                </button>
                <button
                  onClick={() => exportCycleToCsv(selectedMacro)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-emerald-400 transition cursor-pointer border border-white/5"
                  title="Exportar a Excel / Google Sheets (CSV)"
                >
                  <Download size={13} />
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
              <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">Línea de Tiempo del Ciclo</span>
              
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
                            Etapa Activa
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
                    {editingId ? "Editar Ciclo" : "Ciclo"}
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
                      placeholder="Ej. Plan de Temporada"
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

              {/* STEP 2: ETAPAS timeline builder */}
              {step === 2 && (
                <div className="flex flex-col gap-3 py-2 max-h-[50vh] overflow-y-auto pr-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Etapas del Cronograma</span>
                    <button
                      type="button"
                      onClick={handleAddPhase}
                      className="text-[9px] bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-1 rounded-lg font-bold cursor-pointer"
                    >
                      + Agregar Etapa
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
                      <div key={phase.id} className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3.5 flex flex-col gap-3 relative">
                        {/* Etapa Header with controls */}
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[9px] font-black text-white/40 uppercase">Etapa #{idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                              title="Subir etapa"
                            >
                              <ArrowUp size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "down")}
                              disabled={idx === phases.length - 1}
                              className="p-1 rounded bg-white/5 text-white/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                              title="Bajar etapa"
                            >
                              <ArrowDown size={11} />
                            </button>
                            {phases.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemovePhase(phase.id)}
                                className="p-1.5 rounded bg-red-500/10 text-red-400 hover:text-red-300 ml-1.5 cursor-pointer"
                                title="Eliminar etapa"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Stage Name & Color Selection */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Nombre de la Etapa</label>
                          <input
                            type="text"
                            placeholder="Ej. Acondicionamiento, Volumen, Torneo, Puesta a Punto..."
                            value={phase.name}
                            onChange={(e) => handleUpdatePhaseField(phase.id, "name", e.target.value)}
                            className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Color Identificador</label>
                          <div className="flex items-center gap-2 flex-wrap">
                            {ETAPA_COLORS.map((c) => (
                              <button
                                key={c.color}
                                type="button"
                                onClick={() => handleUpdatePhaseField(phase.id, "color", c.color)}
                                style={{ backgroundColor: c.color }}
                                className={`w-5 h-5 rounded-full transition-all cursor-pointer ${
                                  phase.color === c.color 
                                    ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-neutral-950" 
                                    : "opacity-60 hover:opacity-100"
                                }`}
                                title={c.name}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Dates and Targets */}
                        <div className="grid grid-cols-2 gap-2 mt-0.5">
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Fecha Inicio</label>
                            <input
                              type="date"
                              value={phase.startDate}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "startDate", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-white text-[10px] outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Fecha Fin</label>
                            <input
                              type="date"
                              value={phase.endDate}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "endDate", e.target.value)}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2 py-1 text-white text-[10px] outline-none"
                            />
                          </div>

                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Sesiones / Semana</label>
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={phase.weeklySessionGoal}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "weeklySessionGoal", Number(e.target.value))}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[8px] text-white/40 uppercase font-bold">Flechas / Semana</label>
                            <input
                              type="number"
                              value={phase.weeklyArrowGoal}
                              onChange={(e) => handleUpdatePhaseField(phase.id, "weeklyArrowGoal", Number(e.target.value))}
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1 text-white text-[10px] outline-none"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[8px] text-white/40 uppercase font-bold">Notas / Indicaciones para Arqueros</label>
                          <textarea
                            value={phase.notes}
                            onChange={(e) => handleUpdatePhaseField(phase.id, "notes", e.target.value)}
                            rows={1.5}
                            placeholder="Indicaciones para los arqueros en esta etapa..."
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
                      <span className="text-[9px] text-white/30 uppercase font-bold">Etapas Configuradas ({phases.length})</span>
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
                    <span>{editingId ? "Guardar Cambios" : "Crear Ciclo"}</span>
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
                    <div className="w-8 h-8 rounded-xl bg-yellow-gold/15 border border-yellow-gold/30 text-yellow-gold flex items-center justify-center shadow-sm">
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
                    <span className="text-[9px] text-white/40 uppercase font-bold">Etapas que se asignarán</span>
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

      {/* MODAL IMPORT EXCEL / GOOGLE SHEETS */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-neutral-950 border border-emerald-500/30 rounded-3xl w-full max-w-lg p-5 flex flex-col gap-4 max-h-[92vh] overflow-y-auto shadow-2xl relative"
            >
              {/* Header */}
              <div className="flex justify-between items-center pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <FileSpreadsheet size={18} />
                  </div>
                  <div>
                    <h3 className="font-black text-sm text-white tracking-wide flex items-center gap-2">
                      Importar Plan desde Excel / Sheets
                    </h3>
                    <p className="text-[10px] text-white/50">
                      Detecta automáticamente formato Día por Día o por Etapas
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Action Buttons: Paste, Upload, Daily Template, Stage Template */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold flex flex-col items-center justify-center gap-1 transition active:scale-95"
                >
                  <ClipboardPaste size={14} className="text-cyan-neon" />
                  <span>Pegar Celdas</span>
                </button>

                <label className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold flex flex-col items-center justify-center gap-1 transition cursor-pointer active:scale-95 text-center">
                  <UploadCloud size={14} className="text-emerald-400" />
                  <span>Subir CSV/Excel</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  onClick={downloadDailySampleTemplate}
                  className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold flex flex-col items-center justify-center gap-1 transition active:scale-95 text-center"
                >
                  <Download size={14} className="text-yellow-gold" />
                  <span>Modelo Día x Día</span>
                </button>

                <button
                  type="button"
                  onClick={downloadSampleTemplate}
                  className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold flex flex-col items-center justify-center gap-1 transition active:scale-95 text-center"
                >
                  <Download size={14} className="text-purple-400" />
                  <span>Modelo Etapas</span>
                </button>
              </div>

              {/* Google Sheets Direct Link Fetcher */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-white/50 uppercase font-black tracking-wider">
                  O pega el enlace público de tu Google Sheets
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    value={sheetUrlInput}
                    onChange={(e) => setSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 bg-neutral-900 border border-white/10 rounded-xl px-3 py-1.5 text-white text-[11px] outline-none focus:border-emerald-400 transition placeholder:text-white/20 min-w-0"
                  />
                  <button
                    type="button"
                    disabled={!sheetUrlInput.trim() || isFetchingSheet}
                    onClick={handleFetchGoogleSheet}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 font-black text-[10px] uppercase tracking-wider shrink-0 transition disabled:opacity-40 cursor-pointer"
                  >
                    {isFetchingSheet ? "Leyendo..." : "Leer Sheets"}
                  </button>
                </div>
              </div>

              {/* Plan Name */}
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-white/50 uppercase font-black tracking-wider">
                  Nombre del Plan / Ciclo
                </label>
                <input
                  type="text"
                  value={importPlanName}
                  onChange={(e) => {
                    setImportPlanName(e.target.value);
                    if (importText.trim()) {
                      handleParseImport(importText, e.target.value);
                    }
                  }}
                  placeholder="Ej: Plan Nacional 2026 - Recurvo"
                  className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-emerald-400 transition placeholder:text-white/20"
                />
              </div>

              {/* Text Area for Pasted Data */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <label className="text-[9px] text-white/50 uppercase font-black tracking-wider">
                    Datos (Copia y pega desde Excel o Google Sheets)
                  </label>
                  {importText.trim() && (
                    <span className="text-[9px] text-white/40">
                      {importText.trim().split("\n").length} líneas
                    </span>
                  )}
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => handleParseImport(e.target.value)}
                  placeholder={`Formato Día por Día:\nFecha\tActividad\tFlechas\tEnfoque\tNotas\n26/10/2026\tVolumen 70m\t120\tAnclaje firme\tSeries de 6 flechas\n27/10/2026\tControl WA 720\t144\tTiempo oficial\tAnotar en la app\n\nO Formato por Etapas:\nEtapa\tInicio\tFin\tSesiones/Sem\tFlechas/Sem\tNotas`}
                  rows={4}
                  className="bg-neutral-900 border border-white/10 rounded-xl p-3 text-[11px] font-mono text-white/90 outline-none focus:border-emerald-400 transition placeholder:text-white/20 resize-none leading-relaxed"
                />
              </div>

              {/* Error Message */}
              {importError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Live Preview */}
              {importPreview && (importPreview.stages.length > 0 || importPreview.dailyEntries.length > 0) && (
                <div className="flex flex-col gap-2 p-3 rounded-2xl bg-white/[0.02] border border-white/5">
                  <div className="flex items-center justify-between text-[10px] flex-wrap gap-1">
                    <span className="text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      {importPreview.mode === "daily"
                        ? `Modo Día por Día (${importPreview.dailyEntries.length} días exactos)`
                        : `Modo por Etapas (${importPreview.stages.length} etapas)`}
                    </span>
                    <span className="text-white/60 font-mono">
                      Meta: {importPreview.totalVolumeGoal.toLocaleString()} flechas
                    </span>
                  </div>

                  {importPreview.mode === "daily" ? (
                    <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                      {importPreview.dailyEntries.map((dayItem, i) => (
                        <div
                          key={`${dayItem.date}-${i}`}
                          className="p-2 rounded-xl bg-neutral-900/60 border border-white/5 flex items-center justify-between gap-2 text-[10px]"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                dayItem.isRestDay ? "bg-emerald-400" : dayItem.type === "competition" ? "bg-red-400" : "bg-cyan-neon"
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-white truncate">{dayItem.title}</div>
                              <div className="text-[9px] text-white/40 font-mono truncate">
                                {dayItem.date} · {dayItem.focusPoints.join(", ")}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-cyan-neon font-black font-mono whitespace-nowrap">
                              {dayItem.isRestDay ? "Descanso" : `🎯 ${dayItem.targetArrows} fl`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                      {importPreview.stages.map((stg, i) => {
                        const diffDays = Math.max(1, Math.round((new Date(stg.endDate).getTime() - new Date(stg.startDate).getTime()) / (1000 * 60 * 60 * 24)));
                        const estWeeks = Math.max(1, Math.round(diffDays / 7));
                        return (
                          <div
                            key={stg.id || i}
                            className="p-2 rounded-xl bg-neutral-900/60 border border-white/5 flex items-center justify-between text-[10px]"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: stg.color || "#10B981" }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-black text-white truncate">{stg.name}</div>
                                <div className="text-[9px] text-white/40 font-mono">
                                  {stg.startDate} ➔ {stg.endDate} ({estWeeks} sem)
                                </div>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-cyan-neon font-black font-mono">
                                {stg.weeklyArrowGoal} <span className="text-[8px] font-normal text-white/40">fl/sem</span>
                              </div>
                              <div className="text-[9px] text-white/40">
                                {stg.weeklySessionGoal} sesiones/sem
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 font-bold text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!importPreview || (importPreview.stages.length === 0 && importPreview.dailyEntries.length === 0)}
                  onClick={handleConfirmImport}
                  className="flex-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Sparkles size={14} />
                  <span>Cargar y Publicar en Calendario</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
