"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, TranslationKey } from "../translations/dict";
import { getLocalSetting, saveLocalSetting } from "../db/indexedDB";

export type Language = string;

export interface LanguageOption {
  code: string;
  shortLabel: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "es", shortLabel: "ES", name: "Español", nativeName: "Español", flag: "🇪🇸" },
  { code: "en", shortLabel: "EN", name: "Inglés", nativeName: "English", flag: "🇺🇸" },
  { code: "ko", shortLabel: "KO", name: "Coreano", nativeName: "한국어", flag: "🇰🇷" },
  { code: "fr", shortLabel: "FR", name: "Francés", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", shortLabel: "DE", name: "Alemán", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "pt", shortLabel: "PT", name: "Portugués", nativeName: "Português", flag: "🇧🇷" },
  { code: "it", shortLabel: "IT", name: "Italiano", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "zh-CN", shortLabel: "ZH", name: "Chino", nativeName: "中文", flag: "🇨🇳" },
];

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

function normalizeLangCode(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  const base = lower.split("-")[0];
  return base;
}

// Helper function to detect standard system OS language or timezone location fallback
function detectSystemLanguage(): string {
  if (typeof window === "undefined") return "es";

  const supportedCodes = SUPPORTED_LANGUAGES.map((l) => l.code);

  // 1. Check navigator.languages
  if (navigator.languages && navigator.languages.length > 0) {
    for (const lang of navigator.languages) {
      const normalized = normalizeLangCode(lang);
      if (supportedCodes.includes(normalized)) {
        return normalized;
      }
      if (normalized.length === 2 || normalized.length === 3) {
        return normalized;
      }
    }
  }

  // 2. Check navigator.language
  if (navigator.language) {
    const normalized = normalizeLangCode(navigator.language);
    if (supportedCodes.includes(normalized) || normalized.length === 2 || normalized.length === 3) {
      return normalized;
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
    if (spanishTzs.some((city) => lowerTz.includes(city))) {
      return "es";
    }
  } catch {
    // Ignore timezone parsing errors
  }

  return "es";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");
  const [isLoaded, setIsLoaded] = useState(false);

  // Load language preference from IndexedDB / localStorage on mount
  useEffect(() => {
    async function loadPreference() {
      try {
        const savedLang = await getLocalSetting<string | null>("preferred_language", null);
        if (savedLang) {
          setLanguageState(savedLang);
        } else {
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
      } catch {
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
      await saveLocalSetting("preferred_language", lang);
    } catch {
      // Ignore IndexedDB error
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("preferred_language", lang);

      if (lang === "es") {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
        if (document.getElementById("google-translate-script")) {
          window.location.reload();
          return;
        }
      } else {
        document.cookie = `googtrans=/es/${lang}; path=/;`;
        document.cookie = `googtrans=/es/${lang}; path=/; domain=${window.location.hostname};`;
        window.location.reload();
        return;
      }
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  // Activate neural DOM translation for non-Spanish languages so 100% of screens translate seamlessly
  useEffect(() => {
    if (typeof window === "undefined") return;

    const needTranslate = language !== "es";

    if (needTranslate) {
      document.cookie = `googtrans=/es/${language}; path=/;`;
      document.cookie = `googtrans=/es/${language}; path=/; domain=${window.location.hostname};`;

      if (!document.getElementById("google-translate-script")) {
        const script = document.createElement("script");
        script.id = "google-translate-script";
        script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
        script.async = true;
        document.body.appendChild(script);

        (window as any).googleTranslateElementInit = () => {
          new (window as any).google.translate.TranslateElement(
            {
              pageLanguage: "es",
              layout: (window as any).google.translate.TranslateElement.InlineLayout.SIMPLE,
              autoDisplay: false,
            },
            "google_translate_element"
          );
        };
      }
    } else {
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
    }
  }, [language]);

  const t = (key: TranslationKey): string => {
    const dict = (translations as any)[language] || translations["es"];
    return dict[key] || translations["es"][key] || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      <div id="google_translate_element" style={{ display: "none", visibility: "hidden" }} />
      {isLoaded ? (
        children
      ) : (
        <div className="min-h-screen flex items-center justify-center bg-black-oled text-cyan-neon font-bold">
          {t("loading")}
        </div>
      )}
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
