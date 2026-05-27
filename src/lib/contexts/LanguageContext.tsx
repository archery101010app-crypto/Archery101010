"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, TranslationKey } from "../translations/dict";
import { getLocalSetting, saveLocalSetting } from "../db/indexedDB";

type Language = "es" | "en";

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load language preference from IndexedDB / localStorage on mount
  useEffect(() => {
    async function loadPreference() {
      try {
        // Read preference from IndexedDB (fallback to default "es")
        const savedLang = await getLocalSetting<Language>("preferred_language", "es");
        setLanguageState(savedLang);
      } catch (e) {
        console.warn("Could not load language from IndexedDB, trying localStorage", e);
        if (typeof window !== "undefined") {
          const localLang = localStorage.getItem("preferred_language") as Language;
          if (localLang === "es" || localLang === "en") {
            setLanguageState(localLang);
          }
        }
      } finally {
        setIsLoaded(true);
      }
    }
    loadPreference();
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    try {
      // Persist in IndexedDB (resilient storage)
      await saveLocalSetting("preferred_language", lang);
    } catch (e) {
      console.warn("Could not save language to IndexedDB, trying localStorage", e);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("preferred_language", lang);
    }
  };

  const t = (key: TranslationKey): string => {
    const dict = translations[language];
    return dict[key] || translations["es"][key] || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {isLoaded ? children : <div className="min-h-screen flex items-center justify-center bg-black-oled text-cyan-neon font-bold">{t("loading")}</div>}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
