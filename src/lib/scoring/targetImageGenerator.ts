"use client";

import { ShotImpactData, DispersionAnalysis, calculateDispersionAnalysis, getConvexHull } from "./dispersionAnalytics";
import { DIANA_PRESETS } from "@/components/scoring/ScoringView";

export interface TargetShotChartParams {
  impacts: ShotImpactData[];
  presetType?: string;
  score: number;
  maxScore: number;
  tensCount: number;
  xsCount: number;
  distanceM: number;
  bowType: string;
  archerName: string;
  dateStr?: string;
  dispersion?: DispersionAnalysis | null;
}

/**
 * Renders high-definition (1080x1080) Shot Chart on Canvas and returns PNG Blob
 */
export async function generateTargetShotChartBlob(params: TargetShotChartParams): Promise<Blob> {
  const {
    impacts,
    presetType = "WA_10_122",
    score,
    maxScore,
    tensCount,
    xsCount,
    distanceM,
    bowType,
    archerName,
    dateStr = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }),
    dispersion: initialDispersion
  } = params;

  const dispersion = initialDispersion || calculateDispersionAnalysis(impacts, distanceM, bowType);

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // 1. OLED Dark Background
  const bgGrad = ctx.createRadialGradient(540, 500, 100, 540, 540, 750);
  bgGrad.addColorStop(0, "#0E1522");
  bgGrad.addColorStop(0.5, "#080C14");
  bgGrad.addColorStop(1, "#030508");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle ambient cyan glow behind the diana
  const haloGrad = ctx.createRadialGradient(540, 480, 150, 540, 480, 420);
  haloGrad.addColorStop(0, "rgba(0, 229, 255, 0.08)");
  haloGrad.addColorStop(0.7, "rgba(0, 162, 232, 0.03)");
  haloGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, 1080, 1080);

  // Decorative border
  ctx.strokeStyle = "rgba(0, 229, 255, 0.25)";
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 28, 1024, 1024);

  // 2. Header
  // Brand Pill
  ctx.fillStyle = "rgba(0, 229, 255, 0.12)";
  ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(50, 50, 210, 36, 18);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#00E5FF";
  ctx.textAlign = "center";
  ctx.fillText("ARCHERY 101010", 155, 74);

  // Archer Name
  ctx.font = "900 36px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.fillText(archerName || "Arquero", 50, 130, 710);

  // Category & Details
  ctx.font = "600 20px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.fillText(`${bowType} • ${distanceM}m • ${dateStr}`, 50, 162, 710);

  // Total Score Badge (Top Right)
  ctx.fillStyle = "rgba(253, 216, 53, 0.1)";
  ctx.strokeStyle = "rgba(253, 216, 53, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(790, 50, 240, 115, 24);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = "#FDD835";
  ctx.textAlign = "center";
  ctx.fillText("PUNTUACIÓN TOTAL", 910, 82);

  ctx.font = "900 48px monospace";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`${score}`, 910, 132);

  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText(`/ ${maxScore} pts (${Math.round((score / (maxScore || 1)) * 100)}%)`, 910, 155);

  // 3. Target Face Center & Geometry
  const targetCenterX = 540;
  const targetCenterY = 515;
  const targetRadius = 310; // 620px diameter on canvas

  // Target background shadow
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 35;
  ctx.beginPath();
  ctx.arc(targetCenterX, targetCenterY, targetRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.restore();

  // Draw concentric rings based on preset
  const rings = DIANA_PRESETS[presetType] || DIANA_PRESETS.WA_10_122;
  // rings are sorted from outer (r: 48) to inner (r: 1.5)
  rings.forEach((ring) => {
    // ring.r is 0 to 50 relative to target radius
    const currentR = (ring.r / 48) * targetRadius;
    ctx.beginPath();
    ctx.arc(targetCenterX, targetCenterY, currentR, 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.strokeStyle = ring.stroke;
    ctx.lineWidth = ring.v === "X" ? 1.5 : 2;
    ctx.stroke();
  });

  // Crosshair center (+)
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(targetCenterX - 12, targetCenterY);
  ctx.lineTo(targetCenterX + 12, targetCenterY);
  ctx.moveTo(targetCenterX, targetCenterY - 12);
  ctx.lineTo(targetCenterX, targetCenterY + 12);
  ctx.stroke();

  // 4. Centroid & Dispersion Ellipse
  if (dispersion && impacts.length >= 2) {
    const cx = targetCenterX + ((dispersion.centroidX - 50) / 48) * targetRadius;
    const cy = targetCenterY + ((dispersion.centroidY - 50) / 48) * targetRadius;
    const rx = (dispersion.spreadCm / getTargetDiameter(distanceM, bowType)) * (targetRadius * 2) * 0.45;
    const clampedRx = Math.max(14, rx);

    // Dispersion circle
    ctx.save();
    ctx.strokeStyle = "rgba(0, 229, 255, 0.8)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, clampedRx, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Grouping Polygon / Line
    if (impacts.length >= 3) {
      const hull = getConvexHull(impacts.map(i => ({ x: i.x, y: i.y })));
      if (hull.length >= 3) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.fillStyle = "rgba(0, 229, 255, 0.08)";
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
    } else if (impacts.length === 2) {
      const p1 = impacts[0];
      const p2 = impacts[1];
      const hx1 = targetCenterX + ((p1.x - 50) / 48) * targetRadius;
      const hy1 = targetCenterY + ((p1.y - 50) / 48) * targetRadius;
      const hx2 = targetCenterX + ((p2.x - 50) / 48) * targetRadius;
      const hy2 = targetCenterY + ((p2.y - 50) / 48) * targetRadius;
      ctx.save();
      ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(hx1, hy1);
      ctx.lineTo(hx2, hy2);
      ctx.stroke();
      ctx.restore();
    }

    // Centroid crosshair
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy + 16);
    ctx.stroke();

    ctx.fillStyle = "#00E5FF";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Plotted Arrow Impacts
  impacts.forEach((imp, idx) => {
    // Map SVG 0-100% to canvas target coordinates
    // center is 50 -> targetCenterX
    const ix = targetCenterX + ((imp.x - 50) / 48) * targetRadius;
    const iy = targetCenterY + ((imp.y - 50) / 48) * targetRadius;

    // Outer glow / shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(ix, iy, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fill();
    ctx.restore();

    // Arrow Dot (Yellow Gold)
    ctx.beginPath();
    ctx.arc(ix, iy, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#FFD700";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label on bullet (X, 10, 9 or arrow index)
    ctx.font = "900 11px sans-serif";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(imp.value || String(idx + 1), ix, iy);
  });

  // 6. Bottom Stats Cards (3 cards)
  const cardY = 875;
  const cardHeight = 110;

  // Card 1: 10s & Xs
  drawStatBox(ctx, 50, cardY, 305, cardHeight, "PRECISIÓN", `${tensCount} (10s) • ${xsCount} (Xs)`, `Promedio: ${impacts.length > 0 ? (score / impacts.length).toFixed(1) : 0} / flecha`);

  // Card 2: Agrupación & Spread
  const spreadText = dispersion ? `Ø ${dispersion.spreadCm.toFixed(1)} cm` : "N/A";
  const groupQuality = dispersion ? dispersion.groupQuality : "Sin impactos";
  drawStatBox(ctx, 385, cardY, 310, cardHeight, "AGRUPACIÓN", spreadText, groupQuality);

  // Card 3: Centro & Ajuste de Mira (Dirección únicamente)
  const centerText = dispersion ? dispersion.clockDirection : "Centro 🎯";
  let directionAdvice = "Mira centrada";
  if (dispersion) {
    const parts: string[] = [];
    if (dispersion.horizontalDirection !== "CENTRADO") parts.push(`Mueve a la ${dispersion.horizontalDirection}`);
    if (dispersion.verticalDirection !== "CENTRADO") parts.push(`Mueve hacia ${dispersion.verticalDirection}`);
    if (parts.length > 0) directionAdvice = parts.join(" y ");
  }
  drawStatBox(ctx, 725, cardY, 305, cardHeight, "AJUSTE DE MIRA", centerText, directionAdvice);

  // 7. Footer Watermark
  ctx.font = "600 14px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.textAlign = "center";
  ctx.fillText("Generado con Archery 101010 • Mobile Scoring & Matchplay Arena", 540, 1045);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/png", 0.95);
  });
}

