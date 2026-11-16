"use client";

import { auth, db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";

export interface CrashLogEntry {
  id: string;
  userId: string | null;
  section: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  createdAt: number;
}

const CRASH_LOGS_STORAGE_KEY = "archery_crash_logs";
const MAX_REPORTS_PER_SESSION = 5;
const MAX_LOCAL_LOGS = 20;

let sessionReportCount = 0;
let globalHandlersInitialized = false;

function extractErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Error",
      stack: typeof error.stack === "string" ? error.stack : undefined
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const maybeErr = error as Record<string, unknown>;
    const msg =
      typeof maybeErr.message === "string"
        ? maybeErr.message
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
    const stk = typeof maybeErr.stack === "string" ? maybeErr.stack : undefined;
    return { message: msg, stack: stk };
  }
  return { message: String(error ?? "Unknown client error") };
}

export function getLocalCrashLogs(): CrashLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CRASH_LOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Reports a client-side runtime error locally (`archery_crash_logs`, max 20)
 * and best-effort to Firestore (`client_error_logs/{errId}`) when signed in.
 * Rate-limited to at most 5 reports per browser session.
 */
export async function reportClientError(error: unknown, section: string = "global"): Promise<void> {
  if (typeof window === "undefined") return;
  if (sessionReportCount >= MAX_REPORTS_PER_SESSION) return;
  sessionReportCount += 1;

  try {
    const { message, stack } = extractErrorDetails(error);
    const now = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const errId = `ERR-${now}-${randomSuffix}`;

    const entry: CrashLogEntry = {
      id: errId,
      userId: auth.currentUser?.uid || null,
      section: (section || "global").slice(0, 80),
      message: (message || "Unknown error").slice(0, 500),
      ...(stack ? { stack: stack.slice(0, 2000) } : {}),
      url: (window.location?.href || "").slice(0, 300),
      userAgent: (typeof navigator !== "undefined" ? navigator.userAgent || "" : "").slice(0, 250),
      createdAt: now
    };

    try {
      const existing = getLocalCrashLogs();
      const updated = [entry, ...existing].slice(0, MAX_LOCAL_LOGS);
      localStorage.setItem(CRASH_LOGS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore localStorage quota or private-mode errors
    }

    if (auth.currentUser && (typeof navigator === "undefined" || navigator.onLine)) {
      await setDoc(doc(db, "client_error_logs", errId), entry).catch(() => {});
    }
  } catch {
    // Telemetry must never throw or cascade into secondary crashes
  }
}

/**
 * Attaches global window `error` and `unhandledrejection` telemetry listeners once per page load.
 */
export function initGlobalCrashHandlers(): void {
  if (typeof window === "undefined" || globalHandlersInitialized) return;
  globalHandlersInitialized = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    reportClientError(event.error || event.message || "Uncaught window error", "window.onerror");
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportClientError(event.reason || "Unhandled promise rejection", "unhandledrejection");
  });
}
