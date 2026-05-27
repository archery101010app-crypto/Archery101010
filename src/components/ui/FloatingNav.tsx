"use client";

import React from "react";
import { Home, Target, History, Calendar, User } from "lucide-react";
import { motion } from "framer-motion";

type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA";

interface FloatingNavProps {
  activeScreen: Screen;
  onScreenChange: (screen: Screen) => void;
}

export default function FloatingNav({ activeScreen, onScreenChange }: FloatingNavProps) {
  const navItems = [
    { id: "HOME" as Screen, icon: Home, label: "Home" },
    { id: "TARGET" as Screen, icon: Target, label: "Target" },
    { id: "HISTORY" as Screen, icon: History, label: "History" },
    { id: "CALENDAR" as Screen, icon: Calendar, label: "Calendar" },
    { id: "PROFILE" as Screen, icon: User, label: "Profile" }
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-[340px]">
      <div className="bg-neutral-900/85 backdrop-blur-xl rounded-full border border-white/10 px-5 py-2.5 flex items-center justify-between shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onScreenChange(item.id)}
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

              {/* Icon */}
              <Icon
                size={22}
                className={`transition-colors duration-200 relative z-10 ${
                  isActive
                    ? "text-cyan-neon shadow-glow-cyan"
                    : "text-gray-dim group-hover:text-white"
                }`}
              />

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
