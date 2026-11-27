"use client";

import { ShotImpactData, DispersionAnalysis, calculateDispersionAnalysis } from "./dispersionAnalytics";
import { DIANA_PRESETS } from "@/components/scoring/ScoringView";
import { calculateActiveKcal } from "./biometricsEngine";
import {
  UnitSystem,
  formatRegionalDate,
  formatShootingDistance,
  formatWalkedDistanceRegional
} from "@/lib/i18n/regionalUtils";
import {
  translations,
  offlineFallbackTranslations,
  TranslationKey
} from "@/lib/translations/dict";

export interface EndSummaryItem {
  arrows: string[];
  note?: string;
}

export type TelemetryCardThemeMode = "black" | "photo";

export interface TargetShotChartParams {
  impacts: ShotImpactData[];
  ends?: EndSummaryItem[];
  presetType?: string;
  score: number;
  maxScore: number;
  tensCount: number;
  xsCount: number;
  isVolumeOnly?: boolean;
  practiceType?: string;
  arrowsCount?: number;
  arrowsPerEnd?: number;
  distanceM: number;
  distanceLabel?: string;
  bowType: string;
  format?: string;
  archerName: string;
  dateStr?: string;
  sessionNote?: string;
  dispersion?: DispersionAnalysis | null;
  activeKcal?: number;
  distanceWalkedM?: number;
  bowPoundageLbs?: number;
  avgHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  themeMode?: TelemetryCardThemeMode;
  backgroundPhotoUrl?: string | null;
  lang?: string;
  unitSystem?: UnitSystem;
}

function resolveCardLang(lang?: string): string {
  if (lang && lang.trim()) return lang.trim();
  if (typeof window !== "undefined") {
    return localStorage.getItem("preferred_language") || "es";
  }
  return "es";
}

function resolveCardUnitSystem(unitSystem?: UnitSystem): UnitSystem {
  if (unitSystem === "imperial" || unitSystem === "metric") return unitSystem;
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("preferred_unit_system");
    if (stored === "imperial" || stored === "metric") return stored;
  }
  return "metric";
}

function tCard(lang: string, key: TranslationKey): string {
  const exact = (translations as Record<string, Record<string, string>>)[lang];
  if (exact && exact[key]) return exact[key];
  const fallback = offlineFallbackTranslations[lang];
  if (fallback && fallback[key]) return fallback[key] as string;
  if (lang !== "es" && translations.en[key]) return translations.en[key];
  return translations.es[key] || String(key);
}

const OFFICIAL_BADGE_BY_LANG: Record<string, string> = {
  es: "TELEMETRÍA OFICIAL",
  en: "OFFICIAL TELEMETRY",
  ko: "공식 텔레메트리",
  ja: "公式テレメトリー",
  fr: "TÉLÉMÉTRIE OFFICIELLE",
  de: "OFFIZIELLE TELEMETRIE",
  pt: "TELEMETRIA OFICIAL",
  it: "TELEMETRIA UFFICIALE",
  "zh-CN": "官方训练遥测",
  iw: "טלמטריה רשמית",
  ru: "ОФИЦ. ТЕЛЕМЕТРИЯ",
  cs: "OFICIÁLNÍ TELEMETRIE",
  ar: "القياس الرسمي"
};

const HEART_RATE_LABEL_BY_LANG: Record<string, string> = {
  es: "PULSACIONES",
  en: "HEART RATE",
  ko: "심박수",
  ja: "心拍数",
  fr: "PULSATIONS",
  de: "PULS",
  pt: "PULSAÇÕES",
  it: "PULSAZIONI",
  "zh-CN": "心率",
  iw: "דופק",
  ru: "ПУЛЬС",
  cs: "PULZ",
  ar: "النبض"
};

const MAX_SHORT_LABEL_BY_LANG: Record<string, string> = {
  es: "MÁX",
  en: "MAX",
  ko: "최대",
  ja: "最大",
  fr: "MAX",
  de: "MAX",
  pt: "MÁX",
  it: "MAX",
  "zh-CN": "最高",
  iw: "מקס׳",
  ru: "МАКС",
  cs: "MAX",
  ar: "أقصى"
};

const VOLUME_BOX_TITLE_BY_LANG: Record<string, string> = {
  es: "VOLUMEN",
  en: "VOLUME",
  ko: "볼륨",
  ja: "本数",
  fr: "VOLUME",
  de: "VOLUMEN",
  pt: "VOLUME",
  it: "VOLUME",
  "zh-CN": "箭量",
  iw: "נפח",
  ru: "ОБЪЁМ",
  cs: "OBJEM",
  ar: "الحجم"
};

const ENDS_BOX_TITLE_BY_LANG: Record<string, string> = {
  es: "TANDAS",
  en: "ENDS",
  ko: "엔드",
  ja: "エンド",
  fr: "VOLÉES",
  de: "PASSEN",
  pt: "SÉRIES",
  it: "VOLEÉ",
  "zh-CN": "组数",
  iw: "מקצים",
  ru: "СЕРИИ",
  cs: "SADY",
  ar: "الأشواط"
};

const SHOOT_DIST_TITLE_BY_LANG: Record<string, string> = {
  es: "DISTANCIA",
  en: "DISTANCE",
  ko: "거리",
  ja: "距離",
  fr: "DISTANCE",
  de: "DISTANZ",
  pt: "DISTÂNCIA",
  it: "DISTANZA",
  "zh-CN": "距离",
  iw: "מרחק",
  ru: "ДИСТАНЦИЯ",
  cs: "VZDÁLENOST",
  ar: "المسافة"
};

const ARROWS_SHOT_TITLE_BY_LANG: Record<string, string> = {
  es: "FLECHAS LANZADAS",
  en: "ARROWS SHOT",
  ko: "발사 화살",
  ja: "射数",
  fr: "FLÈCHES TIRÉES",
  de: "GESCHOSSENE PFEILE",
  pt: "FLECHAS DISPARADAS",
  it: "FRECCE TIRATE",
  "zh-CN": "已射箭数",
  iw: "חיצים שנורו",
  ru: "ВЫСТРЕЛЫ",
  cs: "VYSTŘELENÉ ŠÍPY",
  ar: "الأسهم المطلقة"
};

function isVolumeTelemetryParams(params: TargetShotChartParams): boolean {
  return Boolean(
    params.isVolumeOnly === true ||
      params.practiceType === "Volumen" ||
      params.format === "Volumen"
  );
}

function resolveTelemetryArrowsCount(params: TargetShotChartParams): number {
  const fromEnds =
    params.ends && params.ends.length > 0
      ? params.ends.reduce((sum, e) => sum + (e.arrows || []).filter((a) => a !== "").length, 0)
      : 0;
  const explicitCount =
    typeof params.arrowsCount === "number" && Number.isFinite(params.arrowsCount) && params.arrowsCount > 0
      ? Math.round(params.arrowsCount)
      : 0;
  if (explicitCount > 0) {
    return Math.max(explicitCount, fromEnds);
  }
  if (fromEnds > 0) {
    return fromEnds;
  }
  return params.impacts?.length || 0;
}

declare global {
  interface Window {
    ArcheryNativeShare?: {
      shareImage: (base64Png: string, fileName: string, title: string, captionText: string) => void;
      shareWhatsAppImage: (base64Png: string, fileName: string, captionText: string) => void;
      shareWhatsAppText: (text: string) => void;
      takeCameraPhoto?: () => void;
    };
  }
}

