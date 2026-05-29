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
  Info,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CalendarViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function CalendarView({ user, onBack }: CalendarViewProps) {
  const { language, t } = useLanguage();

  const [sessions, setSessions] = useState<any[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendanceRate, setAttendanceRate] = useState(0);
  const [macrocycles, setMacrocycles] = useState<any[]>([]);
  const [selectedMacrocycleId, setSelectedMacrocycleId] = useState<string>("ALL");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<"competition" | "training" | "meeting" | "other">("training");

  // Load Sessions, Events and Macrocycles on Mount
  useEffect(() => {
    async function loadData() {
      const sessionList = await getLocalSessions();
      setSessions(sessionList);
      
      const eventList = await getLocalEvents();
      setEvents(eventList);

      const macroList = await getLocalMacrocycles();
      setMacrocycles(macroList);
    }
    loadData();
  }, []);

  const getPhaseOnDate = (dateStr: string) => {
    const filteredMacros = selectedMacrocycleId === "ALL" 
      ? macrocycles 
      : macrocycles.filter(m => m.id === selectedMacrocycleId);

    for (const macro of filteredMacros) {
      const phase = macro.phases?.find((p: any) => dateStr >= p.startDate && dateStr <= p.endDate);
      if (phase) {
        return { phase, macroName: macro.name };
      }
    }
    return null;
  };

  // Compute attendance stats based on current month sessions
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthSessions = sessions.filter((s) => {
      const date = new Date(s.timestamp);
      return date.getFullYear() === year && date.getMonth() === month;
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

  // Filter events that belong to the user's club or were created by the user
  const visibleEvents = events.filter((e) => {
    if (user.clubId && e.clubId === user.clubId) return true;
    return e.createdByUid === user.uid;
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
        text: language === "es" ? "Falta 1 día" : "1 day left", 
        colorClass: "text-cyan-neon bg-cyan-neon/10 border-cyan-neon/20 shadow-glow-cyan/5", 
        isPast: false 
      };
    } else if (diffDays > 1) {
      return { 
        text: language === "es" ? `Faltan ${diffDays} días` : `${diffDays} days left`, 
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

  // Form handlers
  const handleOpenAdd = () => {
    setModalMode("add");
    setTitle("");
    setEventDate(new Date().toISOString().split("T")[0]);
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
        createdByRole: user.role === "coach" ? "coach" : "archer",
        createdByName: user.fullName,
        createdByUid: user.uid,
        clubId: user.clubId || undefined,
        timestamp: Date.now()
      };

      await saveLocalEvent(eventId, newEvent);

      // Add to sync queue for Firebase
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "events",
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

      // Add to sync queue
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "events",
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

    // Add to sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "events",
      operation: "DELETE",
      payloadId: id,
      payload: {},
      timestamp: Date.now()
    });

    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="flex flex-col gap-5 py-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-white text-lg font-black uppercase tracking-wide">
              {language === "es" ? "Calendario" : "Calendar"}
            </h2>
            <p className="text-[10px] text-gray-dim uppercase tracking-wider">
              {language === "es" ? "Planificación y Eventos" : "Planning & Events"}
            </p>
          </div>
        </div>

        {/* Add Event Button */}
        <button
          onClick={handleOpenAdd}
          className="p-2.5 rounded-full bg-cyan-neon/15 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon cursor-pointer active:scale-95 transition"
          title="Planificar Evento"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Month selection selector */}
      <div className="flex justify-between items-center bg-neutral-900/60 p-3 rounded-2xl border border-white/5">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-white font-extrabold text-sm capitalize">{monthName}</span>
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

            const customStyle = activePhaseInfo
              ? {
                  backgroundColor: `${activePhaseInfo.phase.color}15`,
                  borderColor: `${activePhaseInfo.phase.color}35`,
                  color: activePhaseInfo.phase.color
                }
              : {};

            return (
              <div
                key={idx}
                style={customStyle}
                className={`aspect-square rounded-2xl flex flex-col items-center justify-between py-1.5 relative text-xs font-bold transition-all border ${
                  !cell.isCurrentMonth
                    ? "text-gray-dim/20 border-transparent pointer-events-none"
                    : cell.hasSession && !activePhaseInfo
                    ? "bg-cyan-neon/5 text-cyan-neon border-cyan-neon/15 shadow-glow-cyan/5"
                    : "text-white/80 hover:bg-neutral-900/80 border-white/[0.03]"
                } ${isToday ? "border-cyan-neon shadow-glow-cyan bg-cyan-neon/10" : ""}`}
              >
                <span>{cell.day}</span>
                
                {/* Visual dots for events */}
                <div className="flex flex-col items-center gap-0.5 w-full">
                  {activePhaseInfo && (
                    <span className="text-[7px] font-black uppercase tracking-wider scale-90 opacity-80 leading-none truncate max-w-[90%] mb-0.5">
                      {activePhaseInfo.phase.name}
                    </span>
                  )}
                  <div className="flex gap-0.5 justify-center w-full min-h-[4px]">
                    {cell.dayEvents.slice(0, 3).map((ev, i) => (
                      <span 
                        key={ev.id} 
                        className={`w-1 h-1 rounded-full ${getEventDotColor(ev.type)}`} 
                      />
                    ))}
                    {cell.hasSession && (
                      <span className="w-1 h-1 rounded-full bg-yellow-gold" title="Práctica" />
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

      {/* Event list */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center px-1">
          <span className="text-xs text-gray-dim font-bold uppercase tracking-wider">
            {language === "es" ? "Eventos de este mes" : "Events this month"}
          </span>
          <span className="text-[10px] text-gray-dim">
            {monthEvents.length} {monthEvents.length === 1 ? (language === "es" ? "evento" : "event") : (language === "es" ? "eventos" : "events")}
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
              // Check if user is Archer and event is created by Coach
              const isCoachEvent = ev.createdByRole === "coach";
              const isOwner = ev.createdByUid === user.uid;
              const canEdit = user.role === "coach" || isOwner;

              return (
                <motion.div
                  key={ev.id}
                  layout
                  className="p-4 rounded-3xl border border-white/5 bg-neutral-900/40 flex flex-col gap-3 relative overflow-hidden"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-extrabold ${getEventBadgeColor(ev.type)}`}>
                          {ev.type === "competition" ? (language === "es" ? "Competencia" : "Competition") :
                           ev.type === "training" ? (language === "es" ? "Entrenamiento" : "Training") :
                           ev.type === "meeting" ? (language === "es" ? "Reunión" : "Meeting") :
                           (language === "es" ? "Otro" : "Other")}
                        </span>
                        
                        {isCoachEvent && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full border border-yellow-gold/25 text-yellow-gold bg-yellow-gold/5 uppercase tracking-wider font-extrabold flex items-center gap-0.5">
                            <Lock size={8} />
                            {language === "es" ? "Asignado por Entrenador" : "Assigned by Coach"}
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
                          <span>· {language === "es" ? "Por" : "By"} {ev.createdByName}</span>
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
                  <div className="flex justify-end gap-1.5 border-t border-white/[0.03] pt-2">
                    {canEdit ? (
                      <>
                        <button
                          onClick={() => handleOpenEdit(ev)}
                          className="p-1.5 rounded-lg border border-white/5 bg-neutral-950 text-gray-dim hover:text-white hover:border-white/10 transition cursor-pointer active:scale-95"
                          title="Editar"
                        >
                          <Edit size={11} />
                        </button>
                        <button
                          onClick={() => handleDelete(ev.id)}
                          className="p-1.5 rounded-lg border border-red-rival/10 bg-red-rival/5 text-red-rival hover:bg-red-rival/10 transition cursor-pointer active:scale-95"
                          title="Eliminar"
                        >
                          <Trash2 size={11} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[9px] text-gray-dim flex items-center gap-1">
                        <Lock size={10} />
                        {language === "es" ? "Solo lectura (Coach)" : "Read only (Coach)"}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* Attendance Stats Widget */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/5 flex justify-between items-center gap-4 mt-2">
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
              strokeDasharray="150.8" // 2 * pi * r (2 * 3.14 * 24)
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

      {/* MODAL Dialog: Add / Edit Event */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-sm flex flex-col gap-4 text-left shadow-2xl"
            >
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <h3 className="text-white text-base font-black uppercase">
                  {modalMode === "add" 
                    ? (language === "es" ? "Planificar Evento" : "Plan Event")
                    : (language === "es" ? "Editar Evento" : "Edit Event")}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 rounded-lg text-gray-dim hover:text-white hover:bg-neutral-800 transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex flex-col gap-4">
                {/* Title */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
                    {language === "es" ? "Título" : "Title"}
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={language === "es" ? "Nombre de la competencia o control" : "Name of the event"}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan/20 transition duration-200"
                  />
                </div>

                {/* Event Type */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
                    {language === "es" ? "Tipo de Evento" : "Event Type"}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { value: "training", label: language === "es" ? "Práctica" : "Training" },
                      { value: "competition", label: language === "es" ? "Torneo" : "Tournament" },
                      { value: "meeting", label: language === "es" ? "Reunión" : "Meeting" },
                      { value: "other", label: language === "es" ? "Otro" : "Other" }
                    ] as const).map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setEventType(type.value)}
                        className={`py-2 rounded-xl border text-[10px] font-bold tracking-wider uppercase transition-all duration-200 cursor-pointer ${
                          eventType === type.value
                            ? type.value === "competition"
                              ? "border-red-500 bg-red-500/10 text-red-400"
                              : type.value === "training"
                              ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                              : type.value === "meeting"
                              ? "border-amber-500 bg-amber-500/10 text-amber-400"
                              : "border-purple-500 bg-purple-500/10 text-purple-400"
                            : "border-white/5 bg-neutral-950 text-gray-dim hover:text-white"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
                    {language === "es" ? "Fecha" : "Date"}
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan/20 transition duration-200"
                  />
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">
                    {language === "es" ? "Notas / Detalles" : "Notes / Description"}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={language === "es" ? "Detalles como distancia, hora, diana o requerimientos..." : "Details about the event..."}
                    rows={3}
                    className="w-full bg-neutral-950 border border-neutral-800 text-white text-xs px-3.5 py-2.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan/20 transition duration-200 resize-none"
                  />
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  className="w-full py-3.5 mt-2 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider shadow-glow-cyan cursor-pointer transition active:scale-[0.98]"
                >
                  {modalMode === "add" 
                    ? (language === "es" ? "Programar Evento" : "Schedule Event")
                    : (language === "es" ? "Guardar Cambios" : "Save Changes")}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
