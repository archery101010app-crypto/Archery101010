"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, X, Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { UserProfile } from "@/lib/authService";
import type { SyncItem } from "@/lib/db/indexedDB";

interface RemoteVersionInfo {
  version: string;
  versionCode?: number;
  updatedAt?: string;
}

interface CrossOriginMigrationSnapshot {
  currentUser?: UserProfile | null;
  simulatedUsers?: UserProfile[];
  syncQueue?: SyncItem[];
  preferredLanguage?: string | null;
  unitSystem?: string | null;
}

type WinUpdateBridge = {
  __archeryBypassBeforeUnload?: boolean;
  __archeryBusySession?: boolean;
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
  ArcheryNativeAuth?: {
    reloadInAppOta?: () => void;
    getShellVersion?: () => string;
    saveCrossOriginMigrationSnapshot?: (jsonPayload: string) => void;
    consumeCrossOriginMigrationSnapshot?: () => string;
  };
};

const REMOTE_WEB_ORIGIN = "https://archery101010-c0bb4.web.app";
const OTA_MANIFEST_PATH = "/ota-version.json";
const ATTEMPTED_VER_LOCAL_KEY = "archery_attempted_update_meta";
const LOOP_GUARD_MS = 60 * 1000;
const DISMISS_COOLDOWN_MS = 30 * 60 * 1000;
const SYNC_FLUSH_TIMEOUT_MS = 12000;
const CLEANUP_TIMEOUT_MS = 2200;
const PREWARM_FETCH_TIMEOUT_MS = 1800;
const RELOAD_FAILSAFE_RESET_MS = 5000;

function isNewerVersion(remoteVer: string, localVer: string): boolean {
  const rParts = String(remoteVer || "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const lParts = String(localVer || "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(rParts.length, lParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

function detectNativeReloadBridge(): {
  canReloadNatively: boolean;
} {
  if (typeof window === "undefined") {
    return { canReloadNatively: false };
  }
  const winAny = window as unknown as WinUpdateBridge;
  const canReloadNatively = typeof winAny.ArcheryNativeAuth?.reloadInAppOta === "function";
  return { canReloadNatively };
}

function wasRecentlyAttempted(ver: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(ATTEMPTED_VER_LOCAL_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { ver?: string; ts?: number; dismissed?: boolean };
    if (parsed.ver === ver && typeof parsed.ts === "number") {
      const guardWindowMs = parsed.dismissed ? DISMISS_COOLDOWN_MS : LOOP_GUARD_MS;
      return Date.now() - parsed.ts < guardWindowMs;
    }
  } catch {
    // Ignore storage read errors
  }
  return false;
}

function markVersionAttempted(ver: string, dismissed: boolean = false): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      ATTEMPTED_VER_LOCAL_KEY,
      JSON.stringify({ ver, ts: Date.now(), ...(dismissed ? { dismissed: true } : {}) })
    );
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

function stripOtaQueryParams(): void {
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
      if (
        typeof window !== "undefined" &&
        window.location.protocol.startsWith("http") &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1"
      ) {
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), PREWARM_FETCH_TIMEOUT_MS);
        try {
          await fetch(window.location.href, {
            cache: "reload",
            credentials: "same-origin",
            signal: controller.signal
          });
        } catch {
          // Ignore network/abort errors during pre-warm
        } finally {
          clearTimeout(abortTimer);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  })();

  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))
  ]);
}

