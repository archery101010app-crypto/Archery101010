"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, TranslationKey } from "../translations/dict";
import { getLocalSetting, saveLocalSetting } from "../db/indexedDB";

type Language = string;

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

// Helper function to detect standard system OS language or timezone location fallback
function detectSystemLanguage(): string {
  if (typeof window === "undefined") return "es";

  const supportedLanguages = Object.keys(translations);

  // 1. Check navigator.languages for a matching supported language or any preferred language
  if (navigator.languages && navigator.languages.length > 0) {
    for (const lang of navigator.languages) {
      const cleanLang = lang.split("-")[0].toLowerCase();
      // If it is directly supported (es or en), return it
      if (supportedLanguages.includes(cleanLang)) {
        return cleanLang;
      }
      // If not es or en, return the code directly so Google Translate can translate it!
      if (cleanLang.length === 2 || cleanLang.length === 3) {
        return cleanLang;
      }
    }
  }

  // 2. Check navigator.language
  if (navigator.language) {
    const cleanLang = navigator.language.split("-")[0].toLowerCase();
    if (supportedLanguages.includes(cleanLang) || cleanLang.length === 2 || cleanLang.length === 3) {
      return cleanLang;
    }
  }

  // 3. Fallback check by Timezone/Location
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const spanishTzs = [
      "madrid", "canary", "mexico", "monterrey", "merida", "tijuana", "chihuahua", 
      "hermosillo", "cancun", "bogota", "caracas", "santiago", "buenos_aires", 
      "lima", "quito", "guayaquil", "la_paz", "asuncion", "montevideo", "guatemala", 
      "el_salvador", "tegucigalpa", "managua", "costa_rica", "panama", "havana", 
      "santo_domingo", "puerto_rico"
    ];
    const lowerTz = tz.toLowerCase();
    if (spanishTzs.some(city => lowerTz.includes(city))) {
      return "es";
    }
  } catch (e) {
    // Ignore timezone parsing errors
  }

  // 4. Default fallback
  return "es";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load language preference from IndexedDB / localStorage on mount
  useEffect(() => {
    async function loadPreference() {
      try {
        // Read preference from IndexedDB (fallback to null to detect)
        const savedLang = await getLocalSetting<string | null>("preferred_language", null);
        if (savedLang) {
          setLanguageState(savedLang);
        } else {
          // Try localStorage
          let localLang: string | null = null;
          if (typeof window !== "undefined") {
            localLang = localStorage.getItem("preferred_language");
          }
          if (localLang) {
            setLanguageState(localLang);
          } else {
            const detected = detectSystemLanguage();
            setLanguageState(detected);
          }
        }
      } catch (e) {
        console.warn("Could not load language from IndexedDB, trying localStorage", e);
        let localLang: string | null = null;
        if (typeof window !== "undefined") {
          localLang = localStorage.getItem("preferred_language");
        }
        if (localLang) {
          setLanguageState(localLang);
        } else {
          const detected = detectSystemLanguage();
          setLanguageState(detected);
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
      
      // If switching to es/en, clear Google Translate cookies and reload if Translate was active
      if (lang === "es" || lang === "en") {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
        if (document.getElementById("google-translate-script")) {
          window.location.reload();
          return;
        }
      } else {
        // If switching to another language via Google Translate, set cookie and reload
        document.cookie = `googtrans=/es/${lang}; path=/;`;
        document.cookie = `googtrans=/es/${lang}; path=/; domain=${window.location.hostname};`;
        window.location.reload();
        return;
      }
    }
  };

  // Sync lang attribute of html tag dynamically for SEO/accessibility
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  // Google Translate script and cookie management
  useEffect(() => {
    if (typeof window === "undefined") return;

    const needTranslate = language !== "es" && language !== "en";

    if (needTranslate) {
      // Set the Google Translate cookie
      document.cookie = `googtrans=/es/${language}; path=/;`;
      document.cookie = `googtrans=/es/${language}; path=/; domain=${window.location.hostname};`;

      // Inject Google Translate script if it does not exist
      if (!document.getElementById("google-translate-script")) {
        const script = document.createElement("script");
        script.id = "google-translate-script";
        script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
        script.async = true;
        document.body.appendChild(script);

        // Define global callback
        (window as any).googleTranslateElementInit = () => {
          new (window as any).google.translate.TranslateElement({
            pageLanguage: 'es',
            layout: (window as any).google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: false
          }, 'google_translate_element');
        };
      }
    } else {
      // Clear Translate cookies if we are back to es or en
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
    }
  }, [language]);

  const t = (key: TranslationKey): string => {
    // If the language is not es or en, render in Spanish so Google Translate has clean base text to translate from
    const dict = (translations as any)[language] || translations["es"];
    return dict[key] || translations["es"][key] || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {/* Hidden container required by Google Translate */}
      <div id="google_translate_element" style={{ display: "none", visibility: "hidden" }} />
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
