"use client";

import React, { useState } from "react";
import {
  X,
  Check,
  RotateCw,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import {
  getCoachStoreProducts,
  activateCoachLaunchPromo,
  restoreCoachStorePurchases
} from "@/lib/billingService";
import { useLanguage } from "@/lib/contexts/LanguageContext";

interface CoachPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  onSuccess: (updatedUser: UserProfile) => void;
}

export default function CoachPaymentModal({
  isOpen,
  onClose,
  user,
  onSuccess
}: CoachPaymentModalProps) {
  const { t } = useLanguage();
  const products = getCoachStoreProducts();
  const [selectedProductId, setSelectedProductId] = useState<string>("coach_pro_annual");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  if (!isOpen) return null;

  const selectedProduct = products.find((p) => p.id === selectedProductId) || products[0];
  const isAnnualSelected = selectedProduct.period === "annual";

  const handleActivate = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await activateCoachLaunchPromo(user, selectedProduct.id);
      setStatusMessage({ text: "Coach Pro activado." });
      setTimeout(() => {
        onSuccess(res.updatedUser);
      }, 400);
    } catch (err: any) {
      const raw = String(err?.message || "");
      const friendly =
        raw.includes("INTERNAL ASSERTION") || raw.includes("FIRESTORE") || raw.length > 160
          ? "Hubo un problema de conexión con la nube. Cierra y vuelve a abrir la app e inténtalo de nuevo."
          : raw || "Error al activar.";
      setStatusMessage({
        text: friendly,
        isError: true
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    setStatusMessage(null);
    try {
      const res = await restoreCoachStorePurchases(user);
      setStatusMessage({
        text: res.message,
        isError: !res.success
      });
      if (res.success && res.updatedUser) {
        setTimeout(() => {
          onSuccess(res.updatedUser!);
        }, 600);
      }
    } catch {
      setStatusMessage({
        text: "No se encontraron compras previas.",
        isError: true
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal — Estética OLED y Titanio Mate */}
        <motion.div
          initial={{ scale: 0.97, y: 8, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.97, y: 8, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-6 text-white flex flex-col gap-5 my-auto shadow-2xl"
        >
          {/* Header Oficial de Marca ARCHERY 101010 */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div
                translate="no"
                className="notranslate flex items-center gap-2 select-none"
              >
                <img
                  src="/images/brand_logo_header.png"
                  srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                  alt="ARCHERY 101010"
                  className="h-4 w-auto object-contain select-none"
                  draggable={false}
                />
                <span
                  className="text-white/90 tracking-[0.22em] font-extrabold text-[9.5px]"
                  style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
                >
                  THE APP
                </span>
              </div>

              <div className="flex items-center gap-2 mt-0.5">
                <h2 translate="no" className="notranslate text-[22px] font-black text-white tracking-tight leading-none">
                  Coach Pro
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30">
                  {t("freeToday")}
                </span>
              </div>
              <p className="text-xs text-white font-medium mt-0.5">
                {t("launchAccessSubtitle")}
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] text-white flex items-center justify-center transition cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <X size={15} />
            </button>
          </div>

          {/* Selector de Plan: Mensual ($9.99) y Anual (-25%) */}
          <div className="grid grid-cols-2 gap-3">
            {products.map((prod) => {
              const isSelected = selectedProductId === prod.id;
              const isAnnual = prod.period === "annual";
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProductId(prod.id)}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#111622] border-cyan-neon"
                      : "bg-[#0E1117] border-white/[0.08] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                      {isAnnual ? t("annualPlan") : t("monthlyPlan")}
                    </span>
                    {isAnnual && (
                      <span translate="no" className="notranslate text-[10px] font-black bg-cyan-neon text-black px-1.5 py-0.5 rounded uppercase">
                        -25%
                      </span>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex flex-col">
                    <span className="text-xs text-white line-through tabular-nums font-semibold">
                      {isAnnual ? `$89.91 ${t("perYear")}` : `$9.99 ${t("perMonth")}`}
                    </span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span translate="no" className="notranslate text-xl font-black text-white tabular-nums tracking-tight">
                        $0.00
                      </span>
                      <span className="text-[10px] font-extrabold text-cyan-neon uppercase tracking-wider">
                        {t("freeLabel")}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Beneficios concretos */}
          <div className="bg-[#0E1117] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>{t("proBenefit1")}</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>{t("proBenefit2")}</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>{t("proBenefit3")}</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>{t("proBenefit4")}</span>
            </div>
          </div>

          {/* Estado */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                statusMessage.isError
                  ? "bg-white border-white text-black"
                  : "bg-cyan-neon/10 border-cyan-neon/25 text-cyan-neon"
              }`}
            >
              {statusMessage.isError ? (
                <AlertCircle size={14} className="shrink-0" />
              ) : (
                <CheckCircle2 size={14} className="shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* CTA Principal */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isProcessing}
              className="h-12 w-full rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] active:scale-[0.99] text-black font-black text-xs uppercase tracking-widest transition cursor-pointer disabled:opacity-50 flex items-center justify-center"
            >
              {isProcessing ? t("activating") : t("continueFreeBtn")}
            </button>
            <span className="text-[11px] text-center text-white">
              {t("noCardRequired")}
            </span>
            <span className="text-[11px] text-center text-white font-bold tabular-nums">
              {isAnnualSelected
                ? "Acceso Coach PRO por 365 días · Temporada completa bonificada"
                : "Acceso Coach PRO por 30 días · Renuévalo gratis cada mes"}
            </span>
          </div>

          {/* Footer minimalista */}
          <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between text-[11px] text-white">
            <button
              type="button"
              onClick={handleRestore}
              disabled={isRestoring}
              className="hover:text-white flex items-center gap-1.5 font-semibold transition cursor-pointer"
            >
              <RotateCw size={11} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
              <span>{t("restorePurchases")}</span>
            </button>

            <span translate="no" className="notranslate tabular-nums text-[10.5px]">
              Tienda de Aplicaciones
            </span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
