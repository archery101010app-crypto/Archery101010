export interface ShotImpactData {
  endIdx: number;
  arrowIdx: number;
  x: number; // 0 to 100% (center is 50)
  y: number; // 0 to 100% (center is 50)
  value: string;
}

export interface DispersionAnalysis {
  count: number;
  centroidX: number;
  centroidY: number;
  deltaXPercent: number;
  deltaYPercent: number;
  deltaXCm: number;
  deltaYCm: number;
  distanceFromCenterCm: number;
  clockDirection: string;
  clockHour: number;
  spreadCm: number;
  meanRadiusCm: number;
  horizontalClicks: number;
  horizontalDirection: "DERECHA" | "IZQUIERDA" | "CENTRADO";
  verticalClicks: number;
  verticalDirection: "ARRIBA" | "ABAJO" | "CENTRADO";
  groupQuality: string;
  adviceText: string;
}

/**
 * Calculates Target Diameter in centimeters based on distance and bow type
 */
export function getTargetDiameterCm(distanceM: number = 70, bowType: string = "Recurve"): number {
  if (distanceM <= 18) return 40;
  if (distanceM === 50 && bowType === "Compound") return 80;
  if (distanceM <= 30) return 80;
  if (distanceM <= 50) return 80;
  return 122; // Standard 70m / 60m Recurve
}

/**
 * Calculates estimated impact movement in cm per 1 sight click
 * Standard tournament sight (Shibuya Dual Click / Ultima, Axcel, Sure-Loc):
 * 1 turn = 20-24 clicks = ~1mm movement on sight bar.
 * At 70m: ~0.41 cm/click.
 * At 50m: ~0.29 cm/click.
 * At 18m: ~0.11 cm/click.
 */
export function getCmPerSightClick(distanceM: number = 70): number {
  const sightRadiusM = 0.85; // approx 85cm from eye to sight pin
  const clickMovementMm = 0.05; // 0.05mm per click
  const cmPerClick = ((clickMovementMm / 1000) * distanceM) / sightRadiusM * 100;
  return Math.max(0.08, cmPerClick);
}

/**
 * Full Dispersion & Sight Adjustment Analysis
 */
