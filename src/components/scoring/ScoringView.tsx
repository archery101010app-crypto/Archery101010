"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile } from "@/lib/authService";
import { saveLocalSession, generateResilientId, addToSyncQueue, getLocalSetting, deleteLocalSession, sanitizeForFirestore } from "@/lib/db/indexedDB";
import { runSync } from "@/lib/db/syncManager";
import FloatingClock from "./FloatingClock";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Target, Keyboard, Save, SkipForward, ArrowRight, MessageSquare, Maximize2, Undo2, Share2, Crosshair, Camera, Sparkles, Compass, X, Clock, Watch } from "lucide-react";
import confetti from "canvas-confetti";
import { calculateDispersionAnalysis, DispersionAnalysis, getConvexHull } from "@/lib/scoring/dispersionAnalytics";
import { shareTargetShotChart, shareScorecardWhatsAppNative, ShareTargetResult } from "@/lib/scoring/targetImageGenerator";
import * as biometricsEngine from "@/lib/scoring/biometricsEngine";
import {
  BiometricSessionSnapshot,
  calculateHaversineMeters,
  calculateActiveKcal,
  calculateArcheryKcal,
  estimateDistanceFromSteps,
  formatKmAndMiles,
  parseBowPoundageLbs,
  parseAthleteWeightKg,
  publishWatchState,
  subscribeWatchMessages
} from "@/lib/scoring/biometricsEngine";
import SmartwatchMiniApp from "@/components/watch/SmartwatchMiniApp";
import StravaShareModal from "./StravaShareModal";
import { triggerHaptic } from "@/lib/haptics";
import { useWakeLock } from "@/lib/useWakeLock";
import { playRealisticMechanicalClockClick } from "@/lib/soundUtils";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { showOledAlert, showOledConfirm } from "@/lib/oledDialog";

interface ScoringViewProps {
  user: UserProfile;
  config: any; // configurations from SessionConfigView
  onBack: () => void;
  onSessionSaved: () => void;
}

interface EndData {
  arrows: Array<string>; // "X", "10", "9", "8", ..., "1", "M"
  note: string;
}

interface ShotImpact {
  endIdx: number;
  arrowIdx: number;
  x: number; // percentage width of SVG
  y: number; // percentage height of SVG
  value: string;
}

export interface RingConfig {
  r: number;       // relative radius (0 to 50)
  v: string;       // value (X, 10, 9, 8...)
  fill: string;    // background color
  stroke: string;  // border color
  lbl?: string;    // label
}

