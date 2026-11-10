"use client";

import React, { useState, useEffect } from "react";
import { RefreshCw, X, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { Capacitor } from "@capacitor/core";

interface RemoteVersionInfo {
  version: string;
  versionCode?: number;
  apkUrl?: string;
  playStoreUrl?: string;
  updatedAt?: string;
}

const ANDROID_MARKET_URI = "market://details?id=com.archery101010.app";
const ANDROID_STORE_HTTPS_URL =
  "https://play.google.com/store/apps/details?id=com.archery101010.app";

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

function isNativeAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as any).ArcheryNativeAuth ||
      window.location.origin === "https://localhost" ||
      Capacitor.isNativePlatform()
  );
}

function openNativeAppStoreListing(fallbackHttpsUrl?: string): void {
  if (typeof window === "undefined") return;
  const storeWebUrl = fallbackHttpsUrl || ANDROID_STORE_HTTPS_URL;
  try {
    const opened = window.open(ANDROID_MARKET_URI, "_system");
    if (!opened) {
      window.location.href = ANDROID_MARKET_URI;
    }
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        window.open(storeWebUrl, "_blank", "noopener,noreferrer");
      }
    }, 900);
  } catch {
    window.open(storeWebUrl, "_blank", "noopener,noreferrer");
  }
}

export default function AppUpdateBanner() {
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [needsNativeWatchApkUpgrade, setNeedsNativeWatchApkUpgrade] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (
      typeof window !== "undefined" &&
      !!(window as any).ArcheryNativeAuth &&
      !(window as any).ArcheryWatchNativeBridge
    ) {
      setNeedsNativeWatchApkUpgrade(true);
    }

    async function checkRemoteVersion() {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (
        typeof window !== "undefined" &&
        (window.location.hash.includes("id_token") || window.location.search.includes("id_token"))
      ) {
        return;
      }
      try {
        const res = await fetch(
          `https://archery101010-c0bb4.web.app/version.json?t=${Date.now()}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data: RemoteVersionInfo = await res.json();
        if (mounted && data?.version && isNewerVersion(data.version, APP_VERSION)) {
          setRemoteInfo(data);
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

  if ((!remoteInfo && !needsNativeWatchApkUpgrade) || dismissed) return null;

  const handleUpdateNow = async () => {
    // On native Android APK/AAB, NEVER switch WebView origin away from https://localhost
    // (which would split IndexedDB and break 100% offline launch). Always open the official store listing.
    if (isNativeAndroidApp() || (needsNativeWatchApkUpgrade && !remoteInfo)) {
      openNativeAppStoreListing(remoteInfo?.playStoreUrl);
      return;
    }

    setIsUpdating(true);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
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
              {remoteInfo
                ? `Nueva versión v${remoteInfo.version} lista`
                : "Motor Smartwatch Deportivo disponible"}
            </span>
            <span className="text-[10.5px] text-[#8E96A4] truncate tabular-nums">
              {remoteInfo
                ? `Actualiza con un toque (tienes v${APP_VERSION})`
                : "Actualiza la aplicación en la Tienda de Aplicaciones"}
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
              {isUpdating
                ? "Actualizando..."
                : remoteInfo
                ? "Actualizar"
                : "Tienda"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-lg text-white/80 hover:text-white transition cursor-pointer"
            title="Cerrar aviso"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
