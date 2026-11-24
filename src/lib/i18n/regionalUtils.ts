export type UnitSystem = "metric" | "imperial";

export const RTL_LANG_CODES = new Set(["ar", "iw", "he", "fa", "ur"]);

export const LANG_TO_BCP47: Record<string, string> = {
  es: "es-419",
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  it: "it-IT",
  "zh-CN": "zh-CN",
  zh: "zh-CN",
  iw: "he-IL",
  he: "he-IL",
  ru: "ru-RU",
  cs: "cs-CZ",
  ar: "ar-SA"
};

export const LANG_TO_SPEECH_LOCALE: Record<string, string> = {
  es: "es-ES",
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  it: "it-IT",
  "zh-CN": "zh-CN",
  zh: "zh-CN",
  iw: "he-IL",
  he: "he-IL",
  ru: "ru-RU",
  cs: "cs-CZ",
  ar: "ar-SA"
};

/**
 * Returns true if the language code requires Right-to-Left (RTL) layout direction.
 */
export function isRtlLanguage(lang?: string | null): boolean {
  if (!lang) return false;
  const base = lang.trim().toLowerCase().split("-")[0];
  return RTL_LANG_CODES.has(base);
}

/**
 * Normalizes app language code for Firebase Auth / BCP-47 APIs (`iw` -> `he`).
 */
export function toStandardLangCode(lang?: string | null): string {
  if (!lang) return "es";
  const trimmed = lang.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "iw" || lower.startsWith("he")) return "he";
  if (lower.startsWith("zh")) return "zh-CN";
  return lower.split("-")[0] || "es";
}

/**
 * Returns YYYY-MM-DD in the user's LOCAL device timezone (never UTC!),
 * eliminating the evening/morning off-by-one day shift in Americas & Asia-Pacific.
 */
export function getLocalISODate(input?: Date | number | string): string {
  let d: Date;
  if (input === undefined || input === null) {
    d = new Date();
  } else if (input instanceof Date) {
    d = input;
  } else if (typeof input === "number") {
    d = new Date(input);
  } else {
    // Preserve YYYY-MM-DD strings directly without UTC midnight shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
      return input.trim();
    }
    d = new Date(input);
  }
  if (Number.isNaN(d.getTime())) {
    d = new Date();
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Formats a timestamp or ISO date string using the active user language/region locale.
 */
export function formatRegionalDate(
  input: number | string | Date | undefined | null,
  lang: string = "es",
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }
): string {
  if (input === undefined || input === null || input === "") return "—";
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === "number") {
    d = new Date(input);
  } else if (/^\d+$/.test(input.trim())) {
    d = new Date(parseInt(input.trim(), 10));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    d = new Date(`${input.trim()}T12:00:00`);
  } else {
    d = new Date(input);
  }
  if (Number.isNaN(d.getTime())) return "—";
  const locale = LANG_TO_BCP47[lang] || LANG_TO_BCP47[toStandardLangCode(lang)] || "en-US";
  try {
    return d.toLocaleDateString(locale, options);
  } catch {
    return d.toLocaleDateString("en-US", options);
  }
}

/**
 * Safely parses numeric input accepting BOTH dot (`38.5`) and European/LatAm decimal comma (`38,5`).
 */
export function parseLocaleDecimal(raw: string | number | undefined | null, fallback = 0): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;

  // Handle thousands + decimal combinations: e.g. "1.234,5" -> "1234.5" or "1,234.5" -> "1234.5"
  let normalized = trimmed.replace(/\s+/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    normalized = normalized.replace(",", ".");
  }

  normalized = normalized.replace(/[^0-9.\-+]/g, "");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Returns default unit system for a country code (`US` -> imperial, others -> metric).
 */
export function getDefaultUnitSystemForCountry(countryCode?: string | null): UnitSystem {
  const code = (countryCode || "").trim().toUpperCase();
  if (code === "US" || code === "LR" || code === "MM") {
    return "imperial";
  }
  return "metric";
}

export function metersToYards(meters: number): number {
  return Math.round(meters * 1.0936133 * 10) / 10;
}

export function yardsToMeters(yards: number): number {
  return Math.round((yards / 1.0936133) * 100) / 100;
}

export function formatShootingDistance(
  distanceMeters: number,
  unitSystem: UnitSystem = "metric",
  distanceUnitOverride?: "m" | "yd",
  distanceValueOverride?: number
): string {
  const safeMeters = Number(distanceMeters) || 0;
  if (distanceUnitOverride === "yd") {
    const ydVal =
      typeof distanceValueOverride === "number" && distanceValueOverride > 0
        ? distanceValueOverride
        : Math.round(metersToYards(safeMeters));
    return `${Math.round(ydVal * 10) / 10}yd`;
  }
  if (distanceUnitOverride === "m") {
    const mVal =
      typeof distanceValueOverride === "number" && distanceValueOverride > 0
        ? distanceValueOverride
        : safeMeters;
    return `${Math.round(mVal * 10) / 10}m`;
  }
  if (unitSystem === "imperial") {
    return `${Math.round(metersToYards(safeMeters))}yd`;
  }
  return `${Math.round(safeMeters * 10) / 10}m`;
}

