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
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  ConnectedSpotifyAccount,
  extractSpotifyUsername,
  fetchUserSpotifyPlaylists,
  getSpotifyClientId,
  handleSpotifyOAuthCallbackIfPresent,
  refreshMusicAccessToken,
  startSpotifyOAuthPKCE
} from "@/lib/spotifyAuth";

// Predefined verified shared playlists for archery sessions
const DEFAULT_PLAYLIST_ID = "37i9dQZF1DWZeKCadgRdKQ"; // Deep Focus

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

const SHARED_PLAYLISTS: SpotifyItem[] = [
  {
    id: "37i9dQZF1DWZeKCadgRdKQ",
    type: "playlist",
    name: "Focus Olímpico",
    nameEn: "Olympic Focus",
    creator: "Coach Carlos",
    description: "Instrumental y ritmos envolventes para máxima concentración.",
    descriptionEn: "Instrumental and ambient beats for peak focus."
  },
  {
    id: "37i9dQZF1DWWQRwui0ExPn",
    type: "playlist",
    name: "Ritmo & Barebow",
    nameEn: "Rhythm & Barebow",
    creator: "Archery 101010",
    description: "Compás relajado y constante para ritmo y cadencia de tiro.",
    descriptionEn: "Steady, relaxed tempo for shooting rhythm and cadence."
  },
  {
    id: "37i9dQZF1DWXRqgorJj26U",
    type: "playlist",
    name: "Compound Energy",
    nameEn: "Compound Energy",
    creator: "Laura Archer",
    description: "Energía y potencia para eliminatorias y finales.",
    descriptionEn: "High energy and drive for eliminations and finals."
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

export default function SpotifyFloatingPlayer({ showSideTab = false }: SpotifyFloatingPlayerProps) {
  const { language, tx } = useLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  const txCurrent = (esText: string, enText: string) =>
    languageRef.current === "es" ? esText : enText;

  const getEntityTypeLabel = (type: SpotifyEntityType): string => {
    switch (type) {
      case "playlist":
        return tx("Lista Musical", "Playlist");
      case "album":
        return tx("Álbum", "Album");
      case "track":
        return tx("Canción", "Track");
      case "artist":
        return tx("Artista", "Artist");
      case "show":
        return tx("Podcast", "Podcast");
      case "episode":
        return tx("Episodio", "Episode");
      default:
        return tx("Lista Musical", "Playlist");
    }
  };

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

  // Connected Music Account States
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

  // Native music remote bridge (Android native): playback is controlled from ARCHERY 101010
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
            ? txCurrent(
                "Instala tu aplicación de música compatible y vuelve a tocar Conectar.",
                "Install your compatible music app and tap Connect again."
              )
            : s.error === "MISSING_CLIENT_ID"
            ? txCurrent(
                "Falta activar la llave de conexión musical de ARCHERY 101010 (Client ID).",
                "ARCHERY 101010 music connection key (Client ID) is not configured."
              )
            : s.error === "UserNotAuthorizedException"
            ? txCurrent(
                "Autoriza ARCHERY 101010 en la ventana de música y vuelve a intentar.",
                "Authorize ARCHERY 101010 in the music window and try again."
              )
            : s.error === "NotLoggedInException"
            ? txCurrent(
                "Abre tu aplicación de música, inicia sesión y vuelve a tocar Conectar.",
                "Open your music app, sign in, and tap Connect again."
              )
            : txCurrent(
                "No se pudo conectar con el servicio musical. Ábrelo una vez y reintenta.",
                "Could not connect to the music service. Open it once and try again."
              );
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

  // Check Native Android Music Session Cookie (`sp_dc`)
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

  // Load active playlist, custom playlists, and connected music account on mount
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
      const currentCustom = Array.isArray(savedCustom) ? savedCustom : [];
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
          username: "music",
          displayName: txCurrent("Cuenta de Música", "Music Account"),
          product: "premium",
          authMode: "session",
          connectedAt: new Date().toISOString()
        };
        setConnectedAccount(autoAcc);
        await saveLocalSetting("spotify_connected_account", autoAcc);
      }

      // Check if returning from OAuth 2.0 PKCE callback
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
            description: pl.tracksTotal
              ? txCurrent(`${pl.tracksTotal} canciones`, `${pl.tracksTotal} tracks`)
              : pl.description
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
        setAccountFeedback(
          txCurrent(
            "Cuenta de música sincronizada y listas importadas.",
            "Music account synced and playlists imported."
          )
        );
        setTimeout(() => setAccountFeedback(null), 4000);
      }
    }
    loadSpotifyConfig();

    (window as any).__onNativeSpotifyLoginSuccess = async (res?: { connected?: boolean; hasSpDc?: boolean }) => {
      const ok = Boolean(res?.connected || res?.hasSpDc);
      setHasNativeSessionCookie(ok);
      if (ok) {
        const autoAcc: ConnectedSpotifyAccount = {
          username: "music",
          displayName: txCurrent("Cuenta de Música", "Music Account"),
          product: "premium",
          authMode: "session",
          connectedAt: new Date().toISOString()
        };
        setConnectedAccount(autoAcc);
        await saveLocalSetting("spotify_connected_account", autoAcc);
        setIframeReloadKey((prev) => prev + 1);
        setAccountFeedback(
          txCurrent(
            "¡Reproductor musical conectado! Reproducción completa activada.",
            "Music player connected! Full playback enabled."
          )
        );
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

  // Refresh embedded player automatically when user returns from login window
  useEffect(() => {
    const handleWindowFocus = () => {
      if (loginPopupWatchingRef.current) {
        loginPopupWatchingRef.current = false;
        setIframeReloadKey((prev) => prev + 1);
        setAccountFeedback(
          txCurrent(
            "Sesión musical actualizada en el reproductor.",
            "Music session updated in player."
          )
        );
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

  // Listen to embedded player postMessage events (playback_update / ready)
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

  // Send command to Embedded Music IFrame
  const sendSpotifyCommand = (command: "toggle" | "pause" | "resume" | "play") => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage({ command }, "*");
      } catch (e) {
        console.warn("Could not postMessage to music iframe:", e);
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

  // Connect Music Account (User + In-App Web Session Login for full tracks)
  const handleConnectSpotifyAccount = async (openSpotifyLoginPopup: boolean) => {
    const cleanUser = extractSpotifyUsername(
      usernameInput || displayNameInput || tx("arquero", "archer")
    );
    const cleanDisplay =
      displayNameInput.trim() ||
      (usernameInput.trim()
        ? extractSpotifyUsername(usernameInput)
        : tx("Cuenta de Música", "Music Account"));

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
        nativeBridge.connectSpotifyPlayer(oauthClientIdInput || "");
        setAccountFeedback(
          tx("Conectando con el servicio musical…", "Connecting to music service…")
        );
        return;
      }

      loginPopupWatchingRef.current = true;
      const loginUrl =
        "https://accounts.spotify.com/login?continue=" +
        encodeURIComponent("https://open.spotify.com/");
      const popup = window.open(
        loginUrl,
        "MusicAccountLogin",
        "width=460,height=680,menubar=no,toolbar=no,location=yes,status=no"
      );
      if (!popup) {
        window.open(loginUrl, "_blank", "noopener,noreferrer");
      }
      setAccountFeedback(
        tx(
          "Inicia sesión en la ventana emergente. Al volver aquí, tu reproductor tendrá acceso completo.",
          "Sign in inside the popup window. When you return, your music player will have full access."
        )
      );
    } else {
      syncNativeSpotifySessionStatus();
      setIframeReloadKey((prev) => prev + 1);
      setAccountFeedback(
        tx("Cuenta de música vinculada correctamente.", "Music account linked successfully.")
      );
      setTimeout(() => setAccountFeedback(null), 3000);
    }
  };

  // Connect via OAuth 2.0 PKCE (fetches user profile + all user playlists automatically)
  const handleStartOAuthSync = async () => {
    try {
      await startSpotifyOAuthPKCE(oauthClientIdInput);
    } catch (err: any) {
      setAccountFeedback(
        err?.message || tx("Ingresa un Client ID válido para OAuth.", "Enter a valid OAuth Client ID.")
      );
    }
  };

  const handleRefreshOAuthPlaylists = async () => {
    syncNativeSpotifySessionStatus();
    if (connectedAccount?.accessToken || connectedAccount?.refreshToken) {
      const freshToken = await refreshMusicAccessToken(connectedAccount);
      const pls = await fetchUserSpotifyPlaylists(freshToken || connectedAccount.accessToken);
      const updatedAcc = await getLocalSetting<ConnectedSpotifyAccount | null>("spotify_connected_account", null);
      if (updatedAcc) {
        setConnectedAccount(updatedAcc);
      }
      if (pls.length > 0) {
        const imported: SpotifyItem[] = pls.map((pl) => ({
          id: pl.id,
          type: "playlist",
          name: pl.name,
          creator: pl.ownerName,
          description: pl.tracksTotal
            ? tx(`${pl.tracksTotal} canciones`, `${pl.tracksTotal} tracks`)
            : pl.description
        }));
        const existingIds = new Set(imported.map((i) => i.id));
        const merged = [
          ...imported,
          ...customPlaylists.filter((c) => !existingIds.has(c.id))
        ];
        setCustomPlaylists(merged);
        await saveLocalSetting("spotify_custom_lists", merged);
        setAccountFeedback(
          tx(
            `${imported.length} listas sincronizadas desde tu cuenta.`,
            `${imported.length} playlists synced from your account.`
          )
        );
        setTimeout(() => setAccountFeedback(null), 3000);
        return;
      }
    }
    // Reload embedded player to pick up active music session
    setIframeReloadKey((prev) => prev + 1);
    setAccountFeedback(
      tx(
        "Reproductor sincronizado con tu sesión musical.",
        "Player synced with your music session."
      )
    );
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
    setAccountFeedback(tx("Cuenta de música desvinculada.", "Music account disconnected."));
    setTimeout(() => setAccountFeedback(null), 2000);
  };

  // Universal music URL extractor: supports URLs, regional /intl-xx/, /embed/, URIs, mobile share text, and raw 22-char IDs
  const extractSpotifyItem = (input: string): { id: string; type: SpotifyEntityType } | null => {
    if (!input) return null;
    const trimmed = input.trim();

    // 1. Standard, regional (/intl-es/), or /embed/ URL anywhere inside the pasted text
    const urlMatch = trimmed.match(
      /spotify\.com\/(?:intl-[a-zA-Z0-9-]+\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([a-zA-Z0-9]{22})/i
    );
    if (urlMatch) {
      return {
        type: urlMatch[1].toLowerCase() as SpotifyEntityType,
        id: urlMatch[2]
      };
    }

    // 2. URI: spotify:(playlist|album|track|artist|show|episode):ID
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

  // Fetch official title from public oEmbed endpoint when user doesn't specify a custom name
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
      setLinkError(
        tx(
          "Pega el enlace de tu lista musical para continuar.",
          "Paste your playlist link to continue."
        )
      );
      return;
    }

    const extracted = extractSpotifyItem(userPlaylistUrl);
    if (!extracted) {
      setLinkError(
        tx(
          "Enlace no reconocido. Toca Compartir → Copiar enlace en cualquier lista, álbum, canción o artista.",
          "Unrecognized link. Tap Share → Copy link on any playlist, album, track, or artist."
        )
      );
      return;
    }

    setIsSavingLink(true);
    let cleanName = customPlaylistName.trim();
    if (!cleanName) {
      const fetchedTitle = await fetchSpotifyTitle(extracted.type, extracted.id);
      cleanName =
        fetchedTitle ||
        `${getEntityTypeLabel(extracted.type)} (${customPlaylists.length + 1})`;
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

  const getPlaylistName = (item: SpotifyItem) =>
    language === "es" ? item.name : item.nameEn || item.name;
  const getPlaylistDesc = (item: SpotifyItem) =>
    language === "es" ? item.description : item.descriptionEn || item.description;
  const activePlaylistDisplayName = activePlaylistObj
    ? getPlaylistName(activePlaylistObj)
    : tx("Focus Olímpico", "Olympic Focus");

  return (
    <>
      {/* 1. Music Collapsible Folding Tab on the Start Edge */}
      {showSideTab && !isOpen && !isMiniBarActive && (
        <div className="fixed start-0 top-[calc(50%+112px)] -translate-y-1/2 z-[40] scale-90 origin-left rtl:origin-right">
          <button
            type="button"
            onClick={() => {
              setHasLoadedIframe(true);
              setIsOpen(true);
            }}
            aria-label={tx("Abrir Reproductor Musical", "Open Music Player")}
            className="h-28 min-w-[36px] min-h-[36px] w-9 flex flex-col items-center justify-between pt-2.5 pb-3 px-1 rounded-e-2xl bg-[#12151C] border-y border-e border-[#00A8F3]/45 cursor-pointer text-white hover:border-[#00A8F3] active:scale-95 transition-all duration-200 select-none shadow-md"
          >
            <div className="text-[#00A8F3] flex items-center justify-center shrink-0">
              <Music size={17} aria-hidden="true" />
            </div>
            <span
              className="text-[13.6px] font-bold text-white select-none tracking-[-0.02em] leading-none"
              style={{
                fontFamily: "'Outfit', sans-serif",
                writingMode: "vertical-rl",
                textOrientation: "mixed",
              }}
            >
              {tx("Música", "Music")}
            </span>
          </button>
        </div>
      )}

      {/* 1.5 Mini Player Bar (Visible when collapsed and active; iframe stays alive in DOM) */}
      {!isOpen && isMiniBarActive && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-[62px] inset-x-4 z-[990] min-h-[52px] py-1.5 bg-[#0D1017]/95 backdrop-blur-md border border-white/[0.10] rounded-xl px-3 flex items-center justify-between gap-2 shadow-2xl hover:border-[#00A8F3]/45 transition-all max-w-md mx-auto"
        >
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label={tx(
              `Abrir Reproductor Musical: ${activePlaylistDisplayName}`,
              `Open Music Player: ${activePlaylistDisplayName}`
            )}
            className="flex items-center gap-2.5 overflow-hidden flex-1 min-w-0 text-start cursor-pointer min-h-[36px]"
          >
            <div className="w-8 h-8 rounded-full bg-[#12151C] border border-[#00A8F3]/45 flex items-center justify-center text-[#00A8F3] shrink-0">
              <Music size={14} aria-hidden="true" />
            </div>
            <div className="flex flex-col overflow-hidden min-w-0">
              <span className="text-[10.5px] text-[#00A8F3] font-black uppercase tracking-widest leading-none">
                {isPlaying
                  ? tx("Reproduciendo", "Now Playing")
                  : tx("Reproductor Musical", "Music Player")}
              </span>
              <span className="text-[12.8px] text-white font-bold truncate leading-snug mt-0.5">
                {activePlaylistDisplayName}
              </span>
            </div>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Play/Pause Real Control Button */}
            <button
              type="button"
              onClick={handleTogglePlayPause}
              aria-label={
                isPlaying
                  ? tx("Pausar música", "Pause music")
                  : tx("Reproducir música", "Play music")
              }
              title={isPlaying ? tx("Pausar", "Pause") : tx("Reproducir", "Play")}
              className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-[#12151C] border border-white/[0.10] text-[#00A8F3] hover:text-white hover:border-[#00A8F3]/50 flex items-center justify-center cursor-pointer transition"
            >
              {isPlaying ? (
                <Pause size={14} fill="currentColor" aria-hidden="true" />
              ) : (
                <Play size={14} fill="currentColor" className="translate-x-[0.5px]" aria-hidden="true" />
              )}
            </button>

            {/* Expand Button */}
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              aria-label={tx("Abrir Reproductor Musical", "Open Music Player")}
              title={tx("Abrir Reproductor Musical", "Open Music Player")}
              className="min-w-[36px] min-h-[36px] text-[10.5px] bg-[#12151C] border border-white/[0.10] hover:border-[#00A8F3]/50 text-white px-3 rounded-lg uppercase font-black cursor-pointer flex items-center justify-center transition"
            >
              {tx("Abrir", "Open")}
            </button>

            {/* Close Button (✕) - stops player and hides mini-bar */}
            <button
              type="button"
              onClick={() => {
                const nb = getNativeSpotify();
                if (nb && remoteState.connected) nb.spotifyPause();
                sendSpotifyCommand("pause");
                setIsMiniBarActive(false);
                setIsPlaying(false);
              }}
              aria-label={tx("Cerrar Reproductor Musical", "Close Music Player")}
              title={tx("Cerrar Reproductor Musical", "Close Music Player")}
              className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-[#12151C] border border-white/[0.10] text-white hover:text-red-400 flex items-center justify-center cursor-pointer transition"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}

      {/* 2. Persistent Clean Music Panel (Kept mounted once opened so audio NEVER stops when minimized) */}
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
            role="dialog"
            aria-label={tx("Reproductor Musical", "Music Player")}
            className={`w-full max-w-[400px] max-h-[88vh] bg-[#06080C] border border-white/[0.10] rounded-[26px] p-4 flex flex-col gap-3.5 overflow-hidden relative shadow-2xl transition-transform duration-200 ${
              isOpen ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
            }`}
          >
            {/* Top 101010 tricolor line */}
            <div
              className="absolute top-0 inset-x-12 h-[2px]"
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
                <div className="inline-flex items-center gap-[5px] bg-[#12151C] border border-[#00A8F3]/45 rounded-full px-[9px] py-[3px] shrink-0">
                  <span className="w-[5px] h-[5px] rounded-full bg-[#00A8F3]" />
                  <span className="text-[9.5px] font-extrabold text-[#00A8F3] tracking-[0.08em] uppercase leading-none">
                    {tx("REPRODUCTOR MUSICAL", "MUSIC PLAYER")}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsMiniBarActive(true);
                  setIsOpen(false);
                }}
                className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full bg-[#12151C] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0 transition"
                title={tx("Minimizar reproductor", "Minimize player")}
                aria-label={tx("Cerrar Reproductor Musical", "Close Music Player")}
              >
                <X size={15} aria-hidden="true" />
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
                    title={tx("Reproductor Musical", "Music Player")}
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
                  className="w-full min-h-[40px] py-[11px] px-3.5 rounded-[12px] bg-[#00A8F3] hover:bg-[#19B8FF] text-[#020305] font-black text-[11.5px] uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition"
                >
                  <Play size={13} fill="currentColor" aria-hidden="true" />
                  <span>
                    {tx(
                      "Abrir Lista Musical en Servicio Musical",
                      "Open Playlist in Music Service"
                    )}
                  </span>
                </button>
              </div>

              {/* 3. Clean Playlist Selector */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-extrabold tracking-[0.12em] text-[#94A3B8] uppercase ps-0.5">
                  {tx("ELIGE TU LISTA MUSICAL", "CHOOSE YOUR PLAYLIST")}
                </span>

                <div className="flex flex-col gap-[7px]">
                  {customPlaylists.map((list) => {
                    const isActive = activePlaylistId === list.id;
                    const typeLabel = getEntityTypeLabel(list.type || "playlist");
                    return (
                      <div
                        key={list.id}
                        onClick={() => handleSelectPlaylist(list)}
                        className={`px-3 py-2.5 rounded-[14px] border transition-all duration-150 cursor-pointer flex items-center justify-between gap-2.5 ${
                          isActive
                            ? "bg-[#00A8F3]/[0.08] border-[#00A8F3]/50"
                            : "bg-[#0B0E14] border-white/[0.07] hover:border-white/15"
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-[12.5px] font-extrabold text-white truncate">
                            {list.name}
                          </span>
                          <span className="text-[10.5px] font-semibold text-[#94A3B8] truncate">
                            {list.description || tx(`${typeLabel} guardada`, `Saved ${typeLabel}`)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteCustomPlaylist(e, list.id)}
                            aria-label={tx(
                              `Eliminar lista ${list.name}`,
                              `Remove playlist ${list.name}`
                            )}
                            title={tx("Eliminar de mi lista musical", "Remove from playlists")}
                            className="min-w-[36px] min-h-[36px] w-9 h-9 rounded-full flex items-center justify-center bg-[#12151C] border border-white/[0.10] text-white/80 hover:text-red-400 cursor-pointer transition"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                          <div
                            aria-hidden="true"
                            className={`w-9 h-9 rounded-full flex items-center justify-center bg-[#12151C] border ${
                              isActive
                                ? "border-[#00A8F3]/55 text-[#00A8F3]"
                                : "border-white/[0.10] text-white"
                            }`}
                          >
                            {isActive ? (
                              <Check size={13} />
                            ) : (
                              <Play size={11} className="fill-current ps-0.5" />
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
                            ? "bg-[#00A8F3]/[0.08] border-[#00A8F3]/50"
                            : "bg-[#0B0E14] border-white/[0.07] hover:border-white/15"
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="text-[12.5px] font-extrabold text-white truncate">
                            {getPlaylistName(list)}
                          </span>
                          <span className="text-[10.5px] font-semibold text-[#94A3B8] truncate">
                            {getPlaylistDesc(list)}
                          </span>
                        </div>

                        <div
                          aria-hidden="true"
                          className={`w-9 h-9 rounded-full flex items-center justify-center bg-[#12151C] border shrink-0 ${
                            isActive
                              ? "border-[#00A8F3]/55 text-[#00A8F3]"
                              : "border-white/[0.10] text-white"
                          }`}
                        >
                          {isActive ? (
                            <Check size={13} />
                          ) : (
                            <Play size={11} className="fill-current ps-0.5" />
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
                    aria-label={tx("Enlace de Lista Musical", "Playlist link")}
                    value={userPlaylistUrl}
                    onChange={(e) => {
                      setUserPlaylistUrl(e.target.value);
                      if (linkError) setLinkError(null);
                    }}
                    placeholder={tx(
                      "Pega aquí el enlace de tu Lista Musical…",
                      "Paste your Playlist link here…"
                    )}
                    className="flex-1 min-w-0 min-h-[38px] bg-[#0B0E14] border border-white/[0.09] focus:border-[#00A8F3] text-white placeholder:text-[#94A3B8] text-[11.5px] font-semibold px-3 py-2.5 rounded-[12px] outline-none transition caret-[#00A8F3]"
                  />
                  <button
                    type="submit"
                    disabled={isSavingLink}
                    className="min-w-[36px] min-h-[38px] bg-[#12151C] border border-[#00A8F3]/45 hover:border-[#00A8F3] text-[#00A8F3] rounded-[12px] px-3.5 py-2.5 text-[11px] font-extrabold tracking-[0.05em] uppercase whitespace-nowrap cursor-pointer active:scale-95 transition disabled:opacity-50"
                  >
                    {saveSuccess
                      ? tx("✓ Listo", "✓ Added")
                      : isSavingLink
                      ? "..."
                      : tx("+ Agregar", "+ Add")}
                  </button>
                </div>
                {linkError && (
                  <p role="alert" className="text-[11px] text-red-400 font-bold leading-snug px-1">
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
