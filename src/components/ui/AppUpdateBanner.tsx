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
  __archeryBusySession?: boolean;
  ArcheryNativeAuth?: {
    reloadInAppOta?: () => void;
    getShellVersion?: () => string;
  };
};

const REMOTE_WEB_ORIGIN = "https://archery101010-c0bb4.web.app";
const ATTEMPTED_VER_LOCAL_KEY = "archery_attempted_update_meta";
// Short 30-second anti-loop guard prevents infinite reload cycles if CDN propagation lags,
// without locking out retries for minutes if a user tapped while briefly offline.
const LOOP_GUARD_MS = 30 * 1000;

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

function wasJustAttempted(ver: string): boolean {
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

function hasActiveUserGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  return Boolean(ua?.isActive);
}

async function purgeServiceWorkersAndCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(
        registrations.map((r) => {
          // Only unregister root app shell SW, preserve dedicated FCM push worker if separate
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
    // Pre-warm fresh HTML document from network bypassing HTTP disk cache
    await fetch(`/?ota=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    }).catch(() => {});
  } catch {
    // Ignore cleanup errors
  }
}

export default function AppUpdateBanner() {
  const { tx } = useLanguage();
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const updatingRef = useRef(false);

  const executeInAppUpdate = useCallback(async (targetVer: string, fromButtonTap: boolean) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setIsUpdating(true);
    setUpdateProgress(15);
    markVersionAttempted(targetVer);

    const winAny = window as unknown as WinUpdateBridge;
    winAny.__archeryBypassBeforeUnload = true;
    try {
      sessionStorage.setItem("archery_intro_shown", "1");
    } catch {
      // Ignore sessionStorage errors
    }

    const canReloadNatively = typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function";
    const isLegacyAndroidShell = Boolean(winAny.ArcheryNativeAuth) && !canReloadNatively;

    // Start cache & SW cleanup immediately
    const cleanupPromise = purgeServiceWorkersAndCaches();

    // 1. Modern Android native shell (v2.107+): Java WebView.loadUrl() clears disk cache & stays 100% in-app immediately
    if (canReloadNatively) {
      await cleanupPromise;
      setUpdateProgress(100);
      winAny.ArcheryNativeAuth!.reloadInAppOta!();
      return;
    }

    // 2. Legacy Android native shell (< v2.107):
    // In Android System WebView (AwContentsIoThreadClient), JS navigations ONLY invoke Capacitor's
    // shouldOverrideUrlLoading (which opens external Chrome in pre-v2.107 APKs) when Chromium's
    // TransientUserActivation (navigator.userActivation.isActive / has_user_gesture) is true!
    // Waiting until userActivation.isActive flips to false (~5s after tap, or 0ms on auto-check)
    // guarantees Android WebView C++ bypasses shouldOverrideUrlLoading and reloads 100% inside the app!
    if (isLegacyAndroidShell) {
      const startMs = Date.now();
      const maxWaitMs = 11000;

      if (fromButtonTap || hasActiveUserGesture()) {
        while (hasActiveUserGesture() && Date.now() - startMs < maxWaitMs) {
          const elapsed = Date.now() - startMs;
          const pct = Math.min(94, 18 + Math.round((elapsed / 5100) * 76));
          setUpdateProgress(pct);
          await new Promise((r) => setTimeout(r, 90));
        }
      }

      await cleanupPromise;
      setUpdateProgress(100);
      window.location.replace(`${REMOTE_WEB_ORIGIN}/?ota=${Date.now()}&skipIntro=1`);
      return;
    }

    // 3. Standard Web Browser / Installed PWA: immediate cache-busted same-origin reload
    await cleanupPromise;
    setUpdateProgress(100);
    const targetPath = window.location.pathname || "/";
    window.location.replace(`${targetPath}?ota=${Date.now()}&skipIntro=1`);
  }, []);

  useEffect(() => {
    let mounted = true;
    clearAttemptedIfCurrent();

    // Clean leftover ?v=...&t=...&ota=...&skipIntro=... query parameters silently without triggering navigation
    if (typeof window !== "undefined") {
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

    async function checkRemoteVersion(triggerSource: "boot" | "resume" | "online") {
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
          !wasJustAttempted(data.version)
        ) {
          // If the app just booted or resumed while idle (not in an active scoring/duel session)
          // and there is NO active user touch gesture, apply the OTA update silently & instantly in-place!
          const isBusy = Boolean(winAny.__archeryBusySession);
          if ((triggerSource === "boot" || triggerSource === "resume") && !isBusy && !hasActiveUserGesture()) {
            void executeInAppUpdate(data.version, false);
            return;
          }
          setDismissed(false);
          setRemoteInfo(data);
        } else {
          setRemoteInfo(null);
        }
      } catch {
        // Silent fallback when offline or unreachable
      }
    }

    void checkRemoteVersion("boot");

    const handleOnline = () => void checkRemoteVersion("online");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkRemoteVersion("resume");
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [executeInAppUpdate]);

  if ((!remoteInfo && !isUpdating) || dismissed) return null;

  const displayVersion = remoteInfo?.version || APP_VERSION;

  const handleDismiss = () => {
    if (isUpdating) return;
    if (remoteInfo?.version) {
      markVersionAttempted(remoteInfo.version);
    }
    setDismissed(true);
  };

  const handleUpdateNow = () => {
    void executeInAppUpdate(displayVersion, true);
  };

  return (
    <>
      {isUpdating && (
        <div className="fixed inset-0 z-[9999] bg-[#020305]/92 backdrop-blur-sm flex items-center justify-center px-6 select-none">
          <div className="w-full max-w-xs bg-[#07090E] border border-[#00A8F3]/40 rounded-2xl p-5 flex flex-col items-center text-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#04101C] border border-[#00A8F3]/35 flex items-center justify-center text-[#00A8F3]">
              <RefreshCw size={18} className="animate-spin" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-white text-sm font-extrabold uppercase tracking-wider tabular-nums">
                {tx(`Actualizando a v${displayVersion}`, `Updating to v${displayVersion}`)}
              </span>
              <span className="text-xs text-[#9BA4B5]">
                {tx(
                  "Aplicando dentro de la app, espera un instante...",
                  "Applying in-app update, please wait a moment..."
                )}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#12151C] overflow-hidden mt-1">
              <div
                className="h-full bg-[#00A8F3] transition-all duration-150 ease-out rounded-full"
                style={{ width: `${Math.max(12, updateProgress)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-md mx-auto px-3 pt-2 z-50 shrink-0">
        <div className="bg-[#06080C] border border-[#00A8F3]/40 rounded-2xl p-3 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-[#04101C] border border-[#00A8F3]/35 flex items-center justify-center text-[#00A8F3] shrink-0">
              <Sparkles size={15} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-white text-xs font-extrabold uppercase tracking-wider truncate tabular-nums">
                {tx(
                  `Nueva versión disponible · v${displayVersion}`,
                  `New version available · v${displayVersion}`
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
    </>
  );
}
