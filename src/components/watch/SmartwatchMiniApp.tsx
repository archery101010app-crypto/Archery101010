"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Copy, Check, Link2, Unlink } from "lucide-react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatWalkedDistanceRegional } from "@/lib/i18n/regionalUtils";
import {
  BiometricSessionSnapshot,
  WatchConnectionStatus,
  CloudWatchPairingStatus,
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
import BleHeartRateModal from "./BleHeartRateModal";
import {
  BleHeartRateStatus,
  getBleHeartRateStatus,
  subscribeBleHeartRate
} from "@/lib/scoring/bleHeartRateService";

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
  const { language, unitSystem, t, tx } = useLanguage();
  const isSpanish = language === "es";

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
  const [showBleHrModal, setShowBleHrModal] = useState<boolean>(false);
  const [bleHrStatus, setBleHrStatus] = useState<BleHeartRateStatus>(() => getBleHeartRateStatus());

  useEffect(() => {
    return subscribeBleHeartRate((next) => setBleHrStatus(next));
  }, []);

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
        autoDetectEnabled: false,
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

  // Track page visibility so real-time listeners & IMU sensors pause cleanly when hidden
  // and resume immediately when visible, with zero redundant polling intervals.
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const pausedStandaloneCodeRef = useRef<string>("");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
    if (!isOpen || !isPageVisible) return;
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
  }, [isOpen, isPageVisible]);

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

  // Standalone /watch mode: attach real-time Firestore onSnapshot when visible, pause cleanly when hidden
  useEffect(() => {
    if (!isStandalone || !isPageVisible) return;
    let cancelled = false;
    const saved = pausedStandaloneCodeRef.current || getActiveWatchClientPairingCode();
    if (saved) {
      pausedStandaloneCodeRef.current = saved;
      setStandaloneCodeInput((prev) => prev || saved);
      connectWatchClientToPairingCode(saved).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          if (res.snapshot) {
            setInternalSnapshot(res.snapshot);
          }
        } else {
          pausedStandaloneCodeRef.current = "";
          setShowStandaloneLinkPanel(true);
        }
      });
    } else {
      setShowStandaloneLinkPanel(true);
    }

    return () => {
      cancelled = true;
      const activeCode = getActiveWatchClientPairingCode() || pausedStandaloneCodeRef.current;
      if (activeCode) {
        pausedStandaloneCodeRef.current = activeCode;
        disconnectWatchClientPairingCode();
        try {
          localStorage.setItem("archery_watch_client_pairing_code", activeCode);
        } catch {}
      }
    };
  }, [isStandalone, isPageVisible]);

  // Listen to BroadcastChannel / localStorage / Cloud updates when running standalone on /watch
  useEffect(() => {
    if (liveSnapshot) {
      setInternalSnapshot(liveSnapshot);
      return;
    }
    if (!isOpen || !isPageVisible) return;
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
  }, [liveSnapshot, isOpen, isPageVisible]);

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

  // Dual-Key Biomechanical + High-Frequency Acoustic String-Snap Detector (Standalone /watch only)
  const lastShotRef = useRef<number>(0);
  const lastAcousticSnapRef = useRef<number>(0);
  const micActiveRef = useRef<boolean>(false);
  const [micDeniedNotice, setMicDeniedNotice] = useState(false);
  const motionBufRef = useRef<
    Array<{ t: number; ax: number; ay: number; az: number; mag: number; lin: number; gyro: number }>
  >([]);
  const peakTimesRef = useRef<number[]>([]);
  const walkLockUntilRef = useRef<number>(0);
  const prevDynRef = useRef<[number, number]>([0, 0]);
  const smoothedMagRef = useRef<number>(9.81);
  const pendingShotRef = useRef<{
    active: boolean;
    startMs: number;
    followN: number;
    sumLin: number;
    sumAx: number;
    sumGyro: number;
    gyroN: number;
  }>({ active: false, startMs: 0, followN: 0, sumLin: 0, sumAx: 0, sumGyro: 0, gyroN: 0 });

  // Real-time Web Audio High-Pass (>1.8 kHz) Bowstring Snap Analyzer (100% volatile on-device, never recorded)
  useEffect(() => {
    if (!isOpen || !isPageVisible || !isStandalone || !activeState.autoDetectEnabled) {
      micActiveRef.current = false;
      lastAcousticSnapRef.current = 0;
      return;
    }
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      micActiveRef.current = false;
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let rafTimer: number | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const highpass = audioCtx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 1800;
        highpass.Q.value = 0.707;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(highpass);
        highpass.connect(analyser);

        const samples = new Float32Array(analyser.fftSize);
        let noiseFloor = 0.0035;
        let warmup = 0;
        let inCandidate = false;
        let candidateStart = 0;
        let candidatePeak = 0;
        let sustainedFrames = 0;
        let waitQuiet = false;

        micActiveRef.current = true;
        setMicDeniedNotice(false);

        const snrMult = sensitivity === "BAJA" ? 4.6 : sensitivity === "ALTA" ? 2.8 : 3.6;
        const minRms = sensitivity === "BAJA" ? 0.0042 : sensitivity === "ALTA" ? 0.0019 : 0.0028;
        const crestMin = sensitivity === "BAJA" ? 2.2 : sensitivity === "ALTA" ? 1.82 : 2.0;

        rafTimer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sumSq = 0;
          let maxAbs = 0;
          for (let i = 0; i < samples.length; i++) {
            const v = Math.abs(samples[i]);
            if (v > maxAbs) maxAbs = v;
            sumSq += samples[i] * samples[i];
          }
          const hfRms = Math.sqrt(sumSq / samples.length);
          const now = Date.now();

          if (warmup < 8) {
            const clamped = Math.max(0.0008, Math.min(0.08, hfRms));
            noiseFloor = warmup === 0 ? clamped : 0.75 * noiseFloor + 0.25 * clamped;
            warmup++;
            return;
          }

          if (waitQuiet) {
            if (hfRms < Math.max(minRms * 0.85, noiseFloor * 1.75)) {
              waitQuiet = false;
            } else {
              noiseFloor = Math.max(0.0008, Math.min(0.1, 0.985 * noiseFloor + 0.015 * hfRms));
              return;
            }
          }

          if (!inCandidate) {
            if (hfRms >= Math.max(minRms, noiseFloor * snrMult) && maxAbs >= hfRms * crestMin) {
              inCandidate = true;
              candidateStart = now;
              candidatePeak = hfRms;
              sustainedFrames = 1;
            } else if (hfRms < noiseFloor * 2.1) {
              noiseFloor = Math.max(0.0008, Math.min(0.1, 0.965 * noiseFloor + 0.035 * hfRms));
            }
          } else {
            if (hfRms > candidatePeak) candidatePeak = hfRms;
            if (hfRms > candidatePeak * 0.52) {
              sustainedFrames++;
              if (sustainedFrames > 6) {
                inCandidate = false;
                waitQuiet = true;
              }
            } else {
              lastAcousticSnapRef.current = candidateStart;
              inCandidate = false;
            }
          }
        }, 15);
      } catch {
        micActiveRef.current = false;
        setMicDeniedNotice(true);
        if (onToggleAutoDetect) onToggleAutoDetect(false);
        else {
          sendWatchCommand({ type: "TOGGLE_AUTO_DETECT", enabled: false });
          setInternalSnapshot((prev) => ({ ...prev, autoDetectEnabled: false }));
        }
        window.setTimeout(() => setMicDeniedNotice(false), 4500);
      }
    })();

    return () => {
      cancelled = true;
      micActiveRef.current = false;
      if (rafTimer !== null) window.clearInterval(rafTimer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [isOpen, isPageVisible, isStandalone, activeState.autoDetectEnabled, sensitivity, onToggleAutoDetect]);

  useEffect(() => {
    // Only run wrist IMU shot detection when running standalone on a visible watch (/watch), never when hidden or on the phone preview modal
    if (!isOpen || !isPageVisible || !isStandalone || !activeState.autoDetectEnabled) return;
    if (!iosMotionGranted) return;
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;

    const cfg = {
      ALTA: {
        threshold: 15.2,
        minJerk: 9.2,
        quietMean: 0.80,
        quietPeak: 1.55,
        preRampMean: 0.76,
        axisSpan: 2.20,
        gyroMean: 0.40,
        gyroPeak: 0.95,
        stillMs: 1050,
        cooldown: 5000
      },
      MEDIA: {
        threshold: 18.8,
        minJerk: 11.2,
        quietMean: 0.65,
        quietPeak: 1.30,
        preRampMean: 0.62,
        axisSpan: 1.85,
        gyroMean: 0.32,
        gyroPeak: 0.78,
        stillMs: 1300,
        cooldown: 6000
      },
      BAJA: {
        threshold: 23.0,
        minJerk: 13.5,
        quietMean: 0.52,
        quietPeak: 1.10,
        preRampMean: 0.50,
        axisSpan: 1.55,
        gyroMean: 0.25,
        gyroPeak: 0.65,
        stillMs: 1550,
        cooldown: 7000
      }
    }[sensitivity];

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;
      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      const dyn = mag - smoothedMagRef.current;
      smoothedMagRef.current = 0.96 * smoothedMagRef.current + 0.04 * mag;
      const lin = Math.abs(mag - 9.81);
      const now = Date.now();

      let gyroRad = -1;
      if (event.rotationRate) {
        const degToRad = Math.PI / 180;
        const wx = (event.rotationRate.alpha || 0) * degToRad;
        const wy = (event.rotationRate.beta || 0) * degToRad;
        const wz = (event.rotationRate.gamma || 0) * degToRad;
        gyroRad = Math.sqrt(wx * wx + wy * wy + wz * wz);
      }

      setWristImpulseLevel(Math.min(100, Math.round((lin / cfg.threshold) * 100)));

      // Sensitive walking / bow-carry cadence lock (peaks >= 1.08 m/s²)
      const sig = Math.max(lin, Math.abs(dyn));
      const [p1, p2] = prevDynRef.current;
      const peaks = peakTimesRef.current;
      if (p1 >= 1.08 && p1 > p2 && p1 >= sig && (peaks.length === 0 || now - peaks[peaks.length - 1] >= 290)) {
        peaks.push(now);
        while (peaks.length && now - peaks[0] > 4500) peaks.shift();
        const gaps: number[] = [];
        for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
        const last2 = gaps.slice(-2);
        if (last2.length === 2 && last2.every((g) => g >= 290 && g <= 1450)) {
          const avg2 = (last2[0] + last2[1]) / 2;
          if (last2.every((g) => Math.abs(g - avg2) <= avg2 * 0.34)) {
            walkLockUntilRef.current = Math.max(walkLockUntilRef.current, now + 6000);
            pendingShotRef.current.active = false;
          }
        }
        const last3 = gaps.slice(-3);
        if (last3.length === 3 && last3.every((g) => g >= 290 && g <= 1450)) {
          const avg3 = (last3[0] + last3[1] + last3[2]) / 3;
          if (last3.every((g) => Math.abs(g - avg3) <= avg3 * 0.32)) {
            walkLockUntilRef.current = Math.max(walkLockUntilRef.current, now + 8500);
            pendingShotRef.current.active = false;
          }
        }
      }
      prevDynRef.current = [sig, p1];

      const buf = motionBufRef.current;
      const isWalkingBlocked = now < walkLockUntilRef.current;
      const pending = pendingShotRef.current;

      // Gate 7: 220ms post-release follow-through confirmation
      if (pending.active) {
        if (isWalkingBlocked) {
          pending.active = false;
        } else {
          const elapsed = now - pending.startMs;
          if (elapsed >= 95 && elapsed <= 235) {
            pending.followN += 1;
            pending.sumLin += lin;
            pending.sumAx += ax;
            if (gyroRad >= 0) {
              pending.sumGyro += gyroRad;
              pending.gyroN += 1;
            }
          }
          if (elapsed >= 220) {
            pending.active = false;
            let validFollow = pending.followN >= 2;
            if (validFollow) {
              const meanFollowLin = pending.sumLin / pending.followN;
              const meanFollowAx = Math.abs(pending.sumAx / pending.followN);
              const meanFollowGyro = pending.gyroN >= 2 ? pending.sumGyro / pending.gyroN : 0;
              if (meanFollowLin > 7.8 || meanFollowAx > 8.0 || meanFollowGyro > 4.2) {
                validFollow = false;
              }
            }
            const snapDeltaMs = Math.abs(lastAcousticSnapRef.current - pending.startMs);
            const hasAcousticKey =
              micActiveRef.current && lastAcousticSnapRef.current > 0 && snapDeltaMs <= 145;
            if (validFollow && hasAcousticKey && now - lastShotRef.current > cfg.cooldown) {
              lastShotRef.current = now;
              lastAcousticSnapRef.current = 0;
              handleArrowDelta(1, "watch_auto");
            }
          }
        }
      } else if (!isWalkingBlocked && lin >= cfg.threshold && now - lastShotRef.current > cfg.cooldown) {
        // Gate 6: Sharp release jerk check
        let maxJump = 0;
        for (let k = 1; k <= 3 && buf.length - k >= 0; k++) {
          maxJump = Math.max(maxJump, Math.abs(mag - buf[buf.length - k].mag));
        }

        if (maxJump >= cfg.minJerk) {
          // Gates 3-5: 3D Horizontal Aiming Posture + Isometric Stillness + 3D Axis Lock + Gyro Stillness
          const end = now - 45;
          const start = end - cfg.stillMs;
          const recentStart = end - 220;
          let n = 0;
          let recentN = 0;
          let gyroN = 0;
          let oldest = Infinity;
          let sumLin = 0;
          let recentSumLin = 0;
          let sumAx = 0, sumAy = 0, sumAz = 0;
          let minAx = Infinity, maxAx = -Infinity;
          let minAy = Infinity, maxAy = -Infinity;
          let minAz = Infinity, maxAz = -Infinity;
          let sumGyro = 0;
          let still = true;

          for (let i = buf.length - 1; i >= 0; i--) {
            const s = buf[i];
            if (s.t < start) break;
            if (s.t > end) continue;
            if (s.lin > cfg.quietPeak || (s.gyro >= 0 && s.gyro > cfg.gyroPeak)) {
              still = false;
              break;
            }
            sumLin += s.lin;
            if (s.t >= recentStart) {
              recentSumLin += s.lin;
              recentN++;
            }
            sumAx += s.ax;
            sumAy += s.ay;
            sumAz += s.az;
            if (s.ax < minAx) minAx = s.ax;
            if (s.ax > maxAx) maxAx = s.ax;
            if (s.ay < minAy) minAy = s.ay;
            if (s.ay > maxAy) maxAy = s.ay;
            if (s.az < minAz) minAz = s.az;
            if (s.az > maxAz) maxAz = s.az;
            if (s.gyro >= 0) {
              sumGyro += s.gyro;
              gyroN++;
            }
            n++;
            oldest = s.t;
          }

          if (still && n >= 14 && end - oldest >= cfg.stillMs * 0.85) {
            const meanLin = sumLin / n;
            const meanAx = sumAx / n;
            const meanAy = sumAy / n;
            const meanAz = sumAz / n;
            const gNorm = Math.sqrt(meanAx * meanAx + meanAy * meanAy + meanAz * meanAz);
            const forearmVert = gNorm > 0 ? Math.abs(meanAx) / gNorm : 1;
            const perpG = Math.sqrt(meanAy * meanAy + meanAz * meanAz);

            const validAnchor =
              meanLin <= cfg.quietMean &&
              (recentN < 3 || recentSumLin / recentN <= cfg.preRampMean) &&
              gNorm >= 8.2 &&
              gNorm <= 11.4 &&
              forearmVert <= 0.68 &&
              perpG >= 6.8 &&
              maxAx - minAx <= cfg.axisSpan &&
              maxAy - minAy <= cfg.axisSpan &&
              maxAz - minAz <= cfg.axisSpan &&
              (gyroN < 6 || sumGyro / gyroN <= cfg.gyroMean);

            if (validAnchor) {
              pendingShotRef.current = {
                active: true,
                startMs: now,
                followN: 0,
                sumLin: 0,
                sumAx: 0,
                sumGyro: 0,
                gyroN: 0
              };
            }
          }
        }
      }

      buf.push({ t: now, ax, ay, az, mag, lin, gyro: gyroRad });
      while (buf.length && now - buf[0].t > 5500) buf.shift();
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [
    isOpen,
    isPageVisible,
    activeState.autoDetectEnabled,
    sensitivity,
    handleArrowDelta,
    isStandalone,
    iosMotionGranted
  ]);

  const sensitivitySyncReadyRef = useRef<boolean>(false);
  const skipNextSensitivityCmdRef = useRef<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("archery_101010_auto_sensitivity");
      if ((saved === "ALTA" || saved === "MEDIA" || saved === "BAJA") && saved !== sensitivity) {
        skipNextSensitivityCmdRef.current = true;
        setSensitivity(saved);
      }
    } catch {}
    sensitivitySyncReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sensitivitySyncReadyRef.current) return;
    if (skipNextSensitivityCmdRef.current) {
      skipNextSensitivityCmdRef.current = false;
      return;
    }
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
      setStandaloneLinkError(tx("Ingresa los 6 dígitos", "Enter all 6 digits"));
      return;
    }
    setStandaloneLinking(true);
    setStandaloneLinkError("");
    const res = await connectWatchClientToPairingCode(clean);
    setStandaloneLinking(false);
    if (res.ok) {
      pausedStandaloneCodeRef.current = clean;
      if (res.snapshot) {
        setInternalSnapshot(res.snapshot);
      }
      setShowStandaloneLinkPanel(false);
      triggerHaptic([40, 30, 50]);
    } else {
      setStandaloneLinkError(res.error || tx("No se pudo vincular", "Could not link code"));
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
  const walkedPrimaryStr = formatWalkedDistanceRegional(activeState.distanceWalkedM, unitSystem);
  const walkedMetricStr = formatWalkedDistanceRegional(activeState.distanceWalkedM, "metric");
  const walkedImperialStr = formatWalkedDistanceRegional(activeState.distanceWalkedM, "imperial");
  const walkedDualStr =
    unitSystem === "imperial"
      ? `${walkedImperialStr} · ${walkedMetricStr}`
      : `${walkedMetricStr} · ${walkedImperialStr}`;
  const sensitivityDisplay =
    sensitivity === "BAJA"
      ? tx("BAJA", "LOW")
      : sensitivity === "ALTA"
      ? tx("ALTA", "HIGH")
      : tx("MEDIA", "MED");
  const perEndCount = Math.max(1, activeState.arrowsPerEnd || 6);
  const currentTanda =
    typeof activeState.currentEndIndex === "number"
      ? activeState.currentEndIndex + 1
      : Math.floor(activeState.arrowsCount / perEndCount) + 1;
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
          } w-auto object-contain select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]`}
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
          ? tx(
              `FLECHA #${activeState.arrowsCount} REGISTRADA`,
              `ARROW #${activeState.arrowsCount} LOGGED`
            )
          : tx("VOLUMEN · FLECHAS", "VOLUME · ARROWS")}
      </div>

      <div className="grid grid-cols-4 gap-[5px] bg-[#030407] p-[5px] rounded-[9px] border border-white/[0.06]">
        {digits.map((digitStr, i) => {
          const isUnits = i === 3;
          return (
            <div
              key={i}
              className={`h-[44px] rounded-[6px] bg-[#0B0E15] flex items-center justify-center relative overflow-hidden select-none border ${
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
      dir="ltr"
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
          screenIdx === 1 ? "gap-[4.5px] mb-[11px]" : "gap-[10px] mb-[6px]"
        } z-10`}
      >
        {/* SCREEN 00: CONTADOR + AUTO-TIRO / COUNTER + AUTO SHOT */}
        {screenIdx === 0 && (
          <>
            <WatchBrandHeader
              pillText={
                micDeniedNotice
                  ? tx("PERMITE MICRÓFONO", "ALLOW MICROPHONE")
                  : justDetectedShot
                  ? tx("SUELTA DETECTADA · +1", "SHOT DETECTED · +1")
                  : activeState.autoDetectEnabled
                  ? `AUTO 2K · ${sensitivityDisplay}`
                  : tx("MODO MANUAL", "MANUAL MODE")
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
                aria-label={tx("−1 flecha", "−1 arrow")}
                className="w-[34px] h-[26px] rounded-full bg-[#180709] border border-[#FF1E1E]/65 text-white text-[11px] font-extrabold flex items-center justify-center active:scale-90 transition cursor-pointer tabular-nums"
              >
                −1
              </button>

              <div
                onClick={() => setScreenIdx(2)}
                className="flex flex-col items-center cursor-pointer text-center"
              >
                <div className="text-[10.5px] font-extrabold text-white tracking-[0.01em] whitespace-nowrap tabular-nums">
                  {walkedPrimaryStr} · {activeState.activeKcal} kcal
                </div>
                <span className="text-[8px] font-bold text-[#8E96A4] tracking-[0.09em] uppercase whitespace-nowrap tabular-nums mt-[1.5px]">
                  {tx("TANDA", "END")} {currentTanda} · {activeState.distanceM} M
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleArrowDelta(1, "watch_manual")}
                aria-label={tx("+1 flecha", "+1 arrow")}
                className="w-[34px] h-[26px] rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[11px] font-extrabold flex items-center justify-center active:scale-90 transition cursor-pointer tabular-nums"
              >
                +1
              </button>
            </div>
          </>
        )}

        {/* SCREEN 01: TECLADO XL DE PUNTUACIÓN (OPCIÓN A — 12 TECLAS XL 2x ÁREA TÁCTIL) */}
        {screenIdx === 1 && (
          <>
            <img
              src="/images/brand_logo_header.png"
              srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
              alt="ARCHERY 101010"
              className={`${
                isSquare ? "h-[10px]" : "h-[9px]"
              } w-auto object-contain select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]`}
              draggable={false}
            />

            {/* Unified Compact Telemetry + End Arrow Slots Row */}
            <div
              className={`flex items-center justify-between gap-[4px] ${
                isSquare ? "w-[218px]" : "w-[172px]"
              }`}
            >
              <div className="h-[18px] px-[7px] rounded-full bg-[#050D17] border border-[#00A8F3] text-white text-[9px] font-extrabold tracking-[0.03em] tabular-nums flex items-center justify-center whitespace-nowrap shrink-0">
                {tx("T", "E")}
                {currentTanda}·{activeState.totalScore || 0}P
              </div>

              <div className="flex items-center justify-end gap-[2.5px] flex-1 min-w-0">
                {Array.from({ length: visibleSlotsCount }).map((_, idx) => {
                  const val = endArrowsList[idx] || "";
                  const isGold = val === "X" || val === "10" || val === "9";
                  const isRed = val === "8" || val === "7";
                  const isBlue = val === "6" || val === "5";
                  return (
                    <div
                      key={idx}
                      className={`flex-1 max-w-[22px] h-[17px] rounded-[4px] flex items-center justify-center text-[8.5px] font-extrabold tabular-nums border ${
                        !val
                          ? "bg-[#07090E] border-[#334155] text-[#64748B]"
                          : isGold
                          ? "bg-[#121107] border-[#FFE500] text-[#FFE500]"
                          : isRed
                          ? "bg-[#160708] border-[#FF1E1E] text-white"
                          : isBlue
                          ? "bg-[#061320] border-[#00A8F3] text-white"
                          : "bg-[#0B0E15] border-[#64748B] text-white"
                      }`}
                    >
                      {val || "-"}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4x3 XL Score Grid (X, 10..1, M) — ~2x Tactile Area mathematically contained inside round & square bezels */}
            <div
              className={`${
                isSquare ? "w-[236px]" : "w-[216px]"
              } grid grid-cols-4 gap-[4px]`}
            >
              {SCORE_KEYS.map((key) => {
                const isGold = key === "X" || key === "10" || key === "9";
                const isRed = key === "8" || key === "7";
                const isBlue = key === "6" || key === "5";
                const isMiss = key === "M";

                const keyStyle = isGold
                  ? "bg-[#121107] border-[#FFE500] text-[#FFE500]"
                  : isRed
                  ? "bg-[#160708] border-[#FF1E1E] text-white"
                  : isBlue
                  ? "bg-[#061320] border-[#00A8F3] text-white"
                  : isMiss
                  ? "bg-[#0B0E15] border-[#475569] text-[#CBD5E1]"
                  : "bg-[#0B0E15] border-[#475569] text-white";

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleScoreKeyPress(key)}
                    className={`${
                      isSquare ? "h-[41px] text-[18.5px]" : "h-[39px] text-[17.5px]"
                    } rounded-[8px] border-[1.5px] font-sans font-extrabold tabular-nums flex items-center justify-center active:scale-95 transition cursor-pointer ${keyStyle}`}
                  >
                    {key}
                  </button>
                );
              })}
            </div>

            {/* Bottom Actions: BORRAR / DEL | SIG. TANDA / NEXT END */}
            <div
              className={`${
                isSquare ? "w-[212px]" : "w-[172px]"
              } grid grid-cols-2 gap-[6px]`}
            >
              <button
                type="button"
                onClick={handleUndoScore}
                className="h-[27px] rounded-full bg-[#0B0E15] border-[1.5px] border-[#475569] text-white text-[9.5px] font-extrabold tracking-[0.04em] uppercase active:scale-95 transition cursor-pointer"
              >
                {tx("BORRAR", "DEL")}
              </button>
              <button
                type="button"
                onClick={handleNextEnd}
                className="h-[27px] rounded-full bg-[#061523] border-[1.5px] border-[#00A8F3] text-white text-[9.5px] font-extrabold tracking-[0.04em] uppercase active:scale-95 transition cursor-pointer"
              >
                {tx("SIG. TANDA", "NEXT END")}
              </button>
            </div>
          </>
        )}

        {/* SCREEN 02: BIOMETRICS (DISTANCE + STEPS + KCAL) */}
        {screenIdx === 2 && (
          <>
            <WatchBrandHeader
              pillText={tx("BIOMETRÍA · PASOS", "BIOMETRICS · STEPS")}
              pillColor="yellow"
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[196px]"} flex flex-col gap-1.5`}>
              <div className="bg-[#07090E] border border-[#00A8F3]/45 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[7.5px] font-bold tracking-[0.12em] text-[#8E96A4] uppercase whitespace-nowrap">
                    {tx("DISTANCIA RECORRIDA", "WALKED DISTANCE")}
                  </div>
                  <div className="text-[13.5px] font-extrabold text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                    {walkedDualStr}
                  </div>
                </div>
                <span className="text-[7px] font-extrabold text-white border border-[#00A8F3]/50 bg-[#04101C] px-1.5 py-0.5 rounded uppercase shrink-0 tabular-nums">
                  {activeState.stepsCount ? `${activeState.stepsCount} ` : ""}
                  {tx("PASOS", "STEPS")}
                </span>
              </div>

              <div className="bg-[#07090E] border border-[#FF1E1E]/45 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[7.5px] font-bold tracking-[0.12em] text-[#8E96A4] uppercase whitespace-nowrap">
                    {tx("GASTO ENERGÉTICO", "ACTIVE ENERGY")}
                  </div>
                  <div className="text-[15.5px] font-extrabold text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                    {activeState.activeKcal}{" "}
                    <span className="text-[9.5px] font-bold text-[#8E96A4]">kcal</span>
                  </div>
                </div>
                <span className="text-[7px] font-extrabold text-[#FFE500] border border-[#FFE500]/50 bg-[#101008] px-1.5 py-0.5 rounded uppercase shrink-0 tabular-nums">
                  {bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
                    ? `${bleHrStatus.currentBpm} BPM`
                    : activeState.heartRateBpm && activeState.heartRateBpm >= 30
                    ? `${activeState.heartRateBpm} BPM`
                    : tx("ACTIVA", "ACTIVE")}
                </span>
              </div>
            </div>

            <div className="text-[8px] font-bold text-[#8E96A4] tracking-[0.09em] uppercase whitespace-nowrap tabular-nums">
              {activeState.arrowsCount} {tx("FLECHAS", "ARROWS")} · {activeState.bowPoundageLbs} LBS
            </div>
          </>
        )}

        {/* SCREEN 03: AUTO-SHOT & SENSITIVITY */}
        {screenIdx === 3 && (
          <>
            <WatchBrandHeader
              pillText={
                activeState.autoDetectEnabled
                  ? tx("AUTO TIRO · +1", "AUTO SHOT · +1")
                  : tx("MODO MANUAL", "MANUAL MODE")
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
                {tx("ACTIVAR SENSOR DE MUÑECA", "ENABLE WRIST SENSOR")}
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
                    {tx("SENSIBILIDAD", "SENSITIVITY")} · {sensitivityDisplay}
                  </div>
                  <div className="text-[9px] font-extrabold text-white uppercase whitespace-nowrap">
                    {tx("COMPUESTO / RECURVO", "COMPOUND / RECURVE")}
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

        {/* SCREEN 04: SUMMARY & SAVE */}
        {screenIdx === 4 && (
          <>
            <WatchBrandHeader
              pillText={
                isWatchConnected
                  ? tx("RELOJ CONECTADO", "WATCH SYNCED")
                  : tx("RESUMEN", "SUMMARY")
              }
              pillColor={isWatchConnected ? "cyan" : "muted"}
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[196px]"} grid grid-cols-2 gap-1.5`}>
              <div className="bg-[#07090E] border border-[#00A8F3]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  {tx("FLECHAS", "ARROWS")}
                </div>
                <div className="text-[14.5px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {activeState.arrowsCount}{" "}
                  <span className="text-[9px] text-[#8E96A4]">{isSpanish ? "FL" : "AR"}</span>
                </div>
              </div>

              <div className="bg-[#07090E] border border-[#FF1E1E]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  {tx("PUNTAJE / KCAL", "SCORE / KCAL")}
                </div>
                <div className="text-[13.5px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {activeState.totalScore || 0}
                  <span className="text-[8.5px] text-[#8E96A4]"> pts · </span>
                  {activeState.activeKcal}
                </div>
              </div>

              <div className="col-span-2 bg-[#07090E] border border-[#FFE500]/45 rounded-xl p-1.5 text-center">
                <div className="text-[7px] font-bold text-[#8E96A4] tracking-wider uppercase">
                  {tx("DISTANCIA TOTAL", "TOTAL DISTANCE")}
                </div>
                <div className="text-[13px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {walkedDualStr}
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
              {tx("GUARDAR SESIÓN", "SAVE")}
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
              aria-label={tx(`Pantalla ${idx + 1}`, `Screen ${idx + 1}`)}
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
      <div
        dir="ltr"
        className="min-h-screen w-full bg-[#020305] flex flex-col items-center justify-center p-2.5 gap-2.5 select-none"
      >
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
              {linkedCode
                ? `${tx("VINCULADO", "SYNCED")} · ${linkedCode}`
                : tx("CÓDIGO NUBE · 6 DÍGITOS", "CLOUD CODE · 6 DIGITS")}
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
              {tx("CÓDIGO NUBE · 6 DÍGITOS", "CLOUD CODE · 6 DIGITS")}
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
                    pausedStandaloneCodeRef.current = "";
                    disconnectWatchClientPairingCode();
                    setStandaloneCodeInput("");
                  }}
                  className="flex-1 py-1.5 rounded-full bg-[#180709] border border-[#FF1E1E]/55 text-white text-[8.5px] font-extrabold uppercase tracking-[0.08em] inline-flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Unlink size={10} aria-hidden="true" />
                  <span>{tx("DESVINCULAR", "UNLINK")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowStandaloneLinkPanel(false)}
                  className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-[#8E96A4] text-[8.5px] font-extrabold uppercase tracking-[0.08em] cursor-pointer"
                >
                  {tx("CERRAR", "CLOSE")}
                </button>
              )}
              <button
                type="submit"
                disabled={standaloneLinking}
                className="flex-1 py-1.5 rounded-full bg-[#061523] border border-[#00A8F3] text-white text-[8.5px] font-extrabold uppercase tracking-[0.08em] inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Link2 size={10} aria-hidden="true" />
                <span>
                  {standaloneLinking
                    ? tx("VINCULANDO...", "LINKING...")
                    : tx("VINCULAR", "LINK")}
                </span>
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
            {tx("◀ Anterior", "◀ Prev")}
          </button>
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 1) % 5)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase cursor-pointer"
          >
            {tx("Siguiente ▶", "Next ▶")}
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
        role="dialog"
        aria-modal="true"
        aria-label={tx(
          "ARCHERY 101010 · Vista de reloj deportivo",
          "ARCHERY 101010 · Sports watch view"
        )}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10050] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-3 select-none overflow-hidden overscroll-contain"
      >
        <div
          dir="ltr"
          className="w-full max-w-[384px] max-h-[95dvh] overflow-y-auto overscroll-contain overflow-x-hidden bg-[#06080C] border border-white/10 rounded-[26px] pt-[14px] pb-[14px] px-[14px] flex flex-col items-center gap-[10px] relative"
        >
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
                    ? tx(
                        "Reloj inteligente conectado en tiempo real",
                        "Smartwatch connected in real time"
                      )
                    : tx(
                        "Esperando conexión con reloj inteligente",
                        "Waiting for smartwatch connection"
                      )
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
                  {isWatchConnected
                    ? tx("CONECTADO", "CONNECTED")
                    : tx("EN ESPERA", "STANDBY")}
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
                aria-label={tx("SYNC · Sincronizar reloj", "SYNC · Sync watch")}
                className="bg-[#081320] border border-[#00A8F3]/45 text-white rounded-full px-[10px] py-[5px] text-[8.5px] font-extrabold tracking-[0.06em] uppercase inline-flex items-center gap-[4px] whitespace-nowrap cursor-pointer active:scale-95 transition"
              >
                <RefreshCw size={10} aria-hidden="true" className={isSyncingWatch ? "animate-spin" : ""} />
                <span>SYNC</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-[36px] h-[36px] rounded-full bg-white/[0.04] border border-white/[0.12] text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0"
                  aria-label={tx("Cerrar vista previa del reloj", "Close watch preview")}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* 6-Digit Cloud Watch Pairing Bar (links Sports Smartwatch or /watch in 5 seconds) */}
          {pairingCode && (
            <div className="w-full bg-[#07090E] border border-white/10 rounded-[13px] px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[7.5px] font-extrabold tracking-[0.11em] text-[#8E96A4] uppercase whitespace-nowrap">
                  {tx("CÓDIGO NUBE · RELOJ DEPORTIVO", "CLOUD CODE · SPORTS WATCH")}
                </div>
                <div className="text-[9px] font-bold text-white/80 truncate">
                  {hasCloudWatchLinked
                    ? tx("● Reloj vinculado en vivo", "● Watch linked live")
                    : tx(
                        "Ingresa este código en tu reloj o /watch",
                        "Enter this code on your watch or /watch"
                      )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyPairingCode}
                className="bg-[#020305] border border-[#FFE500]/45 rounded-[9px] px-2.5 py-1 inline-flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition"
                title={tx("Copiar código de 6 dígitos", "Copy 6-digit code")}
                aria-label={`${tx("Copiar código", "Copy code")} ${pairingCode}`}
              >
                <span className="font-sans text-[13.5px] font-extrabold tracking-[0.16em] text-[#FFE500] tabular-nums">
                  {pairingCode}
                </span>
                {copiedCode ? (
                  <Check size={11} aria-hidden="true" className="text-[#00A8F3]" />
                ) : (
                  <Copy size={11} aria-hidden="true" className="text-[#8E96A4]" />
                )}
              </button>
            </div>
          )}

          {/* Universal Bluetooth Heart Rate Sensor Bar (Bands, Straps & Optical Sensors) */}
          <div className="w-full bg-[#07090E] border border-white/10 rounded-[13px] px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[7.5px] font-extrabold tracking-[0.11em] text-[#8E96A4] uppercase whitespace-nowrap flex items-center gap-1">
                <span
                  className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                    bleHrStatus.state === "connected" ? "bg-[#00C853]" : "bg-[#00BFFF]"
                  }`}
                />
                <span>{t("bleHrTitle")}</span>
              </div>
              <div className="text-[9px] font-bold text-white truncate tabular-nums">
                {bleHrStatus.state === "connected"
                  ? `${
                      bleHrStatus.currentBpm >= 30 ? `${bleHrStatus.currentBpm} BPM · ` : ""
                    }${bleHrStatus.deviceName || tx("Conectado en vivo", "Connected live")}`
                  : t("bleHrSubtitle")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowBleHrModal(true)}
              className={`rounded-[9px] px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.06em] shrink-0 cursor-pointer active:scale-95 transition tabular-nums ${
                bleHrStatus.state === "connected"
                  ? "bg-[#051810] border border-[#00C853]/55 text-white"
                  : "bg-[#061523] border border-[#00A8F3]/60 text-white"
              }`}
            >
              {bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
                ? `${bleHrStatus.currentBpm} BPM`
                : t("bleHrConnect")}
            </button>
          </div>

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
                ? tx("● Instalar en mi reloj", "● Install on my watch")
                : tx(
                    "● Reloj no detectado · Abrir tienda",
                    "● Watch not detected · Open store"
                  )}
            </button>
          )}

          {/* Minimal Mode Switch (Redondo / Cuadrado | Round / Square) */}
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
              {tx("REDONDO", "ROUND")}
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
              {tx("CUADRADO", "SQUARE")}
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
              title={tx("Corona del reloj (+1 flecha)", "Watch crown (+1 arrow)")}
              aria-label={tx("Corona del reloj: sumar 1 flecha", "Watch crown: add 1 arrow")}
              className="absolute -right-[7px] top-1/2 -translate-y-1/2 w-[6px] h-[38px] rounded-r-[4px] bg-[#1F242E] border border-[#343B48] cursor-pointer active:scale-95"
            />
            <WatchFaceContent />
          </div>

          {/* Clean Bottom Navigation Tabs (5 screens) */}
          <div className="w-full grid grid-cols-5 gap-[4px]">
            {[
              { idx: 0, label: tx("FLECHAS", "ARROWS") },
              { idx: 1, label: tx("PUNTOS", "SCORE") },
              { idx: 2, label: tx("PASOS", "STEPS") },
              { idx: 3, label: "AUTO" },
              { idx: 4, label: tx("RESUMEN", "SUMMARY") }
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

        <BleHeartRateModal
          isOpen={showBleHrModal}
          onClose={() => setShowBleHrModal(false)}
        />
      </motion.div>
    </AnimatePresence>
  );
}
