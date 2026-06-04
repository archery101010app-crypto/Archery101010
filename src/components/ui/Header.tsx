"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useSync } from "@/hooks/useSync";
import { UserProfile } from "@/lib/authService";
import { Wifi, WifiOff, RefreshCw, Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";

interface HeaderProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onToggleCoachViewMode?: (val: boolean) => void;
}

export default function Header({ user, coachViewMode = false, onToggleCoachViewMode }: HeaderProps) {
  const { t } = useLanguage();
  const { pendingCount, syncStatus, isSyncing, triggerSync } = useSync();
  const [showStatusTooltip, setShowStatusTooltip] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    async function loadTheme() {
      const { getLocalSetting } = await import("@/lib/db/indexedDB");
      const savedTheme = await getLocalSetting<"dark" | "light">("app_theme", "dark");
      setTheme(savedTheme);
      if (savedTheme === "light") {
        document.documentElement.classList.add("light-contrast");
      } else {
        document.documentElement.classList.remove("light-contrast");
      }
    }
    loadTheme();
  }, []);

  const handleToggleTheme = async () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    const { saveLocalSetting } = await import("@/lib/db/indexedDB");
    await saveLocalSetting("app_theme", nextTheme);
    
    if (nextTheme === "light") {
      document.documentElement.classList.add("light-contrast");
    } else {
      document.documentElement.classList.remove("light-contrast");
    }
  };

  const getSyncColorClass = () => {
    if (isSyncing) return "text-yellow-gold";
    if (pendingCount > 0) return "text-orange-500";
    if (syncStatus === "Sin conexión") return "text-red-rival animate-pulse";
    return "text-cyan-neon";
  };

  const handleSyncClick = async () => {
    setShowStatusTooltip(true);
    await triggerSync();
    setTimeout(() => setShowStatusTooltip(false), 2000);
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] bg-black-oled/90 backdrop-blur-md border-b border-gray-border/40 px-5 flex items-center justify-between z-40">
      {/* Brand logo compact */}
      <div className="flex items-center gap-2 select-none">
        <div className="flex items-baseline gap-1">
          <div 
            className="flex text-lg tracking-tighter font-extrabold" 
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </div>
          <span className="text-cyan-neon/60 text-[10px] font-black tracking-wider pl-0.5">
            v1.1
          </span>
        </div>
        <span className="text-white/40 text-[9px] font-black tracking-[0.3em] uppercase hidden sm:inline pl-2 border-l border-white/10">
          ARCHERY
        </span>
      </div>

      {/* Sync Wifi Button, Theme Selector, View Switcher & Language Selector */}
      <div className="flex items-center gap-3">
        {/* Coach View Switcher Toggle */}
        {user && (user.role === "coach" || user.role === "team_admin_coach") && onToggleCoachViewMode && (
          <div className="flex bg-neutral-950 p-0.5 rounded-full border border-gray-border/60">
            <button
              onClick={() => onToggleCoachViewMode(false)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                !coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              Atleta
            </button>
            <button
              onClick={() => onToggleCoachViewMode(true)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              Coach
            </button>
          </div>
        )}



        {/* Contrast Toggle Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleToggleTheme}
          className="flex items-center justify-center p-2 rounded-full bg-neutral-900/60 border border-gray-border hover:border-cyan-brand/30 cursor-pointer text-white/70 hover:text-white transition-all duration-200"
          title={theme === "dark" ? "Fondo Claro" : "Fondo Oscuro"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </motion.button>

        {/* Sync wifi button with badge count */}
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSyncClick}
            className={`flex items-center justify-center p-2 rounded-full bg-neutral-900/60 border border-gray-border hover:border-cyan-brand/30 cursor-pointer transition-all duration-200 ${getSyncColorClass()}`}
          >
            {isSyncing ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : syncStatus === "Sin conexión" ? (
              <WifiOff size={15} />
            ) : (
              <Wifi size={15} />
            )}

            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-orange-500 text-white font-extrabold text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-black animate-bounce">
                {pendingCount}
              </span>
            )}
          </motion.button>

          {/* Sync status tooltip */}
          {showStatusTooltip && (
            <div className="absolute right-0 top-10 bg-neutral-900 border border-gray-border rounded-lg px-2.5 py-1 text-[10px] text-white whitespace-nowrap shadow-xl">
              {isSyncing ? "Conectando..." : syncStatus}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
