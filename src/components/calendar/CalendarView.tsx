"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { 
  getLocalSessions, 
  getLocalEvents, 
  saveLocalEvent, 
  deleteLocalEvent, 
  generateResilientId, 
  addToSyncQueue, 
  CalendarEvent,
  getLocalMacrocycles,
  saveLocalMacrocycle,
  deleteLocalMacrocycle,
  getLocalSetting
} from "@/lib/db/indexedDB";
import { Macrocycle, MacrocyclePhase, PHASE_CONFIG } from "@/lib/db/macrocycleTypes";
import { syncCycleToMonthCalendar, getRecommendedFocusPoints, saveDailyEntriesToCalendar, syncEntireMacrocycleToCalendar, unlinkAndPurgePlan, SyncCycleSummary } from "@/lib/cycleCalendarSync";
import PlanImporterModal from "@/components/planning/PlanImporterModal";
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  Award, 
  Plus, 
  Trash2, 
  Edit, 
  Lock, 
  X, 
  Clock,
  Target,
  CheckCircle2,
  Shield,
  Flame,
  ArrowRight,
  Info,
  RefreshCw,
  Edit2,
  FileSpreadsheet,
  UploadCloud,
  ClipboardPaste,
  Download,
  AlertCircle,
  Unlink,
  UserMinus,
  User,
  Users
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CalendarViewProps {
  user: UserProfile;
  onBack: () => void;
  onNavigate?: (screen: any) => void;
  coachViewMode?: boolean;
}

