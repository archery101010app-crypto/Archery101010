"use client";

import React, { useState, useEffect, useRef } from "react";
import { getLocalSetting, saveLocalSetting } from "@/lib/db/indexedDB";
import { motion } from "framer-motion";
import {
  X,
  Play,
  Pause,
  Music,
  Plus,
  Globe,
  Check,
  ExternalLink,
  Trash2,
  Minimize2,
  ListMusic,
  ClipboardPaste,
  UserCheck,
  UserPlus,
  RefreshCw,
  LogOut,
  KeyRound
} from "lucide-react";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import {
  ConnectedSpotifyAccount,
  extractSpotifyUsername,
  fetchUserSpotifyPlaylists,
  getSpotifyClientId,
  handleSpotifyOAuthCallbackIfPresent,
  startSpotifyOAuthPKCE
} from "@/lib/spotifyAuth";

// Predefined verified shared playlists for archery sessions
const DEFAULT_PLAYLIST_ID = "37i9dQZF1DWZeKCadgRdKQ"; // Deep Focus

export type SpotifyEntityType = "playlist" | "album" | "track" | "artist" | "show" | "episode";

export interface SpotifyItem {
  id: string;
  name: string;
  type?: SpotifyEntityType;
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

const ENTITY_TYPE_LABELS: Record<SpotifyEntityType, string> = {
  playlist: "Playlist",
  album: "Álbum",
  track: "Canción",
  artist: "Artista",
  show: "Podcast",
  episode: "Episodio"
};

interface SpotifyFloatingPlayerProps {
  showSideTab?: boolean;
}

export default function SpotifyFloatingPlayer({ showSideTab = false }: SpotifyFloatingPlayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasLoadedIframe, setHasLoadedIframe] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [activePlaylistId, setActivePlaylistId] = useState(DEFAULT_PLAYLIST_ID);
  const [activeType, setActiveType] = useState<SpotifyEntityType>("playlist");
  const [userPlaylistUrl, setUserPlaylistUrl] = useState("");
  const [customPlaylistName, setCustomPlaylistName] = useState("");
  const [customPlaylists, setCustomPlaylists] = useState<SpotifyItem[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isEnabledByAdmin, setIsEnabledByAdmin] = useState(true);
  const [isCompactPlayer, setIsCompactPlayer] = useState(false);

