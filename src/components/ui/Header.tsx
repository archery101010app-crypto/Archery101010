"use client";

import React from "react";
import { useSync } from "@/hooks/useSync";
import { UserProfile, isLinkedToExternalCoach } from "@/lib/authService";
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
  const { language, t } = useLanguage();
  const isEs = language === "es";
  const linkedToCoach = isLinkedToExternalCoach(user);

  return (
    <header className="fixed top-0 left-0 right-0 h-13 bg-black-oled/95 backdrop-blur-md border-b border-gray-border/40 px-3.5 sm:px-6 flex items-center justify-between gap-2 z-40 max-w-full">
      {/* Official Brand Lockup: ARCHERY 101010 */}
      <div translate="no" dir="ltr" className="notranslate flex items-center gap-2 select-none min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <img
            src="/images/brand_logo_header.png"
            srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
            alt="ARCHERY 101010"
            className="h-[15px] sm:h-[18px] w-auto object-contain shrink-0 select-none pointer-events-none"
            draggable={false}
          />
          <span className="text-cyan-neon text-[12px] sm:text-[13.2px] font-black tracking-wider ps-0.5 tabular-nums shrink-0">
            v{APP_VERSION}
          </span>
        </div>
      </div>

      {/* View Switcher (Athlete / Coach PRO) */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Coach View Switcher Toggle (hidden when user is linked as an athlete to a Coach) */}
        {user && onToggleCoachViewMode && !linkedToCoach && (
          <div className="flex bg-[#090B0E] p-0.5 sm:p-1 rounded-full border border-white/[0.08] items-center">
            <button
              type="button"
              aria-pressed={!coachViewMode}
              onClick={() => onToggleCoachViewMode(false)}
              className={`min-h-[38px] h-[38px] ${
                isEs
                  ? "px-2.5 sm:px-3 rounded-full text-[12px] sm:text-[13px]"
                  : "px-2 sm:px-3 rounded-full text-[11px] min-[390px]:text-[11.8px] sm:text-[13px]"
              } font-bold uppercase tracking-tight flex items-center justify-center whitespace-nowrap transition-all cursor-pointer ${
                !coachViewMode 
                  ? "bg-cyan-neon text-black font-extrabold" 
                  : "text-white hover:text-white"
              }`}
            >
              {t("roleAthlete")}
            </button>
            <button
              type="button"
              aria-pressed={coachViewMode}
              onClick={() => onToggleCoachViewMode(true)}
              className={`min-h-[38px] h-[38px] ${
                isEs
                  ? "px-2.5 sm:px-3 rounded-full text-[12px] sm:text-[13px]"
                  : "px-2 sm:px-3 rounded-full text-[11px] min-[390px]:text-[11.8px] sm:text-[13px]"
              } font-bold uppercase tracking-tight flex items-center justify-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
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
      </div>
    </header>
  );
}
