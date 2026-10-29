"use client";

import React, { useState, useEffect } from "react";
import { useSync } from "@/hooks/useSync";
import { UserProfile } from "@/lib/authService";
import { Wifi, WifiOff, RefreshCw, Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";
import { APP_VERSION } from "@/lib/version";

interface HeaderProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onToggleCoachViewMode?: (val: boolean) => void;
}

export default function Header({ user, coachViewMode = false, onToggleCoachViewMode }: HeaderProps) {
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
    <header className="fixed top-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] bg-black-oled/90 backdrop-blur-md border-b border-gray-border/40 px-4 sm:px-6 flex items-center justify-between z-40 max-w-full">
      {/* Brand logo compact */}
      <div className="flex items-center gap-2 select-none min-w-0">
        <div className="flex items-baseline gap-1">
          <div 
            className="flex text-lg tracking-tighter font-extrabold brand-logo-101010" 
            style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
          >
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </div>
          <span className="text-cyan-neon/60 text-[12px] font-black tracking-wider pl-0.5">
            v{APP_VERSION}
          </span>
        </div>
        <span className="text-white text-[10.8px] font-black tracking-[0.3em] uppercase hidden sm:inline pl-2 border-l border-white/10">
          ARCHERY
        </span>
      </div>

      {/* Sync Wifi Button, Theme Selector, View Switcher & Language Selector */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Coach View Switcher Toggle */}
        {user && onToggleCoachViewMode && (
          <div className="flex bg-[#090B0E] p-1 rounded-full border border-white/[0.08] items-center">
            <button
              onClick={() => onToggleCoachViewMode(false)}
              className={`h-7 px-2.5 sm:px-3 rounded-full text-[11px] font-bold uppercase tracking-wide flex items-center justify-center whitespace-nowrap transition-all cursor-pointer ${
                !coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-white hover:text-white"
              }`}
            >
              Atleta
            </button>
            <button
              onClick={() => onToggleCoachViewMode(true)}
              className={`h-7 px-2.5 sm:px-3 rounded-full text-[11px] font-bold uppercase tracking-wide flex items-center justify-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-white hover:text-white"
              }`}
            >
              <span>Coach</span>
              <span className="text-[8px] bg-yellow-gold text-black font-black px-1 py-0.5 rounded uppercase leading-none">
                PRO
              </span>
            </button>
          </div>
        )}



        {/* Contrast Toggle Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleToggleTheme}
          className="flex items-center justify-center p-2 rounded-full bg-neutral-900/60 border border-gray-border hover:border-cyan-brand/30 cursor-pointer text-white hover:text-white transition-all duration-200"
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
              <span className="absolute -top-1 -right-1 bg-orange-500 text-white font-extrabold text-[10.8px] w-4 h-4 rounded-full flex items-center justify-center border border-black animate-bounce">
                {pendingCount}
              </span>
            )}
          </motion.button>

          {/* Sync status tooltip */}
          {showStatusTooltip && (
            <div className="absolute right-0 top-10 bg-neutral-900 border border-gray-border rounded-lg px-2.5 py-1 text-[12px] text-white whitespace-nowrap shadow-xl">
              {isSyncing ? "Conectando..." : syncStatus}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
