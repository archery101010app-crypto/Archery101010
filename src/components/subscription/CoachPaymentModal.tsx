"use client";

import React, { useState } from "react";
import { 
  X, 
  Sparkles, 
  Check, 
  ShieldCheck, 
  RotateCw, 
  Target, 
  Calendar, 
  Users, 
  BarChart3,
  CheckCircle2,
  ArrowRight
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
  const [selectedProductId, setSelectedProductId] = useState<string>("coach_pro_monthly");
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
      setStatusMessage({ text: "¡Suscripción Coach PRO activada con éxito!" });
      setTimeout(() => {
        onSuccess(res.updatedUser);
      }, 700);
    } catch (err: any) {
      setStatusMessage({ text: err.message || "Error al procesar la activación.", isError: true });
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
        }, 900);
      }
    } catch (err: any) {
      setStatusMessage({ text: "No se encontraron compras previas registradas.", isError: true });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        {/* Backdrop with high-end dark glassmorphism */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-xl"
        />

        {/* Modal Window Container */}
        <motion.div
          initial={{ scale: 0.94, y: 16, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.94, y: 16, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className="relative w-full max-w-lg bg-[#07080A] border border-white/10 rounded-[2rem] p-5 sm:p-7 shadow-[0_30px_90px_rgba(0,0,0,0.9)] text-white flex flex-col gap-5 my-auto max-h-[92vh] overflow-y-auto scrollbar-none"
        >
          {/* Subtle Top Ambient Lighting */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-28 bg-gradient-to-b from-yellow-gold/15 via-cyan-neon/5 to-transparent pointer-events-none blur-2xl" />

          {/* Header Bar */}
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Luxury Target Crest Icon */}
              <div className="w-11 h-11 rounded-2xl bg-neutral-900 border border-yellow-gold/40 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(255,229,0,0.2)]">
                <Target size={22} className="text-yellow-gold" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-neon">
                    WORLD ARCHERY
                  </span>
                  <span className="w-1 h-1 rounded-full bg-white/30" />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-yellow-gold">
                    COACH SUITE
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white mt-0.5">
                  Director de Tiro PRO
                </h2>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              aria-label="Cerrar ventana"
            >
              <X size={16} />
            </button>
          </div>

          {/* Launch Special Promo Ribbon */}
          <div className="relative z-10 bg-gradient-to-r from-yellow-gold/15 via-neutral-900 to-cyan-neon/15 border border-yellow-gold/30 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-[0_0_25px_rgba(255,229,0,0.1)]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-yellow-gold text-black flex items-center justify-center font-black text-xs shrink-0 shadow-glow-yellow">
                <Sparkles size={14} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-wider text-yellow-gold">
                  Temporada de Lanzamiento
                </span>
                <span className="text-xs font-bold text-white/90 leading-tight">
                  100% Gratuito y Bonificado
                </span>
              </div>
            </div>
            <span className="text-[9px] font-black uppercase tracking-wider bg-black/60 text-green-400 border border-green-500/30 px-2.5 py-1 rounded-full shrink-0">
              $0.00 AHORA
            </span>
          </div>

          {/* Tier Selector: Mensual vs Anual (Google Play & App Store Ready) */}
          <div className="relative z-10 grid grid-cols-2 gap-2.5">
            {products.map((prod) => {
              const isSelected = selectedProductId === prod.id;
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProductId(prod.id)}
                  className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                    isSelected
                      ? "bg-neutral-900/90 border-yellow-gold/80 shadow-[0_0_20px_rgba(255,229,0,0.18)]"
                      : "bg-neutral-950/60 border-white/10 hover:border-white/20 text-white/70"
                  }`}
                >
                  {prod.savingsBadge && (
                    <span className="absolute top-2 right-2 text-[8px] font-black bg-cyan-neon text-black px-1.5 py-0.5 rounded-full uppercase tracking-wider shadow-glow-cyan">
                      {prod.savingsBadge}
                    </span>
                  )}

                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-white/40 block">
                      {prod.period === "monthly" ? "Mensual" : "Temporada Anual"}
                    </span>
                    <span className="text-xs font-black text-white uppercase tracking-tight block mt-0.5">
                      {prod.title}
                    </span>
                  </div>

                  <div className="mt-3 pt-2 border-t border-white/5 flex flex-col">
                    <span className="text-[9px] text-white/35 line-through font-mono">
                      Regular: {prod.regularPrice}
                    </span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xl font-black text-yellow-gold tracking-tight">
                        $0.00
                      </span>
                      <span className="text-[9px] font-black text-green-400 uppercase tracking-wider">
                        GRATIS
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Feature Bento Grid (Bespoke 2-column aesthetic) */}
          <div className="relative z-10 bg-neutral-950/70 border border-white/5 rounded-2xl p-4 flex flex-col gap-2.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
              Herramientas de Alto Rendimiento Incluidas
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-start gap-2 bg-neutral-900/40 p-2.5 rounded-xl border border-white/5">
                <Target size={15} className="text-cyan-neon shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-white text-[11px] leading-tight">Director en Vivo</span>
                  <span className="text-[9px] text-white/50 leading-snug mt-0.5">Supervisión de dianas y rondas en tiempo real.</span>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-neutral-900/40 p-2.5 rounded-xl border border-white/5">
                <Calendar size={15} className="text-yellow-gold shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-white text-[11px] leading-tight">Macroestructuras</span>
                  <span className="text-[9px] text-white/50 leading-snug mt-0.5">Planes asignables a 1 alumno o a todo el equipo.</span>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-neutral-900/40 p-2.5 rounded-xl border border-white/5">
                <Users size={15} className="text-green-400 shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-white text-[11px] leading-tight">Roster de Club</span>
                  <span className="text-[9px] text-white/50 leading-snug mt-0.5">Invitaciones rápidas con código de 6 dígitos.</span>
                </div>
              </div>

              <div className="flex items-start gap-2 bg-neutral-900/40 p-2.5 rounded-xl border border-white/5">
                <BarChart3 size={15} className="text-purple-400 shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-bold text-white text-[11px] leading-tight">Control de Carga</span>
                  <span className="text-[9px] text-white/50 leading-snug mt-0.5">Volumen de flechas y analítica balística FITA.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Status Alert Banner if any */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                statusMessage.isError
                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                  : "bg-green-500/10 border-green-500/30 text-green-400"
              }`}
            >
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Primary CTA Button */}
          <div className="relative z-10 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isProcessing}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-yellow-gold via-[#FFD000] to-amber-500 hover:brightness-105 active:scale-[0.98] text-black font-black text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_25px_rgba(255,229,0,0.35)] transition-all disabled:opacity-50"
            >
              <Sparkles size={16} />
              <span>{isProcessing ? "Activando Acceso..." : "Activar Acceso Coach PRO Gratis ✦"}</span>
            </button>

            <span className="text-[9px] text-center text-white/40 font-medium">
              Sin tarjeta de crédito requerida • Acceso instantáneo a la suite
            </span>
          </div>

          {/* App Store & Google Play Compatibility Strip */}
          <div className="relative z-10 border-t border-white/5 pt-3.5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="text-[10px] text-white/50 hover:text-white flex items-center gap-1.5 font-bold transition cursor-pointer"
              >
                <RotateCw size={11} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
                <span>{isRestoring ? "Restaurando..." : "Restaurar Compras de App Store / Play Store"}</span>
              </button>

              <span className="text-[8px] font-mono text-white/30 uppercase tracking-widest">
                SKU: {selectedProduct.sku}
              </span>
            </div>

            {/* Legal Disclaimers (Strict compliance with Google Play & Apple App Store Guidelines 3.1.2) */}
            <p className="text-[8px] text-white/30 leading-relaxed">
              Cobro y facturación gestionados de forma segura mediante Google Play Store o Apple ID según tu dispositivo. La suscripción se renueva automáticamente tras el periodo promocional al valor regular, a menos que se cancele al menos 24 horas antes del vencimiento. Puedes gestionar o cancelar tu suscripción en cualquier momento en los ajustes de tu cuenta de Google Play o Apple ID.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