/**
 * If an archer scored in Keyboard Mode (or only plotted partial impacts),
 * synthesize realistic target ring coordinates for every scored arrow so the
 * telemetry target chart always looks complete and accurate.
 */
export function synthesizeImpactsFromEnds(
  existingImpacts: ShotImpactData[],
  ends?: EndSummaryItem[],
  presetType: string = "WA_10_122"
): ShotImpactData[] {
  if (existingImpacts && existingImpacts.length > 0) {
    return existingImpacts;
  }
  if (!ends || ends.length === 0) {
    return [];
  }

  const rings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
  const sortedRings = [...rings].sort((a, b) => a.r - b.r);

  const synthetic: ShotImpactData[] = [];
  let globalIdx = 0;

  ends.forEach((end, endIdx) => {
    (end.arrows || []).forEach((val, arrowIdx) => {
      if (!val || val === "" || val === "M") {
        globalIdx++;
        return;
      }
      const ringIdx = sortedRings.findIndex((r) => r.v === val);
      let innerR = 0;
      let outerR = 4.0;
      if (ringIdx !== -1) {
        outerR = sortedRings[ringIdx].r;
        innerR = ringIdx > 0 ? sortedRings[ringIdx - 1].r : 0;
      }
      const midR = (innerR + outerR) * 0.5;
      const angle = globalIdx * 2.399963229728653 + 0.45;
      const jitterR = ((globalIdx % 5) - 2) * ((outerR - innerR) * 0.14);
      const r = Math.max(0.4, midR + jitterR);

      synthetic.push({
        endIdx,
        arrowIdx,
        x: 50 + Math.cos(angle) * r,
        y: 50 + Math.sin(angle) * r,
        value: val
      });
      globalIdx++;
    });
  });

  return synthetic;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadImageAsset(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !src) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    const timeout = setTimeout(() => resolve(null), 3500);
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    img.src = src;
  });
}

function drawFallbackArchery101010TheApp(ctx: CanvasRenderingContext2D, centerX: number, topY: number) {
  ctx.save();
  ctx.textBaseline = "middle";

  const archeryFont = "900 54px 'Good Times', sans-serif";
  const numbersFont = "900 54px 'Outfit', sans-serif";

  ctx.font = archeryFont;
  const archeryText = "ARCHERY ";
  const archeryW = ctx.measureText(archeryText).width;

  ctx.font = numbersFont;
  const pairW = ctx.measureText("10").width;
  const totalW = archeryW + pairW * 3;
  let cursorX = centerX - totalW / 2;

  ctx.textAlign = "left";
  ctx.font = archeryFont;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(archeryText, cursorX, topY + 28);
  cursorX += archeryW;

  ctx.font = numbersFont;
  const pairColors = ["#00A8F3", "#FF1E1E", "#FFE500"];
  pairColors.forEach((col) => {
    ctx.fillStyle = col;
    ctx.fillText("10", cursorX, topY + 28);
    cursorX += pairW;
  });

  ctx.textAlign = "center";
  ctx.font = "900 32px 'Good Times', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.letterSpacing = "8px";
  ctx.fillText("THE APP", centerX, topY + 96);
  ctx.restore();
}

/**
 * Renders an Ultra-HD Vertical 9:16 (2x Retina: 2160x3840) Telemetry Card Canvas
 * supporting 3 official modes:
 * - "black": Deep OLED Black background with +30% Centered Target (754px)
 * - "photo": Custom Archer Photo background with +20% Left-Aligned Target (547px) & Smoked Glass
 * - "transparent": 100% Alpha Transparent PNG with +20% Left-Aligned Target (547px) & Smoked Glass
 */
