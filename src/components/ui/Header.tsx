"use client";

import React, { useState, useEffect } from "react";
import { useSync } from "@/hooks/useSync";
import { UserProfile, isLinkedToExternalCoach } from "@/lib/authService";
import { Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";
import { APP_VERSION } from "@/lib/version";
import { useLanguage } from "@/lib/contexts/LanguageContext";

interface HeaderProps {
  user: UserProfile;
  coachViewMode?: boolean;
  onToggleCoachViewMode?: (val: boolean) => void;
}

export default function Header({ user, coachViewMode = false, onToggleCoachViewMode }: HeaderProps) {
  // Keep background sync hook active silently without showing any technical Wi-Fi/badge icon
  useSync();
  const { t } = useLanguage();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const linkedToCoach = isLinkedToExternalCoach(user);

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

  return (
    <header className="fixed top-0 left-0 right-0 h-13 bg-black-oled/95 backdrop-blur-md border-b border-gray-border/40 px-2.5 sm:px-4 flex items-center justify-between gap-1.5 z-40 max-w-full">
      {/* Brand logo compact */}
      <div translate="no" className="notranslate flex items-center gap-1.5 select-none min-w-0">
        <img
          src="/images/brand_logo_header.png"
          srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
          alt="ARCHERY 101010"
          className="h-[10px] min-[390px]:h-[11.5px] sm:h-[14px] w-auto object-contain shrink-0"
        />
        <span className="text-cyan-neon text-[11.5px] sm:text-[13px] font-black tracking-tight tabular-nums shrink-0 leading-none">
          v{APP_VERSION}
        </span>
      </div>

      {/* View Switcher, Theme Selector & Sync Wifi Button */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Coach View Switcher Toggle (hidden when user is linked as an athlete to a Coach) */}
        {user && onToggleCoachViewMode && !linkedToCoach && (
          <div className="flex bg-[#090B0E] p-0.5 sm:p-1 rounded-full border border-white/[0.08] items-center">
            <button
              onClick={() => onToggleCoachViewMode(false)}
              className={`h-7.5 px-2 min-[380px]:px-2.5 sm:px-3 rounded-full text-[12px] sm:text-[13px] font-bold uppercase tracking-tight flex items-center justify-center whitespace-nowrap transition-all cursor-pointer ${
                !coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-white hover:text-white"
              }`}
            >
              {t("roleAthlete")}
            </button>
            <button
              onClick={() => onToggleCoachViewMode(true)}
              className={`h-7.5 px-2 min-[380px]:px-2.5 sm:px-3 rounded-full text-[12px] sm:text-[13px] font-bold uppercase tracking-tight flex items-center justify-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-white hover:text-white"
              }`}
            >
              <span>{t("roleCoach")}</span>
              <span translate="no" className="notranslate text-[9.2px] sm:text-[10px] bg-yellow-gold text-black font-black px-1 py-0.5 rounded uppercase leading-none">
                PRO
              </span>
            </button>
          </div>
        )}



        {/* Contrast Toggle Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleToggleTheme}
          className="flex items-center justify-center p-1.5 sm:p-2 rounded-full bg-neutral-900/60 border border-gray-border hover:border-cyan-brand/30 cursor-pointer text-white hover:text-white transition-all duration-200"
          title={theme === "dark" ? "Fondo Claro" : "Fondo Oscuro"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </motion.button>
      </div>
    </header>
  );
}
