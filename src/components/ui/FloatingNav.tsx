"use client";

import React from "react";
import { Home, Target, History, Calendar, User, Users, Shield, Gauge } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";

type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA" | "ADMIN" | "CHRONOGRAPH";

interface FloatingNavProps {
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  user?: UserProfile | null;
  coachViewMode?: boolean;
}

export default function FloatingNav({ activeScreen, onScreenChange, user, coachViewMode = false }: FloatingNavProps) {
  const isCoach = coachViewMode;
  const isSuper = user?.role === "superadmin";

  // Navigation items: clean 5-6 item layout with generous touch targets (>48px)
  const navItems = isCoach
    ? [
        { id: "HOME" as Screen, icon: Users, label: "Director" },
        { id: "HISTORY" as Screen, icon: History, label: "Resultados" },
        { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendario" },
        { id: "PROFILE" as Screen, icon: User, label: "Perfil" }
      ]
    : [
        { id: "HOME" as Screen, icon: Home, label: "Inicio" },
        { id: "TARGET" as Screen, icon: Target, label: "Sesión", isHero: true },
        { id: "HISTORY" as Screen, icon: History, label: "Historial" },
        { id: "CHRONOGRAPH" as Screen, icon: Gauge, label: "Crono", isPro: true },
        { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendario" },
        { id: "PROFILE" as Screen, icon: User, label: "Perfil" }
      ];

  if (isSuper) {
    navItems.push({ id: "ADMIN" as Screen, icon: Shield, label: "Admin" });
  }

  const uniqueItems = navItems.filter((item, idx, arr) => 
    arr.findIndex(i => i.label === item.label) === idx
  );

  return (
    <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-[420px]">
      <div className="bg-[#0D0F12]/95 backdrop-blur-xl rounded-2xl border border-white/[0.08] px-2 sm:px-3 py-1.5 flex items-center justify-between shadow-[0_12px_36px_rgba(0,0,0,0.7)]">
        {uniqueItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;
          const isProBlocked = item.isPro && user?.plan === "FREE";
          const isHero = item.isHero;

          if (isHero) {
            return (
              <button
                key={item.label}
                onClick={() => onScreenChange(item.id)}
                title={item.label}
                aria-label={item.label}
                className={`relative flex flex-col items-center justify-center px-3 py-1.5 rounded-xl transition-all duration-200 cursor-pointer outline-none select-none ${
                  isActive
                    ? "bg-cyan-neon text-black font-black shadow-[0_4px_16px_rgba(0,191,255,0.4)]"
                    : "bg-cyan-neon/15 hover:bg-cyan-neon/25 text-cyan-neon border border-cyan-neon/35"
                }`}
              >
                <div className="flex items-center justify-center">
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 2.2}
                    className="shrink-0"
                  />
                </div>
                <span className={`text-[9px] font-black uppercase tracking-wider mt-0.5 leading-none ${isActive ? "text-black" : "text-cyan-neon"}`}>
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.label}
              onClick={() => onScreenChange(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`relative flex flex-col items-center justify-center py-1.5 px-2.5 rounded-xl cursor-pointer outline-none transition-all duration-200 flex-1 min-w-[46px] select-none group ${
                isActive ? "bg-white/[0.08] text-white" : "text-neutral-400 hover:text-white"
              }`}
            >
              {/* Icon wrapper with PRO badge */}
              <div className="relative flex items-center justify-center">
                <Icon
                  size={19}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  className={`transition-colors duration-200 relative z-10 ${
                    isActive
                      ? "text-cyan-neon"
                      : isProBlocked
                      ? "text-yellow-gold/80 group-hover:text-yellow-gold"
                      : "text-neutral-400 group-hover:text-white"
                  }`}
                />
                {item.isPro && (
                  <span className="absolute -top-1.5 -right-2 text-[7px] bg-yellow-gold text-black font-black px-1 rounded-full uppercase scale-90 z-20">
                    PRO
                  </span>
                )}
              </div>

              {/* Label indicator */}
              <span
                className={`text-[9px] font-bold tracking-tight mt-1 leading-none transition-colors duration-200 ${
                  isActive ? "text-cyan-neon font-bold" : "text-neutral-400 group-hover:text-neutral-200"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