export async function renderTargetShotChartCanvas(params: TargetShotChartParams): Promise<HTMLCanvasElement> {
  const resolvedLang = resolveCardLang(params.lang);
  const resolvedUnitSystem = resolveCardUnitSystem(params.unitSystem);
  const {
    impacts: rawImpacts,
    ends = [],
    presetType = "WA_10_122",
    score,
    maxScore,
    tensCount,
    xsCount,
    distanceM,
    bowType,
    format = "World Archery",
    archerName,
    dateStr = formatRegionalDate(new Date(), resolvedLang),
    dispersion: initialDispersion,
    themeMode = "black",
    backgroundPhotoUrl = null
  } = params;

  const isVolOnly = isVolumeTelemetryParams(params);
  const impacts = isVolOnly ? [] : synthesizeImpactsFromEnds(rawImpacts, ends, presetType);
  const dispersion = isVolOnly
    ? null
    : initialDispersion ||
      (impacts.length > 0
        ? calculateDispersionAnalysis(impacts, distanceM, bowType, presetType, format, undefined, resolvedLang)
        : null);

  // Vertical 9:16 layout dimensions (scaled 2x for Ultra-HD 2160x3840 output)
  const logicalWidth = 1080;
  const logicalHeight = 1920;
  const hdScale = 2;

  const canvas = document.createElement("canvas");
  canvas.width = logicalWidth * hdScale;
  canvas.height = logicalHeight * hdScale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  ctx.scale(hdScale, hdScale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (typeof document !== "undefined" && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {}
  }

  const appFont = "Outfit, Inter, system-ui, -apple-system, sans-serif";

  const totalArrowsCount = resolveTelemetryArrowsCount(params);
  const effectiveMaxScore = isVolOnly ? 0 : totalArrowsCount > 0 ? totalArrowsCount * 10 : maxScore;

  const isPhotoMode = themeMode === "photo";
  const isBlackMode = !isPhotoMode;
  const isTransparentMode = false;

  // 1. Background Layer based on selected themeMode
  if (isBlackMode) {
    const bgGrad = ctx.createRadialGradient(540, 845, 90, 540, 960, 1120);
    bgGrad.addColorStop(0, "#101827");
    bgGrad.addColorStop(0.52, "#070B12");
    bgGrad.addColorStop(1, "#020305");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // Subtle ambient halo behind the center target
    const haloGrad = ctx.createRadialGradient(540, 771, 90, 540, 771, 430);
    haloGrad.addColorStop(0, "rgba(0, 229, 255, 0.09)");
    haloGrad.addColorStop(0.55, "rgba(255, 242, 0, 0.03)");
    haloGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  } else if (isPhotoMode) {
    const bgImg = backgroundPhotoUrl ? await loadImageAsset(backgroundPhotoUrl) : null;
    if (bgImg && bgImg.width > 0 && bgImg.height > 0) {
      const scale = Math.max(logicalWidth / bgImg.width, logicalHeight / bgImg.height);
      const sw = bgImg.width * scale;
      const sh = bgImg.height * scale;
      const sx = (logicalWidth - sw) / 2;
      const sy = (logicalHeight - sh) / 2;
      ctx.drawImage(bgImg, sx, sy, sw, sh);
    } else {
      // Fallback dark slate if user hasn't picked a photo yet
      const fallbackGrad = ctx.createLinearGradient(0, 0, 0, logicalHeight);
      fallbackGrad.addColorStop(0, "#0F172A");
      fallbackGrad.addColorStop(0.5, "#090D16");
      fallbackGrad.addColorStop(1, "#04060A");
      ctx.fillStyle = fallbackGrad;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    // Cinematic vignette for crisp legibility over any photo
    const vigGrad = ctx.createLinearGradient(0, 0, 0, logicalHeight);
    vigGrad.addColorStop(0, "rgba(4, 7, 12, 0.62)");
    vigGrad.addColorStop(0.22, "rgba(4, 7, 12, 0.12)");
    vigGrad.addColorStop(0.58, "rgba(4, 7, 12, 0.10)");
    vigGrad.addColorStop(0.78, "rgba(4, 7, 12, 0.48)");
    vigGrad.addColorStop(1, "rgba(4, 7, 12, 0.78)");
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  } else if (isTransparentMode) {
    // 100% Pure Alpha Channel Transparency
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  }

  // Outer Frame Border (x=24, y=36, w=1032, h=1848, r=38)
  ctx.strokeStyle = isBlackMode ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, 24, 36, logicalWidth - 48, logicalHeight - 72, 38);
  ctx.stroke();

  // Top Accent Line (Cyan -> Red -> Yellow 101010 DNA)
  const topLineGrad = ctx.createLinearGradient(140, 36, 940, 36);
  topLineGrad.addColorStop(0, "rgba(0, 168, 243, 0)");
  topLineGrad.addColorStop(0.25, "#00A8F3");
  topLineGrad.addColorStop(0.5, "#FF0000");
  topLineGrad.addColorStop(0.75, "#FFF200");
  topLineGrad.addColorStop(1, "rgba(255, 242, 0, 0)");
  ctx.strokeStyle = topLineGrad;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(140, 36.5);
  ctx.lineTo(940, 36.5);
  ctx.stroke();

  const boxFillStyle = isBlackMode
    ? "rgba(255, 255, 255, 0.04)"
    : isPhotoMode
      ? "rgba(6, 10, 16, 0.46)"
      : "rgba(8, 12, 20, 0.56)";
  const boxStrokeStyle = isBlackMode
    ? "rgba(255, 255, 255, 0.12)"
    : "rgba(255, 255, 255, 0.24)";

  // 2. Top Header Row
  // OFFICIAL TELEMETRY Badge (+10% over v2.151: 32.1px inside 490x72 pill)
  ctx.fillStyle = isBlackMode ? "rgba(255, 255, 255, 0.05)" : boxFillStyle;
  ctx.strokeStyle = isBlackMode ? "rgba(255, 255, 255, 0.20)" : "rgba(255, 255, 255, 0.26)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 54, 74, 490, 72, 36);
  ctx.fill();
  ctx.stroke();

  const badgeText =
    OFFICIAL_BADGE_BY_LANG[resolvedLang] ||
    (resolvedLang.toLowerCase().startsWith("es") ? "TELEMETRÍA OFICIAL" : "OFFICIAL TELEMETRY");
  ctx.font = `800 32.1px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, 54 + 490 / 2, 74 + 72 / 2 + 1, 456);

  // Archer Name (+10%: 53.1px) & Subtitle (+10%: 28.5px)
  ctx.save();
  if (!isBlackMode) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.88)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
  }
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 53.1px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.fillText(archerName || tCard(resolvedLang, "roleAthlete"), 54, 208, 616);

  const displayBowType =
    bowType === "Recurve"
      ? tCard(resolvedLang, "bowRecurve")
      : bowType === "Compound"
      ? tCard(resolvedLang, "bowCompound")
      : bowType === "Barebow"
      ? tCard(resolvedLang, "bowBarebow")
      : bowType || tCard(resolvedLang, "bowRecurve");
  const displayShootDist =
    params.distanceLabel || formatShootingDistance(distanceM, resolvedUnitSystem);
  const volumeBadgeTitle =
    VOLUME_BOX_TITLE_BY_LANG[resolvedLang] ||
    (resolvedLang.toLowerCase().startsWith("es") ? "VOLUMEN" : "VOLUME");
  const displayFormat = isVolOnly
    ? volumeBadgeTitle
    : format === "Libre" && !resolvedLang.toLowerCase().startsWith("es")
    ? "Custom"
    : format;
  ctx.font = `700 28.5px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${displayBowType} • ${displayShootDist} • ${displayFormat} • ${dateStr}`, 54, 250, 618);
  ctx.restore();

  // SCORE / VOLUME Box (340x180, r=32, x=686, y=74; big number kept at exact 69px, labels +15%)
  ctx.fillStyle = boxFillStyle;
  ctx.strokeStyle = isVolOnly
    ? isBlackMode
      ? "rgba(0, 168, 243, 0.58)"
      : "rgba(0, 168, 243, 0.72)"
    : isBlackMode
    ? "rgba(253, 216, 53, 0.55)"
    : "rgba(253, 216, 53, 0.68)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 686, 74, 340, 180, 32);
  ctx.fill();
  ctx.stroke();

  const scoreBoxCenterX = 686 + 340 / 2; // 856
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 23.8px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.fillText(
    isVolOnly ? volumeBadgeTitle : tCard(resolvedLang, "cardScore").toUpperCase(),
    scoreBoxCenterX,
    114,
    312
  );

  // Score / Volume main number remains untouched at 69px
  ctx.font = `900 69px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(isVolOnly ? `${totalArrowsCount}` : `${score}`, scoreBoxCenterX, 186);

  const pct = !isVolOnly && effectiveMaxScore > 0 ? Math.round((score / effectiveMaxScore) * 100) : 0;
  ctx.font = `700 21.3px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(
    isVolOnly
      ? `${tCard(resolvedLang, "cardArrows").toUpperCase()} • ${displayShootDist}`
      : `/ ${effectiveMaxScore} (${pct}%) • ${totalArrowsCount} ${tCard(resolvedLang, "cardArrows").toUpperCase()}`,
    scoreBoxCenterX,
    228,
    316
  );

  // 3. Centerpiece: Mechanical 3D Chrome Tally Counter for Volume sessions, or WA Target Face for Scored sessions
  // Design 1 (Black): centered centerpiece -> target diameter 754px (radius 377px), center (540, 771)
  // Design 2 (Photo/Transparent): left-aligned centerpiece -> target diameter 547px (radius 273.5px), center (339.5, 722.5)
  const targetDiameter = isBlackMode ? 754 : 547;
  const targetRadius = targetDiameter / 2;
  const targetCenterX = isBlackMode ? 540 : 66 + targetRadius; // 540 or 339.5
  const targetCenterY = isBlackMode ? 771 : 722.5;
  const targetScaleFactor = targetRadius / 228; // Relative to original 228px radius

  if (isVolOnly) {
    // Exact 3D Chrome Mechanical Hand Tally Clicker from phone Volume session (ScoringView.tsx)
    const caseRadius = isBlackMode ? 330 : 266;
    const caseCenterX = isBlackMode ? 540 : 334;
    const caseCenterY = isBlackMode ? 792 : 748;
    const s = caseRadius / 266; // 1.0 in Photo/Transparent (532px dia), ~1.24 in Black OLED (660px dia)

    ctx.save();
    ctx.globalAlpha = isTransparentMode ? 0.98 : 1.0;

    // 3a. Top Metal Hanger Loop (behind upper rim of chrome case)
    const loopOuterW = 128 * s;
    const loopOuterH = 88 * s;
    const loopX = caseCenterX - loopOuterW / 2;
    const loopY = caseCenterY - caseRadius - 68 * s;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
    ctx.shadowBlur = 16 * s;
    ctx.shadowOffsetY = 4 * s;
    const loopGrad = ctx.createLinearGradient(loopX, loopY, loopX + loopOuterW, loopY + loopOuterH);
    loopGrad.addColorStop(0, "#e4e4e7");
    loopGrad.addColorStop(0.5, "#a1a1aa");
    loopGrad.addColorStop(1, "#52525b");
    ctx.fillStyle = loopGrad;
    drawRoundedRect(ctx, loopX, loopY, loopOuterW, loopOuterH + 24 * s, loopOuterW / 2);
    ctx.fill();
    ctx.restore();

    // Inner cutout of hanger loop
    const loopBorder = 12 * s;
    const innerLoopW = loopOuterW - loopBorder * 2;
    const innerLoopH = loopOuterH - loopBorder;
    ctx.save();
    ctx.fillStyle = isBlackMode ? "#090C12" : "rgba(12, 12, 16, 0.72)";
    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = 3 * s;
    drawRoundedRect(
      ctx,
      caseCenterX - innerLoopW / 2,
      loopY + loopBorder,
      innerLoopW,
      innerLoopH + 20 * s,
      innerLoopW / 2
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3b. Upper-Right Reset Knob ("R") + Stem
    const knobAngle = -0.34; // ~ -19.5 degrees (upper-right side)
    const stemStartX = caseCenterX + Math.cos(knobAngle) * (caseRadius - 6 * s);
    const knobCenterY = caseCenterY + Math.sin(knobAngle) * (caseRadius * 0.62);
    const stemW = 28 * s;
    const stemH = 42 * s;
    const stemX = caseCenterX + caseRadius - 10 * s;
    const stemY = knobCenterY - stemH / 2;

    const stemGrad = ctx.createLinearGradient(stemX, stemY, stemX, stemY + stemH);
    stemGrad.addColorStop(0, "#d4d4d8");
    stemGrad.addColorStop(0.5, "#71717a");
    stemGrad.addColorStop(1, "#3f3f46");
    ctx.fillStyle = stemGrad;
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 2 * s;
    drawRoundedRect(ctx, Math.min(stemStartX, stemX), stemY, stemW, stemH, 6 * s);
    ctx.fill();
    ctx.stroke();

    const knobR = 34 * s;
    const knobX = stemX + stemW + knobR - 6 * s;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 16 * s;
    ctx.shadowOffsetY = 6 * s;
    const knobGrad = ctx.createRadialGradient(
      knobX - knobR * 0.3,
      knobCenterY - knobR * 0.3,
      knobR * 0.08,
      knobX,
      knobCenterY,
      knobR
    );
    knobGrad.addColorStop(0, "#ffffff");
    knobGrad.addColorStop(0.45, "#d4d4d8");
    knobGrad.addColorStop(1, "#71717a");
    ctx.beginPath();
    ctx.arc(knobX, knobCenterY, knobR, 0, Math.PI * 2);
    ctx.fillStyle = knobGrad;
    ctx.fill();
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 3.5 * s;
    ctx.stroke();
    ctx.restore();

    // Dark center cap with solid white "R"
    const capR = 16 * s;
    ctx.beginPath();
    ctx.arc(knobX, knobCenterY, capR, 0, Math.PI * 2);
    ctx.fillStyle = "#27272a";
    ctx.fill();
    ctx.strokeStyle = "#71717a";
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    ctx.font = `800 ${Math.round(18 * s)}px ${appFont}`;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("R", knobX, knobCenterY + 1 * s);

    // 3c. Main Circular 3D Chrome Case
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.88)";
    ctx.shadowBlur = 48 * s;
    ctx.shadowOffsetY = 18 * s;
    ctx.beginPath();
    ctx.arc(caseCenterX, caseCenterY, caseRadius, 0, Math.PI * 2);
    const caseGrad = ctx.createRadialGradient(
      caseCenterX - caseRadius * 0.3,
      caseCenterY - caseRadius * 0.44,
      caseRadius * 0.06,
      caseCenterX,
      caseCenterY,
      caseRadius
    );
    caseGrad.addColorStop(0, "#fafafa");
    caseGrad.addColorStop(0.28, "#e4e4e7");
    caseGrad.addColorStop(0.68, "#a1a1aa");
    caseGrad.addColorStop(1, "#52525b");
    ctx.fillStyle = caseGrad;
    ctx.fill();
    ctx.restore();

    // Thick brushed chrome outer bevel
    ctx.beginPath();
    ctx.arc(caseCenterX, caseCenterY, caseRadius - 9 * s, 0, Math.PI * 2);
    ctx.strokeStyle = "#d4d4d8";
    ctx.lineWidth = 18 * s;
    ctx.stroke();

    // Subtle outer hairline & inner specular highlight
    ctx.beginPath();
    ctx.arc(caseCenterX, caseCenterY, caseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    const glossR = caseRadius - 20 * s;
    const glossGrad = ctx.createLinearGradient(
      caseCenterX - glossR,
      caseCenterY - glossR,
      caseCenterX + glossR * 0.5,
      caseCenterY + glossR * 0.5
    );
    glossGrad.addColorStop(0, "rgba(255, 255, 255, 0.46)");
    glossGrad.addColorStop(0.45, "rgba(255, 255, 255, 0.08)");
    glossGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.beginPath();
    ctx.arc(caseCenterX, caseCenterY, glossR, 0, Math.PI * 2);
    ctx.fillStyle = glossGrad;
    ctx.fill();

    // 3d. Top Center Chrome Clicker Lever
    const leverW = 212 * s;
    const leverH = 44 * s;
    const leverX = caseCenterX - leverW / 2;
    const leverY = caseCenterY - caseRadius + 28 * s;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 6 * s;
    const leverGrad = ctx.createLinearGradient(leverX, leverY, leverX, leverY + leverH);
    leverGrad.addColorStop(0, "#ffffff");
    leverGrad.addColorStop(0.5, "#d4d4d8");
    leverGrad.addColorStop(1, "#71717a");
    ctx.fillStyle = leverGrad;
    drawRoundedRect(ctx, leverX, leverY, leverW, leverH, 10 * s);
    ctx.fill();
    ctx.strokeStyle = "#a1a1aa";
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.restore();

    // 3e. Recessed Dark Display Window + Roller Drums
    const digitsStr = String(Math.max(0, Math.round(totalArrowsCount))).padStart(4, "0");
    const digitsArr = digitsStr.split("");
    const numDrums = digitsArr.length;
    const winW = 386 * s;
    const winH = 192 * s;
    const winX = caseCenterX - winW / 2;
    const winY = caseCenterY - winH / 2 + 12 * s;

    // White bottom bevel highlight under window
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    drawRoundedRect(ctx, winX - 2 * s, winY + 3 * s, winW + 4 * s, winH + 2 * s, 32 * s);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#09090b";
    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 8 * s;
    drawRoundedRect(ctx, winX, winY, winW, winH, 30 * s);
    ctx.fill();
    ctx.stroke();

    // Subtle top inner glass reflection
    const winGlassGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH * 0.55);
    winGlassGrad.addColorStop(0, "rgba(255, 255, 255, 0.08)");
    winGlassGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = winGlassGrad;
    drawRoundedRect(ctx, winX + 4 * s, winY + 4 * s, winW - 8 * s, winH * 0.5, 26 * s);
    ctx.fill();

    const arrowsShotLabel =
      ARROWS_SHOT_TITLE_BY_LANG[resolvedLang] ||
      (resolvedLang.toLowerCase().startsWith("es") ? "FLECHAS LANZADAS" : "ARROWS SHOT");
    ctx.font = `900 ${Math.round(20 * s)}px ${appFont}`;
    ctx.fillStyle = "#00BFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(arrowsShotLabel, caseCenterX, winY + 40 * s, winW - 36 * s);

    // Roller Digits Board
    const drumGap = 12 * s;
    const totalInnerPad = 40 * s;
    const drumW = Math.min(70 * s, (winW - totalInnerPad - drumGap * (numDrums - 1)) / numDrums);
    const drumH = 102 * s;
    const drumsTotalW = drumW * numDrums + drumGap * (numDrums - 1);
    const drumsStartX = caseCenterX - drumsTotalW / 2;
    const drumY = winY + 58 * s;

    digitsArr.forEach((digit, idx) => {
      const dx = drumsStartX + idx * (drumW + drumGap);
      const drumGrad = ctx.createLinearGradient(dx, drumY, dx, drumY + drumH);
      drumGrad.addColorStop(0, "#18181b");
      drumGrad.addColorStop(0.5, "#09090b");
      drumGrad.addColorStop(1, "#18181b");
      ctx.fillStyle = drumGrad;
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 2 * s;
      drawRoundedRect(ctx, dx, drumY, drumW, drumH, 10 * s);
      ctx.fill();
      ctx.stroke();

      // Horizontal roller seam line
      ctx.strokeStyle = "rgba(63, 63, 70, 0.55)";
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(dx + 2 * s, drumY + drumH / 2);
      ctx.lineTo(dx + drumW - 2 * s, drumY + drumH / 2);
      ctx.stroke();

      // Solid white numeral
      ctx.font = `900 ${Math.round(62 * s)}px ${appFont}`;
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(digit, dx + drumW / 2, drumY + drumH / 2 + 2 * s);
    });

    // 3f. Engraved Bottom Callout on Chrome Case ("VOLUMEN · 70 M")
    const engravedText = `${volumeBadgeTitle} · ${displayShootDist.toUpperCase()}`;
    const engravedY = winY + winH + 46 * s;
    ctx.font = `900 ${Math.round(24 * s)}px ${appFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255, 255, 255, 0.68)";
    ctx.fillText(engravedText, caseCenterX, engravedY + 2 * s, caseRadius * 1.45);
    ctx.fillStyle = "#18181b";
    ctx.fillText(engravedText, caseCenterX, engravedY, caseRadius * 1.45);

    ctx.restore();
    ctx.textBaseline = "alphabetic";
  } else {
    // Target shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.88)";
    ctx.shadowBlur = 42;
    ctx.beginPath();
    ctx.arc(targetCenterX, targetCenterY, targetRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fill();
    ctx.restore();

    // Concentric WA rings
    ctx.save();
    ctx.globalAlpha = isPhotoMode ? 0.90 : isTransparentMode ? 0.96 : 1.0;
    const rings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
    rings.forEach((ring) => {
      const currentR = (ring.r / 48) * targetRadius;
      ctx.beginPath();
      ctx.arc(targetCenterX, targetCenterY, currentR, 0, Math.PI * 2);
      ctx.fillStyle = ring.fill;
      ctx.fill();
      ctx.strokeStyle = ring.stroke;
      ctx.lineWidth = (ring.v === "X" ? 1.5 : 2) * targetScaleFactor;
      ctx.stroke();
    });
    ctx.restore();

    // Center spider (+)
    const spiderHalf = 10 * targetScaleFactor;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
    ctx.lineWidth = 1.5 * targetScaleFactor;
    ctx.beginPath();
    ctx.moveTo(targetCenterX - spiderHalf, targetCenterY);
    ctx.lineTo(targetCenterX + spiderHalf, targetCenterY);
    ctx.moveTo(targetCenterX, targetCenterY - spiderHalf);
    ctx.lineTo(targetCenterX, targetCenterY + spiderHalf);
    ctx.stroke();

    // 4. Plotted Arrow Impacts on Target
    const outerHoleR = 11 * targetScaleFactor;
    const innerArrowR = 9.5 * targetScaleFactor;
    const arrowFontPx = Math.round(10 * targetScaleFactor * 10) / 10;

    impacts.forEach((imp, idx) => {
      const ix = targetCenterX + ((imp.x - 50) / 48) * targetRadius;
      const iy = targetCenterY + ((imp.y - 50) / 48) * targetRadius;

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 7 * targetScaleFactor;
      ctx.beginPath();
      ctx.arc(ix, iy, outerHoleR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(ix, iy, innerArrowR, 0, Math.PI * 2);
      ctx.fillStyle = "#FFD700";
      ctx.fill();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.8 * targetScaleFactor;
      ctx.stroke();

      ctx.font = `900 ${arrowFontPx}px ${appFont}`;
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(imp.value || String(idx + 1), ix, iy + 0.5);
    });

    ctx.textBaseline = "alphabetic";
  }

  // 5. Official Brand Lockup ("ARCHERY 101010" + centered below "THE APP")
  // Shifts cleanly from y=1343 (without heart rate) to y=1290 (with heart rate) so there are zero empty gaps
  const safeAvgBpm =
    typeof params.avgHeartRateBpm === "number" &&
    params.avgHeartRateBpm >= 30 &&
    params.avgHeartRateBpm <= 250
      ? Math.round(params.avgHeartRateBpm)
      : 0;
  const safeMaxBpm =
    typeof params.maxHeartRateBpm === "number" &&
    params.maxHeartRateBpm >= safeAvgBpm &&
    params.maxHeartRateBpm <= 250
      ? Math.round(params.maxHeartRateBpm)
      : 0;
  const hasHeartRate = safeAvgBpm > 0;

  const [brandFullImg, wmImg] = await Promise.all([
    loadImageAsset("/images/brand_logo_full.png?v=281"),
    loadImageAsset("/images/101010-the-app-watermark.png?v=281")
  ]);

  const brandTopY = hasHeartRate ? 1290 : 1343;
  if (brandFullImg) {
    ctx.save();
    if (!isBlackMode) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.92)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 4;
    }
    const brandW = 780;
    const brandH = Math.round((brandFullImg.height / brandFullImg.width) * brandW); // ~57px
    ctx.drawImage(brandFullImg, Math.round(540 - brandW / 2), brandTopY, brandW, brandH);

    if (wmImg) {
      // Crop exact "THE APP" from 101010-the-app-watermark.png (sx=240, sy=440, sw=1120, sh=210)
      const subW = 460;
      const subH = Math.round((210 / 1120) * subW); // ~86px
      ctx.drawImage(
        wmImg,
        240,
        440,
        1120,
        210,
        Math.round(540 - subW / 2),
        brandTopY + brandH + 18,
        subW,
        subH
      );
    } else {
      ctx.font = "900 32px 'Good Times', 'Outfit', sans-serif";
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.letterSpacing = "8px";
      ctx.fillText("THE APP", 540, brandTopY + brandH + 62);
    }
    ctx.restore();
  } else {
    drawFallbackArchery101010TheApp(ctx, 540, brandTopY);
  }

  // 5b. Adaptive PULSACIONES Bar (ONLY drawn when real watch heart rate exists; zero empty boxes otherwise)
  if (hasHeartRate) {
    const hrX = 54;
    const hrY = 1530;
    const hrW = 972;
    const hrH = 124;

    ctx.fillStyle = boxFillStyle;
    ctx.strokeStyle = boxStrokeStyle;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, hrX, hrY, hrW, hrH, 24);
    ctx.fill();
    ctx.stroke();

    // Matte glass icon container + pure white ECG waveform polyline (zero red, zero grey)
    const iconBoxSize = 62;
    const iconBoxX = hrX + 32;
    const iconBoxY = hrY + (hrH - iconBoxSize) / 2;
    ctx.fillStyle = isBlackMode ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.08)";
    ctx.strokeStyle = isBlackMode ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.24)";
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, iconBoxX, iconBoxY, iconBoxSize, iconBoxSize, 16);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 3.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const icx = iconBoxX + iconBoxSize / 2;
    const icy = iconBoxY + iconBoxSize / 2;
    ctx.beginPath();
    ctx.moveTo(icx - 17, icy);
    ctx.lineTo(icx - 9, icy);
    ctx.lineTo(icx - 4, icy - 14);
    ctx.lineTo(icx + 4, icy + 14);
    ctx.lineTo(icx + 9, icy);
    ctx.lineTo(icx + 17, icy);
    ctx.stroke();
    ctx.restore();

    const hrLabel =
      HEART_RATE_LABEL_BY_LANG[resolvedLang] ||
      (resolvedLang.toLowerCase().startsWith("es") ? "PULSACIONES" : "HEART RATE");
    const maxShort =
      MAX_SHORT_LABEL_BY_LANG[resolvedLang] ||
      (resolvedLang.toLowerCase().startsWith("es") ? "MÁX" : "MAX");
    const hrValueStr =
      safeMaxBpm > safeAvgBpm
        ? `${safeAvgBpm} BPM • ${maxShort} ${safeMaxBpm}`
        : `${safeAvgBpm} BPM`;

    ctx.save();
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.font = `800 30.4px ${appFont}`;
    ctx.fillText(hrLabel, iconBoxX + iconBoxSize + 24, hrY + hrH / 2 + 1, 410);

    ctx.textAlign = "right";
    ctx.font = `900 38.0px ${appFont}`;
    ctx.fillText(hrValueStr, hrX + hrW - 36, hrY + hrH / 2 + 1, 455);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  // 6. Bottom 4 Harmonious & Centered KPI Stat Boxes
  const avgArrow = !isVolOnly && totalArrowsCount > 0 ? (score / totalArrowsCount).toFixed(2) : "0.00";
  const computedDistanceM =
    typeof params.distanceWalkedM === "number" && params.distanceWalkedM >= 0
      ? Math.round(params.distanceWalkedM)
      : 0;
  const computedKcal =
    typeof params.activeKcal === "number" && params.activeKcal > 0
      ? Math.round(params.activeKcal)
      : calculateActiveKcal({
          arrowsCount: totalArrowsCount,
          distanceWalkedM: computedDistanceM,
          bowPoundageLbs: params.bowPoundageLbs || 36
        });

  const cardY = 1690;
  const cardHeight = 154;
  const boxGap = 16;
  const boxW = 231; // 4 * 231 + 3 * 16 = 972px (54..1026)

  const nonEmptyEndsCount = ends.filter((e) => (e.arrows || []).some((a) => a !== "")).length;
  const perEnd = Math.max(1, Number(params.arrowsPerEnd) || 6);
  const volumeEndsCount =
    nonEmptyEndsCount > 0
      ? nonEmptyEndsCount
      : totalArrowsCount > 0
      ? Math.max(1, Math.ceil(totalArrowsCount / perEnd))
      : 0;
  const endsTitle =
    ENDS_BOX_TITLE_BY_LANG[resolvedLang] ||
    (resolvedLang.toLowerCase().startsWith("es") ? "TANDAS" : "ENDS");
  const shootDistTitle =
    SHOOT_DIST_TITLE_BY_LANG[resolvedLang] ||
    (resolvedLang.toLowerCase().startsWith("es") ? "DISTANCIA" : "DISTANCE");

  const hasGrouping = !isVolOnly && Boolean(dispersion && dispersion.spreadCm > 0);
  const kpiItems = isVolOnly
    ? [
        {
          title: endsTitle,
          main: `${volumeEndsCount}`
        },
        {
          title: shootDistTitle,
          main: displayShootDist
        },
        {
          title: tCard(resolvedLang, "cardCalories").toUpperCase(),
          main: `${computedKcal} kcal`
        },
        {
          title: tCard(resolvedLang, "cardWalked").toUpperCase(),
          main: formatWalkedDistanceRegional(computedDistanceM, resolvedUnitSystem)
        }
      ]
    : [
        {
          title: tCard(resolvedLang, "cardAverage").toUpperCase(),
          main: `${avgArrow} pts`
        },
        {
          title: hasGrouping
            ? tCard(resolvedLang, "cardGrouping").toUpperCase()
            : tCard(resolvedLang, "precisionLabel").toUpperCase(),
          main: hasGrouping ? `Ø ${dispersion!.spreadCm.toFixed(1)} cm` : `${tensCount} 10s • ${xsCount} Xs`
        },
        {
          title: tCard(resolvedLang, "cardCalories").toUpperCase(),
          main: `${computedKcal} kcal`
        },
        {
          title: tCard(resolvedLang, "cardWalked").toUpperCase(),
          main: formatWalkedDistanceRegional(computedDistanceM, resolvedUnitSystem)
        }
      ];

  kpiItems.forEach((item, idx) => {
    const bx = 54 + (boxW + boxGap) * idx;
    drawCenteredStatBox(
      ctx,
      bx,
      cardY,
      boxW,
      cardHeight,
      item.title,
      item.main,
      boxFillStyle,
      boxStrokeStyle
    );
  });

  return canvas;
}

function drawCenteredStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  main: string,
  fillStyle: string,
  strokeStyle: string
) {
  const appFont = "Outfit, Inter, system-ui, -apple-system, sans-serif";
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.stroke();

  const centerX = x + w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Header (+10% over v2.151 -> 24.8px)
  ctx.font = `800 24.8px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(title, centerX, y + 56, w - 14);

  // Value (+10% over v2.151 -> 34.9px)
  ctx.font = `900 34.9px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(main, centerX, y + 114, w - 14);
}

/**
 * Renders Ultra-HD Shot Chart on Canvas and returns lossless PNG Blob
 */
export async function generateTargetShotChartBlob(params: TargetShotChartParams): Promise<Blob> {
  const canvas = await renderTargetShotChartCanvas(params);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/png",
      1.0
    );
  });
}

export interface ShareTargetResult {
  sharedNatively: boolean;
  dataUrl: string;
  fileName: string;
  captionText: string;
  params: TargetShotChartParams;
}

/**
 * Triggers Native Android Image Share (in APK) or Web Share API (in mobile browsers),
 * with download fallback.
 */
export async function triggerNativeImageShare(
  dataUrl: string,
  fileName: string,
  title: string,
  captionText: string
): Promise<boolean> {
  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareImage) {
    try {
      window.ArcheryNativeShare.shareImage(dataUrl, fileName, title, captionText);
      return true;
    } catch (err) {
      console.error("Native shareImage bridge error:", err);
    }
  }

  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (blob && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title,
          text: captionText
        });
        return true;
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return true;
    }
  }

  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return false;
}

