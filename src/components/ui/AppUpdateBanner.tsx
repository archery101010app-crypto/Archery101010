"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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

type WinUpdateBridge = {
  __archeryBypassBeforeUnload?: boolean;
  ArcheryNativeAuth?: {
    reloadInAppOta?: () => void;
    getShellVersion?: () => string;
  };
};

const REMOTE_WEB_ORIGIN = "https://archery101010-c0bb4.web.app";
const ATTEMPTED_VER_LOCAL_KEY = "archery_attempted_update_meta";
const LOOP_GUARD_MS = 60 * 1000;
const CLEANUP_TIMEOUT_MS = 2200;
const PREWARM_FETCH_TIMEOUT_MS = 1800;
const RELOAD_FAILSAFE_RESET_MS = 5000;

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
    const raw = localStorage.getItem(ATTEMPTED_VER_LOCAL_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { ver?: string; ts?: number };
    if (parsed.ver === ver && typeof parsed.ts === "number") {
      return Date.now() - parsed.ts < LOOP_GUARD_MS;
    }
  } catch {
    // Ignore storage read errors
  }
  return false;
}

function markVersionAttempted(ver: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ATTEMPTED_VER_LOCAL_KEY, JSON.stringify({ ver, ts: Date.now() }));
  } catch {
    // Ignore storage write errors
  }
}

function clearAttemptedIfCurrent(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(ATTEMPTED_VER_LOCAL_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { ver?: string };
    if (parsed.ver === APP_VERSION) {
      localStorage.removeItem(ATTEMPTED_VER_LOCAL_KEY);
    }
  } catch {
    // Ignore storage cleanup errors
  }
}

function stripOtaQueryParamsInPlace(): void {
  if (typeof window === "undefined") return;
  try {
    const curUrl = new URL(window.location.href);
    if (
      curUrl.searchParams.has("v") ||
      curUrl.searchParams.has("t") ||
      curUrl.searchParams.has("ota") ||
      curUrl.searchParams.has("skipIntro")
    ) {
      curUrl.searchParams.delete("v");
      curUrl.searchParams.delete("t");
      curUrl.searchParams.delete("ota");
      curUrl.searchParams.delete("skipIntro");
      const nextRelative =
        curUrl.pathname + (curUrl.search ? curUrl.search : "") + (curUrl.hash ? curUrl.hash : "");
      window.history.replaceState(null, "", nextRelative || "/");
    }
  } catch {
    // Ignore URL cleanup errors
  }
}

async function purgeServiceWorkersAndCachesBounded(): Promise<void> {
  const work = (async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(
          registrations.map((r) => {
            if (r.scope.includes("firebase-cloud-messaging-push-scope")) {
              return r.update();
            }
            return r.unregister();
          })
        );
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.allSettled(keys.map((k) => caches.delete(k)));
      }
      // Overwrite Chromium's HTTP cache entry for the exact current URL (cache: "reload")
      // so window.location.reload() always reads the brand-new HTML on the first tap.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), PREWARM_FETCH_TIMEOUT_MS);
      try {
        await fetch(window.location.href, {
          cache: "reload",
          credentials: "same-origin",
          signal: controller.signal,
        });
      } catch {
        // Ignore network/abort errors during pre-warm
      } finally {
        clearTimeout(abortTimer);
      }
    } catch {
      // Ignore cleanup errors
    }
  })();

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
  ]);
}

export default function AppUpdateBanner() {
  const { tx } = useLanguage();
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updatingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    clearAttemptedIfCurrent();
    stripOtaQueryParamsInPlace();

    async function checkRemoteVersion() {
      if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.onLine) return;
      if (updatingRef.current) return;
      if (
        window.location.hash.includes("id_token") ||
        window.location.search.includes("id_token")
      ) {
        return;
      }

      const isBundledLocalhost =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const winAny = window as unknown as WinUpdateBridge;
      const canReloadNatively = typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function";
      const isLegacyAndroidShell = Boolean(winAny.ArcheryNativeAuth) && !canReloadNatively;

      // On bundled https://localhost inside pre-v2.107 shells without reloadInAppOta,
      // never prompt a cross-origin web navigation.
      if (isBundledLocalhost && isLegacyAndroidShell) {
        return;
      }

      try {
        const versionEndpoint = isBundledLocalhost
          ? `${REMOTE_WEB_ORIGIN}/version.json?t=${Date.now()}`
          : `/version.json?t=${Date.now()}`;
        const res = await fetch(versionEndpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data: RemoteVersionInfo = await res.json();
        if (!mounted) return;

        if (
          data?.version &&
          isNewerVersion(data.version, APP_VERSION) &&
          !wasRecentlyAttempted(data.version)
        ) {
          setDismissed(false);
          setRemoteInfo(data);
        } else {
          setRemoteInfo(null);
        }
      } catch {
        // Silent fallback when offline or unreachable
      }
    }

    void checkRemoteVersion();

    const handleOnline = () => void checkRemoteVersion();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkRemoteVersion();
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

  const handleDismiss = useCallback(() => {
    if (isUpdating) return;
    if (remoteInfo?.version) {
      markVersionAttempted(remoteInfo.version);
    }
    setDismissed(true);
  }, [isUpdating, remoteInfo]);

  const handleUpdateNow = useCallback(async () => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setIsUpdating(true);

    const targetVer = remoteInfo?.version || APP_VERSION;
    markVersionAttempted(targetVer);

    const winAny = window as unknown as WinUpdateBridge;
    winAny.__archeryBypassBeforeUnload = true;
    try {
      sessionStorage.setItem("archery_intro_shown", "1");
    } catch {
      // Ignore sessionStorage errors
    }

    stripOtaQueryParamsInPlace();
    await purgeServiceWorkersAndCachesBounded();

    // Failsafe reset so the button never stays locked if the device loses connectivity mid-reload
    setTimeout(() => {
      updatingRef.current = false;
      setIsUpdating(false);
    }, RELOAD_FAILSAFE_RESET_MS);

    // 1. Modern Android native shell (v2.107+): Java WebView.clearCache(true) + WebView.loadUrl()
    if (typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function") {
      winAny.ArcheryNativeAuth.reloadInAppOta();
      return;
    }

    // 2. Legacy Android native shell (< v2.107) on remote OTA origin & Web/PWA:
    // CRITICAL: Always use window.location.reload() (Chromium ui::PAGE_TRANSITION_RELOAD).
    // PAGE_TRANSITION_RELOAD NEVER invokes WebViewClient.shouldOverrideUrlLoading() in Android WebView,
    // guaranteeing 0% chance of Capacitor launching an external browser Intent!
    window.location.reload();
  }, [remoteInfo]);

  if (!remoteInfo || dismissed) return null;

  return (
    <div className="w-full max-w-md mx-auto px-3 pt-2 z-50 shrink-0">
      <div className="bg-[#06080C] border border-[#00A8F3]/40 rounded-2xl p-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-[#04101C] border border-[#00A8F3]/35 flex items-center justify-center text-[#00A8F3] shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-white text-xs font-extrabold uppercase tracking-wider truncate tabular-nums">
              {tx(
                `Nueva versión disponible · v${remoteInfo.version}`,
                `New version available · v${remoteInfo.version}`
              )}
            </span>
            <span className="text-[10.5px] text-[#8E96A4] truncate tabular-nums">
              {tx(
                `Actualiza al instante con un toque (tienes v${APP_VERSION})`,
                `Instant one-tap update (current v${APP_VERSION})`
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleUpdateNow()}
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
            disabled={isUpdating}
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
