"use client";

import { ShotImpactData, DispersionAnalysis, calculateDispersionAnalysis, getConvexHull, getExactTargetDimensions } from "./dispersionAnalytics";
import { DIANA_PRESETS } from "@/components/scoring/ScoringView";
import { calculateActiveKcal, formatKmAndMiles } from "./biometricsEngine";

export interface EndSummaryItem {
  arrows: string[];
  note?: string;
}

export type TelemetryCardThemeMode = "black" | "photo" | "transparent";

export interface TargetShotChartParams {
  impacts: ShotImpactData[];
  ends?: EndSummaryItem[];
  presetType?: string;
  score: number;
  maxScore: number;
  tensCount: number;
  xsCount: number;
  distanceM: number;
  bowType: string;
  format?: string;
  archerName: string;
  dateStr?: string;
  sessionNote?: string;
  dispersion?: DispersionAnalysis | null;
  activeKcal?: number;
  distanceWalkedM?: number;
  bowPoundageLbs?: number;
  themeMode?: TelemetryCardThemeMode;
  backgroundPhotoUrl?: string | null;
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
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 54px 'Good Times', 'Outfit', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("ARCHERY 101010", centerX, topY + 28);

  ctx.font = "900 32px 'Good Times', 'Outfit', sans-serif";
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
    dateStr = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }),
    dispersion: initialDispersion,
    themeMode = "black",
    backgroundPhotoUrl = null
  } = params;

  const impacts = synthesizeImpactsFromEnds(rawImpacts, ends, presetType);
  const dispersion =
    initialDispersion ||
    (impacts.length > 0
      ? calculateDispersionAnalysis(impacts, distanceM, bowType, presetType, format)
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

  const appFont = "Inter, Outfit, system-ui, -apple-system, sans-serif";

  const totalArrowsCount =
    ends.length > 0
      ? ends.reduce((sum, e) => sum + (e.arrows || []).filter((a) => a !== "").length, 0)
      : impacts.length;
  const effectiveMaxScore = totalArrowsCount > 0 ? totalArrowsCount * 10 : maxScore;

  const isBlackMode = themeMode === "black";
  const isPhotoMode = themeMode === "photo";
  const isTransparentMode = themeMode === "transparent";

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
  // TELEMETRÍA OFICIAL (+30% box & text: 411x62, r=31, font 25.4px)
  ctx.fillStyle = isBlackMode ? "rgba(255, 255, 255, 0.05)" : boxFillStyle;
  ctx.strokeStyle = isBlackMode ? "rgba(255, 255, 255, 0.20)" : "rgba(255, 255, 255, 0.26)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 54, 76, 411, 62, 31);
  ctx.fill();
  ctx.stroke();

  ctx.font = `800 25.4px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TELEMETRÍA OFICIAL", 54 + 411 / 2, 76 + 62 / 2 + 1);

  // Archer Name & Subtitle
  ctx.save();
  if (!isBlackMode) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.88)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
  }
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 42px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.fillText(archerName || "Arquero", 54, 198, 630);

  const displayBowType =
    bowType === "Recurve" ? "Recurvo" : bowType === "Compound" ? "Compuesto" : bowType || "Recurvo";
  ctx.font = `700 22.5px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${displayBowType} • ${distanceM}m • ${format} • ${dateStr}`, 54, 236, 630);
  ctx.restore();

  // PUNTUACIÓN TOTAL Box (+15% box & text: 315x168, r=32, x=711, y=76)
  ctx.fillStyle = boxFillStyle;
  ctx.strokeStyle = isBlackMode ? "rgba(253, 216, 53, 0.55)" : "rgba(253, 216, 53, 0.68)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 711, 76, 315, 168, 32);
  ctx.fill();
  ctx.stroke();

  const scoreBoxCenterX = 711 + 315 / 2; // 868.5
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 20.7px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.fillText("PUNTUACIÓN TOTAL", scoreBoxCenterX, 114);

  ctx.font = `900 69px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${score}`, scoreBoxCenterX, 182);

  const pct = effectiveMaxScore > 0 ? Math.round((score / effectiveMaxScore) * 100) : 0;
  ctx.font = `700 19.6px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`/ ${effectiveMaxScore} pts (${pct}%)`, scoreBoxCenterX, 218);

  // 3. Virtual Target Position & Size based on Design 1 (Black) vs Design 2 (Photo / Transparent)
  // Design 1 (Black): +30% centered target -> diameter 754px (radius 377px), center (540, 771)
  // Design 2 (Photo/Transparent): +20% left-aligned target -> diameter 547px (radius 273.5px), center (339.5, 722.5)
  const targetDiameter = isBlackMode ? 754 : 547;
  const targetRadius = targetDiameter / 2;
  const targetCenterX = isBlackMode ? 540 : 66 + targetRadius; // 540 or 339.5
  const targetCenterY = isBlackMode ? 771 : 722.5;
  const targetScaleFactor = targetRadius / 228; // Relative to original 228px radius

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

  // 5. Official Brand Lockup ("ARCHERY 101010" + centered below "THE APP") positioned at y=1343
  const [brandFullImg, wmImg] = await Promise.all([
    loadImageAsset("/images/brand_logo_full.png"),
    loadImageAsset("/images/101010-the-app-watermark.png")
  ]);

  const brandTopY = 1343;
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

  // 6. Bottom 4 Harmonious & Centered KPI Stat Boxes (PROMEDIO | PRECISIÓN | KCAL | DISTANCIA)
  const avgArrow = totalArrowsCount > 0 ? (score / totalArrowsCount).toFixed(2) : "0.00";
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

  const cardY = 1698;
  const cardHeight = 146;
  const boxGap = 16;
  const boxW = 231; // 4 * 231 + 3 * 16 = 972px (54..1026)

  const kpiItems = [
    { title: "PROMEDIO", main: `${avgArrow} PTS` },
    { title: "PRECISIÓN", main: `${tensCount} 10s • ${xsCount} Xs` },
    { title: "KCAL", main: `${computedKcal} kcal` },
    { title: "DISTANCIA", main: formatKmAndMiles(computedDistanceM, false) }
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
  const appFont = "Inter, Outfit, system-ui, -apple-system, sans-serif";
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.stroke();

  const centerX = x + w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Header (+25% and +20% -> 19.6px)
  ctx.font = `800 19.6px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(title, centerX, y + 56, w - 16);

  // Value (+20% -> 27.6px)
  ctx.font = `900 27.6px ${appFont}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(main, centerX, y + 104, w - 16);
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
  document.body.removeChild(a);
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
  const initialParams: TargetShotChartParams = {
    ...params,
    themeMode: params.themeMode || "black"
  };
  const canvas = await renderTargetShotChartCanvas(initialParams);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `Archery101010-Telemetria-${Date.now()}.png`;
  const totalArrows =
    params.ends && params.ends.length > 0
      ? params.ends.reduce((sum, e) => sum + (e.arrows || []).filter((a) => a !== "").length, 0)
      : params.impacts?.length || 0;
  const effectiveMax = totalArrows > 0 ? totalArrows * 10 : params.maxScore;
  const captionText =
    `🎯 *ARCHERY 101010 THE APP*\n` +
    `• *Arquero:* ${params.archerName || "Arquero"}\n` +
    `• *Puntaje:* ${params.score} / ${effectiveMax} pts\n` +
    `• *Precisión:* ${params.tensCount} 10s | ${params.xsCount} Xs · ${params.distanceM}m`;

  return {
    sharedNatively: false,
    dataUrl,
    fileName,
    captionText,
    params: initialParams
  };
}

