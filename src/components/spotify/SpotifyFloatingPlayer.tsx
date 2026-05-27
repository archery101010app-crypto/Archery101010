"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Music, Plus, Globe, Check } from "lucide-react";

// Predefined shared playlists for the archery club
const SHARED_PLAYLISTS = [
  {
    id: "37i9dQZF1DX8t6r1AFlv2Y",
    name: "Focus Olímpico",
    creator: "Coach Carlos",
    description: "Beats instrumentales para máxima concentración en el tiro.",
  },
  {
    id: "37i9dQZF1DXaImRpG78avv",
    name: "Rhythm & Barebow",
    creator: "José Angel",
    description: "Rifas de rock y beats electrónicos para ritmo de anclaje.",
  },
  {
    id: "37i9dQZF1DWZqd5JICZI01",
    name: "Compound Chill",
    creator: "Laura Archer",
    description: "Lo-Fi y música relajante para soltar tensión en el disparador.",
  }
];

export default function SpotifyFloatingPlayer() {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState("37i9dQZF1DX8t6r1AFlv2Y");
  const [userPlaylistUrl, setUserPlaylistUrl] = useState("");
  const [customPlaylists, setCustomPlaylists] = useState<Array<{id: string, name: string}>>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load active playlist and custom playlists on mount
  useEffect(() => {
    async function loadSpotifyConfig() {
      const savedId = await getLocalSetting<string>("spotify_active_id", "37i9dQZF1DX8t6r1AFlv2Y");
      const savedCustom = await getLocalSetting<Array<{id: string, name: string}>>("spotify_custom_lists", []);
      
      setActivePlaylistId(savedId);
      setCustomPlaylists(savedCustom);
    }
    loadSpotifyConfig();
  }, []);

  // Helper to extract Spotify Playlist ID from various URL formats
  const extractPlaylistId = (url: string): string | null => {
    const regex = /playlist\/([a-zA-Z0-9]{22})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const handleAddPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPlaylistUrl) return;

    const id = extractPlaylistId(userPlaylistUrl);
    if (!id) {
      alert("Por favor, introduce un enlace válido de playlist de Spotify (ej: https://open.spotify.com/.../playlist/ID)");
      return;
    }

    const name = `Mi Playlist (${customPlaylists.length + 1})`;
    const newList = [...customPlaylists, { id, name }];
    
    // Save state and IndexedDB
    setCustomPlaylists(newList);
    setActivePlaylistId(id);
    await saveLocalSetting("spotify_custom_lists", newList);
    await saveLocalSetting("spotify_active_id", id);
    
    setUserPlaylistUrl("");
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleSelectPlaylist = async (id: string) => {
    setActivePlaylistId(id);
    await saveLocalSetting("spotify_active_id", id);
  };

  return (
    <>
      {/* 1. Green Spotify Floating Action Button (Draggable) */}
      {!isOpen && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.05}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="fixed bottom-[140px] left-6 z-[999] cursor-grab active:cursor-grabbing"
        >
          <div
            onClick={() => setIsOpen(true)}
            className="w-[62px] h-[62px] rounded-full bg-[#1DB954] text-white flex items-center justify-center shadow-[0_0_20px_rgba(29,185,84,0.45)] border border-[#1ED760]/20 relative"
          >
            <Music size={26} className="animate-pulse" />
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-yellow-gold rounded-full border-2 border-[#1DB954] flex items-center justify-center text-[7px] text-black font-black">
              ♫
            </span>
          </div>
        </motion.div>
      )}

      {/* 1.5 Mini Player Bar (Visible only when collapsed) */}
      {!isOpen && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => setIsOpen(true)}
          className="fixed bottom-[80px] left-4 right-4 z-[990] h-12 bg-neutral-950/90 backdrop-blur-md border border-neutral-800 rounded-xl px-3 flex items-center justify-between shadow-2xl cursor-pointer hover:border-[#1DB954]/30 transition-all"
        >
          <div className="flex items-center gap-2 overflow-hidden w-[70%]">
            <div className="w-7 h-7 rounded-full bg-[#1DB954] flex items-center justify-center text-white animate-spin [animation-duration:8s]">
              <Music size={14} />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-[9px] text-[#1DB954] font-black uppercase tracking-widest leading-none">
                Reproduciendo
              </span>
              <span className="text-[10px] text-white font-bold truncate leading-snug mt-0.5">
                {(() => {
                  const active = SHARED_PLAYLISTS.find(p => p.id === activePlaylistId) || 
                                 customPlaylists.find(p => p.id === activePlaylistId);
                  return active ? active.name : "Focus Olímpico";
                })()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] bg-neutral-900 border border-neutral-800 text-gray-400 px-1.5 py-0.5 rounded uppercase font-black">
              Ampliar ⤢
            </span>
          </div>
        </motion.div>
      )}

      {/* 2. Full-Screen Glassmorphic Spotify Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4"
          >
            {/* Limit container to simulate app layout */}
            <motion.div
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="w-full max-w-[390px] h-[780px] bg-neutral-950 border border-neutral-800 rounded-[40px] flex flex-col overflow-hidden relative shadow-2xl"
            >
              {/* Header */}
              <div className="p-5 flex items-center justify-between border-b border-neutral-900 bg-neutral-900/40">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[#1DB954] flex items-center justify-center text-white">
                    <Music size={16} />
                  </div>
                  <div>
                    <h3 className="text-white text-sm font-black uppercase tracking-wider leading-none">
                      Spotify Sync
                    </h3>
                    <span className="text-[9px] text-[#1DB954] font-bold tracking-widest uppercase">
                      Banda sonora de tiro
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-full bg-neutral-900 border border-neutral-800 text-gray-400 hover:text-white cursor-pointer transition"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 pb-8 scrollbar-none">
                
                {/* 1. Main Spotify Web Player Widget */}
                <div className="bg-[#181818] border border-neutral-800 rounded-3xl p-3 shadow-lg flex flex-col gap-2">
                  <span className="text-[8px] text-gray-500 font-extrabold tracking-widest uppercase pl-1">
                    Reproductor Activo
                  </span>
                  
                  {/* Embedded Iframe Player */}
                  <div className="w-full rounded-2xl overflow-hidden bg-neutral-900 h-[152px]">
                    <iframe
                      src={`https://open.spotify.com/embed/playlist/${activePlaylistId}?utm_source=generator&theme=0`}
                      width="100%"
                      height="152px"
                      frameBorder="0"
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                    ></iframe>
                  </div>
                  <p className="text-[8px] text-gray-500 italic text-center mt-1">
                    Inicia sesión en Spotify en el widget para escuchar canciones completas.
                  </p>
                </div>

                {/* 2. Playlists Compartidas del Club */}
                <div className="flex flex-col gap-2.5">
                  <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 pl-1">
                    <Globe size={13} className="text-[#1DB954]" />
                    Playlists del Club
                  </h4>
                  
                  <div className="flex flex-col gap-2">
                    {SHARED_PLAYLISTS.map((list) => {
                      const isActive = activePlaylistId === list.id;
                      return (
                        <div
                          key={list.id}
                          onClick={() => handleSelectPlaylist(list.id)}
                          className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                            isActive
                              ? "bg-[#1DB954]/5 border-[#1DB954]/40"
                              : "bg-neutral-900/50 border-white/5 hover:border-neutral-800"
                          }`}
                        >
                          <div className="flex flex-col gap-1 w-[80%]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white group-hover:text-[#1DB954] transition-colors">
                                {list.name}
                              </span>
                              <span className="text-[8px] bg-neutral-950 text-gray-400 px-1 py-0.2 rounded font-extrabold uppercase scale-90">
                                {list.creator}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-500 leading-snug">
                              {list.description}
                            </p>
                          </div>
                          
                          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-neutral-950 border border-neutral-800 text-gray-400">
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
                          onClick={() => handleSelectPlaylist(list.id)}
                          className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                            isActive
                              ? "bg-[#1DB954]/5 border-[#1DB954]/40"
                              : "bg-neutral-900/50 border-white/5 hover:border-neutral-800"
                          }`}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-white group-hover:text-[#1DB954] transition-colors flex items-center gap-1.5">
                              {list.name}
                              <span className="text-[8px] bg-neutral-950 text-yellow-gold px-1 py-0.2 rounded font-extrabold uppercase scale-90">
                                MÍA
                              </span>
                            </span>
                            <span className="text-[9px] text-gray-500 font-mono">ID: {list.id.substring(0, 10)}...</span>
                          </div>
                          
                          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-neutral-950 border border-neutral-800 text-gray-400">
                            {isActive ? (
                              <Check size={12} className="text-[#1DB954]" />
                            ) : (
                              <Play size={10} className="fill-current pl-0.5" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Compartir Mi Playlist (Configurar) */}
                <div className="bg-neutral-900/40 border border-white/5 p-4 rounded-3xl flex flex-col gap-3">
                  <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                    <Plus size={14} className="text-[#1DB954]" />
                    Vincular Mi Playlist
                  </h4>
                  
                  <form onSubmit={handleAddPlaylist} className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={userPlaylistUrl}
                      onChange={(e) => setUserPlaylistUrl(e.target.value)}
                      placeholder="Pegar enlace de Playlist (Compartir > Copiar)"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-[#1DB954] text-white text-xs p-3 rounded-xl outline-none transition duration-150 caret-[#1DB954]"
                    />
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-xl bg-[#1DB954] text-white font-extrabold text-xs uppercase tracking-wider cursor-pointer hover:brightness-105 transition flex justify-center items-center gap-1.5 shadow-md shadow-[#1DB954]/15"
                    >
                      {saveSuccess ? (
                        <>
                          <Check size={14} />
                          <span>¡Playlist Guardada!</span>
                        </>
                      ) : (
                        <span>Activar & Guardar</span>
                      )}
                    </button>
                  </form>
                  <p className="text-[9px] text-gray-500">
                    Puedes copiar el enlace desde Spotify seleccionando Compartir ➔ Copiar enlace a playlist.
                  </p>
                </div>

              </div>
              
              {/* Bottom Decorative Indicator */}
              <div className="h-6 bg-neutral-950 flex justify-center items-center pb-2">
                <div className="w-28 h-1 bg-neutral-800 rounded-full" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