export default function CalendarView({ user, onBack, onNavigate, coachViewMode = false }: CalendarViewProps) {
  const { language } = useLanguage();
  const isCoach = coachViewMode || user.role === "coach";

  const [sessions, setSessions] = useState<any[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendanceRate, setAttendanceRate] = useState(0);
  const [macrocycles, setMacrocycles] = useState<Macrocycle[]>([]);
  const [selectedMacrocycleId, setSelectedMacrocycleId] = useState<string>("ALL");

  // Day Selection Modal (Athlete & Coach Daily Assignment Inspection)
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);

  // Cycle Sync Modal for Coach
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncMacroId, setSyncMacroId] = useState<string>("");
  const [isSyncing, setIsSyncing] = useState(false);

  // Edit / Add Daily Assignment Modal for Coach
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [assignmentEventId, setAssignmentEventId] = useState<string | null>(null);
  const [assignTitle, setAssignTitle] = useState("");
  const [assignTargetArrows, setAssignTargetArrows] = useState(100);
  const [assignFocusPoint, setAssignFocusPoint] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignDate, setAssignDate] = useState("");

  // Regular Event Modal State (Add / Edit)
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<"competition" | "training" | "meeting" | "other">("training");

  // Direct Excel / Google Sheets Importer states in Calendar
  const [showImportModal, setShowImportModal] = useState(false);
  const handleOpenImportModal = () => setShowImportModal(true);

  const handleImportSuccess = async ({ macrocycle, summary }: { macrocycle: Macrocycle; summary: SyncCycleSummary }) => {
    const updatedMacros = await getLocalMacrocycles();
    setMacrocycles(updatedMacros);
    const updatedEvents = await getLocalEvents();
    setEvents(updatedEvents);

    const firstDateObj = new Date(macrocycle.startDate + "T12:00:00");
    if (!isNaN(firstDateObj.getTime())) {
      setCurrentDate(new Date(firstDateObj.getFullYear(), firstDateObj.getMonth(), 1));
    }
    setSelectedMacrocycleId(macrocycle.id);

    const assignedIds = macrocycle.assignedAthleteIds || [];
    const recipientText = isCoach
      ? assignedIds.length > 0 && macrocycle.assignmentType !== "club"
        ? assignedIds.map((id) => roster.find((r) => r.uid === id)?.fullName || id).join(", ")
        : "Todos los alumnos del Club"
      : "Mi Calendario Personal";

    alert(
      `¡Plan "${macrocycle.name}" Vinculado con Éxito al Calendario!\n\n` +
      `• Destinatario(s): ${recipientText}\n` +
      `• Días programados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
      `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
      `Toca cualquier fecha en el calendario para ver el detalle exacto de cada día.`
    );
  };

  // Unlink Plan states
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [macroToUnlink, setMacroToUnlink] = useState<Macrocycle | null>(null);
  const [unlinkTargetAthleteId, setUnlinkTargetAthleteId] = useState<string>("ALL");
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Coach Roster & Athlete Filter states
  const [roster, setRoster] = useState<UserProfile[]>([]);
  const [selectedAthleteFilter, setSelectedAthleteFilter] = useState<string>("ALL");

  const handleRequestUnlink = (macro: Macrocycle | null) => {
    if (!macro) return;
    setMacroToUnlink(macro);
    setUnlinkTargetAthleteId("ALL");
    setShowUnlinkModal(true);
  };

  const handleConfirmUnlink = async () => {
    if (!macroToUnlink) return;
    setIsUnlinking(true);
    try {
      const targetAthlete = unlinkTargetAthleteId !== "ALL" ? unlinkTargetAthleteId : undefined;
      const res = await unlinkAndPurgePlan(macroToUnlink.id, targetAthlete);

      const updatedMacros = await getLocalMacrocycles();
      setMacrocycles(updatedMacros);
      const updatedEvents = await getLocalEvents();
      setEvents(updatedEvents);

      if (selectedMacrocycleId === macroToUnlink.id) {
        setSelectedMacrocycleId("ALL");
      }

      setShowUnlinkModal(false);
      setShowDayModal(false);
      const planName = macroToUnlink.name;
      setMacroToUnlink(null);

      alert(
        targetAthlete 
          ? `Se ha desvinculado al alumno del plan "${planName}" y se retiraron sus tareas del calendario.`
          : `El plan "${planName}" ha sido desvinculado y se eliminaron ${res.deletedEventsCount} eventos del calendario.`
      );
    } catch (e) {
      console.error("Error unlinking plan:", e);
      alert("No se pudo desvincular el plan. Intenta de nuevo.");
    } finally {
      setIsUnlinking(false);
    }
  };


  // Load Sessions, Events and Macrocycles on Mount & on db change
  useEffect(() => {
    async function loadData() {
      const sessionList = await getLocalSessions();
      setSessions(sessionList);

      if (isCoach) {
        const activeClubId = user.clubId || "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const athletes = (allUsers || []).filter((u) => (u.clubId === activeClubId || (user.clubId && u.clubId === user.clubId) || !u.clubId) && u.role === "archer");
        setRoster(athletes);
      }
      
      const eventList = await getLocalEvents();
      const cleanEvents: CalendarEvent[] = [];
      for (const ev of eventList) {
        const fullDesc = `${ev.title || ""} ${ev.description || ""} ${ev.coachNotes || ""} ${ev.phaseName || ""}`.toLowerCase();
        const isBadEvent = ev.macrocycleId === "MAC-DEMO-1" ||
          fullDesc.includes("indoor 2026") ||
          fullDesc.includes("preparación indoor") ||
          fullDesc.includes("preparacion indoor") ||
          fullDesc.includes("offline mode active") ||
          fullDesc.includes("connect to the internet");

        if (isBadEvent) {
          await deleteLocalEvent(ev.id);
        } else {
          // Limpiar cualquier texto de enfoque o notas inventado previamente por IA/plantilla
          let changed = false;
          if (ev.focusPoints && ev.focusPoints.length > 0) {
            const cleaned = ev.focusPoints.filter((pt) => {
              const ptl = pt.toLowerCase();
              return !(
                ptl.includes("ejecución técnica") ||
                ptl.includes("ejecucion tecnica") ||
                ptl.includes("postura de tiro") ||
                ptl.includes("ritmo y respiración") ||
                ptl.includes("ritmo y respiracion") ||
                ptl.includes("cumplimiento del objetivo asignado") ||
                ptl.includes("descanso neuromuscular") ||
                ptl.includes("estiramiento ligero") ||
                ptl.includes("consistencia técnica") ||
                ptl.includes("consistencia tecnica") ||
                ptl.includes("postura olímpica") ||
                ptl.includes("postura olimpica") ||
                ptl.includes("ritmo constante por flecha")
              );
            });
            if (cleaned.length !== ev.focusPoints.length) {
              ev.focusPoints = cleaned;
              changed = true;
            }
          }

          if (ev.coachNotes) {
            const cnl = ev.coachNotes.toLowerCase();
            if (
              cnl.includes("postura olímpica y ritmo constante") ||
              cnl.includes("postura olimpica y ritmo constante") ||
              cnl.includes("asimilar las cargas de tiro") ||
              (cnl.includes("cumplir las") && cnl.includes("flechas asignadas"))
            ) {
              ev.coachNotes = "";
              changed = true;
            }
          }

          if (ev.description) {
            const dsl = ev.description.toLowerCase();
            if (
              dsl.includes("asignación del entrenador para la etapa") ||
              dsl.includes("asignacion del entrenador para la etapa") ||
              dsl.includes("día de recuperación física y neuromuscular") ||
              dsl.includes("dia de recuperacion fisica y neuromuscular")
            ) {
              ev.description = "";
              changed = true;
            }
          }

          if (changed) {
            await saveLocalEvent(ev.id, ev);
          }
          cleanEvents.push(ev);
        }
      }
      setEvents(cleanEvents);

      const macroList = await getLocalMacrocycles();
      const cleanMacroList: Macrocycle[] = [];
      for (const mac of macroList) {
        const isIndoorDemo = mac.id === "MAC-DEMO-1" || 
          (mac.name || "").toLowerCase().includes("indoor 2026") ||
          (mac.name || "").toLowerCase().includes("preparación indoor") ||
          (mac.name || "").toLowerCase().includes("preparacion indoor") ||
          (mac.name || "").toLowerCase().includes("offline mode active") ||
          (mac.name || "").toLowerCase().includes("connect to the internet");
        if (isIndoorDemo) {
          await deleteLocalMacrocycle(mac.id);
        } else {
          cleanMacroList.push(mac);
        }
      }
      setMacrocycles(cleanMacroList);
      if (cleanMacroList.length > 0 && !syncMacroId) {
        setSyncMacroId(cleanMacroList[0].id);
      }
    }
    loadData();

    const handleDbChange = (e: any) => {
      const targetStores = ["sessions_local", "calendar_events", "macrocycles_local"];
      if (targetStores.includes(e.detail?.store)) {
        loadData();
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [syncMacroId]);

  const getPhaseOnDate = (dateStr: string) => {
    let filteredMacros = selectedMacrocycleId === "ALL" 
      ? macrocycles 
      : macrocycles.filter(m => m.id === selectedMacrocycleId);

    if (isCoach && selectedAthleteFilter !== "ALL") {
      filteredMacros = filteredMacros.filter((m) =>
        m.assignmentType === "club" ||
        !m.assignedAthleteIds ||
        m.assignedAthleteIds.length === 0 ||
        m.assignedAthleteIds.includes(selectedAthleteFilter)
      );
    } else if (!isCoach) {
      filteredMacros = filteredMacros.filter((m) =>
        m.assignmentType === "club" ||
        !m.assignedAthleteIds ||
        m.assignedAthleteIds.length === 0 ||
        m.assignedAthleteIds.includes(user.uid)
      );
    }

    for (const macro of filteredMacros) {
      const phase = macro.phases?.find((p: any) => dateStr >= p.startDate && dateStr <= p.endDate);
      if (phase) {
        return { phase, macroName: macro.name, macrocycle: macro };
      }
    }
    return null;
  };

  // Compute attendance stats based on current month sessions
  useEffect(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();

    const monthSessions = sessions.filter((s) => {
      const date = new Date(s.timestamp);
      return date.getFullYear() === y && date.getMonth() === m;
    });

    const uniqueDaysTrained = new Set(
      monthSessions.map((s) => new Date(s.timestamp).getDate())
    ).size;

    const targetSessions = 12;
    const rate = Math.min(100, Math.round((uniqueDaysTrained / targetSessions) * 100));
    setAttendanceRate(rate);
  }, [currentDate, sessions]);

  // Calendar calculations
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  // Start week on Sunday: 0 (Sun) through 6 (Sat)
  const startOffset = firstDayOfMonth;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const monthName = currentDate.toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
    month: "long",
    year: "numeric"
  });

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  // Filter events that belong to the user's club or were created by the user or are assigned to all club
  const visibleEvents = events.filter((e) => {
    // If filtering by specific macrocycle:
    if (selectedMacrocycleId !== "ALL" && e.macrocycleId && e.macrocycleId !== selectedMacrocycleId) {
      return false;
    }

    if (isCoach) {
      // Coach athlete filter:
      if (selectedAthleteFilter !== "ALL") {
        if (e.assignedAthleteIds && e.assignedAthleteIds.length > 0) {
          return e.assignedAthleteIds.includes(selectedAthleteFilter);
        }
        return Boolean(user.clubId && e.clubId === user.clubId);
      }

      if (user.clubId && e.clubId === user.clubId) return true;
      if (e.createdByUid === user.uid) return true;
      return !e.clubId;
    }

    // Archer (Student):
    if (e.createdByUid === user.uid) return true;
    if (e.assignedAthleteIds && e.assignedAthleteIds.length > 0) {
      return e.assignedAthleteIds.includes(user.uid);
    }
    if (user.clubId && e.clubId === user.clubId) return true;
    return !e.clubId; // global
  });

  // Filter visible events to show in list (current month)
  const monthEvents = visibleEvents.filter((e) => {
    const date = new Date(e.date + "T00:00:00");
    return date.getFullYear() === year && date.getMonth() === month;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Helper to check if a specific day has an training session registered
  const hasSessionOnDay = (day: number): boolean => {
    return sessions.some((s) => {
      const d = new Date(s.timestamp);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  };

  // Get sessions on a date string YYYY-MM-DD
  const getSessionsOnDate = (dateStr: string) => {
    return sessions.filter((s) => {
      const dStr = new Date(s.timestamp).toISOString().split("T")[0];
      return dStr === dateStr;
    });
  };

  // Calculate arrows shot on a date
  const getArrowsShotOnDate = (dateStr: string) => {
    const daySessions = getSessionsOnDate(dateStr);
    return daySessions.reduce((total, s) => {
      let count = 0;
      if (Array.isArray(s.ends)) {
        count = s.ends.reduce((sub: number, e: any) => sub + (e.arrows ? e.arrows.length : 0), 0);
      } else if (s.endsCount && s.arrowsPerEnd) {
        count = s.endsCount * s.arrowsPerEnd;
      } else if (s.arrowsCount) {
        count = s.arrowsCount;
      }
      return total + count;
    }, 0);
  };

  // Get events on a specific day
  const getEventsOnDay = (day: number): CalendarEvent[] => {
    const dayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return visibleEvents.filter((e) => e.date === dayStr);
  };

  // Render days array
  const cells = [];

  // Previous month filler cells
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      day: prevMonthDays - i,
      isCurrentMonth: false,
      hasSession: false,
      dayEvents: [] as CalendarEvent[]
    });
  }

  // Current month cells
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({
      day: i,
      isCurrentMonth: true,
      hasSession: hasSessionOnDay(i),
      dayEvents: getEventsOnDay(i)
    });
  }

  // Next month filler cells to complete 42 cells grid (6 weeks)
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    cells.push({
      day: i,
      isCurrentMonth: false,
      hasSession: false,
      dayEvents: [] as CalendarEvent[]
    });
  }

  const daysOfWeek = language === "es" 
    ? ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"]
    : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  // Helper to calculate countdown
  const getDaysRemaining = (eventDateStr: string): { text: string; colorClass: string; isPast: boolean } => {
    const evDate = new Date(eventDateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = evDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return { 
        text: language === "es" ? "Hoy" : "Today", 
        colorClass: "text-yellow-gold bg-yellow-gold/10 border-yellow-gold/25 shadow-sm", 
        isPast: false 
      };
    } else if (diffDays === 1) {
      return { 
        text: language === "es" ? "Mañana" : "Tomorrow", 
        colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-sm", 
        isPast: false 
      };
    } else if (diffDays > 1) {
      return { 
        text: language === "es" ? `En ${diffDays} días` : `In ${diffDays} days`, 
        colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20", 
        isPast: false 
      };
    } else if (diffDays === -1) {
      return { 
        text: language === "es" ? "Ayer" : "Yesterday", 
        colorClass: "text-white bg-neutral-900 border-neutral-800", 
        isPast: true 
      };
    } else {
      return { 
        text: language === "es" ? `Hace ${Math.abs(diffDays)} días` : `${Math.abs(diffDays)} days ago`, 
        colorClass: "text-white bg-neutral-900 border-neutral-800", 
        isPast: true 
      };
    }
  };

  const getEventBadgeColor = (type: string) => {
    switch (type) {
      case "competition":
        return "bg-red-rival/15 text-red-rival border-red-rival/20";
      case "training":
        return "bg-cyan-neon/15 text-cyan-neon border-cyan-neon/20";
      case "meeting":
        return "bg-yellow-gold/15 text-yellow-gold border-yellow-gold/25";
      default:
        return "bg-cyan-neon/15 text-cyan-neon border-cyan-neon/20";
    }
  };

  const getEventDotColor = (type: string) => {
    switch (type) {
      case "competition": return "bg-red-rival";
      case "training": return "bg-cyan-neon";
      case "meeting": return "bg-yellow-gold";
      default: return "bg-cyan-neon";
    }
  };

  // Day Cell Tap Handler -> Opens Day Detail Inspection Modal
  const handleDayClick = (dateStr: string) => {
    setSelectedDay(dateStr);
    setShowDayModal(true);
  };

  // Coach Sync Cycle to Calendar Handler
  const handleSyncCycleToMonth = async () => {
    const macro = macrocycles.find((m) => m.id === syncMacroId) || macrocycles[0];
    if (!macro) {
      alert("No hay ningún ciclo disponible para sincronizar.");
      return;
    }

    setIsSyncing(true);
    try {
      const summary = await syncCycleToMonthCalendar(macro, year, month, user);
      
      // Reload events
      const updatedEvents = await getLocalEvents();
      setEvents(updatedEvents);
      setShowSyncModal(false);

      alert(
        `¡Calendario Sincronizado con Éxito!\n\n` +
        `• Plan: ${summary.macrocycleName}\n` +
        `• Mes: ${summary.monthName} ${summary.year}\n` +
        `• Días planificados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
        `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
        `Tus arqueros ahora pueden entrar a cada día y ver exactamente lo que les asignaste.`
      );
    } catch (err) {
      console.error("Error syncing cycle:", err);
      alert("Hubo un error al sincronizar el ciclo con el calendario.");
    } finally {
      setIsSyncing(false);
    }
  };

  // Coach Edit or Create Daily Assignment
  const handleOpenEditAssignment = (event: CalendarEvent) => {
    setAssignmentEventId(event.id);
    setAssignDate(event.date);
    setAssignTitle(event.title);
    setAssignTargetArrows(event.targetArrows || 100);
    setAssignFocusPoint(event.focusPoints ? event.focusPoints.join(", ") : "");
    setAssignNotes(event.coachNotes || event.description || "");
    setShowAssignmentModal(true);
  };

  const handleOpenCreateAssignment = (dateStr: string, phaseInfo: any) => {
    setAssignmentEventId(null);
    setAssignDate(dateStr);
    const pName = phaseInfo?.phase?.name || "Entrenamiento";
    setAssignTitle(pName);
    const defaultArrows = phaseInfo?.phase 
      ? Math.round(phaseInfo.phase.weeklyArrowGoal / Math.max(1, phaseInfo.phase.weeklySessionGoal)) 
      : 100;
    setAssignTargetArrows(defaultArrows);
    setAssignFocusPoint("");
    setAssignNotes(phaseInfo?.phase?.notes || "");
    setShowAssignmentModal(true);
  };

  const handleSaveDailyAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignDate || !assignTitle.trim()) return;

    const eventId = assignmentEventId || `EVT-MAC-ASSIGN-${Date.now()}`;
    const focusArr = assignFocusPoint
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const activePhaseInfo = getPhaseOnDate(assignDate);

    const updatedAssignment: CalendarEvent = {
      id: eventId,
      title: assignTitle,
      date: assignDate,
      description: assignNotes,
      createdByRole: "coach",
      createdByName: user.fullName || "Coach Director",
      createdByUid: user.uid,
      clubId: user.clubId || undefined,
      type: "training",
      timestamp: Date.now(),
      macrocycleId: activePhaseInfo?.macrocycle?.id,
      phaseId: activePhaseInfo?.phase?.id,
      phaseName: activePhaseInfo?.phase?.name || "Entrenamiento",
      phaseType: activePhaseInfo?.phase?.type,
      phaseColor: activePhaseInfo?.phase?.color || "#00BFFF",
      targetArrows: assignTargetArrows,
      focusPoints: focusArr,
      coachNotes: assignNotes,
      isRestDay: assignTargetArrows === 0,
      isCompleted: false
    };

    await saveLocalEvent(eventId, updatedAssignment);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "calendar_events",
      operation: "UPDATE",
      payloadId: eventId,
      payload: updatedAssignment,
      timestamp: Date.now()
    });

    const refreshedEvents = await getLocalEvents();
    setEvents(refreshedEvents);
    setShowAssignmentModal(false);

    // If day modal is open, keep it updated
    if (selectedDay === assignDate) {
      setSelectedDay(assignDate);
    }

    alert("Asignación del día guardada y notificada a los arqueros.");
  };

  // Form handlers for regular events
  const handleOpenAdd = () => {
    setModalMode("add");
    setTitle("");
    setEventDate(selectedDay || new Date().toISOString().split("T")[0]);
    setDescription("");
    setEventType("training");
    setShowModal(true);
  };

  const handleOpenEdit = (event: CalendarEvent) => {
    setModalMode("edit");
    setEditingEventId(event.id);
    setTitle(event.title);
    setEventDate(event.date);
    setDescription(event.description || "");
    setEventType(event.type);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !eventDate) return;

    if (modalMode === "add") {
      const eventId = generateResilientId("EVT");
      const newEvent: CalendarEvent = {
        id: eventId,
        title,
        date: eventDate,
        description,
        type: eventType,
        createdByRole: isCoach ? "coach" : "archer",
        createdByName: user.fullName,
        createdByUid: user.uid,
        clubId: user.clubId || undefined,
        timestamp: Date.now()
      };

      await saveLocalEvent(eventId, newEvent);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "calendar_events",
        operation: "INSERT",
        payloadId: eventId,
        payload: newEvent,
        timestamp: Date.now()
      });

      setEvents((prev) => [...prev, newEvent]);
    } else if (modalMode === "edit" && editingEventId) {
      const existing = events.find(e => e.id === editingEventId);
      if (!existing) return;

      const updatedEvent: CalendarEvent = {
        ...existing,
        title,
        date: eventDate,
        description,
        type: eventType,
        timestamp: Date.now()
      };

      await saveLocalEvent(editingEventId, updatedEvent);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "calendar_events",
        operation: "UPDATE",
        payloadId: editingEventId,
        payload: updatedEvent,
        timestamp: Date.now()
      });

      setEvents((prev) => prev.map((e) => (e.id === editingEventId ? updatedEvent : e)));
    }

    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(language === "es" ? "¿Eliminar este evento?" : "Delete this event?")) return;

    await deleteLocalEvent(id);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "calendar_events",
      operation: "DELETE",
      payloadId: id,
      payload: {},
      timestamp: Date.now()
    });

    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="flex flex-col gap-4 py-4 min-h-full">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-[#0D1017] border border-white/[0.08] text-white hover:text-white flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-white text-[17.6px] sm:text-[19.8px] font-black uppercase tracking-wide truncate leading-tight">
                {language === "es" ? "Calendario" : "Calendar"}
              </h2>
              {isCoach && (
                <span className="text-[9.3px] bg-yellow-gold/15 text-yellow-gold font-black uppercase px-2 py-0.5 rounded-full border border-yellow-gold/30 shrink-0 whitespace-nowrap">
                  Coach
                </span>
              )}
            </div>
            <p className="text-[11.6px] text-white uppercase tracking-wider truncate">
              {language === "es" ? "Planificación y Tareas" : "Planning & Tasks"}
            </p>
          </div>
        </div>

        {/* Action buttons: Import Excel/Sheets + Sync Cycle (Coach) + Add Event */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleOpenImportModal}
            className="h-9 px-2.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-400 font-black text-[11.6px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition whitespace-nowrap"
            title="Importar Plan desde Excel o Google Sheets"
          >
            <FileSpreadsheet size={13} />
            <span className="hidden sm:inline">Importar Excel / Sheets</span>
            <span className="sm:hidden">Excel</span>
          </button>

          {isCoach && (
            <button
              onClick={() => setShowSyncModal(true)}
              className="h-9 px-2.5 rounded-xl bg-yellow-gold/15 hover:bg-yellow-gold/25 border border-yellow-gold/35 text-yellow-gold font-black text-[11.6px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition whitespace-nowrap"
              title="Sincronizar ciclo con el mes"
            >
              <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Sincronizar Ciclo</span>
              <span className="sm:hidden">Ciclo</span>
            </button>
          )}

          <button
            onClick={handleOpenAdd}
            className="w-9 h-9 rounded-xl bg-cyan-neon/15 hover:bg-cyan-neon/25 border border-cyan-neon/35 text-cyan-neon flex items-center justify-center cursor-pointer active:scale-95 transition shrink-0"
            title="Planificar Evento"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Month selection selector */}
      <div className="flex justify-between items-center bg-neutral-900/60 p-3.5 rounded-2xl border border-white/5">
        <button
          onClick={prevMonth}
          className="p-2 rounded-xl text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <span className="text-white font-extrabold text-base sm:text-lg capitalize block leading-tight">{monthName}</span>
          <span className="text-[12.8px] text-white mt-0.5 block">Toca cualquier día para ver las tareas</span>
        </div>
        <button
          onClick={nextMonth}
          className="p-2 rounded-xl text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Macrocycle Filter & Unlink Plan Action */}
      {(macrocycles.length > 0 || (isCoach && roster.length > 0)) && (
        <div className="flex items-center justify-between gap-2.5 px-1 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            {macrocycles.length > 0 && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-white uppercase font-black tracking-widest shrink-0">
                  {language === "es" ? "Plan:" : "Plan:"}
                </span>
                <select
                  value={selectedMacrocycleId}
                  onChange={(e) => setSelectedMacrocycleId(e.target.value)}
                  className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-1.5 text-white text-xs uppercase font-bold outline-none focus:border-cyan-neon max-w-[160px] sm:max-w-[200px] truncate cursor-pointer"
                >
                  <option value="ALL">
                    {language === "es" ? "Todos los Planes" : "All Plans"}
                  </option>
                  {macrocycles.map((mac) => (
                    <option key={mac.id} value={mac.id}>
                      {mac.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isCoach && roster.length > 0 && (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-cyan-neon uppercase font-black tracking-widest shrink-0 flex items-center gap-1">
                  <User size={12} />
                  <span>Alumno:</span>
                </span>
                <select
                  value={selectedAthleteFilter}
                  onChange={(e) => setSelectedAthleteFilter(e.target.value)}
                  className="bg-neutral-900 border border-cyan-neon/30 rounded-xl px-2.5 py-1.5 text-white text-xs font-bold outline-none focus:border-cyan-neon max-w-[160px] sm:max-w-[190px] truncate cursor-pointer"
                >
                  <option value="ALL">Todos los Alumnos</option>
                  {roster.map((ath) => (
                    <option key={ath.uid} value={ath.uid}>
                      {ath.fullName || ath.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Botón Desvincular Plan */}
          {(() => {
            const currentPlan = selectedMacrocycleId !== "ALL" 
              ? macrocycles.find((m) => m.id === selectedMacrocycleId) 
              : macrocycles[0];
            if (!currentPlan) return null;
            return (
              <button
                type="button"
                onClick={() => handleRequestUnlink(currentPlan)}
                className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-red-rival font-bold text-[11.6px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer active:scale-95 transition shadow-sm ml-auto"
                title={language === "es" ? "Desvincular este plan y borrar sus tareas del calendario" : "Unlink this plan"}
              >
                <Unlink size={11} />
                <span>{language === "es" ? "Desvincular Plan" : "Unlink Plan"}</span>
              </button>
            );
          })()}
        </div>
      )}

      {/* Grid calendar */}
      <div className="bg-neutral-900/40 p-3 sm:p-4 rounded-3xl border border-white/5 flex flex-col gap-3">
        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center border-b border-white/5 pb-2">
          {daysOfWeek.map((day, dIdx) => (
            <div key={day} className="flex items-center justify-center py-0.5">
              <span
                className={`text-xs sm:text-sm font-black uppercase tracking-wider leading-none ${
                  dIdx === 0 ? "text-cyan-neon" : "text-white"
                }`}
              >
                {day}
              </span>
            </div>
          ))}
        </div>

        {/* Days Grid cells */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {cells.map((cell, idx) => {
            const isToday =
              cell.isCurrentMonth &&
              cell.day === new Date().getDate() &&
              month === new Date().getMonth() &&
              year === new Date().getFullYear();

            const cellDateStr = cell.isCurrentMonth
              ? `${year}-${String(month + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`
              : "";
            
            const activePhaseInfo = cell.isCurrentMonth ? getPhaseOnDate(cellDateStr) : null;

            // Check if there is an assignment from coach on this day
            const coachAssignment = cell.dayEvents.find(
              (e) => e.createdByRole === "coach" || e.targetArrows !== undefined || e.macrocycleId
            );

            const customStyle = coachAssignment?.phaseColor
              ? {
                  borderColor: `${coachAssignment.phaseColor}40`,
                  backgroundColor: `${coachAssignment.phaseColor}10`
                }
              : activePhaseInfo
              ? {
                  backgroundColor: `${activePhaseInfo.phase.color}15`,
                  borderColor: `${activePhaseInfo.phase.color}35`,
                  color: activePhaseInfo.phase.color
                }
              : {};

            return (
              <div
                key={idx}
                onClick={() => {
                  if (cell.isCurrentMonth) {
                    handleDayClick(cellDateStr);
                  }
                }}
                style={customStyle}
                className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-0.5 p-1 relative font-bold transition-all border overflow-hidden ${
                  !cell.isCurrentMonth
                    ? "text-white border-transparent pointer-events-none"
                    : cell.hasSession && !activePhaseInfo && !coachAssignment
                    ? "bg-cyan-neon/5 text-cyan-neon border-cyan-neon/15 shadow-sm cursor-pointer hover:border-cyan-neon/50 active:scale-95"
                    : "text-white hover:bg-neutral-900/80 border-white/[0.06] cursor-pointer hover:border-cyan-neon/50 active:scale-95"
                } ${isToday ? "border-cyan-neon bg-cyan-neon/15" : ""} ${
                  coachAssignment ? "shadow-[0_0_10px_rgba(255,255,255,0.03)]" : ""
                }`}
                title={cell.isCurrentMonth ? "Toca para ver la asignación de este día" : ""}
              >
                {/* Coach badge dot pinned top-right so day number stays 100% centered */}
                {coachAssignment && !coachAssignment.isRestDay && (
                  <span 
                    style={{ backgroundColor: coachAssignment.phaseColor || "#00E5FF" }} 
                    className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-pulse shadow-sm"
                    title="Asignación del Coach"
                  />
                )}

                {/* Day Number (+20% larger and squarely centered) */}
                <span className={`text-[13.8px] sm:text-[14.5px] leading-none text-center ${isToday ? "text-cyan-neon font-black" : "font-extrabold text-white"}`}>
                  {cell.day}
                </span>

                {/* Literal Title / Target Arrows / Phase label from Excel/Sheet */}
                {coachAssignment ? (
                  <div className="flex flex-col items-center justify-center w-full px-0.5 gap-0.5 overflow-hidden">
                    {coachAssignment.title &&
                      coachAssignment.title.toLowerCase() !== `${coachAssignment.targetArrows} flechas` && (
                        <span
                          style={{ color: coachAssignment.isRestDay ? "#4ADE80" : coachAssignment.phaseColor || "#FFFFFF" }}
                          className="text-[9.3px] sm:text-[10.5px] font-bold tracking-tight leading-none truncate max-w-full text-center"
                        >
                          {coachAssignment.title}
                        </span>
                      )}
                    {coachAssignment.targetArrows && coachAssignment.targetArrows > 0 ? (
                      <span
                        style={{ color: coachAssignment.phaseColor || "#00E5FF" }}
                        className="text-[9.3px] sm:text-[10.5px] font-black tracking-tight leading-none truncate max-w-full text-center tabular-nums"
                      >
                        {coachAssignment.targetArrows} fl.
                      </span>
                    ) : null}
                  </div>
                ) : activePhaseInfo ? (
                  <span className="text-[9.3px] sm:text-[10.5px] font-black uppercase tracking-tight opacity-90 leading-none truncate max-w-[94%] text-center">
                    {activePhaseInfo.phase.name}
                  </span>
                ) : cell.dayEvents.length > 0 && cell.dayEvents[0].title ? (
                  <span className="text-[9.3px] sm:text-[10.5px] font-bold text-white tracking-tight leading-none truncate max-w-[94%] text-center">
                    {cell.dayEvents[0].title}
                  </span>
                ) : null}

                {/* Visual dots for events */}
                {(cell.dayEvents.length > 0 || cell.hasSession) && (
                  <div className="flex gap-0.5 justify-center items-center w-full mt-0.5">
                    {cell.dayEvents.slice(0, 3).map((ev) => (
                      <span 
                        key={ev.id} 
                        className={`w-1.5 h-1.5 rounded-full ${getEventDotColor(ev.type)}`} 
                      />
                    ))}
                    {cell.hasSession && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-gold" title="Práctica Realizada" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Fase Actual details block */}
      {(() => {
        const todayStr = new Date().toISOString().split("T")[0];
        const activePhaseInfo = getPhaseOnDate(todayStr);
        if (!activePhaseInfo) return null;

        const { phase, macroName } = activePhaseInfo;
        return (
          <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 flex flex-col gap-3 shadow-xl relative overflow-hidden">
            <div 
              style={{ backgroundColor: phase.color }}
              className="absolute left-0 top-0 bottom-0 w-[4px]"
            />
            <div className="flex justify-between items-start gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <span className="text-[9.3px] font-black uppercase text-cyan-neon tracking-widest block">
                  {language === "es" ? "Fase Activa Hoy" : "Active Phase Today"}
                </span>
                <h4 className="text-sm font-black text-white uppercase mt-0.5 truncate">{phase.name}</h4>
                <span className="text-[10.5px] text-white block mt-0.5 truncate">
                  Plan: {macroName}
                </span>
              </div>
              <span 
                style={{ color: phase.color, borderColor: `${phase.color}30`, backgroundColor: `${phase.color}15` }}
                className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border uppercase shrink-0 whitespace-nowrap"
              >
                {phase.startDate} al {phase.endDate}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-neutral-950/40 p-3 rounded-2xl border border-white/5 mt-1">
              <div>
                <span className="text-[9.3px] text-white font-black uppercase tracking-wider block">Sesiones Semanales</span>
                <span className="text-xs font-bold text-white mt-0.5 block">{phase.weeklySessionGoal} sesiones</span>
              </div>
              <div>
                <span className="text-[9.3px] text-white font-black uppercase tracking-wider block">Volumen de Flechas</span>
                <span className="text-xs font-bold text-cyan-neon mt-0.5 block">{phase.weeklyArrowGoal} flechas</span>
              </div>
            </div>

            {phase.notes && (
              <p className="text-[11.6px] text-white leading-relaxed italic border-t border-white/[0.03] pt-2.5 mt-0.5">
                &ldquo;{phase.notes}&rdquo;
              </p>
            )}

            <div className="flex items-center justify-between border-t border-white/[0.04] pt-2.5 mt-1">
              <span className="text-[10.5px] text-white">Plan vinculado</span>
              <button
                type="button"
                onClick={() => {
                  const m = macrocycles.find((mc) => mc.id === activePhaseInfo.macrocycle?.id || mc.name === macroName);
                  if (m) handleRequestUnlink(m);
                  else if (macrocycles.length > 0) handleRequestUnlink(macrocycles[0]);
                }}
                className="text-[11.6px] text-red-rival hover:text-red-rival font-bold uppercase tracking-wider flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/10 border border-rose-500/20 active:scale-95 transition cursor-pointer"
              >
                <Unlink size={11} />
                <span>{language === "es" ? "Desvincular Plan" : "Unlink Plan"}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Attendance Stats Widget */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/5 flex justify-between items-center gap-4">
        <div className="flex flex-col gap-1.5 w-[65%]">
          <span className="text-[10.5px] text-cyan-neon font-bold uppercase tracking-widest flex items-center">
            {language === "es" ? "Constancia Mensual" : "Monthly Attendance"}
          </span>
          <h4 className="text-white text-xs font-extrabold leading-tight">
            {language === "es" ? "Tu constancia de entrenamiento" : "Your training consistency"}
          </h4>
          <p className="text-[11.6px] text-white leading-snug">
            {attendanceRate >= 80 
              ? (language === "es" ? "¡Excelente consistencia olímpica! Estás entrenando al nivel planeado." : "Excellent Olympic consistency! You are training at the planned level.")
              : (language === "es" ? "Continúa asistiendo regularmente para completar tus metas del club." : "Continue attending regularly to complete your club goals.")}
          </p>
        </div>

        {/* Circular Progress SVG widget */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg className="w-16 h-16 transform -rotate-90">
            <circle
              cx="32"
              cy="32"
              r="24"
              className="stroke-neutral-800"
              strokeWidth="4"
              fill="none"
            />
            <motion.circle
              cx="32"
              cy="32"
              r="24"
              className={attendanceRate >= 75 ? "stroke-yellow-gold" : "stroke-cyan-neon"}
              strokeWidth="4"
              fill="none"
              strokeDasharray="150.8"
              initial={{ strokeDashoffset: 150.8 }}
              animate={{ strokeDashoffset: 150.8 - (150.8 * attendanceRate) / 100 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pt-0.5">
            <span className="text-[11.6px] font-black text-white">{attendanceRate}%</span>
          </div>
        </div>
      </div>

      {/* Event list */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center px-1">
          <span className="text-xs text-white font-bold uppercase tracking-wider">
            {language === "es" ? "Eventos de este mes" : "Events this month"}
          </span>
          <span className="text-[11.6px] text-white">
            {monthEvents.length} {monthEvents.length === 1 ? "evento" : "eventos"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {monthEvents.length === 0 ? (
            <div className="p-8 rounded-3xl border border-white/[0.03] bg-neutral-900/20 text-center flex flex-col items-center gap-2">
              <CalendarIcon size={24} className="text-white" />
              <p className="text-xs text-white">
                {language === "es" ? "No hay eventos programados" : "No events scheduled"}
              </p>
            </div>
          ) : (
            monthEvents.map((ev) => {
              const countdown = getDaysRemaining(ev.date);
              const isCoachEvent = ev.createdByRole === "coach";
              const isOwner = ev.createdByUid === user.uid;
              const canEdit = isCoach || isOwner;

              return (
                <motion.div
                  key={ev.id}
                  layout
                  onClick={() => handleDayClick(ev.date)}
                  className="p-4 rounded-3xl border border-white/5 bg-neutral-900/40 flex flex-col gap-3 relative overflow-hidden cursor-pointer hover:border-white/15 transition"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10.5px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-extrabold ${getEventBadgeColor(ev.type)}`}>
                          {ev.type === "competition" ? "Competencia" :
                           ev.type === "training" ? "Entrenamiento" :
                           ev.type === "meeting" ? "Reunión" : "Otro"}
                        </span>
                        
                        {isCoachEvent && (
                          <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-yellow-gold/25 text-yellow-gold bg-yellow-gold/5 uppercase tracking-wider font-extrabold flex items-center gap-1">
                            <Shield size={9} />
                            <span>Asignado por Coach</span>
                          </span>
                        )}

                        {ev.phaseName && (
                          <span 
                            style={{ color: ev.phaseColor, backgroundColor: `${ev.phaseColor}15`, borderColor: `${ev.phaseColor}30` }}
                            className="text-[10.5px] px-2 py-0.5 rounded-full border font-bold uppercase"
                          >
                            {ev.phaseName}
                          </span>
                        )}
                      </div>

                      <h4 className="text-white text-xs font-black mt-1">{ev.title}</h4>
                      
                      <div className="flex items-center gap-1 text-[10.5px] text-white">
                        <Clock size={10} />
                        <span>
                          {new Date(ev.date + "T00:00:00").toLocaleDateString(language === "es" ? "es-ES" : "en-US", {
                            weekday: "short",
                            day: "numeric",
                            month: "short"
                          })}
                        </span>
                        {ev.createdByName && (
                          <span>· Por {ev.createdByName}</span>
                        )}
                      </div>
                    </div>

                    {/* Countdown Badge */}
                    <span className={`text-[11.6px] px-2.5 py-1 rounded-xl font-extrabold uppercase border shrink-0 whitespace-nowrap ${countdown.colorClass}`}>
                      {countdown.text}
                    </span>
                  </div>

                  {ev.description && (
                    <p className="text-[11.6px] text-white leading-relaxed border-t border-white/[0.02] pt-2">
                      {ev.description}
                    </p>
                  )}

                  {/* Actions (Edit / Delete) */}
                  <div className="flex justify-end gap-1.5 border-t border-white/[0.03] pt-2" onClick={(e) => e.stopPropagation()}>
                    {canEdit ? (
                      <>
                        <button
                          onClick={() => handleOpenEdit(ev)}
                          className="p-1.5 rounded-lg border border-white/5 bg-neutral-950 text-white hover:text-white transition cursor-pointer"
                          title="Editar"
                        >
                          <Edit size={11} />
                        </button>
                        <button
                          onClick={() => handleDelete(ev.id)}
                          className="p-1.5 rounded-lg border border-red-500/10 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                          title="Eliminar"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[10.5px] text-white flex items-center gap-1">
                        <Lock size={10} />
                        <span>Solo lectura (Coach)</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* MODAL 1: DAY DETAIL INSPECTION MODAL (ATHLETE & COACH DAILY VIEW) */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showDayModal && selectedDay && (() => {
          const dayEvents = visibleEvents.filter((e) => e.date === selectedDay);
          const activePhaseInfo = getPhaseOnDate(selectedDay);
          const daySessions = getSessionsOnDate(selectedDay);
          const arrowsShot = getArrowsShotOnDate(selectedDay);

          const coachAssignment = dayEvents.find(
            (e) => e.createdByRole === "coach" || e.targetArrows !== undefined || e.macrocycleId
          );

          const countdown = getDaysRemaining(selectedDay);

          const formattedDayTitle = new Date(selectedDay + "T00:00:00").toLocaleDateString(
            language === "es" ? "es-ES" : "en-US",
            { weekday: "long", day: "numeric", month: "long", year: "numeric" }
          );

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <div className="absolute inset-0" onClick={() => setShowDayModal(false)} />
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-5 w-full max-w-lg shadow-2xl z-10 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
              >
                {/* Header */}
                <div className="flex justify-between items-start border-b border-white/5 pb-3">
                  <div>
                    <span className="text-[10.5px] text-cyan-neon font-black uppercase tracking-widest block">
                      Detalle del Día
                    </span>
                    <h3 className="text-sm font-black text-white capitalize mt-0.5">
                      {formattedDayTitle}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11.6px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${countdown.colorClass}`}>
                      {countdown.text}
                    </span>
                    <button
                      onClick={() => setShowDayModal(false)}
                      className="p-1 rounded-full text-white hover:text-white hover:bg-white/5 transition"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* 1. SECCIÓN PRINCIPAL: ASIGNACIÓN DEL ENTRENADOR */}
                <div className="flex flex-col gap-2">
                  <span className="text-[10.5px] text-white uppercase font-black tracking-widest flex items-center gap-1.5">
                    <Shield size={12} className="text-yellow-gold" />
                    <span>Plan del Entrenador para este Día</span>
                  </span>

                  {coachAssignment ? (
                    <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3 relative overflow-hidden shadow-xl">
                      {/* Left accent color bar */}
                      <div
                        style={{ backgroundColor: coachAssignment.phaseColor || "#00E5FF" }}
                        className="absolute left-0 top-0 bottom-0 w-[4px]"
                      />

                      {/* Header row */}
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9.3px] font-black uppercase px-2 py-0.5 rounded-full bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30 flex items-center gap-1">
                              <Shield size={9} />
                              <span>Asignado por: {coachAssignment.createdByName}</span>
                            </span>

                            {coachAssignment.assignedAthleteIds && coachAssignment.assignedAthleteIds.length > 0 ? (
                              <span className="text-[9.3px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30 flex items-center gap-1">
                                <User size={9} />
                                <span>
                                  {isCoach 
                                    ? `Para: ${coachAssignment.assignedAthleteIds.map(id => roster.find(r => r.uid === id)?.fullName || id).join(", ")}`
                                    : "Asignación Personalizada"}
                                </span>
                              </span>
                            ) : (
                              <span className="text-[9.3px] font-black uppercase px-2 py-0.5 rounded-full bg-white/5 text-white border border-white/5 flex items-center gap-1">
                                <Users size={9} />
                                <span>Todo el Club</span>
                              </span>
                            )}

                            {coachAssignment.phaseName && (
                              <span
                                style={{
                                  color: coachAssignment.phaseColor,
                                  backgroundColor: `${coachAssignment.phaseColor}15`,
                                  borderColor: `${coachAssignment.phaseColor}30`
                                }}
                                className="text-[9.3px] font-black uppercase px-2 py-0.5 rounded-full border"
                              >
                                {coachAssignment.phaseName}
                              </span>
                            )}
                          </div>

                          <h4 className="text-white text-sm font-black mt-1">
                            {coachAssignment.title}
                          </h4>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Edit button if coach */}
                          {isCoach && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditAssignment(coachAssignment)}
                              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/30 transition text-[10.5px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Edit2 size={11} />
                              <span>Editar</span>
                            </button>
                          )}
                          {/* Botón para Desvincular Plan */}
                          <button
                            type="button"
                            onClick={() => {
                              const m = macrocycles.find((mc) => mc.id === coachAssignment.macrocycleId);
                              if (m) {
                                handleRequestUnlink(m);
                              } else if (coachAssignment.macrocycleId) {
                                handleRequestUnlink({
                                  id: coachAssignment.macrocycleId,
                                  name: coachAssignment.title,
                                  startDate: coachAssignment.date,
                                  endDate: coachAssignment.date,
                                  phases: [],
                                  assignmentType: "club",
                                  assignedAthleteIds: [],
                                  volumeGoal: 0,
                                  currentVolume: 0,
                                  status: "active",
                                  coachId: "",
                                  clubId: "",
                                  createdAt: "",
                                  updatedAt: ""
                                });
                              }
                            }}
                            className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-red-rival border border-rose-500/25 transition text-[10.5px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Desvincular Plan"
                          >
                            <Unlink size={11} />
                            <span>Desvincular</span>
                          </button>
                        </div>
                      </div>

                      {/* Meta de Flechas (solo si el Excel/Sheet o el Coach indicó un número > 0) */}
                      {!coachAssignment.isRestDay && coachAssignment.targetArrows && coachAssignment.targetArrows > 0 ? (
                        <div className="bg-neutral-950/70 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[11.6px] text-white uppercase font-bold flex items-center gap-1">
                              <Target size={12} className="text-cyan-neon" />
                              <span>Flechas</span>
                            </span>
                            <span className="text-xs font-black text-cyan-neon tabular-nums">
                              {coachAssignment.targetArrows} flechas
                            </span>
                          </div>

                          {/* Progress bar comparing with arrows shot */}
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10.5px]">
                              <span className="text-white">Progreso registrado hoy:</span>
                              <span className="text-white font-extrabold tabular-nums">
                                {arrowsShot} / {coachAssignment.targetArrows} (
                                {Math.min(100, Math.round((arrowsShot / coachAssignment.targetArrows) * 100))}%)
                              </span>
                            </div>
                            <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-white/5">
                              <div
                                style={{
                                  width: `${Math.min(100, Math.round((arrowsShot / coachAssignment.targetArrows) * 100))}%`,
                                  backgroundColor: coachAssignment.phaseColor || "#00E5FF"
                                }}
                                className="h-full rounded-full transition-all duration-500"
                              />
                            </div>
                          </div>

                          {arrowsShot >= coachAssignment.targetArrows && (
                            <div className="flex items-center gap-1 text-[10.5px] text-green-400 font-bold bg-green-500/10 px-2 py-1 rounded-xl border border-green-500/20">
                              <CheckCircle2 size={12} />
                              <span>Meta de flechas completada</span>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* Campos literales del Excel / Google Sheet */}
                      {coachAssignment.customFields && coachAssignment.customFields.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-2.5">
                          <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                            Datos del Plan
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {coachAssignment.customFields.map((field, idx) => (
                              <div
                                key={idx}
                                className="bg-neutral-950/70 px-3 py-2 rounded-xl border border-white/[0.05] flex flex-col gap-0.5"
                              >
                                <span className="text-[10.5px] font-bold uppercase tracking-wider text-white">
                                  {field.label}
                                </span>
                                <span className="text-xs font-bold text-white break-words">
                                  {field.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Technical & Physical Focus Points */}
                      {coachAssignment.focusPoints && coachAssignment.focusPoints.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-t border-white/[0.04] pt-2">
                          <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                            Enfoque Técnico y Físico
                          </span>
                          <div className="flex flex-col gap-1">
                            {coachAssignment.focusPoints.map((pt, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-white">
                                <CheckCircle2 size={12} className="text-cyan-neon shrink-0" />
                                <span>{pt}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Coach Notes */}
                      {Boolean(coachAssignment.coachNotes && coachAssignment.coachNotes.trim()) && (
                        <div className="flex flex-col gap-1 border-t border-white/[0.04] pt-2">
                          <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                            Indicaciones del Entrenador
                          </span>
                          <p className="text-xs text-white italic leading-relaxed bg-neutral-950/50 p-2.5 rounded-xl border border-white/[0.03]">
                            &ldquo;{coachAssignment.coachNotes?.trim()}&rdquo;
                          </p>
                        </div>
                      )}

                      {/* Action Button for Archer: Start Practice */}
                      {!isCoach && !coachAssignment.isRestDay && (
                        <button
                          onClick={() => {
                            setShowDayModal(false);
                            if (onNavigate) onNavigate("TARGET");
                          }}
                          className="w-full mt-1 py-3 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition"
                        >
                          <Target size={14} />
                          <span>Iniciar Práctica de Hoy</span>
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  ) : activePhaseInfo ? (
                    <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-4 flex flex-col gap-2.5">
                      <div className="flex justify-between items-center">
                        <span 
                          style={{ color: activePhaseInfo.phase.color }}
                          className="text-xs font-black uppercase flex items-center gap-1.5"
                        >
                          <span style={{ backgroundColor: activePhaseInfo.phase.color }} className="w-2 h-2 rounded-full" />
                          Fase Activa: {activePhaseInfo.phase.name}
                        </span>
                        <span className="text-[10.5px] text-white">Plan: {activePhaseInfo.macroName}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11.6px] bg-neutral-950/50 p-2 rounded-xl border border-white/5">
                        <div>
                          <span className="text-white block uppercase font-bold text-[9.3px]">Meta Semanal</span>
                          <span className="text-white font-medium">{activePhaseInfo.phase.weeklySessionGoal} sesiones</span>
                        </div>
                        <div>
                          <span className="text-white block uppercase font-bold text-[9.3px]">Flechas Semanales</span>
                          <span className="text-cyan-neon font-medium">{activePhaseInfo.phase.weeklyArrowGoal} flechas</span>
                        </div>
                      </div>

                      {activePhaseInfo.phase.notes && (
                        <p className="text-[11.6px] text-white italic">&ldquo;{activePhaseInfo.phase.notes}&rdquo;</p>
                      )}

                      {isCoach && (
                        <button
                          onClick={() => handleOpenCreateAssignment(selectedDay, activePhaseInfo)}
                          className="mt-1 py-2 rounded-xl bg-cyan-neon text-black font-black text-[11.6px] uppercase tracking-wider flex items-center justify-center gap-1 shadow-glow-cyan cursor-pointer"
                        >
                          <Plus size={12} />
                          <span>Asignar Tarea Específica para este Día</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-neutral-900/20 border border-white/5 rounded-2xl p-4 text-center flex flex-col items-center gap-2">
                      <p className="text-xs text-white">No hay asignación programada para esta fecha.</p>
                      {isCoach && (
                        <button
                          onClick={() => handleOpenCreateAssignment(selectedDay, null)}
                          className="py-1.5 px-3 rounded-xl bg-cyan-neon text-black font-black text-[11.6px] uppercase tracking-wider flex items-center gap-1 shadow-glow-cyan cursor-pointer"
                        >
                          <Plus size={12} />
                          <span>Asignar Tarea del Día</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. REGISTRO DE TIRO EN ESTA FECHA */}
                <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
                  <span className="text-[10.5px] text-white uppercase font-black tracking-widest flex items-center justify-between">
                    <span>Sesiones Realizadas en esta Fecha</span>
                    <span className="text-cyan-neon font-black">{arrowsShot} flechas totales</span>
                  </span>

                  {daySessions.length === 0 ? (
                    <p className="text-[12.8px] text-white py-2 text-center bg-neutral-950/30 rounded-2xl">
                      No hay registros de tiro guardados en esta fecha.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {daySessions.map((ses) => (
                        <div
                          key={ses.id}
                          className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex justify-between items-center"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white">
                              {ses.practiceType || "Práctica"} ({ses.bowType || "Arco"})
                            </span>
                            <span className="text-[10.5px] text-white">
                              {ses.distance ? `${ses.distance}m · ` : ""}
                              {ses.endsCount && ses.arrowsPerEnd ? `${ses.endsCount * ses.arrowsPerEnd} flechas` : ""}
                            </span>
                          </div>

                          <div className="text-right">
                            <span className="text-sm font-black text-cyan-neon block">
                              {ses.score ? `${ses.score} pts` : "Completada"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. OTROS EVENTOS DEL DÍA */}
                {dayEvents.filter(e => !e.macrocycleId && e.targetArrows === undefined).length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
                    <span className="text-[10.5px] text-white uppercase font-black tracking-widest">
                      Otros Eventos Programados
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {dayEvents.filter(e => !e.macrocycleId && e.targetArrows === undefined).map(ev => (
                        <div key={ev.id} className="bg-neutral-950/40 p-2.5 rounded-xl border border-white/5 flex justify-between items-center">
                          <div>
                            <span className="text-xs font-bold text-white block">{ev.title}</span>
                            <span className="text-[10.5px] text-white">{ev.description}</span>
                          </div>
                          <span className={`text-[9.3px] px-2 py-0.5 rounded-full border uppercase font-bold ${getEventBadgeColor(ev.type)}`}>
                            {ev.type}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* ================================================================= */}
      {/* MODAL 2: COACH SYNC CYCLE WITH THIS MONTH MODAL                   */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showSyncModal && (
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
                    <span className="text-[10.5px] text-white block">
                      Mes: <strong className="text-white capitalize">{monthName}</strong>
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowSyncModal(false)}
                  className="p-1 rounded-full text-white hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-xs">
                <p className="text-[12.8px] text-white leading-relaxed">
                  Esta acción sincronizará el ciclo con el calendario de la app para todos los días de{" "}
                  <strong className="text-cyan-neon capitalize">{monthName}</strong>. 
                  Tus arqueros podrán entrar a cada día y ver sus metas de flechas, puntos técnicos y notas asignadas.
                </p>

                {/* Macrocycle Selector */}
                <div className="flex flex-col gap-1 mt-1">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Seleccionar Plan / Ciclo
                  </label>
                  <select
                    value={syncMacroId}
                    onChange={(e) => setSyncMacroId(e.target.value)}
                    className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                  >
                    {macrocycles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.startDate} al {m.endDate})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Macrocycle Phases Preview */}
                {(() => {
                  const macro = macrocycles.find((m) => m.id === syncMacroId) || macrocycles[0];
                  if (!macro) return null;

                  return (
                    <div className="bg-neutral-950/60 p-3 rounded-2xl border border-white/5 flex flex-col gap-2 mt-1">
                      <span className="text-[10.5px] text-white uppercase font-bold">Fases Configurada(s)</span>
                      <div className="flex flex-wrap gap-1.5">
                        {macro.phases?.map((p) => (
                          <span
                            key={p.id}
                            style={{ color: p.color, borderColor: `${p.color}30`, backgroundColor: `${p.color}15` }}
                            className="text-[10.5px] font-bold px-2 py-0.5 border rounded-full uppercase"
                          >
                            {p.name} ({p.weeklyArrowGoal} flechas/sem)
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Action Button */}
                <button
                  type="button"
                  disabled={isSyncing || macrocycles.length === 0}
                  onClick={handleSyncCycleToMonth}
                  className="w-full mt-2 py-3 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition disabled:opacity-40"
                >
                  <RefreshCw size={14} />
                  <span>{isSyncing ? "Sincronizando..." : "Sincronizar y Publicar en Calendario"}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================= */}
      {/* MODAL 3: COACH EDIT / CREATE DAILY ASSIGNMENT                     */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showAssignmentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShowAssignmentModal(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-[#0A0A0C] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl z-10 flex flex-col gap-4 text-left max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    {assignmentEventId ? "Editar Asignación del Día" : "Crear Asignación del Día"}
                  </h3>
                  <span className="text-[10.5px] text-cyan-neon font-black block mt-0.5">
                    Fecha: {assignDate}
                  </span>
                </div>
                <button
                  onClick={() => setShowAssignmentModal(false)}
                  className="p-1 rounded-full text-white hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveDailyAssignment} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Título de la Tarea / Sesión
                  </label>
                  <input
                    type="text"
                    required
                    value={assignTitle}
                    onChange={(e) => setAssignTitle(e.target.value)}
                    placeholder="Ej. Control 720m + 120 flechas"
                    className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Meta de Flechas para este Día (0 = Descanso)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={assignTargetArrows}
                    onChange={(e) => setAssignTargetArrows(Number(e.target.value))}
                    className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Puntos de Enfoque Técnico (separados por coma)
                  </label>
                  <input
                    type="text"
                    value={assignFocusPoint}
                    onChange={(e) => setAssignFocusPoint(e.target.value)}
                    placeholder="Ej. Calentamiento con gomas, Ritmo de tiro, Anclaje firme"
                    className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Indicaciones / Notas para tus Alumnos
                  </label>
                  <textarea
                    rows={3}
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    placeholder="Escribe recomendaciones técnicas o de actitud para la sesión..."
                    className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-cyan-neon resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 py-3 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer active:scale-98 transition"
                >
                  Guardar y Asignar a los Alumnos
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================= */}
      {/* MODAL 4: REGULAR EVENT ADD / EDIT                                 */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 text-left shadow-2xl"
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <h3 className="text-white text-base font-black uppercase">
                  {modalMode === "add" ? "Planificar Evento" : "Editar Evento"}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 rounded-lg text-white hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.6px] text-white font-bold uppercase tracking-wider">
                    Título
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Nombre del evento o torneo"
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.6px] text-white font-bold uppercase tracking-wider">
                    Tipo de Evento
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "training", label: "Práctica" },
                      { value: "competition", label: "Torneo" },
                      { value: "meeting", label: "Reunión" },
                      { value: "other", label: "Otro" }
                    ].map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setEventType(type.value as any)}
                        className={`py-2 rounded-xl border text-[11.6px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
                          eventType === type.value
                            ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                            : "border-white/5 bg-neutral-950 text-white hover:text-white"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.6px] text-white font-bold uppercase tracking-wider">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11.6px] text-white font-bold uppercase tracking-wider">
                    Notas / Detalles
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Detalles sobre distancia, diana o requerimientos..."
                    rows={3}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 mt-2 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider cursor-pointer transition active:scale-[0.98]"
                >
                  {modalMode === "add" ? "Programar Evento" : "Guardar Cambios"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================================================================= */}
      {/* MODAL 5: IMPORT EXCEL / GOOGLE SHEETS DIRECTLY INTO CALENDAR      */}
      {/* ================================================================= */}
      {/* HIGH-END MODAL IMPORT EXCEL / GOOGLE SHEETS */}
      <PlanImporterModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        user={user}
        coachViewMode={isCoach}
        athletes={roster}
        preselectedAthleteIds={isCoach && selectedAthleteFilter !== "ALL" ? [selectedAthleteFilter] : undefined}
        onSuccess={handleImportSuccess}
        titleOverride="Calendario y Planificación"
      />

      {/* Unlink Plan Confirmation Modal */}
      <AnimatePresence>
        {showUnlinkModal && macroToUnlink && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div 
              className="absolute inset-0" 
              onClick={() => {
                if (!isUnlinking) {
                  setShowUnlinkModal(false);
                  setMacroToUnlink(null);
                }
              }} 
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-neutral-950 border border-white/10 rounded-3xl p-6 max-w-sm w-full flex flex-col gap-4 shadow-2xl z-10"
            >
              <button
                type="button"
                onClick={() => {
                  if (!isUnlinking) {
                    setShowUnlinkModal(false);
                    setMacroToUnlink(null);
                  }
                }}
                className="absolute top-4 right-4 p-1.5 rounded-xl bg-neutral-900 border border-white/10 text-white hover:text-white transition"
              >
                <X size={16} />
              </button>

              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-red-rival">
                <Unlink size={24} />
              </div>

              <div>
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  ¿Desvincular Plan?
                </h3>
                <p className="text-xs text-white mt-1 leading-relaxed">
                  Plan: <strong className="text-white">{macroToUnlink.name}</strong>
                </p>
                <p className="text-[12.8px] text-red-rival mt-1.5 leading-relaxed bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
                  Al confirmar, se eliminará el plan y se retirarán todas sus tareas, metas de flechas y descansos programados del calendario.
                </p>
              </div>

              {/* If Coach and multiple athletes are assigned */}
              {isCoach && macroToUnlink.assignedAthleteIds && macroToUnlink.assignedAthleteIds.length > 0 && (
                <div className="flex flex-col gap-1.5 bg-neutral-900/60 p-3 rounded-2xl border border-white/5">
                  <label className="text-[10.5px] text-white uppercase font-black tracking-widest">
                    Desvincular a:
                  </label>
                  <select
                    value={unlinkTargetAthleteId}
                    onChange={(e) => setUnlinkTargetAthleteId(e.target.value)}
                    className="bg-neutral-950 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-neon font-bold"
                  >
                    <option value="ALL">Todo el plan (Borrar completamente)</option>
                    {macroToUnlink.assignedAthleteIds.map((athId) => {
                      const athleteObj = roster.find((r) => r.uid === athId);
                      return (
                        <option key={athId} value={athId}>
                          Solo al alumno {athleteObj ? athleteObj.fullName : athId}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setShowUnlinkModal(false);
                    setMacroToUnlink(null);
                  }}
                  disabled={isUnlinking}
                  className="flex-1 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-850 text-white hover:text-white font-bold text-xs uppercase cursor-pointer transition border border-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnlink}
                  disabled={isUnlinking}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase cursor-pointer transition shadow-lg flex items-center justify-center gap-1.5"
                >
                  {isUnlinking ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Unlink size={14} />
                  )}
                  <span>Confirmar</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
