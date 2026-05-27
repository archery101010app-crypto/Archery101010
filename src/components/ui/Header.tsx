"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useSync } from "@/hooks/useSync";
import { UserProfile } from "@/lib/authService";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

interface HeaderProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onToggleCoachViewMode?: (val: boolean) => void;
}

export default function Header({ user, coachViewMode = false, onToggleCoachViewMode }: HeaderProps) {
  const { language, setLanguage, t } = useLanguage();
  const { pendingCount, syncStatus, isSyncing, triggerSync } = useSync();
  const [showStatusTooltip, setShowStatusTooltip] = useState(false);

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
    <header className="fixed top-0 left-0 right-0 h-16 bg-black-oled/90 backdrop-blur-md border-b border-gray-border/40 px-5 flex items-center justify-between z-40">
      {/* Brand logo compact */}
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5">
          <div className="w-5 h-5 bg-cyan-neon rounded-md flex items-center justify-center font-black text-[9px] text-black">10</div>
          <div className="w-5 h-5 bg-red-rival rounded-md flex items-center justify-center font-black text-[9px] text-black">10</div>
          <div className="w-5 h-5 bg-yellow-gold rounded-md flex items-center justify-center font-black text-[9px] text-black">10</div>
        </div>
        <span className="text-white text-[11px] font-black tracking-[0.18em] hidden xs:inline">
          {t("appTitle")}
        </span>
      </div>

      {/* Sync Wifi Button, View Switcher & Language Selector */}
      <div className="flex items-center gap-3">
        {/* Coach View Switcher Toggle */}
        {user && user.role === "coach" && onToggleCoachViewMode && (
          <div className="flex bg-neutral-950 p-0.5 rounded-full border border-gray-border/60">
            <button
              onClick={() => onToggleCoachViewMode(false)}
              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all ${
                !coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              Atleta
            </button>
            <button
              onClick={() => onToggleCoachViewMode(true)}
              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all ${
                coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              Coach
            </button>
          </div>
        )}

        {/* Compact i18n selector */}
        <div className="flex bg-neutral-900/60 p-0.5 rounded-full border border-gray-border">
          <button
            onClick={() => setLanguage("es")}
            className={`px-2 py-0.5 rounded-full text-[9px] font-black transition-all ${
              language === "es" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            ES
          </button>
          <button
            onClick={() => setLanguage("en")}
            className={`px-2 py-0.5 rounded-full text-[9px] font-black transition-all ${
              language === "en" ? "bg-cyan-neon/10 text-cyan-neon" : "text-gray-dim hover:text-white"
            }`}
          >
            EN
          </button>
        </div>

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
              <span className="absolute -top-1 -right-1 bg-orange-500 text-white font-extrabold text-[8px] w-4 h-4 rounded-full flex items-center justify-center border border-black animate-bounce">
                {pendingCount}
              </span>
            )}
          </motion.button>

          {/* Sunc status tooltip */}
          {showStatusTooltip && (
            <div className="absolute right-0 top-10 bg-neutral-900 border border-gray-border rounded-lg px-2.5 py-1 text-[9px] text-white whitespace-nowrap shadow-xl">
              {isSyncing ? "Conectando..." : syncStatus}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
