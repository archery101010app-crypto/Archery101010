"use client";

import React, { useState } from "react";
import { Globe, Check, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage, SUPPORTED_LANGUAGES } from "@/lib/contexts/LanguageContext";

interface LanguageSelectorProps {
  variant?: "pill" | "card";
}

export default function LanguageSelector({ variant = "pill" }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const currentOption =
    SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === language.toLowerCase()) ||
    SUPPORTED_LANGUAGES[0];

  const handleSelect = async (code: string) => {
    setIsOpen(false);
    if (code !== language) {
      await setLanguage(code);
    }
  };

  if (variant === "card") {
    return (
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={17} className="text-cyan-neon shrink-0" />
            <h4 className="text-white text-[13.8px] font-black uppercase tracking-wider">
              {t("appLanguage")}
            </h4>
          </div>
          <span
            translate="no"
            className="notranslate text-[12.7px] font-bold text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/25 px-2.5 py-0.5 rounded-full"
          >
            {currentOption.flag} {currentOption.nativeName}
          </span>
        </div>

        <div translate="no" className="notranslate grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = lang.code.toLowerCase() === language.toLowerCase();
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleSelect(lang.code)}
                className={`h-10 px-3 rounded-xl border text-[13.8px] font-bold flex items-center justify-between transition cursor-pointer ${
                  isSelected
                    ? "bg-[#111622] border-cyan-neon text-white"
                    : "bg-[#090B0F] border-white/[0.06] text-white hover:border-white/20"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span>{lang.flag}</span>
                  <span className="truncate">{lang.nativeName}</span>
                </span>
                {isSelected && <Check size={15} className="text-cyan-neon shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        translate="no"
        className="notranslate min-h-[38px] h-[38px] px-3.5 rounded-full bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
        aria-label={t("selectLanguage")}
      >
        <Globe size={14} className="text-cyan-neon shrink-0" aria-hidden="true" />
        <span>{currentOption.shortLabel}</span>
        <ChevronDown size={13} className="text-white" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 8, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, y: 8, opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t("selectLanguage")}
              className="w-full max-w-[340px] bg-[#0B0D12] border border-white/[0.08] rounded-3xl p-5 flex flex-col gap-4 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-cyan-neon" aria-hidden="true" />
                  <h3 className="text-white text-xs font-black uppercase tracking-wider">
                    {t("selectLanguage")}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Cerrar selector de idioma"
                  className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] flex items-center justify-center text-white cursor-pointer transition"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div translate="no" className="notranslate grid grid-cols-2 gap-2 max-h-[70vh] overflow-y-auto pr-0.5">
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const isSelected = lang.code.toLowerCase() === language.toLowerCase();
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleSelect(lang.code)}
                      className={`h-11 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition cursor-pointer ${
                        isSelected
                          ? "bg-[#111622] border-cyan-neon text-white"
                          : "bg-[#0E1117] border-white/[0.06] text-white hover:border-white/20"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span>{lang.flag}</span>
                        <span className="truncate">{lang.nativeName}</span>
                      </span>
                      {isSelected && <Check size={14} className="text-cyan-neon shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