export const DIANA_PRESETS: Record<string, RingConfig[]> = {
  // Diana oficial WA completa (10 a 1) para Recurvo y Barebow outdoor (30m, 50m, 60m, 70m)
  WA_10_122: [
    { r: 48, v: "1", fill: "#FFFFFF", stroke: "#E2E8F0" },
    { r: 43.2, v: "2", fill: "#FFFFFF", stroke: "#E2E8F0" },
    { r: 38.4, v: "3", fill: "#000000", stroke: "#404040" },
    { r: 33.6, v: "4", fill: "#000000", stroke: "#404040" },
    { r: 28.8, v: "5", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 24, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 19.2, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 14.4, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 9.6, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.8, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 2.4, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ],
  // Diana Recurvo 18m: borra la línea del 5, 4, 3, 2, 1 (anillos 6 al 10 + X, 10 reglamentario 4cm)
  WA_RECURVE_18: [
    { r: 48.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 38.4, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 28.8, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 19.2, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 9.6, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.8, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ],
  // Diana Compuesto 50m: de la línea del 5 hacia adentro (elimina 4, 3, 2, 1)
  WA_COMPOUND_50: [
    { r: 48.0, v: "5", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 40.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 32.0, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 24.0, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 16.0, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 8.0, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.0, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ],
  // Diana Compuesto 18m Vegas 300: anillos 6 al 10 + X (10 completo, elimina 5, 4, 3, 2, 1)
  VEGAS_300: [
    { r: 48.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 38.4, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 28.8, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 19.2, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 9.6, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.8, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ],
  // Diana Compuesto 18m WA 300: NUEVA diana oficial World Archery con el 10 más pequeño
  // Según reglamento WA: sólo el anillo interior de 2cm es 10 (radio 4.8). El resto del anillo amarillo (radio 9.6) puntúa 9.
  WA_300_COMPOUND: [
    { r: 48.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 38.4, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 28.8, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 19.2, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 9.6, v: "9", fill: "#FDD835", stroke: "#B45309" }, // Línea intermedia en amarillo, cuenta como 9
    { r: 4.8, v: "10", fill: "#FDD835", stroke: "#171717" }, // 10 oficial WA Compuesto (radio 4.8, 2cm de diámetro)
    { r: 2.4, v: "X", fill: "#FDD835", stroke: "#171717" }   // X oficial WA Compuesto (radio 2.4)
  ],
  // Aliases de compatibilidad retroactiva
  WA_COMPOUND_18: [
    { r: 48.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 38.4, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 28.8, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 19.2, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 9.6, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.8, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ],
  WA_6c: [
    { r: 48.0, v: "5", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 40.0, v: "6", fill: "#1E88E5", stroke: "#1565C0" },
    { r: 32.0, v: "7", fill: "#E53935", stroke: "#C62828" },
    { r: 24.0, v: "8", fill: "#E53935", stroke: "#C62828" },
    { r: 16.0, v: "9", fill: "#FDD835", stroke: "#F57F17" },
    { r: 8.0, v: "10", fill: "#FDD835", stroke: "#F57F17" },
    { r: 4.0, v: "X", fill: "#FDD835", stroke: "#F57F17" }
  ]
};

export function getDianaPresetKey(
  bowType?: string,
  distance?: number,
  format?: string,
  targetType?: string
): string {
  // 1. Compuesto (Compound)
  if (bowType === "Compound") {
    if (distance === 18 || format === "WA 300" || format === "Vegas 300" || format === "Indoor 300") {
      if (format === "Vegas 300" || targetType === "Vegas 300") {
        return "VEGAS_300";
      }
      // Por defecto para Compuesto 18m / WA 300: Diana oficial WA con 10 pequeño (Reglamento World Archery)
      return "WA_300_COMPOUND";
    }
    // Compuesto 50m y exteriores: de la línea del 5 hacia adentro (elimina 4, 3, 2, 1)
    return "WA_COMPOUND_50";
  }

  // 2. Recurvo (Recurve)
  if (bowType === "Recurve") {
    // En recurvo 18mts: borra la línea del 5, 4, 3, 2, 1 (anillos 6 al 10 + X)
    if (distance === 18 || format === "WA 300" || format === "Vegas 300" || format === "Indoor 300") {
      return "WA_RECURVE_18";
    }
    return "WA_10_122";
  }

  // 3. Barebow y otros
  if (distance === 18 && (format === "WA 300" || format === "Vegas 300" || format === "Indoor 300")) {
    return "WA_RECURVE_18";
  }

  return "WA_10_122";
}

export default function ScoringView({ user, config, onBack, onSessionSaved }: ScoringViewProps) {
  const { t } = useLanguage();
  useWakeLock(true); // Keep display awake during active shooting session
  const isBlockFormat = config.format === "WA 600" || config.format === "WA 720";

  const presetType = useMemo(() => {
    return getDianaPresetKey(config.bowType, config.distance, config.format, config.targetType);
  }, [config.bowType, config.distance, config.format, config.targetType]);

  const presetRings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;

  // Touch magnifier states & refs
  interface LupaState {
    active: boolean;
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    value: string;
  }

  const [lupaState, setLupaState] = useState<LupaState>({
    active: false,
    x: 50,
    y: 50,
    clientX: 0,
    clientY: 0,
    value: ""
  });
  const [estaScrolleando, setEstaScrolleando] = useState(false);
  const [animatingValue, setAnimatingValue] = useState<{ value: string; id: number } | null>(null);

  // Auto-clear shot value pop animation after 800ms
  useEffect(() => {
    if (!animatingValue) return;
    const timer = setTimeout(() => {
      setAnimatingValue(null);
    }, 800);
    return () => clearTimeout(timer);
  }, [animatingValue]);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lupaTimer = useRef<NodeJS.Timeout | null>(null);
  const estaScrolleandoRef = useRef(false);

  // Mode state: Target (Diana) vs Keyboard (Teclado)
  const [mode, setMode] = useState<"TARGET" | "KEYBOARD">("TARGET");
  
  // Floating clock synchronization states
  const [clockDisabled, setClockDisabled] = useState(false);
  const [clockTimeStr, setClockTimeStr] = useState("");
  const [clockPhase, setClockPhase] = useState<"prep" | "shoot" | "stop" | null>(null);
  const [clockIsOver, setClockIsOver] = useState(false);
  const [clockIsWarn, setClockIsWarn] = useState(false);

  // Scoring data states
  const [ends, setEnds] = useState<EndData[]>([]);
  const [currentEndIdx, setCurrentEndIdx] = useState(0);
  const [currentArrowIdx, setCurrentArrowIdx] = useState(0);
  const [editingArrowSlot, setEditingArrowSlot] = useState<number | null>(null);
  const [impacts, setImpacts] = useState<ShotImpact[]>([]);

  // Exit states
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [fontSize, setFontSize] = useState("normal");

  // Volume Confirmation States
  const [isConfirmingVolume, setIsConfirmingVolume] = useState(false);
  const [confirmedVolume, setConfirmedVolume] = useState(0);
  const [saveType, setSaveType] = useState<"full" | "partial">("full");

  // Tally Counter State for Volume session
  const [tallyCount, setTallyCount] = useState(0);

  // Synchronous refs so rapid or queued watch commands in the same JS tick never read stale state
  const endsRef = useRef<EndData[]>(ends);
  endsRef.current = ends;
  const currentEndIdxRef = useRef<number>(currentEndIdx);
  currentEndIdxRef.current = currentEndIdx;
  const currentArrowIdxRef = useRef<number>(currentArrowIdx);
  currentArrowIdxRef.current = currentArrowIdx;
  const editingArrowSlotRef = useRef<number | null>(editingArrowSlot);
  editingArrowSlotRef.current = editingArrowSlot;
  const tallyCountRef = useRef<number>(tallyCount);
  tallyCountRef.current = tallyCount;

  // Notes state
  const [endNote, setEndNote] = useState("");
  const [sessionNote, setSessionNote] = useState("");
  const [isFinishing, setIsFinishing] = useState(false); // Session summary modal state
  const [showDispersionDrawer, setShowDispersionDrawer] = useState(false); // Modal de Clics de Mira & Agrupación
  const [dispersionScope, setDispersionScope] = useState<"END" | "GLOBAL">("GLOBAL");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [stravaSharePreview, setStravaSharePreview] = useState<ShareTargetResult | null>(null);

  // Biometric GPS Distance + Active Kcal + Open Smartwatch Companion states
  const [gpsDistanceM, setGpsDistanceM] = useState<number>(
    () => Number(config?.gpsDistanceM) || Number(config?.distanceWalkedM) || 0
  );
  const [gpsActive, setGpsActive] = useState<boolean>(false);
  const [autoDetectEnabled, setAutoDetectEnabled] = useState<boolean>(
    config?.practiceType === "Volumen"
  );
  const [isWatchModalOpen, setIsWatchModalOpen] = useState<boolean>(false);
  const [watchVolumeScore, setWatchVolumeScore] = useState<number>(0);
  const watchFinishedSessionRef = useRef<boolean>(false);
  const lastGpsCoordRef = useRef<{ lat: number; lon: number; time: number } | null>(null);
  const gpsDistanceAccumRef = useRef<number>(
    Number(config?.gpsDistanceM) || Number(config?.distanceWalkedM) || 0
  );
  const stepsCountRef = useRef<number>(
    Number(config?.stepsCount) || Number(config?.biometrics?.stepsCount) || 0
  );
  const lastStepTimeRef = useRef<number>(0);
  const isClosingSessionRef = useRef<boolean>(false);

  const stopNativeLocationTracking = () => {
    try {
      if (typeof window !== "undefined" && (window as any).ArcheryLocationNativeBridge?.stopSessionTracking) {
        (window as any).ArcheryLocationNativeBridge.stopSessionTracking();
      }
    } catch {}
  };

  // Refs
  const dianaRef = useRef<SVGSVGElement | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);

  // Live Session GPS + Real Walking Movement Tracker (starts on "Comenzar entrenamiento", stops when session ends)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const initialMeters = Number(config?.gpsDistanceM) || Number(config?.distanceWalkedM) || 0;
    const initialSteps = Number(config?.stepsCount) || Number(config?.biometrics?.stepsCount) || 0;
    gpsDistanceAccumRef.current = Math.max(gpsDistanceAccumRef.current, initialMeters);
    stepsCountRef.current = Math.max(stepsCountRef.current, initialSteps);
    const hasNativeBridge = Boolean((window as any).ArcheryLocationNativeBridge?.startSessionTracking);

    // 1. Register callback from Native Android LocationManager + Accelerometer Step Fusion
    const handleNativeLocationUpdate = (meters: number, isGpsLocked: boolean, nativeSteps?: number) => {
      if (typeof nativeSteps === "number" && !isNaN(nativeSteps)) {
        stepsCountRef.current = Math.max(stepsCountRef.current, nativeSteps);
      }
      if (typeof meters === "number" && !isNaN(meters)) {
        gpsDistanceAccumRef.current = Math.max(gpsDistanceAccumRef.current, meters);
      }
      const stepDistM = estimateDistanceFromSteps(stepsCountRef.current, user.physicalData?.height);
      const effectiveDistM = Math.max(gpsDistanceAccumRef.current, stepDistM);
      setGpsDistanceM((curr) => Math.max(curr, effectiveDistM));
      setGpsActive(Boolean(isGpsLocked));
    };
    (window as any).__onNativeMovementUpdate = handleNativeLocationUpdate;
    (window as any).__onNativeLocationUpdate = handleNativeLocationUpdate;

    if (hasNativeBridge) {
      try {
        (window as any).ArcheryLocationNativeBridge.startSessionTracking(initialMeters);
      } catch (e) {
        console.warn("Native session location bridge start error:", e);
      }
    }

    // 2. Also run Web Geolocation + Web DeviceMotion step cadence for web/PWA browsers
    let watchId: number | null = null;
    let smoothedMag = 9.81;

    if (!hasNativeBridge && typeof navigator !== "undefined" && "geolocation" in navigator) {
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (typeof accuracy === "number" && accuracy > 35) {
              return;
            }
            setGpsActive(true);
            const now = Date.now();
            const prev = lastGpsCoordRef.current;
            if (prev) {
              const delta = calculateHaversineMeters(prev.lat, prev.lon, latitude, longitude);
              const dtSec = Math.max(0.3, (now - prev.time) / 1000);
              const speed = delta / dtSec;
              if (delta > 50 || speed > 8.5) {
                lastGpsCoordRef.current = { lat: latitude, lon: longitude, time: now };
                return;
              }
              const minDelta = Math.max(1.5, (accuracy || 6) * 0.22);
              if (delta >= minDelta) {
                gpsDistanceAccumRef.current += delta;
                const stepDistM = estimateDistanceFromSteps(stepsCountRef.current, user.physicalData?.height);
                const nextDistM = Math.max(gpsDistanceAccumRef.current, stepDistM);
                setGpsDistanceM((curr) => Math.max(curr, nextDistM));
                lastGpsCoordRef.current = { lat: latitude, lon: longitude, time: now };
              }
            } else {
              lastGpsCoordRef.current = { lat: latitude, lon: longitude, time: now };
            }
          },
          () => {},
          {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 15000
          }
        );
      } catch {}
    }

    const handleMotion = (ev: DeviceMotionEvent) => {
      if (hasNativeBridge) return; // Native bridge already handles accelerometer + GPS fusion
      const acc = ev.accelerationIncludingGravity;
      if (!acc) return;
      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      const dynamicLinear = mag - smoothedMag;
      smoothedMag = 0.96 * smoothedMag + 0.04 * mag;
      const now = Date.now();
      if (dynamicLinear >= 1.15 && dynamicLinear <= 14.0 && now - lastStepTimeRef.current > 350) {
        lastStepTimeRef.current = now;
        stepsCountRef.current += 1;
        const estFromSteps = estimateDistanceFromSteps(stepsCountRef.current, user.physicalData?.height);
        const nextDistM = Math.max(gpsDistanceAccumRef.current, estFromSteps);
        setGpsDistanceM((curr) => Math.max(curr, nextDistM));
      }
    };

    if (!hasNativeBridge && "DeviceMotionEvent" in window) {
      window.addEventListener("devicemotion", handleMotion);
    }

    // Stop measuring immediately when the training session ends or exits
    return () => {
      stopNativeLocationTracking();
      if (watchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {}
      }
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, []);

  // Intercept Android hardware back button so the archer does not accidentally exit an active scoring session
  useEffect(() => {
    return registerModalDismiss(() => setIsExitModalOpen(true));
  }, []);

  useEffect(() => {
    if (isExitModalOpen) {
      return registerModalDismiss(() => setIsExitModalOpen(false));
    }
  }, [isExitModalOpen]);

  useEffect(() => {
    if (isFinishing) {
      return registerModalDismiss(() => setIsFinishing(false));
    }
  }, [isFinishing]);

  useEffect(() => {
    if (showDispersionDrawer) {
      return registerModalDismiss(() => setShowDispersionDrawer(false));
    }
  }, [showDispersionDrawer]);

  useEffect(() => {
    if (isWatchModalOpen) {
      return registerModalDismiss(() => setIsWatchModalOpen(false));
    }
  }, [isWatchModalOpen]);

  // Keep endNote synchronized with the currently selected End
  useEffect(() => {
    setEndNote(ends[currentEndIdx]?.note || "");
    setEditingArrowSlot(null);
  }, [currentEndIdx]);

  // Load settings and restore draft if applicable on mount
  useEffect(() => {
    isClosingSessionRef.current = false;

    async function loadInitialSettings() {
      const size = await getLocalSetting<string>("font_size_scoring", "normal");
      setFontSize(size);
    }
    loadInitialSettings();

    if (config.isDraft) {
      setEnds(config.ends);
      setImpacts(config.impacts || []);
      setSessionNote(config.sessionNote || "");
      const savedSteps = Number(config.stepsCount) || Number(config.biometrics?.stepsCount) || 0;
      if (savedSteps > 0) {
        stepsCountRef.current = Math.max(stepsCountRef.current, savedSteps);
      }
      const savedDist =
        typeof config.gpsDistanceM === "number" && config.gpsDistanceM > 0
          ? config.gpsDistanceM
          : typeof config.distanceWalkedM === "number" && config.distanceWalkedM > 0
            ? config.distanceWalkedM
            : typeof config.biometrics?.distanceWalkedM === "number" && config.biometrics.distanceWalkedM > 0
              ? config.biometrics.distanceWalkedM
              : 0;
      if (savedDist > 0) {
        gpsDistanceAccumRef.current = Math.max(gpsDistanceAccumRef.current, savedDist);
        setGpsDistanceM(savedDist);
      }
      
      // Calculate first empty cell to focus on
      let targetEnd = 0;
      let targetArrow = 0;
      let foundEmpty = false;
      
      for (let e = 0; e < config.endsCount; e++) {
        const arr = config.ends[e]?.arrows || [];
        for (let a = 0; a < config.arrowsPerEnd; a++) {
          if (arr[a] === "" || arr[a] === undefined) {
            targetEnd = e;
            targetArrow = a;
            foundEmpty = true;
            break;
          }
        }
        if (foundEmpty) break;
      }
      
      if (!foundEmpty) {
        targetEnd = config.endsCount - 1;
        targetArrow = config.arrowsPerEnd - 1;
      }
      
      setCurrentEndIdx(targetEnd);
      setCurrentArrowIdx(targetArrow);
    } else {
      const initialEnds = Array.from({ length: config.endsCount }, () => ({
        arrows: Array.from({ length: config.arrowsPerEnd }, () => ""),
        note: ""
      }));
      setEnds(initialEnds);
    }
  }, [config]);

  // Synchronize tallyCount when ends state is loaded or updated
  useEffect(() => {
    if (config.practiceType === "Volumen" && ends.length > 0) {
      const shotCount = ends.reduce((sum, e) => sum + e.arrows.filter(a => a !== "").length, 0);
      setTallyCount(shotCount);
    }
  }, [ends, config.practiceType]);

  // Sum total score
  const getScoreValue = (val: string): number => {
    if (val === "X" || val === "10") return 10;
    if (val === "M" || val === "") return 0;
    return Number(val) || 0;
  };

  const calculateTotalScore = (): number => {
    let sum = 0;
    ends.forEach((e) => {
      e.arrows.forEach((a) => {
        sum += getScoreValue(a);
      });
    });
    return sum;
  };

  // Real-time Biometric Calculations: Walking Distance (GPS + Fallback) & Active Kcal (Bow Draw + Walking)
  const totalShotArrows = useMemo(() => {
    if (config.practiceType === "Volumen") return tallyCount;
    return ends.reduce((sum, e) => sum + e.arrows.filter((a) => a !== "").length, 0);
  }, [config.practiceType, tallyCount, ends]);

  const completedEndsCount = useMemo(() => {
    return ends.filter(
      (e) => e.arrows.length > 0 && e.arrows.every((a) => a !== "" && a !== undefined)
    ).length;
  }, [ends]);

  // Real-time Biometric Distance: 100% real movement during active session (never derived from arrow ends)
  const distanceWalkedM = useMemo(() => {
    return Math.max(0, Math.round(gpsDistanceM));
  }, [gpsDistanceM]);

  const bowPoundageLbs = useMemo(() => {
    return parseBowPoundageLbs(user, config?.bowPoundageLbs);
  }, [user, config?.bowPoundageLbs]);

  const athleteWeightKg = useMemo(() => {
    return parseAthleteWeightKg(user);
  }, [user]);

  const activeKcal = useMemo(() => {
    return calculateActiveKcal({
      arrowsCount: totalShotArrows + (Number(config.warmupArrows) || 0),
      distanceWalkedM,
      bowPoundageLbs,
      athleteWeightKg
    });
  }, [totalShotArrows, config.warmupArrows, distanceWalkedM, bowPoundageLbs, athleteWeightKg]);

  // Stable active session ID per session + separate physical watch arrow counter for scored rounds
  const activeSessionIdRef = useRef<string>(
    config.draftId || config.id || generateResilientId("SES")
  );
  const [watchPhysicalArrows, setWatchPhysicalArrows] = useState<number>(0);
  const watchPhysicalArrowsRef = useRef<number>(0);
  const endNoteRef = useRef<string>(endNote);
  endNoteRef.current = endNote;

  useEffect(() => {
    if (config.draftId || config.id) {
      activeSessionIdRef.current = config.draftId || config.id;
    }
  }, [config.draftId, config.id]);

  // Initialize phone-watch cloud pairing code dynamically if exported by biometricsEngine
  useEffect(() => {
    if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") return;
    try {
      (biometricsEngine as any).getOrCreatePhoneWatchPairingCode?.(user.uid);
    } catch {
      // Ignore if cloud pairing helper is unavailable or offline
    }
  }, [user?.uid]);

  const liveWatchSnapshot = useMemo<BiometricSessionSnapshot>(() => {
    const currentArrows = (ends[currentEndIdx]?.arrows || []).filter(
      (a) => a !== "" && a !== undefined
    );
    const effectiveWatchArrows =
      config.practiceType === "Volumen"
        ? tallyCount
        : Math.max(totalShotArrows, watchPhysicalArrows);
    return {
      sessionId: activeSessionIdRef.current,
      sessionActive: true,
      arrowsCount: effectiveWatchArrows,
      totalScore: config.practiceType === "Volumen" ? watchVolumeScore : calculateTotalScore(),
      distanceM: Number(config.distance) || 18,
      arrowsPerEnd: Number(config.arrowsPerEnd) || 6,
      endsCount: Number(config.endsCount) || 12,
      completedEnds: completedEndsCount,
      currentEndIndex: currentEndIdx,
      currentEndArrows: currentArrows,
      stepsCount: stepsCountRef.current,
      gpsDistanceM: Math.round(gpsDistanceM),
      distanceWalkedM,
      gpsActive,
      activeKcal,
      bowPoundageLbs,
      practiceType: config.practiceType || "Práctica",
      bowType: config.bowType || user.bowConfig?.type || "Recurve",
      autoDetectEnabled,
      updatedAt: Date.now()
    };
  }, [
    config.draftId,
    config.id,
    user.uid,
    tallyCount,
    totalShotArrows,
    watchPhysicalArrows,
    watchVolumeScore,
    ends,
    config.distance,
    config.arrowsPerEnd,
    config.endsCount,
    completedEndsCount,
    currentEndIdx,
    gpsDistanceM,
    distanceWalkedM,
    gpsActive,
    activeKcal,
    bowPoundageLbs,
    config.practiceType,
    config.bowType,
    user.bowConfig?.type,
    autoDetectEnabled
  ]);

  const publishResetWatchState = () => {
    watchPhysicalArrowsRef.current = 0;
    setWatchPhysicalArrows(0);
    publishWatchState({
      ...liveWatchSnapshot,
      sessionId: "",
      sessionActive: false,
      arrowsCount: 0,
      totalScore: 0,
      completedEnds: 0,
      currentEndIndex: 0,
      currentEndArrows: [],
      updatedAt: Date.now()
    });
  };

  // Publish live state to Open Smartwatch Companion (Wear OS, Garmin IQ, /watch)
  useEffect(() => {
    if (watchFinishedSessionRef.current || isClosingSessionRef.current) return;
    publishWatchState(liveWatchSnapshot);
  }, [liveWatchSnapshot]);

  // Autoguardado en caliente instantáneo (0ms Local-First + Real-Time Turbo Sync) tras cada tiro o cambio de notas
  useEffect(() => {
    if (isClosingSessionRef.current) return;
    if (ends.length === 0) return;

    // Evitamos autoguardar si es el estado inicial vacío
    const hasAnyShot = ends.some((e) => e.arrows.some((a) => a !== ""));
    if (!hasAnyShot && impacts.length === 0 && tallyCount === 0) return;

    const autoSave = async () => {
      if (isClosingSessionRef.current) return;
      const sessionId = config.draftId || config.id || `SES-DRAFT-${user.uid}`;
      const nowTs = Date.now();
      const draftObj = sanitizeForFirestore({
        id: sessionId,
        userId: user.uid,
        userName: user.fullName || user.nickname || "Arquero",
        clubId: user.clubId || null,
        timestamp: config.timestamp || nowTs,
        updatedAt: nowTs,
        practiceType: config.practiceType || "Práctica",
        bowType: config.bowType || "Recurve",
        distance: Number(config.distance) || 18,
        format: config.format || "Libre",
        endsCount: Math.min(100, Number(config.endsCount) || 10),
        arrowsPerEnd: Math.min(20, Number(config.arrowsPerEnd) || 3),
        maxScore: Math.min(2000, Number(config.maxScore) || 300),
        score: config.practiceType === "Volumen" ? 0 : Math.min(2000, calculateTotalScore()),
        isVolumeOnly: config.practiceType === "Volumen",
        totalArrowsVolume: config.practiceType === "Volumen" ? tallyCount : totalShotArrows,
        distanceWalkedM,
        gpsDistanceM: Math.round(gpsDistanceM),
        stepsCount: stepsCountRef.current,
        activeKcal,
        bowPoundageLbs,
        biometrics: {
          activeKcal,
          distanceWalkedM,
          stepsCount: stepsCountRef.current
        },
        ends: ends.slice(0, 100),
        sessionNote: sessionNote || "",
        impacts: impacts.slice(0, 500),
        isDraft: true
      });

      try {
        if (isClosingSessionRef.current) return;
        // 1. Instant 0ms local IndexedDB write (Offline-First safety shield)
        await saveLocalSession(sessionId, draftObj);

        if (isClosingSessionRef.current) return;
        // 2. Real-Time Turbo Sync: push live arrow telemetry immediately to Firestore (coalesced)
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "UPDATE",
          payloadId: sessionId,
          payload: draftObj,
          timestamp: nowTs
        });
      } catch (err) {
        console.error("Hot autosave failed", err);
      }
    };

    autoSave();
  }, [ends, impacts, sessionNote, tallyCount, distanceWalkedM, activeKcal]);

  // Scroll active row into view in keyboard table
  useEffect(() => {
    if (tableContainerRef.current && mode === "KEYBOARD") {
      const container = tableContainerRef.current;
      const activeRow = container.querySelector(`tr[data-active="true"]`);
      if (activeRow) {
        activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [currentEndIdx, mode]);

  const calculateEndTotal = (endIdx: number): number => {
    if (!ends[endIdx]) return 0;
    return ends[endIdx].arrows.reduce((sum, val) => sum + getScoreValue(val), 0);
  };

  const calculateRunningTotal = (endIdx: number): number => {
    let runningSum = 0;
    for (let i = 0; i <= endIdx; i++) {
      runningSum += calculateEndTotal(i);
    }
    return runningSum;
  };

  // Verifica si el end actual tiene todas sus flechas anotadas
  const isCurrentEndComplete = useMemo(() => {
    const curEnd = ends[currentEndIdx];
    if (!curEnd || !curEnd.arrows || curEnd.arrows.length === 0) return false;
    return (
      curEnd.arrows.length === config.arrowsPerEnd &&
      curEnd.arrows.every((a) => a !== "" && a !== undefined)
    );
  }, [ends, currentEndIdx, config.arrowsPerEnd]);

  // Keyboard tactile touch event handler
  const handleScoreInput = (
    value: string,
    fromTargetShot: boolean = false,
    fromWatch: boolean = false
  ) => {
    const liveEnds = endsRef.current;
    const startEndIdx = currentEndIdxRef.current;
    const startArrowIdx = currentArrowIdxRef.current;
    const activeEditSlot = fromWatch ? null : editingArrowSlotRef.current;

    if (startEndIdx >= config.endsCount) return;

    let targetEndIdx = startEndIdx;
    let targetArrowIdx = startArrowIdx;

    // Si el end ya tiene todas las flechas registradas:
    // - desde el reloj (fromWatch): avanzar automáticamente al siguiente end para no perder ningún tiro
    // - desde pantalla táctil sin casilla en edición: bloquear hasta confirmar end
    const currentEnd = liveEnds[targetEndIdx];
    const isEndFull =
      currentEnd &&
      currentEnd.arrows.length === config.arrowsPerEnd &&
      currentEnd.arrows.every((a) => a !== "" && a !== undefined);

    if (isEndFull && activeEditSlot === null) {
      if (fromWatch && targetEndIdx < config.endsCount - 1) {
        targetEndIdx = targetEndIdx + 1;
        targetArrowIdx = 0;
        currentEndIdxRef.current = targetEndIdx;
        setCurrentEndIdx(targetEndIdx);
      } else {
        return;
      }
    } else if (fromWatch) {
      const targetArr = liveEnds[targetEndIdx]?.arrows || [];
      if (targetArr[targetArrowIdx] && targetArr[targetArrowIdx] !== "") {
        const emptySlot = targetArr.findIndex((a) => !a || a === "");
        if (emptySlot !== -1) {
          targetArrowIdx = emptySlot;
        }
      }
    }

    if (value === "X" || value === "10") {
      triggerHaptic("gold");
    } else if (value === "M") {
      triggerHaptic("miss");
    } else {
      triggerHaptic("arrow");
    }

    if (!fromTargetShot && value === "M") {
      setImpacts((prev) =>
        prev.filter((imp) => !(imp.endIdx === targetEndIdx && imp.arrowIdx === targetArrowIdx))
      );
    }

    const existingArrows = liveEnds[targetEndIdx]?.arrows || [];
    const updatedArrowsPreview = [...existingArrows];
    updatedArrowsPreview[targetArrowIdx] = value;

    const nextEnds = [...liveEnds];
    if (nextEnds[targetEndIdx]) {
      nextEnds[targetEndIdx] = {
        ...nextEnds[targetEndIdx],
        arrows: updatedArrowsPreview
      };
    }
    endsRef.current = nextEnds;
    setEnds(nextEnds);

    editingArrowSlotRef.current = null;
    setEditingArrowSlot(null);

    if (targetEndIdx !== startEndIdx) {
      const nextEmpty = updatedArrowsPreview.findIndex((a, idx) => idx > 0 && (!a || a === ""));
      const nextSlot = nextEmpty !== -1 ? nextEmpty : Math.min(1, config.arrowsPerEnd - 1);
      currentArrowIdxRef.current = nextSlot;
      setCurrentArrowIdx(nextSlot);
    } else {
      // Advance cell pointer index to next empty slot (sin avanzar de end automáticamente)
      advanceCell(updatedArrowsPreview, targetArrowIdx);
    }
  };

  const advanceCell = (arrowsAfterShot?: string[], fromArrowIdx?: number) => {
    const baseArrowIdx = typeof fromArrowIdx === "number" ? fromArrowIdx : currentArrowIdxRef.current;
    const arr = arrowsAfterShot || endsRef.current[currentEndIdxRef.current]?.arrows || [];
    // Seek next empty slot starting after baseArrowIdx, then wrap from 0
    for (let i = baseArrowIdx + 1; i < config.arrowsPerEnd; i++) {
      if (!arr[i] || arr[i] === "") {
        currentArrowIdxRef.current = i;
        setCurrentArrowIdx(i);
        return;
      }
    }
    for (let i = 0; i < baseArrowIdx; i++) {
      if (!arr[i] || arr[i] === "") {
        currentArrowIdxRef.current = i;
        setCurrentArrowIdx(i);
        return;
      }
    }
    if (baseArrowIdx < config.arrowsPerEnd - 1) {
      currentArrowIdxRef.current = baseArrowIdx + 1;
      setCurrentArrowIdx(baseArrowIdx + 1);
    }
  };

  const handleConfirmEnd = () => {
    const curEndIdx = currentEndIdxRef.current;
    const liveEndArrows = endsRef.current[curEndIdx]?.arrows || [];
    const liveEndComplete =
      liveEndArrows.length === config.arrowsPerEnd &&
      liveEndArrows.every((a) => a !== "" && a !== undefined);
    // Blindaje: No permitir pasar al siguiente end si no se han anotado las flechas
    if (!liveEndComplete) {
      return;
    }

    triggerHaptic("confirm");
    const noteToSave = endNoteRef.current;
    setEnds((prevEnds) => {
      const newEnds = [...prevEnds];
      if (newEnds[curEndIdx]) {
        newEnds[curEndIdx] = {
          ...newEnds[curEndIdx],
          note: noteToSave || newEnds[curEndIdx].note || "",
        };
      }
      endsRef.current = newEnds;
      return newEnds;
    });
    endNoteRef.current = "";
    setEndNote("");

    if (curEndIdx < config.endsCount - 1) {
      currentEndIdxRef.current = curEndIdx + 1;
      currentArrowIdxRef.current = 0;
      setCurrentEndIdx(curEndIdx + 1);
      setCurrentArrowIdx(0);
    } else {
      // Completed all ends, trigger session summary notes modal
      setIsFinishing(true);
    }
  };

  const handleBackspace = () => {
    const liveEnds = endsRef.current;
    const curEndIdx = currentEndIdxRef.current;
    const curArrowIdx = currentArrowIdxRef.current;
    let targetArrow = curArrowIdx;
    let targetEnd = curEndIdx;

    // Si ya completamos todos los ends y la planilla está llena, retrocedemos al último casillero
    if (curEndIdx >= config.endsCount) {
      targetEnd = config.endsCount - 1;
      targetArrow = config.arrowsPerEnd - 1;
    } else {
      // Verificamos si la celda actual tiene valor
      const currentValue = liveEnds[curEndIdx]?.arrows[curArrowIdx];
      if (currentValue !== undefined && currentValue !== "") {
        // Si no está vacía, borramos el valor actual sin mover el cursor
        targetEnd = curEndIdx;
        targetArrow = curArrowIdx;
      } else {
        // Si está vacía, retrocedemos y borramos la celda anterior
        if (curArrowIdx > 0) {
          targetArrow = curArrowIdx - 1;
        } else if (curEndIdx > 0) {
          targetEnd = curEndIdx - 1;
          targetArrow = config.arrowsPerEnd - 1;
        } else {
          return; // ya estamos en la primera celda vacía
        }
      }
    }

    currentEndIdxRef.current = targetEnd;
    currentArrowIdxRef.current = targetArrow;
    setCurrentEndIdx(targetEnd);
    setCurrentArrowIdx(targetArrow);
    triggerHaptic("undo");

    // Clear the impact marker independently (no nested setState)
    setImpacts((prev) =>
      prev.filter((imp) => !(imp.endIdx === targetEnd && imp.arrowIdx === targetArrow))
    );

    // Clear the score value in ends
    const nextEnds = liveEnds.map((e, eIdx) => {
      if (eIdx !== targetEnd) return e;
      const arrows = [...e.arrows];
      arrows[targetArrow] = "";
      return { ...e, arrows };
    });
    endsRef.current = nextEnds;
    setEnds(nextEnds);
  };

  // WhatsApp Scorecard Sharing (Strava-style Diana+Planilla Image + Clean Scorecard Text without homepage URL)
  const handleShareScorecardWhatsApp = async () => {
    setIsGeneratingImage(true);
    try {
      const totalScore = calculateTotalScore();
      const maxScore = config.maxScore || (config.endsCount * config.arrowsPerEnd * 10);
      const tens = ends.reduce((acc, e) => acc + e.arrows.filter(a => a === "10" || a === "X").length, 0);
      const xs = ends.reduce((acc, e) => acc + e.arrows.filter(a => a === "X").length, 0);
      const archerName = user.nickname || user.fullName || "Arquero";

      const result = await shareScorecardWhatsAppNative({
        impacts,
        ends,
        presetType,
        score: totalScore,
        maxScore,
        tensCount: tens,
        xsCount: xs,
        distanceM: config.distance || 70,
        bowType: config.bowType || user.bowConfig?.type || "Recurve",
        format: config.format || "World Archery",
        archerName,
        sessionNote,
        dispersion: globalDispersion,
        activeKcal,
        distanceWalkedM,
        bowPoundageLbs
      });
      setStravaSharePreview(result);
    } catch (err) {
      console.error("Error sharing WhatsApp scorecard:", err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Helper to convert client coordinates to relative SVG percent coordinates
  const getCoordsFromClient = (clientX: number, clientY: number) => {
    const svgElement = dianaRef.current;
    if (!svgElement) return null;

    const rect = svgElement.getBoundingClientRect();
    const pctX = ((clientX - rect.left) / rect.width) * 100;
    const pctY = ((clientY - rect.top) / rect.height) * 100;

    // Clamp coordinates inside diana bounds (0 to 100)
    const clampedX = Math.max(0, Math.min(100, pctX));
    const clampedY = Math.max(0, Math.min(100, pctY));

    // Calculate score value based on distance from center (50, 50)
    const dx = clampedX - 50;
    const dy = clampedY - 50;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Dynamic scoring based on presetRings
    const sortedRings = [...presetRings].sort((a, b) => a.r - b.r);
    const matchingRing = sortedRings.find((ring) => distance <= ring.r);
    const value = matchingRing ? matchingRing.v : "M";

    return { x: clampedX, y: clampedY, value };
  };

  const registerShot = (x: number, y: number, value: string) => {
    if (currentEndIdx >= config.endsCount) return;

    // Si el end actual ya está completo y el usuario NO seleccionó una casilla específica para corregir, bloquear
    const currentEnd = ends[currentEndIdx];
    const isEndFull =
      currentEnd &&
      currentEnd.arrows.length === config.arrowsPerEnd &&
      currentEnd.arrows.every((a) => a !== "" && a !== undefined);
    if (isEndFull && editingArrowSlot === null) {
      return;
    }

    const newImpact: ShotImpact = {
      endIdx: currentEndIdx,
      arrowIdx: currentArrowIdx,
      x,
      y,
      value
    };

    // Replace any existing impact for the same (endIdx, arrowIdx) so correcting an arrow never duplicates dots
    setImpacts((prev) => [
      ...prev.filter((imp) => !(imp.endIdx === currentEndIdx && imp.arrowIdx === currentArrowIdx)),
      newImpact
    ]);
    handleScoreInput(value, true);

    // Trigger pop animation
    setAnimatingValue({ value, id: Date.now() });

    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(40);
    }
  };

  const lupaStateRef = useRef(lupaState);
  useEffect(() => {
    lupaStateRef.current = lupaState;
  }, [lupaState]);

  useEffect(() => {
    const diana = dianaRef.current;
    if (!diana) return;

    const onStart = (clientX: number, clientY: number, isTouch: boolean) => {
      const currentArrows = ends[currentEndIdx]?.arrows || [];
      const actualShots = currentArrows.filter(a => a !== "").length;
      if (currentEndIdx >= config.endsCount || (actualShots >= config.arrowsPerEnd && editingArrowSlot === null)) {
        return;
      }

      touchStartX.current = clientX;
      touchStartY.current = clientY;
      estaScrolleandoRef.current = false;

      const coords = getCoordsFromClient(clientX, clientY);
      if (!coords) return;

      if (lupaTimer.current) clearTimeout(lupaTimer.current);

      lupaTimer.current = setTimeout(() => {
        if (!estaScrolleandoRef.current) {
          setLupaState({
            active: true,
            x: coords.x,
            y: coords.y,
            clientX,
            clientY,
            value: coords.value
          });
          if (navigator.vibrate) {
            navigator.vibrate(20);
          }
        }
      }, 220);
    };

    const onMove = (clientX: number, clientY: number, e: Event) => {
      const dx = clientX - touchStartX.current;
      const dy = clientY - touchStartY.current;

      if (!lupaStateRef.current.active && Math.sqrt(dx * dx + dy * dy) > 10) {
        estaScrolleandoRef.current = true;
        if (lupaTimer.current) {
          clearTimeout(lupaTimer.current);
          lupaTimer.current = null;
        }
      }

      if (lupaStateRef.current.active || lupaTimer.current) {
        if (e.cancelable) {
          e.preventDefault();
        }

        const coords = getCoordsFromClient(clientX, clientY);
        if (coords) {
          setLupaState(prev => {
            if (!prev.active) return prev;
            return {
              ...prev,
              x: coords.x,
              y: coords.y,
              clientX,
              clientY,
              value: coords.value
            };
          });
        }
      }
    };

    const onEnd = (clientX: number, clientY: number, e: Event) => {
      if (lupaTimer.current) {
        clearTimeout(lupaTimer.current);
        lupaTimer.current = null;
      }

      const active = lupaStateRef.current.active;
      const x = lupaStateRef.current.x;
      const y = lupaStateRef.current.y;
      const value = lupaStateRef.current.value;

      if (active) {
        registerShot(x, y, value);
        setLupaState({ active: false, x: 50, y: 50, clientX: 0, clientY: 0, value: "" });
        if (e.cancelable) e.preventDefault();
      } else if (!estaScrolleandoRef.current) {
        const coords = getCoordsFromClient(clientX, clientY);
        if (coords) {
          registerShot(coords.x, coords.y, coords.value);
        }
        if (e.cancelable) e.preventDefault();
      }
    };

    // Touch Event Handlers
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      onStart(touch.clientX, touch.clientY, true);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      onMove(touch.clientX, touch.clientY, e);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      onEnd(touch.clientX, touch.clientY, e);
    };

    // Mouse Event Handlers
    const handleMouseDown = (e: MouseEvent) => {
      onStart(e.clientX, e.clientY, false);
      
      const handleMouseMove = (mvEvent: MouseEvent) => {
        onMove(mvEvent.clientX, mvEvent.clientY, mvEvent);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        onEnd(upEvent.clientX, upEvent.clientY, upEvent);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };

    diana.addEventListener("touchstart", handleTouchStart, { passive: false });
    diana.addEventListener("touchmove", handleTouchMove, { passive: false });
    diana.addEventListener("touchend", handleTouchEnd, { passive: false });
    diana.addEventListener("mousedown", handleMouseDown);

    return () => {
      diana.removeEventListener("touchstart", handleTouchStart);
      diana.removeEventListener("touchmove", handleTouchMove);
      diana.removeEventListener("touchend", handleTouchEnd);
      diana.removeEventListener("mousedown", handleMouseDown);
    };
  }, [mode, currentEndIdx, currentArrowIdx, editingArrowSlot, ends, config, presetRings]);

  // Keep confirmedVolume synced whenever the Finish modal opens
  useEffect(() => {
    if (isFinishing) {
      const scoredArrowsCount = ends.reduce((sum, e) => sum + e.arrows.filter((a) => a !== "").length, 0);
      const initVol =
        config.practiceType === "Volumen"
          ? tallyCount + (config.warmupArrows || 0)
          : scoredArrowsCount + (config.warmupArrows || 0);
      setConfirmedVolume(initVol);
      setSaveType("full");
    }
  }, [isFinishing, ends, tallyCount, config.practiceType, config.warmupArrows]);

  const handleSaveDraft = async () => {
    const sessionId = config.draftId || config.id || `SES-DRAFT-${user.uid}`;
    const draftObj = sanitizeForFirestore({
      id: sessionId,
      userId: user.uid,
      userName: user.fullName || user.nickname || "Arquero",
      clubId: user.clubId || null,
      timestamp: Date.now(),
      practiceType: config.practiceType || "Práctica",
      bowType: config.bowType || "Recurve",
      distance: Number(config.distance) || 18,
      format: config.format || "Libre",
      endsCount: Math.min(100, Number(config.endsCount) || 10),
      arrowsPerEnd: Math.min(20, Number(config.arrowsPerEnd) || 3),
      maxScore: Math.min(2000, Number(config.maxScore) || 300),
      score: config.practiceType === "Volumen" ? 0 : Math.min(2000, calculateTotalScore()),
      isVolumeOnly: config.practiceType === "Volumen",
      totalArrowsVolume: config.practiceType === "Volumen" ? tallyCount : totalShotArrows,
      distanceWalkedM,
      gpsDistanceM: Math.round(gpsDistanceM),
      stepsCount: stepsCountRef.current,
      activeKcal,
      bowPoundageLbs,
      biometrics: {
        activeKcal,
        distanceWalkedM,
        stepsCount: stepsCountRef.current
      },
      ends: ends.slice(0, 100),
      sessionNote: sessionNote || "",
      impacts: impacts.slice(0, 500),
      isDraft: true
    });

    try {
      await saveLocalSession(sessionId, draftObj);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "UPDATE",
        payloadId: sessionId,
        payload: draftObj,
        timestamp: Date.now()
      });
      runSync().catch(() => {});
      onBack(); // returns to Home
    } catch (err) {
      console.error("Failed to save session draft", err);
    }
  };

  const cleanupLiveDrafts = async (preserveId?: string) => {
    const draftIds = Array.from(
      new Set(
        [config.draftId, config.id, `SES-DRAFT-${user.uid}`, "SES-TEMP-DRAFT"].filter(
          (id) => Boolean(id) && id !== preserveId
        )
      )
    ) as string[];

    for (const dId of draftIds) {
      await deleteLocalSession(dId);
      if (dId.startsWith("SES-DRAFT-") || dId === config.draftId) {
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "DELETE",
          payloadId: dId,
          payload: null,
          timestamp: Date.now()
        });
      }
    }
  };

  const handleConfirmAbandon = async () => {
    isClosingSessionRef.current = true;
    publishResetWatchState();
    stopNativeLocationTracking();
    await cleanupLiveDrafts();
    onBack(); // exits to Home
  };

  const handleDiscard = handleConfirmAbandon;

  const triggerSaveFlow = (type: "full" | "partial") => {
    const scoredArrowsCount = ends.reduce((sum, e) => sum + e.arrows.filter(a => a !== "").length, 0);
    const halfEnds = Math.floor(config.endsCount / 2);
    const actualArrows = type === "partial" 
      ? ends.slice(0, halfEnds).reduce((sum, e) => sum + e.arrows.filter(a => a !== "").length, 0)
      : config.practiceType === "Volumen"
        ? tallyCount
        : scoredArrowsCount;
      
    const totalVolumeInit = actualArrows + (config.warmupArrows || 0);
    
    setSaveType(type);
    setConfirmedVolume(totalVolumeInit);
    setIsConfirmingVolume(true);
    setIsFinishing(false);
  };

  const handleFinishFirstBlockOnly = async () => {
    if (
      !(await showOledConfirm(
        "¿Deseas finalizar el entrenamiento aquí guardando únicamente el 1er Bloque (primera mitad de flechas)?"
      ))
    ) {
      return;
    }
    triggerSaveFlow("partial");
  };

  const executeSavePartialBlock = async (finalVolume: number) => {
    isClosingSessionRef.current = true;
    publishResetWatchState();
    stopNativeLocationTracking();
    await cleanupLiveDrafts();

    const halfEnds = Math.floor(config.endsCount / 2);
    const truncatedEnds = ends.slice(0, halfEnds);
    const truncatedImpacts = impacts.filter((imp) => imp.endIdx < halfEnds);
    const maxB1 = halfEnds * config.arrowsPerEnd * 10;
    
    let scoreB1 = 0;
    truncatedEnds.forEach((e) => {
      e.arrows.forEach((a) => {
        scoreB1 += getScoreValue(a);
      });
    });

    const nowTs = Date.now();
    const durationMinutes = Math.max(1, Math.round((nowTs - (config.timestamp || nowTs)) / 60000));
    const effectiveTotalVolume = Math.min(
      10000,
      typeof finalVolume === "number" && !isNaN(finalVolume) && finalVolume >= 0
        ? Math.round(finalVolume)
        : 0
    );
    const recalculatedKcal = calculateArcheryKcal({
      arrowsShot: effectiveTotalVolume,
      drawWeightLbs: bowPoundageLbs,
      distanceWalkedM,
      durationMinutes,
      archerWeightKg: user.physicalData?.weight || athleteWeightKg
    });

    const sessionId = generateResilientId("SES");
    const sessionObj = sanitizeForFirestore({
      id: sessionId,
      userId: user.uid,
      userName: user.fullName || user.nickname || "Arquero",
      clubId: user.clubId || null,
      timestamp: nowTs,
      updatedAt: nowTs,
      practiceType: config.practiceType || "Práctica",
      bowType: config.bowType || "Recurve",
      distance: Number(config.distance) || 18,
      format: `${config.format || "WA 720"} (Bloque 1)`,
      endsCount: Math.min(100, halfEnds),
      arrowsPerEnd: Math.min(20, Number(config.arrowsPerEnd) || 6),
      maxScore: Math.min(2000, maxB1),
      score: Math.min(2000, scoreB1),
      ends: truncatedEnds.slice(0, 100),
      sessionNote: sessionNote ? `${sessionNote} [Finalizado en primer bloque]` : "[Finalizado en primer bloque]",
      impacts: truncatedImpacts.slice(0, 500),
      isDraft: false,
      singleBlockSaved: true,
      totalArrowsVolume: effectiveTotalVolume,
      distanceWalkedM,
      gpsDistanceM: Math.round(gpsDistanceM),
      activeKcal: recalculatedKcal,
      bowPoundageLbs,
      biometrics: {
        activeKcal: recalculatedKcal,
        distanceWalkedM,
        stepsCount: stepsCountRef.current
      },
      blockStats: {
        b1Score: scoreB1,
        b2Score: 0,
        diff: 0,
        completedB2: false
      }
    });

    try {
      await saveLocalSession(sessionId, sessionObj);
      await cleanupLiveDrafts(sessionId);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionId,
        payload: sessionObj,
        timestamp: nowTs
      });

      // Also write directly to Firestore immediately if online
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        setDoc(doc(db, "sessions", sessionId), sessionObj, { merge: true }).catch(() => {});
      } catch (_) {}

      confetti({
        particleCount: 120,
        spread: 60,
        origin: { y: 0.8 },
        colors: ["#00E5FF", "#FFF200", "#FF3B30", "#00C853"]
      });

      try {
        const { checkAndAwardStar } = await import("@/lib/starsManager");
        await checkAndAwardStar(
          user.uid,
          user.fullName,
          config.bowType,
          config.distance,
          halfEnds,
          config.arrowsPerEnd,
          scoreB1,
          sessionId
        );
      } catch (starErr) {
        console.error("Error checking star achievements on partial block:", starErr);
      }

      runSync();
      onSessionSaved();
    } catch (err) {
      console.error("Failed to save partial block session", err);
    }
  };

  const handleFinishAndSave = async () => {
    await executeFinalSave(confirmedVolume);
  };

  const executeSaveFull = async (finalVolume: number) => {
    isClosingSessionRef.current = true;
    publishResetWatchState();
    stopNativeLocationTracking();
    await cleanupLiveDrafts();

    const isVolMode = config.practiceType === "Volumen";
    const finalScore = isVolMode ? 0 : calculateTotalScore();
    const sessionId = generateResilientId("SES");
    const halfEnds = Math.floor(config.endsCount / 2);

    let blockStats: Record<string, any> | undefined = undefined;
    if (isBlockFormat && !isVolMode) {
      let b1Score = 0;
      let b2Score = 0;
      ends.forEach((e, idx) => {
        e.arrows.forEach((a) => {
          if (idx < halfEnds) {
            b1Score += getScoreValue(a);
          } else {
            b2Score += getScoreValue(a);
          }
        });
      });
      blockStats = {
        b1Score,
        b2Score,
        diff: b2Score - b1Score,
        completedB2: true
      };
    }

    const scoredEndsList = isVolMode
      ? ends.slice(0, 100)
      : ends.filter((e) => e.arrows.some((a) => a !== "" && a !== undefined));
    const effectiveEnds = scoredEndsList.length > 0 ? scoredEndsList : ends.slice(0, 100);
    const hasExplicitFinalVolume =
      typeof finalVolume === "number" && !isNaN(finalVolume) && finalVolume >= 0;
    const effectiveTotalVolume = Math.min(
      10000,
      hasExplicitFinalVolume
        ? Math.round(finalVolume)
        : isVolMode
          ? tallyCount
          : totalShotArrows
    );
    const effectiveEndsCount = isVolMode
      ? Math.min(100, Math.ceil(effectiveTotalVolume / (config.arrowsPerEnd || 3)))
      : effectiveEnds.length;
    const effectiveMaxScore = isVolMode
      ? 0
      : totalShotArrows > 0
        ? Math.min(2000, totalShotArrows * 10)
        : Math.min(2000, effectiveEndsCount * (Number(config.arrowsPerEnd) || 3) * 10);

    const nowTs = Date.now();
    const durationMinutes = Math.max(1, Math.round((nowTs - (config.timestamp || nowTs)) / 60000));
    const recalculatedKcal = calculateArcheryKcal({
      arrowsShot: effectiveTotalVolume,
      drawWeightLbs: bowPoundageLbs,
      distanceWalkedM,
      durationMinutes,
      archerWeightKg: user.physicalData?.weight || athleteWeightKg
    });
    const rawSessionObj: Record<string, any> = {
      id: sessionId,
      userId: user.uid,
      userName: user.fullName || user.nickname || "Arquero",
      clubId: user.clubId || null,
      timestamp: nowTs,
      updatedAt: nowTs,
      practiceType: config.practiceType || "Práctica",
      bowType: config.bowType || "Recurve",
      distance: Number(config.distance) || 18,
      format: config.format || "Libre",
      endsCount: Math.min(100, effectiveEndsCount),
      arrowsPerEnd: Math.min(20, Number(config.arrowsPerEnd) || 3),
      maxScore: effectiveMaxScore,
      score: Math.min(2000, finalScore),
      ends: effectiveEnds.slice(0, 100),
      sessionNote: sessionNote || "",
      impacts: impacts.slice(0, 500),
      isDraft: false,
      isVolumeOnly: isVolMode,
      totalArrowsVolume: effectiveTotalVolume,
      distanceWalkedM,
      gpsDistanceM: Math.round(gpsDistanceM),
      activeKcal: recalculatedKcal,
      bowPoundageLbs,
      biometrics: {
        activeKcal: recalculatedKcal,
        distanceWalkedM,
        stepsCount: stepsCountRef.current
      }
    };
    if (blockStats) {
      rawSessionObj.blockStats = blockStats;
    }

    const sessionObj = sanitizeForFirestore(rawSessionObj);

    try {
      await saveLocalSession(sessionId, sessionObj);
      await cleanupLiveDrafts(sessionId);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: sessionId,
        payload: sessionObj,
        timestamp: nowTs
      });

      // Also write directly to Firestore immediately if online
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        setDoc(doc(db, "sessions", sessionId), sessionObj, { merge: true }).catch(() => {});
      } catch (_) {}

      confetti({
        particleCount: 120,
        spread: 60,
        origin: { y: 0.8 },
        colors: ["#00E5FF", "#FFF200", "#FF3B30", "#00C853"]
      });

      if (!isVolMode) {
        try {
          const { checkAndAwardStar } = await import("@/lib/starsManager");
          await checkAndAwardStar(
            user.uid,
            user.fullName,
            config.bowType,
            config.distance,
            effectiveEndsCount,
            config.arrowsPerEnd,
            finalScore,
            sessionId
          );
        } catch (starErr) {
          console.error("Error checking star achievements on full block:", starErr);
        }
      }

      runSync();
      onSessionSaved();
    } catch (err) {
      console.error("Failed to save session", err);
    }
  };

  const executeFinalSave = async (finalVolume: number) => {
    setIsConfirmingVolume(false);
    setIsFinishing(false);
    if (saveType === "partial") {
      await executeSavePartialBlock(finalVolume);
    } else {
      await executeSaveFull(finalVolume);
    }
  };

  const getArrowColorClass = (val: string) => {
    if (val === "X" || val === "10" || val === "9") return "bg-yellow-gold text-black border-yellow-gold/30";
    if (val === "8" || val === "7") return "bg-red-500 text-white border-red-500/30";
    if (val === "6" || val === "5") return "bg-blue-500 text-white border-blue-500/30";
    if (val === "4" || val === "3") return "bg-neutral-900 border-neutral-700 text-white";
    if (val === "M") return "bg-red-rival text-white border-red-rival/30";
    if (val === "") return "bg-transparent border-gray-border text-transparent";
    return "bg-white text-black border-white/20"; // 1-2 rings
  };

  // Centroid and Dispersion calculations for the current End & Full Session (Memoized for 60/120 FPS performance)
  const currentEndImpacts = useMemo(() => {
    return impacts.filter((imp) => imp.endIdx === currentEndIdx);
  }, [impacts, currentEndIdx]);

  const { centroid, dispersion, groupingHullPoints } = useMemo(() => {
    const N = currentEndImpacts.length;
    if (N < 1) return { centroid: null, dispersion: null, groupingHullPoints: null };

    const sumX = currentEndImpacts.reduce((sum, imp) => sum + imp.x, 0);
    const sumY = currentEndImpacts.reduce((sum, imp) => sum + imp.y, 0);
    const meanX = sumX / N;
    const meanY = sumY / N;
    const c = { x: meanX, y: meanY };

    if (N < 2) return { centroid: c, dispersion: null, groupingHullPoints: null };

    const hull = getConvexHull(currentEndImpacts.map((imp) => ({ x: imp.x, y: imp.y })));
    const hullPointsStr = hull.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

    // Cobertura completa de la dispersión de las flechas
    const maxDistX = Math.max(...currentEndImpacts.map((imp) => Math.abs(imp.x - meanX)));
    const maxDistY = Math.max(...currentEndImpacts.map((imp) => Math.abs(imp.y - meanY)));
    const d = {
      rx: Math.max(2.8, maxDistX + 1.2),
      ry: Math.max(2.8, maxDistY + 1.2)
    };
    return { centroid: c, dispersion: d, groupingHullPoints: hullPointsStr };
  }, [currentEndImpacts]);

  // Smart Dispersion and Sight Adjustment Analytics con dimensiones oficiales exactas
  const currentEndAnalysis = useMemo(() => {
    return calculateDispersionAnalysis(
      currentEndImpacts,
      config.distance || 70,
      config.bowType || "Recurve",
      presetType,
      config.format,
      config.targetType
    );
  }, [currentEndImpacts, config.distance, config.bowType, presetType, config.format, config.targetType]);

  const globalDispersion = useMemo(() => {
    return calculateDispersionAnalysis(
      impacts,
      config.distance || 70,
      config.bowType || "Recurve",
      presetType,
      config.format,
      config.targetType
    );
  }, [impacts, config.distance, config.bowType, presetType, config.format, config.targetType]);

  const activeAnalysis = dispersionScope === "END" ? currentEndAnalysis : globalDispersion;

  // Shot Chart Share Handler (HD Target Image with 101010 THE APP Strava watermark)
  const handleShareShotChart = async () => {
    setIsGeneratingImage(true);
    try {
      const archerName = user.nickname || user.fullName || "Arquero";
      const totalScore = calculateTotalScore();
      const tens = ends.reduce((acc, e) => acc + e.arrows.filter(a => a === "10" || a === "X").length, 0);
      const xs = ends.reduce((acc, e) => acc + e.arrows.filter(a => a === "X").length, 0);

      const result = await shareTargetShotChart({
        impacts,
        ends,
        presetType: presetType,
        score: totalScore,
        maxScore: config.maxScore,
        tensCount: tens,
        xsCount: xs,
        distanceM: config.distance || 70,
        bowType: config.bowType || "Recurve",
        format: config.format || "World Archery",
        archerName,
        sessionNote,
        dispersion: globalDispersion,
        activeKcal,
        distanceWalkedM,
        bowPoundageLbs
      });
      setStravaSharePreview(result);
    } catch (err) {
      console.error("Error sharing target shot chart:", err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const playTallyClickSound = () => {
    playRealisticMechanicalClockClick();
    triggerHaptic("tick");
  };

  const handleTallyDecrement = () => {
    const activeCount = tallyCountRef.current;
    if (activeCount <= 0) return;
    playTallyClickSound();
    const nextCount = Math.max(0, activeCount - 1);
    tallyCountRef.current = nextCount;
    setTallyCount(nextCount);

    const updatedEnds = [...endsRef.current];
    const activeEndIdx = currentEndIdxRef.current;
    const activeArrowIdx = currentArrowIdxRef.current;
    let prevArrowIdx = activeArrowIdx - 1;
    let prevEndIdx = activeEndIdx;
    if (prevArrowIdx < 0) {
      prevEndIdx = Math.max(0, activeEndIdx - 1);
      prevArrowIdx = (config.arrowsPerEnd || 3) - 1;
    }
    if (updatedEnds[prevEndIdx]) {
      const targetEnd = { ...updatedEnds[prevEndIdx] };
      const targetArrows = [...targetEnd.arrows];
      targetArrows[prevArrowIdx] = "";
      targetEnd.arrows = targetArrows;
      updatedEnds[prevEndIdx] = targetEnd;
      endsRef.current = updatedEnds;
      setEnds(updatedEnds);
    }
    currentArrowIdxRef.current = prevArrowIdx;
    currentEndIdxRef.current = prevEndIdx;
    setCurrentArrowIdx(prevArrowIdx);
    setCurrentEndIdx(prevEndIdx);
  };

  const handleTallyIncrement = () => {
    const activeEndIdx = currentEndIdxRef.current;
    const activeArrowIdx = currentArrowIdxRef.current;
    if (config.practiceType !== "Volumen" && activeEndIdx >= config.endsCount) {
      void showOledAlert("Has alcanzado el límite de ends programados. Puedes finalizar el entrenamiento o agregar más ends.");
      return;
    }
    
    playTallyClickSound();
    
    const nextCount = tallyCountRef.current + 1;
    tallyCountRef.current = nextCount;
    setTallyCount(nextCount);
    
    const updatedEnds = [...endsRef.current];
    
    // Dynamically grow the array in volume mode if the current index is out of bounds
    while (activeEndIdx >= updatedEnds.length) {
      updatedEnds.push({
        arrows: Array.from({ length: config.arrowsPerEnd || 3 }, () => ""),
        note: ""
      });
    }
    
    const currentEnd = { ...updatedEnds[activeEndIdx] };
    const currentArrows = [...currentEnd.arrows];
    
    currentArrows[activeArrowIdx] = "10";
    currentEnd.arrows = currentArrows;
    updatedEnds[activeEndIdx] = currentEnd;
    
    let nextArrowIdx = activeArrowIdx + 1;
    let nextEndIdx = activeEndIdx;
    
    if (nextArrowIdx >= config.arrowsPerEnd) {
      nextArrowIdx = 0;
      nextEndIdx = activeEndIdx + 1;
    }
    
    // Ensure the next index also exists in volume mode
    if (config.practiceType === "Volumen") {
      while (nextEndIdx >= updatedEnds.length) {
        updatedEnds.push({
          arrows: Array.from({ length: config.arrowsPerEnd || 3 }, () => ""),
          note: ""
        });
      }
    }
    
    endsRef.current = updatedEnds;
    setEnds(updatedEnds);
    currentArrowIdxRef.current = nextArrowIdx;
    currentEndIdxRef.current = nextEndIdx;
    setCurrentArrowIdx(nextArrowIdx);
    setCurrentEndIdx(nextEndIdx);
  };

  // Handle commands coming from Open Smartwatch Companion (/watch or native Wear OS / Garmin IQ)
  const handleWatchArrowDelta = (delta: number) => {
    watchFinishedSessionRef.current = false;
    if (config.practiceType === "Volumen") {
      if (delta > 0) {
        handleTallyIncrement();
      } else if (delta < 0) {
        handleTallyDecrement();
      }
    } else if (delta !== 0) {
      // Scored rounds (Control / Práctica): track physical watch arrow counter separately;
      // NEVER inject a fake "10" into scorecard ends (scores come strictly from SCORE_INPUT or phone input).
      const nextPhysical = Math.max(0, watchPhysicalArrowsRef.current + delta);
      watchPhysicalArrowsRef.current = nextPhysical;
      setWatchPhysicalArrows(nextPhysical);
      playTallyClickSound();
    }
  };

  const watchMessageHandlerRef = useRef<(msg: any) => void>(() => {});
  watchMessageHandlerRef.current = (msg: any) => {
    if (!msg || !msg.type) return;
    if (msg.type === "INCREMENT_ARROW") {
      handleWatchArrowDelta(msg.delta ?? 1);
    } else if (msg.type === "DECREMENT_ARROW") {
      if (config.practiceType === "Volumen") {
        const incomingTotal = Number(msg.payload?.totalScore ?? msg.totalScore);
        setWatchVolumeScore((prev) =>
          !isNaN(incomingTotal) && incomingTotal >= 0 ? incomingTotal : Math.max(0, prev - 10)
        );
      }
      handleWatchArrowDelta(msg.delta ?? -1);
    } else if (msg.type === "UNDO_ARROW") {
      watchFinishedSessionRef.current = false;
      if (config.practiceType === "Volumen") {
        const incomingTotal = Number(msg.payload?.totalScore ?? msg.totalScore);
        setWatchVolumeScore((prev) =>
          !isNaN(incomingTotal) && incomingTotal >= 0 ? incomingTotal : Math.max(0, prev - 10)
        );
        handleTallyDecrement();
      } else {
        const currentEndArrows = endsRef.current[currentEndIdxRef.current]?.arrows || [];
        if (currentEndArrows.some((a) => a !== "" && a !== undefined)) {
          handleBackspace();
        }
      }
    } else if (msg.type === "SCORE_INPUT") {
      watchFinishedSessionRef.current = false;
      const scoreVal = msg.payload?.value ?? msg.value;
      if (scoreVal) {
        if (config.practiceType === "Volumen") {
          const pts = getScoreValue(String(scoreVal));
          const incomingTotal = Number(msg.payload?.totalScore ?? msg.totalScore);
          setWatchVolumeScore((prev) =>
            !isNaN(incomingTotal) && incomingTotal > 0 ? incomingTotal : prev + pts
          );
          handleTallyIncrement();
        } else {
          handleScoreInput(String(scoreVal), false, true);
        }
      }
    } else if (msg.type === "NEXT_END") {
      watchFinishedSessionRef.current = false;
      const activeEndIdx = currentEndIdxRef.current;
      const activeEndArrows = endsRef.current[activeEndIdx]?.arrows || [];
      const activeEndComplete =
        activeEndArrows.length === config.arrowsPerEnd &&
        activeEndArrows.every((a) => a !== "" && a !== undefined);
      if (activeEndComplete) {
        handleConfirmEnd();
      }
    } else if (msg.type === "SYNC_TELEMETRY_FROM_WATCH") {
      const incomingSteps = Number(msg.payload?.stepsCount ?? msg.stepsCount) || 0;
      const incomingDist = Number(msg.payload?.distanceWalkedM ?? msg.distanceWalkedM) || 0;
      const nextSteps = Math.max(stepsCountRef.current, incomingSteps);
      stepsCountRef.current = nextSteps;
      const stepDistM = estimateDistanceFromSteps(nextSteps, user.physicalData?.height);
      const nextDistM = Math.max(gpsDistanceAccumRef.current, incomingDist, stepDistM);
      gpsDistanceAccumRef.current = nextDistM;
      setGpsDistanceM((curr) => Math.max(curr, nextDistM));
    } else if (msg.type === "TOGGLE_AUTO_DETECT") {
      setAutoDetectEnabled(Boolean(msg.enabled));
    } else if (msg.type === "FINISH_SESSION_FROM_WATCH") {
      watchFinishedSessionRef.current = true;
      publishResetWatchState();
      setIsWatchModalOpen(false);
      setIsFinishing(true);
    } else if (msg.type === "REQUEST_STATE") {
      if (!watchFinishedSessionRef.current && !isClosingSessionRef.current) {
        publishWatchState(liveWatchSnapshot);
      }
    }
  };

  useEffect(() => {
    const unsub = subscribeWatchMessages((msg) => {
      watchMessageHandlerRef.current(msg);
    });
    return unsub;
  }, []);

  const handleTallyReset = async () => {
    if (!(await showOledConfirm("¿Deseas reiniciar el contador de flechas a cero?"))) return;
    
    playTallyClickSound();
    tallyCountRef.current = 0;
    currentEndIdxRef.current = 0;
    currentArrowIdxRef.current = 0;
    setTallyCount(0);
    setWatchVolumeScore(0);
    setCurrentEndIdx(0);
    setCurrentArrowIdx(0);
    
    const resetEnds = endsRef.current.map(e => ({
      ...e,
      arrows: Array(config.arrowsPerEnd).fill("")
    }));
    endsRef.current = resetEnds;
    setEnds(resetEnds);
  };

  return (
    <div className="flex flex-col gap-2 py-1.5 min-h-full w-full max-w-full overflow-x-hidden">
      {/* Top Config info Header + Integrated Clock & Mode Switcher */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setIsExitModalOpen(true)}
            className="w-9 h-9 rounded-xl bg-[#0D1017] border border-white/[0.08] text-white hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h3 className="text-white text-xs sm:text-sm font-black uppercase tracking-wide truncate leading-tight">
              {config.format === "Libre" ? "Ajuste libre" : config.format} · {config.distance}m
              {presetType === "WA_300_COMPOUND" && " · 10 Oficial"}
              {presetType === "VEGAS_300" && " · Vegas 10"}
            </h3>
            <p className="text-[11px] text-white uppercase tracking-wider truncate">
              {config.practiceType === "Control" ? t("practiceControl") : config.practiceType} · {config.bowType === "Recurve" ? "Recurvo" : config.bowType === "Compound" ? "Compuesto" : config.bowType}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex bg-[#0D1017] p-0.5 rounded-xl border border-white/[0.08]">
            <button
              onClick={() => setMode("TARGET")}
              className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition ${
                mode === "TARGET" ? "bg-cyan-neon text-black" : "text-white hover:text-white"
              }`}
            >
              <Target size={15} />
            </button>
            <button
              onClick={() => setMode("KEYBOARD")}
              className={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition ${
                mode === "KEYBOARD" ? "bg-cyan-neon text-black" : "text-white hover:text-white"
              }`}
            >
              <Keyboard size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating clock controller integration (Full-screen overlay only) */}
      <FloatingClock
        arrowsPerEnd={config.arrowsPerEnd}
        onClockDisabledChange={setClockDisabled}
        onTimeUpdate={(timeStr, phase, isOver, isWarn) => {
          setClockTimeStr(timeStr);
          setClockPhase(phase);
          setClockIsOver(isOver);
          setClockIsWarn(isWarn);
        }}
      />

      {/* Unified WHOOP-Style Telemetry HUD (Score + End + Active Arrows in 1 compact block) */}
      {config.practiceType === "Volumen" ? (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl px-3.5 py-2.5 flex justify-between items-center gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[10.5px] text-white font-bold tracking-widest uppercase">
              Distancia
            </span>
            <span className="text-xl font-black text-white leading-none tabular-nums">
              {config.distance} <span className="text-xs text-white">m</span>
            </span>
          </div>
          <span className="text-[10.5px] text-cyan-neon font-black tracking-wider uppercase bg-cyan-neon/10 px-2.5 py-1 rounded-full border border-cyan-neon/25 whitespace-nowrap">
            Práctica de Volumen
          </span>
        </div>
      ) : (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl px-3 sm:px-3.5 py-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1.5 min-w-0">
            <div className="flex items-baseline gap-1.5 sm:gap-2 min-w-0">
              <span className="text-[10px] sm:text-[10.5px] text-white font-bold tracking-wider sm:tracking-widest uppercase shrink-0">
                Puntos
              </span>
              <span className="text-[19px] sm:text-[23.1px] font-black text-white leading-none tabular-nums truncate">
                {calculateTotalScore()} <span className="text-[11px] sm:text-xs text-white font-bold">/ {config.maxScore}</span>
              </span>
              {isBlockFormat && currentEndIdx >= Math.floor(config.endsCount / 2) && (
                <button
                  onClick={handleFinishFirstBlockOnly}
                  className="text-[9.5px] sm:text-[10px] font-black uppercase text-yellow-gold border border-yellow-gold/30 bg-yellow-gold/5 px-1.5 sm:px-2 py-0.5 rounded-lg hover:bg-yellow-gold/15 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  1er Bloque
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {ends.some((e) => e.arrows.some((a) => a !== "")) && (
                <button
                  type="button"
                  onClick={() => setIsFinishing(true)}
                  className="text-[9.5px] sm:text-[10px] font-black uppercase text-black bg-cyan-neon hover:bg-[#19c8ff] px-2 sm:px-2.5 py-1 rounded-full transition cursor-pointer whitespace-nowrap shadow-sm"
                >
                  Finalizar
                </button>
              )}
              <span className="text-[10px] sm:text-[10.5px] text-cyan-neon font-black tracking-wide sm:tracking-wider uppercase bg-cyan-neon/10 px-2 sm:px-2.5 py-0.5 rounded-full border border-cyan-neon/25 tabular-nums whitespace-nowrap">
                End {currentEndIdx + 1}/{config.endsCount}
              </span>
              <span className="text-[10.5px] sm:text-[11px] text-white font-bold tabular-nums whitespace-nowrap">
                Fl. {currentArrowIdx + 1}/{config.arrowsPerEnd}
              </span>
            </div>
          </div>

          {mode === "TARGET" && (
            <div className="flex justify-between items-center gap-1.5 pt-2 border-t border-white/[0.07]">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="flex flex-wrap gap-1 gap-y-1.5">
                  {ends[currentEndIdx]?.arrows.map((a, arrowIdx) => {
                    const isCellEditing = currentArrowIdx === arrowIdx;
                    return (
                      <div
                        key={arrowIdx}
                        onClick={() => {
                          setCurrentArrowIdx(arrowIdx);
                          setEditingArrowSlot(arrowIdx);
                        }}
                        className={`${config.arrowsPerEnd > 3 ? "w-7 h-7 sm:w-8 sm:h-8" : "w-8 h-8"} rounded-xl flex items-center justify-center font-black text-xs border-2 tabular-nums transition-all cursor-pointer shrink-0 ${getArrowColorClass(
                          a
                        )} ${
                          isCellEditing
                            ? "border-cyan-neon ring-1 ring-cyan-neon/40 bg-cyan-neon/10"
                            : "border-white/5 hover:border-white/20"
                        }`}
                      >
                        {a || "—"}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="px-2.5 py-1 rounded-xl bg-[#080A0F] border border-white/10 font-black text-[11.6px] text-cyan-neon shrink-0 whitespace-nowrap tabular-nums">
                End: {calculateEndTotal(currentEndIdx)} pts
              </div>
            </div>
          )}
        </div>
      )}

      {/* Biometric Telemetry Bar: Distancia Recorrida (GPS + Respaldo) + Kcal + Smartwatch Mini-App */}
      <div className="bg-[#080B10] border border-white/[0.10] rounded-2xl px-3 sm:px-3.5 py-2.5 sm:py-3 flex items-center justify-between gap-2 relative overflow-hidden">
        <div
          className="absolute top-0 left-12 right-12 h-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, #00A8F3 25%, #FF0000 50%, #FFF200 75%, transparent)"
          }}
        />
        <div className="flex items-center justify-around gap-1.5 sm:gap-2 min-w-0 flex-1">
          <div className="flex flex-col items-center justify-center text-center min-w-0 flex-1 pr-1.5 sm:pr-2 border-r border-white/10">
            <span className="text-[10px] sm:text-[11.4px] font-black uppercase tracking-wide sm:tracking-wider text-white flex items-center justify-center gap-1 leading-tight whitespace-nowrap">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  gpsActive
                    ? "bg-[#00A8F3]"
                    : "bg-[#FFF200]"
                }`}
              />
              <span className="sm:hidden">DISTANCIA</span>
              <span className="hidden sm:inline">DISTANCIA RECORRIDA</span>
            </span>
            <span className="text-[13.5px] sm:text-[16.8px] font-black text-white tabular-nums mt-0.5 sm:mt-1 leading-tight truncate max-w-full">
              {formatKmAndMiles(distanceWalkedM, false)}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center text-center min-w-0 px-1.5 sm:px-2">
            <span className="text-[10px] sm:text-[11.4px] font-black uppercase tracking-wide sm:tracking-wider text-white leading-tight whitespace-nowrap">
              KCAL
            </span>
            <span className="text-[13.5px] sm:text-[16.8px] font-black text-white tabular-nums mt-0.5 sm:mt-1 leading-tight whitespace-nowrap">
              {activeKcal} <span className="text-[12px] sm:text-[13.2px] font-black text-white">kcal</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsWatchModalOpen(true)}
          className="px-3 sm:px-3.5 py-2 rounded-xl bg-[#FFF200] hover:brightness-105 text-black font-black text-[11.5px] sm:text-[12.6px] uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer active:scale-95 transition"
        >
          <Watch size={15} className="shrink-0" />
          <span>Smartwatch</span>
        </button>
      </div>

      {/* SCORING COMPONENT MODES */}
      <div className="flex-1 flex flex-col justify-center min-h-[300px] py-1">
        {config.practiceType === "Volumen" ? (
          <div className="flex-1 w-full flex flex-col items-center justify-center gap-5 py-3">
            {/* Tally Counter Casing Container (responsive containment for 360px phones) */}
            <div className="relative flex flex-col items-center justify-center select-none mx-auto">
              {/* Metal hanger loop at the top */}
              <div
                className="w-[67px] h-[48px] -mb-2.5 rounded-t-full border-[6px] border-zinc-400 bg-transparent relative z-0 flex items-center justify-center"
                style={{
                  borderColor: "#a1a1aa",
                  boxShadow: "0 -2px 8px rgba(255,255,255,0.25), inset 0 2px 4px rgba(0,0,0,0.6)"
                }}
              >
                <div
                  className="w-[48px] h-[29px] rounded-t-full bg-zinc-900 border-2 border-zinc-600 shadow-inner"
                  style={{ backgroundColor: "#18181b", borderColor: "#52525b" }}
                />
              </div>

              {/* Reset Knob on the side (top right position) */}
              <div className="absolute right-[-32px] sm:right-[-38px] top-[52px] sm:top-[58px] z-10 flex items-center">
                <div
                  className="w-[10px] sm:w-[14px] h-[24px] bg-zinc-500 border-y border-l border-zinc-400 rounded-l shadow"
                  style={{
                    background: "linear-gradient(180deg, #d4d4d8 0%, #71717a 50%, #3f3f46 100%)",
                    borderColor: "#a1a1aa"
                  }}
                />
                <button
                  type="button"
                  onClick={handleTallyReset}
                  className="w-[36px] sm:w-[38px] h-[36px] sm:h-[38px] rounded-full bg-gradient-to-r from-zinc-300 via-white to-zinc-500 border-2 border-zinc-400 flex items-center justify-center cursor-pointer shadow-md active:rotate-180 hover:brightness-110 active:scale-95 transition-transform duration-300"
                  style={{
                    background: "radial-gradient(circle at 35% 35%, #ffffff 0%, #d4d4d8 45%, #71717a 100%)",
                    borderColor: "#a1a1aa",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.6), inset 0 2px 3px rgba(255,255,255,0.9)"
                  }}
                  title="Reiniciar contador"
                >
                  <div
                    className="w-[17px] h-[17px] rounded-full bg-zinc-700 border border-zinc-500 flex items-center justify-center font-bold text-[9.6px] text-white"
                    style={{ backgroundColor: "#27272a", borderColor: "#71717a" }}
                  >
                    R
                  </div>
                </button>
              </div>

              {/* Main counter circular 3D chrome case */}
              <button
                type="button"
                onClick={handleTallyIncrement}
                className="w-[248px] h-[248px] sm:w-[288px] sm:h-[288px] rounded-full border-[9.5px] border-zinc-300 flex flex-col items-center justify-center gap-2 sm:gap-2.5 relative z-10 cursor-pointer hover:brightness-105 active:scale-[0.97] active:translate-y-0.5 transition group"
                style={{
                  background: "radial-gradient(circle at 35% 28%, #fafafa 0%, #e4e4e7 28%, #a1a1aa 68%, #52525b 100%)",
                  borderColor: "#d4d4d8",
                  boxShadow: "0 25px 50px rgba(0,0,0,0.85), 0 8px 20px rgba(0,0,0,0.6), inset 0 6px 14px rgba(255,255,255,0.95), inset 0 -8px 16px rgba(24,24,27,0.55)"
                }}
              >
                {/* Shiny highlight reflection */}
                <div
                  className="absolute inset-2.5 rounded-full pointer-events-none"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 45%, transparent 100%)"
                  }}
                />

                {/* Lever/Button at the top center of the case */}
                <div
                  className="absolute top-[12px] sm:top-[14px] w-[104px] sm:w-[115px] h-[22px] sm:h-[24px] rounded border border-zinc-400 group-active:translate-y-1 transition"
                  style={{
                    background: "linear-gradient(180deg, #ffffff 0%, #d4d4d8 50%, #71717a 100%)",
                    borderColor: "#a1a1aa",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.45), inset 0 1px 2px rgba(255,255,255,0.95)"
                  }}
                />

                {/* Display Window */}
                <div
                  className="w-[176px] sm:w-[192px] bg-zinc-950 border-4 border-zinc-700 p-3 sm:p-4 rounded-2xl mt-5 flex flex-col items-center gap-1.5 sm:gap-2 relative overflow-hidden"
                  style={{
                    backgroundColor: "#09090b",
                    borderColor: "#3f3f46",
                    boxShadow: "inset 0 5px 12px rgba(0,0,0,0.98), 0 2px 4px rgba(255,255,255,0.6)"
                  }}
                >
                  {/* Subtle inner reflection */}
                  <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                  
                  {/* Label */}
                  <span className="text-[9.2px] sm:text-[9.6px] text-cyan-neon font-black tracking-widest uppercase">
                    FLECHAS LANZADAS
                  </span>

                  {/* Digits Roller Board */}
                  <div className="flex gap-1.5 mt-0.5">
                    {String(tallyCount).padStart(4, "0").split("").map((digit, idx) => (
                      <div
                        key={idx}
                        className="w-[31px] sm:w-[33.6px] h-[44px] sm:h-[48px] border border-zinc-800 rounded flex items-center justify-center font-black text-[26px] sm:text-[28.8px] text-white font-sans tabular-nums relative"
                        style={{
                          background: "linear-gradient(180deg, #18181b 0%, #09090b 50%, #18181b 100%)",
                          borderColor: "#27272a",
                          boxShadow: "inset 0 3px 6px rgba(0,0,0,0.95)"
                        }}
                      >
                        {/* Horizontal divider for roller visual look */}
                        <div className="absolute inset-x-0 h-[1px] bg-zinc-800/60 top-1/2" />
                        <span className="relative z-10">{digit}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Engraved bottom callout */}
                <div
                  className="text-[11px] sm:text-[12px] font-black tracking-wider uppercase mt-1.5 sm:mt-2.5 transition"
                  style={{
                    color: "#18181b",
                    textShadow: "0 1px 0 rgba(255,255,255,0.65)"
                  }}
                >
                  PULSAR PARA CONTAR
                </div>
              </button>
            </div>

            {/* Quick action buttons */}
            <div className="flex gap-3 mt-1">
              <button
                onClick={async () => {
                  if (tallyCount > 0) {
                    if (await showOledConfirm("¿Deseas restar una flecha?")) {
                      playTallyClickSound();
                      const nextCount = tallyCount - 1;
                      tallyCountRef.current = nextCount;
                      setTallyCount(nextCount);

                      const updatedEnds = [...ends];
                      
                      // Calculate previous indices
                      let prevArrowIdx = currentArrowIdx - 1;
                      let prevEndIdx = currentEndIdx;
                      
                      if (prevArrowIdx < 0) {
                        prevEndIdx = Math.max(0, currentEndIdx - 1);
                        prevArrowIdx = config.arrowsPerEnd - 1;
                      }

                      if (updatedEnds[prevEndIdx]) {
                        const targetEnd = { ...updatedEnds[prevEndIdx] };
                        const targetArrows = [...targetEnd.arrows];
                        targetArrows[prevArrowIdx] = "";
                        targetEnd.arrows = targetArrows;
                        updatedEnds[prevEndIdx] = targetEnd;
                        endsRef.current = updatedEnds;
                        setEnds(updatedEnds);
                      }

                      currentArrowIdxRef.current = prevArrowIdx;
                      currentEndIdxRef.current = prevEndIdx;
                      setCurrentArrowIdx(prevArrowIdx);
                      setCurrentEndIdx(prevEndIdx);
                    }
                  }
                }}
                disabled={tallyCount === 0}
                className="px-4 py-2 bg-white hover:bg-neutral-200 border border-white disabled:opacity-30 disabled:hover:bg-white text-black text-[11.6px] font-black uppercase tracking-wider rounded-xl cursor-pointer transition"
              >
                Restar Flecha (-1)
              </button>
              <button
                onClick={() => setIsFinishing(true)}
                className="px-4 py-2 bg-cyan-neon hover:bg-[#19c8ff] text-black font-extrabold text-[11.6px] uppercase tracking-wider rounded-xl cursor-pointer transition"
              >
                Finalizar Práctica
              </button>
            </div>
          </div>
        ) : mode === "TARGET" ? (
          // TARGET MODE (Diana SVG)
          <div className="flex-1 flex flex-col items-center justify-between gap-2 relative w-full max-w-[344px] mx-auto">
            {/* Floating Animated Shot Value Badge */}
            <AnimatePresence>
              {animatingValue && (
                <motion.div
                  key={animatingValue.id}
                  initial={{ scale: 0.3, opacity: 0, y: 10 }}
                  animate={{ scale: [1, 1.4, 1], opacity: [0, 1, 1, 0], y: [0, -30, -50] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "45%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 9999,
                    pointerEvents: "none"
                  }}
                  className={`px-6 py-4 rounded-3xl border-2 font-black text-4xl shadow-2xl flex items-center justify-center ${
                    animatingValue.value === "X" || animatingValue.value === "10" || animatingValue.value === "9"
                      ? "bg-yellow-gold border-yellow-gold text-black"
                      : animatingValue.value === "8" || animatingValue.value === "7"
                      ? "bg-red-500 border-red-500 text-white"
                      : animatingValue.value === "6" || animatingValue.value === "5"
                      ? "bg-blue-500 border-blue-500 text-white"
                      : animatingValue.value === "4" || animatingValue.value === "3"
                      ? "bg-neutral-900 border-neutral-700 text-white"
                      : "bg-red-rival border-red-rival text-white"
                  }`}
                >
                  {animatingValue.value}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quick Actions Bar: Clics de Mira & Compartir Diana */}
            <div className="w-full flex items-center justify-between gap-2 px-0.5">
              <button
                type="button"
                onClick={() => setShowDispersionDrawer(true)}
                className="flex-1 py-1.5 px-3 rounded-xl bg-[#0D1017] border border-white/[0.1] hover:border-cyan-neon/50 text-white font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer"
              >
                <Crosshair size={13} className="text-cyan-neon shrink-0" />
                <span>Ajuste de Mira</span>
                {activeAnalysis && activeAnalysis.count > 0 && (
                  <span className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-cyan-neon/15 text-cyan-neon tabular-nums">
                    {activeAnalysis.clockDirection}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={handleShareShotChart}
                disabled={isGeneratingImage}
                className="py-1.5 px-3.5 rounded-xl bg-[#0D1017] border border-yellow-gold/35 hover:border-yellow-gold text-yellow-gold font-black text-[12px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                title="Generar y compartir imagen de la diana con sello 101010 THE APP"
              >
                <Camera size={13} />
                <span>{isGeneratingImage ? "Generando..." : "Foto Diana"}</span>
              </button>
            </div>
            
            {/* Diana Central (+10% adicional: 344px, centrada y armónica) */}
            <div className="flex justify-center items-center py-0.5 relative w-full">
              <div className="relative overflow-visible">
                <svg
                  ref={dianaRef}
                  viewBox="0 0 100 100"
                  className="w-full max-w-[344px] aspect-square rounded-full border-4 border-neutral-900 shadow-2xl bg-black cursor-crosshair overflow-visible relative z-10"
                >
                  {/* Concentric rings rendered dynamically */}
                  {presetRings.map((ring, index) => (
                    <circle
                      key={index}
                      cx="50"
                      cy="50"
                      r={ring.r}
                      fill={ring.fill}
                      stroke={ring.stroke}
                      strokeWidth={ring.v === "X" ? 0.25 : ring.v === "10" && presetType === "WA_300_COMPOUND" ? 0.35 : 0.2}
                    />
                  ))}

                  {/* Línea representativa de la agrupación de flechas */}
                  {currentEndImpacts.length === 2 && (
                    <line
                      x1={currentEndImpacts[0].x}
                      y1={currentEndImpacts[0].y}
                      x2={currentEndImpacts[1].x}
                      y2={currentEndImpacts[1].y}
                      stroke="#00E5FF"
                      strokeWidth="1.0"
                      strokeDasharray="2.5 1.5"
                      strokeLinecap="round"
                    />
                  )}

                  {currentEndImpacts.length >= 3 && groupingHullPoints && (
                    <polygon
                      points={groupingHullPoints}
                      fill="rgba(0, 229, 255, 0.12)"
                      stroke="#00E5FF"
                      strokeWidth="1.0"
                      strokeDasharray="2.5 1.5"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Elipse sutil de dispersión perimetral */}
                  {centroid && dispersion && currentEndImpacts.length >= 3 && (
                    <ellipse
                      cx={centroid.x}
                      cy={centroid.y}
                      rx={dispersion.rx}
                      ry={dispersion.ry}
                      fill="rgba(0, 229, 255, 0.04)"
                      stroke="#00E5FF"
                      strokeWidth="0.4"
                      strokeDasharray="1.5 1.5"
                      opacity="0.6"
                    />
                  )}

                  {/* Cruz (+) en el centro de la agrupación de flechas */}
                  {centroid && currentEndImpacts.length >= 1 && (
                    <g className="cursor-default pointer-events-none">
                      {/* Sombra de contraste negra */}
                      <line x1={centroid.x - 3.5} y1={centroid.y} x2={centroid.x + 3.5} y2={centroid.y} stroke="#000000" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1={centroid.x} y1={centroid.y - 3.5} x2={centroid.x} y2={centroid.y + 3.5} stroke="#000000" strokeWidth="2.5" strokeLinecap="round" />
                      {/* Cruz Neón Cian (+) */}
                      <line x1={centroid.x - 3.5} y1={centroid.y} x2={centroid.x + 3.5} y2={centroid.y} stroke="#00E5FF" strokeWidth="1.1" strokeLinecap="round" />
                      <line x1={centroid.x} y1={centroid.y - 3.5} x2={centroid.x} y2={centroid.y + 3.5} stroke="#00E5FF" strokeWidth="1.1" strokeLinecap="round" />
                      {/* Punto central del centroide */}
                      <circle cx={centroid.x} cy={centroid.y} r="0.8" fill="#00E5FF" stroke="#000000" strokeWidth="0.35" />
                    </g>
                  )}

                  {/* Render coordinate markers on the diana SVG */}
                  {impacts
                    .filter((imp) => imp.endIdx === currentEndIdx)
                    .map((imp, idx) => (
                      <g key={idx}>
                        {/* Connection line to center */}
                        <line
                          x1={imp.x}
                          y1={imp.y}
                          x2="50"
                          y2="50"
                          stroke="#FFF200"
                          strokeWidth="0.3"
                          strokeDasharray="1 1"
                          opacity="0.5"
                        />
                        {/* Bullet point */}
                        <circle cx={imp.x} cy={imp.y} r="2.8" fill="rgba(0,0,0,0.55)" />
                        <circle cx={imp.x} cy={imp.y} r="2" className="fill-yellow-gold stroke-black stroke-[0.4px]" />
                        {/* Show arrow VALUE (X, 10, 9...) on top */}
                        <text
                          x={imp.x}
                          y={imp.y + 0.75}
                          textAnchor="middle"
                          fontSize="1.8"
                          fontWeight="bold"
                          fill="black"
                        >
                          {imp.value}
                        </text>
                      </g>
                    ))}
                </svg>
              </div>
            </div>

            {/* Historial de Ends Scrollable en Diana */}
            <div className="w-full flex flex-col gap-1 z-10 px-0.5">
              <div className="flex justify-between items-center text-[10.5px] font-black uppercase text-white tracking-widest px-1">
                <span>Historial de Tiradas (Ends)</span>
                <span className="text-cyan-neon font-bold">Total: {calculateTotalScore()} pts</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {ends.map((e, idx) => {
                  const isCompleted = e.arrows.every(a => a !== "" && a !== undefined);
                  const total = calculateEndTotal(idx);
                  const isCurrent = idx === currentEndIdx;
                  
                  return (
                    <div 
                      key={idx} 
                      onClick={() => {
                        if (idx <= currentEndIdx) {
                          setCurrentEndIdx(idx);
                          setCurrentArrowIdx(0);
                        }
                      }}
                      className={`flex flex-col items-center justify-center p-1.5 rounded-xl border min-w-[54px] cursor-pointer transition-all text-white ${
                        isCurrent 
                          ? "border-cyan-neon bg-cyan-neon/15 shadow-glow-cyan" 
                          : isCompleted 
                            ? "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700" 
                            : "border-neutral-900/35 bg-neutral-950/45"
                      }`}
                    >
                      <span className="text-[11px] uppercase font-black tracking-wider text-white tabular-nums">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="text-xs font-black mt-0.5 text-white tabular-nums">
                        {isCompleted || (idx === currentEndIdx && total > 0) ? total : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons (Undo, Miss & Confirm End) */}
            <div className="w-full flex items-center gap-2 z-10 mt-0.5 px-0.5">
              <button
                onClick={handleBackspace}
                disabled={currentEndIdx === 0 && currentArrowIdx === 0 && (!ends[0] || ends[0].arrows[0] === "")}
                className="flex-1 py-3 rounded-xl border border-white/10 bg-neutral-900 text-white font-bold text-xs uppercase cursor-pointer hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 active:scale-95"
              >
                <Undo2 size={13} />
                <span>Deshacer</span>
              </button>
              <button
                onClick={() => handleScoreInput("M")}
                className="flex-1 py-3 rounded-xl border border-white bg-white hover:bg-neutral-200 text-black font-black text-xs uppercase cursor-pointer transition active:scale-95"
              >
                Fallo (M)
              </button>
              <button
                onClick={handleConfirmEnd}
                disabled={!isCurrentEndComplete}
                className={`flex-1.5 py-3 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap transition active:scale-95 ${
                  isCurrentEndComplete
                    ? "bg-cyan-neon hover:bg-[#19c8ff] text-black cursor-pointer"
                    : "bg-neutral-900 border border-white/5 text-white opacity-40 cursor-not-allowed pointer-events-none shadow-none"
                }`}
              >
                <span>Confirmar</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        ) : (
          // KEYBOARD MODE (tactile grid cells & 4x4 keypad)
          <div className="flex-1 min-w-0 flex flex-col gap-3 justify-between">
            {/* Table view Grid row (with max-height and auto-scroll container ref) */}
            <div
              ref={tableContainerRef}
              className="w-full overflow-x-auto overflow-y-auto border border-gray-border/40 rounded-2xl bg-neutral-950/40 max-h-[160px]"
            >
              <table className="w-full text-left text-xs border-collapse tabular-nums">
                <thead>
                  <tr className="bg-neutral-900 text-white font-bold uppercase text-[10.5px] tracking-wider border-b border-gray-border/40">
                    <th className="py-2 px-3 text-center">End</th>
                    <th className="py-2 px-3 text-center">Flechas</th>
                    <th className="py-2 px-3 text-center">Total</th>
                    <th className="py-2 px-3 text-center">Acum</th>
                  </tr>
                </thead>
                <tbody>
                  {ends.map((e, idx) => {
                    const isCurrent = currentEndIdx === idx;
                    const halfEnds = Math.floor(config.endsCount / 2);
                    
                    return (
                      <React.Fragment key={idx}>
                        {isBlockFormat && idx === halfEnds && (
                          <tr className="bg-neutral-900/80 border-y border-cyan-neon/20">
                            <td colSpan={4} className="py-1.5 px-3 text-center text-[10.5px] font-black text-cyan-neon tracking-widest uppercase">
                              --- Bloque 2 (Segunda Mitad) ---
                            </td>
                          </tr>
                        )}
                        <tr
                          data-active={isCurrent}
                          className={`border-b border-gray-border/20 transition ${
                            isCurrent ? "bg-cyan-brand/5" : ""
                          }`}
                        >
                        <td className="py-2 px-3 font-black text-center text-white tabular-nums">{String(idx + 1).padStart(2, "0")}</td>
                        <td className="py-2 px-3 flex items-center justify-center gap-1">
                          {e.arrows.map((a, arrowIdx) => {
                            const isCellEditing = isCurrent && currentArrowIdx === arrowIdx;
                            
                            // Dynamic font class to satisfy font size requirements without layout overflow
                            const textFontClass = fontSize === "large" ? "text-base" : fontSize === "xlarge" ? "text-lg" : "text-sm";
                            
                            return (
                              <div
                                key={arrowIdx}
                                onClick={() => {
                                  if (idx <= currentEndIdx) {
                                    setCurrentEndIdx(idx);
                                    setCurrentArrowIdx(arrowIdx);
                                    setEditingArrowSlot(arrowIdx);
                                  }
                                }}
                                className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center font-bold border transition-all cursor-pointer tabular-nums ${textFontClass} ${getArrowColorClass(
                                  a
                                )} ${
                                  isCellEditing
                                    ? "border-cyan-neon ring-1 ring-cyan-neon shadow-glow-cyan bg-cyan-neon/5"
                                    : ""
                                }`}
                              >
                                {a}
                              </div>
                            );
                          })}
                        </td>
                        <td className="py-2 px-3 text-center font-extrabold text-white tabular-nums">
                          {calculateEndTotal(idx)}
                        </td>
                        <td className="py-2 px-3 text-center font-extrabold text-white tabular-nums">
                          {calculateRunningTotal(idx)}
                        </td>
                      </tr>
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Keypad Buttons 4x4 */}
            <div className="grid grid-cols-4 gap-2 mt-2">
              {/* Max points */}
              {["X", "10", "9"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleScoreInput(key)}
                  className="py-3.5 min-h-[48px] rounded-xl border border-yellow-gold/60 bg-yellow-gold/10 text-yellow-gold font-black text-base flex items-center justify-center cursor-pointer hover:bg-yellow-gold/20 active:scale-95 transition"
                >
                  {key}
                </button>
              ))}
              {/* Backspace */}
              <button
                onClick={handleBackspace}
                className="py-3.5 min-h-[48px] rounded-xl border border-white/10 bg-[#0D1017] text-white font-black text-base flex items-center justify-center cursor-pointer hover:text-white active:scale-95 transition"
              >
                ⌫
              </button>

              {/* Red points 8-7 */}
              {["8", "7"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleScoreInput(key)}
                  className="py-3.5 min-h-[48px] rounded-xl border border-red-rival/60 bg-red-rival/10 text-red-rival font-black text-base flex items-center justify-center cursor-pointer hover:bg-red-rival/20 active:scale-95 transition"
                >
                  {key}
                </button>
              ))}

              {/* Blue points 6-5 */}
              {["6", "5"].map((key) => {
                const isEnabled = presetRings.some(r => r.v === key);
                return (
                  <button
                    key={key}
                    onClick={() => handleScoreInput(key)}
                    disabled={!isEnabled}
                    className={`py-3.5 min-h-[48px] rounded-xl border border-blue-500/60 bg-blue-500/10 text-cyan-neon font-black text-base flex items-center justify-center transition ${
                      isEnabled
                        ? "cursor-pointer hover:bg-blue-500/20 active:scale-95"
                        : "opacity-20 pointer-events-none line-through border-neutral-800 bg-neutral-950 text-white"
                    }`}
                  >
                    {key}
                  </button>
                );
              })}

              {/* Dark points 4-3 */}
              {["4", "3"].map((key) => {
                const isEnabled = presetRings.some(r => r.v === key);
                return (
                  <button
                    key={key}
                    onClick={() => handleScoreInput(key)}
                    disabled={!isEnabled}
                    className={`py-3.5 min-h-[48px] rounded-xl border border-white/15 bg-[#0D1017] text-white font-black text-base flex items-center justify-center transition ${
                      isEnabled
                        ? "cursor-pointer hover:bg-neutral-800 hover:text-white active:scale-95"
                        : "opacity-20 pointer-events-none line-through border-neutral-800 bg-neutral-950 text-white"
                    }`}
                  >
                    {key}
                  </button>
                );
              })}

              {/* White points 2-1 */}
              {["2", "1"].map((key) => {
                const isEnabled = presetRings.some(r => r.v === key);
                return (
                  <button
                    key={key}
                    onClick={() => handleScoreInput(key)}
                    disabled={!isEnabled}
                    className={`py-3.5 min-h-[48px] rounded-xl border border-white/40 bg-white/[0.06] text-white font-black text-base flex items-center justify-center transition ${
                      isEnabled
                        ? "cursor-pointer hover:bg-white/15 active:scale-95"
                        : "opacity-20 pointer-events-none line-through border-neutral-800 bg-neutral-950 text-white"
                    }`}
                  >
                    {key}
                  </button>
                );
              })}

              {/* Miss */}
              <button
                onClick={() => handleScoreInput("M")}
                className="col-span-2 py-3.5 min-h-[48px] rounded-xl border-2 border-neutral-700 bg-neutral-900 text-white font-black text-xs flex items-center justify-center uppercase cursor-pointer hover:bg-neutral-800 hover:text-white active:scale-95 transition"
              >
                Fallo (M)
              </button>

              {/* Confirm Round/End */}
              <button
                onClick={handleConfirmEnd}
                disabled={!isCurrentEndComplete}
                className={`col-span-2 py-3.5 min-h-[48px] rounded-xl font-black text-xs flex items-center justify-center uppercase whitespace-nowrap transition gap-1.5 active:scale-95 ${
                  isCurrentEndComplete
                    ? "bg-cyan-neon hover:bg-[#19c8ff] text-black cursor-pointer"
                    : "bg-neutral-900 border border-white/5 text-white opacity-40 cursor-not-allowed pointer-events-none shadow-none"
                }`}
              >
                <span>Confirmar End</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Barra de Cronómetro Oficial WA (idéntica a NUEVO ENTRENAMIENTO) ubicada encima de Notas del End */}
      {currentEndIdx < config.endsCount && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("open-archery-clock"))}
          title="Abrir Cronómetro Oficial WA"
          className="w-full h-14 mt-2 rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[16.3px] sm:text-[18.6px] tracking-[0.12em] uppercase transition-colors cursor-pointer flex justify-center items-center gap-2.5 active:scale-[0.99] text-center px-4"
        >
          {clockTimeStr && (
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 animate-pulse ${
                clockPhase === "prep" || clockPhase === "stop" || clockIsOver
                  ? "bg-red-600"
                  : clockIsWarn
                  ? "bg-yellow-500"
                  : "bg-black"
              }`}
            />
          )}
          <span className="truncate tabular-nums">
            {clockTimeStr ? `CRONÓMETRO · ${clockTimeStr}` : "CRONÓMETRO"}
          </span>
        </button>
      )}

      {/* End Note expansion (during the session) */}
      {config.includeNotes && currentEndIdx < config.endsCount && (
        <div className="flex flex-col gap-1.5 mt-2 bg-neutral-900/30 p-3.5 rounded-2xl border border-white/5">
          <div className="flex items-center gap-1.5 text-xs text-white font-bold uppercase tracking-wider">
            <MessageSquare size={13} className="text-cyan-neon" />
            <span>Nota del End {String(currentEndIdx + 1).padStart(2, "0")}</span>
          </div>
          <textarea
            value={endNote}
            onChange={(e) => {
              const val = e.target.value;
              setEndNote(val);
              setEnds((prevEnds) => {
                if (!prevEnds[currentEndIdx]) return prevEnds;
                const newEnds = [...prevEnds];
                newEnds[currentEndIdx] = { ...newEnds[currentEndIdx], note: val };
                return newEnds;
              });
            }}
            placeholder={t("endNotePlaceholder")}
            className="w-full bg-neutral-950/60 border border-gray-border focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none transition-all duration-200 resize-none h-14"
          />
        </div>
      )}



      {/* MODAL: Post-session Summary Notes (Final Save screen) */}
      <AnimatePresence>
        {isFinishing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-hidden overscroll-contain"
          >
            <motion.div
              initial={{ scale: 0.9, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 15 }}
              className="w-full max-w-sm max-h-[90dvh] overflow-y-auto overscroll-contain bg-neutral-900 border border-gray-border p-5 sm:p-6 rounded-3xl flex flex-col gap-5 shadow-2xl text-left"
            >
              <div>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  Terminar Entrenamiento
                </h3>
                <p className="text-xs text-white mt-0.5">
                  Resumen de sesión y notas finales
                </p>
              </div>

              {/* Summary Stats box */}
              {config.practiceType === "Volumen" ? (
                <div className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-bold">Total Flechas</span>
                    <p className="text-2xl font-black text-cyan-neon mt-0.5 tabular-nums">
                      {tallyCount}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-bold">Distancia</span>
                    <p className="text-2xl font-black text-yellow-gold mt-0.5 tabular-nums">
                      {config.distance}m
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-bold">Puntaje Total</span>
                    <p className="text-2xl font-black text-cyan-neon mt-0.5 tabular-nums">
                      {calculateTotalScore()}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-white uppercase font-bold">Precisión</span>
                    <p className="text-2xl font-black text-yellow-gold mt-0.5 tabular-nums">
                      {(() => {
                        const shotArrowsCount = ends.reduce(
                          (sum, e) => sum + e.arrows.filter((a) => a !== "" && a !== undefined).length,
                          0
                        );
                        const effectiveModalMaxScore =
                          shotArrowsCount > 0 ? Math.min(2000, shotArrowsCount * 10) : config.maxScore;
                        return effectiveModalMaxScore > 0
                          ? Math.round((calculateTotalScore() / effectiveModalMaxScore) * 100)
                          : 0;
                      })()}%
                    </p>
                  </div>
                </div>
              )}

              {/* Biometric Summary in Finish Modal (Kcal + Distancia Recorrida for Archer & Coach) */}
              <div className="bg-neutral-950/60 p-3.5 rounded-2xl border border-white/10 grid grid-cols-2 gap-3 text-center">
                <div className="flex flex-col items-center justify-center">
                  <span className="text-[12px] text-white uppercase font-black tracking-wider block">
                    KCAL
                  </span>
                  <p className="text-xl font-black text-white mt-0.5 tabular-nums">
                    {activeKcal} <span className="text-sm font-black text-white">kcal</span>
                  </p>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <span className="text-[12px] text-white uppercase font-black tracking-wider block">
                    DISTANCIA RECORRIDA
                  </span>
                  <p className="text-[19px] font-black text-white mt-0.5 tabular-nums">
                    {formatKmAndMiles(distanceWalkedM, false)}
                  </p>
                </div>
              </div>

              {/* Bloques y Fatiga report (para WA600/720) */}
              {isBlockFormat && (
                <div className="bg-neutral-950/60 p-4 rounded-2xl border border-white/5 flex flex-col gap-2 text-xs">
                  <span className="text-[10.5px] text-white uppercase font-bold">Rendimiento por Bloques</span>
                  <div className="flex justify-between text-white">
                    <span>Bloque 1 (Mitad 1):</span>
                    <span className="font-extrabold text-cyan-neon tabular-nums">
                      {ends.slice(0, Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0)} pts
                    </span>
                  </div>
                  <div className="flex justify-between text-white">
                    <span>Bloque 2 (Mitad 2):</span>
                    <span className="font-extrabold text-cyan-neon tabular-nums">
                      {ends.slice(Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0)} pts
                    </span>
                  </div>
                  {(() => {
                    const b1 = ends.slice(0, Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0);
                    const b2 = ends.slice(Math.floor(config.endsCount / 2)).reduce((sum, e) => sum + e.arrows.reduce((s, a) => s + getScoreValue(a), 0), 0);
                    const diff = b2 - b1;
                    return (
                      <div className="flex justify-between items-center border-t border-white/5 pt-1.5 mt-0.5">
                        <span>Consistencia:</span>
                        <span className={`font-black uppercase text-[11.6px] tabular-nums ${diff < 0 ? "bg-white text-black px-2 py-0.5 rounded-md" : "text-cyan-neon"}`}>
                          {diff > 0 ? `+${diff}` : diff} pts {diff < 0 ? "(Fatiga)" : "(Excelente)"}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Textarea post-session notes */}
              {config.includeNotes && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white font-bold uppercase tracking-wider">
                    Notas de la Sesión
                  </label>
                  <textarea
                    value={sessionNote}
                    onChange={(e) => setSessionNote(e.target.value)}
                    placeholder={t("sessionNotePlaceholder")}
                    className="w-full bg-neutral-950/60 border border-cyan-brand focus:border-cyan-neon text-white text-xs p-3.5 rounded-2xl outline-none transition duration-200 min-h-[80px] resize-none caret-yellow-gold"
                  />
                  <p className="text-[10.5px] text-white">Estas notas se guardan en tu historial y son visibles para el Coach.</p>
                </div>
              )}

              {/* Direct Volume Confirmation inside Finish Modal (1-click Save) */}
              <div className="bg-neutral-950/70 p-3 rounded-2xl border border-white/10 flex items-center justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10.5px] text-cyan-neon font-black uppercase tracking-wider">
                    Volumen Total de Flechas
                  </span>
                  <span className="text-[10px] text-white">
                    Para tu historial de volumen
                  </span>
                </div>
                <div className="flex items-center bg-black border border-white/10 rounded-xl px-1.5 py-1 shrink-0 tabular-nums">
                  <button
                    type="button"
                    onClick={() => setConfirmedVolume(Math.max(0, confirmedVolume - 3))}
                    className="px-2 py-0.5 text-cyan-neon font-black text-sm cursor-pointer active:scale-95 tabular-nums"
                  >
                    -3
                  </button>
                  <input
                    type="number"
                    value={confirmedVolume}
                    onChange={(e) => setConfirmedVolume(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-14 text-center font-black text-white text-base bg-transparent outline-none border-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmedVolume(confirmedVolume + 3)}
                    className="px-2 py-0.5 text-cyan-neon font-black text-sm cursor-pointer active:scale-95 tabular-nums"
                  >
                    +3
                  </button>
                </div>
              </div>

              {/* Group Dispersion Summary in Finish Modal */}
              {globalDispersion && impacts.length > 0 && (
                <div className="bg-neutral-950/60 p-3.5 rounded-2xl border border-white/5 flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[10.5px] text-white uppercase font-bold flex items-center gap-1">
                      <Crosshair size={11} className="text-cyan-neon" />
                      Agrupación & Mira
                    </span>
                    <span className="text-cyan-neon tabular-nums font-bold text-[11.6px]">
                      Ø {globalDispersion.spreadCm.toFixed(1)} cm
                    </span>
                  </div>
                  <div className="flex justify-between text-white text-[12.8px]">
                    <span>Centro del grupo:</span>
                    <span className="font-bold text-yellow-gold">{globalDispersion.clockDirection}</span>
                  </div>
                  <p className="text-[11.6px] text-white leading-snug">
                    {globalDispersion.adviceText}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2.5 mt-2">
                <button
                  onClick={handleShareShotChart}
                  disabled={isGeneratingImage}
                  className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Camera size={16} />
                  <span>{isGeneratingImage ? "Generando Imagen..." : "Compartir Diana Gráfica (HD)"}</span>
                </button>
                <button
                  onClick={handleShareScorecardWhatsApp}
                  disabled={isGeneratingImage}
                  className="w-full h-11 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Share2 size={16} />
                  <span>Compartir Planilla por WhatsApp</span>
                </button>
                <button
                  onClick={handleFinishAndSave}
                  className="w-full h-11 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-95 transition"
                >
                  <Save size={15} />
                  <span>Guardar Entrenamiento</span>
                </button>
                <button
                  onClick={() => {
                    watchFinishedSessionRef.current = false;
                    setIsFinishing(false);
                    publishWatchState(liveWatchSnapshot);
                  }}
                  className="w-full h-11 rounded-xl bg-transparent border border-white/10 text-white hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer"
                >
                  Seguir Tirando
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: Exit / Pause Session Dialog */}
      <AnimatePresence>
        {isExitModalOpen && (
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-[#0D1017] border border-white/10 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
              <h3 className="text-white text-base font-black uppercase [text-wrap:balance]">¿Finalizar o Pausar Sesión?</h3>
              <p className="text-xs text-white [text-wrap:pretty]">
                Puedes finalizar y guardar la sesión en tu historial con los tiros actuales, pausarla como borrador, o descartarla.
              </p>
              
              <div className="flex flex-col gap-2.5 mt-2">
                {(ends.some((e) => e.arrows.some((a) => a !== "")) || tallyCount > 0) && (
                  <button
                    onClick={() => {
                      setIsExitModalOpen(false);
                      setIsFinishing(true);
                    }}
                    className="w-full h-11 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap cursor-pointer transition shadow-sm"
                  >
                    Guardar y Finalizar en Historial
                  </button>
                )}
                <button
                  onClick={handleSaveDraft}
                  className="w-full h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap cursor-pointer transition"
                >
                  Pausar y Guardar Borrador
                </button>
                <button
                  onClick={handleDiscard}
                  className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 border border-white text-black font-black text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap cursor-pointer active:scale-95 transition"
                >
                  Descartar Entrenamiento
                </button>
                <button
                  onClick={() => setIsExitModalOpen(false)}
                  className="w-full h-11 rounded-xl bg-transparent border border-white/10 text-white hover:text-white font-bold text-xs uppercase flex items-center justify-center whitespace-nowrap cursor-pointer transition"
                >
                  Seguir Tirando
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Confirm Carga Total de Volumen */}
      <AnimatePresence>
        {isConfirmingVolume && (
          <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 w-full max-w-xs flex flex-col gap-4 text-center">
              <div>
                <span className="text-[11.6px] text-cyan-neon font-black tracking-widest uppercase">
                  Control de Carga Física
                </span>
                <h3 className="text-white text-base font-black uppercase mt-1">
                  Confirmar Volumen Total
                </h3>
              </div>

              <p className="text-xs text-white leading-relaxed">
                {config.practiceType === "Volumen" 
                  ? "Confirma la cantidad total de flechas lanzadas en esta práctica:"
                  : "Confirma la cantidad exacta de flechas tiradas hoy para tus estadísticas de volumen:"
                }
              </p>

              <div className="flex items-center justify-center bg-neutral-950 border border-neutral-800 rounded-2xl py-3 px-4 mt-2 tabular-nums">
                <button
                  type="button"
                  onClick={() => setConfirmedVolume(Math.max(0, confirmedVolume - 3))}
                  className="px-3.5 py-1.5 text-cyan-neon font-black text-lg cursor-pointer active:scale-95 hover:bg-neutral-900 rounded-lg tabular-nums"
                >
                  -3
                </button>
                <input
                  type="number"
                  value={confirmedVolume}
                  onChange={(e) => setConfirmedVolume(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-20 text-center font-black text-white text-2xl bg-transparent outline-none border-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setConfirmedVolume(confirmedVolume + 3)}
                  className="px-3.5 py-1.5 text-cyan-neon font-black text-lg cursor-pointer active:scale-95 hover:bg-neutral-900 rounded-lg tabular-nums"
                >
                  +3
                </button>
              </div>

              <div className="flex flex-col gap-2 mt-4">
                <button
                  onClick={() => executeFinalSave(confirmedVolume)}
                  className="w-full h-11 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-extrabold text-xs uppercase tracking-wider flex items-center justify-center whitespace-nowrap cursor-pointer transition"
                >
                  Confirmar y Guardar
                </button>
                <button
                  onClick={() => setIsConfirmingVolume(false)}
                  className="w-full h-11 rounded-xl bg-transparent border border-white/10 text-white hover:text-white font-bold text-xs uppercase flex items-center justify-center whitespace-nowrap cursor-pointer transition"
                >
                  Regresar
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>



      {/* MODAL: Análisis Inteligente de Dispersión y Ajuste de Mira */}
      <AnimatePresence>
        {showDispersionDrawer && (
          <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden overscroll-contain">
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-[#0D1017] border border-white/10 rounded-3xl p-5 w-full max-w-sm max-h-[90dvh] overflow-y-auto overscroll-contain flex flex-col gap-4 text-left shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon shrink-0">
                    <Crosshair size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white text-xs sm:text-sm font-black uppercase tracking-wide truncate">
                      Centro y Ajuste de Mira
                    </h3>
                    <p className="text-[11.6px] text-white truncate tabular-nums">
                      {config.bowType === "Recurve" ? "Recurvo" : config.bowType === "Compound" ? "Compuesto" : (config.bowType || "Recurvo")} · {config.distance || 70}m · Dianas WA
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDispersionDrawer(false)}
                  className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white hover:text-white transition cursor-pointer shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Scope Switcher: End actual vs Toda la sesión */}
              <div className="grid grid-cols-2 gap-1.5 bg-[#090B0E] p-1 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setDispersionScope("END")}
                  className={`h-9 rounded-lg font-black text-[11.6px] uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer tabular-nums ${
                    dispersionScope === "END"
                      ? "bg-cyan-neon text-black"
                      : "text-white hover:text-white"
                  }`}
                >
                  End {currentEndIdx + 1} ({currentEndImpacts.length} fl.)
                </button>
                <button
                  type="button"
                  onClick={() => setDispersionScope("GLOBAL")}
                  className={`h-9 rounded-lg font-black text-[11.6px] uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer tabular-nums ${
                    dispersionScope === "GLOBAL"
                      ? "bg-cyan-neon text-black"
                      : "text-white hover:text-white"
                  }`}
                >
                  Sesión ({impacts.length} fl.)
                </button>
              </div>

              {/* Content */}
              {activeAnalysis && activeAnalysis.count > 0 ? (
                <div className="flex flex-col gap-3">
                  {/* Compass / Direction Card */}
                  <div className="bg-neutral-950/70 border border-white/5 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10.5px] font-black uppercase text-white tracking-wider">
                        Desviación del Grupo
                      </span>
                      <div className="text-xl font-black text-white mt-0.5 flex flex-wrap items-center gap-1.5 tabular-nums">
                        <span>{activeAnalysis.clockDirection}</span>
                        <span className="text-xs font-bold text-cyan-neon tabular-nums">
                          ({activeAnalysis.distanceFromCenterCm.toFixed(1)} cm del centro)
                        </span>
                      </div>
                    </div>
                    <div className="px-2.5 py-1 rounded-xl bg-cyan-neon/10 border border-cyan-neon/30 text-cyan-neon font-black text-[11.6px] text-center shrink-0">
                      {activeAnalysis.groupQuality}
                    </div>
                  </div>

                  {/* Sight Direction Recommendations */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Horizontal */}
                    <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-1">
                      <span className="text-[10.5px] font-black uppercase text-white tracking-wider">
                        Deriva Horizontal
                      </span>
                      <span className="text-xs font-bold text-white tabular-nums">
                        {activeAnalysis.deltaXCm === 0 
                          ? "Centrado" 
                          : `${Math.abs(activeAnalysis.deltaXCm).toFixed(1)} cm ${activeAnalysis.deltaXCm > 0 ? "Derecha" : "Izquierda"}`}
                      </span>
                      <div className="mt-1 pt-1 border-t border-white/5">
                        <span className="text-[11.6px] font-black text-yellow-gold uppercase">
                          {activeAnalysis.horizontalDirection !== "CENTRADO"
                            ? `Mover a la ${activeAnalysis.horizontalDirection}`
                            : "Centrado"}
                        </span>
                      </div>
                    </div>

                    {/* Vertical */}
                    <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-1">
                      <span className="text-[10.5px] font-black uppercase text-white tracking-wider">
                        Elevación Vertical
                      </span>
                      <span className="text-xs font-bold text-white tabular-nums">
                        {activeAnalysis.deltaYCm === 0 
                          ? "Centrado" 
                          : `${Math.abs(activeAnalysis.deltaYCm).toFixed(1)} cm ${activeAnalysis.deltaYCm > 0 ? "Arriba" : "Abajo"}`}
                      </span>
                      <div className="mt-1 pt-1 border-t border-white/5">
                        <span className="text-[11.6px] font-black text-yellow-gold uppercase">
                          {activeAnalysis.verticalDirection !== "CENTRADO"
                            ? `Mover hacia ${activeAnalysis.verticalDirection}`
                            : "Centrado"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Target Face & Dispersion spread compact 2-column row */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10.5px] font-black uppercase text-white tracking-wider">Diana Oficial</span>
                      <span className="tabular-nums font-bold text-xs text-white truncate">{activeAnalysis.targetName}</span>
                    </div>
                    <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10.5px] font-black uppercase text-white tracking-wider">Diámetro Grupo</span>
                      <span className="tabular-nums font-black text-xs text-cyan-neon">Ø {activeAnalysis.spreadCm.toFixed(1)} cm</span>
                    </div>
                  </div>

                  {/* Summary Tip */}
                  <div className="bg-neutral-950/60 border border-white/5 rounded-2xl p-3 text-xs text-white font-medium leading-relaxed flex items-start gap-2.5">
                    <Compass size={15} className="text-cyan-neon shrink-0 mt-0.5" />
                    <span className="leading-snug [text-wrap:pretty]">{activeAnalysis.adviceText}</span>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-white flex flex-col items-center gap-2">
                  <Target size={28} className="text-white" />
                  <span className="[text-wrap:pretty]">Aún no hay impactos registrados en este ámbito. Dispara y marca tus flechas en la diana.</span>
                </div>
              )}

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowDispersionDrawer(false)}
                className="w-full h-11 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs uppercase flex items-center justify-center whitespace-nowrap cursor-pointer transition"
              >
                Cerrar Análisis
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Touch Magnifier Circle Overlay (20% más grande) */}
      {lupaState.active && (
        <div
          style={{
            position: "fixed",
            left: lupaState.clientX - 86,
            top: lupaState.clientY - 185,
            width: 172,
            height: 172,
            pointerEvents: "none",
            zIndex: 99999
          }}
          className="rounded-full border-2 border-cyan-neon bg-black shadow-2xl overflow-hidden flex items-center justify-center"
        >
          <svg
            viewBox={`${lupaState.x - 12} ${lupaState.y - 12} 24 24`}
            className="w-full h-full bg-black"
          >
            {presetRings.map((ring, index) => (
              <circle
                key={index}
                cx="50"
                cy="50"
                r={ring.r}
                fill={ring.fill}
                stroke={ring.stroke}
                strokeWidth={ring.v === "X" ? 0.25 : ring.v === "10" && presetType === "WA_300_COMPOUND" ? 0.35 : 0.2}
              />
            ))}

            {/* Línea representativa de agrupación en Lupa */}
            {currentEndImpacts.length === 2 && (
              <line
                x1={currentEndImpacts[0].x}
                y1={currentEndImpacts[0].y}
                x2={currentEndImpacts[1].x}
                y2={currentEndImpacts[1].y}
                stroke="#00E5FF"
                strokeWidth="0.8"
                strokeDasharray="1.5 1"
              />
            )}
            {currentEndImpacts.length >= 3 && groupingHullPoints && (
              <polygon
                points={groupingHullPoints}
                fill="rgba(0, 229, 255, 0.12)"
                stroke="#00E5FF"
                strokeWidth="0.8"
                strokeDasharray="1.5 1"
              />
            )}
            {centroid && (
              <g>
                <line x1={centroid.x - 3} y1={centroid.y} x2={centroid.x + 3} y2={centroid.y} stroke="#000000" strokeWidth="2.2" strokeLinecap="round" />
                <line x1={centroid.x} y1={centroid.y - 3} x2={centroid.x} y2={centroid.y + 3} stroke="#000000" strokeWidth="2.2" strokeLinecap="round" />
                <line x1={centroid.x - 3} y1={centroid.y} x2={centroid.x + 3} y2={centroid.y} stroke="#00E5FF" strokeWidth="1.0" strokeLinecap="round" />
                <line x1={centroid.x} y1={centroid.y - 3} x2={centroid.x} y2={centroid.y + 3} stroke="#00E5FF" strokeWidth="1.0" strokeLinecap="round" />
                <circle cx={centroid.x} cy={centroid.y} r="0.6" fill="#00E5FF" stroke="#000" strokeWidth="0.3" />
              </g>
            )}
            {centroid && dispersion && currentEndImpacts.length >= 3 && (
              <ellipse
                cx={centroid.x}
                cy={centroid.y}
                rx={dispersion.rx}
                ry={dispersion.ry}
                fill="rgba(0, 229, 255, 0.05)"
                stroke="#00E5FF"
                strokeWidth="0.35"
                strokeDasharray="1.5 1.5"
              />
            )}

            {impacts
              .filter((imp) => imp.endIdx === currentEndIdx)
              .map((imp, idx) => (
                <g key={idx}>
                  <circle cx={imp.x} cy={imp.y} r="1.4" fill="rgba(0,0,0,0.6)" />
                  <circle cx={imp.x} cy={imp.y} r="1.0" className="fill-yellow-gold stroke-black stroke-[0.2px]" />
                  <text
                    x={imp.x}
                    y={imp.y + 0.35}
                    textAnchor="middle"
                    fontSize="0.9"
                    fontWeight="bold"
                    fill="black"
                  >
                    {imp.value}
                  </text>
                </g>
              ))}
          </svg>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4 h-0.5 bg-cyan-neon shadow-glow-cyan" />
            <div className="h-4 w-0.5 bg-cyan-neon shadow-glow-cyan absolute" />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-neon border border-black absolute" />
          </div>

          <div className="absolute bottom-1 bg-black/80 border border-cyan-neon/30 px-2 py-0.5 rounded-md text-[10.5px] font-black text-cyan-neon uppercase tracking-wider">
            {lupaState.value}
          </div>
        </div>
      )}

      {/* Open Smartwatch Companion Mini-App Modal */}
      <SmartwatchMiniApp
        isOpen={isWatchModalOpen}
        onClose={() => setIsWatchModalOpen(false)}
        liveSnapshot={liveWatchSnapshot}
        onIncrementArrow={(delta) => handleWatchArrowDelta(delta)}
        onToggleAutoDetect={(enabled) => setAutoDetectEnabled(enabled)}
        onFinishAndSendToCoach={() => {
          setIsWatchModalOpen(false);
          setIsFinishing(true);
        }}
      />

      {/* Strava-Style Share Preview Modal */}
      <StravaShareModal
        shareResult={stravaSharePreview}
        onClose={() => setStravaSharePreview(null)}
      />
    </div>
  );
}