export default function AppUpdateBanner() {
  const { language, setLanguage, setUnitSystem, tx } = useLanguage();
  const isEs = language === "es";
  const [remoteInfo, setRemoteInfo] = useState<RemoteVersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const updatingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    clearAttemptedIfCurrent();
    stripOtaQueryParams();

    async function restoreCrossOriginSnapshotIfPresent() {
      if (typeof window === "undefined") return;
      const winAny = window as unknown as WinUpdateBridge;
      if (typeof winAny.ArcheryNativeAuth?.consumeCrossOriginMigrationSnapshot !== "function") {
        return;
      }
      let rawSnapshot = "";
      try {
        rawSnapshot = winAny.ArcheryNativeAuth.consumeCrossOriginMigrationSnapshot() || "";
      } catch {
        return;
      }
      if (!rawSnapshot.trim()) return;

      try {
        const snapshot = JSON.parse(rawSnapshot) as CrossOriginMigrationSnapshot;
        const { getLocalSetting, saveLocalSetting, addToSyncQueue } = await import(
          "@/lib/db/indexedDB"
        );
        const { mergeUserProfilesNonDestructive } = await import("@/lib/profileMerge");

        if (snapshot.preferredLanguage && typeof snapshot.preferredLanguage === "string") {
          try {
            localStorage.setItem("preferred_language", snapshot.preferredLanguage);
          } catch {}
          await setLanguage(snapshot.preferredLanguage).catch(() => {});
        }
        if (snapshot.unitSystem === "metric" || snapshot.unitSystem === "imperial") {
          try {
            localStorage.setItem("preferred_unit_system", snapshot.unitSystem);
          } catch {}
          await setUnitSystem(snapshot.unitSystem).catch(() => {});
        }

        let restoredUser: UserProfile | null = null;
        if (snapshot.currentUser && snapshot.currentUser.uid) {
          const existingCurrent = await getLocalSetting<UserProfile | null>("current_user", null);
          if (existingCurrent && existingCurrent.uid === snapshot.currentUser.uid) {
            const snapTs = Number(snapshot.currentUser.updatedAt || 0);
            const curTs = Number(existingCurrent.updatedAt || 0);
            const { merged } =
              snapTs >= curTs
                ? mergeUserProfilesNonDestructive(existingCurrent, snapshot.currentUser)
                : mergeUserProfilesNonDestructive(snapshot.currentUser, existingCurrent);
            restoredUser = merged;
          } else if (!existingCurrent) {
            restoredUser = snapshot.currentUser;
          } else {
            const snapTs = Number(snapshot.currentUser.updatedAt || 0);
            const curTs = Number(existingCurrent.updatedAt || 0);
            restoredUser = snapTs >= curTs ? snapshot.currentUser : existingCurrent;
          }
          if (restoredUser) {
            await saveLocalSetting("current_user", restoredUser);
          }
        }

        if (Array.isArray(snapshot.simulatedUsers) && snapshot.simulatedUsers.length > 0) {
          const existingUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const byUid = new Map<string, UserProfile>();
          for (const u of existingUsers) {
            if (u?.uid) byUid.set(u.uid, u);
          }
          for (const snapUser of snapshot.simulatedUsers) {
            if (!snapUser?.uid) continue;
            const prev = byUid.get(snapUser.uid);
            if (prev) {
              const snapTs = Number(snapUser.updatedAt || 0);
              const prevTs = Number(prev.updatedAt || 0);
              const { merged } =
                snapTs >= prevTs
                  ? mergeUserProfilesNonDestructive(prev, snapUser)
                  : mergeUserProfilesNonDestructive(snapUser, prev);
              byUid.set(snapUser.uid, merged);
            } else {
              byUid.set(snapUser.uid, snapUser);
            }
          }
          if (restoredUser?.uid) {
            byUid.set(restoredUser.uid, restoredUser);
          }
          await saveLocalSetting("simulated_users", Array.from(byUid.values()));
        }

        if (Array.isArray(snapshot.syncQueue) && snapshot.syncQueue.length > 0) {
          for (const item of snapshot.syncQueue) {
            if (item && item.id && item.collection && item.operation && item.payloadId) {
              await addToSyncQueue({
                id: item.id,
                collection: item.collection,
                operation: item.operation,
                payloadId: item.payloadId,
                payload: item.payload,
                timestamp: item.timestamp || Date.now()
              }).catch(() => {});
            }
          }
        }

        if (restoredUser && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("current-user-updated", { detail: { user: restoredUser } })
          );
        }
      } catch {
        // Ignore malformed cross-origin migration payloads
      }
    }

    void restoreCrossOriginSnapshotIfPresent();

    async function checkRemoteVersion() {
      if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.onLine) {
        return;
      }
      const winAny = window as unknown as WinUpdateBridge;
      const busyNow = Boolean(winAny.__archeryBusySession);
      if (mounted) setIsBusy(busyNow);
      if (updatingRef.current || busyNow) return;
      if (
        window.location.hash.includes("id_token") ||
        window.location.search.includes("id_token")
      ) {
        return;
      }

      const isLocalOrigin =
        !window.location.protocol.startsWith("http") ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

      try {
        const versionEndpoint = isLocalOrigin
          ? `${REMOTE_WEB_ORIGIN}${OTA_MANIFEST_PATH}?t=${Date.now()}`
          : `${OTA_MANIFEST_PATH}?t=${Date.now()}`;
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
    const handleCheckOta = () => void checkRemoteVersion();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkRemoteVersion();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("archery-check-ota", handleCheckOta);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("archery-check-ota", handleCheckOta);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (isUpdating) return;
    if (remoteInfo?.version) {
      markVersionAttempted(remoteInfo.version, true);
    }
    setDismissed(true);
  }, [isUpdating, remoteInfo]);

  const handleUpdateNow = useCallback(async () => {
    if (updatingRef.current) return;
    const { canReloadNatively } = detectNativeReloadBridge();
    const winAny = window as unknown as WinUpdateBridge;

    updatingRef.current = true;
    setIsUpdating(true);

    const targetVer = remoteInfo?.version || APP_VERSION;
    markVersionAttempted(targetVer, false);

    winAny.__archeryBypassBeforeUnload = true;
    try {
      sessionStorage.setItem("archery_intro_shown", "1");
    } catch {
      // Ignore sessionStorage errors
    }

    // Flush any pending profile/session writes to Firestore before reloading for OTA update
    try {
      const { runSync } = await import("@/lib/db/syncManager");
      await Promise.race([
        runSync(undefined, true).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, SYNC_FLUSH_TIMEOUT_MS))
      ]);
    } catch {
      // Ignore sync errors so update reload always proceeds
    }

    stripOtaQueryParams();
    await purgeServiceWorkersAndCachesBounded();

    setTimeout(() => {
      updatingRef.current = false;
      setIsUpdating(false);
    }, RELOAD_FAILSAFE_RESET_MS);

    // 1. Native reload bridge (Google Play v2.110+): 100% in-app WebView reload
    if (canReloadNatively && winAny.ArcheryNativeAuth?.reloadInAppOta) {
      if (typeof winAny.ArcheryNativeAuth.saveCrossOriginMigrationSnapshot === "function") {
        try {
          const { getLocalSetting, getSyncQueue } = await import("@/lib/db/indexedDB");
          const [currentUser, simulatedUsers, syncQueue, idbLang, idbUnits] = await Promise.all([
            getLocalSetting<UserProfile | null>("current_user", null),
            getLocalSetting<UserProfile[]>("simulated_users", []),
            getSyncQueue(),
            getLocalSetting<string | null>("preferred_language", null),
            getLocalSetting<string | null>("preferred_unit_system", null)
          ]);
          let lsLang: string | null = null;
          let lsUnits: string | null = null;
          try {
            lsLang = localStorage.getItem("preferred_language");
            lsUnits = localStorage.getItem("preferred_unit_system");
          } catch {}
          const snapshotPayload: CrossOriginMigrationSnapshot = {
            currentUser,
            simulatedUsers,
            syncQueue,
            preferredLanguage: lsLang || idbLang || null,
            unitSystem: lsUnits || idbUnits || null
          };
          winAny.ArcheryNativeAuth.saveCrossOriginMigrationSnapshot(
            JSON.stringify(snapshotPayload)
          );
        } catch {
          // Proceed with in-app reload even if snapshot serialization fails
        }
      }
      winAny.ArcheryNativeAuth.reloadInAppOta();
      return;
    }

    // 2. Google Play v2.100 shells on remote origin, Apple App Store WKWebView & Web/PWA:
    // PAGE_TRANSITION_RELOAD stays 100% inside the app and never invokes external browser intents
    window.location.reload();
  }, [remoteInfo]);

  const winBusy =
    isBusy ||
    (typeof window !== "undefined" &&
      Boolean((window as unknown as WinUpdateBridge).__archeryBusySession));

  if (winBusy || dismissed || !remoteInfo) {
    return null;
  }

  return (
    <div className={`w-full max-w-md mx-auto ${isEs ? "px-3" : "px-0.5"} pt-2 z-50 shrink-0`}>
      <div className="bg-[#06080C] border border-[#00A8F3]/40 rounded-2xl p-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-[#04101C] border border-[#00A8F3]/35 flex items-center justify-center text-[#00A8F3] shrink-0">
            <Sparkles size={15} />
          </div>
          <div className={`flex flex-col min-w-0${!isEs ? " text-start" : ""}`}>
            <span className="text-white text-xs font-extrabold uppercase tracking-wider truncate tabular-nums">
              {isEs ? (
                `Nueva versión disponible · v${remoteInfo.version}`
              ) : (
                <>
                  New version available · <span dir="ltr">v{remoteInfo.version}</span>
                </>
              )}
            </span>
            <span className="text-[10.5px] text-white truncate tabular-nums">
              {isEs ? (
                `Actualiza al instante con un toque (tienes v${APP_VERSION})`
              ) : (
                <>
                  Instant one-tap update <span dir="ltr">(current v{APP_VERSION})</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleUpdateNow()}
            disabled={isUpdating}
            className="px-3 py-1.5 rounded-xl bg-[#00A8F3] hover:bg-[#19b5fa] text-black font-extrabold text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer active:scale-95 whitespace-nowrap"
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
