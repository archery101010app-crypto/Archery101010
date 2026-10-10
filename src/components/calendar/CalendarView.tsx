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
  getLocalMacrocycles
} from "@/lib/db/indexedDB";
import { Macrocycle, MacrocyclePhase, PHASE_CONFIG } from "@/lib/db/macrocycleTypes";
import { syncCycleToMonthCalendar, getRecommendedFocusPoints } from "@/lib/cycleCalendarSync";
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
  Sparkles,
  CheckCircle2,
  Shield,
  Flame,
  ArrowRight,
  Info,
  RefreshCw,
  Edit2
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

  // Load Sessions, Events and Macrocycles on Mount & on db change
  useEffect(() => {
    async function loadData() {
      const sessionList = await getLocalSessions();
      setSessions(sessionList);
      
      const eventList = await getLocalEvents();
      setEvents(eventList);

      const macroList = await getLocalMacrocycles();
      setMacrocycles(macroList);
      if (macroList.length > 0 && !syncMacroId) {
        setSyncMacroId(macroList[0].id);
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
    const filteredMacros = selectedMacrocycleId === "ALL" 
      ? macrocycles 
      : macrocycles.filter(m => m.id === selectedMacrocycleId);

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
  // Adjust to start week on Monday: 0 (Sun) becomes 6, 1-6 (Mon-Sat) becomes 0-5
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

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
    if (user.clubId && e.clubId === user.clubId) return true;
    if (e.createdByUid === user.uid) return true;
    if (e.assignedAthleteIds && e.assignedAthleteIds.length > 0) {
      return e.assignedAthleteIds.includes(user.uid);
    }
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
    ? ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

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
        colorClass: "text-amber-500 bg-amber-500/10 border-amber-500/25 shadow-glow-yellow/5", 
        isPast: false 
      };
    } else if (diffDays === 1) {
      return { 
        text: language === "es" ? "Mañana" : "Tomorrow", 
        colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-glow-cyan/5", 
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
        colorClass: "text-gray-dim bg-neutral-900 border-neutral-800", 
        isPast: true 
      };
    } else {
      return { 
        text: language === "es" ? `Hace ${Math.abs(diffDays)} días` : `${Math.abs(diffDays)} days ago`, 
        colorClass: "text-gray-dim bg-neutral-900 border-neutral-800", 
        isPast: true 
      };
    }
  };

  const getEventBadgeColor = (type: string) => {
    switch (type) {
      case "competition":
        return "bg-red-500/15 text-red-400 border-red-500/20";
      case "training":
        return "bg-cyan-500/15 text-cyan-400 border-cyan-500/20";
      case "meeting":
        return "bg-amber-500/15 text-amber-400 border-amber-500/20";
      default:
        return "bg-purple-500/15 text-purple-400 border-purple-500/20";
    }
  };

  const getEventDotColor = (type: string) => {
    switch (type) {
      case "competition": return "bg-red-500";
      case "training": return "bg-cyan-500";
      case "meeting": return "bg-amber-500";
      default: return "bg-purple-500";
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
      alert("No hay ningún macrociclo disponible para sincronizar.");
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
        `✓ ¡Calendario Sincronizado con Éxito!\n\n` +
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
    setAssignTitle(`🎯 Plan Coach: ${pName}`);
    const defaultArrows = phaseInfo?.phase 
      ? Math.round(phaseInfo.phase.weeklyArrowGoal / Math.max(1, phaseInfo.phase.weeklySessionGoal)) 
      : 120;
    setAssignTargetArrows(defaultArrows);
    const points = phaseInfo?.phase 
      ? getRecommendedFocusPoints(phaseInfo.phase.type) 
      : ["Calentamiento articular", "Ritmo constante de disparo", "Alineación"];
    setAssignFocusPoint(points.slice(0, 2).join(", "));
    setAssignNotes(phaseInfo?.phase?.notes || "Realizar la sesión completa manteniendo la técnica.");
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
      phaseName: activePhaseInfo?.phase?.name || "Asignación Especial",
      phaseType: activePhaseInfo?.phase?.type,
      phaseColor: activePhaseInfo?.phase?.color || "#00BFFF",
      targetArrows: assignTargetArrows,
      focusPoints: focusArr.length > 0 ? focusArr : ["Consistencia técnica", "Postura olímpica"],
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

    alert("✓ Asignación del día guardada y notificada a los arqueros.");
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-neutral-900 border border-white/10 text-gray-dim hover:text-white cursor-pointer active:scale-95 transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white text-lg font-black uppercase tracking-wide">
                {language === "es" ? "Calendario" : "Calendar"}
              </h2>
              {isCoach && (
                <span className="text-[8px] bg-yellow-gold/15 text-yellow-gold font-black uppercase px-2 py-0.5 rounded-full border border-yellow-gold/30">
                  Director / Coach
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-dim uppercase tracking-wider">
              {language === "es" ? "Planificación y Tareas Diarias" : "Planning & Daily Tasks"}
            </p>
          </div>
        </div>

        {/* Action buttons: Sync Cycle (Coach) + Add Event */}
        <div className="flex items-center gap-2">
          {isCoach && (
            <button
              onClick={() => setShowSyncModal(true)}
              className="px-3 py-2 rounded-2xl bg-gradient-to-r from-yellow-gold/20 to-amber-500/20 hover:from-yellow-gold/30 hover:to-amber-500/30 border border-yellow-gold/40 text-yellow-gold font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-glow-yellow/10 cursor-pointer active:scale-95 transition"
              title="Sincronizar ciclo con el mes"
            >
              <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Sincronizar Ciclo</span>
              <span className="sm:hidden">Ciclo</span>
            </button>
          )}

          <button
            onClick={handleOpenAdd}
            className="p-2.5 rounded-2xl bg-cyan-neon/15 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon cursor-pointer active:scale-95 transition"
            title="Planificar Evento"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* Month selection selector */}
      <div className="flex justify-between items-center bg-neutral-900/60 p-3 rounded-2xl border border-white/5">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <span className="text-white font-extrabold text-sm capitalize block">{monthName}</span>
          <span className="text-[9px] text-gray-dim">Toca cualquier día para ver las tareas</span>
        </div>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Macrocycle Filter */}
      {macrocycles.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-[10px] text-gray-dim uppercase font-black tracking-widest">
            {language === "es" ? "Plan Macrociclo:" : "Macrocycle Plan:"}
          </span>
          <select
            value={selectedMacrocycleId}
            onChange={(e) => setSelectedMacrocycleId(e.target.value)}
            className="bg-neutral-900 border border-white/10 rounded-xl px-3 py-1.5 text-white text-[10px] uppercase font-bold outline-none focus:border-cyan-neon max-w-[200px]"
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

      {/* Grid calendar */}
      <div className="bg-neutral-900/40 p-4 rounded-3xl border border-white/5 flex flex-col gap-4">
        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {daysOfWeek.map((day) => (
            <span key={day} className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
              {day}
            </span>
          ))}
        </div>

        {/* Days Grid cells */}
        <div className="grid grid-cols-7 gap-2">
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
                className={`aspect-square rounded-2xl flex flex-col items-center justify-between py-1.5 px-0.5 relative text-xs font-bold transition-all border ${
                  !cell.isCurrentMonth
                    ? "text-gray-dim/20 border-transparent pointer-events-none"
                    : cell.hasSession && !activePhaseInfo && !coachAssignment
                    ? "bg-cyan-neon/5 text-cyan-neon border-cyan-neon/15 shadow-glow-cyan/5 cursor-pointer hover:border-cyan-neon/50 active:scale-95"
                    : "text-white/80 hover:bg-neutral-900/80 border-white/[0.04] cursor-pointer hover:border-cyan-neon/50 active:scale-95"
                } ${isToday ? "border-cyan-neon shadow-glow-cyan bg-cyan-neon/15" : ""} ${
                  coachAssignment ? "shadow-[0_0_10px_rgba(255,255,255,0.03)]" : ""
                }`}
                title={cell.isCurrentMonth ? "Toca para ver la asignación de este día" : ""}
              >
                {/* Day Number + Coach badge dot if assigned */}
                <div className="flex items-center justify-between w-full px-1.5">
                  <span className={`text-[11px] ${isToday ? "text-cyan-neon font-black" : "text-white/90"}`}>
                    {cell.day}
                  </span>
                  {coachAssignment && !coachAssignment.isRestDay && (
                    <span 
                      style={{ backgroundColor: coachAssignment.phaseColor || "#00E5FF" }} 
                      className="w-1.5 h-1.5 rounded-full animate-pulse shadow-sm"
                      title="Asignación del Coach"
                    />
                  )}
                </div>

                {/* Center / Bottom Info: Target Arrows or Phase label */}
                <div className="flex flex-col items-center gap-0.5 w-full">
                  {coachAssignment && coachAssignment.targetArrows ? (
                    <span 
                      style={{ color: coachAssignment.phaseColor || "#00E5FF" }}
                      className="text-[8px] font-black tracking-tight leading-none truncate max-w-full"
                    >
                      🎯{coachAssignment.targetArrows}
                    </span>
                  ) : activePhaseInfo ? (
                    <span className="text-[7px] font-black uppercase tracking-wider scale-90 opacity-80 leading-none truncate max-w-[90%] mb-0.5">
                      {activePhaseInfo.phase.name}
                    </span>
                  ) : null}

                  {/* Visual dots for events */}
                  <div className="flex gap-0.5 justify-center w-full min-h-[4px]">
                    {cell.dayEvents.slice(0, 3).map((ev) => (
                      <span 
                        key={ev.id} 
                        className={`w-1 h-1 rounded-full ${getEventDotColor(ev.type)}`} 
                      />
                    ))}
                    {cell.hasSession && (
                      <span className="w-1 h-1 rounded-full bg-yellow-gold" title="Práctica Realizada" />
                    )}
                  </div>
                </div>
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
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[8px] font-black uppercase text-cyan-neon tracking-widest block">
                  {language === "es" ? "Fase Activa Hoy" : "Active Phase Today"}
                </span>
                <h4 className="text-sm font-black text-white uppercase mt-0.5">{phase.name}</h4>
                <span className="text-[9px] text-white/50 block mt-0.5">
                  Plan: {macroName}
                </span>
              </div>
              <span 
                style={{ color: phase.color, borderColor: `${phase.color}30`, backgroundColor: `${phase.color}15` }}
                className="text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase"
              >
                {phase.startDate} al {phase.endDate}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-neutral-950/40 p-3 rounded-2xl border border-white/5 mt-1">
              <div>
                <span className="text-[8px] text-white/30 font-black uppercase tracking-wider block">Sesiones Semanales</span>
                <span className="text-xs font-bold text-white mt-0.5 block">{phase.weeklySessionGoal} sesiones</span>
              </div>
              <div>
                <span className="text-[8px] text-white/30 font-black uppercase tracking-wider block">Volumen de Flechas</span>
                <span className="text-xs font-bold text-cyan-neon mt-0.5 block">{phase.weeklyArrowGoal} flechas</span>
              </div>
            </div>

            {phase.notes && (
              <p className="text-[10px] text-white/50 leading-relaxed italic border-t border-white/[0.03] pt-2.5 mt-0.5">
                "{phase.notes}"
              </p>
            )}
          </div>
        );
      })()}

      {/* Attendance Stats Widget */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/5 flex justify-between items-center gap-4">
        <div className="flex flex-col gap-1.5 w-[65%]">
          <span className="text-[9px] text-gray-dim font-bold uppercase tracking-widest flex items-center gap-1">
            <Award size={12} className="text-cyan-neon" />
            {language === "es" ? "Constancia Mensual" : "Monthly Attendance"}
          </span>
          <h4 className="text-white text-xs font-extrabold leading-tight">
            {language === "es" ? "Tu constancia de entrenamiento" : "Your training consistency"}
          </h4>
          <p className="text-[10px] text-gray-dim leading-snug">
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
            <span className="text-[10px] font-black text-white">{attendanceRate}%</span>
          </div>
        </div>
      </div>

      {/* Event list */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center px-1">
          <span className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {language === "es" ? "Eventos de este mes" : "Events this month"}
          </span>
          <span className="text-[10px] text-gray-dim">
            {monthEvents.length} {monthEvents.length === 1 ? "evento" : "eventos"}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {monthEvents.length === 0 ? (
            <div className="p-8 rounded-3xl border border-white/[0.03] bg-neutral-900/20 text-center flex flex-col items-center gap-2">
              <CalendarIcon size={24} className="text-gray-dim/40" />
              <p className="text-xs text-gray-dim">
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
                        <span className={`text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-extrabold ${getEventBadgeColor(ev.type)}`}>
                          {ev.type === "competition" ? "Competencia" :
                           ev.type === "training" ? "Entrenamiento" :
                           ev.type === "meeting" ? "Reunión" : "Otro"}
                        </span>
                        
                        {isCoachEvent && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full border border-yellow-gold/25 text-yellow-gold bg-yellow-gold/5 uppercase tracking-wider font-extrabold flex items-center gap-1">
                            <Shield size={9} />
                            <span>Asignado por Coach</span>
                          </span>
                        )}

                        {ev.phaseName && (
                          <span 
                            style={{ color: ev.phaseColor, backgroundColor: `${ev.phaseColor}15`, borderColor: `${ev.phaseColor}30` }}
                            className="text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase"
                          >
                            {ev.phaseName}
                          </span>
                        )}
                      </div>

                      <h4 className="text-white text-xs font-black mt-1">{ev.title}</h4>
                      
                      <div className="flex items-center gap-1 text-[9px] text-gray-dim">
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
                    <span className={`text-[10px] px-2.5 py-1 rounded-xl font-extrabold uppercase border ${countdown.colorClass}`}>
                      {countdown.text}
                    </span>
                  </div>

                  {ev.description && (
                    <p className="text-[10px] text-gray-dim leading-relaxed border-t border-white/[0.02] pt-2">
                      {ev.description}
                    </p>
                  )}

                  {/* Actions (Edit / Delete) */}
                  <div className="flex justify-end gap-1.5 border-t border-white/[0.03] pt-2" onClick={(e) => e.stopPropagation()}>
                    {canEdit ? (
                      <>
                        <button
                          onClick={() => handleOpenEdit(ev)}
                          className="p-1.5 rounded-lg border border-white/5 bg-neutral-950 text-gray-dim hover:text-white transition cursor-pointer"
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
                      <span className="text-[9px] text-gray-dim flex items-center gap-1">
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
                    <span className="text-[9px] text-cyan-neon font-black uppercase tracking-widest block">
                      Detalle del Día
                    </span>
                    <h3 className="text-sm font-black text-white capitalize mt-0.5">
                      {formattedDayTitle}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${countdown.colorClass}`}>
                      {countdown.text}
                    </span>
                    <button
                      onClick={() => setShowDayModal(false)}
                      className="p-1 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* 1. SECCIÓN PRINCIPAL: ASIGNACIÓN DEL ENTRENADOR */}
                <div className="flex flex-col gap-2">
                  <span className="text-[9px] text-white/50 uppercase font-black tracking-widest flex items-center gap-1.5">
                    <Shield size={12} className="text-yellow-gold" />
                    <span>Plan del Entrenador para este Día</span>
                  </span>

                  {coachAssignment ? (
                    <div className="bg-gradient-to-br from-neutral-900/90 to-neutral-950 border border-white/10 rounded-3xl p-4 flex flex-col gap-3 relative overflow-hidden shadow-xl">
                      {/* Left accent color bar */}
                      <div
                        style={{ backgroundColor: coachAssignment.phaseColor || "#00E5FF" }}
                        className="absolute left-0 top-0 bottom-0 w-[4px]"
                      />

                      {/* Header row */}
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-yellow-gold/15 text-yellow-gold border border-yellow-gold/30 flex items-center gap-1">
                              <Shield size={9} />
                              <span>Asignado por: {coachAssignment.createdByName}</span>
                            </span>

                            {coachAssignment.phaseName && (
                              <span
                                style={{
                                  color: coachAssignment.phaseColor,
                                  backgroundColor: `${coachAssignment.phaseColor}15`,
                                  borderColor: `${coachAssignment.phaseColor}30`
                                }}
                                className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full border"
                              >
                                {coachAssignment.phaseName}
                              </span>
                            )}
                          </div>

                          <h4 className="text-white text-sm font-black uppercase mt-1">
                            {coachAssignment.title}
                          </h4>
                        </div>

                        {/* Edit button if coach */}
                        {isCoach && (
                          <button
                            onClick={() => handleOpenEditAssignment(coachAssignment)}
                            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-neon border border-cyan-neon/30 transition text-[9px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit2 size={11} />
                            <span>Editar</span>
                          </button>
                        )}
                      </div>

                      {/* Meta de Flechas */}
                      {!coachAssignment.isRestDay && coachAssignment.targetArrows ? (
                        <div className="bg-neutral-950/70 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-dim uppercase font-bold flex items-center gap-1">
                              <Target size={12} className="text-cyan-neon" />
                              <span>Meta de Flechas Asignada</span>
                            </span>
                            <span className="text-xs font-black text-cyan-neon">
                              {coachAssignment.targetArrows} flechas
                            </span>
                          </div>

                          {/* Progress bar comparing with arrows shot */}
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[9px]">
                              <span className="text-white/40">Progreso del arquero hoy:</span>
                              <span className="text-white font-extrabold">
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
                                className="h-full rounded-full transition-all duration-500 shadow-glow-cyan"
                              />
                            </div>
                          </div>

                          {arrowsShot >= coachAssignment.targetArrows && (
                            <div className="flex items-center gap-1 text-[9px] text-green-400 font-bold bg-green-500/10 px-2 py-1 rounded-xl border border-green-500/20">
                              <CheckCircle2 size={12} />
                              <span>¡Meta de flechas cumplida con éxito!</span>
                            </div>
                          )}
                        </div>
                      ) : coachAssignment.isRestDay ? (
                        <div className="bg-neutral-950/70 p-3 rounded-2xl border border-white/5 text-xs text-green-400 flex items-center gap-2">
                          <Flame size={14} className="text-green-400" />
                          <span>Día de Descanso y Recuperación Activa asignado por tu entrenador.</span>
                        </div>
                      ) : null}

                      {/* Technical & Physical Focus Points */}
                      {coachAssignment.focusPoints && coachAssignment.focusPoints.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-t border-white/[0.04] pt-2">
                          <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">
                            Enfoque Técnico y Físico
                          </span>
                          <div className="flex flex-col gap-1">
                            {coachAssignment.focusPoints.map((pt, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-white/90">
                                <CheckCircle2 size={12} className="text-cyan-neon shrink-0" />
                                <span>{pt}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Coach Notes */}
                      {(coachAssignment.coachNotes || coachAssignment.description) && (
                        <div className="flex flex-col gap-1 border-t border-white/[0.04] pt-2">
                          <span className="text-[9px] text-white/40 uppercase font-black tracking-widest">
                            Indicaciones del Entrenador
                          </span>
                          <p className="text-xs text-white/80 italic leading-relaxed bg-neutral-950/50 p-2.5 rounded-xl border border-white/[0.03]">
                            "{coachAssignment.coachNotes || coachAssignment.description}"
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
                          className="w-full mt-1 py-3 rounded-2xl bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-black text-xs uppercase tracking-wider shadow-glow-cyan flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition"
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
                        <span className="text-[9px] text-gray-dim">Plan: {activePhaseInfo.macroName}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] bg-neutral-950/50 p-2 rounded-xl border border-white/5">
                        <div>
                          <span className="text-white/30 block uppercase font-bold text-[8px]">Meta Semanal</span>
                          <span className="text-white font-medium">{activePhaseInfo.phase.weeklySessionGoal} sesiones</span>
                        </div>
                        <div>
                          <span className="text-white/30 block uppercase font-bold text-[8px]">Flechas Semanales</span>
                          <span className="text-cyan-neon font-medium">{activePhaseInfo.phase.weeklyArrowGoal} flechas</span>
                        </div>
                      </div>

                      {activePhaseInfo.phase.notes && (
                        <p className="text-[10px] text-white/60 italic">"{activePhaseInfo.phase.notes}"</p>
                      )}

                      {isCoach && (
                        <button
                          onClick={() => handleOpenCreateAssignment(selectedDay, activePhaseInfo)}
                          className="mt-1 py-2 rounded-xl bg-cyan-neon text-black font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 shadow-glow-cyan cursor-pointer"
                        >
                          <Plus size={12} />
                          <span>Asignar Tarea Específica para este Día</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="bg-neutral-900/20 border border-white/5 rounded-2xl p-4 text-center flex flex-col items-center gap-2">
                      <p className="text-xs text-white/40">No hay asignación programada para esta fecha.</p>
                      {isCoach && (
                        <button
                          onClick={() => handleOpenCreateAssignment(selectedDay, null)}
                          className="py-1.5 px-3 rounded-xl bg-cyan-neon text-black font-black text-[10px] uppercase tracking-wider flex items-center gap-1 shadow-glow-cyan cursor-pointer"
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
                  <span className="text-[9px] text-white/50 uppercase font-black tracking-widest flex items-center justify-between">
                    <span>Sesiones Realizadas en esta Fecha</span>
                    <span className="text-cyan-neon font-black">{arrowsShot} flechas totales</span>
                  </span>

                  {daySessions.length === 0 ? (
                    <p className="text-[11px] text-white/30 py-2 text-center bg-neutral-950/30 rounded-2xl">
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
                            <span className="text-[9px] text-white/40">
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
                    <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">
                      Otros Eventos Programados
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {dayEvents.filter(e => !e.macrocycleId && e.targetArrows === undefined).map(ev => (
                        <div key={ev.id} className="bg-neutral-950/40 p-2.5 rounded-xl border border-white/5 flex justify-between items-center">
                          <div>
                            <span className="text-xs font-bold text-white block">{ev.title}</span>
                            <span className="text-[9px] text-gray-dim">{ev.description}</span>
                          </div>
                          <span className={`text-[8px] px-2 py-0.5 rounded-full border uppercase font-bold ${getEventBadgeColor(ev.type)}`}>
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
                  <div className="w-8 h-8 rounded-xl bg-yellow-gold/15 border border-yellow-gold/30 text-yellow-gold flex items-center justify-center shadow-glow-yellow/10">
                    <RefreshCw size={15} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Sincronizar Calendario
                    </h3>
                    <span className="text-[9px] text-gray-dim block">
                      Mes: <strong className="text-white capitalize">{monthName}</strong>
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
                  Esta acción sincronizará el ciclo con el calendario de la app para todos los días de{" "}
                  <strong className="text-cyan-neon capitalize">{monthName}</strong>. 
                  Tus arqueros podrán entrar a cada día y ver sus metas de flechas, puntos técnicos y notas asignadas.
                </p>

                {/* Macrocycle Selector */}
                <div className="flex flex-col gap-1 mt-1">
                  <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">
                    Seleccionar Plan / Macrociclo
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
                      <span className="text-[9px] text-white/40 uppercase font-bold">Fases Configurada(s)</span>
                      <div className="flex flex-wrap gap-1.5">
                        {macro.phases?.map((p) => (
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
                  );
                })()}

                {/* Action Button */}
                <button
                  type="button"
                  disabled={isSyncing || macrocycles.length === 0}
                  onClick={handleSyncCycleToMonth}
                  className="w-full mt-2 py-3 rounded-2xl bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider shadow-glow-yellow flex items-center justify-center gap-2 cursor-pointer hover:brightness-105 active:scale-98 transition disabled:opacity-40"
                >
                  <Sparkles size={14} />
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
                  <span className="text-[9px] text-cyan-neon font-black block mt-0.5">
                    Fecha: {assignDate}
                  </span>
                </div>
                <button
                  onClick={() => setShowAssignmentModal(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveDailyAssignment} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">
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
                  <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">
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
                  <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">
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
                  <label className="text-[9px] text-white/40 uppercase font-black tracking-widest">
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
                  className="p-1 rounded-lg text-gray-dim hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
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
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
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
                        className={`py-2 rounded-xl border text-[10px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
                          eventType === type.value
                            ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                            : "border-white/5 bg-neutral-950 text-gray-dim hover:text-white"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
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
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
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
                  className="w-full py-3.5 mt-2 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer transition active:scale-[0.98]"
                >
                  {modalMode === "add" ? "Programar Evento" : "Guardar Cambios"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
