"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Copy, Check, Link2, Unlink } from "lucide-react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  BiometricSessionSnapshot,
  WatchConnectionStatus,
  CloudWatchPairingStatus,
  formatKmAndMiles,
  publishWatchState,
  readStoredWatchState,
  sendWatchCommand,
  subscribeWatchMessages,
  subscribeWatchConnectionStatus,
  pingNativeWatch,
  installAppOnWatch,
  calculateActiveKcal,
  getOrCreatePhoneWatchPairingCode,
  connectWatchClientToPairingCode,
  disconnectWatchClientPairingCode,
  getActiveWatchClientPairingCode,
  subscribeCloudWatchPairingStatus
} from "@/lib/scoring/biometricsEngine";

interface SmartwatchMiniAppProps {
  isOpen?: boolean;
  standaloneWatchScreen?: boolean;
  standalone?: boolean;
  onClose?: () => void;
  liveSnapshot?: BiometricSessionSnapshot;
  onIncrementArrow?: (delta: number, source: "watch_manual" | "watch_auto") => void;
  onToggleAutoDetect?: (enabled: boolean) => void;
  onFinishAndSendToCoach?: () => void;
}

const SCORE_KEYS = ["X", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "M"] as const;

function scorePointsForKey(val: string): number {
  if (val === "X" || val === "10") return 10;
  if (val === "M") return 0;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= 1 && n <= 9 ? n : 0;
}

