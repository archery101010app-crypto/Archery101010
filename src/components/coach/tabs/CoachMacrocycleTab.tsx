"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { UserProfile } from "@/lib/authService";
import {
  Lock,
  Plus,
  Calendar,
  ChevronRight,
  Trash2,
  ArrowUp,
  ArrowDown,
  Users,
  User,
  ArrowLeft,
  Layout,
  Copy,
  Edit2,
  Check,
  X,
  RefreshCw,
  FileSpreadsheet,
  Download,
  Unlink,
  UserMinus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getLocalMacrocycles,
  saveLocalMacrocycle,
  generateResilientId,
  addToSyncQueue,
  getLocalSetting,
  getLocalSessions,
  isFictitiousUser,
  isFictitiousSession
} from "@/lib/db/indexedDB";
import { Macrocycle, MacrocyclePhase, ETAPA_COLORS } from "@/lib/db/macrocycleTypes";
import {
  syncCycleToMonthCalendar,
  syncEntireMacrocycleToCalendar,
  unlinkAndPurgePlan,
  SyncCycleSummary
} from "@/lib/cycleCalendarSync";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { exportCycleToCsv } from "@/lib/cycleImporter";
import { isProActive } from "@/lib/billingService";
import { getSessionArrows } from "@/lib/scoring/sessionMetrics";
import { showOledAlert, showOledConfirm } from "@/lib/oledDialog";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getLocalISODate, formatRegionalDate } from "@/lib/i18n/regionalUtils";

const PlanImporterModal = dynamic(() => import("@/components/planning/PlanImporterModal"), {
  ssr: false
});

interface CoachMacrocycleTabProps {
  user: UserProfile;
  onUpgrade: () => void;
  athletes?: UserProfile[];
  sessions?: any[];
}

