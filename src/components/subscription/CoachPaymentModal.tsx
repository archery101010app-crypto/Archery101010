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

        {/* Modal Window Container - Sobriedad editorial estilo Apple Fitness+ / WHOOP */}
        <motion.div
          initial={{ scale: 0.96, y: 8, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 8, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-6 text-white flex flex-col gap-5 my-auto shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div 
                className="flex items-center gap-1.5 select-none"
                style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
              >
                <span className="text-white tracking-widest font-extrabold text-[14.5px]">ARCHERY</span>
                <span className="inline-flex tracking-tight font-extrabold text-[14.5px]">
                  <span className="text-cyan-neon">10</span>
                  <span className="text-red-rival">10</span>
                  <span className="text-yellow-gold">10</span>
                </span>
              </div>

              <h2 className="text-xl font-black text-white tracking-tight mt-0.5">
                Coach Pro
              </h2>
              <p className="text-xs text-white font-medium">
                Acceso bonificado de lanzamiento · Sin cargo hoy
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] text-white hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <X size={15} />
            </button>
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
                  className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#121620] border-cyan-neon/60 text-white"
                      : "bg-[#0D1017] border-white/[0.08] hover:border-white/20 text-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[13.2px] font-bold uppercase tracking-wider text-white">
                      {prod.period === "monthly" ? "Plan Mensual" : "Plan Anual"}
                    </span>
                    {prod.savingsBadge && (
                      <span className="text-[11.9px] font-black bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/30 px-1.5 py-0.5 rounded-md uppercase">
                        -33%
                      </span>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex flex-col">
                    <span className="text-[13.2px] text-white line-through font-mono tabular-nums">
                      {prod.regularPrice}
                    </span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-xl font-black text-white tabular-nums tracking-tight">
                        $0.00
                      </span>
                      <span className="text-[11.9px] font-bold text-cyan-neon uppercase tracking-wider">
                        Bonificado
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Features List - Sobria y editorial */}
          <div className="bg-[#0D1017] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3">
            <span className="text-[13.2px] font-bold uppercase tracking-wider text-white block">
              Incluido en Coach Pro
            </span>

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 text-xs text-white">
                <Check size={14} className="text-cyan-neon shrink-0" />
                <span>Director de tiro con dianas en tiempo real</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white">
                <Check size={14} className="text-cyan-neon shrink-0" />
                <span>Planificador de macrociclos individual y por club</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white">
                <Check size={14} className="text-cyan-neon shrink-0" />
                <span>Sincronización de sesiones con el calendario</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-white">
                <Check size={14} className="text-cyan-neon shrink-0" />
                <span>Métricas de volumen, carga y dispersión técnica</span>
              </div>
            </div>
          </div>

          {/* Status Alert Banner */}
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

          {/* CTA Button */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isProcessing}
              className="h-12 w-full rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] active:scale-[0.99] text-black font-black text-xs uppercase tracking-widest transition cursor-pointer disabled:opacity-50 flex items-center justify-center"
            >
              {isProcessing ? "Activando..." : "Activar Coach Pro"}
            </button>
            <span className="text-[13.2px] text-center text-white">
              Sin tarjeta requerida · Activación inmediata
            </span>
          </div>

          {/* App Store & Google Play Strip */}
          <div className="border-t border-white/[0.06] pt-3 flex flex-col gap-2 text-white">
            <div className="flex items-center justify-between text-[13.2px]">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="hover:text-white flex items-center gap-1.5 font-semibold transition cursor-pointer"
              >
                <RotateCw size={12} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
                <span>Restaurar compras</span>
              </button>

              <span className="font-mono text-[11.9px] text-white uppercase">
                {selectedProduct.sku}
              </span>
            </div>

            <p className="text-[11.9px] text-white leading-relaxed">
              Gestionado mediante Google Play o Apple ID. Cancela en cualquier momento desde los ajustes de tu cuenta.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
