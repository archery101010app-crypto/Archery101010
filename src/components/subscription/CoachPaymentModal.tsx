"use client";

import React, { useState } from "react";
import { 
  X, 
  Sparkles, 
  Check, 
  ShieldCheck, 
  CreditCard, 
  RotateCw, 
  Award, 
  Target, 
  Calendar, 
  Users, 
  Smartphone, 
  CheckCircle2 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { 
  getCoachStoreProducts, 
  activateCoachLaunchPromo, 
  restoreCoachStorePurchases, 
  StoreProduct 
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
      setStatusMessage({ text: err.message || "Error al activar la suscripción.", isError: true });
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
        }, 1000);
      }
    } catch (err: any) {
      setStatusMessage({ text: "No se encontraron compras previas para restaurar.", isError: true });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ scale: 0.92, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.92, y: 20, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-[#0E0E12] border border-white/15 rounded-3xl p-5 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.8)] text-white flex flex-col gap-5 my-auto max-h-[92vh] overflow-y-auto scrollbar-none"
        >
          {/* Top Header */}
          <div className="flex justify-between items-start gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-black uppercase tracking-wider bg-gradient-to-r from-yellow-gold/20 to-amber-500/20 text-yellow-gold border border-yellow-gold/30 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-glow-yellow">
                  <Sparkles size={11} />
                  PROMOCIÓN DE LANZAMIENTO • 100% GRATIS
                </span>
                <span className="text-[9px] font-black uppercase tracking-wider bg-cyan-neon/15 text-cyan-neon border border-cyan-neon/25 px-2 py-0.5 rounded-full">
                  Coach Suite 2026
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight uppercase mt-1">
                Suscripción Coach PRO
              </h2>
              <p className="text-xs text-white/60 leading-relaxed">
                Herramientas de nivel olímpico para dirigir y potenciar a tus arqueros.
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              aria-label="Cerrar cuadro de suscripción"
            >
              <X size={18} />
            </button>
          </div>

          {/* Pricing Tier Selector (Google Play & App Store Ready) */}
          <div className="grid grid-cols-2 gap-3">
            {products.map((prod) => {
              const isSelected = selectedProductId === prod.id;
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProductId(prod.id)}
                  className={`p-3.5 rounded-2xl border flex flex-col justify-between text-left transition-all cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? "bg-neutral-900 border-yellow-gold shadow-[0_0_20px_rgba(255,229,0,0.15)]"
                      : "bg-neutral-950/70 border-white/10 hover:border-white/20"
                  }`}
                >
                  {prod.savingsBadge && (
                    <span className="absolute top-2 right-2 text-[8px] font-black bg-cyan-neon text-black px-1.5 py-0.5 rounded-full uppercase">
                      {prod.savingsBadge}
                    </span>
                  )}
                  
                  <div>
                    <span className="text-[10px] font-black uppercase text-white/50 tracking-wider block">
                      {prod.period === "monthly" ? "Facturación Mensual" : "Temporada Anual"}
                    </span>
                    <span className="text-xs font-bold text-white block mt-0.5">
                      {prod.title}
                    </span>
                  </div>

                  <div className="mt-3 pt-2 border-t border-white/5">
                    <span className="text-[9px] text-white/40 line-through block">
                      Regular: {prod.regularPrice}
                    </span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-lg font-black text-yellow-gold">
                        {prod.promoPrice}
                      </span>
                      <span className="text-[9px] font-black text-green-400 uppercase">
                        GRATIS AHORA
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Value Checklist */}
          <div className="bg-neutral-950/70 border border-white/5 rounded-2xl p-4 flex flex-col gap-2.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-white/40">
              ¿Qué incluye tu Acceso Coach PRO?
            </span>
            <div className="flex flex-col gap-2">
              {selectedProduct.features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs text-white/85">
                  <div className="w-4 h-4 rounded-full bg-yellow-gold/15 border border-yellow-gold/30 flex items-center justify-center shrink-0 mt-0.5 text-yellow-gold">
                    <Check size={11} strokeWidth={3} />
                  </div>
                  <span className="leading-tight">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                statusMessage.isError
                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                  : "bg-green-500/10 border-green-500/30 text-green-400"
              }`}
            >
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Primary Action Button */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isProcessing}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-yellow-gold via-amber-400 to-yellow-500 hover:brightness-110 active:scale-[0.98] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-glow-yellow transition disabled:opacity-50"
            >
              <Sparkles size={16} />
              <span>{isProcessing ? "Activando Acceso..." : "Activar Acceso Coach PRO Gratis ✦"}</span>
            </button>

            {/* Restore purchases for Google Play & App Store Compliance */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleRestore}
                disabled={isRestoring}
                className="text-[10px] text-white/50 hover:text-white flex items-center gap-1.5 font-bold transition cursor-pointer"
              >
                <RotateCw size={12} className={isRestoring ? "animate-spin text-cyan-neon" : ""} />
                <span>{isRestoring ? "Restaurando..." : "Restaurar Compras de App Store / Play Store"}</span>
              </button>

              <span className="text-[9px] text-white/30 font-bold uppercase tracking-wider">
                ID: {selectedProduct.sku}
              </span>
            </div>
          </div>

          {/* Store Compliance & Legal Disclaimers */}
          <div className="border-t border-white/5 pt-3 flex flex-col gap-1.5 text-[9px] text-white/40 leading-relaxed">
            <div className="flex items-center gap-1 text-white/60 font-bold uppercase tracking-wider">
              <ShieldCheck size={12} className="text-cyan-neon" />
              <span>Plataforma Oficial Google Play & Apple App Store</span>
            </div>
            <p>
              • Promoción exclusiva por fase de lanzamiento: 100% bonificada sin costo durante el periodo inicial.
            </p>
            <p>
              • Los cobros de suscripción se procesan a través de tu cuenta de Google Play Store o Apple ID según tu dispositivo. La suscripción se renueva automáticamente a menos que se cancele al menos 24 horas antes del vencimiento. Puedes administrar o cancelar en los ajustes de tu cuenta en cualquier momento.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
