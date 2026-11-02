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
        {/* Top Bar: 101010 THE APP en tipografía Good Times sin ARCHERY ni marcas de terceros */}
        <div className="w-full max-w-sm flex items-center justify-between py-1">
          <div className="flex flex-col gap-0.5">
            <div
              translate="no"
              className="notranslate flex items-baseline gap-2 text-[19px] sm:text-[21px] font-extrabold tracking-tight leading-none select-none"
              style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
            >
              <span className="inline-flex">
                <span className="text-cyan-neon">10</span>
                <span className="text-red-rival">10</span>
                <span className="text-yellow-gold">10</span>
              </span>
              <span className="text-white text-[13px] tracking-[0.18em]">THE APP</span>
            </div>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white">
              Lista para Compartir
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Center Preview Card */}
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-[355px] my-2 rounded-3xl overflow-hidden border border-white/15 shadow-[0_0_40px_rgba(0,229,255,0.14)] bg-[#05070B]"
        >
          <img
            src={shareResult.dataUrl}
            alt="101010 THE APP Diana"
            className="w-full h-auto block select-none"
          />
        </motion.div>

        {/* Action Buttons — Apple Fitness+ / WHOOP Editorial Monochrome & Carbon Glass */}
        <div className="w-full max-w-sm flex flex-col gap-2.5 pb-2">
          <button
            type="button"
            onClick={handleNativeShareAgain}
            className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition shadow-[0_8px_24px_rgba(255,255,255,0.12)]"
          >
            <Share2 size={16} strokeWidth={2.4} />
            <span>Compartir Imagen (Redes Sociales)</span>
          </button>

          <button
            type="button"
            onClick={handleWhatsAppShare}
            className="w-full h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition"
          >
            <MessageCircle size={16} className="text-emerald-400" strokeWidth={2.4} />
            <span>Enviar Foto + Planilla</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-xl bg-transparent hover:bg-white/[0.05] text-white/75 hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center cursor-pointer transition"
          >
            Cerrar Vista Previa
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
