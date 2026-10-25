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
  targetName: string;
  visibleDiameterCm: number;
  ringWidthCm: number;
  tenRingDiameterCm: number;
  cmPerUnit: number;
  rulesRef: string;
}

export interface TargetDimensions {
  presetKey: string;
  name: string;
  nominalDiameterCm: number;
  visibleDiameterCm: number;
  visibleRadiusCm: number;
  cmPerUnit: number;
  ringWidthCm: number;
  tenRingDiameterCm: number;
  xRingDiameterCm: number;
  rulesRef: string;
}

/**
 * Dimensiones oficiales y escala exacta en cm según el Reglamento World Archery (Libro 3, Cap. 7)
 * Mapea las coordenadas relativas SVG (radio exterior 48.0) a los centímetros reales de la diana.
 */
export function getExactTargetDimensions(
  distanceM: number = 70,
  bowType: string = "Recurve",
  presetType?: string,
  format?: string,
  targetType?: string
): TargetDimensions {
  let resolvedPreset = presetType;
  if (!resolvedPreset) {
    if (bowType === "Compound") {
      if (distanceM <= 18 || format === "WA 300" || format === "Vegas 300" || format === "Indoor 300") {
        resolvedPreset = (format === "Vegas 300" || targetType === "Vegas 300") ? "VEGAS_300" : "WA_300_COMPOUND";
      } else {
        resolvedPreset = "WA_COMPOUND_50";
      }
    } else {
      if (distanceM <= 18 || format === "WA 300" || format === "Vegas 300" || format === "Indoor 300") {
        resolvedPreset = "WA_RECURVE_18";
      } else {
        resolvedPreset = "WA_10_122";
      }
    }
  }

  // 1. Compuesto 18m WA 300 (Spot 40cm, anillos 6-10, 10 oficial reducido WA de 2cm)
  // World Archery Libro 3, Art. 7.2.2.3
  if (resolvedPreset === "WA_300_COMPOUND") {
    return {
      presetKey: "WA_300_COMPOUND",
      name: "Compuesto 18m WA 300",
      nominalDiameterCm: 40,
      visibleDiameterCm: 20.0,
      visibleRadiusCm: 10.0,
      cmPerUnit: 10.0 / 48.0, // 0.208333 cm por unidad SVG
      ringWidthCm: 2.0,
      tenRingDiameterCm: 2.0, // 10 reducido oficial WA (2 cm)
      xRingDiameterCm: 1.0,   // X reducida oficial (1 cm)
      rulesRef: "World Archery Book 3, Art. 7.2.2.3 (Diana 40cm Compuesto, 10 reducido de 2cm)"
    };
  }

  // 2. Compuesto 18m Vegas 300 / Recurvo 18m / Barebow 18m (Triple Spot 40cm, anillos 6-10, 10 completo de 4cm)
  // World Archery Libro 3, Art. 7.2.2.2
  if (
    resolvedPreset === "VEGAS_300" ||
    resolvedPreset === "WA_RECURVE_18" ||
    resolvedPreset === "WA_COMPOUND_18" ||
    distanceM <= 18
  ) {
    const isVegas = resolvedPreset === "VEGAS_300" || format === "Vegas 300";
    return {
      presetKey: isVegas ? "VEGAS_300" : "WA_RECURVE_18",
      name: isVegas ? "Compuesto 18m Vegas 300" : `${bowType} 18m Indoor`,
      nominalDiameterCm: 40,
      visibleDiameterCm: 20.0,
      visibleRadiusCm: 10.0,
      cmPerUnit: 10.0 / 48.0, // 0.208333 cm por unidad SVG (anillo = 9.6 unidades = 2.0 cm)
      ringWidthCm: 2.0,
      tenRingDiameterCm: 4.0, // 10 completo de 4cm
      xRingDiameterCm: 2.0,   // X completa de 2cm
      rulesRef: "World Archery Book 3, Art. 7.2.2.2 (Triple Spot 40cm, anillos 6-10, 10 de 4cm)"
    };
  }

  // 3. Compuesto 50m (Diana 80cm reducida a 6 zonas, anillos 5 al 10)
  // World Archery Libro 3, Art. 7.2.2.1
  if (
    resolvedPreset === "WA_COMPOUND_50" ||
    resolvedPreset === "WA_6c" ||
    (bowType === "Compound" && distanceM >= 30)
  ) {
    return {
      presetKey: "WA_COMPOUND_50",
      name: "Compuesto 50m (80cm Reducida)",
      nominalDiameterCm: 80,
      visibleDiameterCm: 48.0, // Anillo 5 exterior: 6 zonas * 8cm diámetro = 48cm visible
      visibleRadiusCm: 24.0,   // Radio exterior visible = 24.0 cm
      cmPerUnit: 24.0 / 48.0,  // EXACTO: 0.50 cm por unidad SVG (anillo = 8.0 unidades = 4.0 cm)
      ringWidthCm: 4.0,
      tenRingDiameterCm: 8.0,  // Anillo del 10: 8 cm de diámetro
      xRingDiameterCm: 4.0,    // Anillo X: 4 cm de diámetro
      rulesRef: "World Archery Book 3, Art. 7.2.2.1 (Diana 80cm reducida 6 zonas, anillos 5-10)"
    };
  }

  // 4. Diana completa de 80cm (10 zonas, anillos 1 al 10) para distancias cortas outdoor (Recurvo 30m / 50m cadete)
  if (distanceM <= 40 && bowType !== "Compound") {
    return {
      presetKey: "WA_80_FULL",
      name: `${bowType} ${distanceM}m (80cm Completa)`,
      nominalDiameterCm: 80,
      visibleDiameterCm: 80.0,
      visibleRadiusCm: 40.0,
      cmPerUnit: 40.0 / 48.0, // 0.833333 cm por unidad SVG
      ringWidthCm: 4.0,
      tenRingDiameterCm: 8.0,
      xRingDiameterCm: 4.0,
      rulesRef: "World Archery Book 3, Art. 7.2.1.2 (Diana completa 80cm de 10 zonas)"
    };
  }

  // 5. Diana oficial WA 122cm (Recurvo 70m / 60m, Barebow 50m)
  // World Archery Libro 3, Art. 7.2.1.1
  return {
    presetKey: "WA_10_122",
    name: `${bowType} ${distanceM}m (122cm Completa)`,
    nominalDiameterCm: 122,
    visibleDiameterCm: 122.0,
    visibleRadiusCm: 61.0,
    cmPerUnit: 61.0 / 48.0, // 1.270833 cm por unidad SVG (anillo = 4.8 unidades = 6.1 cm)
    ringWidthCm: 6.1,
    tenRingDiameterCm: 12.2, // Anillo del 10: 12.2 cm de diámetro
    xRingDiameterCm: 6.1,    // Anillo X: 6.1 cm de diámetro (exactamente la mitad del 10)
    rulesRef: "World Archery Book 3, Art. 7.2.1.1 (Diana completa 122cm de 10 zonas)"
  };
}

