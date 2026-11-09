"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw } from "lucide-react";
import {
  BiometricSessionSnapshot,
  WatchConnectionStatus,
  formatKmAndMiles,
  publishWatchState,
  readStoredWatchState,
  sendWatchCommand,
  subscribeWatchMessages,
  subscribeWatchConnectionStatus,
  pingNativeWatch,
  calculateActiveKcal
} from "@/lib/scoring/biometricsEngine";

interface SmartwatchMiniAppProps {
  isOpen?: boolean;
  standaloneWatchScreen?: boolean;
  onClose?: () => void;
  liveSnapshot?: BiometricSessionSnapshot;
  onIncrementArrow?: (delta: number, source: "watch_manual" | "watch_auto") => void;
  onToggleAutoDetect?: (enabled: boolean) => void;
  onFinishAndSendToCoach?: () => void;
}

export default function SmartwatchMiniApp({
  isOpen = true,
  standaloneWatchScreen = false,
  onClose,
  liveSnapshot,
  onIncrementArrow,
  onToggleAutoDetect,
  onFinishAndSendToCoach
}: SmartwatchMiniAppProps) {
  const [screenIdx, setScreenIdx] = useState<number>(0); // 0: Contador, 1: Métricas, 2: Auto-Tiro, 3: Resumen
  const [watchShape, setWatchShape] = useState<"ROUND" | "SQUARE">("ROUND");
  const [sensitivity, setSensitivity] = useState<"ALTA" | "MEDIA" | "BAJA">("MEDIA");
  const [justDetectedShot, setJustDetectedShot] = useState<boolean>(false);
  const [, setWristImpulseLevel] = useState<number>(0);

  const [internalSnapshot, setInternalSnapshot] = useState<BiometricSessionSnapshot>(() => {
    return (
      liveSnapshot ||
      readStoredWatchState() || {
        sessionId: "WATCH-LIVE",
        arrowsCount: 0,
        distanceM: 50,
        arrowsPerEnd: 6,
        completedEnds: 0,
        currentEndIndex: 0,
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
    bridgeReady: false,
    connectedNodesCount: 0,
    connectedNodes: [],
    lastMessageAt: 0,
    lastPongAt: 0,
    hasCachedState: false
  });
  const [isSyncingWatch, setIsSyncingWatch] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = subscribeWatchConnectionStatus((status) => {
      setWatchConnStatus(status);
    });
    return unsub;
  }, [isOpen]);

  // Listen to BroadcastChannel / localStorage updates when running standalone on /watch
  useEffect(() => {
    if (liveSnapshot) {
      setInternalSnapshot(liveSnapshot);
      return;
    }
    const stored = readStoredWatchState();
    if (stored) setInternalSnapshot(stored);

    const unsub = subscribeWatchMessages((msg) => {
      if (msg.type === "STATE_UPDATE" && msg.payload) {
        setInternalSnapshot(msg.payload);
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
        sendWatchCommand({ type: "INCREMENT_ARROW", delta, source });
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

  // Automatic Wrist Release Detector using DeviceMotionEvent with Pre-Shot Anchor Stillness Filter
  const lastShotRef = useRef<number>(0);
  const preShotQuietEmaRef = useRef<number>(1.2);
  useEffect(() => {
    if (!isOpen || !activeState.autoDetectEnabled) return;
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;

    const thresholdMap = {
      ALTA: 17.5,
      MEDIA: 21.5,
      BAJA: 26.0
    };
    const quietLimitMap = {
      ALTA: 3.4,
      MEDIA: 2.7,
      BAJA: 2.1
    };
    const threshold = thresholdMap[sensitivity];
    const quietLimit = quietLimitMap[sensitivity];

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;
      const ax = acc.x || 0;
      const ay = acc.y || 0;
      const az = acc.z || 0;
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      const dynamicSpike = Math.abs(mag - 9.81);

      setWristImpulseLevel(Math.min(100, Math.round((dynamicSpike / threshold) * 100)));

      const now = Date.now();
      if (
        dynamicSpike >= threshold &&
        now - lastShotRef.current > 3200 &&
        preShotQuietEmaRef.current <= quietLimit
      ) {
        lastShotRef.current = now;
        handleArrowDelta(1, "watch_auto");
      }
      if (dynamicSpike < 9.0) {
        preShotQuietEmaRef.current = 0.82 * preShotQuietEmaRef.current + 0.18 * dynamicSpike;
      }
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [isOpen, activeState.autoDetectEnabled, sensitivity, handleArrowDelta]);

  const handleToggleAuto = () => {
    triggerHaptic(30);
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
  const currentTanda =
    Math.floor(activeState.arrowsCount / Math.max(1, activeState.arrowsPerEnd || 6)) + 1;
  const isSquare = watchShape === "SQUARE";

  // Brand Header inside the Watch Face (100% contained within upper chord, adaptive for Round & Square)
  const WatchBrandHeader = ({
    pillText,
    pillColor = "cyan",
    onClickPill
  }: {
    pillText: string;
    pillColor?: "cyan" | "yellow" | "red";
    onClickPill?: () => void;
  }) => {
    const borderClass =
      pillColor === "yellow"
        ? "border-[#FFE500]/45 bg-[#101006]"
        : pillColor === "red"
        ? "border-[#FF1E1E]/45 bg-[#160708]"
        : "border-[#00A8F3]/40 bg-[#040B12]";
    const dotClass =
      pillColor === "yellow"
        ? "bg-[#FFE500]"
        : pillColor === "red"
        ? "bg-[#FF1E1E]"
        : "bg-[#00A8F3]";

    return (
      <div className="flex flex-col items-center gap-[5px] z-10">
        <img
          src="/images/brand_logo_header.png"
          srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
          alt="ARCHERY 101010"
          className={`${
            isSquare ? "h-[10px]" : "h-[9.2px]"
          } w-auto object-contain select-none pointer-events-none brightness-125 contrast-125 [image-rendering:-webkit-optimize-contrast]`}
          draggable={false}
        />
        <button
          type="button"
          onClick={onClickPill}
          className={`inline-flex items-center justify-center gap-[5px] border ${borderClass} px-[10px] py-[2.5px] rounded-full text-[8px] font-extrabold tracking-[0.08em] uppercase text-white whitespace-nowrap transition active:scale-95 cursor-pointer`}
        >
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotClass}`} />
          <span>{pillText}</span>
        </button>
      </div>
    );
  };

  // Clean WHOOP / Apple / Nike 4-Digit Counter (Outfit tabular numerals, adaptive width for Round/Square)
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

  // Inner Watch Face Content (284x284 TRUE VERTICAL & HORIZONTAL CENTERING for both Round & Square)
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

      {/* Centered Content Stack (sits dead-center around vertical equator cy = 50%) */}
      <div className="w-full flex flex-col items-center justify-center gap-[11px] mb-[6px] z-10">
        {/* SCREEN 01: CONTADOR + AUTO-TIRO */}
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
                onClick={() => setScreenIdx(1)}
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

        {/* SCREEN 02: MÉTRICAS (KM/MI + KCAL) */}
        {screenIdx === 1 && (
          <>
            <WatchBrandHeader
              pillText={activeState.gpsActive ? "GPS ACTIVO · PASOS" : "DETECTOR DE PASOS"}
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
                  {activeState.gpsActive ? "GPS" : "AUTO"}
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
              {activeState.arrowsCount} FLECHAS · {activeState.bowPoundageLbs} LBS · SYNC EN VIVO
            </div>
          </>
        )}

        {/* SCREEN 03: AUTO-TIRO & SENSIBILIDAD */}
        {screenIdx === 2 && (
          <>
            <WatchBrandHeader
              pillText={
                activeState.autoDetectEnabled ? "SUELTA AUTOMÁTICA · +1" : "DETECTOR EN PAUSA"
              }
              pillColor="yellow"
              onClickPill={handleToggleAuto}
            />

            <WatchCounterChassis highlightGold={true} />

            <div
              className={`${
                isSquare ? "w-[214px]" : "w-[196px]"
              } flex items-center justify-between bg-[#07090E] border border-white/10 rounded-xl px-2.5 py-1.5`}
            >
              <button
                type="button"
                onClick={() =>
                  setSensitivity((s) => (s === "ALTA" ? "MEDIA" : s === "MEDIA" ? "BAJA" : "ALTA"))
                }
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
                className="bg-[#180709] border border-[#FF1E1E]/60 px-2 py-1 rounded-md text-[7.5px] font-extrabold text-white uppercase active:scale-95 transition cursor-pointer shrink-0"
              >
                −1
              </button>
            </div>
          </>
        )}

        {/* SCREEN 04: RESUMEN Y ENVÍO A COACH */}
        {screenIdx === 3 && (
          <>
            <WatchBrandHeader pillText="SINCRONIZADO CON COACH" pillColor="cyan" />

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
                  ENERGÍA
                </div>
                <div className="text-[14.5px] font-extrabold text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                  {activeState.activeKcal} <span className="text-[9px] text-[#8E96A4]">kcal</span>
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
      <div className="absolute bottom-[13px] left-0 right-0 flex items-center justify-center gap-[5px] z-10">
        {[0, 1, 2, 3].map((idx) => {
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

  // If opened directly on a Smartwatch browser (/watch)
  if (standaloneWatchScreen) {
    return (
      <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-2 select-none">
        <WatchFaceContent />
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 3) % 4)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase"
          >
            ◀ Anterior
          </button>
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 1) % 4)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase"
          >
            Siguiente ▶
          </button>
        </div>
      </div>
    );
  }

  const isWatchConnected = watchConnStatus.connectedNodesCount > 0;

  // Modal overlay inside the main app (WHOOP / Apple / Nike Matte OLED Design)
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10050] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-3.5 select-none"
      >
        <div className="w-full max-w-[380px] bg-[#06080C] border border-white/10 rounded-[26px] pt-[16px] pb-[16px] px-[15px] flex flex-col items-center gap-[12px] relative overflow-hidden">
          {/* Top 101010 tricolor line */}
          <div
            className="absolute top-0 left-12 right-12 h-[2px]"
            style={{
              background:
                "linear-gradient(90deg, transparent, #00A8F3 25%, #FF1E1E 50%, #FFE500 75%, transparent)"
            }}
          />

          {/* Compact Single-Line Header: Official Brand Logo + Live Pill + Sync + Close */}
          <div className="w-full flex items-center justify-between gap-[6px]">
            <div className="flex items-center gap-[8px] min-w-0">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className="h-[12px] w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
                draggable={false}
              />
              <div
                className={`inline-flex items-center gap-[4px] bg-[#04101C] border ${
                  isWatchConnected ? "border-[#00A8F3]/45" : "border-[#00A8F3]/35"
                } rounded-full px-[8px] py-[3px] shrink-0`}
                title={
                  isWatchConnected
                    ? `Reloj conectado: ${watchConnStatus.connectedNodes
                        .map((n) => n.displayName || "Wear OS")
                        .join(", ")}`
                    : "Motor Wear OS activo"
                }
              >
                <span className="w-[5px] h-[5px] rounded-full bg-[#00A8F3]" />
                <span className="text-[8.5px] font-extrabold text-white tracking-[0.06em] uppercase leading-none">
                  LIVE
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

          {/* Minimal Mode Switch (Redondo / Cuadrado) */}
          <div className="w-full grid grid-cols-2 gap-[4px] bg-[#030407] border border-white/[0.08] rounded-[12px] p-[3px]">
            <button
              type="button"
              onClick={() => setWatchShape("ROUND")}
              className={`text-center py-[6px] rounded-[9px] text-[9.5px] font-extrabold tracking-[0.08em] uppercase transition cursor-pointer ${
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
              className={`text-center py-[6px] rounded-[9px] text-[9.5px] font-extrabold tracking-[0.08em] uppercase transition cursor-pointer ${
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
            className={`p-[11px] relative bg-[#12151C] border-[1.5px] border-[#262B36] shadow-[0_14px_34px_rgba(0,0,0,0.85)] transition-all ${
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

          {/* Clean Bottom Navigation Tabs */}
          <div className="w-full grid grid-cols-4 gap-[6px]">
            {[
              { idx: 0, label: "CONTADOR" },
              { idx: 1, label: "MÉTRICAS" },
              { idx: 2, label: "AUTO-TIRO" },
              { idx: 3, label: "RESUMEN" }
            ].map((tab) => (
              <button
                key={tab.idx}
                type="button"
                onClick={() => setScreenIdx(tab.idx)}
                className={`py-[8px] px-[2px] rounded-[10px] text-[8.5px] font-extrabold uppercase tracking-[0.05em] text-center border transition cursor-pointer ${
                  screenIdx === tab.idx
                    ? "bg-[#081523] text-white border-[#00A8F3]"
                    : "bg-[#030407] text-[#7D8594] border-white/[0.08] hover:text-white"
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
