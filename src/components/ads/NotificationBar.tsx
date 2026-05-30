"use client";

import React, { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdCampaign } from "@/lib/db/adTypes";

interface NotificationBarProps {
  campaign: AdCampaign | null;
  onClose: () => void;
}

export default function NotificationBar({ campaign, onClose }: NotificationBarProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  // Reset state when a new campaign loads
  useEffect(() => {
    setIsVisible(true);
    setActiveSlideIndex(0);
  }, [campaign]);

  // Handle slide transitions for multiple slides
  useEffect(() => {
    if (!campaign || !isVisible || campaign.slides.length <= 1) return;

    const intervalSeconds = campaign.slideIntervalSeconds || 5;
    const interval = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % campaign.slides.length);
    }, intervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [campaign, isVisible]);

  if (!campaign || !isVisible) return null;

  const currentSlide = campaign.slides[activeSlideIndex];
  if (!currentSlide) return null;

  // Handle tap-to-close behavior: clicking anywhere on the bar (except close button)
  // will open the link in a new tab AND close the notification bar so it doesn't block options.
  const handleBarClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".close-btn")) return;

    // Open target link
    if (currentSlide.linkUrl) {
      window.open(currentSlide.linkUrl, "_blank", "noopener,noreferrer");
    }
    
    // Close immediately to expose underlying UI
    setIsVisible(false);
    onClose();
  };

  const bgStyle = currentSlide.backgroundColor 
    ? { backgroundColor: currentSlide.backgroundColor }
    : { backgroundImage: "linear-gradient(to right, #00BFFF, #00E5FF)" }; // default cyan gradient

  return (
    <AnimatePresence>
      <div 
        className="fixed top-0 left-0 right-0 z-50 h-7 w-full flex justify-center"
      >
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -30, opacity: 0 }}
          style={bgStyle}
          className="w-full max-w-5xl h-full shadow-[0_2px_10px_rgba(0,0,0,0.3)] flex items-center justify-between px-4 cursor-pointer relative"
          onClick={handleBarClick}
        >
          {/* Main content - slide transition */}
          <div className="flex-1 overflow-hidden relative h-full flex items-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSlideIndex}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
                className="text-[10px] font-black text-black select-none tracking-wide whitespace-nowrap flex items-center gap-1.5 animate-[marquee_25s_linear_infinite] hover:[animation-play-state:paused]"
              >
                <span>{currentSlide.title || "Anuncio Importante"}</span>
                {currentSlide.linkUrl && <ExternalLink size={10} className="inline opacity-80" />}
              </motion.div>
            </AnimatePresence>
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
