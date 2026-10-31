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

export default function AppUpdateBanner() {
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkRemoteVersion() {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
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

  if (!remoteInfo || dismissed) return null;

  const handleUpdateNow = async () => {
    setIsUpdating(true);
    try {
      const isNative = Capacitor.isNativePlatform();
      if (isNative) {
        // On Android native app, download the latest signed APK or open Play Store
        const targetUrl =
          remoteInfo.apkUrl ||
          `https://raw.githubusercontent.com/archery101010app-crypto/Archery101010/main/releases/Archery101010-v${remoteInfo.version}.apk`;
        window.open(targetUrl, "_system");
        setIsUpdating(false);
        return;
      }

      // On Web / PWA: unregister stale service workers & clear caches, then reload
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
      <div className="bg-[#0B0F17] border border-cyan-neon/40 rounded-2xl p-3 flex items-center justify-between gap-2.5 shadow-[0_8px_28px_rgba(0,229,255,0.18)]">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-cyan-neon/15 border border-cyan-neon/35 flex items-center justify-center text-cyan-neon shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-white text-xs font-black uppercase tracking-wider truncate">
              Nueva versión v{remoteInfo.version} lista
            </span>
            <span className="text-[10.5px] text-white/80 truncate">
              Actualiza con un toque (tienes v{APP_VERSION})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUpdateNow}
            disabled={isUpdating}
            className="px-3 py-1.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer active:scale-95"
          >
            <RefreshCw size={12} className={isUpdating ? "animate-spin" : ""} />
            <span>{isUpdating ? "Actualizando..." : "Actualizar"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-lg text-white/60 hover:text-white transition cursor-pointer"
            title="Cerrar aviso"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
