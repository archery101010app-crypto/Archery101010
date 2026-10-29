"use client";

import React, { useState } from "react";
import {
  X,
  Check,
  RotateCw,
  CheckCircle2,
  ShieldCheck,
  Sparkles
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
      setStatusMessage({ text: "¡Afiliación PRO Gratuita activada con éxito!" });
      setTimeout(() => {
        onSuccess(res.updatedUser);
      }, 450);
    } catch (err: any) {
      setStatusMessage({
        text: err.message || "Error al procesar la activación.",
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
        }, 700);
      }
    } catch {
      setStatusMessage({
        text: "No se encontraron compras registradas en tu cuenta.",
        isError: true
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3.5 sm:p-4 overflow-y-auto">
        {/* Backdrop OLED */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/90 backdrop-blur-xl"
        />

        {/* Modal Container — Estética Élite WHOOP / Apple Fitness+ / 101010 */}
        <motion.div
          initial={{ scale: 0.96, y: 10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 10, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-[#090B10] border border-white/15 rounded-3xl overflow-hidden text-white flex flex-col my-auto shadow-[0_25px_70px_rgba(0,0,0,0.9)]"
        >
          {/* Barra Tricolor Oficial 101010 Superior */}
          <div className="h-[3px] w-full flex">
            <div className="flex-1 bg-cyan-neon" />
            <div className="flex-1 bg-red-rival" />
            <div className="flex-1 bg-yellow-gold" />
          </div>

          <div className="p-5 sm:p-6 flex flex-col gap-4">
            {/* Header con Sello de Gratuidad Inequívoco */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <div
                    className="flex items-center gap-1 select-none"
                    style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
                  >
                    <span className="text-white tracking-widest font-extrabold text-[13.5px]">
                      ARCHERY
                    </span>
                    <span className="inline-flex tracking-tight font-extrabold text-[13.5px]">
                      <span className="text-cyan-neon">10</span>
                      <span className="text-red-rival">10</span>
                      <span className="text-yellow-gold">10</span>
                    </span>
                  </div>

                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                    <Sparkles size={10} />
                    <span>100% GRATIS POR AHORA</span>
                  </span>
                </div>

                <h2 className="text-[22px] font-black text-white tracking-tight leading-tight">
                  Membresía Coach &amp; Atleta <span className="text-yellow-gold">PRO</span>
                </h2>
                <p className="text-xs text-white leading-relaxed">
                  Afíliate hoy <strong className="text-cyan-neon">totalmente gratis ($0.00)</strong>. Disfruta de todas las funciones PRO desbloqueadas sin costo durante nuestra etapa de lanzamiento.
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 text-white hover:bg-white/10 flex items-center justify-center transition cursor-pointer shrink-0"
                aria-label="Cerrar"
              >
                <X size={15} />
              </button>
            </div>

            {/* Banner Destacado: Cero Duda de que es Gratis */}
            <div className="bg-gradient-to-r from-cyan-neon/15 via-emerald-500/10 to-yellow-gold/15 border border-cyan-neon/35 rounded-2xl p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-neon text-black flex items-center justify-center font-black text-xs shrink-0 shadow-[0_0_15px_rgba(0,229,255,0.4)]">
                  $0
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-black uppercase tracking-wider text-white">
                    Afiliación Gratuita de Lanzamiento
                  </span>
                  <span className="text-[11px] text-cyan-neon font-bold">
                    No se te cobrará nada hoy · Sin tarjeta de crédito
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-black uppercase px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-yellow-gold shrink-0">
                GRATIS
              </span>
            </div>

            {/* Selector de Plan: Mensual ($9.99) vs Anual (-25% -> $89.91 / año = $7.49/mes) */}
            <div className="grid grid-cols-2 gap-3">
              {products.map((prod) => {
                const isSelected = selectedProductId === prod.id;
                const isAnnual = prod.period === "annual";
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => setSelectedProductId(prod.id)}
                    className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                      isSelected
                        ? "bg-[#111722] border-cyan-neon shadow-[0_0_25px_rgba(0,229,255,0.12)]"
                        : "bg-[#0D1017] border-white/10 hover:border-white/25"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-black uppercase tracking-wider text-white">
                        {isAnnual ? "Plan Anual" : "Plan Mensual"}
                      </span>
                      {isAnnual && (
                        <span className="text-[10px] font-black bg-yellow-gold text-black px-1.5 py-0.5 rounded-md uppercase tracking-wider">
                          -25% OFF
                        </span>
                      )}
                    </div>

                    {/* Precio Regular Tachado vs Precio Hoy $0.00 GRATIS */}
                    <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white/55 line-through tabular-nums">
                          {isAnnual ? "$89.91/año" : "$9.99/mes"}
                        </span>
                        {isAnnual && (
                          <span className="text-[10px] font-bold text-cyan-neon tabular-nums">
                            ($7.49/mes)
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-xl font-black text-emerald-400 tabular-nums tracking-tight">
                          GRATIS
                        </span>
                        <span className="text-[11px] font-black text-white tabular-nums">
                          ($0.00)
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-white/80">
                        {isAnnual ? "Rebajo del 25% incluido" : "100% bonificado por ahora"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Beneficios Incluidos */}
            <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-cyan-neon flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-yellow-gold" />
                  <span>Todo Desbloqueado al Afiliarte Gratis</span>
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-white">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Portal de Coach y conexión en vivo con tus alumnos</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Agenda del Día estilo Google Calendar y carga desde Excel</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Asignación de planes a 1 alumno, varios o todo el club</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Métricas avanzadas de volumen, estrellas 101010 y duelos 1v1</span>
                </div>
              </div>
            </div>

            {/* Mensaje de Estado */}
            {statusMessage && (
              <div
                className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  statusMessage.isError
                    ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                }`}
              >
                <CheckCircle2 size={14} className="shrink-0" />
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Botón Principal de Afiliación Gratuita */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={isProcessing}
                className="h-12 w-full rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] active:scale-[0.99] text-black font-black text-xs uppercase tracking-widest transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(0,229,255,0.3)]"
              >
                <Sparkles size={15} />
                <span>
                  {isProcessing
                    ? "Activando Afiliación Gratis..."
                    : "Afiliarme a PRO Gratis Ahora ($0.00)"}
                </span>
              </button>
              <div className="flex items-center justify-center gap-2 text-[10.5px] text-white font-bold flex-wrap">
                <span className="text-emerald-400">✓ Gratis por ahora</span>
                <span className="text-white/30">·</span>
                <span>✓ Sin tarjeta requerida</span>
                <span className="text-white/30">·</span>
                <span>✓ Activación inmediata</span>
              </div>
            </div>

            {/* Footer Restaurar Compras */}
            <div className="border-t border-white/[0.06] pt-2.5 flex items-center justify-between text-[10.5px] text-white/80">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="hover:text-white flex items-center gap-1.5 font-semibold transition cursor-pointer"
              >
                <RotateCw size={11} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
                <span>Restaurar afiliación</span>
              </button>

              <span className="tabular-nums text-[10px] text-white/60 uppercase">
                {selectedProduct.period === "annual" ? "$89.91/año (-25%) → $0 Hoy" : "$9.99/mes → $0 Hoy"}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