export function formatWalkedDistanceRegional(meters: number, unitSystem: UnitSystem = "metric"): string {
  const safeM = Math.max(0, Number(meters) || 0);
  if (unitSystem === "imperial") {
    const miles = safeM / 1609.344;
    if (miles >= 0.1) {
      return `${miles.toFixed(2)} mi`;
    }
    const feet = Math.round(safeM * 3.28084);
    return `${feet} ft`;
  }
  if (safeM >= 1000) {
    return `${(safeM / 1000).toFixed(2)} km`;
  }
  return `${Math.round(safeM)} m`;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const safeCm = Math.max(0, Number(cm) || 0);
  const totalInches = safeCm / 2.54;
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  const totalInches = Math.max(0, Number(feet) || 0) * 12 + Math.max(0, Number(inches) || 0);
  return Math.round(totalInches * 2.54);
}

export function kgToLbs(kg: number): number {
  return Math.round(Math.max(0, Number(kg) || 0) * 2.20462262 * 10) / 10;
}

export function lbsToKg(lbs: number): number {
  return Math.round((Math.max(0, Number(lbs) || 0) / 2.20462262) * 10) / 10;
}

export function formatHeightRegional(cm?: number | null, unitSystem: UnitSystem = "metric"): string {
  if (!cm || cm <= 0) return "—";
  if (unitSystem === "imperial") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}

export function formatWeightRegional(kg?: number | null, unitSystem: UnitSystem = "metric"): string {
  if (!kg || kg <= 0) return "—";
  if (unitSystem === "imperial") {
    return `${kgToLbs(kg)} lbs`;
  }
  return `${Math.round(kg * 10) / 10} kg`;
}

/**
 * Returns the legal digital consent minimum age for independent athlete registration by country
 * (EU GDPR Art. 8 member-state derogations, South Korea PIPA 14+, China PIPL 14+, COPPA/LGPD 13+).
 * Note: Coaches always require 18+.
 */
export function getMinimumConsentAge(countryCode?: string | null): number {
  const c = (countryCode || "").trim().toUpperCase();
  // 16+ GDPR countries
  if (["DE", "FR", "NL", "IE", "PL", "HU", "SK", "HR", "RO", "LU"].includes(c)) {
    return 16;
  }
  // 15+ GDPR countries
  if (["CZ", "GR", "SI"].includes(c)) {
    return 15;
  }
  // 14+ GDPR / PIPA (Korea) / PIPL (China) / Peru / Austria / Italy / Spain
  if (["ES", "IT", "AT", "BG", "CY", "LT", "KR", "CN", "PE"].includes(c)) {
    return 14;
  }
  // Default 13+ (COPPA US, UK, LatAm, Japan, Canada, Australia, Brazil, etc.)
  return 13;
}

export function getSpeechLocale(lang?: string | null): string {
  if (!lang) return "es-ES";
  return (
    LANG_TO_SPEECH_LOCALE[lang] ||
    LANG_TO_SPEECH_LOCALE[toStandardLangCode(lang)] ||
    "en-US"
  );
}

/**
 * Selects the best matching SpeechSynthesisVoice for a target BCP-47 locale.
 */
export function pickVoiceForLanguage(
  voices: SpeechSynthesisVoice[],
  lang: string,
  preferFemale?: boolean
): SpeechSynthesisVoice | undefined {
  if (!voices || voices.length === 0) return undefined;
  const targetLocale = getSpeechLocale(lang).toLowerCase();
  const baseLang = targetLocale.split("-")[0];

  const matching = voices.filter((v) => {
    const vl = (v.lang || "").toLowerCase();
    return vl === targetLocale || vl.startsWith(`${baseLang}-`) || vl === baseLang;
  });

  if (matching.length === 0) return undefined;
  if (preferFemale === undefined) return matching[0];

  const genderFiltered = matching.find((v) => {
    const n = v.name.toLowerCase();
    if (preferFemale) {
      return (
        n.includes("female") ||
        n.includes("mujer") ||
        n.includes("samantha") ||
        n.includes("sabina") ||
        n.includes("helena") ||
        n.includes("yuna") ||
        n.includes("kyoko") ||
        n.includes("amelie") ||
        n.includes("anna") ||
        n.includes("luciana") ||
        n.includes("alice") ||
        n.includes("ting") ||
        n.includes("google")
      );
    }
    return (
      n.includes("male") ||
      n.includes("hombre") ||
      n.includes("daniel") ||
      n.includes("alex") ||
      n.includes("jorge") ||
      n.includes("pablo") ||
      n.includes("thomas") ||
      n.includes("markus") ||
      n.includes("luca")
    );
  });

  return genderFiltered || matching[0];
}