/**
 * Calculates Target Diameter in centimeters based on distance and bow type (Retrocompatibilidad)
 */
export function getTargetDiameterCm(distanceM: number = 70, bowType: string = "Recurve"): number {
  const dims = getExactTargetDimensions(distanceM, bowType);
  return dims.visibleDiameterCm;
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
  const sightRadiusM = 0.85; // aprox. 85 cm desde el ojo / peep hasta el pin de mira
  const clickMovementMm = 0.05; // 0.05 mm por clic en regulador micrométrico
  const cmPerClick = ((clickMovementMm / 1000) * distanceM) / sightRadiusM * 100;
  return Math.max(0.08, cmPerClick);
}

/**
 * Full Dispersion & Sight Adjustment Analysis con medidas milimétricas exactas
 */
export function calculateDispersionAnalysis(
  impacts: ShotImpactData[],
  distanceM: number = 70,
  bowType: string = "Recurve",
  presetType?: string,
  format?: string,
  targetType?: string
): DispersionAnalysis | null {
  if (!impacts || impacts.length === 0) return null;

  const count = impacts.length;
  const sumX = impacts.reduce((acc, imp) => acc + imp.x, 0);
  const sumY = impacts.reduce((acc, imp) => acc + imp.y, 0);
  const centroidX = sumX / count;
  const centroidY = sumY / count;

  // Obtener dimensiones reales exactas de la diana según World Archery
  const dims = getExactTargetDimensions(distanceM, bowType, presetType, format, targetType);
  const cmPerUnit = dims.cmPerUnit;

  // Delta en porcentaje SVG (el centro está en 50, 50)
  const deltaXPercent = centroidX - 50;
  // En SVG, Y crece hacia abajo. Por lo tanto:
  // Si centroidY < 50, la flecha impactó arriba (UP / +Y)
  // Si centroidY > 50, la flecha impactó abajo (DOWN / -Y)
  const deltaYPercent = -(centroidY - 50);

  // Distancias reales en centímetros
  const deltaXCm = deltaXPercent * cmPerUnit;
  const deltaYCm = deltaYPercent * cmPerUnit;
  const distanceFromCenterCm = Math.sqrt(deltaXCm * deltaXCm + deltaYCm * deltaYCm);

  // Dirección horaria del grupo (reloj de tiro)
  let angleDeg = (Math.atan2(deltaYCm, deltaXCm) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  let clockHour = Math.round((450 - angleDeg) / 30) % 12;
  if (clockHour === 0) clockHour = 12;

  let clockDirection = "Centro 🎯";
  // Si el grupo se aleja más de un cuarto del radio del 10, indicar reloj
  if (distanceFromCenterCm > dims.tenRingDiameterCm * 0.15) {
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

  // Diámetro Máximo de Grupo (Distancia extrema entre cualquier par de flechas)
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

  // Radio medio del grupo al centroide
  const sumRadiusCm = impacts.reduce((acc, imp) => {
    const dx = (imp.x - centroidX) * cmPerUnit;
    const dy = (imp.y - centroidY) * cmPerUnit;
    return acc + Math.sqrt(dx * dx + dy * dy);
  }, 0);
  const meanRadiusCm = count > 0 ? sumRadiusCm / count : 0;
  const spreadCm = count === 1 ? 0 : maxDistanceCm;

  // Clics de ajuste de mira
  // Regla universal en tiro con arco: "Chase the arrow" (Sigue el impacto)
  // Si pega a la DERECHA -> Mover mira a la DERECHA
  // Si pega ARRIBA -> Mover mira hacia ARRIBA
  const cmPerClick = getCmPerSightClick(distanceM);
  const horizontalClicks = Math.round(Math.abs(deltaXCm) / cmPerClick);
  const verticalClicks = Math.round(Math.abs(deltaYCm) / cmPerClick);

  // Umbral de tolerancia de centrado (0.15 cm o ~1 clic)
  const toleranceCm = Math.min(0.25, cmPerClick * 0.7);

  let horizontalDirection: "DERECHA" | "IZQUIERDA" | "CENTRADO" = "CENTRADO";
  if (deltaXCm > toleranceCm) horizontalDirection = "DERECHA";
  else if (deltaXCm < -toleranceCm) horizontalDirection = "IZQUIERDA";

  let verticalDirection: "ARRIBA" | "ABAJO" | "CENTRADO" = "CENTRADO";
  if (deltaYCm > toleranceCm) verticalDirection = "ARRIBA";
  else if (deltaYCm < -toleranceCm) verticalDirection = "ABAJO";

  // Calidad del grupo según el tamaño real de los anillos de la diana
  let groupQuality = "Excelente / Muy Compacto";
  if (spreadCm <= dims.tenRingDiameterCm) {
    groupQuality = "Grupo Élite (En el 10)";
  } else if (spreadCm <= dims.ringWidthCm * 2) {
    groupQuality = "Excelente / Muy Cerrado";
  } else if (spreadCm <= dims.ringWidthCm * 3.5) {
    groupQuality = "Bueno / Agrupado";
  } else if (spreadCm <= dims.ringWidthCm * 5) {
    groupQuality = "Dispersión Moderada";
  } else {
    groupQuality = "Disperso";
  }

  // Consejo claro y accionable para el arquero
  const adviceParts: string[] = [];
  if (horizontalDirection !== "CENTRADO" && horizontalClicks > 0) {
    adviceParts.push(`${horizontalClicks} clics a la ${horizontalDirection}`);
  }
  if (verticalDirection !== "CENTRADO" && verticalClicks > 0) {
    adviceParts.push(`${verticalClicks} clics hacia ${verticalDirection}`);
  }

  const adviceText = adviceParts.length > 0 
    ? `Ajuste recomendado de mira: ${adviceParts.join(" y ")} (Regla: sigue el impacto).` 
    : "¡Excelente centrado! Tu grupo está perfectamente calibrado en el 10.";

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
    adviceText,
    targetName: dims.name,
    visibleDiameterCm: dims.visibleDiameterCm,
    ringWidthCm: dims.ringWidthCm,
    tenRingDiameterCm: dims.tenRingDiameterCm,
    cmPerUnit: dims.cmPerUnit,
    rulesRef: dims.rulesRef
  };
}

/**
 * Computes 2D Convex Hull of arrow impact coordinates using Monotone Chain algorithm.
 * Returns the perimeter vertices of the arrow grouping in order.
 */
export function getConvexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const crossProduct = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