/**
 * Generates the initial "ARCHERY 101010 THE APP" vertical telemetry image and
 * returns the ShareTargetResult so the preview modal opens with the 3 theme options:
 * - Fondo Negro
 * - Tu Foto Detrás
 * - Fondo Transparente
 */
export async function shareTargetShotChart(params: TargetShotChartParams): Promise<ShareTargetResult> {
  const resolvedLang = resolveCardLang(params.lang);
  const resolvedUnitSystem = resolveCardUnitSystem(params.unitSystem);
  const isSpanish = resolvedLang.toLowerCase().startsWith("es");
  const displayShootDist =
    params.distanceLabel || formatShootingDistance(params.distanceM, resolvedUnitSystem);

  const initialParams: TargetShotChartParams = {
    ...params,
    lang: resolvedLang,
    unitSystem: resolvedUnitSystem,
    distanceLabel: displayShootDist,
    dateStr: params.dateStr || formatRegionalDate(new Date(), resolvedLang),
    themeMode: params.themeMode || "black"
  };
  const canvas = await renderTargetShotChartCanvas(initialParams);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `Archery101010-Telemetry-${Date.now()}.png`;
  const isVolOnly = isVolumeTelemetryParams(params);
  const totalArrows = resolveTelemetryArrowsCount(params);
  const effectiveMax = isVolOnly ? 0 : totalArrows > 0 ? totalArrows * 10 : params.maxScore;

  const archerFallback = tCard(resolvedLang, "roleAthlete");
  const capAvgBpm =
    typeof params.avgHeartRateBpm === "number" &&
    params.avgHeartRateBpm >= 30 &&
    params.avgHeartRateBpm <= 250
      ? Math.round(params.avgHeartRateBpm)
      : 0;
  const capMaxBpm =
    typeof params.maxHeartRateBpm === "number" &&
    params.maxHeartRateBpm >= capAvgBpm &&
    params.maxHeartRateBpm <= 250
      ? Math.round(params.maxHeartRateBpm)
      : 0;
  const hrCaptionLineEs =
    capAvgBpm > 0
      ? `\n• *Pulsaciones:* ${capAvgBpm} BPM${capMaxBpm > capAvgBpm ? ` · Máx ${capMaxBpm}` : ""}`
      : "";
  const hrCaptionLineEn =
    capAvgBpm > 0
      ? `\n• *${HEART_RATE_LABEL_BY_LANG[resolvedLang] || "Heart Rate"}:* ${capAvgBpm} BPM${
          capMaxBpm > capAvgBpm ? ` · ${MAX_SHORT_LABEL_BY_LANG[resolvedLang] || "Max"} ${capMaxBpm}` : ""
        }`
      : "";

  const captionText = isVolOnly
    ? isSpanish
      ? `🎯 *ARCHERY 101010 THE APP*\n` +
        `• *Arquero:* ${params.archerName || "Arquero"}\n` +
        `• *Volumen:* ${totalArrows} flechas · ${displayShootDist}` +
        hrCaptionLineEs
      : `🎯 *ARCHERY 101010 THE APP*\n` +
        `• *${archerFallback}:* ${params.archerName || archerFallback}\n` +
        `• *${VOLUME_BOX_TITLE_BY_LANG[resolvedLang] || "Volume"}:* ${totalArrows} ${tCard(resolvedLang, "cardArrows").toLowerCase()} · ${displayShootDist}` +
        hrCaptionLineEn
    : isSpanish
    ? `🎯 *ARCHERY 101010 THE APP*\n` +
      `• *Arquero:* ${params.archerName || "Arquero"}\n` +
      `• *Puntaje:* ${params.score} / ${effectiveMax} pts\n` +
      `• *Precisión:* ${params.tensCount} 10s | ${params.xsCount} Xs · ${displayShootDist}` +
      hrCaptionLineEs
    : `🎯 *ARCHERY 101010 THE APP*\n` +
      `• *${archerFallback}:* ${params.archerName || archerFallback}\n` +
      `• *${tCard(resolvedLang, "cardScore")}:* ${params.score} / ${effectiveMax} pts\n` +
      `• *10s / Xs:* ${params.tensCount} 10s | ${params.xsCount} Xs · ${displayShootDist}` +
      hrCaptionLineEn;

  return {
    sharedNatively: false,
    dataUrl,
    fileName,
    captionText,
    params: initialParams
  };
}

