"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { translations, offlineFallbackTranslations, TranslationKey } from "../translations/dict";
import { getLocalSetting, saveLocalSetting } from "../db/indexedDB";
import {
  UnitSystem,
  isRtlLanguage,
  toStandardLangCode,
  getDefaultUnitSystemForCountry
} from "../i18n/regionalUtils";
import { auth } from "../firebase";

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
  { code: "ja", shortLabel: "JA", name: "Japonés", nativeName: "日本語", flag: "🇯🇵" },
  { code: "fr", shortLabel: "FR", name: "Francés", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", shortLabel: "DE", name: "Alemán", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "pt", shortLabel: "PT", name: "Portugués", nativeName: "Português", flag: "🇧🇷" },
  { code: "it", shortLabel: "IT", name: "Italiano", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "zh-CN", shortLabel: "ZH", name: "Chino", nativeName: "中文", flag: "🇨🇳" },
  { code: "iw", shortLabel: "HE", name: "Hebreo", nativeName: "עברית", flag: "🇮🇱" },
  { code: "ru", shortLabel: "RU", name: "Ruso", nativeName: "Русский", flag: "🇷🇺" },
  { code: "cs", shortLabel: "CS", name: "Checo", nativeName: "Čeština", flag: "🇨🇿" },
  { code: "ar", shortLabel: "AR", name: "Árabe", nativeName: "العربية", flag: "🇸🇦" }
];

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  unitSystem: UnitSystem;
  setUnitSystem: (units: UnitSystem) => Promise<void>;
  isRtl: boolean;
  t: (key: TranslationKey) => string;
  tx: (esText: string, enText: string) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

function normalizeLangCode(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower === "he" || lower.startsWith("he-") || lower === "iw") return "iw";
  if (lower.startsWith("ja") || lower === "jp") return "ja";
  const base = lower.split("-")[0];
  return base;
}

function detectSystemLanguage(): string {
  if (typeof window === "undefined") return "es";

  const supportedCodes = SUPPORTED_LANGUAGES.map((l) => l.code);

  if (navigator.languages && navigator.languages.length > 0) {
    for (const lang of navigator.languages) {
      const normalized = normalizeLangCode(lang);
      if (supportedCodes.includes(normalized)) {
        return normalized;
      }
    }
  }

  if (navigator.language) {
    const normalized = normalizeLangCode(navigator.language);
    if (supportedCodes.includes(normalized)) {
      return normalized;
    }
  }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase();
    const spanishTzs = [
      "madrid", "canary", "mexico", "monterrey", "merida", "tijuana", "chihuahua",
      "hermosillo", "cancun", "bogota", "caracas", "santiago", "buenos_aires",
      "lima", "quito", "guayaquil", "la_paz", "asuncion", "montevideo", "guatemala",
      "el_salvador", "tegucigalpa", "managua", "costa_rica", "panama", "havana",
      "santo_domingo", "puerto_rico"
    ];
    if (spanishTzs.some((city) => tz.includes(city))) {
      return "es";
    }
    if (tz.includes("seoul")) return "ko";
    if (tz.includes("tokyo")) return "ja";
    if (tz.includes("sao_paulo") || tz.includes("lisbon")) return "pt";
    if (tz.includes("paris")) return "fr";
    if (tz.includes("berlin") || tz.includes("zurich") || tz.includes("vienna")) return "de";
    if (tz.includes("rome")) return "it";
    if (tz.includes("shanghai") || tz.includes("beijing") || tz.includes("taipei")) return "zh-CN";
    if (tz.includes("jerusalem")) return "iw";
    if (tz.includes("prague")) return "cs";
    if (tz.includes("riyadh") || tz.includes("dubai") || tz.includes("cairo")) return "ar";
  } catch {
    // Ignore timezone parsing errors
  }

  return "en";
}

function detectSystemUnitSystem(): UnitSystem {
  if (typeof window === "undefined") return "metric";
  try {
    const loc = (navigator.language || "").toUpperCase();
    if (loc.endsWith("-US") || loc.endsWith("_US")) {
      return "imperial";
    }
  } catch {}
  return "metric";
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>("metric");
  const [isLoaded, setIsLoaded] = useState(false);

  // Purge any legacy Google Translate cookies/scripts from earlier versions so React 19 DOM never crashes
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    try {
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
      const legacyScript = document.getElementById("google-translate-script");
      if (legacyScript) legacyScript.remove();
    } catch {}
  }, []);

  useEffect(() => {
    async function loadPreferences() {
      try {
        const [savedLang, savedUnits] = await Promise.all([
          getLocalSetting<string | null>("preferred_language", null),
          getLocalSetting<UnitSystem | null>("preferred_unit_system", null)
        ]);

        const localLang =
          savedLang ||
          (typeof window !== "undefined" ? localStorage.getItem("preferred_language") : null) ||
          detectSystemLanguage();
        setLanguageState(localLang);

        const rawLocalUnits =
          savedUnits ||
          (typeof window !== "undefined"
            ? (localStorage.getItem("preferred_unit_system") as UnitSystem | null)
            : null);
        if (rawLocalUnits === "metric" || rawLocalUnits === "imperial") {
          setUnitSystemState(rawLocalUnits);
        } else {
          // Check active user profile country if saved
          const activeProfile = await getLocalSetting<any>("current_user", null).catch(() => null);
          if (activeProfile?.unitSystem === "imperial" || activeProfile?.unitSystem === "metric") {
            setUnitSystemState(activeProfile.unitSystem);
          } else if (activeProfile?.country) {
            setUnitSystemState(getDefaultUnitSystemForCountry(activeProfile.country));
          } else {
            setUnitSystemState(detectSystemUnitSystem());
          }
        }
      } catch {
        setLanguageState(detectSystemLanguage());
        setUnitSystemState(detectSystemUnitSystem());
      } finally {
        setIsLoaded(true);
      }
    }
    loadPreferences();
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    try {
      await saveLocalSetting("preferred_language", lang);
    } catch {}
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("preferred_language", lang);
      } catch {}
    }
  };

  const setUnitSystem = async (units: UnitSystem) => {
    setUnitSystemState(units);
    try {
      await saveLocalSetting("preferred_unit_system", units);
    } catch {}
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("preferred_unit_system", units);
      } catch {}
    }
  };

  // Sync <html lang>, <html dir="rtl"|"ltr">, and Firebase Auth languageCode automatically
  useEffect(() => {
    const stdLang = toStandardLangCode(language);
    if (typeof document !== "undefined") {
      document.documentElement.lang = stdLang;
      document.documentElement.dir = isRtlLanguage(language) ? "rtl" : "ltr";
    }
    try {
      if (auth) {
        auth.languageCode = stdLang;
      }
    } catch {}
  }, [language]);

  const t = (key: TranslationKey): string => {
    const exactDict = (translations as Record<string, Record<string, string>>)[language];
    if (exactDict && exactDict[key]) {
      return exactDict[key];
    }
    const fallbackLangDict = offlineFallbackTranslations[language];
    if (fallbackLangDict && fallbackLangDict[key]) {
      return fallbackLangDict[key] as string;
    }
    // For all non-Spanish languages, fall back to English World Archery terminology rather than Spanish
    if (language !== "es" && translations.en[key]) {
      return translations.en[key];
    }
    return translations.es[key] || String(key);
  };

  const tx = (esText: string, enText: string): string => {
    return language === "es" ? esText : enText;
  };

  const isRtl = isRtlLanguage(language);

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, unitSystem, setUnitSystem, isRtl, t, tx }}
    >
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