function getTargetDiameter(distanceM: number, bowType: string): number {
  if (distanceM <= 18) return 40;
  if (distanceM === 50 && bowType === "Compound") return 80;
  if (distanceM <= 50) return 80;
  return 122;
}

function drawStatBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, main: string, sub: string) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 20);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "rgba(0, 229, 255, 0.9)";
  ctx.textAlign = "left";
  ctx.fillText(title, x + 18, y + 28, w - 36);

  ctx.font = "900 22px monospace";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(main, x + 18, y + 62, w - 36);

  ctx.font = "500 13px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText(sub, x + 18, y + 90, w - 36);
}

/**
 * Native Android Share or Fallback Image Download
 */
export async function shareTargetShotChart(params: TargetShotChartParams): Promise<boolean> {
  try {
    const blob = await generateTargetShotChartBlob(params);
    const fileName = `Archery101010-Diana-${Date.now()}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Diana ${params.archerName || "Arquero"} - Archery 101010`,
        text: `🎯 Mi diana de tiro en Archery 101010: ${params.score}/${params.maxScore} pts (${params.tensCount} 10s, ${params.xsCount} Xs). ¡Mira la agrupación!`
      });
      return true;
    } else {
      // Fallback: Trigger direct image download in browser
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      // User cancelled share sheet
      return false;
    }
    console.error("Error sharing target shot chart:", err);
    return false;
  }
}
