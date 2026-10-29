"use client";

import React, { useState } from "react";
import {
  X,
  Check,
  RotateCw,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import {
  getCoachStoreProducts,
  activateCoachLaunchPromo,
  restoreCoachStorePurchases
} from "@/lib/billingService";

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
  const products = getCoachStoreProducts();
  const [selectedProductId, setSelectedProductId] = useState<string>("coach_pro_annual");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  if (!isOpen) return null;

  const selectedProduct = products.find((p) => p.id === selectedProductId) || products[0];

  const handleActivate = async () => {
    setIsProcessing(true);
    setStatusMessage(null);
    try {
      const res = await activateCoachLaunchPromo(user, selectedProduct.sku);
      setStatusMessage({ text: "Coach Pro activado." });
      setTimeout(() => {
        onSuccess(res.updatedUser);
      }, 400);
    } catch (err: any) {
      setStatusMessage({
        text: err.message || "Error al activar.",
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
      setStatusMessage({ text: res.message });
      if (res.updatedUser) {
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

        {/* Modal — Estética minimalista Apple Fitness+ / WHOOP */}
        <motion.div
          initial={{ scale: 0.97, y: 8, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.97, y: 8, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-6 text-white flex flex-col gap-5 my-auto shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div
                className="flex items-center gap-1.5 select-none"
                style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
              >
                <span className="text-white tracking-widest font-extrabold text-[13.5px]">ARCHERY</span>
                <span className="inline-flex tracking-tight font-extrabold text-[13.5px]">
                  <span className="text-cyan-neon">10</span>
                  <span className="text-red-rival">10</span>
                  <span className="text-yellow-gold">10</span>
                </span>
              </div>

              <div className="flex items-center gap-2 mt-0.5">
                <h2 className="text-[22px] font-black text-white tracking-tight leading-none">
                  Coach Pro
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30">
                  Gratis hoy
                </span>
              </div>
              <p className="text-xs text-white/70 font-medium mt-0.5">
                Acceso gratuito de lanzamiento · Sin cargo hoy
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
                      {isAnnual ? "Anual" : "Mensual"}
                    </span>
                    {isAnnual && (
                      <span className="text-[10px] font-black bg-cyan-neon text-black px-1.5 py-0.5 rounded uppercase">
                        -25%
                      </span>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex flex-col">
                    <span className="text-xs text-white/50 line-through tabular-nums font-semibold">
                      {isAnnual ? "$89.91 / año" : "$9.99 / mes"}
                    </span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-xl font-black text-white tabular-nums tracking-tight">
                        $0.00
                      </span>
                      <span className="text-[10px] font-extrabold text-cyan-neon uppercase tracking-wider">
                        Gratis
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
              <span>Portal Coach y conexión en vivo con alumnos</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>Agenda diaria y planes en calendario</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>Asignación individual o a todo el club</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-white">
              <Check size={14} className="text-cyan-neon shrink-0" />
              <span>Métricas de volumen y rendimiento</span>
            </div>
          </div>

          {/* Estado */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                statusMessage.isError
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-cyan-neon/10 border-cyan-neon/25 text-cyan-neon"
              }`}
            >
              <CheckCircle2 size={14} className="shrink-0" />
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
              {isProcessing ? "Activando..." : "Continuar Gratis — $0.00"}
            </button>
            <span className="text-[11px] text-center text-white/60">
              Sin tarjeta requerida · Activación inmediata
            </span>
          </div>

          {/* Footer minimalista */}
          <div className="border-t border-white/[0.06] pt-3 flex items-center justify-between text-[11px] text-white/60">
            <button
              type="button"
              onClick={handleRestore}
              disabled={isRestoring}
              className="hover:text-white flex items-center gap-1.5 font-semibold transition cursor-pointer"
            >
              <RotateCw size={11} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
              <span>Restaurar compras</span>
            </button>

            <span className="tabular-nums text-[10.5px]">
              Google Play · App Store
            </span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
