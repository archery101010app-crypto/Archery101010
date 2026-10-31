"use client";

import { ShotImpactData, DispersionAnalysis, calculateDispersionAnalysis, getConvexHull, getExactTargetDimensions } from "./dispersionAnalytics";
import { DIANA_PRESETS } from "@/components/scoring/ScoringView";

export interface EndSummaryItem {
  arrows: string[];
  note?: string;
}

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
}

declare global {
  interface Window {
    ArcheryNativeShare?: {
      shareImage: (base64Png: string, fileName: string, title: string, captionText: string) => void;
      shareWhatsAppImage: (base64Png: string, fileName: string, captionText: string) => void;
      shareWhatsAppText: (text: string) => void;
    };
  }
}

/**
 * If an archer scored in Keyboard Mode (or only plotted partial impacts),
 * synthesize realistic target ring coordinates for every scored arrow so the
 * Strava-style target chart always looks complete and accurate.
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
      // Find matching ring radius
      const ringIdx = sortedRings.findIndex((r) => r.v === val);
      let innerR = 0;
      let outerR = 4.0;
      if (ringIdx !== -1) {
        outerR = sortedRings[ringIdx].r;
        innerR = ringIdx > 0 ? sortedRings[ringIdx - 1].r : 0;
      }
      const midR = (innerR + outerR) * 0.5;
      // Golden-angle spiral distribution for natural visual grouping
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

function loadWatermarkImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timeout = setTimeout(() => resolve(null), 2500);
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    img.src = "/images/101010-the-app-watermark.png";
  });
}

function drawFallback101010TheApp(ctx: CanvasRenderingContext2D, centerX: number, centerY: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 54px sans-serif";
  // Draw 10 (Cyan), 10 (Red), 10 (Yellow)
  const offset = 105;
  ctx.fillStyle = "#00A8F3";
  ctx.fillText("10", centerX - offset, centerY - 18);
  ctx.fillStyle = "#FF0000";
  ctx.fillText("10", centerX, centerY - 18);
  ctx.fillStyle = "#FFF200";
  ctx.fillText("10", centerX + offset, centerY - 18);

  ctx.font = "900 24px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.letterSpacing = "8px";
  ctx.fillText("THE APP", centerX, centerY + 32);
  ctx.restore();
}

/**
 * Renders a high-definition Strava/WHOOP-style (1080x1350) Screenshot Canvas
 * featuring the Target Face, Telemetry Stats, End-by-End Scorecard Strip,
 * and the official "101010 THE APP" transparent brand stamp.
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
    dispersion: initialDispersion
  } = params;

  const impacts = synthesizeImpactsFromEnds(rawImpacts, ends, presetType);
  const dispersion =
    initialDispersion ||
    (impacts.length > 0
      ? calculateDispersionAnalysis(impacts, distanceM, bowType, presetType, format)
      : null);

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // 1. Deep OLED Carbon Background (Strava / WHOOP Dark Aesthetic)
  const bgGrad = ctx.createRadialGradient(540, 520, 90, 540, 675, 920);
  bgGrad.addColorStop(0, "#101827");
  bgGrad.addColorStop(0.5, "#070B12");
  bgGrad.addColorStop(1, "#020305");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Subtle ambient halo behind the target
  const haloGrad = ctx.createRadialGradient(540, 525, 110, 540, 525, 410);
  haloGrad.addColorStop(0, "rgba(0, 229, 255, 0.11)");
  haloGrad.addColorStop(0.65, "rgba(255, 242, 0, 0.03)");
  haloGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Outer Frame Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 2.5;
  drawRoundedRect(ctx, 24, 24, 1032, 1302, 36);
  ctx.stroke();

  // Top Accent Line (Cyan -> Red -> Yellow 101010 DNA)
  const topLineGrad = ctx.createLinearGradient(140, 24, 940, 24);
  topLineGrad.addColorStop(0, "rgba(0, 168, 243, 0)");
  topLineGrad.addColorStop(0.25, "#00A8F3");
  topLineGrad.addColorStop(0.5, "#FF0000");
  topLineGrad.addColorStop(0.75, "#FFF200");
  topLineGrad.addColorStop(1, "rgba(255, 242, 0, 0)");
  ctx.strokeStyle = topLineGrad;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(140, 25);
  ctx.lineTo(940, 25);
  ctx.stroke();

  // 2. Top Athlete Header & Score Hero Card
  ctx.fillStyle = "rgba(0, 229, 255, 0.12)";
  ctx.strokeStyle = "rgba(0, 229, 255, 0.35)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, 54, 52, 245, 36, 18);
  ctx.fill();
  ctx.stroke();

  ctx.font = "900 15px monospace";
  ctx.fillStyle = "#00E5FF";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TELEMETRÍA OFICIAL", 176, 75);

  // Archer Name
  ctx.font = "900 42px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.fillText(archerName || "Arquero", 54, 138, 680);

  // Category, Distance, Format & Date
  const displayBowType =
    bowType === "Recurve" ? "Recurvo" : bowType === "Compound" ? "Compuesto" : bowType || "Recurvo";
  ctx.font = "700 21px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.fillText(`${displayBowType} • ${distanceM}m • ${format} • ${dateStr}`, 54, 172, 680);

  // Total Score Hero Badge (Top Right)
  ctx.fillStyle = "rgba(253, 216, 53, 0.10)";
  ctx.strokeStyle = "rgba(253, 216, 53, 0.45)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 766, 52, 260, 130, 26);
  ctx.fill();
  ctx.stroke();

  ctx.font = "900 14px sans-serif";
  ctx.fillStyle = "#FDD835";
  ctx.textAlign = "center";
  ctx.fillText("PUNTUACIÓN TOTAL", 896, 82);

  ctx.font = "900 54px monospace";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${score}`, 896, 138);

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  ctx.font = "800 16px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.fillText(`/ ${maxScore} pts (${pct}%)`, 896, 166);

  // 3. Target Face Center & Geometry
  const targetCenterX = 540;
  const targetCenterY = 520;
  const targetRadius = 300; // 600px diameter on canvas

  // Target shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(targetCenterX, targetCenterY, targetRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.restore();

  // Concentric WA rings
  const rings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
  rings.forEach((ring) => {
    const currentR = (ring.r / 48) * targetRadius;
    ctx.beginPath();
    ctx.arc(targetCenterX, targetCenterY, currentR, 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.strokeStyle = ring.stroke;
    ctx.lineWidth = ring.v === "X" ? 1.5 : 2;
    ctx.stroke();
  });

  // Center spider (+)
  ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(targetCenterX - 12, targetCenterY);
  ctx.lineTo(targetCenterX + 12, targetCenterY);
  ctx.moveTo(targetCenterX, targetCenterY - 12);
  ctx.lineTo(targetCenterX, targetCenterY + 12);
  ctx.stroke();

  // 4. Centroid & Grouping Polygon
  if (dispersion && impacts.length >= 2) {
    const cx = targetCenterX + ((dispersion.centroidX - 50) / 48) * targetRadius;
    const cy = targetCenterY + ((dispersion.centroidY - 50) / 48) * targetRadius;
    const activeDiameterCm = getExactTargetDimensions(distanceM, bowType, presetType).visibleDiameterCm;
    const rx = (dispersion.spreadCm / activeDiameterCm) * (targetRadius * 2) * 0.5;
    const clampedRx = Math.max(14, Math.min(targetRadius * 0.95, rx));

    ctx.save();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, clampedRx, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (impacts.length >= 3) {
      const hull = getConvexHull(impacts.map((i) => ({ x: i.x, y: i.y })));
      if (hull.length >= 3) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 229, 255, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.fillStyle = "rgba(0, 229, 255, 0.10)";
        ctx.beginPath();
        hull.forEach((p, idx) => {
          const hx = targetCenterX + ((p.x - 50) / 48) * targetRadius;
          const hy = targetCenterY + ((p.y - 50) / 48) * targetRadius;
          if (idx === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Group Center Crosshair (+)
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 15, cy);
    ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15);
    ctx.lineTo(cx, cy + 15);
    ctx.stroke();

    ctx.fillStyle = "#00E5FF";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Plotted Arrow Impacts
  impacts.forEach((imp, idx) => {
    const ix = targetCenterX + ((imp.x - 50) / 48) * targetRadius;
    const iy = targetCenterY + ((imp.y - 50) / 48) * targetRadius;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(ix, iy, 13.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(ix, iy, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#FFD700";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "900 11px sans-serif";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(imp.value || String(idx + 1), ix, iy);
  });

  // Reset textBaseline
  ctx.textBaseline = "alphabetic";

  // 6. Strava-Style Telemetry KPI Boxes (3 Columns)
  const cardY = 852;
  const cardHeight = 112;
  const totalArrowsCount =
    ends.length > 0
      ? ends.reduce((sum, e) => sum + (e.arrows || []).filter((a) => a !== "").length, 0)
      : impacts.length;
  const avgArrow = totalArrowsCount > 0 ? (score / totalArrowsCount).toFixed(2) : "0.00";

  drawStatBox(
    ctx,
    54,
    cardY,
    306,
    cardHeight,
    "PRECISIÓN & OROS",
    `${tensCount} (10+X) • ${xsCount} Xs`,
    `Promedio: ${avgArrow} pts / flecha (${totalArrowsCount} fl.)`
  );

  const spreadText = dispersion ? `Ø ${dispersion.spreadCm.toFixed(1)} cm` : "Activa";
  const groupQuality = dispersion ? dispersion.groupQuality : `${totalArrowsCount} flechas registradas`;
  drawStatBox(ctx, 387, cardY, 306, cardHeight, "AGRUPACIÓN", spreadText, groupQuality);

  const centerText = dispersion ? dispersion.clockDirection : "Centro X";
  let directionAdvice = "Mira centrada";
  if (dispersion) {
    const hasV = dispersion.verticalDirection !== "CENTRADO";
    const hasH = dispersion.horizontalDirection !== "CENTRADO";
    if (hasV && hasH) {
      directionAdvice = `Mover ${dispersion.verticalDirection === "ARRIBA" ? "arriba" : "abajo"} y ${
        dispersion.horizontalDirection === "DERECHA" ? "derecha" : "izquierda"
      }`;
    } else if (hasV) {
      directionAdvice = dispersion.verticalDirection === "ARRIBA" ? "Mover hacia arriba" : "Mover hacia abajo";
    } else if (hasH) {
      directionAdvice = dispersion.horizontalDirection === "DERECHA" ? "Mover a la derecha" : "Mover a la izquierda";
    }
  }
  drawStatBox(ctx, 720, cardY, 306, cardHeight, "CENTRO DE GRUPO", centerText, directionAdvice);

  // 7. Compact End-by-End Scorecard Strip (Planilla Resumida)
  const validEnds = ends
    .map((e, idx) => {
      const validArrows = (e.arrows || []).filter((a) => a !== "");
      if (validArrows.length === 0) return null;
      const endSum = validArrows.reduce(
        (s, a) => s + (a === "X" || a === "10" ? 10 : a === "M" ? 0 : Number(a) || 0),
        0
      );
      return { idx: idx + 1, sum: endSum, arrows: validArrows };
    })
    .filter(Boolean) as Array<{ idx: number; sum: number; arrows: string[] }>;

  if (validEnds.length > 0) {
    const stripY = 984;
    const stripH = 92;
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 54, stripY, 972, stripH, 20);
    ctx.fill();
    ctx.stroke();

    ctx.font = "900 11px sans-serif";
    ctx.fillStyle = "rgba(0, 229, 255, 0.85)";
    ctx.textAlign = "left";
    ctx.fillText("RESUMEN DE RONDAS (ENDS)", 74, stripY + 24);

    const displayEnds = validEnds.slice(0, 12);
    const colW = Math.min(82, Math.floor(932 / displayEnds.length));
    displayEnds.forEach((item, i) => {
      const cellX = 74 + i * colW;
      ctx.font = "700 12px sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.50)";
      ctx.textAlign = "center";
      ctx.fillText(`E${item.idx}`, cellX + colW * 0.42, stripY + 48);

      ctx.font = "900 20px monospace";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(`${item.sum}`, cellX + colW * 0.42, stripY + 74);
    });
  }

  // 8. Signature Strava-Style "101010 THE APP" Watermark Stamp at Bottom
  const wmImg = await loadWatermarkImage();
  const stampCenterY = validEnds.length > 0 ? 1200 : 1145;

  // Decorative side lines flanking the 101010 THE APP watermark
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(80, stampCenterY);
  ctx.lineTo(290, stampCenterY);
  ctx.moveTo(790, stampCenterY);
  ctx.lineTo(1000, stampCenterY);
  ctx.stroke();

  if (wmImg) {
    const wmW = 420;
    const wmH = Math.round((wmImg.height / wmImg.width) * wmW); // ~184px
    ctx.drawImage(wmImg, Math.round(540 - wmW / 2), Math.round(stampCenterY - wmH / 2), wmW, wmH);
  } else {
    drawFallback101010TheApp(ctx, 540, stampCenterY);
  }

  return canvas;
}

/**
 * Renders high-definition (1080x1350) Shot Chart on Canvas and returns PNG Blob
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
      0.95
    );
  });
}

function drawStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  main: string,
  sub: string
) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.stroke();

  ctx.font = "900 12px sans-serif";
  ctx.fillStyle = "rgba(0, 229, 255, 0.9)";
  ctx.textAlign = "left";
  ctx.fillText(title, x + 18, y + 28, w - 36);

  ctx.font = "900 22px monospace";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(main, x + 18, y + 62, w - 36);

  ctx.font = "600 13px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.fillText(sub, x + 18, y + 90, w - 36);
}

export interface ShareTargetResult {
  sharedNatively: boolean;
  dataUrl: string;
  fileName: string;
  captionText: string;
}

/**
 * Generates the Strava-style "101010 THE APP" screenshot and triggers
 * Native Android Image Share (in APK) or Web Share API (in mobile browsers),
 * while also returning the DataURL so the app can display the preview modal.
 */
