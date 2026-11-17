/**
 * Pure World Archery Matchplay scoring engine (Set System for Recurve/Barebow & Cumulative 15-arrow for Compound).
 */
export type MatchBowDivision = "Recurve" | "Compound" | "Barebow";

export function arrowValueToNumeric(val: string | number | undefined | null): number {
  if (val === undefined || val === null) return 0;
  const s = String(val).trim().toUpperCase();
  if (s === "X" || s === "10") return 10;
  if (s === "M" || s === "" || s === "0") return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 0;
}

export function sumEndArrows(arrows: Array<string | number>): number {
  return (arrows || []).reduce<number>((acc, a) => acc + arrowValueToNumeric(a), 0);
}

export function isSetSystemDivision(bowType: string): boolean {
  return bowType !== "Compound";
}

/**
 * Computes set points awarded for a completed end in Recurve / Barebow Set System (2-0 win, 1-1 tie).
 */
export function computeSetEndPoints(archerEndSum: number, rivalEndSum: number): [number, number] {
  if (archerEndSum > rivalEndSum) return [2, 0];
  if (archerEndSum < rivalEndSum) return [0, 2];
  return [1, 1];
}

export interface MatchStanding {
  archerMatchScore: number;
  rivalMatchScore: number;
  isFinished: boolean;
  needsShootOff: boolean;
  winner: "ARCHER" | "RIVAL" | null;
}

/**
 * Evaluates full match standing across completed ends according to World Archery rules:
 * - Recurve / Barebow: Set System up to 5 ends (first to >= 6 set points wins; 5-5 after 5 ends -> Shoot-Off).
 * - Compound: Cumulative points across 5 ends of 3 arrows (15 arrows max 150; tied after 5 ends -> Shoot-Off).
 */
export function evaluateMatchStanding(
  bowType: string,
  archerEnds: Array<Array<string | number>>,
  rivalEnds: Array<Array<string | number>>,
  maxEnds: number = 5
): MatchStanding {
  const completedEnds = Math.min(archerEnds.length, rivalEnds.length, maxEnds);
  const useSets = isSetSystemDivision(bowType);

  if (useSets) {
    let aSets = 0;
    let rSets = 0;
    for (let i = 0; i < completedEnds; i++) {
      const [da, dr] = computeSetEndPoints(sumEndArrows(archerEnds[i]), sumEndArrows(rivalEnds[i]));
      aSets += da;
      rSets += dr;
      if (aSets >= 6 || rSets >= 6) {
        return {
          archerMatchScore: aSets,
          rivalMatchScore: rSets,
          isFinished: true,
          needsShootOff: false,
          winner: aSets > rSets ? "ARCHER" : "RIVAL"
        };
      }
    }

    if (completedEnds >= maxEnds) {
      if (aSets === rSets) {
        return {
          archerMatchScore: aSets,
          rivalMatchScore: rSets,
          isFinished: false,
          needsShootOff: true,
          winner: null
        };
      }
      return {
        archerMatchScore: aSets,
        rivalMatchScore: rSets,
        isFinished: true,
        needsShootOff: false,
        winner: aSets > rSets ? "ARCHER" : "RIVAL"
      };
    }

    return {
      archerMatchScore: aSets,
      rivalMatchScore: rSets,
      isFinished: false,
      needsShootOff: false,
      winner: null
    };
  }

  // Compound Cumulative System (5 ends x 3 arrows = 15 arrows)
  let aTotal = 0;
  let rTotal = 0;
  for (let i = 0; i < completedEnds; i++) {
    aTotal += sumEndArrows(archerEnds[i]);
    rTotal += sumEndArrows(rivalEnds[i]);
  }

  if (completedEnds >= maxEnds) {
    if (aTotal === rTotal) {
      return {
        archerMatchScore: aTotal,
        rivalMatchScore: rTotal,
        isFinished: false,
        needsShootOff: true,
        winner: null
      };
    }
    return {
      archerMatchScore: aTotal,
      rivalMatchScore: rTotal,
      isFinished: true,
      needsShootOff: false,
      winner: aTotal > rTotal ? "ARCHER" : "RIVAL"
    };
  }

  return {
    archerMatchScore: aTotal,
    rivalMatchScore: rTotal,
    isFinished: false,
    needsShootOff: false,
    winner: null
  };
}

/**
 * Resolves a 1-arrow World Archery Shoot-Off:
 * 1) In Compound, an 'X' beats a regular '10' if X-tiebreak is active; otherwise numeric ring wins.
 * 2) If ring values are equal, closest distance to center (spider) in mm wins.
 */
export function resolveWorldArcheryShootOff(
  archerArrow: string,
  rivalArrow: string,
  archerDistMm: number,
  rivalDistMm: number,
  compoundXWinsOverTen: boolean = false
): "ARCHER" | "RIVAL" | "TIE" {
  const aVal = arrowValueToNumeric(archerArrow);
  const rVal = arrowValueToNumeric(rivalArrow);
  if (aVal > rVal) return "ARCHER";
  if (rVal > aVal) return "RIVAL";

  if (compoundXWinsOverTen && aVal === 10) {
    const aIsX = String(archerArrow).trim().toUpperCase() === "X";
    const rIsX = String(rivalArrow).trim().toUpperCase() === "X";
    if (aIsX && !rIsX) return "ARCHER";
    if (rIsX && !aIsX) return "RIVAL";
  }

  if (archerDistMm < rivalDistMm) return "ARCHER";
  if (rivalDistMm < archerDistMm) return "RIVAL";
  return "TIE";
}
