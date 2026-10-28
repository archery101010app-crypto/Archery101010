"use client";

import React, { useState } from "react";
import { 
  X, 
  Check, 
  RotateCw, 
  CheckCircle2,
  Shield
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
      setStatusMessage({ text: "Suscripción activada con éxito." });
      setTimeout(() => {
        onSuccess(res.updatedUser);
      }, 500);
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
        }, 700);
      }
    } catch (err: any) {
      setStatusMessage({ text: "No se encontraron compras registradas en tu cuenta.", isError: true });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 overflow-y-auto">
        {/* Backdrop matte oscuro */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Window Container - Diseño limpio y mate */}
        <motion.div
          initial={{ scale: 0.95, y: 10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 10, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-[#0A0B0E] border border-white/10 rounded-2xl p-6 text-white flex flex-col gap-5 my-auto shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/5">
            <div>
              {/* Branding Oficial ARCHERY 101010 (+40% tamaño) */}
              <div 
                className="flex items-center gap-2 select-none"
                style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
              >
                <span className="text-white tracking-widest font-extrabold text-[17px] sm:text-[20px]">ARCHERY</span>
                <span className="inline-flex tracking-tight font-extrabold text-[17px] sm:text-[20px]">
                  <span className="text-cyan-neon">10</span>
                  <span className="text-red-rival">10</span>
                  <span className="text-yellow-gold">10</span>
                </span>
              </div>

              <h2 
                className="text-base sm:text-lg font-extrabold text-white tracking-wider uppercase mt-1.5"
                style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
              >
                COACH PRO
              </h2>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-neutral-900 border border-white/10 text-white/50 hover:text-white transition cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>

          {/* Launch Special Promo Box - Sin brillos ni degradados glow */}
          <div className="bg-neutral-900/80 border border-yellow-gold/30 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-yellow-gold block">
                Promoción Especial de Lanzamiento
              </span>
              <span className="text-xs font-bold text-white mt-0.5 block">
                Acceso 100% Bonificado
              </span>
            </div>
            <span className="text-[10px] font-black uppercase bg-neutral-950 text-green-400 border border-green-500/30 px-2.5 py-1 rounded-md">
              $0.00 Ahora
            </span>
          </div>

          {/* Plan Selector (Mensual vs Anual) */}
          <div className="grid grid-cols-2 gap-3">
            {products.map((prod) => {
              const isSelected = selectedProductId === prod.id;
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProductId(prod.id)}
                  className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? "bg-neutral-900 border-yellow-gold text-white"
                      : "bg-neutral-950 border-white/10 hover:border-white/20 text-white/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-white/40">
                      {prod.period === "monthly" ? "Mensual" : "Anual"}
                    </span>
                    {prod.savingsBadge && (
                      <span className="text-[8px] font-black bg-cyan-neon text-black px-1.5 py-0.5 rounded uppercase">
                        -33%
                      </span>
                    )}
                  </div>

                  <span className="text-xs font-bold text-white mt-1 block">
                    <span 
                      style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
                      className="font-extrabold tracking-wide uppercase"
                    >
                      COACH PRO
                    </span>{" "}
                    <span className="text-[10px] text-white/70 font-bold uppercase">{prod.period === "monthly" ? "MENSUAL" : "ANUAL"}</span>
                  </span>

                  <div className="mt-3 pt-2 border-t border-white/5 flex flex-col">
                    <span className="text-[9px] text-white/30 line-through font-mono">
                      {prod.regularPrice}
                    </span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-lg font-black text-yellow-gold">
                        $0.00
                      </span>
                      <span className="text-[9px] font-black text-green-400 uppercase">
                        Gratis
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Features List - Lista técnica y sobria sin emojis ni dibujos */}
          <div className="bg-neutral-950 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-white/40 block">
              Funcionalidades Incluidas
            </span>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5 text-xs text-white/80">
                <Check size={14} className="text-yellow-gold shrink-0" />
                <span>Director de Tiro con supervisión de dianas en tiempo real</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white/80">
                <Check size={14} className="text-yellow-gold shrink-0" />
                <span>Planificador de macroestructuras para 1 alumno o todo el club</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white/80">
                <Check size={14} className="text-yellow-gold shrink-0" />
                <span>Sincronización automática de entrenamientos con el calendario</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white/80">
                <Check size={14} className="text-yellow-gold shrink-0" />
                <span>Control de carga, volumen de flechas y dispersión técnica</span>
              </div>
            </div>
          </div>

          {/* Status Alert Banner */}
          {statusMessage && (
            <div
              className={`p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${
                statusMessage.isError
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-green-500/10 border-green-500/20 text-green-400"
              }`}
            >
              <CheckCircle2 size={14} className="shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* CTA Button - Sólido, mate, sin brillos ni iconos de estrellas */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isProcessing}
              className="w-full py-3.5 rounded-xl bg-yellow-gold hover:bg-yellow-400 active:scale-[0.99] text-black font-bold text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isProcessing ? (
                <span>ACTIVANDO...</span>
              ) : (
                <span className="flex items-center gap-1">
                  ACTIVAR ACCESO{" "}
                  <span 
                    className="font-extrabold tracking-wider" 
                    style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
                  >
                    COACH PRO
                  </span>
                </span>
              )}
            </button>
            <span className="text-[10px] text-center text-white/40">
              Sin tarjeta de crédito requerida • Acceso inmediato
            </span>
          </div>

          {/* App Store & Google Play Strip */}
          <div className="border-t border-white/5 pt-3 flex flex-col gap-2 text-white/40">
            <div className="flex items-center justify-between text-[10px]">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="hover:text-white flex items-center gap-1.5 font-bold transition cursor-pointer"
              >
                <RotateCw size={12} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
                <span>Restaurar compras</span>
              </button>

              <span className="font-mono text-[9px] text-white/30 uppercase">
                SKU: {selectedProduct.sku}
              </span>
            </div>

            <p className="text-[8px] text-white/30 leading-relaxed">
              Facturación procesada mediante Google Play Store o Apple ID según tu dispositivo. La suscripción se renueva automáticamente tras el periodo promocional, a menos que se cancele al menos 24 horas antes del vencimiento en los ajustes de tu cuenta.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