export default function CoachMacrocycleTab({
  user,
  onUpgrade,
  athletes: externalAthletes,
  sessions: externalSessions
}: CoachMacrocycleTabProps) {
  const { language, t, tx } = useLanguage();
  const isPro = isProActive(user);
  const canonicalClubId =
    user.clubId && user.clubId !== "CLB-DEMO" ? user.clubId : `CLB-${user.uid}`;

  const [macrocycles, setMacrocycles] = useState<Macrocycle[]>([]);
  const [selectedMacro, setSelectedMacro] = useState<Macrocycle | null>(null);

  // Roster of athletes in the club
  const [roster, setRoster] = useState<UserProfile[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);

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
  const [syncTargetType, setSyncTargetType] = useState<"all" | "selected">("all");
  const [syncSelectedAthleteIds, setSyncSelectedAthleteIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Smart Spreadsheet Import Modal states
  const [showImportModal, setShowImportModal] = useState(false);

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
    setShowImportModal(true);
  };

  const handleImportSuccess = async ({
    macrocycle,
    summary
  }: {
    macrocycle: Macrocycle;
    summary: SyncCycleSummary;
  }) => {
    const list = await getLocalMacrocycles();
    setMacrocycles(list);
    setSelectedMacro(macrocycle);

    const assignedIds = macrocycle.assignedAthleteIds || [];
    const hasSpecificAthletes = assignedIds.length > 0 && macrocycle.assignmentType !== "club";
    const athleteNames = hasSpecificAthletes
      ? assignedIds.map((id) => roster.find((r) => r.uid === id)?.fullName || id).join(", ")
      : tx("Todos los alumnos del Club", "All Club Athletes");

    await showOledAlert(
      tx(
        `¡Plan "${macrocycle.name}" Importado y Publicado en el Calendario!\n\n` +
          `• Asignado a: ${athleteNames}\n` +
          `• Días programados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
          `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
          (hasSpecificAthletes
            ? `Se ha sincronizado en formato literal en el calendario de: ${athleteNames}.`
            : `Tus arqueros ya pueden entrar a su calendario para ver las tareas asignadas.`),
        `Plan "${macrocycle.name}" Imported and Published to Calendar!\n\n` +
          `• Assigned to: ${athleteNames}\n` +
          `• Scheduled days: ${summary.syncedDaysCount} (${summary.trainingDaysCount} training, ${summary.restDaysCount} rest)\n` +
          `• Total assigned arrows: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
          (hasSpecificAthletes
            ? `Synced directly onto the calendar of: ${athleteNames}.`
            : `Your archers can now open their calendar to view the assigned tasks.`)
      )
    );
  };

  const handleOpenSyncModal = (macro: Macrocycle) => {
    setMacroToSync(macro);
    setSyncYear(new Date().getFullYear());
    setSyncMonth(new Date().getMonth());
    if (
      macro.assignedAthleteIds &&
      macro.assignedAthleteIds.length > 0 &&
      macro.assignmentType !== "club"
    ) {
      setSyncTargetType("selected");
      setSyncSelectedAthleteIds(macro.assignedAthleteIds);
    } else {
      setSyncTargetType("all");
      setSyncSelectedAthleteIds(roster[0]?.uid ? [roster[0].uid] : []);
    }
    setShowSyncModal(true);
  };

  const handleExecuteSync = async () => {
    if (!macroToSync) return;
    if (syncTargetType === "selected" && syncSelectedAthleteIds.length === 0) {
      await showOledAlert(
        tx(
          "Por favor marca al menos un alumno en la lista.",
          "Please select at least one athlete from the list."
        )
      );
      return;
    }
    setIsSyncing(true);
    try {
      const targetAthletes = syncTargetType === "selected" ? syncSelectedAthleteIds : undefined;
      const summary = await syncCycleToMonthCalendar(macroToSync, syncYear, syncMonth, user, {
        targetAthleteIds: targetAthletes,
        lang: language
      });
      setShowSyncModal(false);

      const targetText =
        targetAthletes && targetAthletes.length > 0
          ? targetAthletes.map((id) => roster.find((r) => r.uid === id)?.fullName || id).join(", ")
          : tx("Todos los alumnos del Club", "All Club Athletes");

      await showOledAlert(
        tx(
          `¡Calendario Sincronizado con Éxito!\n\n` +
            `• Plan: ${summary.macrocycleName}\n` +
            `• Destinatario(s): ${targetText}\n` +
            `• Mes: ${summary.monthName} ${summary.year}\n` +
            `• Días planificados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
            `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
            `Las tareas ya están reflejadas en el calendario correspondiente.`,
          `Calendar Synced!\n\n` +
            `• Plan: ${summary.macrocycleName}\n` +
            `• Recipient(s): ${targetText}\n` +
            `• Month: ${summary.monthName} ${summary.year}\n` +
            `• Planned days: ${summary.syncedDaysCount} (${summary.trainingDaysCount} training, ${summary.restDaysCount} rest)\n` +
            `• Total assigned arrows: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
            `Tasks are now visible on the target calendar.`
        )
      );
    } catch (err) {
      console.error("Error syncing cycle to calendar:", err);
      await showOledAlert(
        tx(
          "Hubo un error al sincronizar con el calendario.",
          "An error occurred while syncing with the calendar."
        )
      );
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      const activeClubId = canonicalClubId;
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      const athletes =
        externalAthletes && externalAthletes.length > 0
          ? externalAthletes
          : allUsers.filter(
              (u) =>
                (u.clubId === activeClubId || (user.clubId && u.clubId === user.clubId)) &&
                u.role === "archer" &&
                u.uid !== user.uid
            );

      setRoster(athletes.filter((a) => !isFictitiousUser(a)));

      const list = await getLocalMacrocycles();
      const cleanList: Macrocycle[] = [];
      for (const macro of list) {
        const phasesDump = JSON.stringify(macro.phases || []).toLowerCase();
        const lowerName = (macro.name || "").trim().toLowerCase();
        const hasTestUid = (macro.assignedAthleteIds || []).some((id: string) =>
          id.startsWith("qNEkEf15NKZABcadQ0l")
        );
        const isTestSheetsPlan =
          (lowerName === "plan google sheets" &&
            (macro.startDate === "2026-10-01" || (macro.volumeGoal || 0) === 0 || hasTestUid)) ||
          hasTestUid;
        const isIndoorDemo =
          macro.id === "MAC-DEMO-1" ||
          isTestSheetsPlan ||
          lowerName.includes("indoor 2026") ||
          lowerName.includes("preparación indoor") ||
          lowerName.includes("preparacion indoor") ||
          lowerName.includes("offline mode active") ||
          lowerName.includes("connect to the internet") ||
          phasesDump.includes("15 min calentamiento con liga") ||
          phasesDump.includes("core y estabilidad") ||
          phasesDump.includes("volumen técnico 70m");
        if (isIndoorDemo) {
          await unlinkAndPurgePlan(macro.id);
        } else {
          const belongsToCoach =
            macro.coachId === user.uid ||
            (activeClubId && macro.clubId === activeClubId) ||
            (user.clubId && macro.clubId === user.clubId);
          if (belongsToCoach) {
            cleanList.push(macro);
          }
        }
      }
      setMacrocycles(cleanList);
      const localSess = await getLocalSessions();
      const mergedMap = new Map<string, any>();
      for (const s of localSess || []) {
        if (s?.id) mergedMap.set(s.id, s);
      }
      for (const s of externalSessions || []) {
        if (s?.id) mergedMap.set(s.id, s);
      }
      setAllSessions(Array.from(mergedMap.values()));
    }

    if (isPro) {
      loadData();
    }

    const handleDbChange = (e: any) => {
      const targetStores = ["simulated_users", "macrocycles_local", "sessions_local"];
      if (targetStores.includes(e.detail?.store) && isPro) {
        loadData();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [isPro, user, canonicalClubId, externalAthletes, externalSessions]);

  const computeMacrocycleArrows = (mac: Macrocycle): number => {
    const startMs = mac.startDate ? new Date(mac.startDate + "T00:00:00").getTime() : 0;
    const endMs = mac.endDate
      ? new Date(mac.endDate + "T23:59:59").getTime()
      : Number.MAX_SAFE_INTEGER;
    const hasSpecificAthletes =
      mac.assignmentType !== "club" && mac.assignedAthleteIds && mac.assignedAthleteIds.length > 0;
    const targetUids = new Set(
      hasSpecificAthletes ? mac.assignedAthleteIds : roster.map((r) => r.uid)
    );

    return allSessions
      .filter((s) => {
        if (
          !s ||
          s.isDraft ||
          s.isDuel ||
          s.deletedByArcher === true ||
          isFictitiousSession(s)
        ) {
          return false;
        }
        if (s.timestamp < startMs || s.timestamp > endMs) return false;
        const uid = s.userId || s.userUid;
        if (hasSpecificAthletes) {
          return Boolean(uid && targetUids.has(uid));
        }
        return Boolean(
          (uid && targetUids.has(uid)) ||
            (s.clubId && s.clubId === canonicalClubId && uid !== user.uid)
        );
      })
      .reduce((sum, s) => sum + getSessionArrows(s), 0);
  };

  const handleOpenCreate = () => {
    const todayIso = getLocalISODate();
    setEditingId(null);
    setName("");
    setStartDate(todayIso);
    setEndDate(getLocalISODate(Date.now() + 90 * 24 * 60 * 60 * 1000));
    setVolumeGoal(8000);
    setPhases([
      {
        id: "etapa-init",
        name: tx("Etapa 1", "Stage 1"),
        startDate: todayIso,
        endDate: getLocalISODate(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
        name: tx(`Etapa ${nextIdx + 1}`, `Stage ${nextIdx + 1}`),
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
    const assignedIds = assignmentType === "club" ? [] : assignedAthleteIds;

    const newMacro: Macrocycle = {
      id,
      name,
      coachId: user.uid,
      clubId: canonicalClubId,
      startDate,
      endDate,
      phases,
      assignmentType,
      assignedAthleteIds: assignedIds,
      groupName: assignmentType === "group" ? groupName : undefined,
      volumeGoal,
      currentVolume: editingId
        ? macrocycles.find((m) => m.id === editingId)?.currentVolume || 0
        : 0,
      status: "active",
      createdAt: editingId
        ? macrocycles.find((m) => m.id === editingId)?.createdAt || nowStr
        : nowStr,
      updatedAt: nowStr
    };

    await saveLocalMacrocycle(id, newMacro);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "macrocycles",
      operation: editingId ? "UPDATE" : "INSERT",
      payloadId: id,
      payload: newMacro,
      timestamp: Date.now()
    });

    await syncEntireMacrocycleToCalendar(
      newMacro,
      assignedIds,
      user.uid,
      user.fullName,
      canonicalClubId
    );

    const list = await getLocalMacrocycles();
    setMacrocycles(list);
    setShowCreateModal(false);

    if (selectedMacro?.id === id) {
      setSelectedMacro(newMacro);
    }
  };

  const handleDelete = async (id: string) => {
    const target = macrocycles.find((m) => m.id === id);
    const planName = target?.name || tx("este plan", "this plan");
    const confirmed = await showOledConfirm(
      tx(
        `¿Seguro que deseas desvincular y eliminar el plan "${planName}"?\n\nEsta acción borrará el plan y retirará todas sus asignaciones y tareas programadas en el calendario.`,
        `Unlink and delete plan "${planName}"?\n\nThis will delete the plan and remove all its scheduled tasks from the calendar.`
      ),
      { confirmLabel: tx("Desvincular y Eliminar", "Unlink & Delete") }
    );
    if (!confirmed) return;

    await unlinkAndPurgePlan(id);

    const updated = await getLocalMacrocycles();
    setMacrocycles(updated);
    if (selectedMacro?.id === id) setSelectedMacro(null);
    await showOledAlert(
      tx(
        `El plan "${planName}" ha sido desvinculado y eliminado por completo.`,
        `Plan "${planName}" has been unlinked and deleted.`
      )
    );
  };

  const handleUnlinkAthlete = async (macro: Macrocycle, athlete: UserProfile) => {
    const confirmed = await showOledConfirm(
      tx(
        `¿Deseas desvincular a ${athlete.fullName} del plan "${macro.name}"?\n\nSe retirarán todas las tareas y metas de este plan del calendario del alumno.`,
        `Unlink ${athlete.fullName} from plan "${macro.name}"?\n\nAll tasks and goals from this plan will be removed from the athlete's calendar.`
      ),
      { confirmLabel: tx("Desvincular", "Unlink") }
    );
    if (!confirmed) return;

    await unlinkAndPurgePlan(macro.id, athlete.uid);

    const updated = await getLocalMacrocycles();
    setMacrocycles(updated);
    const refreshedSelected = updated.find((m) => m.id === macro.id) || null;
    setSelectedMacro(refreshedSelected);

    await showOledAlert(
      tx(
        `${athlete.fullName} ha sido desvinculado(a) del plan exitosamente.`,
        `${athlete.fullName} has been unlinked from the plan.`
      )
    );
  };

  const handleDuplicate = async (macro: Macrocycle) => {
    const duplicatedId = generateResilientId("MAC");
    const nowStr = new Date().toISOString();
    const duplicated: Macrocycle = {
      ...macro,
      id: duplicatedId,
      clubId: canonicalClubId,
      name: `${macro.name} (${tx("Copia", "Copy")})`,
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

  const getCurrentPhaseType = (macro: Macrocycle): MacrocyclePhase | null => {
    const today = getLocalISODate();
    const found = macro.phases.find((p) => today >= p.startDate && today <= p.endDate);
    return found || macro.phases[0] || null;
  };

  // RENDER PAYWALL SCREEN IF FREE ACCOUNT
  if (!isPro) {
    return (
      <div className="relative min-h-[300px] bg-[#0D0F12] rounded-2xl border border-white/[0.08] p-6 flex flex-col items-center justify-center text-center overflow-hidden">
        <div className="flex flex-col items-center gap-3.5 z-20 max-w-xs">
          <div className="w-12 h-12 rounded-2xl bg-yellow-gold/10 border border-yellow-gold/25 flex items-center justify-center text-yellow-gold">
            <Lock size={20} />
          </div>

          <span className="text-[11.6px] bg-yellow-gold text-black font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
            {tx("Exclusivo Coach PRO", "Coach PRO Exclusive")}
          </span>

          <h3 className="text-white text-base font-black uppercase tracking-wide">
            {tx("Planificación de Ciclos", "Cycle Planning")}
          </h3>

          <p className="text-[12.8px] text-white leading-relaxed">
            {tx(
              "Planifica la temporada de tu club. Diseña ciclos con etapas personalizadas según tus objetivos, define metas de flechas y supervisa el progreso de todo el equipo en tiempo real.",
              "Plan your club's season. Design training cycles with custom stages, set arrow volume goals, and track team progress in real time."
            )}
          </p>

          <button
            onClick={onUpgrade}
            className="w-full mt-3 py-3 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider active:scale-98 transition cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Check size={14} />
            <span>
              {tx(
                "Activar Plan PRO Gratis (Promo Lanzamiento)",
                "Activate Free Coach PRO (Launch Access)"
              )}
            </span>
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
            <div className="flex flex-col gap-2.5 bg-neutral-900/40 border border-white/10 rounded-3xl p-3.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[12.6px] text-white font-black uppercase tracking-wider">
                  {tx("Ciclos Activos", "Active Cycles")}
                </span>
                <span className="text-[11.5px] text-neutral-400 font-bold uppercase tracking-wider tabular-nums">
                  {macrocycles.length}{" "}
                  {macrocycles.length === 1 ? tx("plan", "plan") : tx("planes", "plans")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 w-full">
                <button
                  onClick={handleOpenImportModal}
                  className="w-full py-2.5 px-2 rounded-2xl bg-neutral-950 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 font-black text-[12px] leading-tight text-center uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition shadow-sm"
                  title={tx(
                    "Importar plan desde hoja de cálculo (.xlsx / .csv)",
                    "Import plan from spreadsheet (.xlsx / .csv)"
                  )}
                >
                  <FileSpreadsheet size={13} className="text-emerald-400 shrink-0" />
                  <span>{tx("Importar .xlsx / .csv", "Import .xlsx / .csv")}</span>
                </button>
                <button
                  onClick={handleOpenCreate}
                  className="w-full py-2.5 px-2 rounded-2xl bg-cyan-neon text-black font-black text-[12px] leading-tight text-center uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 cursor-pointer hover:bg-cyan-brand transition shadow-sm"
                >
                  <Plus size={13} className="shrink-0" />
                  <span>{tx("Nuevo Ciclo", "New Cycle")}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {macrocycles.length === 0 ? (
                <div className="bg-neutral-900/20 border border-white/5 rounded-3xl p-12 text-center text-white text-xs">
                  {tx(
                    'Aún no has planificado ningún ciclo. Presiona "Nuevo Ciclo" o "Importar .xlsx / .csv" para iniciar.',
                    'No cycles planned yet. Tap "New Cycle" or "Import .xlsx / .csv" to get started.'
                  )}
                </div>
              ) : (
                macrocycles.map((mac) => {
                  const currentPhase = getCurrentPhaseType(mac);
                  const realVolume = computeMacrocycleArrows(mac);
                  const progress =
                    mac.volumeGoal > 0
                      ? Math.min(100, Math.round((realVolume / mac.volumeGoal) * 100))
                      : 0;
                  return (
                    <div
                      key={mac.id}
                      onClick={() => setSelectedMacro(mac)}
                      className="bg-neutral-900/40 p-5 rounded-3xl border border-white/10 hover:border-white/20 transition duration-200 cursor-pointer flex flex-col gap-4 shadow-xl relative overflow-hidden group"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <h4 className="text-white text-sm font-bold group-hover:text-cyan-neon transition-colors truncate">
                            {mac.name}
                          </h4>
                          <span className="text-[10.5px] text-white flex items-center gap-1 tabular-nums">
                            <Calendar size={10} className="shrink-0" />
                            <span className="truncate">
                              {mac.startDate} — {mac.endDate}
                            </span>
                          </span>
                        </div>
                        {currentPhase && (
                          <span
                            style={{
                              color: currentPhase.color,
                              backgroundColor: `${currentPhase.color}15`,
                              borderColor: `${currentPhase.color}30`
                            }}
                            className="text-[9.3px] font-black uppercase px-2.5 py-1 rounded-full border shrink-0 max-w-[45%] truncate"
                          >
                            {tx("Etapa:", "Stage:")} {currentPhase.name}
                          </span>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center gap-2 text-[10.5px]">
                          <span className="text-white">
                            {tx("Meta de Volumen de Flechas:", "Arrow Volume Goal:")}
                          </span>
                          <span className="text-white font-extrabold tabular-nums shrink-0">
                            {realVolume.toLocaleString()} / {mac.volumeGoal.toLocaleString()} (
                            {progress}%)
                          </span>
                        </div>
                        <div className="w-full bg-neutral-950 h-2 rounded-full overflow-hidden border border-white/5">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${progress}%`,
                              backgroundColor: currentPhase?.color || "#00A8F3"
                            }}
                          />
                        </div>
                      </div>

                      {/* Assignment Badge */}
                      <div className="flex justify-between items-center border-t border-white/[0.03] pt-3 text-[10.5px] text-white gap-2">
                        <span className="flex items-center gap-1 font-bold min-w-0 flex-1 truncate">
                          {mac.assignmentType === "club" ||
                          !mac.assignedAthleteIds ||
                          mac.assignedAthleteIds.length === 0 ? (
                            <>
                              <Layout size={10} className="shrink-0 text-cyan-neon" />
                              <span className="truncate">{tx("Todo el Club", "Entire Club")}</span>
                            </>
                          ) : (
                            <>
                              <Users size={10} className="shrink-0 text-cyan-neon" />
                              <span className="truncate">
                                {mac.assignedAthleteIds
                                  .map((id) => {
                                    const found = roster.find((r) => r.uid === id)?.fullName;
                                    if (found) return found;
                                    return id.length > 16
                                      ? tx("Alumno vinculado", "Linked athlete")
                                      : id;
                                  })
                                  .join(", ")}
                              </span>
                            </>
                          )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenSyncModal(mac);
                            }}
                            className="px-2 py-1 rounded-xl bg-yellow-gold/10 hover:bg-yellow-gold/20 text-yellow-gold border border-yellow-gold/30 text-[10.5px] font-black uppercase flex items-center gap-1 cursor-pointer transition shadow-sm shrink-0 whitespace-nowrap"
                            title={tx("Sincronizar calendario del mes", "Sync month calendar")}
                          >
                            <RefreshCw size={10} className="shrink-0" />
                            <span>{tx("Sincronizar", "Sync")}</span>
                          </button>
                          <span className="flex items-center text-cyan-neon font-black uppercase tracking-wider group-hover:translate-x-1 transition-transform shrink-0 whitespace-nowrap">
                            {t("details")}{" "}
                            <ChevronRight size={12} className="shrink-0 rtl:rotate-180" />
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
            className="flex flex-col gap-4"
          >
            {/* Row 1: Top bar */}
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setSelectedMacro(null)}
                className="h-9 px-3 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:bg-white/[0.05] text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 active:scale-95"
              >
                <ArrowLeft size={14} className="rtl:rotate-180" />
                <span>{tx("Volver a Planes", "Back to Plans")}</span>
              </button>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => exportCycleToCsv(selectedMacro)}
                  className="w-9 h-9 rounded-xl bg-[#0D1017] hover:bg-white/10 text-white hover:text-emerald-400 transition cursor-pointer border border-white/[0.08] flex items-center justify-center active:scale-95"
                  title={t("exportCsvBtn")}
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => handleOpenEdit(selectedMacro)}
                  className="w-9 h-9 rounded-xl bg-[#0D1017] hover:bg-white/10 text-white transition cursor-pointer border border-white/[0.08] flex items-center justify-center active:scale-95"
                  title={tx("Editar Plan", "Edit Plan")}
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDuplicate(selectedMacro)}
                  className="w-9 h-9 rounded-xl bg-[#0D1017] hover:bg-white/10 text-white transition cursor-pointer border border-white/[0.08] flex items-center justify-center active:scale-95"
                  title={tx("Duplicar", "Duplicate")}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>

            {/* Row 2: Centered 2-column action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleOpenSyncModal(selectedMacro)}
                className="h-10 px-2.5 rounded-xl bg-cyan-neon/15 hover:bg-cyan-neon/25 text-cyan-neon border border-cyan-neon/35 text-[12.5px] font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1.5 cursor-pointer transition whitespace-nowrap active:scale-95"
                title={tx("Sincronizar con el Calendario", "Sync with Calendar")}
              >
                <RefreshCw size={13} className={`shrink-0 ${isSyncing ? "animate-spin" : ""}`} />
                <span>{tx("Sincronizar", "Sync")}</span>
              </button>
              <button
                onClick={() => handleDelete(selectedMacro.id)}
                className="h-10 px-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black border border-white transition cursor-pointer flex items-center justify-center gap-1.5 text-[12.5px] font-black uppercase tracking-tight sm:tracking-wider whitespace-nowrap active:scale-95 shadow-sm"
                title={tx("Desvincular y eliminar este plan", "Unlink and delete this plan")}
              >
                <Unlink size={13} className="shrink-0" />
                <span>{tx("Desvincular Plan", "Unlink Plan")}</span>
              </button>
            </div>

            {/* Title / Dates details + Real Team Volume Progress */}
            {(() => {
              const detailRealVolume = computeMacrocycleArrows(selectedMacro);
              const detailPct =
                selectedMacro.volumeGoal > 0
                  ? Math.min(100, Math.round((detailRealVolume / selectedMacro.volumeGoal) * 100))
                  : 0;
              return (
                <div className="flex flex-col gap-3 pt-1 border-t border-white/[0.06]">
                  <div className="flex flex-col items-center text-center gap-1 py-1">
                    <h2 className="text-[21.5px] sm:text-[23px] font-black text-white leading-tight uppercase tracking-wide">
                      {selectedMacro.name}
                    </h2>
                    <p className="text-xs text-white/80 flex items-center justify-center gap-1.5 tabular-nums font-semibold">
                      <Calendar size={12} className="text-cyan-neon shrink-0" />
                      <span>
                        {selectedMacro.startDate} — {selectedMacro.endDate}
                      </span>
                    </p>
                  </div>
                  <div className="bg-neutral-900/40 border border-white/10 rounded-2xl p-3.5 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-white font-bold">
                        {tx("Volumen Acumulado del Ciclo", "Cycle Accumulated Volume")}
                      </span>
                      <span className="text-cyan-neon font-black tabular-nums">
                        {detailRealVolume.toLocaleString()} /{" "}
                        {selectedMacro.volumeGoal.toLocaleString()} {t("arrowsLabel")} ({detailPct}
                        %)
                      </span>
                    </div>
                    <div className="w-full bg-neutral-950 h-2 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-cyan-neon"
                        style={{ width: `${detailPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Chronogram timeline visualization */}
            <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 shadow-xl flex flex-col gap-3.5">
              <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                {tx("Línea de Tiempo del Ciclo", "Cycle Timeline")}
              </span>

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
                      className="h-full border-e border-black/35 hover:brightness-110 transition relative group cursor-help"
                      title={`${phase.name}: ${phase.startDate} — ${phase.endDate}`}
                    />
                  );
                })}
              </div>

              {/* Phases list */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                {selectedMacro.phases.map((phase) => {
                  const today = getLocalISODate();
                  const isActive = today >= phase.startDate && today <= phase.endDate;

                  return (
                    <div
                      key={phase.id}
                      className={`p-3.5 rounded-2xl border flex flex-col gap-2 relative overflow-hidden ${
                        isActive
                          ? "bg-neutral-950/80 border-white/20"
                          : "bg-neutral-950/20 border-white/5"
                      }`}
                    >
                      {isActive && (
                        <div
                          style={{ backgroundColor: phase.color }}
                          className="absolute start-0 top-0 bottom-0 w-[3px]"
                        />
                      )}

                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span
                            style={{ backgroundColor: phase.color }}
                            className="h-2 w-2 rounded-full"
                          />
                          {phase.name}
                        </span>
                        {isActive && (
                          <span className="text-[9.3px] font-black text-cyan-neon bg-cyan-brand/20 px-2 py-0.5 rounded-full border border-cyan-neon/20">
                            ● {tx("Etapa Activa", "Active Stage")}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11.6px] bg-neutral-900/30 p-2 rounded-xl border border-white/[0.02] tabular-nums">
                        <div>
                          <span className="text-white block uppercase font-bold text-[9.3px]">
                            {tx("Sesiones/Semana", "Sessions/Week")}
                          </span>
                          <span className="text-white font-medium">
                            {phase.weeklySessionGoal} {tx("sesiones", "sessions")}
                          </span>
                        </div>
                        <div>
                          <span className="text-white block uppercase font-bold text-[9.3px]">
                            {tx("Flechas/Semana", "Arrows/Week")}
                          </span>
                          <span className="text-white font-medium">
                            {phase.weeklyArrowGoal} {t("arrowsLabel")}
                          </span>
                        </div>
                      </div>

                      {phase.notes && (
                        <p className="text-[11.6px] text-white leading-relaxed italic border-t border-white/[0.03] pt-1.5 mt-0.5 select-text">
                          &ldquo;{phase.notes}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Athlete progress table */}
            {(() => {
              const displayedAthletes =
                selectedMacro.assignmentType !== "club" &&
                selectedMacro.assignedAthleteIds &&
                selectedMacro.assignedAthleteIds.length > 0
                  ? roster.filter((a) => selectedMacro.assignedAthleteIds.includes(a.uid))
                  : roster;

              return (
                <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 shadow-xl flex flex-col gap-3">
                  <span className="text-[10.5px] text-white uppercase font-black tracking-widest flex items-center gap-1">
                    <Users size={12} className="text-cyan-neon" />
                    <span>
                      {tx(
                        `Progreso de Atletas Asignados (${displayedAthletes.length})`,
                        `Assigned Athletes Progress (${displayedAthletes.length})`
                      )}
                    </span>
                  </span>

                  {displayedAthletes.length === 0 ? (
                    <div className="text-center py-6 text-xs text-white">
                      {tx(
                        "No hay arqueros asignados a este plan.",
                        "No archers assigned to this plan."
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 mt-1">
                      {displayedAthletes.map((athlete) => {
                        const startMs = selectedMacro.startDate
                          ? new Date(selectedMacro.startDate + "T00:00:00").getTime()
                          : 0;
                        const endMs = selectedMacro.endDate
                          ? new Date(selectedMacro.endDate + "T23:59:59").getTime()
                          : Number.MAX_SAFE_INTEGER;
                        const athleteProgress = allSessions
                          .filter(
                            (s) =>
                              (s.userId === athlete.uid || s.userUid === athlete.uid) &&
                              !s.isDraft &&
                              !s.isDuel &&
                              s.deletedByArcher !== true &&
                              !isFictitiousSession(s) &&
                              s.timestamp >= startMs &&
                              s.timestamp <= endMs
                          )
                          .reduce((sum, s) => sum + getSessionArrows(s), 0);
                        const pct =
                          selectedMacro.volumeGoal > 0
                            ? Math.min(
                                100,
                                Math.round((athleteProgress / selectedMacro.volumeGoal) * 100)
                              )
                            : 0;

                        return (
                          <div
                            key={athlete.uid}
                            className="flex justify-between items-center gap-2 bg-neutral-950/40 p-3 rounded-2xl border border-white/5"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center font-bold text-xs text-white shrink-0">
                                {athlete.fullName[0]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-bold text-white block truncate">
                                  {athlete.fullName}
                                </span>
                                <span className="text-[10.5px] text-white uppercase block truncate">
                                  {athlete.bowConfig?.type || ""}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                              <div className="text-end tabular-nums">
                                <span className="text-xs font-black text-white whitespace-nowrap">
                                  {athleteProgress.toLocaleString()} {t("arrowsLabel")}
                                </span>
                                <span className="text-[10.5px] text-cyan-neon block font-bold mt-0.5 whitespace-nowrap">
                                  {pct}% {tx("de su meta", "of goal")}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleUnlinkAthlete(selectedMacro, athlete)}
                                className="p-2 rounded-xl bg-white hover:bg-neutral-200 text-black border border-white active:scale-95 transition cursor-pointer shrink-0"
                                title={tx(
                                  `Desvincular a ${athlete.fullName} de este plan`,
                                  `Unlink ${athlete.fullName} from this plan`
                                )}
                              >
                                <UserMinus size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
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
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-4 sm:p-6 w-full max-w-lg shadow-2xl z-10 flex flex-col gap-4 max-h-[90dvh] overflow-y-auto overscroll-contain"
            >
              {/* Header */}
              <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    {editingId ? tx("Editar Ciclo", "Edit Cycle") : tx("Ciclo", "Cycle")}
                  </h3>
                  <span className="text-[10.5px] text-cyan-neon font-black uppercase tracking-widest block mt-0.5 tabular-nums">
                    {tx(`Paso ${step} de 4`, `Step ${step} of 4`)}
                  </span>
                </div>
                <button
                  onClick={() => setShowCreateModal(false)}
                  aria-label={t("cancel")}
                  className="p-1 rounded-full text-white hover:text-white hover:bg-white/5 transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* STEP 1: GENERAL INFO */}
              {step === 1 && (
                <div className="flex flex-col gap-3.5 py-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                      {tx("Nombre del Plan", "Plan Name")}
                    </label>
                    <input
                      type="text"
                      placeholder={tx("Ej. Plan de Temporada", "e.g. Season Plan")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon min-w-0 w-full"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                        {tx("Fecha Inicio", "Start Date")}
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-2 text-white text-xs tabular-nums outline-none focus:border-cyan-neon min-w-0 w-full"
                      />
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                        {tx("Fecha Fin", "End Date")}
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-2 text-white text-xs tabular-nums outline-none focus:border-cyan-neon min-w-0 w-full"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                      {tx("Meta de Volumen Total (Flechas)", "Total Arrow Volume Goal")}
                    </label>
                    <input
                      type="number"
                      value={volumeGoal}
                      onChange={(e) => setVolumeGoal(Number(e.target.value))}
                      className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-xs tabular-nums outline-none focus:border-cyan-neon min-w-0 w-full"
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: ETAPAS timeline builder */}
              {step === 2 && (
                <div className="flex flex-col gap-3 py-2 max-h-[50vh] overflow-y-auto pe-1">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                      {tx("Etapas del Cronograma", "Timeline Stages")}
                    </span>
                    <button
                      type="button"
                      onClick={handleAddPhase}
                      className="text-[10.5px] bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/20 px-2.5 py-1 rounded-lg font-bold cursor-pointer shrink-0"
                    >
                      {tx("+ Agregar Etapa", "+ Add Stage")}
                    </button>
                  </div>

                  <div className="h-2 w-full rounded bg-neutral-950 overflow-hidden flex border border-white/5 mb-1">
                    {phases.map((p) => (
                      <div
                        key={p.id}
                        style={{ backgroundColor: p.color, width: `${100 / phases.length}%` }}
                        className="h-full border-e border-black/25"
                      />
                    ))}
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {phases.map((phase, idx) => (
                      <div
                        key={phase.id}
                        className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3.5 flex flex-col gap-3 relative"
                      >
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[10.5px] font-black text-white uppercase tabular-nums">
                            {tx(`Etapa #${idx + 1}`, `Stage #${idx + 1}`)}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "up")}
                              disabled={idx === 0}
                              className="p-1 rounded bg-white/5 text-white hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                              title={tx("Subir etapa", "Move stage up")}
                            >
                              <ArrowUp size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMovePhase(idx, "down")}
                              disabled={idx === phases.length - 1}
                              className="p-1 rounded bg-white/5 text-white hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                              title={tx("Bajar etapa", "Move stage down")}
                            >
                              <ArrowDown size={11} />
                            </button>
                            {phases.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemovePhase(phase.id)}
                                className="p-1.5 rounded bg-white hover:bg-neutral-200 text-black ms-1.5 cursor-pointer"
                                title={tx("Eliminar etapa", "Remove stage")}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-[9.3px] text-white uppercase font-bold">
                            {tx("Nombre de la Etapa", "Stage Name")}
                          </label>
                          <input
                            type="text"
                            placeholder={tx(
                              "Ej. Acondicionamiento, Volumen, Torneo...",
                              "e.g. Conditioning, Volume, Competition..."
                            )}
                            value={phase.name}
                            onChange={(e) =>
                              handleUpdatePhaseField(phase.id, "name", e.target.value)
                            }
                            className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon min-w-0 w-full"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9.3px] text-white uppercase font-bold">
                            {tx("Color Identificador", "Stage Color")}
                          </label>
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

                        <div className="grid grid-cols-2 gap-2 mt-0.5">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <label className="text-[9.3px] text-white uppercase font-bold">
                              {tx("Fecha Inicio", "Start Date")}
                            </label>
                            <input
                              type="date"
                              value={phase.startDate}
                              onChange={(e) =>
                                handleUpdatePhaseField(phase.id, "startDate", e.target.value)
                              }
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11.6px] tabular-nums outline-none min-w-0 w-full"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <label className="text-[9.3px] text-white uppercase font-bold">
                              {tx("Fecha Fin", "End Date")}
                            </label>
                            <input
                              type="date"
                              value={phase.endDate}
                              onChange={(e) =>
                                handleUpdatePhaseField(phase.id, "endDate", e.target.value)
                              }
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11.6px] tabular-nums outline-none min-w-0 w-full"
                            />
                          </div>

                          <div className="flex flex-col gap-0.5 min-w-0">
                            <label className="text-[9.3px] text-white uppercase font-bold">
                              {tx("Sesiones / Semana", "Sessions / Week")}
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={phase.weeklySessionGoal}
                              onChange={(e) =>
                                handleUpdatePhaseField(
                                  phase.id,
                                  "weeklySessionGoal",
                                  Number(e.target.value)
                                )
                              }
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11.6px] tabular-nums outline-none min-w-0 w-full"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <label className="text-[9.3px] text-white uppercase font-bold">
                              {tx("Flechas / Semana", "Arrows / Week")}
                            </label>
                            <input
                              type="number"
                              value={phase.weeklyArrowGoal}
                              onChange={(e) =>
                                handleUpdatePhaseField(
                                  phase.id,
                                  "weeklyArrowGoal",
                                  Number(e.target.value)
                                )
                              }
                              className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11.6px] tabular-nums outline-none min-w-0 w-full"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9.3px] text-white uppercase font-bold">
                            {tx("Notas / Indicaciones para Arqueros", "Notes for Archers")}
                          </label>
                          <textarea
                            value={phase.notes}
                            onChange={(e) =>
                              handleUpdatePhaseField(phase.id, "notes", e.target.value)
                            }
                            rows={2}
                            placeholder={tx(
                              "Indicaciones para los arqueros en esta etapa...",
                              "Instructions for archers during this stage..."
                            )}
                            className="bg-neutral-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11.6px] outline-none resize-none min-w-0 w-full"
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
                    <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                      {tx("Tipo de Asignación", "Assignment Type")}
                    </label>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {[
                        { id: "club", label: tx("Todo el Club", "Entire Club"), icon: Layout },
                        { id: "group", label: tx("Grupo", "Group"), icon: Users },
                        { id: "individual", label: tx("Individual", "Individual"), icon: User }
                      ].map((card) => {
                        const CardIcon = card.icon;
                        const isSel = assignmentType === card.id;
                        return (
                          <div
                            key={card.id}
                            onClick={() => setAssignmentType(card.id as any)}
                            className={`border rounded-2xl py-3 px-1.5 sm:px-2 min-w-0 cursor-pointer flex flex-col items-center justify-center text-center transition ${
                              isSel
                                ? "bg-cyan-brand/20 border-cyan-neon text-white"
                                : "bg-neutral-900/40 border-white/10 hover:border-white/20 text-white"
                            }`}
                          >
                            <CardIcon
                              size={20}
                              className={isSel ? "text-cyan-neon shrink-0" : "text-white shrink-0"}
                            />
                            <span className="text-[11.5px] sm:text-[12px] font-black uppercase tracking-tight sm:tracking-wider block mt-2 leading-tight">
                              {card.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {assignmentType === "group" && (
                    <div className="flex flex-col gap-1 mt-1 animate-fadeIn">
                      <label className="text-[10.5px] text-white uppercase font-bold">
                        {tx("Nombre del Grupo", "Group Name")}
                      </label>
                      <input
                        type="text"
                        placeholder={tx("Ej. Grupo A, Juvenil...", "e.g. Group A, Youth...")}
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none min-w-0 w-full"
                      />
                    </div>
                  )}

                  {assignmentType !== "club" && (
                    <div className="flex flex-col gap-2 animate-fadeIn mt-1 max-h-[30vh] overflow-y-auto pe-1">
                      <label className="text-[10.5px] text-white uppercase font-black tracking-widest tabular-nums">
                        {tx(
                          `Seleccionar Atletas (${assignedAthleteIds.length})`,
                          `Select Athletes (${assignedAthleteIds.length})`
                        )}
                      </label>
                      <div className="flex flex-col gap-1.5">
                        {roster.map((athlete) => {
                          const isSel = assignedAthleteIds.includes(athlete.uid);
                          return (
                            <div
                              key={athlete.uid}
                              onClick={() => handleToggleAthleteSelection(athlete.uid)}
                              className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border cursor-pointer transition ${
                                isSel
                                  ? "bg-cyan-brand/10 border-cyan-neon text-white"
                                  : "bg-neutral-950/60 border-white/5 text-white"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="h-6 w-6 rounded bg-white/5 border border-white/5 flex items-center justify-center font-bold text-[11.6px] text-white shrink-0">
                                  {athlete.fullName[0]}
                                </div>
                                <span className="text-xs font-bold truncate">
                                  {athlete.fullName}
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isSel}
                                readOnly
                                className="w-3.5 h-3.5 accent-cyan-neon shrink-0"
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
                  <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    {tx("Resumen de Planificación", "Planning Summary")}
                  </span>

                  <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-4 flex flex-col gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10.5px] text-white uppercase font-bold">
                        {tx("Nombre del Plan", "Plan Name")}
                      </span>
                      <span className="text-white font-extrabold text-sm uppercase">{name}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10.5px] text-white uppercase font-bold block">
                          {tx("Fechas", "Dates")}
                        </span>
                        <span className="text-white font-medium tabular-nums">
                          {startDate} — {endDate}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10.5px] text-white uppercase font-bold block">
                          {tx("Meta de Flechas", "Arrow Goal")}
                        </span>
                        <span className="text-cyan-neon font-black tabular-nums">
                          {volumeGoal.toLocaleString()} {t("arrowsLabel")}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col border-t border-white/5 pt-2.5">
                      <span className="text-[10.5px] text-white uppercase font-bold tabular-nums">
                        {tx(
                          `Etapas Configuradas (${phases.length})`,
                          `Configured Stages (${phases.length})`
                        )}
                      </span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {phases.map((p) => (
                          <span
                            key={p.id}
                            style={{
                              borderColor: `${p.color}30`,
                              color: p.color,
                              backgroundColor: `${p.color}15`
                            }}
                            className="text-[10.5px] font-bold px-2 py-0.5 border rounded-full uppercase"
                          >
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col border-t border-white/5 pt-2.5">
                      <span className="text-[10.5px] text-white uppercase font-bold">
                        {tx("Asignación", "Assignment")}
                      </span>
                      <span className="text-white font-medium mt-0.5 tabular-nums">
                        {assignmentType === "club"
                          ? tx("Todo el Club", "Entire Club")
                          : assignmentType === "group"
                          ? tx(
                              `Grupo: ${groupName} (${assignedAthleteIds.length} atletas)`,
                              `Group: ${groupName} (${assignedAthleteIds.length} athletes)`
                            )
                          : tx(
                              `Individual (${assignedAthleteIds.length} atletas)`,
                              `Individual (${assignedAthleteIds.length} athletes)`
                            )}
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
                    <ArrowLeft size={14} className="rtl:rotate-180" />
                    <span>{t("prev")}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-2.5 rounded-2xl bg-transparent border border-white/5 text-white hover:text-white font-bold text-xs uppercase cursor-pointer"
                  >
                    {t("cancel")}
                  </button>
                )}

                {step < 4 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="flex-1 py-2.5 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span>{t("next")}</span>
                    <ChevronRight size={14} className="rtl:rotate-180" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveMacrocycle}
                    className="flex-1 py-2.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Check size={14} />
                    <span>
                      {editingId ? t("save") : tx("Crear Ciclo", "Create Cycle")}
                    </span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Month Sync Modal */}
      <AnimatePresence>
        {showSyncModal &&
          macroToSync &&
          (() => {
            const monthNames = Array.from({ length: 12 }, (_, idx) => {
              const raw = formatRegionalDate(
                new Date(syncYear, idx, 15, 12, 0, 0),
                language,
                {
                  month: "long"
                }
              );
              return raw && raw !== "—"
                ? raw.charAt(0).toUpperCase() + raw.slice(1)
                : `${tx("Mes", "Month")} ${idx + 1}`;
            });
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                <div className="absolute inset-0" onClick={() => setShowSyncModal(false)} />
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-4 sm:p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4 text-start max-h-[90dvh] overflow-y-auto overscroll-contain"
                >
                  <div className="flex justify-between items-center gap-2 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-8 h-8 rounded-xl bg-yellow-gold/15 border border-yellow-gold/30 text-yellow-gold flex items-center justify-center shadow-sm shrink-0">
                        <RefreshCw size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">
                          {tx("Sincronizar Calendario", "Sync Calendar")}
                        </h3>
                        <span className="text-[10.5px] text-white block truncate">
                          Plan: <strong className="text-white">{macroToSync.name}</strong>
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowSyncModal(false)}
                      aria-label={t("cancel")}
                      className="p-1 rounded-full text-white hover:text-white shrink-0 cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 text-xs">
                    <p className="text-[12.8px] text-white leading-relaxed">
                      {tx(
                        "Sincroniza automáticamente este ciclo con el calendario de la app. Los arqueros podrán entrar a cada día y ver las metas de flechas y el trabajo técnico asignado.",
                        "Automatically sync this cycle onto the app calendar. Archers can tap each day to view their assigned arrow goals and technical tasks."
                      )}
                    </p>

                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className="flex flex-col gap-1 min-w-0">
                        <label className="text-[10.5px] text-white uppercase font-bold">
                          {tx("Mes a Sincronizar", "Month to Sync")}
                        </label>
                        <select
                          value={syncMonth}
                          onChange={(e) => setSyncMonth(Number(e.target.value))}
                          className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs outline-none focus:border-cyan-neon min-w-0 w-full"
                        >
                          {monthNames.map((m, idx) => (
                            <option key={idx} value={idx}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1 min-w-0">
                        <label className="text-[10.5px] text-white uppercase font-bold">
                          {tx("Año", "Year")}
                        </label>
                        <input
                          type="number"
                          value={syncYear}
                          onChange={(e) => setSyncYear(Number(e.target.value))}
                          className="bg-neutral-900 border border-white/10 rounded-xl px-2.5 py-1.5 text-white text-xs tabular-nums outline-none focus:border-cyan-neon min-w-0 w-full"
                        />
                      </div>
                    </div>

                    {/* Selector de Destinatario */}
                    <div className="flex flex-col gap-2 bg-neutral-900/60 p-3 rounded-2xl border border-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] text-white uppercase font-black tracking-widest flex items-center gap-1.5">
                          <Users size={12} className="text-cyan-neon shrink-0" />
                          <span>{tx("Sincronizar con:", "Sync with:")}</span>
                        </span>
                        <span className="text-[10.5px] text-cyan-neon tabular-nums font-bold shrink-0">
                          {syncTargetType === "all"
                            ? tx("Todo el Club", "Entire Club")
                            : `${syncSelectedAthleteIds.length} ${
                                syncSelectedAthleteIds.length === 1
                                  ? t("roleAthlete")
                                  : tx("Alumnos", "Athletes")
                              }`}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSyncTargetType("selected");
                            if (syncSelectedAthleteIds.length === 0 && roster.length > 0) {
                              setSyncSelectedAthleteIds([roster[0].uid]);
                            }
                          }}
                          className={`py-2 px-2 rounded-xl text-[12px] sm:text-[13px] leading-tight text-center font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1 transition border cursor-pointer ${
                            syncTargetType === "selected"
                              ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                              : "bg-neutral-950/60 border-white/10 text-white hover:text-white"
                          }`}
                        >
                          <User size={12} className="shrink-0" />
                          <span>{tx("Escoger 1 o Varios", "Pick 1 or More")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSyncTargetType("all")}
                          className={`py-2 px-2 rounded-xl text-[12px] sm:text-[13px] leading-tight text-center font-black uppercase tracking-tight sm:tracking-wider flex items-center justify-center gap-1 transition border cursor-pointer ${
                            syncTargetType === "all"
                              ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                              : "bg-neutral-950/60 border-white/10 text-white hover:text-white"
                          }`}
                        >
                          <Users size={12} className="shrink-0" />
                          <span>{tx("Todos los Alumnos", "All Athletes")}</span>
                        </button>
                      </div>

                      {syncTargetType === "selected" && (
                        <div className="flex flex-col gap-1.5 pt-1 animate-fadeIn">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10.5px] text-white uppercase font-bold">
                              {tx("Marca 1 o varios alumnos:", "Select 1 or more athletes:")}
                            </label>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setSyncSelectedAthleteIds(roster.map((r) => r.uid))
                                }
                                className="text-[9.5px] font-black uppercase text-cyan-neon hover:underline cursor-pointer"
                              >
                                {t("filterAll")}
                              </button>
                              <span className="text-white">·</span>
                              <button
                                type="button"
                                onClick={() => setSyncSelectedAthleteIds([])}
                                className="text-[9.5px] font-black uppercase text-white hover:text-white cursor-pointer"
                              >
                                {tx("Limpiar", "Clear")}
                              </button>
                            </div>
                          </div>

                          <div className="max-h-36 overflow-y-auto flex flex-col gap-1 pe-1">
                            {roster.map((ath) => {
                              const isChecked = syncSelectedAthleteIds.includes(ath.uid);
                              return (
                                <button
                                  key={ath.uid}
                                  type="button"
                                  onClick={() => {
                                    setSyncSelectedAthleteIds((prev) =>
                                      prev.includes(ath.uid)
                                        ? prev.filter((id) => id !== ath.uid)
                                        : [...prev, ath.uid]
                                    );
                                  }}
                                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-start transition cursor-pointer ${
                                    isChecked
                                      ? "bg-cyan-neon/15 border-cyan-neon/50 text-white"
                                      : "bg-neutral-950/80 border-white/10 text-white hover:border-white/25"
                                  }`}
                                >
                                  <span className="text-xs font-bold truncate min-w-0 flex-1">
                                    {ath.fullName || ath.email} ·{" "}
                                    {ath.bowConfig?.type || t("roleAthlete")}
                                  </span>
                                  <div
                                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                                      isChecked
                                        ? "bg-cyan-neon border-cyan-neon text-black"
                                        : "border-white/30 bg-transparent"
                                    }`}
                                  >
                                    {isChecked && <Check size={11} className="stroke-[3]" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Phases Preview */}
                    <div className="bg-neutral-950/60 p-3 rounded-2xl border border-white/5 flex flex-col gap-2 mt-1">
                      <span className="text-[10.5px] text-white uppercase font-bold">
                        {tx("Etapas que se asignarán", "Stages to Assign")}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {macroToSync.phases?.map((p) => (
                          <span
                            key={p.id}
                            style={{
                              color: p.color,
                              borderColor: `${p.color}30`,
                              backgroundColor: `${p.color}15`
                            }}
                            className="text-[10.5px] font-bold px-2 py-0.5 border rounded-full uppercase tabular-nums"
                          >
                            {p.name} ({p.weeklyArrowGoal} {tx("flechas/sem", "arr/wk")})
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={handleExecuteSync}
                      className="w-full mt-2 py-3 px-3 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition disabled:opacity-40 min-w-0"
                    >
                      <RefreshCw size={14} className="shrink-0" />
                      <span className="truncate">
                        {isSyncing
                          ? t("syncing")
                          : syncTargetType === "selected"
                          ? syncSelectedAthleteIds.length === 1
                            ? tx(
                                `Sincronizar con ${
                                  roster.find((r) => r.uid === syncSelectedAthleteIds[0])
                                    ?.fullName || "Alumno"
                                }`,
                                `Sync with ${
                                  roster.find((r) => r.uid === syncSelectedAthleteIds[0])
                                    ?.fullName || "Athlete"
                                }`
                              )
                            : tx(
                                `Sincronizar con ${syncSelectedAthleteIds.length} Alumnos`,
                                `Sync with ${syncSelectedAthleteIds.length} Athletes`
                              )
                          : tx(
                              `Sincronizar con Todos (${monthNames[syncMonth]} ${syncYear})`,
                              `Sync with All (${monthNames[syncMonth]} ${syncYear})`
                            )}
                      </span>
                    </button>
                  </div>
                </motion.div>
              </div>
            );
          })()}
      </AnimatePresence>

      {/* Spreadsheet Plan Importer Modal (lazy-loaded on demand) */}
      {showImportModal && (
        <PlanImporterModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          user={user}
          coachViewMode={true}
          athletes={roster}
          onSuccess={handleImportSuccess}
          titleOverride={t("coachDashboard")}
        />
      )}
    </div>
  );
}
