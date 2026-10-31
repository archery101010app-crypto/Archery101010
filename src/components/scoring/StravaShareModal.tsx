"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, MessageCircle, X, Download } from "lucide-react";
import { ShareTargetResult } from "@/lib/scoring/targetImageGenerator";

interface StravaShareModalProps {
  shareResult: ShareTargetResult | null;
  onClose: () => void;
}

export default function StravaShareModal({ shareResult, onClose }: StravaShareModalProps) {
  if (!shareResult) return null;

  const handleNativeShareAgain = async () => {
    const { dataUrl, fileName, captionText } = shareResult;

    if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareImage) {
      window.ArcheryNativeShare.shareImage(dataUrl, fileName, "101010 THE APP", captionText);
      return;
    }

    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "101010 THE APP",
          text: captionText
        });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }

    // Fallback download
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleWhatsAppShare = async () => {
    const { dataUrl, fileName, captionText } = shareResult;

    if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareWhatsAppImage) {
      window.ArcheryNativeShare.shareWhatsAppImage(dataUrl, fileName, captionText);
      return;
    }

    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "101010 THE APP",
          text: captionText
        });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }

    window.location.href = `whatsapp://send?text=${encodeURIComponent(captionText)}`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200000] bg-black/92 backdrop-blur-md flex flex-col items-center justify-between p-4 overflow-y-auto"
      >
        {/* Top Bar */}
        <div className="w-full max-w-sm flex items-center justify-between py-1">
          <div className="flex flex-col">
            <span className="text-[10.5px] font-black uppercase tracking-widest text-cyan-neon">
              Tarjeta Oficial Estilo Strava
            </span>
            <h3 className="text-white text-sm font-black uppercase">
              101010 THE APP · Lista para Compartir
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Center Preview Card */}
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-[330px] my-2 rounded-3xl overflow-hidden border border-white/15 shadow-[0_0_40px_rgba(0,229,255,0.18)] bg-[#05070B]"
        >
          <img
            src={shareResult.dataUrl}
            alt="101010 THE APP Diana"
            className="w-full h-auto block select-none"
          />
        </motion.div>

        {/* Action Buttons */}
        <div className="w-full max-w-sm flex flex-col gap-2 pb-2">
          <button
            type="button"
            onClick={handleNativeShareAgain}
            className="w-full h-11 rounded-xl bg-yellow-gold hover:bg-[#ffe919] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition shadow-lg"
          >
            <Share2 size={16} />
            <span>Compartir Imagen (Instagram / Redes)</span>
          </button>

          <button
            type="button"
            onClick={handleWhatsAppShare}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition shadow-lg"
          >
            <MessageCircle size={16} />
            <span>Enviar por WhatsApp (Foto + Planilla)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center cursor-pointer transition"
          >
            Cerrar Vista Previa
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
