"use client";

import {
  athleteStarsStore,
  starHistoryStore,
  addToSyncQueue,
  generateResilientId
} from "@/lib/db/indexedDB";

export interface StarDefinition {
  level: number;
  minScore: number;
  name: string;
  color: string;
  iconColor: string;
  badgeClass: string;
  description: string;
}

export const RECURVE_STARS: StarDefinition[] = [
  { level: 1, minScore: 500, name: "Estrella de Bronce", color: "#CD7F32", iconColor: "text-amber-700", badgeClass: "bg-amber-900/20 text-amber-500 border-amber-800/30", description: "Lograda en Recurvo 70m con 500+ puntos" },
  { level: 2, minScore: 550, name: "Estrella de Plata", color: "#C0C0C0", iconColor: "text-white", badgeClass: "bg-slate-800/30 text-white border-slate-700/30", description: "Lograda en Recurvo 70m con 550+ puntos" },
  { level: 3, minScore: 575, name: "Estrella de Oro", color: "#FFE500", iconColor: "text-yellow-gold", badgeClass: "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20", description: "Lograda en Recurvo 70m con 575+ puntos" },
  { level: 4, minScore: 600, name: "Estrella Azul", color: "#00BFFF", iconColor: "text-cyan-neon", badgeClass: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20", description: "Lograda en Recurvo 70m con 600+ puntos" },
  { level: 5, minScore: 620, name: "Estrella Roja", color: "#FF0000", iconColor: "text-red-rival", badgeClass: "bg-red-rival/10 text-red-rival border-red-rival/20", description: "Lograda en Recurvo 70m con 620+ puntos" },
  { level: 6, minScore: 650, name: "Estrella de Oro y Negro", color: "#DAA520", iconColor: "text-amber-500", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20", description: "Lograda en Recurvo 70m con 650+ puntos" },
  { level: 7, minScore: 675, name: "Estrella Púrpura", color: "#A855F7", iconColor: "text-purple-500", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20", description: "Lograda en Recurvo 70m con 675+ puntos" },
  { level: 8, minScore: 700, name: "Estrella de Diamante", color: "#EC4899", iconColor: "text-pink-500", badgeClass: "bg-pink-500/10 text-pink-400 border-pink-500/20", description: "Lograda en Recurvo 70m con 700+ puntos" }
];

export const COMPOUND_STARS: StarDefinition[] = [
  { level: 1, minScore: 500, name: "Estrella de Bronce", color: "#CD7F32", iconColor: "text-amber-700", badgeClass: "bg-amber-900/20 text-amber-500 border-amber-800/30", description: "Lograda en Compuesto 50m con 500+ puntos" },
  { level: 2, minScore: 550, name: "Estrella de Plata", color: "#C0C0C0", iconColor: "text-white", badgeClass: "bg-slate-800/30 text-white border-slate-700/30", description: "Lograda en Compuesto 50m con 550+ puntos" },
  { level: 3, minScore: 575, name: "Estrella de Oro", color: "#FFE500", iconColor: "text-yellow-gold", badgeClass: "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20", description: "Lograda en Compuesto 50m con 575+ puntos" },
  { level: 4, minScore: 600, name: "Estrella Azul", color: "#00BFFF", iconColor: "text-cyan-neon", badgeClass: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20", description: "Lograda en Compuesto 50m con 600+ puntos" },
  { level: 5, minScore: 620, name: "Estrella Roja", color: "#FF0000", iconColor: "text-red-rival", badgeClass: "bg-red-rival/10 text-red-rival border-red-rival/20", description: "Lograda en Compuesto 50m con 620+ puntos" },
  { level: 6, minScore: 650, name: "Estrella de Oro y Negro", color: "#DAA520", iconColor: "text-amber-500", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20", description: "Lograda en Compuesto 50m con 650+ puntos" },
  { level: 7, minScore: 675, name: "Estrella Púrpura", color: "#A855F7", iconColor: "text-purple-500", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20", description: "Lograda en Compuesto 50m con 675+ puntos" },
  { level: 8, minScore: 700, name: "Estrella de Diamante", color: "#EC4899", iconColor: "text-pink-500", badgeClass: "bg-pink-500/10 text-pink-400 border-pink-500/20", description: "Lograda en Compuesto 50m con 700+ puntos" }
];

export interface BowStarStat {
  highestScore: number;
  highestStarLevel: number;
  starName?: string;
  starColor?: string;
  achievedAt: number;
}

export interface AthleteStarDoc {
  userId: string;
  userName: string;
  clubId?: string;
  bowType: "Recurve" | "Compound" | "Barebow";
  bowStats?: Record<string, BowStarStat>;
  highestScore: number;
  highestStarLevel: number;
  starName: string;
  starColor: string;
  updatedAt: number;
}

export interface StarHistoryDoc {
  id: string;
  userId: string;
  userName: string;
  clubId?: string;
  bowType: "Recurve" | "Compound" | "Barebow";
  score: number;
  starLevel: number;
  starName: string;
  starColor: string;
  date: string;
  eventId: string;
  timestamp: number;
}

/**
 * Evaluates a completed practice session and awards a 101010 Star if eligible.
 * Tracks per-bow achievements in bowStats[bowType] so archers shooting both Compound and Recurve
 * unlock and retain stars independently for each bow type without overwriting!
 */
export async function checkAndAwardStar(
  userId: string,
  userName: string,
  bowType: string,
  distance: number,
  endsCount: number,
  arrowsPerEnd: number,
  score: number,
  eventId: string
): Promise<StarDefinition | null> {
  // 1. Validate WA 720 criteria (72 arrows, specific distance)
  const isRecurve70 = bowType === "Recurve" && distance === 70;
  const isCompound50 = bowType === "Compound" && distance === 50;
  const totalArrows = endsCount * arrowsPerEnd;

  if (totalArrows !== 72 || (!isRecurve70 && !isCompound50)) {
    return null;
  }

  const normalizedBow: "Recurve" | "Compound" = isRecurve70 ? "Recurve" : "Compound";
  const starTiers = isRecurve70 ? RECURVE_STARS : COMPOUND_STARS;
  const safeScore = Math.max(0, Math.min(720, Math.round(score)));

  // Find highest star achieved in this session
  const achievedTiers = starTiers.filter((s) => safeScore >= s.minScore);
  if (achievedTiers.length === 0) {
    return null;
  }

  const sessionStar = achievedTiers[achievedTiers.length - 1];

  try {
    const now = Date.now();
    const todayStr = new Date(now).toISOString().split("T")[0];
    const currentDoc = await athleteStarsStore.getItem<AthleteStarDoc>(userId);

    // Seed existing bowStats from legacy top-level fields if not yet populated
    const existingBowStats: Record<string, BowStarStat> = { ...(currentDoc?.bowStats || {}) };
    if (
      currentDoc &&
      currentDoc.bowType &&
      !existingBowStats[currentDoc.bowType] &&
      currentDoc.highestStarLevel > 0
    ) {
      existingBowStats[currentDoc.bowType] = {
        highestScore: currentDoc.highestScore,
        highestStarLevel: currentDoc.highestStarLevel,
        starName: currentDoc.starName,
        starColor: currentDoc.starColor,
        achievedAt: currentDoc.updatedAt || now
      };
    }

    const prevBowStat = existingBowStats[normalizedBow];
    const prevBowLevel = prevBowStat?.highestStarLevel || 0;
    const prevBowScore = prevBowStat?.highestScore || 0;

    if (sessionStar.level > prevBowLevel) {
      // Unlocked a new star for this bowType!
      const nextBowStats: Record<string, BowStarStat> = {
        ...existingBowStats,
        [normalizedBow]: {
          highestScore: Math.max(prevBowScore, safeScore),
          highestStarLevel: sessionStar.level,
          starName: sessionStar.name,
          starColor: sessionStar.color,
          achievedAt: now
        }
      };

      // Top-level fields reflect the archer's overall highest star across all bows
      let bestBow: "Recurve" | "Compound" | "Barebow" = normalizedBow;
      let bestLevel = sessionStar.level;
      let bestScore = Math.max(prevBowScore, safeScore);
      let bestName = sessionStar.name;
      let bestColor = sessionStar.color;

      for (const [bKey, stat] of Object.entries(nextBowStats)) {
        if (
          stat.highestStarLevel > bestLevel ||
          (stat.highestStarLevel === bestLevel && stat.highestScore > bestScore)
        ) {
          bestBow = bKey as "Recurve" | "Compound" | "Barebow";
          bestLevel = stat.highestStarLevel;
          bestScore = stat.highestScore;
          const tiers = bKey === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
          const tierDef = tiers.find((t) => t.level === stat.highestStarLevel);
          bestName = stat.starName || tierDef?.name || bestName;
          bestColor = stat.starColor || tierDef?.color || bestColor;
        }
      }

      const starDoc: AthleteStarDoc = {
        userId,
        userName,
        ...(currentDoc?.clubId ? { clubId: currentDoc.clubId } : {}),
        bowType: bestBow,
        bowStats: nextBowStats,
        highestScore: bestScore,
        highestStarLevel: bestLevel,
        starName: bestName,
        starColor: bestColor,
        updatedAt: now
      };

      const historyId = generateResilientId("STR");
      const historyDoc: StarHistoryDoc = {
        id: historyId,
        userId,
        userName,
        ...(currentDoc?.clubId ? { clubId: currentDoc.clubId } : {}),
        bowType: normalizedBow,
        score: safeScore,
        starLevel: sessionStar.level,
        starName: sessionStar.name,
        starColor: sessionStar.color,
        date: todayStr,
        eventId,
        timestamp: now
      };

      await athleteStarsStore.setItem(userId, starDoc);
      await starHistoryStore.setItem(historyId, historyDoc);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "athlete_stars",
        operation: "INSERT",
        payloadId: userId,
        payload: starDoc,
        timestamp: now
      });

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "star_history",
        operation: "INSERT",
        payloadId: historyId,
        payload: historyDoc,
        timestamp: now
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("star-unlocked", {
            detail: {
              userId,
              userName,
              score: safeScore,
              star: sessionStar,
              bowType: normalizedBow,
              distance
            }
          })
        );
      }

      return sessionStar;
    } else if (sessionStar.level === prevBowLevel && currentDoc && safeScore > prevBowScore) {
      // Same star level for this bowType, higher personal best score
      const nextBowStats: Record<string, BowStarStat> = {
        ...existingBowStats,
        [normalizedBow]: {
          highestScore: safeScore,
          highestStarLevel: prevBowLevel,
          starName: prevBowStat?.starName || sessionStar.name,
          starColor: prevBowStat?.starColor || sessionStar.color,
          achievedAt: prevBowStat?.achievedAt || now
        }
      };

      const updatedDoc: AthleteStarDoc = {
        ...currentDoc,
        bowStats: nextBowStats,
        highestScore: Math.max(currentDoc.highestScore || 0, safeScore),
        updatedAt: now
      };

      await athleteStarsStore.setItem(userId, updatedDoc);

      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "athlete_stars",
        operation: "UPDATE",
        payloadId: userId,
        payload: updatedDoc,
        timestamp: now
      });
    }
  } catch (error) {
    console.error("[StarsManager] Error checking/awarding star:", error);
  }

  return null;
}
