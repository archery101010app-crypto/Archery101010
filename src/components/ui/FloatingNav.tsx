"use client";

import React from "react";
import { Home, Target, Activity, History, Calendar, User, Users, Shield, Music } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { useLanguage } from "@/lib/contexts/LanguageContext";

type Screen = "HOME" | "TARGET" | "ANALYSIS" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA" | "ADMIN";

interface FloatingNavProps {
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  user?: UserProfile | null;
  coachViewMode?: boolean;
}

export default function FloatingNav({ activeScreen, onScreenChange, user, coachViewMode = false }: FloatingNavProps) {
  const { language, t } = useLanguage();
  const isEs = language === "es";
  const isCoach = coachViewMode;
  const isSuper = user?.role === "superadmin";

  // For coach: Director & stats receiver (no arrow counter, no duels, no scoring sheets)
  const navItems = isCoach
    ? [
        { id: "HOME" as Screen, icon: Users, label: t("navDirector") },
        { id: "HISTORY" as Screen, icon: History, label: t("navResults") },
        { id: "CALENDAR" as Screen, icon: Calendar, label: t("navCalendar") },
        { id: "SPOTIFY" as any, icon: Music, label: isEs ? "Música" : t("musicNav"), isAction: true },
        { id: "PROFILE" as Screen, icon: User, label: t("navProfile") }
      ]
    : [
        { id: "HOME" as Screen, icon: Home, label: t("navHome") },
        { id: "TARGET" as Screen, icon: Target, label: t("navSession") },
        { id: "ANALYSIS" as Screen, icon: Activity, label: t("navAnalysis") },
        { id: "HISTORY" as Screen, icon: History, label: t("navHistory") },
        { id: "CALENDAR" as Screen, icon: Calendar, label: t("navCalendar") },
        { id: "SPOTIFY" as any, icon: Music, label: isEs ? "Música" : t("musicNav"), isAction: true },
        { id: "PROFILE" as Screen, icon: User, label: t("navProfile") }
      ];

  if (isSuper) {
    navItems.push({ id: "ADMIN" as Screen, icon: Shield, label: isEs ? "Admin" : t("roleAdmin") });
  }

  const uniqueItems = navItems.filter((item, idx, arr) =>
    arr.findIndex((i) => i.id === item.id) === idx
  );

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 w-full bg-[#07090E]/98 backdrop-blur-xl border-t border-white/[0.09] shadow-[0_-10px_28px_rgba(0,0,0,0.9)]">
      <div className="w-full max-w-[430px] mx-auto px-0.5 sm:px-3 py-1.5 flex items-center justify-around gap-0.5">
        {uniqueItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.isAction) {
                  window.dispatchEvent(new CustomEvent("open-spotify-player"));
                } else {
                  onScreenChange(item.id);
                }
              }}
              title={item.label}
              aria-label={item.label}
              className="relative flex flex-col items-center justify-center min-h-[42px] py-1 px-0.5 cursor-pointer outline-none group flex-1 min-w-0"
            >
              {/* Active matte surface indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeGlow"
                  className="absolute inset-0 bg-white/[0.06] border border-white/[0.09] rounded-xl"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}

              {/* Icon wrapper */}
              <div className="relative flex items-center justify-center">
                <Icon
                  size={isCoach ? 21 : 20}
                  className={`transition-colors duration-200 relative z-10 ${
                    isActive
                      ? "text-cyan-neon"
                      : "text-white group-hover:text-white"
                  }`}
                />
              </div>

              {/* Label indicator */}
              <span
                className={`${
                  isCoach
                    ? "text-[11px] sm:text-[12px]"
                    : isEs
                    ? "text-[10px] sm:text-[11.5px]"
                    : "text-[9.4px] min-[385px]:text-[10px] sm:text-[11.5px]"
                } font-bold tracking-[-0.02em] leading-tight mt-1 transition-colors duration-200 relative z-10 text-center break-words leading-tight max-w-full ${
                  isActive ? "text-white font-black" : "text-white group-hover:text-white"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
