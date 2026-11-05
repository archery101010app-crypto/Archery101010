"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Watch, Smartphone, ChevronLeft, ChevronRight } from "lucide-react";
import {
  BiometricSessionSnapshot,
  formatKmAndMiles,
  readStoredWatchState,
  sendWatchCommand,
  subscribeWatchMessages,
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
  const [screenIdx, setScreenIdx] = useState<number>(0); // 0: Counter, 1: GPS+Kcal, 2: Auto-Shot Detector, 3: Coach Summary
  const [watchShape, setWatchShape] = useState<"ROUND" | "SQUARE">("ROUND");
  const [sensitivity, setSensitivity] = useState<"ALTA" | "MEDIA" | "BAJA">("ALTA");
  const [justDetectedShot, setJustDetectedShot] = useState<boolean>(false);
  const [wristImpulseLevel, setWristImpulseLevel] = useState<number>(0);

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
        // Standalone mode: dispatch command to phone session & update local fallback state
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

  // Automatic Wrist Release Detector using DeviceMotionEvent (Accelerometer + Gyroscope spike)
  const lastShotRef = useRef<number>(0);
  useEffect(() => {
    if (! isOpen || !activeState.autoDetectEnabled) return;
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;

    const thresholdMap = {
      ALTA: 17.5, // Sensitive for smooth compound/recurve release
      MEDIA: 21.5,
      BAJA: 26.0
    };
    const threshold = thresholdMap[sensitivity];

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
      // Refractory period of 3.2 seconds between arrows so walking or drawing doesn't double-count
      if (dynamicSpike >= threshold && now - lastShotRef.current > 3200) {
        lastShotRef.current = now;
        handleArrowDelta(1, "watch_auto");
      }
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [isOpen, activeState.autoDetectEnabled, sensitivity, handleArrowDelta]);

  const handleToggleAuto = () => {
    triggerHaptic(30);
    const next = !activeState.autoDetectEnabled;
    if (onToggleAutoDetect) {
      onToggleAutoDetect(next);
    } else {
      sendWatchCommand({ type: "TOGGLE_AUTO_DETECT", enabled: next });
      setInternalSnapshot((prev) => ({ ...prev, autoDetectEnabled: next }));
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

  // Crown / Bezel wheel rotation support on Smartwatch
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
  const kmVal = (Math.max(0, activeState.distanceWalkedM) / 1000).toFixed(2);
  const miVal = (Math.max(0, activeState.distanceWalkedM) / 1609.344).toFixed(2);
  const currentTanda =
    Math.floor(activeState.arrowsCount / Math.max(1, activeState.arrowsPerEnd || 6)) + 1;

  // Brand Header component: "ARCHERY 101010" on EVERY screen
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
        ? "border-[#FFF200]/65 text-white"
        : pillColor === "red"
        ? "border-[#FF0000]/65 text-white"
        : "border-[#00A8F3]/65 text-white";
    const dotClass =
      pillColor === "yellow"
        ? "bg-[#FFF200] shadow-[0_0_8px_#FFF200]"
        : pillColor === "red"
        ? "bg-[#FF0000] shadow-[0_0_8px_#FF0000]"
        : "bg-[#00A8F3] shadow-[0_0_8px_#00A8F3]";

    return (
      <div className="flex flex-col items-center gap-1 z-10">
        <div className="flex items-center gap-1.5 font-black tracking-[0.08em] text-[11.5px] leading-none select-none">
          <span className="text-white">ARCHERY</span>
          <span>
            <span className="text-[#00A8F3]">10</span>
            <span className="text-[#FF0000]">10</span>
            <span className="text-[#FFF200]">10</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onClickPill}
          className={`flex items-center justify-center gap-1.5 bg-white/[0.06] border ${borderClass} px-3 py-0.5 rounded-full text-[8.5px] font-black tracking-[0.11em] uppercase whitespace-nowrap transition active:scale-95 cursor-pointer`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-white">{pillText}</span>
        </button>
      </div>
    );
  };

  // 4-Digit Mechanical Drum Counter for Smartwatch
  const WatchMechanicalCounter = ({ highlightGold = false }: { highlightGold?: boolean }) => (
    <div
      className={`w-[236px] rounded-[16px] p-2.5 relative shadow-[inset_0_2px_8px_rgba(0,0,0,0.95),0_8px_20px_rgba(0,0,0,0.85)] border ${
        highlightGold ? "border-[#FFF200]/75" : "border-white/20"
      }`}
      style={{
        background: "linear-gradient(180deg, #11151E 0%, #06080C 50%, #0E121A 100%)"
      }}
    >
      {/* Top 101010 tricolor line on mechanical chassis */}
      <div
        className="absolute -top-[1px] left-6 right-6 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, #00A8F3 25%, #FF0000 50%, #FFF200 75%, transparent)"
        }}
      />
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#1E232D] border border-[#3E4554]" />
        <span className="text-[8.5px] font-black tracking-[0.15em] uppercase text-white whitespace-nowrap tabular-nums">
          {highlightGold
            ? `FLECHA #${activeState.arrowsCount} REGISTRADA`
            : "VOLUMEN · FLECHAS"}
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-[#1E232D] border border-[#3E4554]" />
      </div>

      <div className="grid grid-cols-4 gap-1.5 bg-[#020305] p-1.5 rounded-xl border border-white/15">
        {digits.map((digitStr, i) => {
          const num = Number(digitStr);
          const prevDigit = (num + 9) % 10;
          const nextDigit = (num + 1) % 10;
          const isUnits = i === 3;
          return (
            <div
              key={i}
              onClick={() => handleArrowDelta(1, "watch_manual")}
              className={`h-[58px] rounded-lg flex flex-col items-center justify-center relative overflow-hidden cursor-pointer select-none border ${
                isUnits
                  ? "border-[#FFF200]/75 shadow-[inset_0_0_10px_rgba(255,242,0,0.14)]"
                  : "border-white/20"
              }`}
              style={{
                background:
                  "linear-gradient(180deg, #030407 0%, #131822 28%, #1A212E 50%, #131822 72%, #030407 100%)"
              }}
            >
              <span className="font-mono text-[9.5px] font-bold text-white leading-none opacity-35 tabular-nums">
                {prevDigit}
              </span>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={`${i}-${digitStr}`}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 450, damping: 28 }}
                  className="font-mono text-[30px] font-extrabold leading-none my-0.5 text-white tabular-nums"
                >
                  {digitStr}
                </motion.span>
              </AnimatePresence>
              <span className="font-mono text-[9.5px] font-bold text-white leading-none opacity-35 tabular-nums">
                {nextDigit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Inner Watch Face Content (shared between standalone watch screen & phone watch preview)
  const WatchFaceContent = () => (
    <div
      onWheel={handleWheel}
      className={`relative w-[328px] h-[328px] bg-black border-2 border-white/15 flex flex-col items-center justify-between px-5 py-4 overflow-hidden select-none ${
        watchShape === "ROUND" ? "rounded-full" : "rounded-[56px]"
      }`}
      style={{
        background:
          "radial-gradient(circle at 50% 42%, #0B111C 0%, #030508 65%, #000000 100%)"
      }}
    >
      {/* Top 101010 DNA tricolor arc */}
      <div
        className="absolute top-0 left-[22%] right-[22%] h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, #00A8F3 25%, #FF0000 50%, #FFF200 75%, transparent)"
        }}
      />

      {/* SCREEN 01: MECHANICAL COUNTER + AUTO-SHOT */}
      {screenIdx === 0 && (
        <>
          <WatchBrandHeader
            pillText={
              justDetectedShot
                ? "SUELTA DETECTADA · +1"
                : activeState.autoDetectEnabled
                ? "AUTO-TIRO ACTIVO"
                : "MODO MANUAL"
            }
            pillColor={justDetectedShot ? "yellow" : "cyan"}
            onClickPill={handleToggleAuto}
          />

          <WatchMechanicalCounter highlightGold={justDetectedShot} />

          <div className="flex items-center justify-between w-[224px] gap-2 z-10">
            <button
              type="button"
              onClick={() => activeState.arrowsCount > 0 && handleArrowDelta(-1, "watch_manual")}
              className="w-11 h-8 rounded-full bg-[#FF0000]/20 border border-[#FF0000]/75 text-white text-xs font-black flex items-center justify-center active:scale-90 transition cursor-pointer tabular-nums"
            >
              −1
            </button>

            <div
              onClick={() => setScreenIdx(1)}
              className="flex flex-col items-center cursor-pointer text-center"
            >
              <div className="text-[11px] font-black text-white tracking-tight whitespace-nowrap tabular-nums">
                <span>{kmVal} km</span>
                <span className="text-white mx-1">·</span>
                <span>{activeState.activeKcal} kcal</span>
              </div>
              <span className="text-[8.5px] font-extrabold text-white tracking-[0.12em] uppercase whitespace-nowrap tabular-nums">
                TANDA {currentTanda} · {activeState.distanceM} M
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleArrowDelta(1, "watch_manual")}
              className="w-11 h-8 rounded-full bg-[#0A1826] border border-[#00A8F3] text-white text-xs font-black flex items-center justify-center shadow-[0_0_12px_rgba(0,168,243,0.3)] active:scale-90 transition cursor-pointer tabular-nums"
            >
              +1
            </button>
          </div>
        </>
      )}

      {/* SCREEN 02: DISTANCIA RECORRIDA (KM/MI) + KCAL */}
      {screenIdx === 1 && (
        <>
          <WatchBrandHeader
            pillText={activeState.gpsActive ? "GPS ACTIVO + PASOS" : "DETECTOR DE PASOS ACTIVO"}
            pillColor="yellow"
          />

          <div className="w-[236px] flex flex-col gap-2 z-10">
            <div className="bg-white/[0.04] border border-[#00A8F3]/60 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[8.5px] font-extrabold tracking-[0.12em] text-white uppercase whitespace-nowrap">
                  DISTANCIA RECORRIDA
                </div>
                <div className="text-[18px] font-black text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                  {kmVal}
                  <span className="text-[11.5px] font-extrabold text-white ml-0.5">km</span>
                  {" / "}
                  {miVal}
                  <span className="text-[11.5px] font-extrabold text-white ml-0.5">mi</span>
                </div>
              </div>
              <span className="text-[8.5px] font-black text-white border border-[#00A8F3]/60 bg-[#00A8F3]/15 px-2 py-1 rounded-lg uppercase shrink-0">
                {activeState.gpsActive ? "GPS" : "AUTO"}
              </span>
            </div>

            <div className="bg-white/[0.04] border border-[#FF0000]/60 rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[8.5px] font-extrabold tracking-[0.12em] text-white uppercase whitespace-nowrap">
                  KCAL
                </div>
                <div className="text-[20px] font-black text-white tracking-tight leading-tight mt-0.5 whitespace-nowrap tabular-nums">
                  {activeState.activeKcal}
                  <span className="text-[11.5px] font-extrabold text-white ml-1">kcal</span>
                </div>
              </div>
              <span className="text-[8.5px] font-black text-white border border-[#FFF200]/60 bg-[#FFF200]/15 px-2 py-1 rounded-lg uppercase shrink-0">
                ACTIVA
              </span>
            </div>
          </div>

          <div className="text-[9px] font-bold text-white tracking-wider uppercase whitespace-nowrap tabular-nums">
            {activeState.arrowsCount} flechas ({activeState.bowPoundageLbs} lbs)
          </div>
        </>
      )}

      {/* SCREEN 03: PULSO HÁPTICO DE TIRO & SENSIBILIDAD */}
      {screenIdx === 2 && (
        <>
          <WatchBrandHeader
            pillText={
              activeState.autoDetectEnabled ? "SUELTA AUTOMÁTICA · +1" : "DETECTOR EN PAUSA"
            }
            pillColor="yellow"
            onClickPill={handleToggleAuto}
          />

          <WatchMechanicalCounter highlightGold={true} />

          <div className="w-[232px] flex items-center justify-between bg-white/[0.04] border border-white/20 rounded-xl px-3 py-1.5 z-10">
            <button
              type="button"
              onClick={() =>
                setSensitivity((s) => (s === "ALTA" ? "MEDIA" : s === "MEDIA" ? "BAJA" : "ALTA"))
              }
              className="text-left cursor-pointer"
            >
              <div className="text-[8px] font-extrabold text-white tracking-[0.1em] uppercase whitespace-nowrap">
                SENSIBILIDAD ({sensitivity})
              </div>
              <div className="text-[10px] font-black text-white uppercase whitespace-nowrap">
                COMPUESTO / RECURVO
              </div>
            </button>

            <button
              type="button"
              onClick={() => activeState.arrowsCount > 0 && handleArrowDelta(-1, "watch_manual")}
              className="bg-[#FF0000]/20 border border-[#FF0000]/65 px-2.5 py-1 rounded-lg text-[8.5px] font-black text-white uppercase active:scale-95 transition cursor-pointer shrink-0"
            >
              DESHACER
            </button>
          </div>
        </>
      )}

      {/* SCREEN 04: RESUMEN Y ENVÍO A COACH */}
      {screenIdx === 3 && (
        <>
          <WatchBrandHeader pillText="SINCRONIZADO CON COACH" pillColor="cyan" />

          <div className="w-[236px] grid grid-cols-2 gap-1.5 z-10">
            <div className="bg-white/[0.04] border border-[#00A8F3]/55 rounded-xl p-2 text-center">
              <div className="text-[8px] font-extrabold text-white tracking-wider uppercase">
                FLECHAS
              </div>
              <div className="text-[17px] font-black text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                {activeState.arrowsCount}{" "}
                <span className="text-[10px] text-white">FL</span>
              </div>
            </div>

            <div className="bg-white/[0.04] border border-[#FF0000]/55 rounded-xl p-2 text-center">
              <div className="text-[8px] font-extrabold text-white tracking-wider uppercase">
                KCAL
              </div>
              <div className="text-[17px] font-black text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                {activeState.activeKcal}{" "}
                <span className="text-[10px] text-white">kcal</span>
              </div>
            </div>

            <div className="col-span-2 bg-white/[0.04] border border-[#FFF200]/55 rounded-xl p-2 text-center">
              <div className="text-[8px] font-extrabold text-white tracking-wider uppercase">
                DISTANCIA RECORRIDA
              </div>
              <div className="text-[15.5px] font-black text-white leading-tight mt-0.5 tabular-nums whitespace-nowrap">
                {formatKmAndMiles(activeState.distanceWalkedM, true)}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleFinishSession}
            className="w-[216px] py-2 rounded-full bg-[#0A1826] border border-[#00A8F3] text-white text-[9.5px] font-black tracking-[0.1em] uppercase shadow-[0_0_14px_rgba(0,168,243,0.3)] active:scale-95 transition cursor-pointer z-10 whitespace-nowrap"
          >
            GUARDAR Y ENVIAR A COACH
          </button>
        </>
      )}

      {/* Pager Dots */}
      <div className="flex items-center gap-1.5 z-10">
        {[0, 1, 2, 3].map((idx) => {
          const isCurrent = screenIdx === idx;
          const activeColor =
            idx === 0
              ? "bg-[#00A8F3] w-3.5"
              : idx === 1
              ? "bg-[#FF0000] w-3.5"
              : "bg-[#FFF200] w-3.5";
          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                triggerHaptic(15);
                setScreenIdx(idx);
              }}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                isCurrent ? activeColor : "w-1.5 bg-white/35"
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
            className="px-3.5 py-1.5 rounded-full bg-neutral-900 border border-white/20 text-white text-[10px] font-black uppercase"
          >
            ◀ Anterior
          </button>
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 1) % 4)}
            className="px-3.5 py-1.5 rounded-full bg-neutral-900 border border-white/20 text-white text-[10px] font-black uppercase"
          >
            Siguiente ▶
          </button>
        </div>
      </div>
    );
  }

  // Modal overlay inside the main app
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10050] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
      >
        <div className="w-full max-w-md bg-[#06080D] border border-white/15 rounded-3xl p-5 flex flex-col items-center gap-4 relative overflow-hidden">
          {/* Top 101010 tricolor line */}
          <div
            className="absolute top-0 left-12 right-12 h-[3px]"
            style={{
              background:
                "linear-gradient(90deg, transparent, #00A8F3 25%, #FF0000 50%, #FFF200 75%, transparent)"
            }}
          />

          {/* Modal Header */}
          <div className="w-full flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-black tracking-wider">
                <span className="text-white">ARCHERY</span>
                <span>
                  <span className="text-[#00A8F3]">10</span>
                  <span className="text-[#FF0000]">10</span>
                  <span className="text-[#FFF200]">10</span>
                </span>
                <span className="text-white text-[10px] ml-1">· SMARTWATCH</span>
              </div>
              <h3 className="text-white text-base font-black uppercase mt-0.5">
                Mini-App Reloj Abierto
              </h3>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/5 border border-white/20 text-white flex items-center justify-center hover:bg-white/10 cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Shape Switcher & Screen Selector */}
          <div className="w-full flex items-center justify-between gap-2 bg-black/60 border border-white/15 rounded-2xl p-1.5">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setWatchShape("ROUND")}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase transition cursor-pointer ${
                  watchShape === "ROUND"
                    ? "bg-[#0A1826] border border-[#00A8F3] text-white"
                    : "text-white hover:bg-white/5"
                }`}
              >
                Redondo (Garmin/WearOS)
              </button>
              <button
                type="button"
                onClick={() => setWatchShape("SQUARE")}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase transition cursor-pointer ${
                  watchShape === "SQUARE"
                    ? "bg-[#1C1804] border border-[#FFF200] text-white"
                    : "text-white hover:bg-white/5"
                }`}
              >
                Cuadrado (WatchOS)
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setScreenIdx((s) => (s + 3) % 4)}
                className="w-7 h-7 rounded-lg bg-white/5 border border-white/15 text-white flex items-center justify-center cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[10px] font-black text-white px-1 tabular-nums">
                {screenIdx + 1}/4
              </span>
              <button
                type="button"
                onClick={() => setScreenIdx((s) => (s + 1) % 4)}
                className="w-7 h-7 rounded-lg bg-white/5 border border-white/15 text-white flex items-center justify-center cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Realistic Watch Hardware Bezel wrapping the interactive screen */}
          <div
            className={`p-3.5 relative shadow-[0_20px_50px_rgba(0,0,0,0.95),inset_0_2px_4px_rgba(255,255,255,0.16)] border-2 border-[#22262E] ${
              watchShape === "ROUND" ? "rounded-full" : "rounded-[68px]"
            }`}
            style={{
              background:
                "radial-gradient(circle at 30% 25%, #272A30 0%, #111317 60%, #060709 100%)"
            }}
          >
            {/* Digital Crown on right side of watch hardware */}
            <button
              type="button"
              onClick={() => handleArrowDelta(1, "watch_manual")}
              title="Corona del reloj (+1 flecha)"
              className="absolute -right-[10px] top-1/2 -translate-y-1/2 w-[9px] h-12 rounded-r-md border border-[#4A4E58] cursor-pointer active:scale-95"
              style={{
                background: "linear-gradient(180deg, #3A3D45, #181A20, #3A3D45)"
              }}
            />
            <WatchFaceContent />
          </div>

          {/* Screen Quick Tabs */}
          <div className="w-full grid grid-cols-4 gap-1.5">
            {[
              { idx: 0, label: "1. Contador" },
              { idx: 1, label: "2. Km / Kcal" },
              { idx: 2, label: "3. Auto-Tiro" },
              { idx: 3, label: "4. Coach" }
            ].map((tab) => (
              <button
                key={tab.idx}
                type="button"
                onClick={() => setScreenIdx(tab.idx)}
                className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition cursor-pointer ${
                  screenIdx === tab.idx
                    ? "bg-[#0A1826] text-white border-[#00A8F3]"
                    : "bg-black/60 text-white border-white/15 hover:border-white/30"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Info footer */}
          <div className="w-full bg-white/[0.03] border border-white/15 rounded-2xl p-3 flex items-center justify-between text-[11px] text-white">
            <div className="flex items-center gap-2">
              <Watch size={15} className="text-[#00A8F3] shrink-0" />
              <span className="text-white">
                Compatible con <strong>Garmin IQ, Wear OS y WatchOS</strong>. Sincroniza en vivo con tu sesión y Coach.
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
