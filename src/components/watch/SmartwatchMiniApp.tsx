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
  refreshPhoneWatchPairingWindow,
  connectWatchClientToPairingCode,
  pauseWatchClientSubscription,
  disconnectWatchClientPairingCode,
  getActiveWatchClientPairingCode,
  subscribeCloudWatchPairingStatus
} from "@/lib/scoring/biometricsEngine";
import BleHeartRateModal from "./BleHeartRateModal";
import {
  BleHeartRateStatus,
  getBleHeartRateStatus,
  requestWatchAppHeartRate,
  subscribeBleHeartRate
} from "@/lib/scoring/bleHeartRateService";
import AnalysisDianaSvg from "@/components/analysis/AnalysisDianaSvg";
import {
  AnalysisCalibrationProfile,
  AnalysisShotRecord,
  analyzeImuShotWindow,
  decodeCompactShotAnalysis,
  encodeCompactShotAnalysis
} from "@/lib/scoring/shotAnalysisEngine";

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

interface WatchBrandHeaderProps {
  pillText: string;
  pillColor?: "cyan" | "yellow" | "red" | "muted";
  compact?: boolean;
  isSquare: boolean;
  onClickPill?: () => void;
}

const WatchBrandHeader = React.memo(function WatchBrandHeader({
  pillText,
  pillColor = "cyan",
  compact = false,
  isSquare,
  onClickPill
}: WatchBrandHeaderProps) {
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
});

interface WatchCounterChassisProps {
  isSquare: boolean;
  digits: string[];
  volumeLabel: string;
  highlightGold?: boolean;
}

