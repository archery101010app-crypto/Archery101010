"use client";

import React from "react";
import { Home, Target, History, Calendar, User, Users, Shield, Gauge } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";

function SpotifyNavIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="currentColor" 
      className={className}
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.495 17.307a.75.75 0 0 1-1.032.248c-2.825-1.726-6.38-2.116-10.57-1.16a.75.75 0 1 1-.336-1.462c4.582-1.045 8.528-.601 11.69 1.342a.75.75 0 0 1 .248 1.032zm1.467-3.26a.938.938 0 0 1-1.29.31c-3.235-1.988-8.166-2.564-11.993-1.401a.938.938 0 1 1-.547-1.794c4.372-1.328 9.803-.687 13.52 1.595a.938.938 0 0 1 .31 1.29zm.126-3.411c-3.878-2.302-10.28-2.515-13.99-1.388a1.125 1.125 0 1 1-.655-2.154c4.27-1.297 11.332-1.046 15.807 1.61a1.125 1.125 0 0 1-1.162 1.932z" />
    </svg>
  );
}

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

  // For coach: Director & stats receiver (no arrow counter, no duels, no scoring sheets)
  const navItems = isCoach
    ? [
        { id: "HOME" as Screen, icon: Users, label: "Director" },
        { id: "HISTORY" as Screen, icon: History, label: "Resultados" },
        { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendario" },
        { id: "SPOTIFY" as any, icon: SpotifyNavIcon, label: "Spotify", isAction: true },
        { id: "PROFILE" as Screen, icon: User, label: "Perfil" }
      ]
    : [
        { id: "HOME" as Screen, icon: Home, label: "Inicio" },
        { id: "TARGET" as Screen, icon: Target, label: "Sesión" },
        { id: "HISTORY" as Screen, icon: History, label: "Historial" },
        { id: "CHRONOGRAPH" as Screen, icon: Gauge, label: "Crono", isPro: true },
        { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendario" },
        { id: "SPOTIFY" as any, icon: SpotifyNavIcon, label: "Spotify", isAction: true },
        { id: "PROFILE" as Screen, icon: User, label: "Perfil" }
      ];

  if (isSuper) {
    navItems.push({ id: "ADMIN" as Screen, icon: Shield, label: "Admin" });
  }

  const uniqueItems = navItems.filter((item, idx, arr) => 
    arr.findIndex(i => i.label === item.label) === idx
  );

  return (
    <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-[390px]">
      <div className="bg-[#0A0B0E]/95 backdrop-blur-md rounded-2xl border border-white/[0.08] px-2.5 sm:px-3.5 py-2 flex items-center justify-around shadow-[0_12px_32px_rgba(0,0,0,0.85)]">
        {uniqueItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;
          const isProBlocked = item.isPro && user?.plan === "FREE";

          return (
            <button
              key={item.label}
              onClick={() => {
                if (item.isAction) {
                  window.dispatchEvent(new CustomEvent("open-spotify-player"));
                } else {
                  onScreenChange(item.id);
                }
              }}
              title={item.label}
              aria-label={item.label}
              className="relative flex flex-col items-center justify-center py-1 px-1 cursor-pointer outline-none group flex-1"
            >
              {/* Active matte surface indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeGlow"
                  className="absolute inset-0 bg-white/[0.05] border border-white/[0.08] rounded-xl"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}

              {/* Icon wrapper with PRO badge */}
              <div className="relative flex items-center justify-center">
                <Icon
                  size={18}
                  className={`transition-colors duration-200 relative z-10 ${
                    isActive
                      ? "text-cyan-neon"
                      : isProBlocked
                      ? "text-yellow-gold/80 group-hover:text-yellow-gold"
                      : "text-white group-hover:text-white"
                  }`}
                />
                {item.isPro && (
                  <span className="absolute -top-1.5 -right-2.5 text-[7px] bg-yellow-gold text-black font-black px-1 py-[0.5px] rounded-[3px] uppercase scale-90 z-20 tracking-wider">
                    PRO
                  </span>
                )}
              </div>

              {/* Label indicator */}
              <span
                className={`text-[8px] font-bold tracking-tight mt-1 leading-none transition-colors duration-200 relative z-10 ${
                  isActive ? "text-white font-black" : "text-white group-hover:text-white"
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
