"use client";

import React, { useState, useEffect, useRef } from "react";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { motion } from "framer-motion";
import { X, Play, Pause, Music, Plus, Globe, Check, ExternalLink, Trash2, Minimize2 } from "lucide-react";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";

// Predefined verified shared playlists for archery sessions
const DEFAULT_PLAYLIST_ID = "37i9dQZF1DWZeKCadgRdKQ"; // Deep Focus

export interface SpotifyItem {
  id: string;
  name: string;
  type?: "playlist" | "album" | "track";
  creator?: string;
  description?: string;
}

const SHARED_PLAYLISTS: SpotifyItem[] = [
  {
    id: "37i9dQZF1DWZeKCadgRdKQ",
    type: "playlist",
    name: "Focus Olímpico",
    creator: "Coach Carlos",
    description: "Deep Focus: instrumental y beats envolventes para máxima concentración.",
  },
  {
    id: "37i9dQZF1DWWQRwui0ExPn",
    type: "playlist",
    name: "Ritmo & Barebow",
    creator: "Archery 101010",
    description: "Lofi Beats: compás relajado y constante para ritmo y cadencia de tiro.",
  },
  {
    id: "37i9dQZF1DWXRqgorJj26U",
    type: "playlist",
    name: "Compound Energy",
    creator: "Laura Archer",
    description: "Rock Classics: energía y potencia para eliminatorias y finales.",
  }
];

const OLD_INVALID_IDS = [
  "37i9dQZF1DX8t6r1AFlv2Y",
  "37i9dQZF1DXaImRpG78avv",
  "37i9dQZF1DWZqd5JICZI01"
];

interface SpotifyFloatingPlayerProps {
  showSideTab?: boolean;
}

