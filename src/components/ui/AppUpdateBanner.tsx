"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, X, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { useLanguage } from "@/lib/contexts/LanguageContext";

interface RemoteVersionInfo {
  version: string;
  versionCode?: number;
  apkUrl?: string;
  playStoreUrl?: string;
  updatedAt?: string;
}

const REMOTE_WEB_ORIGIN = "https://archery101010-c0bb4.web.app";
const ATTEMPTED_VER_SESSION_KEY = "archery_attempted_update_ver";
const ATTEMPTED_VER_LOCAL_KEY = "archery_attempted_update_meta";
const COOLDOWN_MS = 10 * 60 * 1000; // 10 min anti-loop guard per version

function isNewerVersion(remoteVer: string, localVer: string): boolean {
  const rParts = remoteVer.split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = localVer.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(rParts.length, lParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

function wasRecentlyAttempted(ver: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(ATTEMPTED_VER_SESSION_KEY) === ver) {
      return true;
    }
    const raw = localStorage.getItem(ATTEMPTED_VER_LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { ver?: string; ts?: number };
      if (parsed.ver === ver && typeof parsed.ts === "number" && Date.now() - parsed.ts < COOLDOWN_MS) {
        return true;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return false;
}

function markVersionAttempted(ver: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ATTEMPTED_VER_SESSION_KEY, ver);
    localStorage.setItem(ATTEMPTED_VER_LOCAL_KEY, JSON.stringify({ ver, ts: Date.now() }));
  } catch {
    // Ignore storage write errors
  }
}

export default function AppUpdateBanner() {
  const { tx } = useLanguage();
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [legacyRestartNotice, setLegacyRestartNotice] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Clean leftover ?v=...&t=...&ota=... update query parameters silently without triggering navigation
    if (typeof window !== "undefined") {
      try {
        const curUrl = new URL(window.location.href);
        if (
          curUrl.searchParams.has("v") ||
          curUrl.searchParams.has("t") ||
          curUrl.searchParams.has("ota")
        ) {
          curUrl.searchParams.delete("v");
          curUrl.searchParams.delete("t");
          curUrl.searchParams.delete("ota");
          const nextRelative =
            curUrl.pathname + (curUrl.search ? curUrl.search : "") + (curUrl.hash ? curUrl.hash : "");
          window.history.replaceState(null, "", nextRelative || "/");
        }
      } catch {
        // Ignore URL cleanup errors
      }
    }

    async function checkRemoteVersion() {
      if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.onLine) return;
      if (
        window.location.hash.includes("id_token") ||
        window.location.search.includes("id_token")
      ) {
        return;
      }

      // Inside an older native Android APK running bundled https://localhost without reloadInAppOta,
      // never prompt a web redirect that Capacitor would open in external Chrome.
      const isBundledLocalhost =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const winAny = window as unknown as {
        ArcheryNativeAuth?: { reloadInAppOta?: () => void };
      };
      const isNativeShell = Boolean(winAny.ArcheryNativeAuth);
      const canReloadNatively = typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function";
      if (isBundledLocalhost && isNativeShell && !canReloadNatively) {
        return;
      }

      try {
        const versionEndpoint = isBundledLocalhost
          ? `${REMOTE_WEB_ORIGIN}/version.json?t=${Date.now()}`
          : `/version.json?t=${Date.now()}`;
        const res = await fetch(versionEndpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data: RemoteVersionInfo = await res.json();
        if (
          mounted &&
          data?.version &&
          isNewerVersion(data.version, APP_VERSION) &&
          !wasRecentlyAttempted(data.version)
        ) {
          setRemoteInfo(data);
        } else if (mounted) {
          setRemoteInfo(null);
        }
      } catch {
        // Silent fallback when offline or unreachable
      }
    }

    checkRemoteVersion();

    const handleOnline = () => checkRemoteVersion();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkRemoteVersion();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (!remoteInfo || dismissed) return null;

  const handleDismiss = () => {
    markVersionAttempted(remoteInfo.version);
    setDismissed(true);
  };

  const handleUpdateNow = async () => {
    setIsUpdating(true);
    const targetVer = remoteInfo?.version || APP_VERSION;
    markVersionAttempted(targetVer);

    const winAny = window as unknown as {
      __archeryBypassBeforeUnload?: boolean;
      ArcheryNativeAuth?: { reloadInAppOta?: () => void };
    };
    winAny.__archeryBypassBeforeUnload = true;

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // Bust HTTP cache for root HTML documents in background before in-place reload
      await Promise.all([
        fetch("/", {
          cache: "reload",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        }).catch(() => {}),
        fetch(window.location.pathname || "/", {
          cache: "reload",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        }).catch(() => {}),
      ]);
    } catch {
      // Ignore cache cleanup error
    }

    // 1. Modern Android native shell (v2.107+): reload 100% in-app via Java WebView.loadUrl()
    if (typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function") {
      winAny.ArcheryNativeAuth.reloadInAppOta();
      return;
    }

    // 2. Legacy Android native shell (< v2.107): NEVER call window.location.reload() on .web.app,
    // because legacy Capacitor Bridge.launchIntent() intercepts JS reloads and opens external Chrome.
    // Instead, close the Activity cleanly via @capacitor/app so reopening loads the new bundle in-app.
    if (winAny.ArcheryNativeAuth) {
      setLegacyRestartNotice(true);
      setTimeout(async () => {
        try {
          const { App } = await import("@capacitor/app");
          await App.exitApp();
        } catch {
          // User can simply close and reopen the app if exitApp is unavailable
        }
      }, 950);
      return;
    }

    // 3. Standard Web Browser / Installed PWA: cache-busted same-origin reload stays 100% in-place
    const targetPath = window.location.pathname || "/";
    window.location.replace(`${targetPath}?ota=${Date.now()}`);
  };

  return (
    <div className="w-full max-w-md mx-auto px-3 pt-2 z-50 shrink-0">
      <div className="bg-[#06080C] border border-[#00A8F3]/40 rounded-2xl p-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-[#04101C] border border-[#00A8F3]/35 flex items-center justify-center text-[#00A8F3] shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-white text-xs font-extrabold uppercase tracking-wider truncate tabular-nums">
              {legacyRestartNotice
                ? tx("Actualización lista · Reiniciando", "Update ready · Restarting")
                : tx(
                    `Nueva versión disponible · v${remoteInfo.version}`,
                    `New version available · v${remoteInfo.version}`
                  )}
            </span>
            <span className="text-[10.5px] text-[#8E96A4] truncate tabular-nums">
              {legacyRestartNotice
                ? tx(
                    "Vuelve a tocar el ícono de la app para abrirla actualizada",
                    "Tap the app icon again to open the updated version"
                  )
                : tx(
                    `Actualiza al instante con un toque (tienes v${APP_VERSION})`,
                    `Instant one-tap update (current v${APP_VERSION})`
                  )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={isUpdating}
            className="px-3 py-1.5 rounded-xl bg-[#00A8F3] hover:bg-[#19b5fa] text-black font-extrabold text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer active:scale-95"
          >
            <RefreshCw size={12} className={isUpdating ? "animate-spin" : ""} />
            <span>
              {isUpdating ? tx("Actualizando...", "Updating...") : tx("Actualizar", "Update")}
            </span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-white/80 hover:text-white transition cursor-pointer"
            title={tx("Cerrar aviso", "Dismiss")}
            aria-label={tx("Cerrar aviso", "Dismiss")}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