export function calculateDispersionAnalysis(
  impacts: ShotImpactData[],
  distanceM: number = 70,
  bowType: string = "Recurve"
): DispersionAnalysis | null {
  if (!impacts || impacts.length === 0) return null;

  const count = impacts.length;
  const sumX = impacts.reduce((acc, imp) => acc + imp.x, 0);
  const sumY = impacts.reduce((acc, imp) => acc + imp.y, 0);
  const centroidX = sumX / count;
  const centroidY = sumY / count;

  const targetDiameterCm = getTargetDiameterCm(distanceM, bowType);
  const cmPerUnit = targetDiameterCm / 100;

  // Delta in SVG percentage (center is 50, 50)
  const deltaXPercent = centroidX - 50;
  // In SVG, Y increases downwards. Therefore:
  // if centroidY < 50, arrow is high (UP).
  // if centroidY > 50, arrow is low (DOWN).
  const deltaYPercent = -(centroidY - 50);

  const deltaXCm = deltaXPercent * cmPerUnit;
  const deltaYCm = deltaYPercent * cmPerUnit;
  const distanceFromCenterCm = Math.sqrt(deltaXCm * deltaXCm + deltaYCm * deltaYCm);

  // Clock direction angle
  // 12:00 = 90 deg, 3:00 = 0 deg, 6:00 = 270 deg, 9:00 = 180 deg
  let angleDeg = (Math.atan2(deltaYCm, deltaXCm) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  // Convert mathematical angle (0 = East/Right) to clock hour (12 = North, 3 = East)
  // angle 90 -> 12, angle 0 -> 3, angle 270 -> 6, angle 180 -> 9
  let clockHour = Math.round((450 - angleDeg) / 30) % 12;
  if (clockHour === 0) clockHour = 12;

  let clockDirection = "Centro 🎯";
  if (distanceFromCenterCm > 0.8) {
    const arrowsClock: Record<number, string> = {
      12: "12:00 ⬆",
      1: "1:00 ↗",
      2: "2:00 ↗",
      3: "3:00 ➡",
      4: "4:00 ↘",
      5: "5:00 ↘",
      6: "6:00 ⬇",
      7: "7:00 ↙",
      8: "8:00 ↙",
      9: "9:00 ⬅",
      10: "10:00 ↖",
      11: "11:00 ↖"
    };
    clockDirection = arrowsClock[clockHour] || `${clockHour}:00`;
  }

  // Group Spread (Extreme distance between any pair of impacts)
  let maxDistanceCm = 0;
  for (let i = 0; i < impacts.length; i++) {
    for (let j = i + 1; j < impacts.length; j++) {
      const dx = (impacts[i].x - impacts[j].x) * cmPerUnit;
      const dy = (impacts[i].y - impacts[j].y) * cmPerUnit;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDistanceCm) {
        maxDistanceCm = dist;
      }
    }
  }

  // Mean radius (average distance to group centroid)
  const sumRadiusCm = impacts.reduce((acc, imp) => {
    const dx = (imp.x - centroidX) * cmPerUnit;
    const dy = (imp.y - centroidY) * cmPerUnit;
    return acc + Math.sqrt(dx * dx + dy * dy);
  }, 0);
  const meanRadiusCm = count > 0 ? sumRadiusCm / count : 0;
  const spreadCm = count === 1 ? 0 : maxDistanceCm;

  // Sight Adjustment Clicks
  // In archery, universal rule: "Chase the arrow" (Mover la mira hacia donde pega la flecha)
  // If hitting RIGHT, move sight RIGHT.
  // If hitting HIGH, move sight UP.
  const cmPerClick = getCmPerSightClick(distanceM);
  const horizontalClicks = Math.round(Math.abs(deltaXCm) / cmPerClick);
  const verticalClicks = Math.round(Math.abs(deltaYCm) / cmPerClick);

  let horizontalDirection: "DERECHA" | "IZQUIERDA" | "CENTRADO" = "CENTRADO";
  if (deltaXCm > 0.4) horizontalDirection = "DERECHA";
  else if (deltaXCm < -0.4) horizontalDirection = "IZQUIERDA";

  let verticalDirection: "ARRIBA" | "ABAJO" | "CENTRADO" = "CENTRADO";
  if (deltaYCm > 0.4) verticalDirection = "ARRIBA";
  else if (deltaYCm < -0.4) verticalDirection = "ABAJO";

  // Group Quality rating
  let groupQuality = "Excelente / Muy Compacto";
  if (spreadCm > targetDiameterCm * 0.35) {
    groupQuality = "Disperso";
  } else if (spreadCm > targetDiameterCm * 0.22) {
    groupQuality = "Dispersión Moderada";
  } else if (spreadCm > targetDiameterCm * 0.12) {
    groupQuality = "Bueno / Cerrado";
  }

  // Actionable advice text
  let adviceParts: string[] = [];
  if (horizontalDirection !== "CENTRADO" && horizontalClicks > 0) {
    adviceParts.push(`Mueve tu mira ${horizontalClicks} ${horizontalClicks === 1 ? "clic" : "clics"} a la ${horizontalDirection}`);
  }
  if (verticalDirection !== "CENTRADO" && verticalClicks > 0) {
    adviceParts.push(`Mueve tu mira ${verticalClicks} ${verticalClicks === 1 ? "clic" : "clics"} hacia ${verticalDirection}`);
  }

  const adviceText = adviceParts.length > 0 
    ? `${adviceParts.join(" y ")} (Regla: sigue el impacto).` 
    : "¡Excelente centrado! Tu grupo está calibrado en la X.";

  return {
    count,
    centroidX,
    centroidY,
    deltaXPercent,
    deltaYPercent,
    deltaXCm,
    deltaYCm,
    distanceFromCenterCm,
    clockDirection,
    clockHour,
    spreadCm,
    meanRadiusCm,
    horizontalClicks,
    horizontalDirection,
    verticalClicks,
    verticalDirection,
    groupQuality,
    adviceText
  };
}
