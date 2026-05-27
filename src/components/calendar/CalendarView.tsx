"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { getLocalSessions } from "@/lib/db/indexedDB";
import { ArrowLeft, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Award } from "lucide-react";
import { motion } from "framer-motion";

interface CalendarViewProps {
  user: UserProfile;
  onBack: () => void;
}

export default function CalendarView({ user, onBack }: CalendarViewProps) {
  const { language, t } = useLanguage();

  const [sessions, setSessions] = useState<any[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [attendanceRate, setAttendanceRate] = useState(0);

  useEffect(() => {
    async function loadSessions() {
      const list = await getLocalSessions();
      setSessions(list);
    }
    loadSessions();
  }, []);

  // Compute attendance stats based on current month sessions
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthSessions = sessions.filter((s) => {
      const date = new Date(s.timestamp);
      return date.getFullYear() === year && date.getMonth() === month;
    });

    // Count unique days trained in this month
    const uniqueDaysTrained = new Set(
      monthSessions.map((s) => new Date(s.timestamp).getDate())
    ).size;

    // Estimate training target (e.g. 3 sessions per week = ~12 per month)
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

  // Helper to check if a specific day has an training session registered
  const hasSessionOnDay = (day: number): boolean => {
    return sessions.some((s) => {
      const d = new Date(s.timestamp);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  };

  // Render days array
  const cells = [];

  // Previous month filler cells
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      day: prevMonthDays - i,
      isCurrentMonth: false,
      hasSession: false
    });
  }

  // Current month cells
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({
      day: i,
      isCurrentMonth: true,
      hasSession: hasSessionOnDay(i)
    });
  }

  // Next month filler cells to complete 42 cells grid (6 weeks)
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) {
    cells.push({
      day: i,
      isCurrentMonth: false,
      hasSession: false
    });
  }

  const daysOfWeek = language === "es" 
    ? ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"]
    : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <div className="flex flex-col gap-5 py-4 min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-white text-lg font-black uppercase tracking-wide">
            Calendario de Asistencia
          </h2>
          <p className="text-[10px] text-gray-dim uppercase tracking-wider">Planificación y Registro</p>
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
        <span className="text-white font-extrabold text-sm capitalize">{monthName}</span>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg text-cyan-neon hover:bg-neutral-800 transition cursor-pointer"
        >
          <ChevronRight size={18} />
        </button>
      </div>

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

            return (
              <div
                key={idx}
                className={`aspect-square rounded-full flex flex-col items-center justify-center relative text-xs font-bold transition-all ${
                  !cell.isCurrentMonth
                    ? "text-gray-dim/30 pointer-events-none"
                    : cell.hasSession
                    ? "bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/20 shadow-glow-cyan"
                    : "text-white/80 hover:bg-neutral-900"
                } ${isToday ? "ring-1 ring-cyan-neon" : ""}`}
              >
                <span>{cell.day}</span>
                
                {/* Micro SVG target icon for attended days */}
                {cell.hasSession && (
                  <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-cyan-neon animate-pulse" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Attendance Stats Widget */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/5 flex justify-between items-center gap-4">
        <div className="flex flex-col gap-1.5 w-[60%]">
          <span className="text-[9px] text-gray-dim font-bold uppercase tracking-widest flex items-center gap-1">
            <Award size={12} className="text-cyan-neon" />
            Constancia Mensual
          </span>
          <h4 className="text-white text-sm font-extrabold leading-tight">
            Tu índice de constancia
          </h4>
          <p className="text-[10px] text-gray-dim leading-snug">
            {attendanceRate >= 80 
              ? "¡Excelente consistencia olímpica! Estás entrenando al nivel planeado." 
              : "Continúa asistiendo regularmente para completar tus metas del club."}
          </p>
        </div>

        {/* Circular Progress SVG widget */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <svg className="w-20 h-20 transform -rotate-90">
            <circle
              cx="40"
              cy="40"
              r="30"
              className="stroke-neutral-800"
              strokeWidth="5"
              fill="none"
            />
            <motion.circle
              cx="40"
              cy="40"
              r="30"
              className={attendanceRate >= 75 ? "stroke-yellow-gold" : "stroke-cyan-neon"}
              strokeWidth="5"
              fill="none"
              strokeDasharray="188.4" // 2 * pi * r
              initial={{ strokeDashoffset: 188.4 }}
              animate={{ strokeDashoffset: 188.4 - (188.4 * attendanceRate) / 100 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center pt-0.5">
            <span className="text-xs font-black text-white">{attendanceRate}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
