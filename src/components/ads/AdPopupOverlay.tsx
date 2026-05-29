"use client";

import React, { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdCampaign } from "@/lib/db/adTypes";
import { recordImpression, recordClick } from "@/lib/adManager";

interface AdPopupOverlayProps {
  campaign: AdCampaign | null;
  onClose: () => void;
  userId: string;
}

export default function AdPopupOverlay({ campaign, onClose, userId }: AdPopupOverlayProps) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [closeSecondsLeft, setCloseSecondsLeft] = useState(3);
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    if (!campaign) return;

    // Record impression
    recordImpression(campaign.id, userId);

    // Block close button for 3 seconds
    setCloseSecondsLeft(3);
    setCanClose(false);

    const interval = setInterval(() => {
      setCloseSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setCanClose(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [campaign, userId]);

  // Handle slide transitions if there are multiple slides
  useEffect(() => {
    if (!campaign || campaign.slides.length <= 1) return;

    const intervalSeconds = campaign.slideIntervalSeconds || 5;
    const slideInterval = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % campaign.slides.length);
    }, intervalSeconds * 1000);

    return () => clearInterval(slideInterval);
  }, [campaign]);

  if (!campaign) return null;

  const currentSlide = campaign.slides[activeSlideIndex];
  if (!currentSlide) return null;

  const handleAdClick = () => {
    recordClick(campaign.id, currentSlide.id);
    window.open(currentSlide.linkUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        {/* Backdrop overlay close (only if allowed) */}
        <div 
          className="absolute inset-0" 
          onClick={() => {
            if (canClose) onClose();
          }} 
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="relative w-full max-w-lg aspect-[4/5] md:aspect-square overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0C] shadow-[0_20px_50px_rgba(0,191,255,0.15)] flex flex-col justify-between"
        >
          {/* Close Button / Countdown */}
          <div className="absolute top-4 right-4 z-20">
            {canClose ? (
              <button
                onClick={onClose}
                className="p-2.5 rounded-full bg-black/60 border border-white/10 text-white/80 hover:text-white hover:bg-black/80 transition duration-200 cursor-pointer flex items-center justify-center"
              >
                <X size={18} />
              </button>
            ) : (
              <div className="px-3 py-1.5 rounded-full bg-black/70 border border-white/5 text-white/60 text-[10px] font-black uppercase tracking-wider select-none">
                Cerrar en {closeSecondsLeft}s
              </div>
            )}
          </div>

          {/* Ad Slide Content */}
          <div 
            onClick={handleAdClick}
            className="relative flex-1 cursor-pointer group overflow-hidden"
          >
            {/* Background Image / Color */}
            {currentSlide.imageUrl ? (
              <div 
                className="w-full h-full bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                style={{ backgroundImage: `url(${currentSlide.imageUrl})` }}
              />
            ) : (
              <div 
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: currentSlide.backgroundColor || "#0A0A0C" }}
              />
            )}

            {/* Dark gradient overlay for text legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

            {/* Title / Subtitle overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-1">
              {currentSlide.title && (
                <h3 className="text-xl md:text-2xl font-black text-white leading-tight group-hover:text-cyan-neon transition-colors duration-200 flex items-center gap-2">
                  {currentSlide.title}
                  <ExternalLink size={16} className="inline opacity-60 group-hover:opacity-100 transition-opacity" />
                </h3>
              )}
              {currentSlide.subtitle && (
                <p className="text-xs md:text-sm text-gray-400 font-medium">
                  {currentSlide.subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Bottom Bar: Publicidad Badge + Dots Indicator */}
          <div className="h-12 px-6 flex items-center justify-between border-t border-white/5 bg-[#0F0F12]">
            <span className="text-[9px] font-black uppercase tracking-widest text-white/30 px-2 py-0.5 rounded bg-white/5">
              Publicidad
            </span>

            {/* Dots Pagination */}
            {campaign.slides.length > 1 && (
              <div className="flex gap-1.5">
                {campaign.slides.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setActiveSlideIndex(index)}
                    className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                      index === activeSlideIndex 
                        ? "bg-cyan-neon w-4" 
                        : "bg-white/20 hover:bg-white/40"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
