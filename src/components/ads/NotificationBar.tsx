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

  // Record impression on load
  useEffect(() => {
    if (!campaign) return;
    import("@/lib/adManager").then(({ recordImpression }) => {
      recordImpression(campaign.id, "anonymous-visitor");
    });
  }, [campaign?.id, activeSlideIndex]);

  if (!campaign || !isVisible) return null;

  const currentSlide = campaign.slides[activeSlideIndex];
  if (!currentSlide) return null;

  // Handle tap-to-close behavior
  const handleBarClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".close-btn")) return;

    // Record click
    import("@/lib/adManager").then(({ recordClick }) => {
      recordClick(campaign.id, currentSlide.id);
    });

    // Open target link
    if (currentSlide.linkUrl && typeof window !== "undefined") {
      try {
        const parsed = new URL(currentSlide.linkUrl.trim(), window.location.origin);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          window.open(parsed.href, "_blank", "noopener,noreferrer");
        }
      } catch {
        // Ignore malformed or non-HTTP URLs
      }
    }
    
    // Close immediately
    setIsVisible(false);
    onClose();
  };

  // Get style configurations
  const heightVal = campaign.customHeight || 32;
  const pillStyle = campaign.pillStyle || "solid";
  const sizeClass = campaign.fontSize === "small" 
    ? "text-[10.5px]" 
    : campaign.fontSize === "large" 
      ? "text-[13.8px]" 
      : "text-[12.8px]"; // default medium

  // Default color is the branding color (cyan-neon) if solid and no custom color
  const defaultBg = "#00BFFF"; // Cyan oficial

  const styleObj: React.CSSProperties = {
    minHeight: `${heightVal}px`,
  };

  let classNameVal = "max-w-[calc(100vw-1.5rem)] sm:max-w-md md:max-w-xl py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] flex items-center justify-between px-3.5 sm:px-4 cursor-pointer rounded-2xl sm:rounded-full border transition duration-200 ";

  if (pillStyle === "glass") {
    classNameVal += "bg-neutral-950/75 backdrop-blur-md border-white/10 text-white hover:bg-neutral-900/80";
  } else if (pillStyle === "gradient") {
    // Matte OLED titanium surface + crisp 1px cyan border
    styleObj.backgroundImage = "linear-gradient(135deg, #06080C 0%, #12151C 100%)";
    styleObj.borderColor = "rgba(0, 168, 243, 0.45)";
    styleObj.color = "#FFFFFF";
    classNameVal += "text-white hover:brightness-110";
  } else {
    // Solid style
    styleObj.backgroundColor = currentSlide.backgroundColor || defaultBg;
    classNameVal += "border-transparent text-black font-extrabold hover:brightness-110";
  }

  return (
    <AnimatePresence>
      <div 
        className="fixed left-1/2 -translate-x-1/2 z-[100] flex justify-center w-auto px-4"
        style={{ top: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <motion.div
          initial={{ y: -50, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -50, opacity: 0, scale: 0.9 }}
          style={styleObj}
          className={classNameVal}
          onClick={handleBarClick}
        >
          {/* Main content - slide transition */}
          <div className="flex-1 min-w-0 relative flex items-center pr-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSlideIndex}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={`${sizeClass} font-black select-none tracking-wide flex items-center gap-1.5`}
              >
                <span className="break-words leading-tight">
                  {(currentSlide.title || "Anuncio Importante").replace(/[\p{Extended_Pictographic}\u2600-\u27BF]/gu, "").trim()}
                </span>
                {currentSlide.linkUrl && <ExternalLink size={10} className="inline opacity-80 shrink-0" />}
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
            className="close-btn p-1 rounded-full bg-black/10 hover:bg-black/20 text-current hover:scale-105 transition duration-200 cursor-pointer flex items-center justify-center"
          >
            <X size={10} />
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