const WatchCounterChassis = React.memo(function WatchCounterChassis({
  isSquare,
  digits,
  volumeLabel,
  highlightGold = false
}: WatchCounterChassisProps) {
  return (
    <div
      className={`${
        isSquare ? "w-[214px]" : "w-[192px]"
      } bg-[#07090E] rounded-[13px] pt-[6px] pb-[7px] px-[8px] border transition-all ${
        highlightGold ? "border-[#FFE500]/65" : "border-white/10"
      }`}
    >
      <div className="text-center text-[7px] font-bold tracking-[0.14em] text-[#8E96A4] uppercase mb-[4px] whitespace-nowrap tabular-nums">
        {volumeLabel}
      </div>

      <div className="grid grid-cols-4 gap-[5px] bg-[#030407] p-[4px] rounded-[9px] border border-white/[0.06]">
        {digits.map((digitStr, i) => {
          const isUnits = i === 3;
          return (
            <div
              key={i}
              className={`h-[38px] rounded-[6px] bg-[#0B0E15] flex items-center justify-center relative overflow-hidden select-none border ${
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
                  className={`font-sans text-[23.5px] font-extrabold leading-none tabular-nums ${
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
});

interface WatchFaceContentProps {
  isAnalysisWatchMode: boolean;
  isSquare: boolean;
  isEs: boolean;
  isSpanish: boolean;
  analysisPage: 0 | 1;
  setAnalysisPage: React.Dispatch<React.SetStateAction<0 | 1>>;
  screenIdx: number;
  setScreenIdx: React.Dispatch<React.SetStateAction<number>>;
  lastAnalysisShot: AnalysisShotRecord | null;
  activeState: BiometricSessionSnapshot;
  manualAnalysisStartMs: number | null;
  manualElapsedSec: number;
  justDetectedShot: boolean;
  liveAnalysisHr?: number;
  watchBowLabel: string;
  isWatchConnected: boolean;
  digits: string[];
  walkedPrimaryStr: string;
  walkedDualStr: string;
  currentTanda: number;
  visibleSlotsCount: number;
  endArrowsList: string[];
  bleHrStatus: BleHeartRateStatus;
  tx: (esText: string, enText: string) => string;
  triggerHaptic: (pattern?: number | number[]) => void;
  handlePhysicalWatchButton: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  handleWatchTouchStart: (e: React.TouchEvent) => void;
  handleWatchTouchEnd: (e: React.TouchEvent) => void;
  handleWatchPointerDown: (e: React.PointerEvent) => void;
  handleWatchPointerUp: (e: React.PointerEvent) => void;
  handleArrowDelta: (delta: number, source: "watch_manual" | "watch_auto") => void;
  handleScoreKeyPress: (val: string) => void;
  handleUndoScore: () => void;
  handleNextEnd: () => void;
  handleFinishSession: () => void;
}

const WatchFaceContent = React.memo(function WatchFaceContent({
  isAnalysisWatchMode,
  isSquare,
  isEs,
  isSpanish,
  analysisPage,
  setAnalysisPage,
  screenIdx,
  setScreenIdx,
  lastAnalysisShot,
  activeState,
  manualAnalysisStartMs,
  manualElapsedSec,
  justDetectedShot,
  liveAnalysisHr,
  watchBowLabel,
  isWatchConnected,
  digits,
  walkedPrimaryStr,
  walkedDualStr,
  currentTanda,
  visibleSlotsCount,
  endArrowsList,
  bleHrStatus,
  tx,
  triggerHaptic,
  handlePhysicalWatchButton,
  handleWheel,
  handleWatchTouchStart,
  handleWatchTouchEnd,
  handleWatchPointerDown,
  handleWatchPointerUp,
  handleArrowDelta,
  handleScoreKeyPress,
  handleUndoScore,
  handleNextEnd,
  handleFinishSession
}: WatchFaceContentProps) {
  if (isAnalysisWatchMode) {
    const shotNum = lastAnalysisShot?.shotNumber || activeState.arrowsCount || 0;
    return (
      <div
        dir="ltr"
        onTouchStart={handleWatchTouchStart}
        onTouchEnd={handleWatchTouchEnd}
        onPointerDown={handleWatchPointerDown}
        onPointerUp={handleWatchPointerUp}
        className={`relative w-[284px] h-[284px] bg-[#020305] border border-white/10 flex flex-col items-center justify-between touch-pan-y overscroll-x-none ${
          analysisPage === 0 ? "pt-[21px] pb-[11px] px-[14px]" : "pt-[19px] pb-[12px] px-[16px]"
        } overflow-hidden select-none transition-all ${
          isSquare ? "rounded-[48px]" : "rounded-full"
        }`}
      >
        <div
          className={`absolute inset-[4px] border border-white/[0.04] pointer-events-none ${
            isSquare ? "rounded-[44px]" : "rounded-full"
          }`}
        />

        {analysisPage === 0 ? (
          <>
            <div className="flex flex-col items-center gap-[3px] z-10 shrink-0">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className={`${isEs ? "h-[9.5px]" : "h-[9px]"} w-auto object-contain select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]`}
                draggable={false}
              />
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(15);
                  setAnalysisPage(1);
                }}
                className={`inline-flex items-center gap-[4px] rounded-full px-[9px] py-[2px] text-[8px] font-extrabold tracking-[0.07em] text-white uppercase whitespace-nowrap tabular-nums border cursor-pointer active:scale-95 transition ${
                  manualAnalysisStartMs
                    ? "bg-[#151105] border-[#FFE500]/75"
                    : "bg-[#080B10] border-white/[0.14]"
                }`}
              >
                <span
                  className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                    manualAnalysisStartMs
                      ? "bg-[#FFE500] animate-pulse"
                      : justDetectedShot
                      ? "bg-[#FFE500]"
                      : "bg-[#00BFFF]"
                  }`}
                />
                <span>
                  {manualAnalysisStartMs
                    ? `${tx("Grabando", "Rec")} · ${manualElapsedSec.toFixed(1)}s`
                    : shotNum > 0
                    ? `${tx("Tiro", "Shot")} ${shotNum} · ${activeState.distanceM}m`
                    : `${tx("Listo", "Ready")} · ${activeState.distanceM}m`}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={handlePhysicalWatchButton}
              aria-label={
                manualAnalysisStartMs
                  ? tx("Finalizar tiro", "End shot")
                  : tx("Iniciar tiro", "Start shot")
              }
              className="flex-1 flex items-center justify-center z-[5] my-[1px] cursor-pointer active:scale-[0.98] transition"
            >
              <AnalysisDianaSvg shot={lastAnalysisShot} sizePx={124} compactWatchMode />
            </button>

            <div className="flex flex-col items-center gap-[5px] z-10 shrink-0 w-full">
              <button
                type="button"
                onClick={handlePhysicalWatchButton}
                className={`w-[184px] h-[44px] rounded-full text-[14px] font-black uppercase tracking-[0.07em] flex items-center justify-center gap-[6px] cursor-pointer active:scale-95 transition tabular-nums border ${
                  manualAnalysisStartMs
                    ? "bg-[#FF1E1E] text-white border-white/35"
                    : "bg-[#00BFFF] text-black border-white/20"
                }`}
              >
                <span>{manualAnalysisStartMs ? "■" : "▶"}</span>
                <span>{manualAnalysisStartMs ? tx("Final", "End") : tx("Inicio", "Start")}</span>
              </button>

              <div className="flex items-center gap-[5px]">
                {[0, 1].map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      setAnalysisPage(idx as 0 | 1);
                    }}
                    aria-label={tx(`Pantalla ${idx + 1}`, `Screen ${idx + 1}`)}
                    className={`h-[4px] rounded-full transition-all cursor-pointer ${
                      analysisPage === idx ? "w-[13px] bg-[#00BFFF]" : "w-[4px] bg-white/22"
                    }`}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-[4px] z-10 shrink-0">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className="h-[9.5px] w-auto object-contain select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]"
                draggable={false}
              />
              <div className="inline-flex items-center gap-[5px] bg-[#080B10] border border-white/[0.13] rounded-full px-[10px] py-[2px] text-[8.3px] font-extrabold tracking-[0.08em] text-white uppercase whitespace-nowrap tabular-nums">
                <span className="w-[5px] h-[5px] rounded-full bg-[#00BFFF] shrink-0" />
                <span>
                  {shotNum > 0
                    ? `${tx("Datos · Tiro", "Data · Shot")} ${shotNum}`
                    : tx("Datos · En Espera", "Data · Standby")}
                </span>
              </div>
            </div>

            <div className="w-[200px] flex flex-col gap-[5.5px] z-10">
              <div className="h-[45px] bg-[#0A0D14] border border-white/[0.10] rounded-[13px] px-[12px] flex items-center justify-between">
                <div className="flex flex-col gap-[0.5px]">
                  <span className="text-[8.8px] font-extrabold tracking-[0.08em] text-white uppercase">
                    {tx("Estabilidad", "Stability")}
                  </span>
                  <span className="text-[8.3px] font-semibold text-white tabular-nums">
                    {lastAnalysisShot ? `±${lastAnalysisShot.swayRadiusCm.toFixed(1)} cm` : "—"}
                  </span>
                </div>
                <span className="text-[20px] font-black text-white tracking-[-0.02em] leading-none tabular-nums">
                  {lastAnalysisShot ? (
                    <>
                      {lastAnalysisShot.stabilityPct}
                      <span className="text-[10.5px] font-bold ml-[2px]">%</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-[5.5px]">
                <div className="h-[50px] bg-[#0A0D14] border border-white/[0.10] rounded-[13px] py-[6px] px-[9px] flex flex-col justify-between min-w-0">
                  <div className={`flex items-center gap-[4.5px]${isEs ? "" : " min-w-0"}`}>
                    <span className="w-[9px] h-0 border-t-2 border-dashed border-white shrink-0" />
                    <span
                      className={`text-[7.5px] font-black tracking-[0.04em] text-white uppercase ${
                        isEs ? "whitespace-nowrap" : "break-words leading-tight"
                      }`}
                    >
                      {tx("Preparatorio", "Preparatory")}
                    </span>
                  </div>
                  <span className="text-[19px] font-black text-white tracking-[-0.02em] leading-none tabular-nums">
                    {lastAnalysisShot ? (
                      <>
                        {lastAnalysisShot.prepSeconds.toFixed(1)}
                        <span className="text-[10.5px] font-bold ml-[2px]">s</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>

                <div className="h-[50px] bg-[#0A0D14] border border-white/[0.10] rounded-[13px] py-[6px] px-[9px] flex flex-col justify-between">
                  <div className="flex items-center gap-[4.5px]">
                    <span className="w-[9px] h-[2.5px] rounded-full bg-[#00BFFF] shrink-0" />
                    <span className="text-[7.5px] font-black tracking-[0.04em] text-white uppercase whitespace-nowrap">
                      {tx("Apuntado", "Aiming")}
                    </span>
                  </div>
                  <span className="text-[19px] font-black text-white tracking-[-0.02em] leading-none tabular-nums">
                    {lastAnalysisShot ? (
                      <>
                        {lastAnalysisShot.aimSeconds.toFixed(1)}
                        <span className="text-[10.5px] font-bold ml-[2px]">s</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              </div>

              <div className="h-[45px] bg-[#0A0D14] border border-white/[0.10] rounded-[13px] px-[12px] flex items-center justify-between">
                <div className="flex flex-col gap-[0.5px]">
                  <span className="text-[8.8px] font-extrabold tracking-[0.08em] text-white uppercase">
                    {tx("Pulsaciones", "Heart Rate")}
                  </span>
                  <span className="text-[8.3px] font-semibold text-white">
                    {tx("En disparo", "At release")}
                  </span>
                </div>
                <span className="text-[20px] font-black text-white tracking-[-0.02em] leading-none tabular-nums">
                  {liveAnalysisHr ? (
                    <>
                      {liveAnalysisHr}
                      <span className="text-[10.5px] font-bold ml-[2px]">BPM</span>
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-[4px] z-10 shrink-0">
              <span
                className={`text-[7.8px] font-extrabold tracking-[0.09em] text-white uppercase tabular-nums${
                  isEs ? "" : " max-w-[144px] break-words leading-tight"
                }`}
              >
                {activeState.distanceM}m · {watchBowLabel}
              </span>
              <div className="flex items-center gap-[5px]">
                {[0, 1].map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      triggerHaptic(15);
                      setAnalysisPage(idx as 0 | 1);
                    }}
                    aria-label={tx(`Pantalla ${idx + 1}`, `Screen ${idx + 1}`)}
                    className={`h-[4px] rounded-full transition-all cursor-pointer ${
                      analysisPage === idx ? "w-[13px] bg-[#00BFFF]" : "w-[4px] bg-white/22"
                    }`}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      dir="ltr"
      onWheel={handleWheel}
      onTouchStart={handleWatchTouchStart}
      onTouchEnd={handleWatchTouchEnd}
      onPointerDown={handleWatchPointerDown}
      onPointerUp={handleWatchPointerUp}
      className={`relative w-[284px] h-[284px] bg-[#020305] border border-white/10 flex flex-col items-center justify-center px-[16px] overflow-hidden select-none touch-pan-y overscroll-x-none transition-all ${
        isSquare ? "rounded-[48px]" : "rounded-full"
      }`}
    >
      <div
        className={`absolute inset-[4px] border border-white/[0.04] pointer-events-none ${
          isSquare ? "rounded-[44px]" : "rounded-full"
        }`}
      />

      <div
        className={`w-full flex flex-col items-center justify-center ${
          screenIdx === 1
            ? "gap-[4.5px] mb-[11px]"
            : screenIdx === 0
            ? "gap-[7px] mb-[8px]"
            : "gap-[10px] mb-[6px]"
        } z-10`}
      >
        {screenIdx === 0 && (
          <>
            <WatchBrandHeader
              isSquare={isSquare}
              pillText={isWatchConnected ? tx("CONECTADO", "CONNECTED") : tx("MANUAL", "MANUAL")}
              pillColor={isWatchConnected ? "cyan" : "muted"}
            />

            <WatchCounterChassis
              isSquare={isSquare}
              digits={digits}
              volumeLabel={tx("VOLUMEN · FLECHAS", "VOLUME · ARROWS")}
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[192px]"} grid grid-cols-2 gap-[8px]`}>
              <button
                type="button"
                onClick={() => activeState.arrowsCount > 0 && handleArrowDelta(-1, "watch_manual")}
                aria-label={tx("−1 flecha", "−1 arrow")}
                className="h-[40px] rounded-[12px] bg-[#180709] border-[1.5px] border-[#FF1E1E]/75 text-white text-[16.5px] font-extrabold flex items-center justify-center active:scale-95 transition cursor-pointer tabular-nums"
              >
                −1
              </button>

              <button
                type="button"
                onClick={() => handleArrowDelta(1, "watch_manual")}
                aria-label={tx("+1 flecha", "+1 arrow")}
                className="h-[40px] rounded-[12px] bg-[#061523] border-[1.5px] border-[#00A8F3] text-white text-[16.5px] font-extrabold flex items-center justify-center active:scale-95 transition cursor-pointer tabular-nums"
              >
                +1
              </button>
            </div>

            <div
              onClick={() => setScreenIdx(2)}
              className="flex flex-col items-center cursor-pointer text-center leading-tight"
            >
              <div className="text-[10px] font-extrabold text-white tracking-[0.01em] whitespace-nowrap tabular-nums">
                {walkedPrimaryStr} · {activeState.activeKcal} kcal
              </div>
              <span className="text-[7.8px] font-bold text-[#8E96A4] tracking-[0.09em] uppercase whitespace-nowrap tabular-nums mt-[1px]">
                {tx("TANDA", "END")} {currentTanda} · {activeState.distanceM} M
              </span>
            </div>
          </>
        )}

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

        {screenIdx === 2 && (
          <>
            <WatchBrandHeader
              isSquare={isSquare}
              pillText={tx("BIOMETRÍA · PASOS", "BIOMETRICS · STEPS")}
              pillColor="yellow"
            />

            <div className={`${isSquare ? "w-[214px]" : "w-[196px]"} flex flex-col gap-1.5`}>
              <div className="bg-[#07090E] border border-[#00A8F3]/45 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className={`text-[7.5px] font-bold tracking-[0.12em] text-[#8E96A4] uppercase ${
                      isEs ? "whitespace-nowrap" : "min-w-0 break-words leading-tight"
                    }`}
                  >
                    {tx("DISTANCIA RECORRIDA", "WALKED DISTANCE")}
                  </div>
                  <div
                    className={`text-[13.5px] font-extrabold text-white tracking-tight leading-tight mt-0.5 tabular-nums ${
                      isEs ? "whitespace-nowrap" : "min-w-0 break-words leading-tight"
                    }`}
                  >
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

        {screenIdx === 3 && (
          <>
            <WatchBrandHeader
              isSquare={isSquare}
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

      <div className="absolute bottom-[12px] left-0 right-0 flex items-center justify-center gap-[5px] z-10">
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
              aria-label={tx(`Pantalla ${idx + 1}`, `Screen ${idx + 1}`)}
            />
          );
        })}
      </div>
    </div>
  );
});

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
  const isEs = language === "es";

  // 0: Contador, 1: Puntos (X..M), 2: Métricas, 3: Auto-Tiro, 4: Resumen
  const [screenIdx, setScreenIdx] = useState<number>(0);
  const [analysisPage, setAnalysisPage] = useState<0 | 1>(0);
  const [lastAnalysisShot, setLastAnalysisShot] = useState<AnalysisShotRecord | null>(null);
  const [manualAnalysisStartMs, setManualAnalysisStartMs] = useState<number | null>(null);
  const [manualElapsedSec, setManualElapsedSec] = useState<number>(0);
  const manualAnalysisStartRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const pointerStartXRef = useRef<number | null>(null);
  const [watchShape, setWatchShape] = useState<"ROUND" | "SQUARE">("ROUND");
  const [sensitivity, setSensitivity] = useState<"ALTA" | "MEDIA" | "BAJA">("MEDIA");
  const [justDetectedShot, setJustDetectedShot] = useState<boolean>(false);
  const [, setWristImpulseLevel] = useState<number>(0);
  const [iosMotionNeedsPermission, setIosMotionNeedsPermission] = useState<boolean>(false);
  const [iosMotionGranted, setIosMotionGranted] = useState<boolean>(false);

  // 6-Digit Cloud Watch Pairing state
  const [pairingCode, setPairingCode] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isRegeneratingCode, setIsRegeneratingCode] = useState<boolean>(false);
  const [cloudStatus, setCloudStatus] = useState<CloudWatchPairingStatus>({
    pairingCode: "",
    cloudConnected: false,
    cloudSyncError: "",
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
  const isAnalysisWatchMode = Boolean(
    activeState.analysisMode || activeState.practiceType === "Análisis"
  );

  const lastHandledManualCaptureAtRef = useRef<number>(0);
  const lastHandledManualStartAtRef = useRef<number>(0);
  const lastHandledManualStopAtRef = useRef<number>(0);

  const triggerHaptic = useCallback((pattern: number | number[] = 45) => {
    try {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {}
  }, []);

  // Dual-Key Biomechanical + High-Frequency Acoustic String-Snap Detector (Standalone /watch only)
  const lastShotRef = useRef<number>(0);
  const lastAcousticSnapRef = useRef<number>(0);
  const micActiveRef = useRef<boolean>(false);
  const motionBufRef = useRef<
    Array<{
      t: number;
      ax: number;
      ay: number;
      az: number;
      gx?: number;
      gy?: number;
      gz?: number;
      mag: number;
      lin: number;
      gyro: number;
    }>
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

  const emitAnalysisShotRef = useRef<
    (releaseTs: number, source: "watch_auto" | "watch_manual", manualStartTs?: number) => void
  >(() => {});

  useEffect(() => {
    emitAnalysisShotRef.current = (
      releaseTs: number,
      _source: "watch_auto" | "watch_manual",
      manualStartTs?: number
    ) => {
      const calibration: AnalysisCalibrationProfile = {
        bowType:
          activeState.bowType === "Compound" ||
          activeState.bowType === "Recurve" ||
          activeState.bowType === "Barebow"
            ? activeState.bowType
            : "Barebow",
        bowWrist: "LEFT",
        distanceM: activeState.distanceM || 18,
        zeroGravityVec: [0, 0, 9.81],
        calibratedAt: Date.now()
      };
      if (activeState.analysisCalibrationJson) {
        try {
          const parsed = JSON.parse(activeState.analysisCalibrationJson);
          if (parsed && typeof parsed === "object") {
            if (
              parsed.bowType === "Compound" ||
              parsed.bowType === "Recurve" ||
              parsed.bowType === "Barebow"
            ) {
              calibration.bowType = parsed.bowType;
            }
            if (parsed.bowWrist === "LEFT" || parsed.bowWrist === "RIGHT") {
              calibration.bowWrist = parsed.bowWrist;
            }
            if (typeof parsed.distanceM === "number" && parsed.distanceM >= 5) {
              calibration.distanceM = parsed.distanceM;
            }
            if (Array.isArray(parsed.zeroGravityVec) && parsed.zeroGravityVec.length === 3) {
              calibration.zeroGravityVec = parsed.zeroGravityVec as [number, number, number];
            }
          }
        } catch {}
      }

      const liveHr =
        bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
          ? bleHrStatus.currentBpm
          : activeState.heartRateBpm && activeState.heartRateBpm >= 30
          ? activeState.heartRateBpm
          : undefined;

      const nextShotNum = Math.max(1, (activeState.arrowsCount || 0) + 1);
      const analyzed = analyzeImuShotWindow({
        samples: motionBufRef.current,
        releaseTimestampMs: releaseTs,
        ...(manualStartTs && manualStartTs > 0 ? { manualStartTimestampMs: manualStartTs } : {}),
        shotNumber: nextShotNum,
        distanceM: calibration.distanceM || activeState.distanceM || 18,
        bowType: calibration.bowType || "Barebow",
        bowWrist: calibration.bowWrist || "LEFT",
        zeroGravityVec: calibration.zeroGravityVec,
        heartRateBpm: liveHr
      });

      if (!analyzed) return;

      triggerHaptic([45, 35, 65]);
      setLastAnalysisShot(analyzed);
      setJustDetectedShot(true);
      window.setTimeout(() => setJustDetectedShot(false), 3200);

      sendWatchCommand({
        type: "ANALYSIS_SHOT",
        analysisShotJson: encodeCompactShotAnalysis(analyzed),
        ...(liveHr ? { heartRateBpm: liveHr } : {})
      });

      if (!liveSnapshot) {
        setInternalSnapshot((prev) => ({
          ...prev,
          arrowsCount: Math.max(prev.arrowsCount + 1, analyzed.shotNumber),
          lastShotTimestamp: releaseTs,
          updatedAt: Date.now()
        }));
      }
    };
  }, [
    activeState.arrowsCount,
    activeState.analysisCalibrationJson,
    activeState.bowType,
    activeState.distanceM,
    activeState.heartRateBpm,
    bleHrStatus.currentBpm,
    bleHrStatus.state,
    liveSnapshot,
    triggerHaptic
  ]);

  useEffect(() => {
    manualAnalysisStartRef.current = manualAnalysisStartMs;
    if (!manualAnalysisStartMs) {
      setManualElapsedSec(0);
      return;
    }
    const updateElapsed = () => {
      setManualElapsedSec(Math.max(0, (Date.now() - manualAnalysisStartMs) / 1000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [manualAnalysisStartMs]);

  useEffect(() => {
    if (!activeState.analysisCalibrationJson) return;
    try {
      const parsed = JSON.parse(activeState.analysisCalibrationJson);
      const reqStart = Number(parsed?.manualStartAt) || 0;
      const reqStop = Number(parsed?.manualStopAt) || 0;
      const reqTs = Number(parsed?.manualCaptureAt) || 0;

      if (
        reqStart > 0 &&
        reqStart !== lastHandledManualStartAtRef.current &&
        Date.now() - reqStart <= 25_000
      ) {
        lastHandledManualStartAtRef.current = reqStart;
        if (reqStop < reqStart) {
          manualAnalysisStartRef.current = reqStart;
          setManualAnalysisStartMs(reqStart);
        }
      }

      if (
        reqStop > 0 &&
        reqStop !== lastHandledManualStopAtRef.current &&
        Date.now() - reqStop <= 15_000
      ) {
        if (lastHandledManualStopAtRef.current === 0 && Date.now() - reqStop > 4_000) {
          lastHandledManualStopAtRef.current = reqStop;
        } else {
          lastHandledManualStopAtRef.current = reqStop;
          const startedAt = manualAnalysisStartRef.current;
          manualAnalysisStartRef.current = null;
          setManualAnalysisStartMs(null);
          if (isStandalone) {
            emitAnalysisShotRef.current(Date.now(), "watch_manual", startedAt || undefined);
          }
        }
      }

      if (
        isStandalone &&
        reqTs > 0 &&
        reqTs !== lastHandledManualCaptureAtRef.current &&
        Date.now() - reqTs <= 15_000
      ) {
        if (lastHandledManualCaptureAtRef.current === 0 && Date.now() - reqTs > 4_000) {
          lastHandledManualCaptureAtRef.current = reqTs;
          return;
        }
        lastHandledManualCaptureAtRef.current = reqTs;
        const startedAt = manualAnalysisStartRef.current;
        manualAnalysisStartRef.current = null;
        setManualAnalysisStartMs(null);
        emitAnalysisShotRef.current(Date.now(), "watch_manual", startedAt || undefined);
      }
    } catch {}
  }, [isStandalone, activeState.analysisCalibrationJson]);

  useEffect(() => {
    if ((activeState.arrowsCount || 0) === 0) {
      setLastAnalysisShot(null);
      manualAnalysisStartRef.current = null;
      setManualAnalysisStartMs(null);
    }
  }, [activeState.arrowsCount, activeState.sessionId]);

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

  const [connEvalTs, setConnEvalTs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isOpen || !isPageVisible) return;
    const unsubConn = subscribeWatchConnectionStatus((status) => {
      setWatchConnStatus(status);
      setConnEvalTs(Date.now());
    });
    const unsubCloud = subscribeCloudWatchPairingStatus((st) => {
      setCloudStatus(st);
      setConnEvalTs(Date.now());
      if (st.pairingCode) {
        setPairingCode(st.pairingCode);
      }
      if (isStandalone && st.cloudSyncError === "SESSION_EXPIRED") {
        setShowStandaloneLinkPanel(true);
      }
    });
    const tick = window.setInterval(() => setConnEvalTs(Date.now()), 15_000);
    return () => {
      window.clearInterval(tick);
      unsubConn();
      unsubCloud();
    };
  }, [isOpen, isPageVisible, isStandalone]);

  // Phone mode: load or generate the archer's 6-digit Cloud Pairing Code and keep the 120s claim window fresh while open
  useEffect(() => {
    if (!isOpen || isStandalone) return;
    let cancelled = false;

    const initForUid = async (uid: string) => {
      if (!uid || cancelled) return;
      const code = await getOrCreatePhoneWatchPairingCode(uid);
      if (!cancelled && code) {
        setPairingCode(code);
        refreshPhoneWatchPairingWindow(uid, true).catch(() => {});
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

    const refreshInterval = window.setInterval(() => {
      if (!isPageVisible) return;
      const curUid = auth.currentUser?.uid || "";
      if (curUid) {
        refreshPhoneWatchPairingWindow(curUid, false)
          .then((nextCode) => {
            if (!cancelled && nextCode) setPairingCode(nextCode);
          })
          .catch(() => {});
      }
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      unsubAuth();
    };
  }, [isOpen, isStandalone, isPageVisible]);

  // Standalone /watch mode: attach real-time Firestore onSnapshot when visible, pause subscription WITHOUT unlinking when hidden
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
      pauseWatchClientSubscription();
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
      } else if (msg.type === "ANALYSIS_MANUAL_START") {
        const startTs = typeof msg.ts === "number" && msg.ts > 0 ? msg.ts : Date.now();
        manualAnalysisStartRef.current = startTs;
        setManualAnalysisStartMs(startTs);
      } else if (msg.type === "ANALYSIS_MANUAL_STOP") {
        const startedAt = manualAnalysisStartRef.current;
        manualAnalysisStartRef.current = null;
        setManualAnalysisStartMs(null);
        if (isStandalone) {
          emitAnalysisShotRef.current(Date.now(), "watch_manual", startedAt || undefined);
        }
      } else if (msg.type === "ANALYSIS_MANUAL_CAPTURE" && isStandalone) {
        const startedAt = manualAnalysisStartRef.current;
        manualAnalysisStartRef.current = null;
        setManualAnalysisStartMs(null);
        emitAnalysisShotRef.current(Date.now(), "watch_manual", startedAt || undefined);
      } else if (msg.type === "ANALYSIS_CALIBRATE_ZERO" && isStandalone) {
        window.setTimeout(() => {
          const recent = motionBufRef.current.slice(-25);
          if (recent.length >= 3) {
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (const s of recent) {
              sx += s.ax;
              sy += s.ay;
              sz += s.az;
            }
            const vec: [number, number, number] = [
              Number((sx / recent.length).toFixed(3)),
              Number((sy / recent.length).toFixed(3)),
              Number((sz / recent.length).toFixed(3))
            ];
            sendWatchCommand({ type: "ANALYSIS_ZERO_VECTOR", zeroGravityVec: vec });
          }
        }, 2200);
      } else if (msg.type === "ANALYSIS_SHOT" && msg.analysisShotJson) {
        manualAnalysisStartRef.current = null;
        setManualAnalysisStartMs(null);
        const decoded = decodeCompactShotAnalysis(msg.analysisShotJson);
        if (decoded) setLastAnalysisShot(decoded);
      }
    });
    sendWatchCommand({ type: "REQUEST_STATE" });
    return unsub;
  }, [liveSnapshot, isOpen, isPageVisible, isStandalone]);

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

  // Honest Watch Connection State: true when native companion watch is connected (CapabilityClient
  // OR active Bluetooth PONG/message in the last 3m) OR 6-Digit Cloud Watch session is linked!
  const nowConnMs = connEvalTs;
  const hasRecentNativeActivity =
    watchConnStatus.bridgeReady &&
    ((watchConnStatus.lastPongAt > 0 && nowConnMs - watchConnStatus.lastPongAt <= 3 * 60 * 1000) ||
      (watchConnStatus.lastMessageAt > 0 &&
        nowConnMs - watchConnStatus.lastMessageAt <= 3 * 60 * 1000));
  const hasNativeWatchAppConnected =
    watchConnStatus.bridgeReady &&
    ((watchConnStatus.connectedNodesCount > 0 &&
      (watchConnStatus.watchAppInstalledCount ?? 0) > 0) ||
      hasRecentNativeActivity);
  const hasCloudWatchLinked =
    cloudStatus.watchLinked &&
    cloudStatus.lastWatchSeenAt > 0 &&
    nowConnMs - cloudStatus.lastWatchSeenAt <= 10 * 60 * 1000;
  const isWatchConnected = hasNativeWatchAppConnected || hasCloudWatchLinked;

  // Manual-only watch counter: microphone acoustic auto-shot is permanently disabled
  useEffect(() => {
    micActiveRef.current = false;
    lastAcousticSnapRef.current = 0;
  }, []);

  useEffect(() => {
    // Run wrist IMU capture on standalone watch (/watch) ONLY when Análisis mode is active
    if (!isOpen || !isPageVisible || !isStandalone || !isAnalysisWatchMode) {
      return;
    }
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

    let lastImpulseUiUpdateMs = 0;

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
      let gx = 0;
      let gy = 0;
      let gz = 0;
      if (event.rotationRate) {
        const degToRad = Math.PI / 180;
        // W3C DeviceMotionEvent: beta = X-axis, gamma = Y-axis, alpha = Z-axis
        gx = (event.rotationRate.beta || 0) * degToRad;
        gy = (event.rotationRate.gamma || 0) * degToRad;
        gz = (event.rotationRate.alpha || 0) * degToRad;
        gyroRad = Math.sqrt(gx * gx + gy * gy + gz * gz);
      }

      if (now - lastImpulseUiUpdateMs >= 160) {
        lastImpulseUiUpdateMs = now;
        setWristImpulseLevel(Math.min(100, Math.round((lin / cfg.threshold) * 100)));
      }

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
            const acousticGateOk = hasAcousticKey || (isAnalysisWatchMode && !micActiveRef.current);
            if (
              isAnalysisWatchMode &&
              Boolean(activeState.autoDetectEnabled) &&
              !manualAnalysisStartRef.current &&
              validFollow &&
              acousticGateOk &&
              now - lastShotRef.current > cfg.cooldown
            ) {
              lastShotRef.current = now;
              lastAcousticSnapRef.current = 0;
              emitAnalysisShotRef.current(pending.startMs, "watch_auto");
            }
          }
        }
      } else if (
        isAnalysisWatchMode &&
        Boolean(activeState.autoDetectEnabled) &&
        !manualAnalysisStartRef.current &&
        !isWalkingBlocked &&
        lin >= cfg.threshold &&
        now - lastShotRef.current > cfg.cooldown
      ) {
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

      buf.push({ t: now, ax, ay, az, gx, gy, gz, mag, lin, gyro: gyroRad });
      while (buf.length && now - buf[0].t > 32000) buf.shift();
    };

    window.addEventListener("devicemotion", handleMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [
    isOpen,
    isPageVisible,
    activeState.autoDetectEnabled,
    isAnalysisWatchMode,
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

  const handleRegeneratePairingCode = async () => {
    const uid = auth.currentUser?.uid || "";
    if (!uid || isRegeneratingCode) return;
    triggerHaptic(30);
    setIsRegeneratingCode(true);
    try {
      const fresh = await getOrCreatePhoneWatchPairingCode(uid, true);
      if (fresh) {
        setPairingCode(fresh);
        publishWatchState(activeState);
      }
    } finally {
      setIsRegeneratingCode(false);
    }
  };

  const handleManualAnalysisStart = useCallback(() => {
    if (manualAnalysisStartRef.current) return;
    const now = Date.now();
    triggerHaptic(50);
    manualAnalysisStartRef.current = now;
    setManualAnalysisStartMs(now);
    sendWatchCommand({ type: "ANALYSIS_MANUAL_START", ts: now, source: "watch_manual" });
  }, [triggerHaptic]);

  const handleManualAnalysisStop = useCallback(() => {
    const startedAt = manualAnalysisStartRef.current;
    if (!startedAt) return;
    const now = Date.now();
    manualAnalysisStartRef.current = null;
    setManualAnalysisStartMs(null);
    if (isStandalone) {
      emitAnalysisShotRef.current(now, "watch_manual", startedAt);
    } else {
      triggerHaptic([45, 35, 65]);
      sendWatchCommand({ type: "ANALYSIS_MANUAL_STOP", ts: now, source: "watch_manual" });
    }
  }, [isStandalone, triggerHaptic]);

  const handlePhysicalWatchButton = useCallback(() => {
    if (isAnalysisWatchMode) {
      if (manualAnalysisStartRef.current) {
        handleManualAnalysisStop();
      } else {
        handleManualAnalysisStart();
      }
      return;
    }
    handleArrowDelta(1, "watch_manual");
  }, [
    isAnalysisWatchMode,
    handleManualAnalysisStart,
    handleManualAnalysisStop,
    handleArrowDelta
  ]);

  useEffect(() => {
    if (!isOpen || !isStandalone || !isAnalysisWatchMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " || e.key === "Enter" || e.key === "MediaPlayPause") {
        e.preventDefault();
        handlePhysicalWatchButton();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isStandalone, isAnalysisWatchMode, handlePhysicalWatchButton]);

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

  const handleWatchTouchStart = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
    }
  };

  const handleWatchTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || !e.changedTouches || e.changedTouches.length === 0) {
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(dx) < 28) return;
    triggerHaptic(15);
    if (isAnalysisWatchMode) {
      setAnalysisPage(dx < 0 ? 1 : 0);
    } else if (dx < 0) {
      setScreenIdx((prev) => (prev + 1) % 4);
    } else {
      setScreenIdx((prev) => (prev + 3) % 4);
    }
  };

  const handleWatchPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      pointerStartXRef.current = e.clientX;
    }
  };
  const handleWatchPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pointerStartXRef.current === null) return;
    const dx = e.clientX - pointerStartXRef.current;
    pointerStartXRef.current = null;
    if (Math.abs(dx) < 28) return;
    triggerHaptic(15);
    if (isAnalysisWatchMode) {
      setAnalysisPage(dx < 0 ? 1 : 0);
    } else if (dx < 0) {
      setScreenIdx((prev) => (prev + 1) % 4);
    } else {
      setScreenIdx((prev) => (prev + 3) % 4);
    }
  };

  const rawWatchBowLabel =
    activeState.bowType === "Recurve"
      ? t("bowRecurve")
      : activeState.bowType === "Compound"
      ? t("bowCompound")
      : t("bowBarebow");
  const watchBowLabel = isEs
    ? rawWatchBowLabel
    : rawWatchBowLabel.replace(/\s*\([^)]*\)/g, "").trim() || rawWatchBowLabel;
  const liveAnalysisHr =
    lastAnalysisShot?.heartRateBpm ||
    (bleHrStatus.state === "connected" && bleHrStatus.currentBpm >= 30
      ? bleHrStatus.currentBpm
      : undefined) ||
    activeState.heartRateBpm;

  const watchFaceProps: WatchFaceContentProps = {
    isAnalysisWatchMode,
    isSquare,
    isEs,
    isSpanish,
    analysisPage,
    setAnalysisPage,
    screenIdx,
    setScreenIdx,
    lastAnalysisShot,
    activeState,
    manualAnalysisStartMs,
    manualElapsedSec,
    justDetectedShot,
    liveAnalysisHr,
    watchBowLabel,
    isWatchConnected,
    digits,
    walkedPrimaryStr,
    walkedDualStr,
    currentTanda,
    visibleSlotsCount,
    endArrowsList,
    bleHrStatus,
    tx,
    triggerHaptic,
    handlePhysicalWatchButton,
    handleWheel,
    handleWatchTouchStart,
    handleWatchTouchEnd,
    handleWatchPointerDown,
    handleWatchPointerUp,
    handleArrowDelta,
    handleScoreKeyPress,
    handleUndoScore,
    handleNextEnd,
    handleFinishSession
  };

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
                    ? tx("VINCULANDO", "LINKING")
                    : tx("VINCULAR", "LINK")}
                </span>
              </button>
            </div>
          </form>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={handlePhysicalWatchButton}
            title={
              isAnalysisWatchMode
                ? tx("Botón físico del reloj (Inicio / Final)", "Physical watch button (Start / End)")
                : tx("Corona del reloj (+1 flecha)", "Watch crown (+1 arrow)")
            }
            aria-label={
              isAnalysisWatchMode
                ? tx("Botón físico: iniciar o finalizar análisis", "Physical button: start or end analysis")
                : tx("Corona del reloj: sumar 1 flecha", "Watch crown: add 1 arrow")
            }
            className={`absolute -right-[8px] top-1/2 -translate-y-1/2 w-[8px] h-[42px] rounded-r-[4px] border cursor-pointer active:scale-95 z-20 ${
              isAnalysisWatchMode && manualAnalysisStartMs
                ? "bg-[#FF1E1E] border-white/40"
                : "bg-[#1F242E] border-[#343B48]"
            }`}
          />
          <WatchFaceContent {...watchFaceProps} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 3) % 4)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase cursor-pointer"
          >
            {tx("◀ Anterior", "◀ Prev")}
          </button>
          <button
            type="button"
            onClick={() => setScreenIdx((s) => (s + 1) % 4)}
            className="px-3.5 py-1.5 rounded-full bg-[#07090E] border border-white/15 text-white text-[10px] font-extrabold uppercase cursor-pointer"
          >
            {tx("Siguiente ▶", "Next ▶")}
          </button>
        </div>
      </div>
    );
  }

  const isIosPlatform =
    Boolean(watchConnStatus.isNativeIos) ||
    (typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || ""));

  // Show install CTA on native Android or iOS when no paired watch reports the companion app yet
  const showInstallOnWatch =
    (watchConnStatus.isNativeAndroid &&
      watchConnStatus.bridgeReady &&
      typeof watchConnStatus.watchAppInstalledCount === "number" &&
      watchConnStatus.watchAppInstalledCount === 0) ||
    (Boolean(watchConnStatus.isNativeIos) &&
      watchConnStatus.bridgeReady &&
      !isWatchConnected);

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
                className={`${
                  isEs ? "h-[11.5px]" : "h-[10px] min-[385px]:h-[11.5px]"
                } w-auto object-contain shrink-0 select-none pointer-events-none [image-rendering:-webkit-optimize-contrast]`}
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
                  requestWatchAppHeartRate();
                  const curUid = auth.currentUser?.uid || "";
                  if (curUid) {
                    refreshPhoneWatchPairingWindow(curUid, true)
                      .then((c) => {
                        if (c) setPairingCode(c);
                      })
                      .catch(() => {});
                  }
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
          <div className="w-full bg-[#07090E] border border-white/10 rounded-[13px] px-3 py-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[7.5px] font-extrabold tracking-[0.11em] text-[#8E96A4] uppercase leading-tight break-words">
                  {tx("CÓDIGO NUBE · RELOJ DEPORTIVO", "CLOUD CODE · SPORTS WATCH")}
                </div>
                <div
                  className={`text-[9.5px] font-bold break-words leading-tight ${
                    hasCloudWatchLinked
                      ? "text-[#00C853]"
                      : cloudStatus.cloudSyncError
                      ? "text-[#FFE500]"
                      : "text-white/85"
                  }`}
                >
                  {hasCloudWatchLinked
                    ? tx("● Reloj vinculado en vivo", "● Watch linked live")
                    : cloudStatus.cloudSyncError === "AUTH_REQUIRED"
                    ? tx(
                        "Inicia sesión para activar el código en nube",
                        "Sign in to enable the cloud code"
                      )
                    : cloudStatus.cloudSyncError
                    ? tx(
                        "Sin conexión a nube · Toca ↻ para reintentar",
                        "Cloud offline · Tap ↻ to retry"
                      )
                    : cloudStatus.cloudConnected && pairingCode
                    ? tx(
                        "● Código activo · ventana abierta en pantalla VINCULAR",
                        "● Code active · window open on LINK screen"
                      )
                    : tx("Preparando código en nube", "Preparing cloud code")}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {pairingCode && (
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
                )}
                <button
                  type="button"
                  onClick={handleRegeneratePairingCode}
                  disabled={isRegeneratingCode || !auth.currentUser?.uid}
                  className="w-[28px] h-[28px] rounded-[9px] bg-[#081320] border border-[#00A8F3]/45 text-white flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-40"
                  title={tx("Generar nuevo código en nube", "Generate new cloud code")}
                  aria-label={tx("Generar nuevo código de 6 dígitos", "Generate new 6-digit code")}
                >
                  <RefreshCw
                    size={11}
                    aria-hidden="true"
                    className={isRegeneratingCode ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>

            {!isWatchConnected && pairingCode && (
              <div className="border-t border-white/[0.07] pt-1.5 text-[8.5px] font-semibold text-[#94A3B8] leading-snug break-words">
                {isIosPlatform
                  ? tx(
                      "En iOS: abre la App Compañera del Reloj Inteligente en tu teléfono para instalar/activar ARCHERY 101010 en la muñeca, o ingresa estos 6 dígitos en la pantalla VINCULAR del reloj.",
                      "On iOS: open the Companion Watch App on your phone to install/enable ARCHERY 101010 on your wrist, or enter these 6 digits on the watch LINK screen."
                    )
                  : tx(
                      "Mantén activa la app compañera Bluetooth del teléfono, abre ARCHERY 101010 en tu Reloj Deportivo GPS o Reloj Inteligente e ingresa estos 6 dígitos en la pantalla VINCULAR.",
                      "Keep your phone's Bluetooth companion app active, open ARCHERY 101010 on your GPS Sports Watch or Smartwatch, and enter these 6 digits on the LINK screen."
                    )}
              </div>
            )}
          </div>

          {/* Universal Bluetooth Heart Rate Bar */}
          <div className="w-full bg-[#07090E] border border-white/10 rounded-[13px] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-[0.08em] text-white uppercase whitespace-nowrap flex items-center gap-1.5">
                <span
                  className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                    bleHrStatus.state === "connected" ? "bg-[#00C853]" : "bg-[#00BFFF]"
                  }`}
                />
                <span>{t("bleHrTitle")}</span>
              </div>
              {bleHrStatus.state === "connected" && (
                <div className="text-[10px] font-semibold text-white break-words leading-tight tabular-nums mt-0.5">
                  {`${
                    bleHrStatus.currentBpm >= 30 ? `${bleHrStatus.currentBpm} BPM · ` : ""
                  }${bleHrStatus.deviceName || tx("Conectado en vivo", "Connected live")}`}
                </div>
              )}
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
              className="w-full bg-[#081320] border border-[#00A8F3]/45 text-white rounded-full py-[7px] px-3 text-[9px] font-extrabold tracking-[0.08em] uppercase tabular-nums cursor-pointer active:scale-95 transition leading-tight"
            >
              {watchConnStatus.isNativeIos
                ? tx(
                    "● Abrir App Compañera del Reloj Inteligente",
                    "● Open Companion Smartwatch App"
                  )
                : watchConnStatus.connectedNodesCount > 0
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
            {/* Physical Side Button / Digital Crown on right side of watch hardware */}
            <button
              type="button"
              onClick={handlePhysicalWatchButton}
              title={
                isAnalysisWatchMode
                  ? tx("Botón físico del reloj (Inicio / Final)", "Physical watch button (Start / End)")
                  : tx("Corona del reloj (+1 flecha)", "Watch crown (+1 arrow)")
              }
              aria-label={
                isAnalysisWatchMode
                  ? tx("Botón físico: iniciar o finalizar análisis", "Physical button: start or end analysis")
                  : tx("Corona del reloj: sumar 1 flecha", "Watch crown: add 1 arrow")
              }
              className={`absolute -right-[7px] top-1/2 -translate-y-1/2 w-[7px] h-[42px] rounded-r-[4px] border cursor-pointer active:scale-95 ${
                isAnalysisWatchMode && manualAnalysisStartMs
                  ? "bg-[#FF1E1E] border-white/40"
                  : "bg-[#1F242E] border-[#343B48]"
              }`}
            />
            <WatchFaceContent {...watchFaceProps} />
          </div>

          {/* Clean Bottom Navigation Tabs (4 screens) */}
          <div className="w-full grid grid-cols-4 gap-[4px]">
            {[
              { idx: 0, label: tx("FLECHAS", "ARROWS") },
              { idx: 1, label: tx("PUNTOS", "SCORE") },
              { idx: 2, label: tx("PASOS", "STEPS") },
              { idx: 3, label: tx("RESUMEN", "SUMMARY") }
            ].map((tab) => (
              <button
                key={tab.idx}
                type="button"
                onClick={() => setScreenIdx(tab.idx)}
                className={`py-[7px] px-[2px] rounded-[10px] text-[8.5px] font-extrabold uppercase tracking-[0.04em] text-center border transition cursor-pointer ${
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
