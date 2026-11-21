"use client";

import React, { useState, useEffect } from "react";
import { getLocalSetting } from "@/lib/db/indexedDB";
import { X, Play } from "lucide-react";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export type SpotifyEntityType = "playlist" | "album" | "track" | "artist" | "show" | "episode";

export interface SpotifyItem {
  id: string;
  name: string;
  nameEn?: string;
  type?: SpotifyEntityType;
  creator?: string;
  description?: string;
  descriptionEn?: string;
}

interface SpotifyFloatingPlayerProps {
  showSideTab?: boolean;
}

export default function SpotifyFloatingPlayer({ showSideTab = false }: SpotifyFloatingPlayerProps) {
  const { tx } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isEnabledByAdmin, setIsEnabledByAdmin] = useState(true);

  useEffect(() => {
    let active = true;
    getLocalSetting<boolean>("flag_spotify_enabled", true)
      .then((flag) => {
        if (active) setIsEnabledByAdmin(flag !== false);
      })
      .catch(() => {});

    const handleToggle = () => {
      setIsOpen((prev) => !prev);
    };
    window.addEventListener("open-spotify-player", handleToggle);
    return () => {
      active = false;
      window.removeEventListener("open-spotify-player", handleToggle);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      return registerModalDismiss(() => {
        setIsOpen(false);
      });
    }
  }, [isOpen]);

  const handleOpenInNativeSpotify = () => {
    setIsOpen(false);
    const webUrl = "https://open.spotify.com";
    const nb = typeof window !== "undefined" ? (window as any).ArcherySpotifyBridge : null;
    if (nb && typeof nb.openInSpotifyApp === "function") {
      nb.openInSpotifyApp("spotify://open", webUrl);
      return;
    }
    window.open(webUrl, "_blank", "noopener,noreferrer");
  };

  if (!isEnabledByAdmin) {
    return null;
  }

  return (
    <>
      {/* 1. Spotify Collapsible Folding Tab on the Start Edge */}
      {showSideTab && !isOpen && (
        <div className="fixed start-0 top-[calc(50%+112px)] -translate-y-1/2 z-[40] scale-90 origin-left rtl:origin-right">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label={tx("Abrir Spotify", "Open Spotify")}
            className="h-28 min-w-[36px] min-h-[36px] w-9 flex flex-col items-center justify-between pt-2.5 pb-3 px-1 rounded-e-2xl bg-[#1DB954] border-y border-e border-black/20 cursor-pointer text-black hover:brightness-105 active:scale-95 transition-all duration-200 select-none shadow-md"
          >
            <div className="text-black flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <span
              className="text-[13.6px] font-bold text-black select-none tracking-[-0.02em] leading-none"
              style={{
                fontFamily: "'Outfit', sans-serif",
                writingMode: "vertical-rl",
                textOrientation: "mixed"
              }}
            >
              Spotify
            </span>
          </button>
        </div>
      )}

      {/* 2. Minimalist Centered OLED Card (Zero 30s Preview, Zero Playlist Clutter) */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-[99999] bg-[#020305]/88 backdrop-blur-md flex items-center justify-center p-5 transition-opacity duration-200"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Spotify"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[368px] bg-[#06080C] border border-white/[0.10] rounded-[26px] p-[18px] flex flex-col gap-4 relative overflow-hidden shadow-2xl"
          >
            {/* Top 101010 tricolor hairline */}
            <div
              className="absolute top-0 inset-x-12 h-[2px]"
              style={{
                background:
                  "linear-gradient(90deg, transparent, #00A8F3 25%, #FF1E1E 50%, #FFE500 75%, transparent)"
              }}
            />

            {/* 1. Single-Line Harmonic Header */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0" dir="ltr">
                <img
                  src="/images/brand_logo_header.png"
                  srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                  alt="ARCHERY 101010"
                  className="h-[12px] w-auto object-contain shrink-0 select-none pointer-events-none"
                  draggable={false}
                />
                <div className="inline-flex items-center gap-[5px] bg-[#071910] border border-[#1DB954]/45 rounded-full px-2 py-[3px] shrink-0">
                  <span className="w-[5px] h-[5px] rounded-full bg-[#1DB954]" />
                  <span className="text-[9px] font-extrabold text-[#1DB954] tracking-[0.08em] uppercase leading-none">
                    SPOTIFY
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-[#12151C] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0 transition"
                title={tx("Cerrar ventana", "Close window")}
                aria-label={tx("Cerrar Spotify", "Close Spotify")}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            {/* 2. Recessed Matte Centerpiece Bay */}
            <div className="bg-[#0B0E14] border border-white/[0.08] rounded-[20px] px-5 pt-[26px] pb-6 flex flex-col items-center text-center gap-[11px]">
              <div
                aria-hidden="true"
                className="w-[58px] h-[58px] rounded-full bg-[#12151C] border border-[#1DB954]/40 flex items-center justify-center text-[#1DB954] mb-0.5 shrink-0"
              >
                <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
              </div>

              <h2 className="text-[18.5px] font-extrabold tracking-[-0.01em] text-white leading-[1.2]">
                {tx("Reproducción Completa", "Full Playback")}
              </h2>

              <p className="text-[12.8px] font-medium text-[#94A3B8] leading-[1.44] max-w-[266px]">
                {tx(
                  "Escucha tu música sin límite de tiempo en segundo plano mientras entrenas.",
                  "Listen to your music with no time limit in the background while you train."
                )}
              </p>
            </div>

            {/* 3. Direct Full-Playback Button */}
            <button
              type="button"
              onClick={handleOpenInNativeSpotify}
              className="w-full min-h-[48px] h-12 rounded-[14px] bg-[#1DB954] hover:bg-[#1ED760] text-[#020305] font-black text-[12.5px] uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition"
            >
              <Play size={14} fill="currentColor" aria-hidden="true" />
              <span>{tx("ABRIR SPOTIFY", "OPEN SPOTIFY")}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
