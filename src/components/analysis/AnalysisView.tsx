"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Play, Plus, RotateCcw, Save, Settings, Square } from "lucide-react";
import { UserProfile } from "@/lib/authService";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatRegionalDate } from "@/lib/i18n/regionalUtils";
import {
  addToSyncQueue,
  deleteLocalSession,
  generateResilientId,
  getLocalSessions,
  getLocalSetting,
  sanitizeForFirestore,
  saveLocalSession,
  saveLocalSetting
} from "@/lib/db/indexedDB";
import { runSync } from "@/lib/db/syncManager";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { showOledConfirm } from "@/lib/oledDialog";
import { triggerHaptic } from "@/lib/haptics";
import { useWakeLock } from "@/lib/useWakeLock";
import {
  BiometricSessionSnapshot,
  CloudWatchPairingStatus,
  WatchConnectionStatus,
  getOrCreatePhoneWatchPairingCode,
  parseBowPoundageLbs,
  publishWatchState,
  sendWatchCommand,
  subscribeCloudWatchPairingStatus,
  subscribeWatchConnectionStatus,
  subscribeWatchMessages
} from "@/lib/scoring/biometricsEngine";
import {
  BleHeartRateStatus,
  getBleHeartRateStatus,
  resetBleHeartRateSessionStats,
  subscribeBleHeartRate,
  tryAutoReconnectBleHeartRate
} from "@/lib/scoring/bleHeartRateService";
import {
  AnalysisBowType,
  AnalysisCalibrationProfile,
  AnalysisMarkedImpact,
  AnalysisShotRecord,
  computeAnalysisSessionSummary,
  decodeCompactShotAnalysis,
  extractAnalysisShots,
  isAnalysisSession,
  loadSavedAnalysisCalibration,
  saveAnalysisCalibration
} from "@/lib/scoring/shotAnalysisEngine";
import AnalysisDianaSvg from "./AnalysisDianaSvg";
import AnalysisCalibrationModal from "./AnalysisCalibrationModal";
import SmartwatchMiniApp from "@/components/watch/SmartwatchMiniApp";
import BleHeartRateModal from "@/components/watch/BleHeartRateModal";

interface AnalysisViewProps {
  user: UserProfile;
  onNavigateHistoryAnalysis: () => void;
}

function computeEcgWaveY(phase01: number): number {
  const p = ((phase01 % 1) + 1) % 1;
  if (p > 0.12 && p < 0.19) {
    return 26 - Math.sin(((p - 0.12) / 0.07) * Math.PI) * 5;
  }
  if (p >= 0.25 && p < 0.28) return 30.5;
  if (p >= 0.28 && p < 0.32) return 6.5;
  if (p >= 0.32 && p < 0.36) return 38;
  if (p >= 0.36 && p < 0.40) return 26;
  if (p >= 0.46 && p < 0.59) {
    return 26 - Math.sin(((p - 0.46) / 0.13) * Math.PI) * 6.5;
  }
  return 26;
}

function LiveHeartRateEcgGraph({ bpm }: { bpm: number }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const bpmRef = useRef<number>(bpm);
  bpmRef.current = bpm;
  const isActive = bpm >= 30 && bpm <= 245;

  useEffect(() => {
    const pathEl = pathRef.current;
    const dotEl = dotRef.current;
    if (!pathEl || !dotEl) return;

    if (!isActive) {
      pathEl.setAttribute("d", "M 2 26 L 162 26");
      dotEl.setAttribute("cy", "26");
      return;
    }

    let rafId = 0;
    let lastMs = performance.now();
    let beatCursor = 0;

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      const currentBpm = Math.max(30, Math.min(245, bpmRef.current || 72));
      beatCursor = (beatCursor + dtSec * (currentBpm / 60)) % 1000;

      let d = "";
      let endY = 26;
      for (let x = 2; x <= 162; x += 2) {
        const samplePhase = beatCursor - (162 - x) * 0.0125;
        const y = computeEcgWaveY(samplePhase);
        d += (x === 2 ? "M " : " L ") + x + " " + y.toFixed(1);
        if (x === 162) endY = y;
      }
      pathEl.setAttribute("d", d);
      dotEl.setAttribute("cy", endY.toFixed(1));
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isActive]);

  return (
    <svg width="156" height="44" viewBox="0 0 166 44" aria-hidden="true" className="shrink-0">
      <line x1="0" y1="26" x2="162" y2="26" stroke="rgba(255,59,48,0.18)" strokeWidth="1" />
      <path
        ref={pathRef}
        d="M 2 26 L 162 26"
        fill="none"
        stroke="#FF3B30"
        strokeOpacity={isActive ? 1 : 0.4}
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        ref={dotRef}
        cx="162"
        cy="26"
        r="3.4"
        fill="#FF3B30"
        fillOpacity={isActive ? 1 : 0.45}
      />
    </svg>
  );
}

