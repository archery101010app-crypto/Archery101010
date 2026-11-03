/**
 * Single source of truth to interpret a stored session:
 *  - Scored session  → show points (score / maxScore)
 *  - Volume session  → show arrow count (NEVER points)
 *
 * Legacy volume sessions stored each tally click as "10", which made them look like
 * 10 × arrows "points". These helpers neutralise that everywhere in the UI.
 */

export function isVolumeSession(s: any): boolean {
  if (!s) return false;
  return s.isVolumeOnly === true || s.practiceType === "Volumen";
}

export function countScoredArrows(s: any): number {
  if (!s || !Array.isArray(s.ends)) return 0;
  return s.ends.reduce(
    (acc: number, e: any) =>
      acc + (Array.isArray(e?.arrows) ? e.arrows.filter((a: string) => a !== "" && a !== undefined && a !== null).length : 0),
    0
  );
}

/** Total arrows shot in the session (confirmed volume first, then counted arrows, then grid size). */
export function getSessionArrows(s: any): number {
  if (!s) return 0;
  const counted = countScoredArrows(s) + (s.warmupArrows || 0);
  if (typeof s.totalArrowsVolume === "number" && s.totalArrowsVolume > 0) {
    return Math.max(s.totalArrowsVolume, counted);
  }
  if (counted > 0) return counted;
  return (s.endsCount || 0) * (s.arrowsPerEnd || 0) + (s.warmupArrows || 0);
}

/** Real points of a scored session (0 for volume sessions). */
export function getSessionScore(s: any): number {
  if (!s || isVolumeSession(s)) return 0;
  return Number(s.score) || 0;
}

export function getSessionMaxScore(s: any): number {
  if (!s || isVolumeSession(s)) return 0;
  return Number(s.maxScore) || 0;
}

/** True when the session carries real points to rank/compare (not volume, not empty). */
export function hasRealScore(s: any): boolean {
  return !isVolumeSession(s) && getSessionScore(s) > 0 && getSessionMaxScore(s) > 0;
}
