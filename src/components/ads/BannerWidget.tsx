"use client";

import React, { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdCampaign } from "@/lib/db/adTypes";

interface BannerWidgetProps {
  campaign: AdCampaign | null;
  onSlideClick: (slideId: string, linkUrl: string) => void;
  onClose?: () => void;
}

export default function BannerWidget({ campaign, onSlideClick, onClose }: BannerWidgetProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [direction, setDirection] = useState(0); // -1 for left, 1 for right

  // Reset active slide index when campaign changes
  useEffect(() => {
    setActiveSlideIndex(0);
  }, [campaign]);

  // Auto transition
  useEffect(() => {
    if (!campaign || campaign.slides.length <= 1) return;

    const intervalSeconds = campaign.slideIntervalSeconds || 5;
    const interval = setInterval(() => {
      setDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % campaign.slides.length);
    }, intervalSeconds * 1000);

    return () => clearInterval(interval);
  }, [campaign]);

  if (!campaign) return null;

  const slides = campaign.slides;
  const currentSlide = slides[activeSlideIndex];
  if (!currentSlide) return null;

  const handleBannerClick = (e: React.MouseEvent) => {
    // Prevent trigger if clicking close button
    const target = e.target as HTMLElement;
    if (target.closest(".close-btn")) return;

    onSlideClick(currentSlide.id, currentSlide.linkUrl);
    window.open(currentSlide.linkUrl, "_blank", "noopener,noreferrer");
  };

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 100 : -100,
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1
    },
    exit: (dir: number) => ({
      x: dir < 0 ? 100 : -100,
      opacity: 0
    })
  };

  const handleDragEnd = (event: any, info: any) => {
    if (slides.length <= 1) return;
    const threshold = 50;
    if (info.offset.x < -threshold) {
      // Swiped left, show next
      setDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % slides.length);
    } else if (info.offset.x > threshold) {
      // Swiped right, show prev
      setDirection(-1);
      setActiveSlideIndex((prev) => (prev - 1 + slides.length) % slides.length);
    }
  };

  return (
    <motion.div
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -50, opacity: 0 }}
      className="fixed top-16 left-0 right-0 z-30 h-20 w-full px-0 md:px-4 flex justify-center pointer-events-none"
    >
      <div
        className="w-full max-w-5xl h-full bg-[#0E0E12] border-b md:border border-white/10 md:rounded-2xl overflow-hidden relative shadow-[0_4px_20px_rgba(0,0,0,0.4)] flex items-center pointer-events-auto cursor-pointer"
        onClick={handleBannerClick}
      >
        {/* Slides Content */}
        <div className="flex-1 h-full relative overflow-hidden">
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={activeSlideIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ opacity: { duration: 0.25 }, x: { type: "spring", stiffness: 300, damping: 30 } }}
              drag={slides.length > 1 ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={handleDragEnd}
              className="absolute inset-0 w-full h-full select-none flex items-center"
            >
              {/* Background Image / Color */}
              {currentSlide.imageUrl ? (
                <div 
                  className="absolute inset-0 bg-cover bg-center pointer-events-none"
                  style={{ backgroundImage: `url(${currentSlide.imageUrl})` }}
                />
              ) : (
                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: currentSlide.backgroundColor || "#0E0E12" }}
                />
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-black/60 md:bg-black/50" />

              {/* Text content */}
              <div className="relative z-10 px-4 md:px-8 flex flex-col justify-center max-w-[80%]">
                <span className="text-[7px] font-black uppercase tracking-widest text-cyan-neon bg-cyan-neon/10 px-1.5 py-0.5 rounded w-max mb-1">
                  Patrocinador
                </span>
                {currentSlide.title && (
                  <h4 className="text-sm md:text-base font-black text-white truncate flex items-center gap-1.5">
                    {currentSlide.title}
                    <ExternalLink size={12} className="inline opacity-50" />
                  </h4>
                )}
                {currentSlide.subtitle && (
                  <p className="text-[10px] md:text-sm text-white/60 truncate font-medium">
                    {currentSlide.subtitle}
                  </p>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Action controls (Close + Dots) */}
        <div className="relative z-20 flex items-center gap-3 pr-4 h-full">
          {/* Slide dots indicators */}
          {slides.length > 1 && (
            <div className="hidden sm:flex gap-1">
              {slides.map((_, index) => (
                <span
                  key={index}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDirection(index > activeSlideIndex ? 1 : -1);
                    setActiveSlideIndex(index);
                  }}
                  className={`w-1 h-1 rounded-full cursor-pointer transition-all duration-300 ${
                    index === activeSlideIndex ? "bg-cyan-neon w-3.5" : "bg-white/20 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onClose) onClose();
            }}
            className="close-btn p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition duration-200 cursor-pointer flex items-center justify-center border border-transparent hover:border-white/10"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
