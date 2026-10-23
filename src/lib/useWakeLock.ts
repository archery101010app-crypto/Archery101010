"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Screen Wake Lock hook.
 * Keeps the screen awake during active shooting sessions or running tournament clocks.
 * Automatically re-acquires the lock when returning from background.
 */
export function useWakeLock(enabled: boolean = true) {
  const [isLocked, setIsLocked] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    const supported = "wakeLock" in navigator;
    setIsSupported(supported);
    if (!supported || !enabled) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
        setIsLocked(false);
      }
      return;
    }

    let isMounted = true;

    const requestLock = async () => {
      try {
        if (!navigator.wakeLock || wakeLockRef.current !== null) return;
        const lock = await navigator.wakeLock.request("screen");
        if (!isMounted) {
          lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        setIsLocked(true);

        lock.addEventListener("release", () => {
          if (isMounted) {
            wakeLockRef.current = null;
            setIsLocked(false);
          }
        });
      } catch (err) {
        // Wake Lock can fail if system battery saver is strict or window is not active
        if (isMounted) setIsLocked(false);
      }
    };

    requestLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabled) {
        requestLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [enabled]);

  return { isSupported, isLocked };
}
