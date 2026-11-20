"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { triggerHaptic } from "@/lib/haptics";
import {
  AnalysisBowType,
  AnalysisBowWrist,
  AnalysisCalibrationProfile,
  saveAnalysisCalibration
} from "@/lib/scoring/shotAnalysisEngine";

interface AnalysisCalibrationModalProps {
  isOpen: boolean;
  initialProfile: AnalysisCalibrationProfile;
  onClose: () => void;
  onSaveCalibration: (profile: AnalysisCalibrationProfile) => void;
}

const DISTANCES = [18, 30, 50, 60, 70] as const;

export default function AnalysisCalibrationModal({
  isOpen,
  initialProfile,
  onClose,
  onSaveCalibration
}: AnalysisCalibrationModalProps) {
  const { t, tx } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const zeroIntervalRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearZeroTimer = () => {
    if (zeroIntervalRef.current !== null) {
      window.clearInterval(zeroIntervalRef.current);
      zeroIntervalRef.current = null;
    }
  };
  const titleId = useId();

  const [bowType, setBowType] = useState<AnalysisBowType>(initialProfile.bowType);
  const [bowWrist, setBowWrist] = useState<AnalysisBowWrist>(initialProfile.bowWrist);
  const [distanceM, setDistanceM] = useState<number>(initialProfile.distanceM || 18);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBowType(initialProfile.bowType);
      setBowWrist(initialProfile.bowWrist);
      setDistanceM(initialProfile.distanceM || 18);
      setCountdownSec(null);
    }
  }, [isOpen, initialProfile]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      clearZeroTimer();
      dialog.returnValue = "";
      setCountdownSec(null);
      onCloseRef.current();
    };
    dialog.addEventListener("close", handleNativeClose);

    let removeLightDismissFallback: (() => void) | null = null;
    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      const onBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const inside =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (!inside && dialog.open) {
          dialog.close();
        }
      };
      dialog.addEventListener("click", onBackdropClick);
      removeLightDismissFallback = () => dialog.removeEventListener("click", onBackdropClick);
    }

    return () => {
      clearZeroTimer();
      dialog.removeEventListener("close", handleNativeClose);
      if (removeLightDismissFallback) removeLightDismissFallback();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {}
      }
      const unregister = registerModalDismiss(() => {
        if (dialog.open) dialog.close();
        else onCloseRef.current();
      });
      return () => unregister();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleClose = () => {
    clearZeroTimer();
    setCountdownSec(null);
    if (dialogRef.current?.open) dialogRef.current.close();
    else onClose();
  };

  const handleStartZeroing = () => {
    if (countdownSec !== null) return;
    clearZeroTimer();
    triggerHaptic("arrow");
    setCountdownSec(3);

    let remaining = 3;
    zeroIntervalRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdownSec(remaining);
        triggerHaptic("tick");
      } else {
        clearZeroTimer();
        setCountdownSec(null);
        triggerHaptic("confirm");
        const updated: AnalysisCalibrationProfile = {
          bowType,
          bowWrist,
          distanceM,
          zeroGravityVec: [0, 0, 9.81],
          calibratedAt: Date.now()
        };
        saveAnalysisCalibration(updated);
        onSaveCalibration(updated);
        handleClose();
      }
    }, 1000);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as any)}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100vw-16px)] max-w-[412px] max-h-[94dvh] p-0 bg-transparent border-0 text-white font-sans overflow-y-auto overscroll-contain outline-none open:block"
    >
      <div
        dir="ltr"
        className="w-full bg-[#020305] border border-white/[0.11] rounded-[26px] p-4 sm:p-5 flex flex-col gap-3.5 select-none font-sans"
      >
        {/* Top Row: Editorial Kicker + Signature 101010 Tri-Color Bar + Close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-[3px]">
              <span className="w-[10px] h-[4px] rounded-full bg-[#00BFFF]" />
              <span className="w-[10px] h-[4px] rounded-full bg-[#FF1E1E]" />
              <span className="w-[10px] h-[4px] rounded-full bg-[#FFE500]" />
            </div>
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-white">
              {tx("Calibración única", "One-time calibration")}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#0D1119] border border-white/[0.12] text-[11.5px] font-bold text-white tabular-nums">
              20 S
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label={tx("Cerrar ajuste", "Close calibration")}
            className="min-w-[36px] min-h-[36px] w-[36px] h-[36px] rounded-full bg-[#10131B] border border-white/[0.11] text-white flex items-center justify-center hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Title & Subtitle (+15% instruction copy, unified Outfit typography) */}
        <div className="flex flex-col gap-1">
          <h2
            id={titleId}
            className="text-[22.5px] font-bold text-white tracking-normal leading-tight"
          >
            {tx("Ajuste inicial del sensor", "Initial sensor setup")}
          </h2>
          <p className="text-[15px] font-normal text-white leading-snug">
            {tx(
              "Personaliza el reloj con tu postura real de tiro para que cada flecha se mida con exactitud.",
              "Personalize your watch to your real shooting stance so every arrow is measured accurately."
            )}
          </p>
        </div>

        {/* Brushed Matte-Titanium Settings Group (+20% size on Arco, Muñeca del arco & Distancia) */}
        <section className="bg-[#0B0E15] border border-white/[0.09] rounded-[20px] p-3 flex flex-col gap-2.5">
          {/* Arco */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.6px] min-[380px]:text-[14.4px] font-bold text-white shrink-0">
              {tx("Arco", "Bow")}
            </span>
            <div className="flex bg-[#05070B] border border-white/[0.08] rounded-xl p-0.5 gap-0.5">
              {(["Barebow", "Recurve", "Compound"] as const).map((b) => {
                const rawLabel =
                  b === "Recurve"
                    ? t("bowRecurve")
                    : b === "Compound"
                    ? t("bowCompound")
                    : t("bowBarebow");
                const label = rawLabel.replace(/\s*\([^)]*\)/g, "").trim() || rawLabel;
                const isSelected = bowType === b;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBowType(b)}
                    className={`min-h-[35px] px-2.5 rounded-[9px] text-[13px] min-[380px]:text-[13.8px] transition cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? "bg-white text-black font-extrabold"
                        : "text-white font-semibold hover:bg-white/5"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-[1px] bg-white/[0.06]" />

          {/* Muñeca del arco */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.6px] min-[380px]:text-[14.4px] font-bold text-white shrink-0">
              {tx("Muñeca del arco", "Bow wrist")}
            </span>
            <div className="flex bg-[#05070B] border border-white/[0.08] rounded-xl p-0.5 gap-0.5">
              {([
                { id: "LEFT" as const, label: tx("Izquierda", "Left") },
                { id: "RIGHT" as const, label: tx("Derecha", "Right") }
              ]).map((w) => {
                const isSelected = bowWrist === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setBowWrist(w.id)}
                    className={`min-h-[35px] px-3 rounded-[9px] text-[13px] min-[380px]:text-[13.8px] transition cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? "bg-white text-black font-extrabold"
                        : "text-white font-semibold hover:bg-white/5"
                    }`}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-[1px] bg-white/[0.06]" />

          {/* Distancia */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13.6px] min-[380px]:text-[14.4px] font-bold text-white shrink-0">
              {t("distance")}
            </span>
            <div className="flex bg-[#05070B] border border-white/[0.08] rounded-xl p-0.5 gap-0.5">
              {DISTANCES.map((d) => {
                const isSelected = distanceM === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDistanceM(d)}
                    className={`min-h-[35px] px-2 rounded-[9px] text-[13px] min-[380px]:text-[13.8px] tabular-nums transition cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? "bg-white text-black font-extrabold"
                        : "text-white font-semibold hover:bg-white/5"
                    }`}
                  >
                    {d}m
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pure Architectural Numerals 01 / 02 / 03 (+15% instructions size, Outfit font) */}
        <section className="flex flex-col gap-2">
          <div className="bg-[#090C12] border border-white/[0.08] rounded-[16px] px-3 py-2.5 flex items-center gap-3">
            <span className="w-[3px] h-[38px] rounded-full bg-[#00BFFF] shrink-0" />
            <span className="font-sans text-[19.5px] font-extrabold text-[#00BFFF] tabular-nums shrink-0">
              01
            </span>
            <span className="w-[1px] h-[32px] bg-white/[0.08] shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <h3 className="text-[15px] font-bold text-white leading-tight">
                {tx("Ajusta firme la correa", "Fasten the strap snugly")}
              </h3>
              <p className="text-[13.2px] font-normal text-white leading-snug">
                {tx(
                  "En la mano que sostiene el arco, un dedo detrás del hueso para evitar rebote al soltar.",
                  "On your bow hand, one finger behind the wrist bone to prevent bounce at release."
                )}
              </p>
            </div>
          </div>

          <div className="bg-[#090C12] border border-white/[0.08] rounded-[16px] px-3 py-2.5 flex items-center gap-3">
            <span className="w-[3px] h-[38px] rounded-full bg-[#FF1E1E] shrink-0" />
            <span className="font-sans text-[19.5px] font-extrabold text-[#FF1E1E] tabular-nums shrink-0">
              02
            </span>
            <span className="w-[1px] h-[32px] bg-white/[0.08] shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <h3 className="text-[15px] font-bold text-white leading-tight">
                {tx("Apoya el brazo 3 segundos", "Rest your arm for 3 seconds")}
              </h3>
              <p className="text-[13.2px] font-normal text-white leading-snug">
                {tx(
                  "Descansa la mano sin moverte para fijar el punto cero hasta sentir una vibración corta.",
                  "Hold your hand steady to lock the zero point until you feel a short vibration."
                )}
              </p>
            </div>
          </div>

          <div className="bg-[#090C12] border border-white/[0.08] rounded-[16px] px-3 py-2.5 flex items-center gap-3">
            <span className="w-[3px] h-[38px] rounded-full bg-[#FFE500] shrink-0" />
            <span className="font-sans text-[19.5px] font-extrabold text-[#FFE500] tabular-nums shrink-0">
              03
            </span>
            <span className="w-[1px] h-[32px] bg-white/[0.08] shrink-0" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <h3 className="text-[15px] font-bold text-white leading-tight">
                {tx("Dispara 1 flecha normal", "Shoot 1 normal arrow")}
              </h3>
              <p className="text-[13.2px] font-normal text-white leading-snug">
                {tx(
                  "Tira como siempre sin tocar el teléfono; al soltar queda registrada tu postura y ritmo.",
                  "Shoot naturally without touching your phone; your stance and timing register on release."
                )}
              </p>
            </div>
          </div>
        </section>

        {/* Primary CTA */}
        <div className="flex flex-col items-center gap-2 pt-0.5">
          <span className="text-[12px] min-[380px]:text-[12.7px] font-medium text-white text-center leading-snug whitespace-nowrap">
            {tx(
              "Se guarda en tu perfil · Recalibra si cambias de arco",
              "Saved to your profile · Recalibrate if you switch bows"
            )}
          </span>
          <button
            type="button"
            onClick={handleStartZeroing}
            disabled={countdownSec !== null}
            className="w-full min-h-[50px] rounded-[16px] bg-white hover:bg-neutral-100 text-black font-bold text-[16.5px] tracking-wide flex items-center justify-center cursor-pointer active:scale-[0.99] transition tabular-nums disabled:opacity-90"
          >
            {countdownSec !== null
              ? tx(`Fijando punto cero · ${countdownSec} s...`, `Locking zero point · ${countdownSec} s...`)
              : tx("Comenzar ajuste", "Start calibration")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