export default function SpotifyFloatingPlayer({ showSideTab = true }: SpotifyFloatingPlayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasLoadedIframe, setHasLoadedIframe] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState(DEFAULT_PLAYLIST_ID);
  const [activeType, setActiveType] = useState<"playlist" | "album" | "track">("playlist");
  const [userPlaylistUrl, setUserPlaylistUrl] = useState("");
  const [customPlaylistName, setCustomPlaylistName] = useState("");
  const [customPlaylists, setCustomPlaylists] = useState<SpotifyItem[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEnabledByAdmin, setIsEnabledByAdmin] = useState(true);

  // Playback & Mini-Bar states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMiniBarActive, setIsMiniBarActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Load active playlist and custom playlists on mount
  useEffect(() => {
    async function loadSpotifyConfig() {
      const flag = await getLocalSetting<boolean>("flag_spotify_enabled", true);
      setIsEnabledByAdmin(flag !== false);

      let savedId = await getLocalSetting<string>("spotify_active_id", DEFAULT_PLAYLIST_ID);
      if (!savedId || OLD_INVALID_IDS.includes(savedId)) {
        savedId = DEFAULT_PLAYLIST_ID;
        await saveLocalSetting("spotify_active_id", DEFAULT_PLAYLIST_ID);
      }

      const savedType = await getLocalSetting<"playlist" | "album" | "track">("spotify_active_type", "playlist");
      const savedCustom = await getLocalSetting<SpotifyItem[]>("spotify_custom_lists", []);

      setActivePlaylistId(savedId);
      setActiveType(savedType || "playlist");
      setCustomPlaylists(savedCustom);
    }
    loadSpotifyConfig();

    const handleToggle = () => {
      setIsOpen(prev => {
        const next = !prev;
        if (next) setHasLoadedIframe(true);
        return next;
      });
    };
    window.addEventListener("open-spotify-player", handleToggle);
    return () => window.removeEventListener("open-spotify-player", handleToggle);
  }, []);

  // Register Android / mobile back button to minimize modal cleanly
  useEffect(() => {
    if (isOpen) {
      setHasLoadedIframe(true);
      return registerModalDismiss(() => {
        setIsOpen(false);
        if (isPlaying) {
          setIsMiniBarActive(true);
        }
      });
    }
  }, [isOpen, isPlaying]);

  // Listen to real Spotify Embed postMessage events (playback_update / ready)
  useEffect(() => {
    const handleSpotifyMessage = (event: MessageEvent) => {
      if (!event.origin.includes("spotify.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data) return;

        if (data.type === "playback_update" && data.payload) {
          const playingNow = !data.payload.isPaused;
          setIsPlaying(playingNow);
          if (playingNow) {
            setIsMiniBarActive(true);
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    window.addEventListener("message", handleSpotifyMessage);
    return () => window.removeEventListener("message", handleSpotifyMessage);
  }, []);

  // Send command to Spotify Embed IFrame
  const sendSpotifyCommand = (command: "toggle" | "pause" | "resume") => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage({ command }, "*");
      } catch (e) {
        console.warn("Could not postMessage to Spotify iframe:", e);
      }
    }
  };

  const handleTogglePlayPause = () => {
    sendSpotifyCommand("toggle");
    setIsPlaying(prev => !prev);
  };

  // Helper to extract Spotify ID and type (playlist, album, track) from any Spotify URL or URI
  const extractSpotifyItem = (input: string): { id: string; type: "playlist" | "album" | "track" } | null => {
    if (!input) return null;
    const trimmed = input.trim();

    // 1. Standard or regional URL: https://open.spotify.com/(intl-xx/)?(playlist|album|track)/ID
    const urlMatch = trimmed.match(/spotify\.com\/(?:intl-[a-zA-Z-]+\/)?(playlist|album|track)\/([a-zA-Z0-9]{22})/);
    if (urlMatch) {
      return {
        type: urlMatch[1] as "playlist" | "album" | "track",
        id: urlMatch[2]
      };
    }

    // 2. Spotify URI: spotify:(playlist|album|track):ID
    const uriMatch = trimmed.match(/spotify:(playlist|album|track):([a-zA-Z0-9]{22})/);
    if (uriMatch) {
      return {
        type: uriMatch[1] as "playlist" | "album" | "track",
        id: uriMatch[2]
      };
    }

    // 3. Raw 22-character alphanumeric ID (default to playlist)
    if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
      return { id: trimmed, type: "playlist" };
    }

    return null;
  };

  const handleAddPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPlaylistUrl) return;

    const extracted = extractSpotifyItem(userPlaylistUrl);
    if (!extracted) {
      alert("Por favor, pega un enlace válido de Spotify (Playlist, Álbum o Canción desde Compartir ➔ Copiar enlace).");
      return;
    }

    const cleanName = customPlaylistName.trim() || `Mi Playlist (${customPlaylists.length + 1})`;
    const newItem: SpotifyItem = {
      id: extracted.id,
      type: extracted.type,
      name: cleanName
    };
    const newList = [...customPlaylists.filter(p => p.id !== extracted.id), newItem];

    setCustomPlaylists(newList);
    setActivePlaylistId(extracted.id);
    setActiveType(extracted.type);
    setIsMiniBarActive(true);
    await saveLocalSetting("spotify_custom_lists", newList);
    await saveLocalSetting("spotify_active_id", extracted.id);
    await saveLocalSetting("spotify_active_type", extracted.type);

    setUserPlaylistUrl("");
    setCustomPlaylistName("");
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);

    // Scroll up to the active player so user sees it loaded
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteCustomPlaylist = async (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation();
    const updated = customPlaylists.filter(p => p.id !== idToDelete);
    setCustomPlaylists(updated);
    await saveLocalSetting("spotify_custom_lists", updated);
    if (activePlaylistId === idToDelete) {
      setActivePlaylistId(DEFAULT_PLAYLIST_ID);
      setActiveType("playlist");
      await saveLocalSetting("spotify_active_id", DEFAULT_PLAYLIST_ID);
      await saveLocalSetting("spotify_active_type", "playlist");
    }
  };

  const handleSelectPlaylist = async (item: SpotifyItem) => {
    const itemType = item.type || "playlist";
    setActivePlaylistId(item.id);
    setActiveType(itemType);
    setIsMiniBarActive(true);
    await saveLocalSetting("spotify_active_id", item.id);
    await saveLocalSetting("spotify_active_type", itemType);

    // Scroll to top of modal so user can press play or see the loaded widget
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleOpenInNativeSpotify = () => {
    const webUrl = `https://open.spotify.com/${activeType}/${activePlaylistId}`;
    window.open(webUrl, "_blank", "noopener,noreferrer");
  };

  if (!isEnabledByAdmin) {
    return null;
  }

  const activePlaylistObj =
    SHARED_PLAYLISTS.find(p => p.id === activePlaylistId) ||
    customPlaylists.find(p => p.id === activePlaylistId);

  return (
    <>
      {/* 1. Spotify Collapsible Folding Tab on the Left Edge (Visible on Home) */}
      {showSideTab && !isOpen && !isMiniBarActive && (
        <div className="fixed left-0 top-[calc(50%+112px)] -translate-y-1/2 z-[40] scale-90 origin-left">
          <button
            onClick={() => {
              setHasLoadedIframe(true);
              setIsOpen(true);
            }}
            aria-label="Abrir Spotify"
            className="h-28 w-8 md:w-9 flex flex-col items-center justify-between py-2.5 px-1 rounded-r-2xl bg-[#1DB954] border-y border-r border-black/15 cursor-pointer text-black hover:brightness-105 transition-all duration-300 select-none"
          >
            <div className="text-black flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <span
              className="text-[8px] font-black tracking-[0.25em] uppercase text-black"
              style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
            >
              Spotify
            </span>
          </button>
        </div>
      )}

      {/* 1.5 Mini Player Bar (Visible when collapsed and active; iframe stays alive in DOM) */}
      {!isOpen && isMiniBarActive && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-[80px] left-4 right-4 z-[990] h-12 bg-neutral-950/95 backdrop-blur-md border border-neutral-800 rounded-xl px-3 flex items-center justify-between shadow-2xl hover:border-[#1DB954]/30 transition-all max-w-md mx-auto"
        >
          <div
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2.5 overflow-hidden w-[62%] cursor-pointer"
          >
            <div
              className={`w-7 h-7 rounded-full bg-[#1DB954] flex items-center justify-center text-black shrink-0 ${
                isPlaying ? "animate-spin [animation-duration:8s]" : ""
              }`}
            >
              <Music size={14} />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-[9px] text-[#1DB954] font-black uppercase tracking-widest leading-none">
                {isPlaying ? "Reproduciendo en vivo" : "Spotify Listo"}
              </span>
              <span className="text-[10px] text-white font-bold truncate leading-snug mt-0.5">
                {activePlaylistObj ? activePlaylistObj.name : "Focus Olímpico"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Play/Pause Real Control Button */}
            <button
              onClick={handleTogglePlayPause}
              className="p-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-[#1DB954] hover:text-white cursor-pointer hover:bg-neutral-800 transition"
              title={isPlaying ? "Pausar" : "Reproducir"}
            >
              {isPlaying ? (
                <Pause size={12} fill="currentColor" />
              ) : (
                <Play size={12} fill="currentColor" className="translate-x-[0.5px]" />
              )}
            </button>

            {/* Expand Button */}
            <button
              onClick={() => setIsOpen(true)}
              className="text-[9px] bg-neutral-900 border border-neutral-800 text-gray-300 px-2 py-1 rounded-lg uppercase font-black cursor-pointer hover:text-white transition"
              title="Abrir panel de Spotify"
            >
              Abrir
            </button>

            {/* Close Button (✕) - stops player and hides mini-bar */}
            <button
              onClick={() => {
                sendSpotifyCommand("pause");
                setIsMiniBarActive(false);
                setIsPlaying(false);
              }}
              className="p-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-gray-400 hover:text-red-rival cursor-pointer transition"
              title="Cerrar reproductor"
            >
              <X size={12} />
            </button>
          </div>
        </motion.div>
      )}

      {/* 2. Persistent Glassmorphic Spotify Panel (Kept mounted once opened so audio NEVER stops when minimized) */}
      {(hasLoadedIframe || isOpen || isMiniBarActive) && (
        <div
          className={`fixed inset-0 z-[99999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 transition-all duration-300 ${
            isOpen
              ? "opacity-100 pointer-events-auto visible"
              : "opacity-0 pointer-events-none invisible"
          }`}
          aria-hidden={!isOpen}
        >
          <div
            className={`w-full max-w-[390px] max-h-[88vh] h-[760px] bg-neutral-950 border border-neutral-800 rounded-[36px] flex flex-col overflow-hidden relative shadow-2xl transition-transform duration-300 ${
              isOpen ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
            }`}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 flex items-center justify-between border-b border-neutral-900 bg-neutral-900/40 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#1DB954] flex items-center justify-center text-black shadow-[0_0_12px_rgba(29,185,84,0.4)]">
                  <Music size={16} />
                </div>
                <div>
                  <h3 className="text-white text-sm font-black uppercase tracking-wider leading-none">
                    Spotify Sync
                  </h3>
                  <span className="text-[9px] text-[#1DB954] font-bold tracking-widest uppercase">
                    Audio continuo en segundo plano
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setIsMiniBarActive(true);
                    setIsOpen(false);
                  }}
                  className="px-2.5 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-gray-300 hover:text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer transition"
                  title="Minimizar manteniendo la música"
                >
                  <Minimize2 size={12} />
                  <span>Minimizar</span>
                </button>
                <button
                  onClick={() => {
                    setIsMiniBarActive(true);
                    setIsOpen(false);
                  }}
                  className="p-2 rounded-full bg-neutral-900 border border-neutral-800 text-gray-400 hover:text-white cursor-pointer transition"
                  title="Cerrar ventana"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-5 pb-8 scrollbar-none"
            >
              {/* 1. Main Spotify Web Player Widget */}
              <div className="bg-[#181818] border border-neutral-800 rounded-3xl p-3 shadow-lg flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] text-[#1DB954] font-extrabold tracking-widest uppercase flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isPlaying ? "bg-[#1DB954] animate-ping" : "bg-gray-500"}`} />
                    <span>Reproductor Integrado</span>
                  </span>
                  <span className="text-[9px] text-gray-400 font-bold truncate max-w-[160px]">
                    {activePlaylistObj ? activePlaylistObj.name : "Playlist Activa"}
                  </span>
                </div>

                {/* Embedded Iframe Player - Persistent */}
                <div className="w-full rounded-2xl overflow-hidden bg-neutral-900 h-[152px]">
                  <iframe
                    ref={iframeRef}
                    src={`https://open.spotify.com/embed/${activeType}/${activePlaylistId}?utm_source=generator&theme=0`}
                    width="100%"
                    height="152"
                    frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  />
                </div>

                <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                  <p className="text-[9px] text-gray-400 leading-tight flex-1">
                    Minimiza esta ventana para seguir escuchando mientras anotas flechas, o ábrelo en tu app de Spotify.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenInNativeSpotify}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1DB954] hover:bg-[#1ED760] text-black text-[10px] font-black uppercase tracking-wider transition cursor-pointer shrink-0 shadow-md"
                    title="Abrir directamente en la aplicación de Spotify"
                  >
                    <span>Abrir App Spotify</span>
                    <ExternalLink size={11} />
                  </button>
                </div>
              </div>

              {/* 2. Playlists Compartidas del Club */}
              <div className="flex flex-col gap-2.5">
                <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 pl-1">
                  <Globe size={13} className="text-[#1DB954]" />
                  Playlists Oficiales de Tiro
                </h4>

                <div className="flex flex-col gap-2">
                  {SHARED_PLAYLISTS.map((list) => {
                    const isActive = activePlaylistId === list.id;
                    return (
                      <div
                        key={list.id}
                        onClick={() => handleSelectPlaylist(list)}
                        className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                          isActive
                            ? "bg-[#1DB954]/10 border-[#1DB954]/50"
                            : "bg-neutral-900/50 border-white/5 hover:border-neutral-800"
                        }`}
                      >
                        <div className="flex flex-col gap-1 w-[82%]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white group-hover:text-[#1DB954] transition-colors">
                              {list.name}
                            </span>
                            <span className="text-[8px] bg-neutral-950 text-gray-400 px-1.5 py-0.5 rounded font-extrabold uppercase scale-90">
                              {list.creator}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-snug">
                            {list.description}
                          </p>
                        </div>

                        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-neutral-950 border border-neutral-800 text-gray-400 shrink-0">
                          {isActive ? (
                            <Check size={12} className="text-[#1DB954]" />
                          ) : (
                            <Play size={10} className="fill-current pl-0.5" />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Custom user added playlists */}
                  {customPlaylists.map((list) => {
                    const isActive = activePlaylistId === list.id;
                    return (
                      <div
                        key={list.id}
                        onClick={() => handleSelectPlaylist(list)}
                        className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                          isActive
                            ? "bg-[#1DB954]/10 border-[#1DB954]/50"
                            : "bg-neutral-900/50 border-white/5 hover:border-neutral-800"
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1 pr-2">
                          <span className="text-xs font-bold text-white group-hover:text-[#1DB954] transition-colors flex items-center gap-1.5 truncate">
                            <span className="truncate">{list.name}</span>
                            <span className="text-[8px] bg-neutral-950 text-yellow-gold px-1.5 py-0.5 rounded font-extrabold uppercase shrink-0">
                              MÍA
                            </span>
                          </span>
                          <span className="text-[9px] text-gray-500 font-mono">
                            {list.type === "album" ? "Álbum" : list.type === "track" ? "Canción" : "Playlist"} · {list.id.substring(0, 8)}...
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteCustomPlaylist(e, list.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center bg-neutral-950 border border-neutral-800 text-gray-500 hover:text-red-400 transition"
                            title="Eliminar de mi lista"
                          >
                            <Trash2 size={11} />
                          </button>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-neutral-950 border border-neutral-800 text-gray-400">
                            {isActive ? (
                              <Check size={12} className="text-[#1DB954]" />
                            ) : (
                              <Play size={10} className="fill-current pl-0.5" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Vincular Mi Playlist */}
              <div className="bg-neutral-900/40 border border-white/5 p-4 rounded-3xl flex flex-col gap-2.5">
                <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                  <Plus size={14} className="text-[#1DB954]" />
                  Vincular Mi Música de Spotify
                </h4>

                <form onSubmit={handleAddPlaylist} className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={customPlaylistName}
                    onChange={(e) => setCustomPlaylistName(e.target.value)}
                    placeholder="Nombre opcional (ej. Mi Playlist de Entreno)"
                    maxLength={35}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-[#1DB954] text-white text-xs p-2.5 rounded-xl outline-none transition duration-150 caret-[#1DB954]"
                  />
                  <input
                    type="text"
                    value={userPlaylistUrl}
                    onChange={(e) => setUserPlaylistUrl(e.target.value)}
                    placeholder="Pegar enlace de Spotify (Playlist, Álbum o Canción)"
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-[#1DB954] text-white text-xs p-2.5 rounded-xl outline-none transition duration-150 caret-[#1DB954]"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-[#1DB954] text-black font-black text-xs uppercase tracking-wider cursor-pointer hover:brightness-105 transition flex justify-center items-center gap-1.5 shadow-md shadow-[#1DB954]/15"
                  >
                    {saveSuccess ? (
                      <>
                        <Check size={14} />
                        <span>¡Música Vinculada y Cargada!</span>
                      </>
                    ) : (
                      <span>Cargar y Guardar en Mi Lista</span>
                    )}
                  </button>
                </form>
                <p className="text-[9px] text-gray-500 leading-snug">
                  En Spotify toca <strong>Compartir ➔ Copiar enlace</strong> en cualquier playlist, álbum o canción y pégalo aquí.
                </p>
              </div>
            </div>

            {/* Bottom Decorative Indicator */}
            <div className="h-5 bg-neutral-950 flex justify-center items-center pb-1.5 shrink-0">
              <div className="w-24 h-1 bg-neutral-800 rounded-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