/**
 * Formats the complete Scorecard (Planilla) WITHOUT any homepage URL and shares
 * the PNG telemetry card + scorecard text via universal native OS sharing
 * (KakaoTalk, LINE, iMessage, Telegram, Mail, etc.) with messaging fallback.
 */
export async function shareScorecardWhatsAppNative(params: TargetShotChartParams): Promise<ShareTargetResult> {
  const resolvedLang = resolveCardLang(params.lang);
  const resolvedUnitSystem = resolveCardUnitSystem(params.unitSystem);
  const isSpanish = resolvedLang.toLowerCase().startsWith("es");

  const {
    ends = [],
    score,
    maxScore,
    tensCount,
    xsCount,
    distanceM,
    bowType,
    format = "Libre",
    archerName,
    sessionNote
  } = params;

  const isVolOnly = isVolumeTelemetryParams(params);
  const totalArrows = resolveTelemetryArrowsCount(params);
  const effectiveMaxScore = isVolOnly ? 0 : totalArrows > 0 ? totalArrows * 10 : maxScore;
  const pct = !isVolOnly && effectiveMaxScore > 0 ? Math.round((score / effectiveMaxScore) * 100) : 0;
  const avgPerArrow = !isVolOnly && totalArrows > 0 ? (score / totalArrows).toFixed(2) : "0.00";
  const bowLabel =
    bowType === "Recurve"
      ? tCard(resolvedLang, "bowRecurve")
      : bowType === "Compound"
      ? tCard(resolvedLang, "bowCompound")
      : bowType === "Barebow"
      ? tCard(resolvedLang, "bowBarebow")
      : bowType || tCard(resolvedLang, "bowRecurve");
  const displayShootDist =
    params.distanceLabel || formatShootingDistance(distanceM, resolvedUnitSystem);
  const displayFormat = isVolOnly
    ? isSpanish
      ? "Volumen"
      : VOLUME_BOX_TITLE_BY_LANG[resolvedLang] || "Volume"
    : format === "Libre" && !isSpanish
    ? "Custom"
    : format;
  const walkedStr =
    typeof params.distanceWalkedM === "number" && params.distanceWalkedM > 0
      ? formatWalkedDistanceRegional(params.distanceWalkedM, resolvedUnitSystem)
      : "";
  const computedVolKcal =
    typeof params.activeKcal === "number" && params.activeKcal > 0
      ? Math.round(params.activeKcal)
      : calculateActiveKcal({
          arrowsCount: totalArrows,
          distanceWalkedM: Math.max(0, Math.round(params.distanceWalkedM || 0)),
          bowPoundageLbs: params.bowPoundageLbs || 36
        });
  const scAvgBpm =
    typeof params.avgHeartRateBpm === "number" &&
    params.avgHeartRateBpm >= 30 &&
    params.avgHeartRateBpm <= 250
      ? Math.round(params.avgHeartRateBpm)
      : 0;
  const scMaxBpm =
    typeof params.maxHeartRateBpm === "number" &&
    params.maxHeartRateBpm >= scAvgBpm &&
    params.maxHeartRateBpm <= 250
      ? Math.round(params.maxHeartRateBpm)
      : 0;
  const hrScorecardLineEs =
    scAvgBpm > 0
      ? `• *Pulsaciones:* ${scAvgBpm} BPM${scMaxBpm > scAvgBpm ? ` · Máx ${scMaxBpm}` : ""}\n`
      : "";
  const hrScorecardLineIntl =
    scAvgBpm > 0
      ? `• *${HEART_RATE_LABEL_BY_LANG[resolvedLang] || "Heart Rate"}:* ${scAvgBpm} BPM${
          scMaxBpm > scAvgBpm ? ` · ${MAX_SHORT_LABEL_BY_LANG[resolvedLang] || "Max"} ${scMaxBpm}` : ""
        }\n`
      : "";

  const endsDetail = isVolOnly
    ? ""
    : ends
        .map((e, idx) => {
          const valid = (e.arrows || []).filter((a) => a !== "");
          if (valid.length === 0) return null;
          const endSum = valid.reduce(
            (s, a) => s + (a === "X" || a === "10" ? 10 : a === "M" ? 0 : Number(a) || 0),
            0
          );
          return `• ${String(idx + 1).padStart(2, "0")}: ${valid.join(", ")}  →  *${endSum}* pts`;
        })
        .filter(Boolean)
        .join("\n");

  const archerFallback = tCard(resolvedLang, "roleAthlete");
  const message = isVolOnly
    ? isSpanish
      ? `*SESIÓN DE VOLUMEN · ARCHERY 101010 THE APP*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• *Arquero:* ${archerName || "Arquero"}\n` +
        `• *Arco:* ${bowLabel}\n` +
        `• *Modalidad:* Volumen · ${displayShootDist}\n` +
        `• *Volumen Total:* *${totalArrows}* flechas\n` +
        `• *Calorías:* ${computedVolKcal} kcal\n` +
        (walkedStr ? `• *Recorrido:* ${walkedStr}\n` : "") +
        hrScorecardLineEs +
        (sessionNote ? `\n*Notas:* ${sessionNote}\n` : "") +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *ARCHERY 101010 THE APP*`
      : `*OFFICIAL VOLUME LOG · ARCHERY 101010 THE APP*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• *${archerFallback}:* ${archerName || archerFallback}\n` +
        `• *${tCard(resolvedLang, "bowType")}:* ${bowLabel}\n` +
        `• *${tCard(resolvedLang, "sessionFormat")}:* ${displayFormat} · ${displayShootDist}\n` +
        `• *${VOLUME_BOX_TITLE_BY_LANG[resolvedLang] || "VOLUME"}:* *${totalArrows}* ${tCard(resolvedLang, "cardArrows").toLowerCase()}\n` +
        `• *${tCard(resolvedLang, "cardCalories")}:* ${computedVolKcal} kcal\n` +
        (walkedStr ? `• *${tCard(resolvedLang, "cardWalked")}:* ${walkedStr}\n` : "") +
        hrScorecardLineIntl +
        (sessionNote ? `\n*Notes:* ${sessionNote}\n` : "") +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *ARCHERY 101010 THE APP*`
    : isSpanish
    ? `*PLANILLA OFICIAL · ARCHERY 101010 THE APP*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• *Arquero:* ${archerName || "Arquero"}\n` +
      `• *Arco:* ${bowLabel}\n` +
      `• *Modalidad:* ${displayFormat} · ${displayShootDist}\n` +
      `• *Flechas Tiradas:* ${totalArrows}\n` +
      (walkedStr ? `• *Recorrido:* ${walkedStr}\n` : "") +
      hrScorecardLineEs +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*PUNTUACIÓN TOTAL:* *${score}* / ${effectiveMaxScore} pts (*${pct}%*)\n` +
      `• *10s:* ${tensCount} | *Xs:* ${xsCount}\n` +
      `• *Promedio:* ${avgPerArrow} pts\n` +
      (endsDetail ? `\n*Desglose de Tiradas:*\n${endsDetail}\n` : "") +
      (sessionNote ? `\n*Notas:* ${sessionNote}\n` : "") +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *ARCHERY 101010 THE APP*`
    : `*OFFICIAL SCORECARD · ARCHERY 101010 THE APP*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• *${archerFallback}:* ${archerName || archerFallback}\n` +
      `• *${tCard(resolvedLang, "bowType")}:* ${bowLabel}\n` +
      `• *${tCard(resolvedLang, "sessionFormat")}:* ${displayFormat} · ${displayShootDist}\n` +
      `• *${tCard(resolvedLang, "cardArrows")}:* ${totalArrows}\n` +
      (walkedStr ? `• *${tCard(resolvedLang, "cardWalked")}:* ${walkedStr}\n` : "") +
      hrScorecardLineIntl +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `*${tCard(resolvedLang, "cardScore")}:* *${score}* / ${effectiveMaxScore} pts (*${pct}%*)\n` +
      `• *10s:* ${tensCount} | *Xs:* ${xsCount}\n` +
      `• *${tCard(resolvedLang, "cardAverage")}:* ${avgPerArrow} pts\n` +
      (endsDetail ? `\n*Ends Breakdown:*\n${endsDetail}\n` : "") +
      (sessionNote ? `\n*Notes:* ${sessionNote}\n` : "") +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *ARCHERY 101010 THE APP*`;

  const enrichedParams: TargetShotChartParams = {
    ...params,
    lang: resolvedLang,
    unitSystem: resolvedUnitSystem,
    distanceLabel: displayShootDist,
    dateStr: params.dateStr || formatRegionalDate(new Date(), resolvedLang)
  };
  const canvas = await renderTargetShotChartCanvas(enrichedParams);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `Archery101010-Scorecard-${Date.now()}.png`;
  const shareTitle = `${archerName || archerFallback} • ARCHERY 101010 THE APP`;

  // 1. Universal Native Android Chooser (supports KakaoTalk, LINE, Messages, Telegram, etc.)
  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareImage) {
    try {
      window.ArcheryNativeShare.shareImage(dataUrl, fileName, shareTitle, message);
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params: enrichedParams };
    } catch (err) {
      console.error("Native shareImage error:", err);
    }
  }

  // 2. Universal Web Share API with PNG File + Scorecard Text
  try {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 0.95));
    if (blob && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: shareTitle,
          text: message
        });
        return { sharedNatively: true, dataUrl, fileName, captionText: message, params: enrichedParams };
      }
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({
        title: shareTitle,
        text: message
      });
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params: enrichedParams };
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params: enrichedParams };
    }
  }

  // 3. Fallback native bridge or protocol link
  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareWhatsAppImage) {
    try {
      window.ArcheryNativeShare.shareWhatsAppImage(dataUrl, fileName, message);
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params: enrichedParams };
    } catch (err) {
      console.error("Fallback shareWhatsAppImage error:", err);
    }
  }

  const encoded = encodeURIComponent(message);
  if (typeof window !== "undefined") {
    window.open(`https://wa.me/?text=${encoded}`, "_blank", "noopener,noreferrer");
  }
  return { sharedNatively: false, dataUrl, fileName, captionText: message, params: enrichedParams };
}
