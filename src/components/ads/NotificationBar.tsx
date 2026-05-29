"use client";

import React, { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdCampaign } from "@/lib/db/adTypes";

interface NotificationBarProps {
  campaign: AdCampaign | null;
  onClose: () => void;
  positionTop?: number;
}

export default function NotificationBar({ campaign, onClose, positionTop }: NotificationBarProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setIsVisible(true);
  }, [campaign]);

  if (!campaign || !isVisible) return null;

  const currentSlide = campaign.slides[0];
  if (!currentSlide) return null;

  const handleBarClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".close-btn")) return;

    window.open(currentSlide.linkUrl, "_blank", "noopener,noreferrer");
  };

  const bgStyle = currentSlide.backgroundColor 
    ? { backgroundColor: currentSlide.backgroundColor }
    : { backgroundImage: "linear-gradient(to right, #00BFFF, #00E5FF)" }; // default cyan-brand to cyan-neon

  const topVal = positionTop ?? 64; // Default to 64px (top-16)

  return (
    <AnimatePresence>
      <div 
        style={{ top: `${topVal}px` }}
        className="fixed left-0 right-0 z-20 h-7 w-full flex justify-center pointer-events-none"
      >
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          style={bgStyle}
          className="w-full max-w-5xl h-full shadow-[0_2px_10px_rgba(0,0,0,0.3)] flex items-center justify-between px-4 pointer-events-auto cursor-pointer"
          onClick={handleBarClick}
        >
          {/* Main content - Marquee if text is long, else regular centered */}
          <div className="flex-1 overflow-hidden relative h-full flex items-center">
            <div className="text-[10px] font-black text-black select-none tracking-wide whitespace-nowrap flex items-center gap-1.5 animate-[marquee_20s_linear_infinite] hover:[animation-play-state:paused]">
              <span>{currentSlide.title || "Anuncio Importante"}</span>
              <ExternalLink size={10} className="inline opacity-80" />
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsVisible(false);
              onClose();
            }}
            className="close-btn p-0.5 rounded-full hover:bg-black/10 text-black/60 hover:text-black transition duration-200 cursor-pointer flex items-center justify-center ml-2"
          >
            <X size={12} />
          </button>
        </motion.div>

        {/* Global style for marquee keyframes */}
        <style jsx global>{`
          @keyframes marquee {
            0% { transform: translateX(100%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>
    </AnimatePresence>
  );
}