/**
 * Formats the complete Scorecard (Planilla) WITHOUT any homepage URL so WhatsApp
 * never converts it into a homepage link preview, and shares it junto con la
 * captura gráfica ARCHERY 101010 THE APP directamente por WhatsApp.
 */
export async function shareScorecardWhatsAppNative(params: TargetShotChartParams): Promise<ShareTargetResult> {
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

  let totalArrows = 0;
  ends.forEach((e) => {
    (e.arrows || []).forEach((a) => {
      if (a !== "") totalArrows++;
    });
  });
  if (totalArrows === 0 && params.impacts) {
    totalArrows = params.impacts.length;
  }

  const effectiveMaxScore = totalArrows > 0 ? totalArrows * 10 : maxScore;
  const pct = effectiveMaxScore > 0 ? Math.round((score / effectiveMaxScore) * 100) : 0;
  const avgPerArrow = totalArrows > 0 ? (score / totalArrows).toFixed(2) : "0.00";
  const bowLabel =
    bowType === "Recurve" ? "Recurvo" : bowType === "Compound" ? "Compuesto" : bowType || "Recurvo";

  const endsDetail = ends
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

  const message =
    `*PLANILLA OFICIAL · ARCHERY 101010 THE APP*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• *Arquero:* ${archerName || "Arquero"}\n` +
    `• *Arco:* ${bowLabel}\n` +
    `• *Modalidad:* ${format} · ${distanceM}m\n` +
    `• *Flechas Tiradas:* ${totalArrows}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*PUNTUACIÓN TOTAL:* *${score}* / ${effectiveMaxScore} pts (*${pct}%*)\n` +
    `• *10s:* ${tensCount} | *Xs:* ${xsCount}\n` +
    `• *Promedio:* ${avgPerArrow} pts\n` +
    (endsDetail ? `\n*Desglose de Tiradas:*\n${endsDetail}\n` : "") +
    (sessionNote ? `\n*Notas:* ${sessionNote}\n` : "") +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 *ARCHERY 101010 THE APP*`;

  const canvas = await renderTargetShotChartCanvas(params);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `Archery101010-Planilla-${Date.now()}.png`;

  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareWhatsAppImage) {
    try {
      window.ArcheryNativeShare.shareWhatsAppImage(dataUrl, fileName, message);
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params };
    } catch (err) {
      console.error("Native shareWhatsAppImage error:", err);
    }
  }

  try {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 0.95));
    if (blob && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Planilla ${archerName || "Arquero"} • ARCHERY 101010 THE APP`,
          text: message
        });
        return { sharedNatively: true, dataUrl, fileName, captionText: message, params };
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { sharedNatively: true, dataUrl, fileName, captionText: message, params };
    }
  }

  const encoded = encodeURIComponent(message);
  if (typeof window !== "undefined") {
    window.location.href = `whatsapp://send?text=${encoded}`;
  }
  return { sharedNatively: false, dataUrl, fileName, captionText: message, params };
}