export async function shareTargetShotChart(params: TargetShotChartParams): Promise<ShareTargetResult> {
  const canvas = await renderTargetShotChartCanvas(params);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `101010-TheApp-Diana-${Date.now()}.png`;
  const title = `Diana ${params.archerName || "Arquero"} • 101010 THE APP`;
  const captionText =
    `🎯 *101010 THE APP*\n` +
    `• *Arquero:* ${params.archerName || "Arquero"}\n` +
    `• *Puntaje:* ${params.score} / ${params.maxScore} pts\n` +
    `• *Precisión:* ${params.tensCount} (10+X) | ${params.xsCount} Xs · ${params.distanceM}m`;

  // 1. Native Android APK Bridge (100% reliable in Capacitor Android WebView)
  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareImage) {
    try {
      window.ArcheryNativeShare.shareImage(dataUrl, fileName, title, captionText);
      return { sharedNatively: true, dataUrl, fileName, captionText };
    } catch (err) {
      console.error("Native shareImage bridge error:", err);
    }
  }

  // 2. Mobile Browser Web Share API Level 2 (File share)
  try {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 0.95));
    if (blob && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title,
          text: captionText
        });
        return { sharedNatively: true, dataUrl, fileName, captionText };
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { sharedNatively: true, dataUrl, fileName, captionText };
    }
  }

  return { sharedNatively: false, dataUrl, fileName, captionText };
}

