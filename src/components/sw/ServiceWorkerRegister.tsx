"use client";

import { useEffect } from "react";
import { APP_VERSION } from "@/lib/version";
import { Capacitor } from "@capacitor/core";

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

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Immediate boot-time check if WebView opened from an older local APK asset bundle (https://localhost)
    // Redirect BEFORE the IntroScreen finishes so the user never sees an older version flash and restart.
    const isNativeLocal =
      window.location.hostname === "localhost" &&
      (Capacitor.isNativePlatform() || !!(window as any).ArcheryNativeAuth);
    const hasOAuthToken =
      window.location.hash.includes("id_token") || window.location.search.includes("id_token");

    if (isNativeLocal && navigator.onLine && !hasOAuthToken) {
      fetch(`https://archery101010-c0bb4.web.app/version.json?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.version && isNewerVersion(data.version, APP_VERSION)) {
            try {
              sessionStorage.setItem("archery_intro_shown", "1");
            } catch {}
            window.location.replace(
              `https://archery101010-c0bb4.web.app/?v=${data.version}&skipIntro=1${window.location.hash || ""}`
            );
          }
        })
        .catch(() => {});
    }

    // 2. Register Service Worker silently without forcing a jarring mid-session window.location.reload()
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                }
              });
            }
          });

          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    }
  }, []);

  return null;
}