  // Connected Spotify Account States
  const [connectedAccount, setConnectedAccount] = useState<ConnectedSpotifyAccount | null>(null);
  const [hasNativeSessionCookie, setHasNativeSessionCookie] = useState<boolean>(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [showOAuthConfig, setShowOAuthConfig] = useState(false);
  const [oauthClientIdInput, setOauthClientIdInput] = useState("");
  const [accountFeedback, setAccountFeedback] = useState<string | null>(null);

  // Playback & Mini-Bar states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMiniBarActive, setIsMiniBarActive] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loginPopupWatchingRef = useRef(false);

  // Official Spotify App Remote (Android native): playback is controlled from ARCHERY 101010
  type SpotifyRemoteState = {
    connected: boolean;
    appInstalled?: boolean;
    error?: string;
    isPaused?: boolean;
    track?: string;
    artist?: string;
  };
  const [remoteState, setRemoteState] = useState<SpotifyRemoteState>({ connected: false });
  const getNativeSpotify = () =>
    typeof window !== "undefined" && typeof (window as any).ArcherySpotifyBridge?.connectSpotifyPlayer === "function"
      ? (window as any).ArcherySpotifyBridge
      : null;
  const remoteActive = remoteState.connected && Boolean(getNativeSpotify());

  useEffect(() => {
    (window as any).__onSpotifyRemoteState = (s: SpotifyRemoteState) => {
      setRemoteState((prev) => ({ ...prev, ...s }));
      if (s.connected) {
        if (typeof s.isPaused === "boolean") {
          setIsPlaying(!s.isPaused);
          if (!s.isPaused) setIsMiniBarActive(true);
        }
        setAccountFeedback(null);
      } else if (s.error) {
        const msg =
          s.error === "SPOTIFY_NOT_INSTALLED"
            ? "Instala la app de Spotify (se abrió la tienda) y vuelve a tocar Conectar."
            : s.error === "MISSING_CLIENT_ID"
            ? "Falta activar la llave de Spotify de ARCHERY 101010 (Client ID)."
            : s.error === "UserNotAuthorizedException"
            ? "Autoriza ARCHERY 101010 en la ventana de Spotify y vuelve a intentar."
            : s.error === "NotLoggedInException"
            ? "Abre la app de Spotify, inicia sesión y vuelve a tocar Conectar."
            : "No se pudo conectar con Spotify. Abre la app de Spotify una vez y reintenta.";
        setAccountFeedback(msg);
      }
    };
    // Silent reconnect if the native player was authorized before
    const nb = getNativeSpotify();
    if (nb && nb.hasSpotifyClientId?.() && nb.isSpotifyAppInstalled?.()) {
      try {
        nb.connectSpotifyPlayer("");
      } catch {}
    }
  }, []);

  // Check Native Android Spotify Session Cookie (`sp_dc`)
  const syncNativeSpotifySessionStatus = () => {
    if (typeof window === "undefined") return false;
    const bridge = (window as any).ArcherySpotifyBridge;
    if (bridge && typeof bridge.hasActiveSpotifySession === "function") {
      try {
        const active = Boolean(bridge.hasActiveSpotifySession());
        setHasNativeSessionCookie(active);
        return active;
      } catch {
        return false;
      }
    }
    return true;
  };

  // Load active playlist, custom playlists, and connected Spotify account on mount
  useEffect(() => {
    async function loadSpotifyConfig() {
      const flag = await getLocalSetting<boolean>("flag_spotify_enabled", true);
      setIsEnabledByAdmin(flag !== false);

      let savedId = await getLocalSetting<string>("spotify_active_id", DEFAULT_PLAYLIST_ID);
      if (!savedId || OLD_INVALID_IDS.includes(savedId)) {
        savedId = DEFAULT_PLAYLIST_ID;
        await saveLocalSetting("spotify_active_id", DEFAULT_PLAYLIST_ID);
      }

      const savedType = await getLocalSetting<SpotifyEntityType>("spotify_active_type", "playlist");
      const savedCustom = await getLocalSetting<SpotifyItem[]>("spotify_custom_lists", []);
      const savedAccount = await getLocalSetting<ConnectedSpotifyAccount | null>("spotify_connected_account", null);
      const savedClientId = await getSpotifyClientId();

      setActivePlaylistId(savedId);
      setActiveType(savedType || "playlist");
      let currentCustom = Array.isArray(savedCustom) ? savedCustom : [];
      setCustomPlaylists(currentCustom);
      if (savedAccount) {
        setConnectedAccount(savedAccount);
        setUsernameInput(savedAccount.username || "");
        setDisplayNameInput(savedAccount.displayName || "");
      }
      if (savedClientId) {
        setOauthClientIdInput(savedClientId);
      }

      const nativeActive = syncNativeSpotifySessionStatus();
      if (nativeActive && !savedAccount) {
        const autoAcc: ConnectedSpotifyAccount = {
          username: "spotify",
          displayName: "Cuenta Spotify Vinculada",
          product: "premium",
          authMode: "session",
          connectedAt: new Date().toISOString()
        };
        setConnectedAccount(autoAcc);
        await saveLocalSetting("spotify_connected_account", autoAcc);
      }

      // Check if returning from Spotify OAuth 2.0 PKCE callback
      const callbackResult = await handleSpotifyOAuthCallbackIfPresent();
      if (callbackResult) {
        setConnectedAccount(callbackResult.account);
        setHasLoadedIframe(true);
        setIsOpen(true);

        if (callbackResult.playlists.length > 0) {
          const importedItems: SpotifyItem[] = callbackResult.playlists.map((pl) => ({
            id: pl.id,
            type: "playlist",
            name: pl.name,
            creator: pl.ownerName,
            description: pl.tracksTotal ? `${pl.tracksTotal} canciones` : pl.description
          }));

          const existingIds = new Set(importedItems.map((i) => i.id));
          const merged = [
            ...importedItems,
            ...currentCustom.filter((c) => !existingIds.has(c.id))
          ];
          setCustomPlaylists(merged);
          await saveLocalSetting("spotify_custom_lists", merged);

          // Automatically select the user's first playlist
          setActivePlaylistId(importedItems[0].id);
          setActiveType("playlist");
          await saveLocalSetting("spotify_active_id", importedItems[0].id);
          await saveLocalSetting("spotify_active_type", "playlist");
        }
        setAccountFeedback("Cuenta de Spotify sincronizada y playlists importadas.");
        setTimeout(() => setAccountFeedback(null), 4000);
      }
    }
    loadSpotifyConfig();

    (window as any).__onNativeSpotifyLoginSuccess = async (res?: { connected?: boolean; hasSpDc?: boolean }) => {
      const ok = Boolean(res?.connected || res?.hasSpDc);
      setHasNativeSessionCookie(ok);
      if (ok) {
        const autoAcc: ConnectedSpotifyAccount = {
          username: "spotify",
          displayName: "Cuenta Spotify Vinculada",
          product: "premium",
          authMode: "session",
          connectedAt: new Date().toISOString()
        };
        setConnectedAccount(autoAcc);
        await saveLocalSetting("spotify_connected_account", autoAcc);
        setIframeReloadKey((prev) => prev + 1);
        setAccountFeedback("¡Spotify conectado automáticamente! Reproducción al 100% activada.");
        setTimeout(() => setAccountFeedback(null), 4000);
      }
    };

    const handleToggle = () => {
      syncNativeSpotifySessionStatus();
      setIsOpen((prev) => {
        const next = !prev;
        if (next) setHasLoadedIframe(true);
        return next;
      });
    };
    window.addEventListener("open-spotify-player", handleToggle);
    return () => {
      window.removeEventListener("open-spotify-player", handleToggle);
    };
  }, []);

  // Refresh embedded player automatically when user returns from Spotify login window
  useEffect(() => {
    const handleWindowFocus = () => {
      if (loginPopupWatchingRef.current) {
        loginPopupWatchingRef.current = false;
        setIframeReloadKey((prev) => prev + 1);
        setAccountFeedback("Sesión de Spotify actualizada en el reproductor.");
        setTimeout(() => setAccountFeedback(null), 3500);
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
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
  const sendSpotifyCommand = (command: "toggle" | "pause" | "resume" | "play") => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage({ command }, "*");
      } catch (e) {
        console.warn("Could not postMessage to Spotify iframe:", e);
      }
    }
  };

  const handleTogglePlayPause = () => {
    const nb = getNativeSpotify();
    if (nb && remoteState.connected) {
      nb.spotifyTogglePlay();
      return;
    }
    sendSpotifyCommand("toggle");
    setIsPlaying((prev) => !prev);
  };

  // Connect Spotify Account (User + Official In-App Spotify Web Session Login for 100% full tracks)
  const handleConnectSpotifyAccount = async (openSpotifyLoginPopup: boolean) => {
    const cleanUser = extractSpotifyUsername(usernameInput || displayNameInput || "arquero");
    const cleanDisplay =
      displayNameInput.trim() ||
      (usernameInput.trim() ? extractSpotifyUsername(usernameInput) : "Mi Cuenta Spotify");

    const newAccount: ConnectedSpotifyAccount = {
      username: cleanUser,
      displayName: cleanDisplay,
      product: "premium",
      authMode: "session",
      connectedAt: new Date().toISOString()
    };

    setConnectedAccount(newAccount);
    await saveLocalSetting("spotify_connected_account", newAccount);
    setShowAccountForm(false);

    if (openSpotifyLoginPopup) {
      const nativeBridge = getNativeSpotify();
      if (nativeBridge) {
        // Official Spotify App Remote: authorization happens inside the Spotify app (no embedded login page)
        nativeBridge.connectSpotifyPlayer(oauthClientIdInput || "");
        setAccountFeedback("Conectando con la app de Spotify…");
        return;
      }

      loginPopupWatchingRef.current = true;
      const loginUrl =
        "https://accounts.spotify.com/es/login?continue=" +
        encodeURIComponent("https://open.spotify.com/");
      const popup = window.open(
        loginUrl,
        "SpotifyAccountLogin",
        "width=460,height=680,menubar=no,toolbar=no,location=yes,status=no"
      );
      if (!popup) {
        window.open(loginUrl, "_blank", "noopener,noreferrer");
      }
      setAccountFeedback(
        "Inicia sesión en la ventana de Spotify. Al volver aquí, tu reproductor tendrá acceso completo."
      );
    } else {
      syncNativeSpotifySessionStatus();
      setIframeReloadKey((prev) => prev + 1);
      setAccountFeedback("Usuario de Spotify vinculado correctamente.");
      setTimeout(() => setAccountFeedback(null), 3000);
    }
  };

  // Connect via OAuth 2.0 PKCE (fetches user profile + all user playlists automatically)
  const handleStartOAuthSync = async () => {
    try {
      await startSpotifyOAuthPKCE(oauthClientIdInput);
    } catch (err: any) {
      setAccountFeedback(err?.message || "Ingresa un Client ID válido para OAuth.");
    }
  };

  const handleRefreshOAuthPlaylists = async () => {
    syncNativeSpotifySessionStatus();
    if (connectedAccount?.accessToken) {
      const pls = await fetchUserSpotifyPlaylists(connectedAccount.accessToken);
      if (pls.length > 0) {
        const imported: SpotifyItem[] = pls.map((pl) => ({
          id: pl.id,
          type: "playlist",
          name: pl.name,
          creator: pl.ownerName,
          description: pl.tracksTotal ? `${pl.tracksTotal} canciones` : pl.description
        }));
        const existingIds = new Set(imported.map((i) => i.id));
        const merged = [
          ...imported,
          ...customPlaylists.filter((c) => !existingIds.has(c.id))
        ];
        setCustomPlaylists(merged);
        await saveLocalSetting("spotify_custom_lists", merged);
        setAccountFeedback(`${imported.length} playlists sincronizadas desde tu cuenta.`);
        setTimeout(() => setAccountFeedback(null), 3000);
        return;
      }
    }
    // Reload embedded player to pick up active Spotify session
    setIframeReloadKey((prev) => prev + 1);
    setAccountFeedback("Reproductor sincronizado con tu sesión de Spotify.");
    setTimeout(() => setAccountFeedback(null), 2500);
  };

  const handleDisconnectAccount = async () => {
    try {
      const nativeBridge = typeof window !== "undefined" ? (window as any).ArcherySpotifyBridge : null;
      if (nativeBridge && typeof nativeBridge.clearSpotifySession === "function") {
        nativeBridge.clearSpotifySession();
      }
    } catch {}
    setHasNativeSessionCookie(false);
    setConnectedAccount(null);
    setUsernameInput("");
    setDisplayNameInput("");
    await saveLocalSetting("spotify_connected_account", null);
    setIframeReloadKey((prev) => prev + 1);
    setAccountFeedback("Cuenta desvinculada.");
    setTimeout(() => setAccountFeedback(null), 2000);
  };

  // Universal Spotify extractor: supports URLs, regional /intl-xx/, /embed/, URIs, mobile share text, and raw 22-char IDs
  const extractSpotifyItem = (input: string): { id: string; type: SpotifyEntityType } | null => {
    if (!input) return null;
    const trimmed = input.trim();

    // 1. Standard, regional (/intl-es/), or /embed/ Spotify URL anywhere inside the pasted text
    const urlMatch = trimmed.match(
      /spotify\.com\/(?:intl-[a-zA-Z0-9-]+\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([a-zA-Z0-9]{22})/i
    );
    if (urlMatch) {
      return {
        type: urlMatch[1].toLowerCase() as SpotifyEntityType,
        id: urlMatch[2]
      };
    }

    // 2. Spotify URI: spotify:(playlist|album|track|artist|show|episode):ID
    const uriMatch = trimmed.match(
      /spotify:(playlist|album|track|artist|show|episode):([a-zA-Z0-9]{22})/i
    );
    if (uriMatch) {
      return {
        type: uriMatch[1].toLowerCase() as SpotifyEntityType,
        id: uriMatch[2]
      };
    }

    // 3. Raw 22-character alphanumeric ID (default to playlist)
    if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
      return { id: trimmed, type: "playlist" };
    }

    return null;
  };

  // Fetch official title from Spotify's public oEmbed endpoint when user doesn't specify a custom name
  const fetchSpotifyTitle = async (type: SpotifyEntityType, id: string): Promise<string | null> => {
    try {
      const targetUrl = `https://open.spotify.com/${type}/${id}`;
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && typeof data.title === "string" && data.title.trim()) {
        return data.title.trim();
      }
      return null;
    } catch {
      return null;
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUserPlaylistUrl(text);
          setLinkError(null);
          const extracted = extractSpotifyItem(text);
          if (extracted && !customPlaylistName.trim()) {
            const autoTitle = await fetchSpotifyTitle(extracted.type, extracted.id);
            if (autoTitle) {
              setCustomPlaylistName(autoTitle.slice(0, 45));
            }
          }
        }
      }
    } catch {
      // Clipboard permission denied or unsupported; user can paste manually
    }
  };

  const handleAddPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    if (!userPlaylistUrl.trim()) {
      setLinkError("Pega un enlace de Spotify para continuar.");
      return;
    }

    const extracted = extractSpotifyItem(userPlaylistUrl);
    if (!extracted) {
      setLinkError(
        "Enlace no reconocido. En Spotify toca Compartir → Copiar enlace en cualquier playlist, álbum, canción o artista."
      );
      return;
    }

    setIsSavingLink(true);
    let cleanName = customPlaylistName.trim();
    if (!cleanName) {
      const fetchedTitle = await fetchSpotifyTitle(extracted.type, extracted.id);
      cleanName =
        fetchedTitle ||
        `${ENTITY_TYPE_LABELS[extracted.type]} (${customPlaylists.length + 1})`;
    }

    const newItem: SpotifyItem = {
      id: extracted.id,
      type: extracted.type,
      name: cleanName
    };
    const newList = [newItem, ...customPlaylists.filter((p) => p.id !== extracted.id)];

    setCustomPlaylists(newList);
    setActivePlaylistId(extracted.id);
    setActiveType(extracted.type);
    setHasLoadedIframe(true);
    setIsMiniBarActive(true);
    await saveLocalSetting("spotify_custom_lists", newList);
    await saveLocalSetting("spotify_active_id", extracted.id);
    await saveLocalSetting("spotify_active_type", extracted.type);

    setIsSavingLink(false);
    setUserPlaylistUrl("");
    setCustomPlaylistName("");
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);

    // Scroll up to the active player so user sees it loaded immediately
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteCustomPlaylist = async (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation();
    const updated = customPlaylists.filter((p) => p.id !== idToDelete);
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
    setHasLoadedIframe(true);
    setIsMiniBarActive(true);
    await saveLocalSetting("spotify_active_id", item.id);
    await saveLocalSetting("spotify_active_type", itemType);

    // Native official player: start the full playlist right away
    const nb = getNativeSpotify();
    if (nb && remoteState.connected) {
      nb.spotifyPlay(`spotify:${itemType}:${item.id}`);
    }

    // Scroll to top of modal so user can press play or pick a track
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleOpenInNativeSpotify = () => {
    const webUrl = `https://open.spotify.com/${activeType}/${activePlaylistId}`;
    const nb = typeof window !== "undefined" ? (window as any).ArcherySpotifyBridge : null;
    if (nb && typeof nb.openInSpotifyApp === "function") {
      // Native Android: open straight in the Spotify app (full songs, keeps playing in background)
      nb.openInSpotifyApp(`spotify:${activeType}:${activePlaylistId}`, webUrl);
      setIsPlaying(true);
      return;
    }
    window.open(webUrl, "_blank", "noopener,noreferrer");
  };

  if (!isEnabledByAdmin) {
    return null;
  }

  const activePlaylistObj =
    SHARED_PLAYLISTS.find((p) => p.id === activePlaylistId) ||
    customPlaylists.find((p) => p.id === activePlaylistId);

  return (
    <>
      {/* 1. Spotify Collapsible Folding Tab on the Left Edge */}
      {showSideTab && !isOpen && !isMiniBarActive && (
        <div className="fixed left-0 top-[calc(50%+112px)] -translate-y-1/2 z-[40] scale-90 origin-left">
          <button
            onClick={() => {
              setHasLoadedIframe(true);
              setIsOpen(true);
            }}
            aria-label="Abrir Spotify"
            className="h-28 w-8 md:w-9 flex flex-col items-center justify-between pt-2.5 pb-3 px-1 rounded-r-2xl bg-[#1DB954] border-y border-r border-black/20 cursor-pointer text-black hover:brightness-105 active:scale-95 transition-all duration-200 select-none shadow-md"
          >
            <div className="text-black flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <span
              className="text-[13.8px] sm:text-[13.6px] font-bold text-black select-none tracking-[-0.03em] leading-none"
              style={{
                fontFamily: "'Outfit', sans-serif",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
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
          className="fixed bottom-[62px] left-4 right-4 z-[990] h-12 bg-[#0D1017]/95 backdrop-blur-md border border-white/[0.08] rounded-xl px-3 flex items-center justify-between shadow-2xl hover:border-[#1DB954]/40 transition-all max-w-md mx-auto"
        >
          <div
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2.5 overflow-hidden w-[62%] cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[#1DB954] flex items-center justify-center text-black shrink-0">
              <Music size={14} />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-[10.5px] text-[#1DB954] font-black uppercase tracking-widest leading-none">
                {isPlaying ? "Reproduciendo" : "Spotify Activo"}
              </span>
              <span className="text-[12.8px] text-white font-bold truncate leading-snug mt-0.5">
                {activePlaylistObj ? activePlaylistObj.name : "Focus Olímpico"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Play/Pause Real Control Button */}
            <button
              onClick={handleTogglePlayPause}
              className="p-1.5 rounded-full bg-[#141923] border border-white/[0.08] text-[#1DB954] hover:text-white cursor-pointer hover:bg-[#1B2230] transition"
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
              className="text-[10.5px] bg-[#141923] border border-white/[0.08] text-white px-2.5 py-1 rounded-lg uppercase font-black cursor-pointer hover:text-white transition"
              title="Abrir panel de Spotify"
            >
              Abrir
            </button>

            {/* Close Button (✕) - stops player and hides mini-bar */}
            <button
              onClick={() => {
                const nb = getNativeSpotify();
                if (nb && remoteState.connected) nb.spotifyPause();
                sendSpotifyCommand("pause");
                setIsMiniBarActive(false);
                setIsPlaying(false);
              }}
              className="p-1.5 rounded-full bg-[#141923] border border-white/[0.08] text-white hover:text-red-400 cursor-pointer transition"
              title="Cerrar reproductor"
            >
              <X size={12} />
            </button>
          </div>
        </motion.div>
      )}

      {/* 2. Persistent Clean Spotify Panel (Kept mounted once opened so audio NEVER stops when minimized) */}
      {(hasLoadedIframe || isOpen || isMiniBarActive) && (
        <div
          className={`fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-3.5 transition-all duration-200 ${
            isOpen
              ? "opacity-100 pointer-events-auto visible"
              : "opacity-0 pointer-events-none invisible"
          }`}
          aria-hidden={!isOpen}
        >
          <div
            className={`w-full max-w-[400px] max-h-[88vh] bg-[#06080C] border border-white/[0.10] rounded-[26px] p-4 flex flex-col gap-3.5 overflow-hidden relative shadow-2xl transition-transform duration-200 ${
              isOpen ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
            }`}
          >
            {/* Top 101010 tricolor line */}
            <div
              className="absolute top-0 left-12 right-12 h-[2px]"
              style={{
                background:
                  "linear-gradient(90deg, transparent, #00A8F3 25%, #FF1E1E 50%, #FFE500 75%, transparent)"
              }}
            />

            {/* 1. Clean Single-Line Header */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="/images/brand_logo_header.png"
                  srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                  alt="ARCHERY 101010"
                  className="h-[13px] w-auto object-contain shrink-0 select-none pointer-events-none"
                  draggable={false}
                />
                <div className="inline-flex items-center gap-[5px] bg-[#071910] border border-[#1DB954]/45 rounded-full px-[9px] py-[3px] shrink-0">
                  <span className="w-[5px] h-[5px] rounded-full bg-[#1DB954]" />
                  <span className="text-[9.5px] font-extrabold text-[#1DB954] tracking-[0.08em] uppercase leading-none">
                    MÚSICA
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsMiniBarActive(true);
                  setIsOpen(false);
                }}
                className="w-[28px] h-[28px] rounded-full bg-white/[0.04] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0 transition"
                title="Cerrar ventana"
                aria-label="Cerrar"
              >
                <X size={14} />
              </button>
            </div>

            {/* Scrollable Clean Body */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto flex flex-col gap-3.5 scrollbar-none"
            >
              {/* 2. Player Box + Single Clear CTA Button */}
              <div className="bg-[#0B0E14] border border-white/[0.08] rounded-[18px] p-3 flex flex-col gap-2.5 shrink-0">
                <div className="w-full h-[152px] rounded-[14px] overflow-hidden bg-[#06080C]">
                  <iframe
                    key={`${activeType}-${activePlaylistId}-${iframeReloadKey}`}
                    ref={iframeRef}
                    src={`https://open.spotify.com/embed/${activeType}/${activePlaylistId}?utm_source=generator&theme=0`}
                    width="100%"
                    height="152"
                    frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="eager"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleOpenInNativeSpotify}
                  className="w-full py-[11px] px-3.5 rounded-[12px] bg-[#1DB954] hover:bg-[#1ED760] text-[#020305] font-black text-[11.5px] uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition"
                >
                  <Play size={13} fill="currentColor" />
                  <span>Abrir canciones completas en Spotify</span>
                </button>
              </div>

              {/* 3. Clean Playlist Selector */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-extrabold tracking-[0.12em] text-[#94A3B8] uppercase pl-0.5">
                  ELIGE TU PLAYLIST
                </span>

                <div className="flex flex-col gap-[7px]">
                  {customPlaylists.map((list) => {
                    const isActive = activePlaylistId === list.id;
                    const typeLabel = ENTITY_TYPE_LABELS[list.type || "playlist"] || "Playlist";
                    return (
                      <div
                        key={list.id}
                        onClick={() => handleSelectPlaylist(list)}
                        className={`px-3 py-2.5 rounded-[14px] border transition-all duration-150 cursor-pointer flex items-center justify-between gap-2.5 ${
                          isActive
                            ? "bg-[#1DB954]/[0.08] border-[#1DB954]/50"
                            : "bg-[#0B0E14] border-white/[0.07] hover:border-white/15"
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-[12.5px] font-extrabold text-white truncate">
                            {list.name}
                          </span>
                          <span className="text-[10.5px] font-semibold text-[#94A3B8] truncate">
                            {list.description || `${typeLabel} guardada`}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteCustomPlaylist(e, list.id)}
                            className="w-[26px] h-[26px] rounded-full flex items-center justify-center bg-[#12151C] border border-white/[0.10] text-white/70 hover:text-red-400 transition"
                            title="Eliminar de mi lista"
                          >
                            <Trash2 size={11} />
                          </button>
                          <div
                            className={`w-[26px] h-[26px] rounded-full flex items-center justify-center bg-[#12151C] border ${
                              isActive
                                ? "border-[#1DB954]/55 text-[#1DB954]"
                                : "border-white/[0.10] text-white"
                            }`}
                          >
                            {isActive ? (
                              <Check size={12} />
                            ) : (
                              <Play size={10} className="fill-current pl-0.5" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {SHARED_PLAYLISTS.map((list) => {
                    const isActive = activePlaylistId === list.id;
                    return (
                      <div
                        key={list.id}
                        onClick={() => handleSelectPlaylist(list)}
                        className={`px-3 py-2.5 rounded-[14px] border transition-all duration-150 cursor-pointer flex items-center justify-between gap-2.5 ${
                          isActive
                            ? "bg-[#1DB954]/[0.08] border-[#1DB954]/50"
                            : "bg-[#0B0E14] border-white/[0.07] hover:border-white/15"
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-[12.5px] font-extrabold text-white truncate">
                            {list.name}
                          </span>
                          <span className="text-[10.5px] font-semibold text-[#94A3B8] truncate">
                            {list.description}
                          </span>
                        </div>

                        <div
                          className={`w-[26px] h-[26px] rounded-full flex items-center justify-center bg-[#12151C] border shrink-0 ${
                            isActive
                              ? "border-[#1DB954]/55 text-[#1DB954]"
                              : "border-white/[0.10] text-white"
                          }`}
                        >
                          {isActive ? (
                            <Check size={12} />
                          ) : (
                            <Play size={10} className="fill-current pl-0.5" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. Single-Line Add Link Bar */}
              <form onSubmit={handleAddPlaylist} className="flex flex-col gap-1.5 pt-0.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={userPlaylistUrl}
                    onChange={(e) => {
                      setUserPlaylistUrl(e.target.value);
                      if (linkError) setLinkError(null);
                    }}
                    placeholder="Pega aquí un enlace de Spotify…"
                    className="flex-1 min-w-0 bg-[#0B0E14] border border-white/[0.09] focus:border-[#1DB954] text-white placeholder:text-[#94A3B8] text-[11.5px] font-semibold px-3 py-2.5 rounded-[12px] outline-none transition caret-[#1DB954]"
                  />
                  <button
                    type="submit"
                    disabled={isSavingLink}
                    className="bg-[#12151C] border border-[#1DB954]/45 hover:border-[#1DB954] text-[#1DB954] rounded-[12px] px-3.5 py-2.5 text-[11px] font-extrabold tracking-[0.05em] uppercase whitespace-nowrap cursor-pointer active:scale-95 transition disabled:opacity-50"
                  >
                    {saveSuccess ? "✓ Listo" : isSavingLink ? "..." : "+ Agregar"}
                  </button>
                </div>
                {linkError && (
                  <p className="text-[11px] text-red-400 font-bold leading-snug px-1">
                    {linkError}
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
