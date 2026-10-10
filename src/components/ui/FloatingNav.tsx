"use client";

import React from "react";
import { Home, Target, History, Calendar, User, Users, Shield, Gauge, Sparkles } from "lucide-react";
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

  // For coach: Director & stats receiver (no arrow counter, no duels, no scoring sheets)
  const navItems = isCoach
    ? [
        { id: "HOME" as Screen, icon: Users, label: "Director" },
        { id: "HISTORY" as Screen, icon: History, label: "Resultados" },
        { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendario" },
        { id: "PROFILE" as Screen, icon: User, label: "Perfil" }
      ]
    : [
        { id: "HOME" as Screen, icon: Home, label: "Home" },
        { id: "TARGET" as Screen, icon: Target, label: "Sesión" },
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
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-[340px]">
      <div className="bg-neutral-900/85 backdrop-blur-xl rounded-full border border-white/10 px-5 py-2.5 flex items-center justify-between shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        {uniqueItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;

            const isProBlocked = item.isPro && user?.plan === "FREE";

            return (
              <button
                key={item.label}
                onClick={() => {
                  if (isProBlocked) {
                    onScreenChange("PROFILE");
                  } else {
                    onScreenChange(item.id);
                  }
                }}
                className="relative flex flex-col items-center justify-center p-1.5 cursor-pointer outline-none group"
              >
                {/* Highlight active glow behind icon */}
                {isActive && (
                  <motion.div
                    layoutId="activeGlow"
                    className="absolute inset-0 bg-cyan-neon/5 rounded-full blur-md"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}

                {/* Icon wrapper with PRO badge */}
                <div className="relative">
                  <Icon
                    size={22}
                    className={`transition-colors duration-200 relative z-10 ${
                      isActive
                        ? "text-cyan-neon shadow-glow-cyan"
                        : isProBlocked
                        ? "text-yellow-gold/80 group-hover:text-yellow-gold"
                        : "text-gray-dim group-hover:text-white"
                    }`}
                  />
                  {item.isPro && (
                    <span className="absolute -top-1.5 -right-2 text-[7px] bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black px-1 rounded-full uppercase scale-90 z-20 shadow-glow-yellow">
                      PRO
                    </span>
                  )}
                </div>

                {/* Active dot indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeDot"
                    className="w-1.5 h-1.5 rounded-full bg-cyan-neon mt-1 shadow-glow-cyan"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                
                {!isActive && <div className="w-1.5 h-1.5 mt-1 bg-transparent" />}
              </button>
            );
        })}
      </div>
    </div>
  );
}