/**
 * Formats the complete Scorecard (Planilla) WITHOUT any homepage URL so WhatsApp
 * never converts it into a homepage link preview, and shares it junto con la
 * captura gráfica 101010 THE APP directamente por WhatsApp.
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

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  let totalArrows = 0;
  ends.forEach((e) => {
    (e.arrows || []).forEach((a) => {
      if (a !== "") totalArrows++;
    });
  });
  if (totalArrows === 0 && params.impacts) {
    totalArrows = params.impacts.length;
  }

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
      return `• End ${idx + 1}: ${valid.join(", ")}  →  *${endSum}* pts`;
    })
    .filter(Boolean)
    .join("\n");

  // Clean WhatsApp scorecard text — NO URLs so WhatsApp never shows a homepage link card
  const message =
    `*PLANILLA OFICIAL · 101010 THE APP*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• *Arquero:* ${archerName || "Arquero"}\n` +
    `• *Arco:* ${bowLabel}\n` +
    `• *Modalidad:* ${format} · ${distanceM}m\n` +
    `• *Flechas Tiradas:* ${totalArrows}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*PUNTUACIÓN TOTAL:* *${score}* / ${maxScore} pts (*${pct}%*)\n` +
    `• *10s:* ${tensCount} | *Xs:* ${xsCount}\n` +
    `• *Promedio/Flecha:* ${avgPerArrow} pts\n` +
    (endsDetail ? `\n*Desglose de Tiradas:*\n${endsDetail}\n` : "") +
    (sessionNote ? `\n*Notas:* ${sessionNote}\n` : "") +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 *101010 THE APP*`;

  const canvas = await renderTargetShotChartCanvas(params);
  const dataUrl = canvas.toDataURL("image/png");
  const fileName = `101010-TheApp-Planilla-${Date.now()}.png`;

  // 1. Native Android APK WhatsApp Image + Scorecard Caption Share
  if (typeof window !== "undefined" && window.ArcheryNativeShare?.shareWhatsAppImage) {
    try {
      window.ArcheryNativeShare.shareWhatsAppImage(dataUrl, fileName, message);
      return { sharedNatively: true, dataUrl, fileName, captionText: message };
    } catch (err) {
      console.error("Native shareWhatsAppImage error:", err);
    }
  }

  // 2. Mobile Browser Web Share API with Image + Full Planilla Text
  try {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png", 0.95));
    if (blob && typeof navigator !== "undefined" && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Planilla ${archerName || "Arquero"} • 101010 THE APP`,
          text: message
        });
        return { sharedNatively: true, dataUrl, fileName, captionText: message };
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { sharedNatively: true, dataUrl, fileName, captionText: message };
    }
  }

  // 3. Direct WhatsApp URI fallback (text without any URL)
  const encoded = encodeURIComponent(message);
  if (typeof window !== "undefined") {
    window.location.href = `whatsapp://send?text=${encoded}`;
  }
  return { sharedNatively: false, dataUrl, fileName, captionText: message };
}