export default function AnalysisView({
  user,
  onNavigateHistoryAnalysis
}: AnalysisViewProps) {
  const { language, t, tx } = useLanguage();
  const isEs = language === "es";
  useWakeLock(true);

  const defaultBowType: AnalysisBowType =
    user?.bowConfig?.type === "Compound" ||
    user?.bowConfig?.type === "Recurve" ||
    user?.bowConfig?.type === "Barebow"
      ? user.bowConfig.type
      : "Barebow";
  const defaultDistanceM =
    user?.bowConfig?.defaultDistance && user.bowConfig.defaultDistance <= 70
      ? user.bowConfig.defaultDistance
      : 18;
  const defaultWrist = user?.physicalData?.dominantHand === "L" ? "RIGHT" : "LEFT";

  const [calibration, setCalibration] = useState<AnalysisCalibrationProfile>(() => {
    const saved = loadSavedAnalysisCalibration(
      defaultBowType,
      defaultDistanceM,
      user?.physicalData?.dominantHand,
      user?.uid
    );
    if (saved) {
      return {
        ...saved,
        bowType: defaultBowType
      };
    }
    return {
      bowType: defaultBowType,
      bowWrist: defaultWrist,
      distanceM: defaultDistanceM,
      zeroGravityVec: [0, 0, 9.81],
      calibratedAt: 0
    };
  });

  // Always keep the bow type synchronized with the bow configured in the archer's Profile
  useEffect(() => {
    setCalibration((prev) => {
      const nextDist = prev.calibratedAt === 0 ? defaultDistanceM : prev.distanceM;
      const nextWrist = prev.calibratedAt === 0 ? defaultWrist : prev.bowWrist;
      if (
        prev.bowType === defaultBowType &&
        prev.distanceM === nextDist &&
        prev.bowWrist === nextWrist
      ) {
        return prev;
      }
      const next = {
        ...prev,
        bowType: defaultBowType,
        distanceM: nextDist,
        bowWrist: nextWrist
      };
      if (prev.calibratedAt > 0) {
        saveAnalysisCalibration(next, user?.uid);
      }
      return next;
    });
  }, [defaultBowType, defaultDistanceM, defaultWrist, user?.uid]);

  const [captureMode, setCaptureMode] = useState<"AUTO" | "MANUAL">("MANUAL");
  const [shots, setShots] = useState<AnalysisShotRecord[]>([]);
  const shotsRef = useRef<AnalysisShotRecord[]>([]);
  shotsRef.current = shots;

  const [selectedShotIdx, setSelectedShotIdx] = useState<number>(0);
  const [isMarkMode, setIsMarkMode] = useState<boolean>(false);
  const [replayNonce, setReplayNonce] = useState<number>(0);
  const [savedPastSessions, setSavedPastSessions] = useState<any[]>([]);

  const [isCalibrationOpen, setIsCalibrationOpen] = useState<boolean>(false);
  const [isWatchModalOpen, setIsWatchModalOpen] = useState<boolean>(false);
  const [isBleHrModalOpen, setIsBleHrModalOpen] = useState<boolean>(false);
  const [previewLivePanel, setPreviewLivePanel] = useState<boolean>(false);
  const [manualStartAt, setManualStartAt] = useState<number>(0);
  const [manualStopAt, setManualStopAt] = useState<number>(0);
  const [isManualRecording, setIsManualRecording] = useState<boolean>(false);
  const [manualElapsedSec, setManualElapsedSec] = useState<number>(0);
  const [calibrateZeroAt, setCalibrateZeroAt] = useState<number>(0);
  const isFinishingRef = useRef<boolean>(false);
  const [coachTechnicalNotes, setCoachTechnicalNotes] = useState<
    Array<{ id: string; date: number; content: string }>
  >([]);

  const sessionIdRef = useRef<string>(generateResilientId("SES"));
  const sessionStartTsRef = useRef<number>(Date.now());
  const promptedCalibrationOnceRef = useRef<boolean>(false);
  const prevWatchConnectedRef = useRef<boolean>(false);
  const seenShotKeysRef = useRef<Set<string>>(new Set());
  const lastShotRecvTsRef = useRef<{ ts: number; sig: string }>({ ts: 0, sig: "" });

  const [watchConnStatus, setWatchConnStatus] = useState<WatchConnectionStatus>({
    isNativeAndroid: false,
    bridgeReady: false,
    connectedNodesCount: 0,
    connectedNodes: [],
    lastMessageAt: 0,
    lastPongAt: 0,
    hasCachedState: false
  });
  const [cloudStatus, setCloudStatus] = useState<CloudWatchPairingStatus>({
    pairingCode: "",
    cloudConnected: false,
    watchLinked: false,
    watchSource: null,
    lastCloudSyncAt: 0,
    lastWatchSeenAt: 0
  });
  const [bleHrStatus, setBleHrStatus] = useState<BleHeartRateStatus>(() =>
    getBleHeartRateStatus()
  );
  const bleHrRef = useRef<BleHeartRateStatus>(bleHrStatus);
  bleHrRef.current = bleHrStatus;
  const [watchLiveHr, setWatchLiveHr] = useState<{ bpm: number; at: number }>({
    bpm: 0,
    at: 0
  });

  const hasNativeWatchConnected =
    watchConnStatus.bridgeReady &&
    watchConnStatus.connectedNodesCount > 0 &&
    (watchConnStatus.watchAppInstalledCount ?? 0) > 0;
  const hasCloudWatchConnected =
    cloudStatus.watchLinked &&
    cloudStatus.lastWatchSeenAt > 0 &&
    Date.now() - cloudStatus.lastWatchSeenAt <= 3 * 60 * 1000;
  const isWatchConnected = hasNativeWatchConnected || hasCloudWatchConnected;

  // Report whether Análisis is actively capturing/holding shots so idle visits never block OTA updates
  useEffect(() => {
    if (typeof window === "undefined") return;
    const winAny = window as unknown as { __archeryAnalysisActive?: boolean };
    winAny.__archeryAnalysisActive = Boolean(isWatchConnected || shots.length > 0);
    window.dispatchEvent(new CustomEvent("archery-analysis-busy-changed"));
    return () => {
      winAny.__archeryAnalysisActive = false;
      window.dispatchEvent(new CustomEvent("archery-analysis-busy-changed"));
    };
  }, [isWatchConnected, shots.length]);

  // Load saved past Analysis sessions (and resume any active Analysis draft)
  const reloadSavedAnalysisSessions = useCallback(async () => {
    try {
      const all = await getLocalSessions();
      const ownCompleted = all
        .filter(
          (s) =>
            (s.userId === user.uid || s.userUid === user.uid) &&
            s.deletedByArcher !== true &&
            !s.isDraft &&
            isAnalysisSession(s)
        )
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setSavedPastSessions(ownCompleted);

      if (shotsRef.current.length === 0) {
        const draft = all
          .filter(
            (s) =>
              (s.userId === user.uid || s.userUid === user.uid) &&
              s.isDraft === true &&
              isAnalysisSession(s)
          )
          .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0))[0];
        if (draft) {
          const restoredShots = extractAnalysisShots(draft);
          if (restoredShots.length > 0) {
            sessionIdRef.current = draft.id;
            sessionStartTsRef.current = draft.timestamp || Date.now();
            shotsRef.current = restoredShots;
            setShots(restoredShots);
            setSelectedShotIdx(restoredShots.length - 1);
            const sum = computeAnalysisSessionSummary(restoredShots);
            resetBleHeartRateSessionStats(sum.avgHeartRateBpm || 0, sum.maxHeartRateBpm || 0);
            return;
          }
        }
        resetBleHeartRateSessionStats(0, 0);
      }
    } catch {}
  }, [user.uid]);

  useEffect(() => {
    if (isWatchModalOpen) {
      return registerModalDismiss(() => setIsWatchModalOpen(false));
    }
  }, [isWatchModalOpen]);

  // Listen for Coach technical notes addressed to this athlete (offline-first + real-time Firestore)
  useEffect(() => {
    if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") return;
    const localKey = `athlete_received_coach_notes_${user.uid}`;
    const linkedCoachId = user.coachId || "";
    const linkedClubId = user.clubId || "";
    if (!linkedCoachId && !linkedClubId) {
      setCoachTechnicalNotes([]);
      saveLocalSetting(localKey, []).catch(() => {});
      return;
    }
    let cancelled = false;

    getLocalSetting<Array<{ id: string; date: number; content: string }>>(localKey, [])
      .then((cached) => {
        if (!cancelled && Array.isArray(cached) && cached.length > 0) {
          setCoachTechnicalNotes(cached);
        }
      })
      .catch(() => {});

    let unsubFirestore: (() => void) | null = null;
    const attach = (uid: string) => {
      if (cancelled || !uid) return;
      if (unsubFirestore) {
        try {
          unsubFirestore();
        } catch {}
        unsubFirestore = null;
      }
      const q = query(
        collection(db, "coach_records"),
        where("type", "==", "note"),
        where("athleteUid", "==", uid),
        limit(5)
      );
      unsubFirestore = onSnapshot(
        q,
        (snap) => {
          const merged = new Map<string, { id: string; date: number; content: string }>();
          snap.docs.forEach((d) => {
            const data = d.data();
            if (linkedCoachId && data?.coachId && data.coachId !== linkedCoachId) {
              return;
            }
            if (!linkedCoachId && linkedClubId && data?.clubId && data.clubId !== linkedClubId) {
              return;
            }
            const arr = Array.isArray(data?.notes) ? data.notes : [];
            arr.forEach((n: any) => {
              if (n && n.id && typeof n.content === "string" && n.content.trim()) {
                merged.set(String(n.id), {
                  id: String(n.id),
                  date: Number(n.date) || Number(data?.updatedAt) || Date.now(),
                  content: n.content.trim()
                });
              }
            });
          });
          const sorted = Array.from(merged.values())
            .sort((a, b) => b.date - a.date)
            .slice(0, 6);
          if (!cancelled) {
            setCoachTechnicalNotes(sorted);
            saveLocalSetting(localKey, sorted).catch(() => {});
          }
        },
        () => {}
      );
    };

    if (auth.currentUser?.uid === user.uid) {
      attach(user.uid);
    }
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser?.uid === user.uid) {
        attach(user.uid);
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubFirestore) {
        try {
          unsubFirestore();
        } catch {}
      }
    };
  }, [user?.uid, user?.coachId, user?.clubId]);

  useEffect(() => {
    reloadSavedAnalysisSessions();
    tryAutoReconnectBleHeartRate();
    const unsubWatch = subscribeWatchConnectionStatus(setWatchConnStatus);
    const unsubCloud = subscribeCloudWatchPairingStatus(setCloudStatus);
    const unsubBle = subscribeBleHeartRate(setBleHrStatus);
    return () => {
      unsubWatch();
      unsubCloud();
      unsubBle();
    };
  }, [user?.uid, reloadSavedAnalysisSessions]);

  // Close watch linking sheet automatically on fresh connection & prompt one-time sensor zeroing
  useEffect(() => {
    const becameConnected = isWatchConnected && !prevWatchConnectedRef.current;
    prevWatchConnectedRef.current = isWatchConnected;
    if (becameConnected && isWatchModalOpen) {
      setIsWatchModalOpen(false);
    }
    if (
      isWatchConnected &&
      calibration.calibratedAt === 0 &&
      !promptedCalibrationOnceRef.current
    ) {
      promptedCalibrationOnceRef.current = true;
      setIsCalibrationOpen(true);
    }
  }, [isWatchConnected, isWatchModalOpen, calibration.calibratedAt]);

  const persistSessionSnapshot = useCallback(
    async (nextShots: AnalysisShotRecord[], isDraft: boolean) => {
      if (nextShots.length === 0) return;
      const summary = computeAnalysisSessionSummary(nextShots);
      const now = Date.now();
      const docPayload = sanitizeForFirestore({
        id: sessionIdRef.current,
        userId: user.uid,
        userName: user.fullName || user.nickname || (isEs ? "Arquero" : "Archer"),
        clubId: user.clubId || null,
        timestamp: sessionStartTsRef.current,
        updatedAt: now,
        practiceType: "Análisis",
        format: "Análisis",
        bowType: calibration.bowType,
        distance: calibration.distanceM,
        endsCount: 1,
        arrowsPerEnd: Math.min(20, Math.max(1, nextShots.length)),
        score: 0,
        maxScore: 0,
        totalArrowsVolume: nextShots.length,
        isAnalysisSession: true,
        isDraft,
        ...(summary.avgHeartRateBpm ? { avgHeartRateBpm: summary.avgHeartRateBpm } : {}),
        ...(summary.maxHeartRateBpm ? { maxHeartRateBpm: summary.maxHeartRateBpm } : {}),
        ends: [
          {
            arrows: nextShots
              .slice(0, 20)
              .map((s) => s.markedImpact?.scoreLabel.replace("10 · X", "X") || "")
          }
        ],
        impacts: nextShots
          .filter((s) => s.markedImpact)
          .slice(0, 200)
          .map((s, idx) => ({
            x: Number((50 + (s.markedImpact?.x || 0) * 47).toFixed(2)),
            y: Number((50 + (s.markedImpact?.y || 0) * 47).toFixed(2)),
            value: s.markedImpact?.scoreLabel.replace("10 · X", "X") || "10",
            endIdx: 0,
            arrowIdx: idx
          })),
        biometrics: {
          isAnalysisSession: true,
          bowWrist: calibration.bowWrist,
          avgStabilityPct: summary.avgStabilityPct,
          avgPrepSeconds: summary.avgPrepSeconds,
          avgAimSeconds: summary.avgAimSeconds,
          avgReleaseJumpCm: summary.avgReleaseJumpCm,
          ...(summary.avgHeartRateBpm ? { avgHeartRateBpm: summary.avgHeartRateBpm } : {}),
          ...(summary.maxHeartRateBpm ? { maxHeartRateBpm: summary.maxHeartRateBpm } : {}),
          analysisShots: nextShots.slice(0, 120)
        }
      });

      await saveLocalSession(sessionIdRef.current, docPayload);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionIdRef.current,
        payload: docPayload,
        timestamp: now
      });
      runSync().catch(() => {});
    },
    [user.uid, user.fullName, user.nickname, user.clubId, calibration, isEs]
  );

  // Sync live Analysis mode & calibration to connected Smartwatch (without 1Hz BLE BPM cloud write churn)
  const liveWatchSnapshot = useMemo<BiometricSessionSnapshot>(() => {
    const summary = computeAnalysisSessionSummary(shots);
    const curBle = bleHrRef.current;
    const liveHr =
      curBle.state === "connected" && curBle.currentBpm >= 30
        ? curBle.currentBpm
        : summary.avgHeartRateBpm;
    return {
      sessionId: sessionIdRef.current,
      sessionActive: true,
      arrowsCount: shots.length,
      totalScore: 0,
      distanceM: calibration.distanceM,
      arrowsPerEnd: 6,
      endsCount: 12,
      completedEnds: 0,
      currentEndIndex: 0,
      currentEndArrows: [],
      stepsCount: 0,
      gpsDistanceM: 0,
      distanceWalkedM: 0,
      gpsActive: false,
      activeKcal: 0,
      ...(liveHr && liveHr >= 30 ? { heartRateBpm: liveHr } : {}),
      ...(summary.avgHeartRateBpm ? { avgHeartRateBpm: summary.avgHeartRateBpm } : {}),
      ...(summary.maxHeartRateBpm ? { maxHeartRateBpm: summary.maxHeartRateBpm } : {}),
      bowPoundageLbs: parseBowPoundageLbs(user),
      practiceType: "Análisis",
      bowType: calibration.bowType,
      autoDetectEnabled: captureMode === "AUTO",
      analysisMode: true,
      analysisCalibrationJson: JSON.stringify({
        bowType: calibration.bowType,
        bowWrist: calibration.bowWrist,
        distanceM: calibration.distanceM,
        zeroGravityVec: calibration.zeroGravityVec,
        ...(manualStartAt > 0 ? { manualStartAt } : {}),
        ...(manualStopAt > 0 ? { manualStopAt } : {}),
        ...(calibrateZeroAt > 0 ? { calibrateZeroAt } : {})
      }),
      updatedAt: sessionStartTsRef.current + shots.length
    };
  }, [
    shots,
    calibration,
    captureMode,
    manualStartAt,
    manualStopAt,
    calibrateZeroAt,
    bleHrStatus.state,
    user
  ]);

  useEffect(() => {
    if (!isManualRecording || manualStartAt <= 0) {
      setManualElapsedSec(0);
      return;
    }
    const tick = () => {
      setManualElapsedSec(Math.max(0, (Date.now() - manualStartAt) / 1000));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [isManualRecording, manualStartAt]);

  const latestWatchSnapshotRef = useRef<BiometricSessionSnapshot>(liveWatchSnapshot);
  latestWatchSnapshotRef.current = liveWatchSnapshot;

  useEffect(() => {
    if (isFinishingRef.current) return;
    publishWatchState(liveWatchSnapshot);
  }, [liveWatchSnapshot]);

  // Initialize 6-digit Cloud Pairing Code AFTER publishing analysisMode:true & reset watch mode cleanly on unmount
  useEffect(() => {
    let cancelled = false;
    const ensureCloudWatchReady = (uid: string) => {
      if (cancelled || !uid || uid === "USR-GUEST-OFFLINE") return;
      publishWatchState(latestWatchSnapshotRef.current);
      getOrCreatePhoneWatchPairingCode(uid)
        .then(() => {
          if (!cancelled) {
            publishWatchState(latestWatchSnapshotRef.current);
          }
        })
        .catch(() => {});
    };

    if (auth.currentUser?.uid && auth.currentUser.uid === user?.uid) {
      ensureCloudWatchReady(user.uid);
    }
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser?.uid && fbUser.uid === user?.uid) {
        ensureCloudWatchReady(fbUser.uid);
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
      publishWatchState({
        ...latestWatchSnapshotRef.current,
        sessionId: "",
        sessionActive: false,
        analysisMode: false,
        practiceType: "Práctica",
        arrowsCount: 0,
        updatedAt: Date.now()
      });
    };
  }, [user?.uid]);

  // Listen for real ANALYSIS_SHOT telemetry & state requests coming from Smartwatch (Wear OS or /watch)
  useEffect(() => {
    return subscribeWatchMessages((msg) => {
      const incomingHr =
        "heartRateBpm" in msg && typeof msg.heartRateBpm === "number"
          ? msg.heartRateBpm
          : msg.type === "STATE_UPDATE" && typeof msg.payload?.heartRateBpm === "number"
          ? msg.payload.heartRateBpm
          : null;
      if (incomingHr !== null && incomingHr >= 30 && incomingHr <= 245) {
        setWatchLiveHr({ bpm: Math.round(incomingHr), at: Date.now() });
      } else if (incomingHr !== null && incomingHr <= 0 && "type" in msg && String(msg.type) === "HEART_RATE") {
        setWatchLiveHr({ bpm: 0, at: 0 });
      }
      if (msg.type === "REQUEST_STATE") {
        publishWatchState(latestWatchSnapshotRef.current);
        return;
      }
      if (msg.type === "TOGGLE_AUTO_DETECT" && typeof msg.enabled === "boolean") {
        setCaptureMode(msg.enabled ? "AUTO" : "MANUAL");
        return;
      }
      if (msg.type === "ANALYSIS_MANUAL_START") {
        const ts = typeof msg.ts === "number" && msg.ts > 0 ? msg.ts : Date.now();
        setCaptureMode("MANUAL");
        setManualStartAt(ts);
        setIsManualRecording(true);
        setIsMarkMode(false);
        triggerHaptic("arrow");
        return;
      }
      if (msg.type === "ANALYSIS_MANUAL_STOP") {
        const ts = typeof msg.ts === "number" && msg.ts > 0 ? msg.ts : Date.now();
        setManualStopAt(ts);
        setIsManualRecording(false);
        return;
      }
      if (msg.type === "ANALYSIS_ZERO_VECTOR") {
        let vec: [number, number, number] | null = null;
        if (Array.isArray(msg.zeroGravityVec) && msg.zeroGravityVec.length === 3) {
          vec = [
            Number(msg.zeroGravityVec[0]) || 0,
            Number(msg.zeroGravityVec[1]) || 0,
            Number(msg.zeroGravityVec[2]) || 9.81
          ];
        } else if (typeof msg.analysisShotJson === "string") {
          try {
            const parsed = JSON.parse(msg.analysisShotJson);
            if (Array.isArray(parsed) && parsed.length === 3) {
              vec = [
                Number(parsed[0]) || 0,
                Number(parsed[1]) || 0,
                Number(parsed[2]) || 9.81
              ];
            }
          } catch {}
        }
        if (vec) {
          setCalibration((prev) => {
            const next = { ...prev, zeroGravityVec: vec as [number, number, number] };
            if (next.calibratedAt > 0) {
              saveAnalysisCalibration(next, user?.uid);
            }
            return next;
          });
        }
        return;
      }
      if (msg.type === "ANALYSIS_SHOT" && typeof msg.analysisShotJson === "string") {
        setIsManualRecording(false);
        const nextNum = shotsRef.current.length + 1;
        const decoded = decodeCompactShotAnalysis(msg.analysisShotJson, nextNum);
        if (!decoded) return;

        // Deduplicate simultaneous Bluetooth + 6-Digit Cloud delivery of the same shot
        const dedupKey = `${decoded.id}|${decoded.timestamp}`;
        const sigKey = `${decoded.prepSeconds.toFixed(1)}|${decoded.aimSeconds.toFixed(1)}|${decoded.stabilityPct}`;
        const nowRecv = Date.now();
        if (
          seenShotKeysRef.current.has(dedupKey) ||
          nowRecv - lastShotRecvTsRef.current.ts < 1200 ||
          (nowRecv - lastShotRecvTsRef.current.ts < 2500 && lastShotRecvTsRef.current.sig === sigKey)
        ) {
          return;
        }
        seenShotKeysRef.current.add(dedupKey);
        lastShotRecvTsRef.current = { ts: nowRecv, sig: sigKey };

        const bleNow = bleHrRef.current;
        const resolvedBpm =
          bleNow.state === "connected" && bleNow.currentBpm >= 30
            ? bleNow.currentBpm
            : decoded.heartRateBpm && decoded.heartRateBpm >= 30
            ? decoded.heartRateBpm
            : typeof msg.heartRateBpm === "number" && msg.heartRateBpm >= 30
            ? Math.round(msg.heartRateBpm)
            : undefined;

        const enrichedShot: AnalysisShotRecord = {
          ...decoded,
          id: `SHOT-${Date.now()}-${nextNum}`,
          shotNumber: nextNum,
          distanceM: calibration.distanceM,
          bowType: calibration.bowType,
          ...(resolvedBpm ? { heartRateBpm: resolvedBpm } : {})
        };

        const updatedShots = [...shotsRef.current, enrichedShot];
        shotsRef.current = updatedShots;
        setShots(updatedShots);
        setSelectedShotIdx(updatedShots.length - 1);
        setIsMarkMode(false);
        triggerHaptic("confirm");
        persistSessionSnapshot(updatedShots, true).catch(() => {});
      }
    });
  }, [calibration.distanceM, calibration.bowType, persistSessionSnapshot]);

  const getBowLabel = (b?: string) => {
    const raw =
      b === "Recurve"
        ? t("bowRecurve")
        : b === "Compound"
        ? t("bowCompound")
        : t("bowBarebow");
    return isEs ? raw : raw.replace(/\s*\([^)]*\)/g, "").trim() || raw;
  };

  const handleMarkImpactOnCurrentShot = (impact: AnalysisMarkedImpact) => {
    if (shots.length === 0) return;
    const safeIdx = Math.min(selectedShotIdx, shots.length - 1);
    const updated = shots.map((s, idx) =>
      idx === safeIdx ? { ...s, markedImpact: impact } : s
    );
    shotsRef.current = updated;
    setShots(updated);
    setIsMarkMode(false);
    triggerHaptic("arrow");
    persistSessionSnapshot(updated, true).catch(() => {});
  };

  const handleResetSession = async () => {
    if (shots.length === 0) return;
    const ok = await showOledConfirm(
      tx(
        "¿Deseas descartar los tiros actuales y comenzar un nuevo análisis?",
        "Discard current shots and start a new analysis?"
      ),
      {
        confirmLabel: tx("Reiniciar", "Reset"),
        cancelLabel: t("cancel")
      }
    );
    if (!ok) return;

    const oldId = sessionIdRef.current;
    await deleteLocalSession(oldId).catch(() => {});
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "sessions",
      operation: "DELETE",
      payloadId: oldId,
      payload: { id: oldId },
      timestamp: Date.now()
    }).catch(() => {});
    runSync().catch(() => {});
    resetBleHeartRateSessionStats(0, 0);
    seenShotKeysRef.current.clear();
    sessionIdRef.current = generateResilientId("SES");
    sessionStartTsRef.current = Date.now();
    shotsRef.current = [];
    setShots([]);
    setSelectedShotIdx(0);
    setIsMarkMode(false);
    setIsManualRecording(false);
    setManualStartAt(0);
    setManualStopAt(0);
  };

  const handleManualStart = () => {
    if (!isWatchConnected) {
      setIsWatchModalOpen(true);
      return;
    }
    const now = Date.now();
    triggerHaptic("arrow");
    setIsMarkMode(false);
    setManualStartAt(now);
    setIsManualRecording(true);
    sendWatchCommand({ type: "ANALYSIS_MANUAL_START", ts: now, source: "phone_manual" });
  };

  const handleManualStop = () => {
    if (!isManualRecording) return;
    const now = Date.now();
    triggerHaptic("confirm");
    setManualStopAt(now);
    setIsManualRecording(false);
    sendWatchCommand({ type: "ANALYSIS_MANUAL_STOP", ts: now, source: "phone_manual" });
  };

  const handleSaveAndFinishSession = async () => {
    if (shots.length === 0 || isFinishingRef.current) return;
    isFinishingRef.current = true;
    try {
      triggerHaptic("confirm");
      await persistSessionSnapshot(shots, false);
      resetBleHeartRateSessionStats(0, 0);
      seenShotKeysRef.current.clear();
      publishWatchState({
        ...latestWatchSnapshotRef.current,
        sessionId: "",
        sessionActive: false,
        analysisMode: false,
        practiceType: "Práctica",
        arrowsCount: 0,
        updatedAt: Date.now()
      });
      sessionIdRef.current = generateResilientId("SES");
      sessionStartTsRef.current = Date.now();
      shotsRef.current = [];
      setShots([]);
      setSelectedShotIdx(0);
      setIsMarkMode(false);
      await reloadSavedAnalysisSessions();
      onNavigateHistoryAnalysis();
    } catch (err) {
      console.error("Failed to save analysis session:", err);
      isFinishingRef.current = false;
    }
  };

  const safeShotIdx = Math.min(selectedShotIdx, Math.max(0, shots.length - 1));
  const activeShot = shots[safeShotIdx] || null;
  const isViewingLatestShot = shots.length === 0 || safeShotIdx === shots.length - 1;
  const freshWatchBpm =
    watchLiveHr.bpm >= 30 && Date.now() - watchLiveHr.at <= 15_000 ? watchLiveHr.bpm : 0;
  const liveStreamBpm =
    bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
      ? bleHrStatus.currentBpm
      : freshWatchBpm;
  const liveBpmDisplay = isViewingLatestShot
    ? liveStreamBpm || activeShot?.heartRateBpm || 0
    : activeShot?.heartRateBpm || liveStreamBpm || 0;

  const sessionSummary = useMemo(() => computeAnalysisSessionSummary(shots), [shots]);
  const sessionAvgBpm =
    bleHrStatus.avgHeartRateBpm && bleHrStatus.avgHeartRateBpm >= 30
      ? bleHrStatus.avgHeartRateBpm
      : sessionSummary.avgHeartRateBpm || 0;
  const sessionMaxBpm = Math.max(
    bleHrStatus.maxHeartRateBpm && bleHrStatus.maxHeartRateBpm >= 30
      ? bleHrStatus.maxHeartRateBpm
      : 0,
    sessionSummary.maxHeartRateBpm || 0,
    liveBpmDisplay >= 30 ? liveBpmDisplay : 0
  );

  const prepPct = activeShot
    ? Math.round(
        (activeShot.prepSeconds /
          Math.max(0.5, activeShot.prepSeconds + activeShot.aimSeconds)) *
          100
      )
    : 30;

  // ============================================================================
  // STATE A: UNCONNECTED WATCH (AND ZERO ACTIVE SHOTS) — ZERO FAKE NUMBERS
  // ============================================================================
  if (!isWatchConnected && shots.length === 0 && !previewLivePanel) {
    return (
      <div className="flex flex-col gap-3.5 py-2 w-full max-w-full overflow-x-hidden font-sans">
        {/* Top Context Header */}
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h1 className="text-[21.5px] sm:text-[23.8px] font-black uppercase tracking-wide text-white leading-tight">
              {tx("Análisis", "Analysis")}
            </h1>
            <div className="flex items-center gap-1.5 text-[14px] font-semibold text-white">
              <span className="w-2 h-2 rounded-full border-2 border-white/70 shrink-0" />
              <span className={isEs ? undefined : "break-words leading-tight"}>
                {tx("Sin reloj conectado", "No watch connected")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsCalibrationOpen(true)}
            aria-label={tx("Ajuste del sensor", "Sensor calibration")}
            className={`h-[38px] px-3.5 rounded-[12px] bg-[#0D1017] border border-white/[0.12] text-[15px] font-bold text-white flex items-center gap-2 shrink-0 cursor-pointer tabular-nums${
              isEs ? "" : " max-w-[54%]"
            }`}
          >
            <span className={isEs ? undefined : "break-words leading-tight"}>
              {getBowLabel(calibration.bowType)} · {calibration.distanceM}m
            </span>
            <Settings size={14} className="text-white/80 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {/* Hero Connect Watch Card (+15% instruction copy, unified Outfit typography) */}
        <section className="bg-[#0B0E15] border border-white/[0.10] rounded-[28px] px-4 py-5 flex flex-col items-center text-center gap-4">
          {/* Rectangular Black Titanium Smartwatch Hardware Preview */}
          <div
            onClick={() => setIsWatchModalOpen(true)}
            role="img"
            aria-label={tx("Vista previa de Análisis en reloj inteligente", "Smartwatch Analysis preview")}
            className="relative w-[206px] h-[250px] flex items-center justify-center shrink-0 cursor-pointer select-none"
          >
            {/* Top & Bottom Brushed Titanium Strap Lugs */}
            <span
              aria-hidden="true"
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[108px] h-[18px] rounded-t-[8px] border-t border-x border-white/[0.14]"
              style={{
                background:
                  "linear-gradient(90deg, #0D1016 0%, #1F2531 20%, #141821 50%, #1F2531 80%, #0D1016 100%)"
              }}
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[108px] h-[18px] rounded-b-[8px] border-b border-x border-white/[0.14]"
              style={{
                background:
                  "linear-gradient(90deg, #0D1016 0%, #1F2531 20%, #141821 50%, #1F2531 80%, #0D1016 100%)"
              }}
            />

            {/* Left Speaker Vents & Action Button */}
            <div
              aria-hidden="true"
              className="absolute left-[8px] top-[76px] flex flex-col gap-[3.5px] z-[2]"
            >
              <span className="w-[2.5px] h-[9px] rounded-full bg-[#080A0F] border border-white/[0.15]" />
              <span className="w-[2.5px] h-[9px] rounded-full bg-[#080A0F] border border-white/[0.15]" />
              <span className="w-[2.5px] h-[9px] rounded-full bg-[#080A0F] border border-white/[0.15]" />
            </div>
            <span
              aria-hidden="true"
              className="absolute left-[6.5px] bottom-[76px] w-[5px] h-[29px] rounded-l-[3px] border border-r-0 border-white/[0.22] z-[2]"
              style={{
                background: "linear-gradient(180deg, #FF5500 0%, #D93800 50%, #9E2800 100%)"
              }}
            />

            {/* Right Crown Guard + Ridged Crown + Side Button */}
            <span
              aria-hidden="true"
              className="absolute right-[6.5px] top-[54px] w-[9px] h-[110px] rounded-r-[8px] border border-l-0 border-white/[0.16] z-[2]"
              style={{
                background: "linear-gradient(180deg, #1E232E 0%, #141820 50%, #0E1117 100%)"
              }}
            />
            <div
              aria-hidden="true"
              className="absolute right-[2px] top-[66px] w-[10px] h-[38px] rounded-[4px] border border-white/[0.26] flex items-center justify-center overflow-hidden z-[3]"
              style={{
                background: "linear-gradient(180deg, #323948 0%, #1B202B 50%, #2C3342 100%)"
              }}
            >
              <span className="absolute left-[1px] top-[3px] bottom-[3px] w-[1.5px] rounded-full bg-[#FF4500]" />
              <div className="flex flex-col gap-[3px] w-full pl-[3.5px]">
                <span className="block h-[2px] w-full bg-white/25 rounded-[0.5px]" />
                <span className="block h-[2px] w-full bg-white/25 rounded-[0.5px]" />
                <span className="block h-[2px] w-full bg-white/25 rounded-[0.5px]" />
                <span className="block h-[2px] w-full bg-white/25 rounded-[0.5px]" />
                <span className="block h-[2px] w-full bg-white/25 rounded-[0.5px]" />
              </div>
            </div>
            <span
              aria-hidden="true"
              className="absolute right-[8px] top-[114px] w-[2.5px] h-[2.5px] rounded-full bg-[#050608] border border-white/20 z-[3]"
            />
            <span
              aria-hidden="true"
              className="absolute right-[4.5px] top-[124px] w-[5px] h-[29px] rounded-r-[3px] border border-l-0 border-white/[0.22] z-[3]"
              style={{
                background: "linear-gradient(180deg, #2B3240 0%, #171B24 50%, #252B38 100%)"
              }}
            />

            {/* Main Squircle Titanium Case */}
            <div
              className="relative w-[184px] h-[224px] rounded-[42px] p-[6px] border border-white/[0.16] flex items-center justify-center z-[4]"
              style={{
                background: "linear-gradient(145deg, #2A303D 0%, #151922 45%, #0D1016 100%)"
              }}
            >
              {/* Inner Matte Bezel */}
              <div className="w-full h-full rounded-[37px] bg-[#06080C] p-[4px] border border-white/[0.10] flex items-center justify-center">
                {/* Pure OLED Squircle Display */}
                <div className="relative w-full h-full rounded-[33px] bg-[#020305] border border-white/[0.09] pt-[10px] pb-[9px] px-2.5 flex flex-col items-center justify-between overflow-hidden">
                  {/* Official Brand Logo */}
                  <img
                    src="/images/brand_logo_header.png"
                    srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                    alt="ARCHERY 101010"
                    className="w-[92px] h-auto object-contain shrink-0 z-10 pointer-events-none [image-rendering:-webkit-optimize-contrast]"
                    draggable={false}
                  />

                  {/* Dead-Center 10-Ring Brand-Line Diana & Shot Trace */}
                  <div className="flex-1 flex items-center justify-center pointer-events-none">
                    <svg width="128" height="128" viewBox="0 0 190 190" aria-hidden="true">
                      <circle
                        cx="95"
                        cy="95"
                        r="91"
                        fill="#020306"
                        stroke="rgba(255,255,255,0.88)"
                        strokeWidth="2.1"
                      />
                      <line x1="95" y1="4" x2="95" y2="73" stroke="rgba(255,255,255,0.20)" strokeWidth="1.05" />
                      <line x1="95" y1="117" x2="95" y2="186" stroke="rgba(255,255,255,0.20)" strokeWidth="1.05" />
                      <line x1="4" y1="95" x2="73" y2="95" stroke="rgba(255,255,255,0.20)" strokeWidth="1.05" />
                      <line x1="117" y1="95" x2="186" y2="95" stroke="rgba(255,255,255,0.20)" strokeWidth="1.05" />

                      <line x1="95" y1="4" x2="95" y2="9.5" stroke="#FFFFFF" strokeWidth="1.8" />
                      <line x1="95" y1="180.5" x2="95" y2="186" stroke="#FFFFFF" strokeWidth="1.8" />
                      <line x1="4" y1="95" x2="9.5" y2="95" stroke="#FFFFFF" strokeWidth="1.8" />
                      <line x1="180.5" y1="95" x2="186" y2="95" stroke="#FFFFFF" strokeWidth="1.8" />

                      <circle cx="95" cy="95" r="81.9" fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth="1.4" />
                      <circle cx="95" cy="95" r="72.8" fill="none" stroke="#B8C4D8" strokeOpacity="0.68" strokeWidth="1.65" />
                      <circle cx="95" cy="95" r="63.7" fill="none" stroke="#9AA8C0" strokeOpacity="0.48" strokeWidth="1.3" />

                      <circle cx="95" cy="95" r="54.6" fill="rgba(0,191,255,0.05)" stroke="#00BFFF" strokeWidth="2.25" />
                      <circle cx="95" cy="95" r="45.5" fill="none" stroke="#00BFFF" strokeOpacity="0.72" strokeWidth="1.45" />

                      <circle cx="95" cy="95" r="36.4" fill="rgba(255,30,30,0.06)" stroke="#FF1E1E" strokeWidth="2.35" />
                      <circle cx="95" cy="95" r="27.3" fill="none" stroke="#FF1E1E" strokeOpacity="0.74" strokeWidth="1.5" />

                      <circle cx="95" cy="95" r="18.2" fill="rgba(255,229,0,0.09)" stroke="#FFE500" strokeWidth="2.55" />
                      <circle cx="95" cy="95" r="9.1" fill="none" stroke="#FFE500" strokeOpacity="0.92" strokeWidth="1.65" />

                      <line x1="92.0" y1="95" x2="98.0" y2="95" stroke="#FFE500" strokeWidth="1.35" />
                      <line x1="95" y1="92.0" x2="95" y2="98.0" stroke="#FFE500" strokeWidth="1.35" />

                      <path
                        d="M 43 143 C 60 123, 71 106, 83 100"
                        fill="none"
                        stroke="#020306"
                        strokeWidth="4.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 43 143 C 60 123, 71 106, 83 100"
                        fill="none"
                        stroke="#FFFFFF"
                        strokeOpacity="0.92"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeDasharray="3.4 3.6"
                      />

                      <path
                        d="M 83 100 C 89 96, 100 88, 97 98 C 94 104, 89 93, 93 91 C 98 90, 97 95, 95 93"
                        fill="none"
                        stroke="#020306"
                        strokeWidth="5.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M 83 100 C 89 96, 100 88, 97 98 C 94 104, 89 93, 93 91 C 98 90, 97 95, 95 93"
                        fill="none"
                        stroke="#00BFFF"
                        strokeWidth="3.0"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      <circle cx="95" cy="93" r="4.8" fill="#FFFFFF" stroke="#020306" strokeWidth="2.0" />
                    </svg>
                  </div>

                  {/* Watch Footer INICIO / FINAL Pills + Pagination Dots */}
                  <div className="flex flex-col items-center gap-[3.5px] z-10 shrink-0 w-full px-1">
                    <div className="grid grid-cols-2 gap-[4px] w-full">
                      <span className="h-[17px] rounded-full bg-[#00BFFF] text-black text-[7px] font-black uppercase tracking-[0.06em] flex items-center justify-center">
                        ▶ {tx("Inicio", "Start")}
                      </span>
                      <span className="h-[17px] rounded-full bg-[#FF1E1E] text-white text-[7px] font-black uppercase tracking-[0.06em] flex items-center justify-center">
                        ■ {tx("Final", "End")}
                      </span>
                    </div>
                    <div className="flex items-center gap-[3.5px]" aria-hidden="true">
                      <span className="w-[9px] h-[3px] rounded-full bg-[#00BFFF]" />
                      <span className="w-[3px] h-[3px] rounded-full bg-white/25" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 max-w-[356px]">
            <h2 className="text-[21.5px] font-bold text-white tracking-normal leading-tight">
              {tx("Conecta tu reloj inteligente", "Connect your smartwatch")}
            </h2>
            <p className="text-[15.5px] font-normal text-white leading-snug">
              {tx(
                "Colócalo en la muñeca del arco y usa INICIO / FINAL desde el teléfono o con el botón físico del reloj.",
                "Wear it on your bow wrist and use START / END from your phone or the physical watch button."
              )}
            </p>
          </div>

          <div className="w-full grid grid-cols-3 gap-1.5">
            <div
              className={`bg-[#06080D] border border-white/[0.08] rounded-[13px] py-2.5 ${
                isEs ? "px-1.5" : "overflow-hidden px-1"
              } flex flex-col items-center gap-0.5`}
            >
              <span
                className={`text-[11.5px] font-bold uppercase tracking-wider text-[#00BFFF]${
                  isEs ? "" : " break-words leading-tight max-w-full"
                }`}
              >
                {tx("Paso 1", "Step 1")}
              </span>
              <span
                className={`text-[12.8px] min-[380px]:text-[13.2px] font-bold text-white ${
                  isEs ? "whitespace-nowrap" : "break-words leading-tight max-w-full"
                }`}
              >
                {tx("Abre en reloj", "Open watch")}
              </span>
            </div>
            <div
              className={`bg-[#06080D] border border-white/[0.08] rounded-[13px] py-2.5 ${
                isEs ? "px-1.5" : "overflow-hidden px-1"
              } flex flex-col items-center gap-0.5`}
            >
              <span
                className={`text-[11.5px] font-bold uppercase tracking-wider text-[#00BFFF]${
                  isEs ? "" : " break-words leading-tight max-w-full"
                }`}
              >
                {tx("Paso 2", "Step 2")}
              </span>
              <span
                className={`text-[12.8px] min-[380px]:text-[13.2px] font-bold text-white ${
                  isEs ? "whitespace-nowrap" : "break-words leading-tight max-w-full"
                }`}
              >
                {tx("Vincula código", "Link code")}
              </span>
            </div>
            <div
              className={`bg-[#06080D] border border-white/[0.08] rounded-[13px] py-2.5 ${
                isEs ? "px-1.5" : "overflow-hidden px-1"
              } flex flex-col items-center gap-0.5`}
            >
              <span
                className={`text-[11.5px] font-bold uppercase tracking-wider text-[#00BFFF]${
                  isEs ? "" : " break-words leading-tight max-w-full"
                }`}
              >
                {tx("Paso 3", "Step 3")}
              </span>
              <span
                className={`text-[12.8px] min-[380px]:text-[13.2px] font-bold text-white ${
                  isEs ? "whitespace-nowrap" : "break-words leading-tight max-w-full"
                }`}
              >
                {tx("Inicio / Final", "Start / End")}
              </span>
            </div>
          </div>

          <div className="w-full flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setIsWatchModalOpen(true)}
              className="w-full min-h-[50px] rounded-[15px] bg-white hover:bg-neutral-100 text-black font-bold text-[16.5px] tracking-wide flex items-center justify-center cursor-pointer active:scale-[0.99] transition"
            >
              {tx("Vincular reloj inteligente", "Link smartwatch")}
            </button>
            <button
              type="button"
              onClick={() => setPreviewLivePanel(true)}
              className="w-full min-h-[42px] rounded-[13px] bg-[#0D1119] border border-white/[0.12] text-white font-bold text-[13.5px] tracking-wide flex items-center justify-center cursor-pointer active:scale-[0.99] transition"
            >
              {tx("Ver pantalla de Análisis →", "Open Analysis controls →")}
            </button>
          </div>
        </section>

        {/* Saved Past Analyses Card (Accessible Offline Without Watch) */}
        <section className="bg-[#0D1017] border border-white/[0.08] rounded-[22px] p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[12.6px] font-bold uppercase tracking-wider text-white">
              {tx("Sesiones guardadas", "Saved sessions")}
            </span>
            <button
              type="button"
              onClick={onNavigateHistoryAnalysis}
              className="text-[13.2px] font-bold text-[#00BFFF] cursor-pointer"
            >
              {tx("Ver historial →", "View history →")}
            </button>
          </div>

          {savedPastSessions.length === 0 ? (
            <div className="bg-[#07090E] border border-white/[0.07] rounded-[14px] px-3 py-3.5 text-center text-[13.8px] font-normal text-white leading-snug">
              {tx(
                "Aún no tienes sesiones de análisis guardadas.",
                "You don't have saved analysis sessions yet."
              )}
            </div>
          ) : (
            savedPastSessions.slice(0, 2).map((sess) => {
              const sShots = extractAnalysisShots(sess);
              const sSummary = computeAnalysisSessionSummary(sShots);
              const dStr = formatRegionalDate(sess.timestamp, language, {
                day: "numeric",
                month: "short"
              });
              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={onNavigateHistoryAnalysis}
                  className={`h-[50px] bg-[#07090E] border border-white/[0.07] hover:border-white/[0.18] rounded-[14px] px-3 flex items-center justify-between gap-2 ${
                    isEs ? "text-left" : "text-start"
                  } cursor-pointer transition`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-extrabold text-white break-words leading-tight">
                      {dStr} · {getBowLabel(sess.bowType)}
                    </span>
                    <span className="text-[11.5px] font-semibold text-white tabular-nums">
                      {sess.distance || 18}m · {sShots.length} {tx("flechas", "arrows")}
                    </span>
                  </div>
                  <span className="h-[26px] px-2.5 rounded-[8px] bg-[#141925] border border-white/[0.10] text-[12px] font-black text-white flex items-center tabular-nums shrink-0">
                    {sSummary.avgStabilityPct}%
                  </span>
                </button>
              );
            })
          )}
        </section>

        <AnalysisCalibrationModal
          isOpen={isCalibrationOpen}
          initialProfile={calibration}
          onClose={() => setIsCalibrationOpen(false)}
          onSaveCalibration={(next) => setCalibration(next)}
        />

        <SmartwatchMiniApp
          isOpen={isWatchModalOpen}
          onClose={() => setIsWatchModalOpen(false)}
          liveSnapshot={liveWatchSnapshot}
        />
      </div>
    );
  }

  // ============================================================================
  // STATE B: LIVE CONNECTED ANALYSIS VIEW (Exact Approved `analisis-app-fases-4k.png`)
  // ============================================================================
  return (
    <div className="flex flex-col gap-3 py-2 w-full max-w-full overflow-x-hidden font-sans">
      {/* Top Context & Hardware Controls Bar */}
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <h1 className="text-[21px] sm:text-[23.5px] font-black uppercase tracking-wide text-white leading-tight">
            {tx("Análisis", "Analysis")}
          </h1>
          <button
            type="button"
            onClick={() => setIsWatchModalOpen(true)}
            className={`flex items-center gap-1.5 text-[12.5px] sm:text-[13.5px] font-semibold text-white leading-tight cursor-pointer ${
              isEs ? "text-left" : "text-start"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isWatchConnected ? "bg-[#00BFFF]" : "bg-[#FFE500]"
              }`}
            />
            <span className="leading-tight break-words">
              {getBowLabel(calibration.bowType)} ·{" "}
              {isWatchConnected
                ? tx("Reloj conectado", "Watch connected")
                : tx("En pausa", "Paused")}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="h-[34px] bg-[#0D1017] border border-white/[0.10] rounded-[11px] p-[3px] flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCaptureMode("MANUAL")}
              className={`h-[26px] px-2.5 rounded-[8px] text-[10.5px] font-extrabold tracking-[0.03em] cursor-pointer transition ${
                captureMode === "MANUAL" ? "bg-[#00BFFF] text-black font-black" : "text-white"
              }`}
            >
              MANUAL
            </button>
            <button
              type="button"
              onClick={() => {
                setIsManualRecording(false);
                setCaptureMode("AUTO");
              }}
              className={`h-[26px] px-2.5 rounded-[8px] text-[10.5px] font-extrabold tracking-[0.03em] cursor-pointer transition ${
                captureMode === "AUTO" ? "bg-[#00BFFF] text-black font-black" : "text-white"
              }`}
            >
              AUTO
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetSession}
            aria-label={tx("Reiniciar sesión", "Reset session")}
            className="w-[34px] h-[34px] rounded-[11px] bg-[#0D1017] border border-white/[0.10] text-white flex items-center justify-center cursor-pointer"
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => setIsCalibrationOpen(true)}
            aria-label={tx("Ajuste del sensor", "Sensor calibration")}
            className="w-[34px] h-[34px] rounded-[11px] bg-[#0D1017] border border-white/[0.10] text-white flex items-center justify-center cursor-pointer"
          >
            <Settings size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!isWatchConnected && (
        <button
          type="button"
          onClick={() => setIsWatchModalOpen(true)}
          className="w-full bg-[#121006] border border-[#FFE500]/55 rounded-[14px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-left cursor-pointer active:scale-[0.99] transition"
        >
          <span className="text-[12.5px] font-extrabold text-white leading-snug">
            {tx(
              "Reloj sin vincular · Toca aquí para conectar tu reloj antes de iniciar",
              "Watch not linked · Tap here to connect your watch before starting"
            )}
          </span>
          <span className="px-2.5 py-1 rounded-[8px] bg-[#FFE500] text-black text-[11px] font-black uppercase shrink-0">
            {tx("Vincular", "Link")}
          </span>
        </button>
      )}

      {/* HERO FULL-WIDTH DIANA STAGE (312x312px — OUTDOOR HIGH CONTRAST) */}
      <section className="bg-[#0B0E15] border border-white/[0.09] rounded-[26px] p-3.5 flex flex-col items-center gap-3">
        <div className="w-full flex items-center justify-between gap-2">
          <div
            dir="ltr"
            className="flex items-center gap-2 bg-[#06080D] border border-white/[0.10] rounded-[12px] p-1"
          >
            <button
              type="button"
              disabled={shots.length <= 1}
              onClick={() => {
                setIsMarkMode(false);
                setSelectedShotIdx((i) => (i - 1 + shots.length) % shots.length);
              }}
              className="w-[26px] h-[26px] rounded-[8px] bg-[#121621] text-white flex items-center justify-center font-black cursor-pointer disabled:opacity-40"
            >
              ‹
            </button>
            <span
              className={`text-[13.5px] font-black text-white px-1 tabular-nums${
                isEs ? "" : " whitespace-nowrap"
              }`}
            >
              {shots.length > 0
                ? `${tx("Tiro", "Shot")} ${activeShot?.shotNumber || 1} / ${shots.length}`
                : tx("Listo · Tiro 1", "Ready · Shot 1")}
            </span>
            <button
              type="button"
              disabled={shots.length <= 1}
              onClick={() => {
                setIsMarkMode(false);
                setSelectedShotIdx((i) => (i + 1) % shots.length);
              }}
              className="w-[26px] h-[26px] rounded-[8px] bg-[#121621] text-white flex items-center justify-center font-black cursor-pointer disabled:opacity-40"
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="h-[34px] px-3 rounded-[9px] bg-[#121621] border border-white/[0.10] text-[13.8px] font-bold text-white flex items-center tabular-nums">
              {calibration.distanceM}m
            </span>
            {activeShot?.markedImpact && (
              <span className="h-[34px] px-3 rounded-[9px] bg-[#FFE500] text-black text-[13.8px] font-extrabold flex items-center justify-center tabular-nums">
                {activeShot.markedImpact.scoreLabel}
              </span>
            )}
          </div>
        </div>

        {/* Live Step-by-Step Status Banner */}
        <div
          className={`w-full rounded-[13px] px-3 py-2 border flex items-center justify-between gap-2 tabular-nums ${
            isManualRecording
              ? "bg-[#151105] border-[#FFE500]/75"
              : "bg-[#06080D] border-white/[0.09]"
          }`}
        >
          <div className="flex items-center justify-center gap-2 min-w-0 flex-1">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isManualRecording
                  ? "bg-[#FFE500] animate-pulse"
                  : captureMode === "MANUAL"
                  ? "bg-[#00BFFF]"
                  : "bg-[#00C853]"
              }`}
            />
            <span className="text-[12px] font-extrabold text-white leading-snug text-center break-words">
              {isManualRecording
                ? tx(
                    "Analizando tiro en vivo · Presiona FINAL al soltar",
                    "Recording live shot · Tap END after release"
                  )
                : captureMode === "MANUAL"
                ? tx(
                    "Presiona INICIO antes de subir el arco (o usa el botón del reloj)",
                    "Tap START before raising bow (or press watch button)"
                  )
                : tx(
                    "Modo Automático · Levanta el arco y dispara normal",
                    "Auto Mode · Raise your bow and shoot normally"
                  )}
            </span>
          </div>
          {isManualRecording && (
            <span className="px-2 py-0.5 rounded-[7px] bg-[#FFE500] text-black text-[11.5px] font-black shrink-0">
              {manualElapsedSec.toFixed(1)} s
            </span>
          )}
        </div>

        {/* GIANT 312x312 OUTDOOR HIGH-CONTRAST BRAND-LINE DIANA */}
        <div className="w-[312px] max-w-full aspect-square flex items-center justify-center relative">
          <AnalysisDianaSvg
            shot={activeShot}
            sizePx={312}
            replayTrigger={replayNonce}
            markMode={isMarkMode}
            onMarkImpact={handleMarkImpactOnCurrentShot}
          />
        </div>

        {/* Visual Legend Strip (Explains target curves immediately at first glance) */}
        <div className="w-full bg-[#06080D] border border-white/[0.07] rounded-[11px] px-3 py-1.5 flex items-center justify-around gap-2 text-[11px] font-bold text-white">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-[12px] border-t-2 border-dashed border-white inline-block" />
            <span>{tx("Subida", "Raise")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-[12px] h-[2.8px] rounded-full bg-[#00BFFF] inline-block" />
            <span>{tx("Apuntado", "Aiming")}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-[7px] h-[7px] rounded-full bg-white inline-block" />
            <span>{tx("Suelta", "Release")}</span>
          </span>
        </div>

        {/* PRIMARY MANUAL INICIO & FINAL CONTROLS */}
        {captureMode === "MANUAL" && (
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full grid grid-cols-2 gap-2.5 tabular-nums">
              <button
                type="button"
                disabled={isManualRecording}
                onClick={handleManualStart}
                className={`h-[50px] rounded-[15px] text-[14.5px] font-black uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition ${
                  isManualRecording
                    ? "bg-[#091420] border border-[#00BFFF]/55 text-white"
                    : "bg-[#00BFFF] hover:brightness-105 text-black"
                }`}
              >
                <Play
                  size={15}
                  fill={isManualRecording ? "#00BFFF" : "#000000"}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
                <span>
                  {isManualRecording
                    ? `${tx("En curso", "Active")} · ${manualElapsedSec.toFixed(1)}s`
                    : tx("Inicio", "Start")}
                </span>
              </button>

              <button
                type="button"
                disabled={!isManualRecording}
                onClick={handleManualStop}
                className={`h-[50px] rounded-[15px] text-[14.5px] font-black uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition ${
                  isManualRecording
                    ? "bg-[#FF1E1E] hover:brightness-105 text-white border border-white/20"
                    : "bg-[#121621] border border-white/[0.10] text-white/40 cursor-not-allowed"
                }`}
              >
                <Square
                  size={14}
                  fill={isManualRecording ? "#FFFFFF" : "currentColor"}
                  aria-hidden="true"
                />
                <span>{tx("Final", "End")}</span>
              </button>
            </div>
            <span className="text-[11px] font-semibold text-white/75 text-center leading-tight">
              {tx(
                "También puedes iniciar y finalizar con el botón físico del reloj.",
                "You can also start and end using the physical button on your watch."
              )}
            </span>
          </div>
        )}

        {/* Live Heart Rate & Real-Time Red ECG Waveform Module */}
        <button
          type="button"
          onClick={() => setIsBleHrModalOpen(true)}
          className={`w-full bg-[#06080C] border border-[#FF3B30]/30 hover:border-[#FF3B30]/55 rounded-[16px] px-3.5 py-2.5 flex items-center justify-between gap-2.5 ${
            isEs ? "text-left" : "text-start"
          } cursor-pointer transition active:scale-[0.99] tabular-nums`}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-[7px] h-[7px] rounded-full bg-[#FF3B30] shrink-0 ${
                  liveBpmDisplay >= 30 ? "animate-pulse" : "opacity-50"
                }`}
              />
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.11em] text-white leading-tight break-words">
                {t("bleHrTitle")}
              </span>
            </div>
            <div dir="ltr" className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[27px] font-black text-white leading-none tracking-tight">
                {liveBpmDisplay >= 30 ? liveBpmDisplay : "—"}
              </span>
              <span className="text-[12.5px] font-black text-white uppercase tracking-[0.06em]">
                BPM
              </span>
            </div>
            <span className="text-[11px] font-bold text-white leading-tight break-words">
              {sessionAvgBpm >= 30 && sessionMaxBpm >= 30
                ? `${tx("Prom.", "Avg")} ${sessionAvgBpm} · ${tx("Máx.", "Max")} ${sessionMaxBpm}`
                : liveBpmDisplay >= 30
                ? tx("Pulso en tiempo real", "Live heart rate")
                : tx("Conectar pulsaciones", "Connect heart rate")}
            </span>
          </div>

          <LiveHeartRateEcgGraph bpm={liveBpmDisplay} />
        </button>

        {/* Secondary Review Tools (Replay Shot + Optional Real Arrow Impact Annotation) */}
        {activeShot && (
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReplayNonce((n) => n + 1)}
                className="h-[42px] rounded-[14px] bg-[#141823] border border-white/[0.11] text-white text-[12.5px] font-extrabold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition"
              >
                <Play size={13} fill="#FFFFFF" aria-hidden="true" />
                <span>{tx("Repetir Tiro", "Replay Shot")}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMarkMode((v) => !v)}
                className={`h-[42px] rounded-[14px] text-[12.5px] font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                  isMarkMode
                    ? "bg-[#FFE500] text-black font-black"
                    : "bg-[#141823] border border-white/[0.11] text-white"
                }`}
              >
                <Plus size={15} strokeWidth={2.6} aria-hidden="true" />
                <span>
                  {isMarkMode
                    ? tx("Toca dónde cayó", "Tap arrow hit")
                    : tx("Anotar impacto real", "Log real hit")}
                </span>
              </button>
            </div>

            {isMarkMode && (
              <div className="w-full rounded-[10px] bg-[#171405] border border-[#FFE500]/55 px-3 py-1.5 text-[11.5px] font-bold text-[#FFE500] text-center leading-snug">
                {tx(
                  "Toca en la diana el anillo donde cayó tu flecha real en el parapeto (opcional).",
                  "Tap the ring on the target where your physical arrow landed (optional)."
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* MÉTRICAS · TIRO X */}
      <div className="flex items-center justify-between px-1 pt-0.5">
        <span className="text-[11px] font-black uppercase tracking-[0.10em] text-white tabular-nums">
          {activeShot
            ? `${tx("Métricas · Tiro", "Metrics · Shot")} ${activeShot.shotNumber}`
            : tx("Métricas en vivo", "Live metrics")}
        </span>
        {shots.length > 0 && (
          <span className="text-[11.5px] font-bold text-white">
            {tx("Desliza para ver historial ↓", "Scroll for shot log ↓")}
          </span>
        )}
      </div>

      {/* Ritmo Split Card: Preparatorio (s) + Apuntado (s) */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-[20px] p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-white">
            {tx("Ritmo del Tiro", "Shot Rhythm")}
          </span>
          <span className="bg-[#141925] border border-white/[0.10] rounded-[8px] px-2.5 py-0.5 text-[11.5px] font-extrabold text-white tabular-nums">
            {activeShot ? `Total ${activeShot.totalSeconds.toFixed(1)} s` : "Total —"}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_1px_1fr] items-center gap-3.5 tabular-nums">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-white">
              <span className="w-[11px] border-t-2 border-dashed border-white inline-block" />
              <span>{tx("Preparatorio", "Preparatory")}</span>
            </div>
            <span className="text-[26px] font-black text-white leading-tight">
              {activeShot ? activeShot.prepSeconds.toFixed(1) : "—"}
              {activeShot && <span className="text-[13px] font-bold ml-0.5">s</span>}
            </span>
          </div>

          <span className="w-[1px] h-[36px] bg-white/[0.10]" />

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-white">
              <span className="w-[11px] h-[2.8px] rounded-full bg-[#00BFFF] inline-block" />
              <span>{tx("Apuntado", "Aiming")}</span>
            </div>
            <span className="text-[26px] font-black text-white leading-tight">
              {activeShot ? activeShot.aimSeconds.toFixed(1) : "—"}
              {activeShot && <span className="text-[13px] font-bold ml-0.5">s</span>}
            </span>
          </div>
        </div>

        <div className="w-full h-[5px] flex gap-1">
          <div
            className="h-full rounded-full bg-white"
            style={{ width: `${activeShot ? Math.max(12, Math.min(82, prepPct)) : 32}%` }}
          />
          <div className="flex-1 h-full rounded-full bg-[#00BFFF]" />
        </div>
      </div>

      {/* 3-Column Objective Telemetry Row */}
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-[18px] p-3 flex flex-col justify-between gap-1">
          <span className="text-[9.8px] font-extrabold uppercase tracking-[0.06em] text-white">
            {tx("Estabilidad", "Stability")}
          </span>
          <span className="text-[23px] font-black text-white leading-none">
            {activeShot ? activeShot.stabilityPct : "—"}
            {activeShot && <span className="text-[11.5px] font-bold ml-0.5">%</span>}
          </span>
          <span className="text-[10.5px] font-bold text-white">
            {activeShot ? `±${activeShot.swayRadiusCm.toFixed(1)} cm` : "—"}
          </span>
        </div>

        <div className="bg-[#0D1017] border border-white/[0.08] rounded-[18px] p-3 flex flex-col justify-between gap-1">
          <span className="text-[9.8px] font-extrabold uppercase tracking-[0.06em] text-white">
            {tx("Suelta", "Release")}
          </span>
          <span className="text-[23px] font-black text-white leading-none">
            {activeShot ? activeShot.releaseJumpCm.toFixed(1) : "—"}
            {activeShot && <span className="text-[11.5px] font-bold ml-0.5">cm</span>}
          </span>
          <span className="text-[10.5px] font-bold text-white">
            {tx("Últ. 0.5 s", "Last 0.5 s")}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsBleHrModalOpen(true)}
          className="bg-[#0D1017] border border-white/[0.08] hover:border-[#00BFFF]/45 rounded-[18px] p-3 flex flex-col justify-between gap-1 text-left cursor-pointer transition"
        >
          <span className="text-[9.8px] font-extrabold uppercase tracking-[0.06em] text-white">
            {tx("Pulsaciones", "Heart Rate")}
          </span>
          <span className="text-[23px] font-black text-white leading-none">
            {liveBpmDisplay >= 30 ? liveBpmDisplay : "—"}
            {liveBpmDisplay >= 30 && (
              <span className="text-[11.5px] font-bold ml-0.5">BPM</span>
            )}
          </span>
          <span className="text-[10.5px] font-bold text-white">
            {liveBpmDisplay >= 30
              ? tx("En disparo", "At release")
              : tx("Conectar BT", "Pair BT")}
          </span>
        </button>
      </div>

      {/* REGISTERED SHOTS LOG */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-[22px] p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] font-black uppercase tracking-[0.09em] text-white">
            {tx("Tiros Registrados", "Recorded Shots")}
          </span>
          <span className="text-[11px] font-bold text-white tabular-nums">
            {shots.length} {tx("flechas · Visible en Coach", "arrows · Visible to Coach")}
          </span>
        </div>

        {shots.length === 0 ? (
          <div className="bg-[#080A0F] border border-white/[0.07] rounded-[14px] px-3 py-4 text-center text-[13.8px] font-normal text-white leading-snug">
            {tx(
              "Toca INICIO (o el botón físico del reloj), realiza tu tiro y presiona FINAL para ver tu trazo, tiempos y estabilidad.",
              "Tap START (or the physical watch button), shoot your arrow, and tap END to view trace, timing, and stability."
            )}
          </div>
        ) : (
          <>
            <div
              className={`grid ${
                isEs
                  ? "grid-cols-[44px_56px_1fr_1fr_44px_42px]"
                  : "grid-cols-[50px_56px_1fr_1fr_44px_42px]"
              } items-center gap-1.5 px-2.5 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white`}
            >
              <span className={isEs ? undefined : "text-start"}>{tx("Tiro", "Shot")}</span>
              <span className="text-center">{tx("Diana", "Ring")}</span>
              <span className={isEs ? "text-right" : "text-end"}>{tx("Prep.", "Prep")}</span>
              <span className={isEs ? "text-right" : "text-end"}>{tx("Apunt.", "Aim")}</span>
              <span className={isEs ? "text-right" : "text-end"}>BPM</span>
              <span className={isEs ? "text-right" : "text-end"}>{tx("Estab.", "Stab.")}</span>
            </div>

            {shots.map((s, idx) => {
              const isSel = idx === safeShotIdx;
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    setSelectedShotIdx(idx);
                    setIsMarkMode(false);
                  }}
                  className={`h-[44px] rounded-[14px] px-2.5 grid ${
                    isEs
                      ? "grid-cols-[44px_56px_1fr_1fr_44px_42px]"
                      : "grid-cols-[50px_56px_1fr_1fr_44px_42px]"
                  } items-center gap-1.5 text-[12px] font-bold text-white tabular-nums cursor-pointer transition ${
                    isSel
                      ? "bg-[#0E131D] border border-[#00BFFF]/45"
                      : "bg-[#080A0F] border border-white/[0.07]"
                  }`}
                >
                  <span className={`font-extrabold whitespace-nowrap${isEs ? "" : " text-start"}`}>
                    {tx("Tiro", "Shot")} {s.shotNumber}
                  </span>

                  {s.markedImpact ? (
                    <span className="h-[25px] px-1.5 rounded-[7px] bg-[#FFE500] text-black text-[11px] font-black flex items-center justify-center whitespace-nowrap">
                      {s.markedImpact.scoreLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedShotIdx(idx);
                        setIsMarkMode(true);
                      }}
                      className="h-[25px] px-1.5 rounded-[7px] bg-[#141822] border border-white/[0.12] text-white text-[10.5px] font-extrabold flex items-center justify-center whitespace-nowrap cursor-pointer"
                    >
                      + {tx("Diana", "Mark")}
                    </button>
                  )}

                  <span className={isEs ? "text-right" : "text-end whitespace-nowrap"}>
                    {s.prepSeconds.toFixed(1)} s
                  </span>
                  <span className={isEs ? "text-right" : "text-end whitespace-nowrap"}>
                    {s.aimSeconds.toFixed(1)} s
                  </span>
                  <span className={isEs ? "text-right" : "text-end"}>{s.heartRateBpm || "—"}</span>
                  <span className={`${isEs ? "text-right" : "text-end"} font-black`}>
                    {s.stabilityPct}%
                  </span>
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleSaveAndFinishSession}
              className="w-full min-h-[48px] mt-1.5 rounded-[15px] bg-[#00BFFF] hover:brightness-105 text-black font-black text-[14px] uppercase tracking-[0.06em] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition"
            >
              <Save size={16} aria-hidden="true" />
              <span>{tx("Guardar Sesión", "Save Session")}</span>
            </button>
          </>
        )}
      </div>

      {/* COACH TECHNICAL NOTES RECEIVED BY ATHLETE */}
      {coachTechnicalNotes.length > 0 && (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-[22px] p-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-[#00BFFF] shrink-0" aria-hidden="true" />
            <span className="text-[11px] font-black uppercase tracking-[0.09em] text-white">
              {tx("Notas Técnicas de tu Entrenador", "Coach Technical Notes")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {coachTechnicalNotes.slice(0, 3).map((note) => (
              <div
                key={note.id}
                className="bg-[#080A0F] border border-white/[0.07] rounded-[13px] px-3 py-2.5 flex flex-col gap-1"
              >
                <span className="text-[12.5px] font-semibold text-white leading-snug break-words">
                  {note.content}
                </span>
                <span className="text-[10px] font-bold text-white/75 tabular-nums">
                  {formatRegionalDate(note.date, language)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnalysisCalibrationModal
        isOpen={isCalibrationOpen}
        initialProfile={calibration}
        userUid={user?.uid}
        onStartZeroCapture={() => {
          setCalibrateZeroAt(Date.now());
          sendWatchCommand({ type: "ANALYSIS_CALIBRATE_ZERO" });
        }}
        onClose={() => setIsCalibrationOpen(false)}
        onSaveCalibration={(next) => setCalibration(next)}
      />

      <SmartwatchMiniApp
        isOpen={isWatchModalOpen}
        onClose={() => setIsWatchModalOpen(false)}
        liveSnapshot={liveWatchSnapshot}
      />

      <BleHeartRateModal
        isOpen={isBleHrModalOpen}
        onClose={() => setIsBleHrModalOpen(false)}
      />
    </div>
  );
}