export default function SmartwatchMiniApp({
  isOpen = true,
  standaloneWatchScreen = false,
  standalone = false,
  onClose,
  liveSnapshot,
  onIncrementArrow,
  onToggleAutoDetect,
  onFinishAndSendToCoach
}: SmartwatchMiniAppProps) {
  const isStandalone = Boolean(standaloneWatchScreen || standalone);

  // 0: Contador, 1: Puntos (X..M), 2: Métricas, 3: Auto-Tiro, 4: Resumen
  const [screenIdx, setScreenIdx] = useState<number>(0);
  const [watchShape, setWatchShape] = useState<"ROUND" | "SQUARE">("ROUND");
  const [sensitivity, setSensitivity] = useState<"ALTA" | "MEDIA" | "BAJA">("MEDIA");
  const [justDetectedShot, setJustDetectedShot] = useState<boolean>(false);
  const [, setWristImpulseLevel] = useState<number>(0);
  const [iosMotionNeedsPermission, setIosMotionNeedsPermission] = useState<boolean>(false);
  const [iosMotionGranted, setIosMotionGranted] = useState<boolean>(false);

  // 6-Digit Cloud Watch Pairing state
  const [pairingCode, setPairingCode] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [cloudStatus, setCloudStatus] = useState<CloudWatchPairingStatus>({
    pairingCode: "",
    cloudConnected: false,
    watchLinked: false,
    watchSource: null,
    lastCloudSyncAt: 0,
    lastWatchSeenAt: 0
  });
  const [standaloneCodeInput, setStandaloneCodeInput] = useState<string>("");
  const [standaloneLinking, setStandaloneLinking] = useState<boolean>(false);
  const [standaloneLinkError, setStandaloneLinkError] = useState<string>("");
  const [showStandaloneLinkPanel, setShowStandaloneLinkPanel] = useState<boolean>(false);

  const [internalSnapshot, setInternalSnapshot] = useState<BiometricSessionSnapshot>(() => {
    return (
      liveSnapshot ||
      readStoredWatchState() || {
        sessionId: "WATCH-LIVE",
        sessionActive: true,
        arrowsCount: 0,
        totalScore: 0,
        distanceM: 50,
        arrowsPerEnd: 6,
        endsCount: 12,
        completedEnds: 0,
        currentEndIndex: 0,
        currentEndArrows: [],
        stepsCount: 0,
        gpsDistanceM: 0,
        distanceWalkedM: 0,
        gpsActive: true,
        activeKcal: 0,
        bowPoundageLbs: 38,
        practiceType: "Volumen",
        bowType: "Compound",
        autoDetectEnabled: true,
        updatedAt: Date.now()
      }
    );
  });

  const activeState = liveSnapshot || internalSnapshot;

  const [watchConnStatus, setWatchConnStatus] = useState<WatchConnectionStatus>({
    isNativeAndroid: false,
    isNativeIos: false,
    bridgeReady: false,
    connectedNodesCount: 0,
    connectedNodes: [],
    lastMessageAt: 0,
    lastPongAt: 0,
    hasCachedState: false
  });
  const [isSyncingWatch, setIsSyncingWatch] = useState<boolean>(false);

  // Detect whether iOS Safari requires explicit DeviceMotionEvent.requestPermission() on tap
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dm = (window as any).DeviceMotionEvent;
    if (dm && typeof dm.requestPermission === "function") {
      setIosMotionNeedsPermission(true);
    } else {
      setIosMotionGranted(true);
    }
  }, []);

  const requestMotionPermissionFromUserGesture = useCallback(async () => {
    if (typeof window === "undefined") return;
    const dm = (window as any).DeviceMotionEvent;
    if (dm && typeof dm.requestPermission === "function") {
      try {
        const res = await dm.requestPermission();
        if (res === "granted") {
          setIosMotionGranted(true);
          setIosMotionNeedsPermission(false);
        }
      } catch {}
    } else {
      setIosMotionGranted(true);
      setIosMotionNeedsPermission(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const unsubConn = subscribeWatchConnectionStatus((status) => {
      setWatchConnStatus(status);
    });
    const unsubCloud = subscribeCloudWatchPairingStatus((st) => {
      setCloudStatus(st);
      if (st.pairingCode) {
        setPairingCode(st.pairingCode);
      }
    });
    return () => {
      unsubConn();
      unsubCloud();
    };
  }, [isOpen]);

  // Phone mode: load or generate the archer's 6-digit Cloud Pairing Code
  useEffect(() => {
    if (!isOpen || isStandalone) return;
    let cancelled = false;

    const initForUid = async (uid: string) => {
      if (!uid || cancelled) return;
      const code = await getOrCreatePhoneWatchPairingCode(uid);
      if (!cancelled && code) {
        setPairingCode(code);
      }
    };

    if (auth.currentUser?.uid) {
      initForUid(auth.currentUser.uid);
    }
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (u?.uid) {
        initForUid(u.uid);
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, [isOpen, isStandalone]);

  // Standalone /watch mode: restore saved 6-digit code if previously linked
  useEffect(() => {
    if (!isStandalone) return;
    const saved = getActiveWatchClientPairingCode();
    if (saved) {
      setStandaloneCodeInput(saved);
      connectWatchClientToPairingCode(saved).then((res) => {
        if (!res.ok) {
          setShowStandaloneLinkPanel(true);
        }
      });
    } else {
      setShowStandaloneLinkPanel(true);
    }
  }, [isStandalone]);

  // Listen to BroadcastChannel / localStorage / Cloud updates when running standalone on /watch
  useEffect(() => {
    if (liveSnapshot) {
      setInternalSnapshot(liveSnapshot);
      return;
    }
    const stored = readStoredWatchState();
    if (stored) setInternalSnapshot(stored);

    const unsub = subscribeWatchMessages((msg) => {
      if (msg.type === "STATE_UPDATE" && msg.payload) {
        if (msg.payload.sessionActive === false) {
          setInternalSnapshot({
            ...msg.payload,
            arrowsCount: 0,
            totalScore: 0,
            completedEnds: 0,
            currentEndIndex: 0,
            currentEndArrows: [],
            stepsCount: 0,
            gpsDistanceM: 0,
            distanceWalkedM: 0,
            activeKcal: 0
          });
        } else {
          setInternalSnapshot(msg.payload);
        }
      }
    });
    sendWatchCommand({ type: "REQUEST_STATE" });
    return unsub;
  }, [liveSnapshot]);

  const triggerHaptic = useCallback((pattern: number | number[] = 45) => {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {}
  }, []);

  const handleArrowDelta = useCallback(
    (delta: number, source: "watch_manual" | "watch_auto") => {
      triggerHaptic(source === "watch_auto" ? [45, 35, 65] : 35);
      if (source === "watch_auto") {
        setJustDetectedShot(true);
        setTimeout(() => setJustDetectedShot(false), 3200);
      }
      if (onIncrementArrow) {
        onIncrementArrow(delta, source);
      } else {
        if (delta > 0) {
          sendWatchCommand({ type: "INCREMENT_ARROW", delta, source });
        } else {
          sendWatchCommand({ type: "DECREMENT_ARROW", delta, source });
        }
        setInternalSnapshot((prev) => {
          const nextArrows = Math.max(0, prev.arrowsCount + delta);
          const nextWalked = prev.distanceWalkedM || prev.gpsDistanceM || 0;
          const nextKcal = calculateActiveKcal({
            arrowsCount: nextArrows,
            distanceWalkedM: nextWalked,
            bowPoundageLbs: prev.bowPoundageLbs || 38
          });
          return {
            ...prev,
            arrowsCount: nextArrows,
            distanceWalkedM: nextWalked,
            activeKcal: nextKcal,
            lastShotTimestamp: Date.now(),
            updatedAt: Date.now()
          };
        });
      }
    },
    [onIncrementArrow, triggerHaptic]
  );

  const handleScoreKeyPress = useCallback(
    (val: string) => {
      triggerHaptic(40);
      const pts = scorePointsForKey(val);
      const nextTotalScore = Math.max(0, (activeState.totalScore || 0) + pts);

      sendWatchCommand({
        type: "SCORE_INPUT",
        payload: { value: val, totalScore: nextTotalScore },
        value: val,
        totalScore: nextTotalScore
      });

      if (!liveSnapshot) {
        setInternalSnapshot((prev) => {
          const perEnd = Math.max(1, prev.arrowsPerEnd || 6);
          const maxEnds = Math.max(1, prev.endsCount || 12);
          let curArrows = Array.isArray(prev.currentEndArrows) ? [...prev.currentEndArrows] : [];
          let curEndIdx = prev.currentEndIndex || 0;
          if (curArrows.length >= perEnd) {
            curArrows = [];
            if (curEndIdx + 1 < maxEnds) curEndIdx += 1;
          }
          curArrows.push(val);
          const nextArrows = prev.arrowsCount + 1;
          const nextScore = Math.max(0, (prev.totalScore || 0) + pts);
          const nextWalked = prev.distanceWalkedM || prev.gpsDistanceM || 0;
          return {
            ...prev,
            arrowsCount: nextArrows,
            totalScore: nextScore,
            currentEndIndex: curEndIdx,
            currentEndArrows: curArrows,
            activeKcal: calculateActiveKcal({
              arrowsCount: nextArrows,
              distanceWalkedM: nextWalked,
              bowPoundageLbs: prev.bowPoundageLbs || 38
            }),
            updatedAt: Date.now()
          };
        });
      }
    },
    [activeState.totalScore, liveSnapshot, triggerHaptic]
  );

  const handleUndoScore = useCallback(() => {
    triggerHaptic(30);
    const curArrows = activeState.currentEndArrows || [];
    const lastVal = curArrows.length > 0 ? curArrows[curArrows.length - 1] : "";
    const pts = lastVal ? scorePointsForKey(lastVal) : 0;
    const nextTotalScore = Math.max(0, (activeState.totalScore || 0) - pts);

    sendWatchCommand({ type: "UNDO_ARROW", totalScore: nextTotalScore });

    if (!liveSnapshot && curArrows.length > 0) {
      setInternalSnapshot((prev) => {
        const prevList = Array.isArray(prev.currentEndArrows) ? [...prev.currentEndArrows] : [];
        const removed = prevList.pop() || "";
        const removedPts = scorePointsForKey(removed);
        const nextArrows = Math.max(0, prev.arrowsCount - 1);
        return {
          ...prev,
          arrowsCount: nextArrows,
          totalScore: Math.max(0, (prev.totalScore || 0) - removedPts),
          currentEndArrows: prevList,
          updatedAt: Date.now()
        };
      });
    }
  }, [activeState.currentEndArrows, activeState.totalScore, liveSnapshot, triggerHaptic]);

  const handleNextEnd = useCallback(() => {
    triggerHaptic([45, 30, 55]);
    sendWatchCommand({ type: "NEXT_END" });
    if (!liveSnapshot) {
      setInternalSnapshot((prev) => {
        const maxEnds = Math.max(1, prev.endsCount || 12);
        const nextIdx = Math.min(maxEnds - 1, (prev.currentEndIndex || 0) + 1);
        return {
          ...prev,
          currentEndIndex: nextIdx,
          completedEnds: Math.max(prev.completedEnds || 0, nextIdx),
          currentEndArrows: [],
          updatedAt: Date.now()
        };
      });
    }
  }, [liveSnapshot, triggerHaptic]);

  // Honest Watch Connection State: ONLY true when a watch with the companion app is genuinely connected OR Cloud Watch session is linked!
  const hasNativeWatchAppConnected =
    watchConnStatus.bridgeReady &&
    watchConnStatus.connectedNodesCount > 0 &&
    (watchConnStatus.watchAppInstalledCount ?? 0) > 0;
  const hasCloudWatchLinked =
    cloudStatus.watchLinked &&
    cloudStatus.lastWatchSeenAt > 0 &&
    Date.now() - cloudStatus.lastWatchSeenAt <= 10 * 60 * 1000;
  const isWatchConnected = hasNativeWatchAppConnected || hasCloudWatchLinked;

  // Automatic Wrist Release Detector (DeviceMotion)
  const lastShotRef = useRef<number>(0);
  const motionBufRef = useRef<Array<{ t: number; v: number }>>([]);
  const peakTimesRef = useRef<number[]>([]);
  const walkLockUntilRef = useRef<number>(0);
  const prevLinRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    if (!isOpen || !activeState.autoDetectEnabled) return;
    if (!isStandalone && isWatchConnected) return;
    if (!iosMotionGranted) return;
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;

    const cfg = {
      ALTA: { threshold: 15.0, quietMax: 2.6, stillMs: 900, cooldown: 3000 },
      MEDIA: { threshold: 18.0, quietMax: 2.0, stillMs: 1200, cooldown: 3800 },
      BAJA: { threshold: 22.0, quietMax: 1.6, stillMs: 1500, cooldown: 4500 }
    }[sensitivity];

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
      const lin = Math.abs(Math.sqrt(ax * ax + ay * ay + az * az) - 9.81);
      const now = Date.now();

      setWristImpulseLevel(Math.min(100, Math.round((lin / cfg.threshold) * 100)));

      // Walking cadence detection (local peaks above arm-swing level)
      const [p1, p2] = prevLinRef.current;
      const peaks = peakTimesRef.current;
      if (p1 >= 2.5 && p1 > p2 && p1 >= lin && (peaks.length === 0 || now - peaks[peaks.length - 1] >= 280)) {
        peaks.push(now);
        while (peaks.length && now - peaks[0] > 3500) peaks.shift();
        const gaps: number[] = [];
        for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
        const last = gaps.slice(-3);
        if (last.length === 3 && last.every((g) => g >= 280 && g <= 1400)) {
          const avg = (last[0] + last[1] + last[2]) / 3;
          if (last.every((g) => Math.abs(g - avg) <= avg * 0.25)) {
            walkLockUntilRef.current = Math.max(walkLockUntilRef.current, now + 1500);
          }
        }
      }
      prevLinRef.current = [lin, p1];

      // Strict stillness check over [now - stillMs - 90, now - 90]
      const buf = motionBufRef.current;
      const end = now - 90;
      const start = end - cfg.stillMs;
      let n = 0;
      let oldest = Infinity;
      let still = true;
      for (let i = buf.length - 1; i >= 0; i--) {
        const s = buf[i];
        if (s.t < start) break;
        if (s.t > end) continue;
        if (s.v > cfg.quietMax) {
          still = false;
          break;
        }
        n++;
        oldest = s.t;
      }
      still = still && n >= 12 && end - oldest >= cfg.stillMs * 0.85;

      if (
        lin >= cfg.threshold &&
        now >= walkLockUntilRef.current &&
        now - lastShotRef.current > cfg.cooldown &&
        still
      ) {
        lastShotRef.current = now;
        handleArrowDelta(1, "watch_auto");
      }

      buf.push({ t: now, v: lin });
      while (buf.length && now - buf[0].t > 5000) buf.shift();
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [
    isOpen,
    activeState.autoDetectEnabled,
    sensitivity,
    handleArrowDelta,
    isStandalone,
    isWatchConnected,
    iosMotionGranted
  ]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("archery_101010_auto_sensitivity");
      if (saved === "ALTA" || saved === "MEDIA" || saved === "BAJA") setSensitivity(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("archery_101010_auto_sensitivity", sensitivity);
    } catch {}
    const level: 0 | 1 | 2 = sensitivity === "BAJA" ? 0 : sensitivity === "ALTA" ? 2 : 1;
    sendWatchCommand({ type: "SET_SENSITIVITY", sensitivityLevel: level });
  }, [sensitivity]);

  const handleToggleAuto = () => {
    triggerHaptic(30);
    requestMotionPermissionFromUserGesture();
    if (!activeState.autoDetectEnabled) {
      setSensitivity("MEDIA");
      if (onToggleAutoDetect) onToggleAutoDetect(true);
      else {
        sendWatchCommand({ type: "TOGGLE_AUTO_DETECT", enabled: true });
        setInternalSnapshot((prev) => ({ ...prev, autoDetectEnabled: true }));
      }
    } else if (sensitivity === "MEDIA") {
      setSensitivity("BAJA");
    } else if (sensitivity === "BAJA") {
      setSensitivity("ALTA");
    } else {
      if (onToggleAutoDetect) onToggleAutoDetect(false);
      else {
        sendWatchCommand({ type: "TOGGLE_AUTO_DETECT", enabled: false });
        setInternalSnapshot((prev) => ({ ...prev, autoDetectEnabled: false }));
      }
    }
  };

  const handleFinishSession = () => {
    triggerHaptic([60, 40, 80]);
    if (onFinishAndSendToCoach) {
      onFinishAndSendToCoach();
    } else {
      sendWatchCommand({ type: "FINISH_SESSION_FROM_WATCH" });
    }
  };

  const handleStandaloneConnectSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    requestMotionPermissionFromUserGesture();
    const clean = standaloneCodeInput.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setStandaloneLinkError("Ingresa los 6 dígitos");
      return;
    }
    setStandaloneLinking(true);
    setStandaloneLinkError("");
    const res = await connectWatchClientToPairingCode(clean);
    setStandaloneLinking(false);
    if (res.ok) {
      if (res.snapshot) {
        setInternalSnapshot(res.snapshot);
      }
      setShowStandaloneLinkPanel(false);
      triggerHaptic([40, 30, 50]);
    } else {
      setStandaloneLinkError(res.error || "No se pudo vincular");
    }
  };

  const handleCopyPairingCode = async () => {
    if (!pairingCode) return;
    triggerHaptic(25);
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {}
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (screenIdx === 0) {
      if (e.deltaY < -15) handleArrowDelta(1, "watch_manual");
      else if (e.deltaY > 15 && activeState.arrowsCount > 0) handleArrowDelta(-1, "watch_manual");
    }
  };

  if (!isOpen) return null;

  const digits = String(Math.max(0, Math.min(9999, activeState.arrowsCount)))
    .padStart(4, "0")
    .split("");
  const mtsVal = Math.round(Math.max(0, Number(activeState.distanceWalkedM) || 0));
  const ftVal = Math.round(mtsVal * 3.28084);
  const perEndCount = Math.max(1, activeState.arrowsPerEnd || 6);
  const currentTanda =
    typeof activeState.currentEndIndex === "number"
      ? activeState.currentEndIndex + 1
      : Math.floor(activeState.arrowsCount / perEndCount) + 1;
  const totalTandas = Math.max(1, activeState.endsCount || 12);
  const endArrowsList = Array.isArray(activeState.currentEndArrows)
    ? activeState.currentEndArrows
    : [];
  const visibleSlotsCount = Math.min(6, perEndCount);
  const isSquare = watchShape === "SQUARE";

  const WatchBrandHeader = ({
    pillText,
    pillColor = "cyan",
    compact = false,
    onClickPill
  }: {
    pillText: string;
    pillColor?: "cyan" | "yellow" | "red" | "muted";
    compact?: boolean;
    onClickPill?: () => void;
  }) => {
    const borderClass =
      pillColor === "yellow"
        ? "border-[#FFE500]/45 bg-[#101006]"
        : pillColor === "red"
        ? "border-[#FF1E1E]/45 bg-[#160708]"
        : pillColor === "muted"
        ? "border-white/15 bg-[#0A0D13]"
        : "border-[#00A8F3]/40 bg-[#040B12]";
    const dotClass =
      pillColor === "yellow"
        ? "bg-[#FFE500]"
        : pillColor === "red"
        ? "bg-[#FF1E1E]"
        : pillColor === "muted"
        ? "bg-[#6E7785]"
        : "bg-[#00A8F3]";

    return (
      <div className={`flex flex-col items-center ${compact ? "gap-[3px]" : "gap-[5px]"} z-10`}>
        <img
          src="/images/brand_logo_header.png"
          srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
          alt="ARCHERY 101010"
          className={`${
            compact ? "h-[8px]" : isSquare ? "h-[10px]" : "h-[9.2px]"
          } w-auto object-contain select-none pointer-events-none brightness-125 contrast-125 [image-rendering:-webkit-optimize-contrast]`}
          draggable={false}
        />
        <button
          type="button"
          onClick={onClickPill}
          className={`inline-flex items-center justify-center gap-[5px] border ${borderClass} ${
            compact ? "px-[8px] py-[1.5px] text-[7.5px]" : "px-[10px] py-[2.5px] text-[8px]"
          } rounded-full font-extrabold tracking-[0.08em] uppercase text-white whitespace-nowrap transition active:scale-95 cursor-pointer tabular-nums`}
        >
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotClass}`} />
          <span>{pillText}</span>
        </button>
      </div>
    );
  };

  const WatchCounterChassis = ({ highlightGold = false }: { highlightGold?: boolean }) => (
    <div
      className={`${
        isSquare ? "w-[214px]" : "w-[196px]"
      } bg-[#07090E] rounded-[13px] pt-[7px] pb-[9px] px-[9px] border transition-all ${
        highlightGold ? "border-[#FFE500]/65" : "border-white/10"
      }`}
    >
      <div className="text-center text-[7.5px] font-bold tracking-[0.14em] text-[#8E96A4] uppercase mb-[6px] whitespace-nowrap tabular-nums">
        {highlightGold
          ? `FLECHA #${activeState.arrowsCount} REGISTRADA`
          : "VOLUMEN · FLECHAS"}
      </div>

      <div className="grid grid-cols-4 gap-[5px] bg-[#030407] p-[5px] rounded-[9px] border border-white/[0.06]">
        {digits.map((digitStr, i) => {
          const isUnits = i === 3;
          return (
            <div
              key={i}
              onClick={() => handleArrowDelta(1, "watch_manual")}
              className={`h-[44px] rounded-[6px] bg-[#0B0E15] flex items-center justify-center relative overflow-hidden cursor-pointer select-none border ${
                isUnits ? "border-[#FFE500] bg-[#101008]" : "border-white/[0.11]"
              }`}
            >
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={`${i}-${digitStr}`}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 450, damping: 28 }}
                  className={`font-sans text-[25px] font-extrabold leading-none tabular-nums ${
                    isUnits ? "text-[#FFE500]" : "text-white"
                  }`}
                >
                  {digitStr}
                </motion.span>
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );

  const WatchFaceContent = () => (
    <div
      onWheel={handleWheel}
      className={`relative w-[284px] h-[284px] bg-[#020305] border border-white/10 flex flex-col items-center justify-center px-[16px] overflow-hidden select-none transition-all ${
        isSquare ? "rounded-[48px]" : "rounded-full"
      }`}
    >
      {/* Subtle 1px inner safe ring */}
      <div
        className={`absolute inset-[4px] border border-white/[0.04] pointer-events-none ${
          isSquare ? "rounded-[44px]" : "rounded-full"
        }`}
      />

      <div
        className={`w-full flex flex-col items-center justify-center ${
          screenIdx === 1 ? "gap-[6px] mb-[6px]" : "gap-[10px] mb-[6px]"
        } z-10`}
      >
        {/* SCREEN 00: CONTADOR + AUTO-TIRO */}
        {screenIdx === 0 && (
          <>
            <WatchBrandHeader
              pillText={
                justDetectedShot
                  ? "SUELTA DETECTADA · +1"
                  : activeState.autoDetectEnabled
                  ? `AUTO · ${sensitivity}`
                  : "MODO MANUAL"
              }
              pillColor={justDetectedShot ? "yellow" : "cyan"}
              onClickPill={handleToggleAuto}
            />

            <WatchCounterChassis highlightGold={justDetectedShot} />

            <div
              className={`flex items-center justify-between ${
                isSquare ? "w-[202px]" : "w-[184px]"
              } gap-2`}
            >
              <button
                type="button"
                onClick={() => activeState.arrowsCount > 0 && handleArrowDelta(-1, "watch_manual")}
                className="w-[34px] h-[26px] rounded-full bg-[#180709] border border-[#FF1E1E]/65 text-white text-[11px] font-extrabold flex items-center justify-center active:scale-90 transition cursor-pointer tabular-nums"
              >
                −1
              </button>

              <div
                onClick={() => setScreenIdx(2)}
                className="flex flex-col items-center cursor-pointer text-center"
              >
                <div className="text-[10.5px] font-extrabold text-white tracking-[0.01em] whitespace-nowrap tabular-nums">
                  {mtsVal} mts · {activeState.activeKcal} kcal
                </div>
                <span className="text-[8px] font-bold text-[#8E96A4] tracking-[0.09em] uppercase whitespace-nowrap tabular-nums mt-[1.5px]">
                  TANDA {currentTanda} · {activeState.distanceM} M
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleArrowDelta(1, "watch_manual")}
                className="w-[34px] h-[26px] rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[11px] font-extrabold flex items-center justify-center active:scale-90 transition cursor-pointer tabular-nums"
              >
                +1
              </button>
            </div>
          </>
        )}

        {/* SCREEN 01: TECLADO COMPLETO DE PUNTUACIÓN (X, 10..1, M) */}
        {screenIdx === 1 && (
          <>
            <WatchBrandHeader
              compact={true}
              pillText={`T${currentTanda}/${totalTandas} · ${activeState.totalScore || 0} PTS`}
              pillColor="cyan"
            />

            {/* End Arrow Slots */}
            <div className="flex items-center justify-center gap-[4px] max-w-[162px]">
              {Array.from({ length: visibleSlotsCount }).map((_, idx) => {
                const val = endArrowsList[idx] || "";
                const isGold = val === "X" || val === "10" || val === "9";
                const isRed = val === "8" || val === "7";
                const isBlue = val === "6" || val === "5";
                return (
                  <div
                    key={idx}
                    className={`w-[22px] h-[16px] rounded-[4px] flex items-center justify-center text-[8.5px] font-extrabold tabular-nums border ${
                      !val
                        ? "bg-[#07090E] border-white/10 text-[#6E7785]"
                        : isGold
                        ? "bg-[#121107] border-[#FFE500]/65 text-[#FFE500]"
                        : isRed
                        ? "bg-[#160708] border-[#FF1E1E]/65 text-white"
                        : isBlue
                        ? "bg-[#061320] border-[#00A8F3]/65 text-white"
                        : "bg-[#0B0E15] border-white/25 text-white"
                    }`}
                  >
                    {val || "·"}
                  </div>
                );
              })}
            </div>

            {/* 4x3 Complete Score Grid (X, 10..1, M) — mathematically contained inside round bezel */}
            <div
              className={`${
                isSquare ? "w-[202px]" : "w-[182px]"
              } grid grid-cols-4 gap-[3.5px]`}
            >
              {SCORE_KEYS.map((key) => {
                const isGold = key === "X" || key === "10" || key === "9";
                const isRed = key === "8" || key === "7";
                const isBlue = key === "6" || key === "5";
                const isBlackRing = key === "4" || key === "3";
                const isWhiteRing = key === "2" || key === "1";

                const keyStyle = isGold
                  ? "bg-[#121107] border-[#FFE500]/65 text-[#FFE500]"
                  : isRed
                  ? "bg-[#160708] border-[#FF1E1E]/65 text-white"
                  : isBlue
                  ? "bg-[#061320] border-[#00A8F3]/65 text-white"
                  : isBlackRing
                  ? "bg-[#0B0E15] border-white/25 text-white"
                  : isWhiteRing
                  ? "bg-[#131722] border-white/40 text-white"
                  : "bg-[#090B10] border-white/15 text-[#8E96A4]";

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleScoreKeyPress(key)}
                    className={`h-[23px] rounded-[6px] border font-sans text-[10.5px] font-extrabold tabular-nums flex items-center justify-center active:scale-95 transition cursor-pointer ${keyStyle}`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            {/* Bottom Actions: BORRAR | SIG. TANDA */}
            <div
              className={`${
                isSquare ? "w-[184px]" : "w-[162px]"
              } grid grid-cols-2 gap-[5px]`}
            >
              <button
                type="button"
                onClick={handleUndoScore}
                className="h-[20px] rounded-full bg-[#0B0E15] border border-white/15 text-[#CBD5E1] text-[7.5px] font-extrabold tracking-[0.06em] uppercase active:scale-95 transition cursor-pointer"
              >
                BORRAR
              </button>
              <button
                type="button"
                onClick={handleNextEnd}
                className="h-[20px] rounded-full bg-[#061523] border border-[#00A8F3]/75 text-white text-[7.5px] font-extrabold tracking-[0.06em] uppercase active:scale-95 transition cursor-pointer"
              >
                SIG. TANDA →
              </button>
            </div>
          </>
        )}

        {/* SCREEN 02: MÉTRICAS (MTS/FT + KCAL) */}
        {screenIdx === 2 && (
          <>
            <WatchBrandHeader
              pillText="PODÓMETRO · PASOS"
              pillColor="yellow"
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[196px]"} flex flex-col gap-1.5`}>
              <div className="bg-[#07090E] border border-[#00A8F3]/45 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[7.5px] font-bold tracking-[0.12em] text-[#8E96A4] uppercase whitespace-nowrap">
                    DISTANCIA RECORRIDA
                  </div>
                  <div className="text-[14.5px] font-extrabold text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                    {mtsVal} <span className="text-[9.5px] font-bold text-[#8E96A4]">mts</span>
                    {" · "}
                    {ftVal} <span className="text-[9.5px] font-bold text-[#8E96A4]">ft</span>
                  </div>
                </div>
                <span className="text-[7px] font-extrabold text-white border border-[#00A8F3]/50 bg-[#04101C] px-1.5 py-0.5 rounded uppercase shrink-0">
                  PASOS
                </span>
              </div>

              <div className="bg-[#07090E] border border-[#FF1E1E]/45 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[7.5px] font-bold tracking-[0.12em] text-[#8E96A4] uppercase whitespace-nowrap">
                    GASTO ENERGÉTICO
                  </div>
                  <div className="text-[15.5px] font-extrabold text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                    {activeState.activeKcal}{" "}
                    <span className="text-[9.5px] font-bold text-[#8E96A4]">kcal</span>
                  </div>
                </div>
                <span className="text-[7px] font-extrabold text-[#FFE500] border border-[#FFE500]/50 bg-[#101008] px-1.5 py-0.5 rounded uppercase shrink-0">
                  ACTIVA
                </span>
              </div>
            </div>

            <div className="text-[8px] font-bold text-[#8E96A4] tracking-[0.09em] uppercase whitespace-nowrap tabular-nums">
              {activeState.arrowsCount} FLECHAS · {activeState.bowPoundageLbs} LBS
            </div>
          </>
        )}

        {/* SCREEN 03: AUTO-TIRO & SENSIBILIDAD */}
        {screenIdx === 3 && (
          <>
            <WatchBrandHeader
              pillText={
                activeState.autoDetectEnabled ? "SUELTA AUTOMÁTICA · +1" : "DETECTOR EN PAUSA"
              }
              pillColor="yellow"
              onClickPill={handleToggleAuto}
            />

            <WatchCounterChassis highlightGold={true} />

            {iosMotionNeedsPermission && !iosMotionGranted ? (
              <button
                type="button"
                onClick={requestMotionPermissionFromUserGesture}
                className={`${
                  isSquare ? "w-[214px]" : "w-[196px]"
                } py-1.5 rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[8px] font-extrabold tracking-[0.08em] uppercase active:scale-95 transition cursor-pointer whitespace-nowrap`}
              >
                ACTIVAR SENSOR DE MUÑECA
              </button>
            ) : (
              <div
                className={`${
                  isSquare ? "w-[214px]" : "w-[196px]"
                } flex items-center justify-between bg-[#07090E] border border-white/10 rounded-xl px-2.5 py-1.5`}
              >
                <button
                  type="button"
                  onClick={() => {
                    requestMotionPermissionFromUserGesture();
                    setSensitivity((s) => (s === "ALTA" ? "MEDIA" : s === "MEDIA" ? "BAJA" : "ALTA"));
                  }}
                  className="text-left cursor-pointer"
                >
                  <div className="text-[7px] font-bold text-[#8E96A4] tracking-[0.1em] uppercase whitespace-nowrap">
                    SENSIBILIDAD · {sensitivity}
                  </div>
                  <div className="text-[9px] font-extrabold text-white uppercase whitespace-nowrap">
                    COMPUESTO / RECURVO
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => activeState.arrowsCount > 0 && handleArrowDelta(-1, "watch_manual")}
                  className="bg-[#180709] border border-[#FF1E1E]/60 px-2 py-1 rounded-md text-[7.5px] font-extrabold text-white uppercase active:scale-95 transition cursor-pointer shrink-0 tabular-nums"
                >
                  −1
                </button>
              </div>
            )}
          </>
        )}

        {/* SCREEN 04: RESUMEN Y ENVÍO A COACH */}
        {screenIdx === 4 && (
          <>
            <WatchBrandHeader
              pillText={isWatchConnected ? "RELOJ CONECTADO" : "RESUMEN DE SESIÓN"}
              pillColor={isWatchConnected ? "cyan" : "muted"}
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[196px]"} grid grid-cols-2 gap-1.5`}>
              <div className="bg-[#07090E] border border-[#00A8F3]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  FLECHAS
                </div>
                <div className="text-[14.5px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {activeState.arrowsCount} <span className="text-[9px] text-[#8E96A4]">FL</span>
                </div>
              </div>

              <div className="bg-[#07090E] border border-[#FF1E1E]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  PUNTOS / KCAL
                </div>
                <div className="text-[13.5px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {activeState.totalScore || 0}
                  <span className="text-[8.5px] text-[#8E96A4]"> pts · </span>
                  {activeState.activeKcal}
                </div>
              </div>

              <div className="col-span-2 bg-[#07090E] border border-[#FFE500]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  DISTANCIA TOTAL
                </div>
                <div className="text-[13px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {formatKmAndMiles(activeState.distanceWalkedM, true)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFinishSession}
              className={`${
                isSquare ? "w-[198px]" : "w-[184px]"
              } py-1.5 rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[8px] font-extrabold tracking-[0.08em] uppercase active:scale-95 transition cursor-pointer whitespace-nowrap`}
            >
              ENVIAR SESIÓN A COACH
            </button>
          </>
        )}
      </div>

      {/* Bottom Pinned Pager Dots */}
      <div className="absolute bottom-[12px] left-0 right-0 flex items-center justify-center gap-[5px] z-10">
        {[0, 1, 2, 3, 4].map((idx) => {
          const isCurrent = screenIdx === idx;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setScreenIdx(idx);
              }}
              className={`h-[4px] rounded-full transition-all cursor-pointer ${
                isCurrent ? "w-[13px] bg-[#00A8F3]" : "w-[4px] bg-white/20"
              }`}
              aria-label={`Pantalla ${idx + 1}`}
            />
          );
        })}
      </div>
    </div>
  );

  // If opened directly on a Smartwatch / Secondary Device browser (/watch)
  if (isStandalone) {
    const linkedCode = cloudStatus.watchLinked ? cloudStatus.pairingCode : "";
    return (
      <div className="min-h-screen w-full bg-[#020305] flex flex-col items-center justify-center p-2.5 gap-2.5 select-none">
        {/* Top Cloud Pairing Status / Toggle Pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStandaloneLinkPanel((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-extrabold tracking-[0.08em] uppercase tabular-nums cursor-pointer transition ${
              linkedCode
                ? "bg-[#04101C] border-[#00A8F3]/50 text-white"
                : "bg-[#0A0D13] border-white/15 text-[#8E96A4]"
            }`}
          >
            <span
              className={`w-[5px] h-[5px] rounded-full ${
                linkedCode ? "bg-[#00A8F3]" : "bg-[#6E7785]"
              }`}
            />
            <span>
              {linkedCode ? `CONECTADO · ${linkedCode}` : "VINCULAR CÓDIGO 6 DÍGITOS"}
            </span>
          </button>

          {iosMotionNeedsPermission && !iosMotionGranted && (
            <button
              type="button"
              onClick={requestMotionPermissionFromUserGesture}
              className="px-2.5 py-1 rounded-full bg-[#101006] border border-[#FFE500]/50 text-[#FFE500] text-[8.5px] font-extrabold uppercase tracking-[0.06em] cursor-pointer"
            >
              SENSOR
            </button>
          )}
        </div>

        {/* Clean OLED 6-Digit Cloud Pairing Input Card */}
        {showStandaloneLinkPanel && (
          <form
            onSubmit={handleStandaloneConnectSubmit}
            className="w-full max-w-[284px] bg-[#07090E] border border-white/10 rounded-[18px] p-3 flex flex-col items-center gap-2"
          >
            <div className="text-[8.5px] font-extrabold tracking-[0.12em] text-[#8E96A4] uppercase text-center">
              CÓDIGO DE RELOJ · 6 DÍGITOS
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={standaloneCodeInput}
              onChange={(e) => {
                setStandaloneLinkError("");
                setStandaloneCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              placeholder="000000"
              className="w-full bg-[#020305] border border-white/15 focus:border-[#00A8F3] rounded-[10px] py-2 px-3 text-center font-sans text-[20px] font-extrabold tracking-[0.28em] text-[#FFE500] placeholder:text-white/15 outline-none tabular-nums"
            />
            {standaloneLinkError && (
              <div className="text-[8.5px] font-bold text-[#FF1E1E] text-center">
                {standaloneLinkError}
              </div>
            )}
            <div className="w-full flex items-center gap-2">
              {linkedCode ? (
                <button
                  type="button"
                  onClick={() => {
                    disconnectWatchClientPairingCode();
                    setStandaloneCodeInput("");
                  }}
                  className="flex-1 py-1.5 rounded-full bg-[#180709] border border-[#FF1E1E]/55 text-white text-[8.5px] font-extrabold uppercase tracking-[0.08em] inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Unlink size={10} />
                  <span>DESVINCULAR</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowStandaloneLinkPanel(false)}
                  className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[#8E96A4] text-[8.5px] font-extrabold uppercase tracking-[0.08em] cursor-pointer"
                >
                  CERRAR
                </button>
              )}
              <button
                type="submit"
                disabled={standaloneLinking}
                className="flex-1 py-1.5 rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[8.5px] font-extrabold uppercase tracking-[0.08em] inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Link2 size={10} />
                <span>{standaloneLinking ? "CONECTANDO..." : "VINCULAR"}</span>
              </button>
            </div>
          </form>
        )}

        <WatchFaceContent />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 4) % 5)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase cursor-pointer"
          >
            ◀ Anterior
          </button>
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 1) % 5)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase cursor-pointer"
          >
            Siguiente ▶
          </button>
        </div>
      </div>
    );
  }

  // Show install CTA on native Android when no paired watch reports the companion app yet
  const showInstallOnWatch =
    watchConnStatus.isNativeAndroid &&
    watchConnStatus.bridgeReady &&
    typeof watchConnStatus.watchAppInstalledCount === "number" &&
    watchConnStatus.watchAppInstalledCount === 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10050] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-3 select-none"
      >
        <div className="w-full max-w-[384px] bg-[#06080C] border border-white/10 rounded-[26px] pt-[14px] pb-[14px] px-[14px] flex flex-col items-center gap-[10px] relative overflow-hidden">
          {/* Top 101010 tricolor line */}
          <div
            className="absolute top-0 left-12 right-12 h-[2px]"
            style={{
              background:
                "linear-gradient(90deg, transparent, #00A8F3 25%, #FF1E1E 50%, #FFE500 75%, transparent)"
            }}
          />

          {/* Compact Single-Line Header: Official Brand Logo + Honest Connection Pill + Sync + Close */}
          <div className="w-full flex items-center justify-between gap-[6px]">
            <div className="flex items-center gap-[8px] min-w-0">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className="h-[11.5px] w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
                draggable={false}
              />
              <div
                className={`inline-flex items-center gap-[4px] rounded-full px-[8px] py-[3px] shrink-0 border ${
                  isWatchConnected
                    ? "bg-[#04101C] border-[#00A8F3]/50"
                    : "bg-[#0A0D13] border-white/12"
                }`}
                title={
                  isWatchConnected
                    ? "Reloj inteligente conectado en tiempo real"
                    : "Esperando conexión con reloj inteligente"
                }
              >
                <span
                  className={`w-[5px] h-[5px] rounded-full ${
                    isWatchConnected ? "bg-[#00A8F3]" : "bg-[#6E7785]"
                  }`}
                />
                <span
                  className={`text-[8px] font-extrabold tracking-[0.06em] uppercase leading-none ${
                    isWatchConnected ? "text-white" : "text-[#8E96A4]"
                  }`}
                >
                  {isWatchConnected ? "CONECTADO" : "EN ESPERA"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-[6px] shrink-0">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(25);
                  setIsSyncingWatch(true);
                  publishWatchState(activeState);
                  pingNativeWatch();
                  setTimeout(() => setIsSyncingWatch(false), 700);
                }}
                className="bg-[#081320] border border-[#00A8F3]/45 text-white rounded-full px-[10px] py-[5px] text-[8.5px] font-extrabold tracking-[0.06em] uppercase inline-flex items-center gap-[4px] whitespace-nowrap cursor-pointer active:scale-95 transition"
              >
                <RefreshCw size={10} className={isSyncingWatch ? "animate-spin" : ""} />
                <span>SYNC</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-[26px] h-[26px] rounded-full bg-white/[0.04] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0"
                  aria-label="Cerrar"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* 6-Digit Cloud Watch Pairing Bar (links Sports Smartwatch or /watch in 5 seconds) */}
          {pairingCode && (
            <div className="w-full bg-[#07090E] border border-white/10 rounded-[13px] px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[7.5px] font-extrabold tracking-[0.11em] text-[#8E96A4] uppercase whitespace-nowrap">
                  CÓDIGO NUBE · RELOJ DEPORTIVO
                </div>
                <div className="text-[9px] font-bold text-white/80 truncate">
                  {hasCloudWatchLinked
                    ? "● Reloj vinculado en vivo"
                    : "Ingresa este código en tu reloj o /watch"}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyPairingCode}
                className="bg-[#020305] border border-[#FFE500]/45 rounded-[9px] px-2.5 py-1 inline-flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition"
                title="Copiar código de 6 dígitos"
              >
                <span className="font-sans text-[13.5px] font-extrabold tracking-[0.16em] text-[#FFE500] tabular-nums">
                  {pairingCode}
                </span>
                {copiedCode ? (
                  <Check size={11} className="text-[#00A8F3]" />
                ) : (
                  <Copy size={11} className="text-[#8E96A4]" />
                )}
              </button>
            </div>
          )}

          {showInstallOnWatch && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(25);
                installAppOnWatch();
              }}
              className="w-full bg-[#081320] border border-[#00A8F3]/45 text-white rounded-full py-[7px] text-[9px] font-extrabold tracking-[0.08em] uppercase tabular-nums cursor-pointer active:scale-95 transition"
            >
              {watchConnStatus.connectedNodesCount > 0
                ? "● Instalar en mi reloj"
                : "● Reloj no detectado · Abrir tienda"}
            </button>
          )}

          {/* Minimal Mode Switch (Redondo / Cuadrado) */}
          <div className="w-full grid grid-cols-2 gap-[4px] bg-[#030407] border border-white/[0.08] rounded-[12px] p-[3px]">
            <button
              type="button"
              onClick={() => setWatchShape("ROUND")}
              className={`text-center py-[5px] rounded-[9px] text-[9px] font-extrabold tracking-[0.08em] uppercase transition cursor-pointer ${
                watchShape === "ROUND"
                  ? "bg-[#0B1420] text-white border border-[#00A8F3]/50"
                  : "text-[#6E7785] border border-transparent hover:text-white/80"
              }`}
            >
              REDONDO
            </button>
            <button
              type="button"
              onClick={() => setWatchShape("SQUARE")}
              className={`text-center py-[5px] rounded-[9px] text-[9px] font-extrabold tracking-[0.08em] uppercase transition cursor-pointer ${
                watchShape === "SQUARE"
                  ? "bg-[#0B1420] text-white border border-[#00A8F3]/50"
                  : "text-[#6E7785] border border-transparent hover:text-white/80"
              }`}
            >
              CUADRADO
            </button>
          </div>

          {/* Matte Titanium Hardware Bezel wrapping the 284x284 centered interactive watch screen */}
          <div
            className={`p-[10px] relative bg-[#12151C] border-[1.5px] border-[#262B36] shadow-[0_14px_34px_rgba(0,0,0,0.85)] transition-all ${
              watchShape === "ROUND" ? "rounded-full" : "rounded-[58px]"
            }`}
          >
            {/* Digital Crown on right side of watch hardware */}
            <button
              type="button"
              onClick={() => handleArrowDelta(1, "watch_manual")}
              title="Corona del reloj (+1 flecha)"
              className="absolute -right-[7px] top-1/2 -translate-y-1/2 w-[6px] h-[38px] rounded-r-[4px] bg-[#1F242E] border border-[#343B48] cursor-pointer active:scale-95"
            />
            <WatchFaceContent />
          </div>

          {/* Clean Bottom Navigation Tabs (5 screens including PUNTOS) */}
          <div className="w-full grid grid-cols-5 gap-[4px]">
            {[
              { idx: 0, label: "CONTADOR" },
              { idx: 1, label: "PUNTOS" },
              { idx: 2, label: "MÉTRICAS" },
              { idx: 3, label: "AUTO" },
              { idx: 4, label: "RESUMEN" }
            ].map((tab) => (
              <button
                key={tab.idx}
                type="button"
                onClick={() => {
                  if (tab.idx === 3) requestMotionPermissionFromUserGesture();
                  setScreenIdx(tab.idx);
                }}
                className={`py-[7px] px-[2px] rounded-[10px] text-[8px] font-extrabold uppercase tracking-[0.04em] text-center border transition cursor-pointer ${
                  screenIdx === tab.idx
                    ? "bg-[#0B1420] text-white border-[#00A8F3]/50"
                    : "bg-[#04060A] text-[#6E7785] border-white/[0.06] hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
