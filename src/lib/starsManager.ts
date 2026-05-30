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
  { level: 1, minScore: 500, name: "Estrella de Bronce", color: "#CD7F32", iconColor: "text-amber-700", badgeClass: "bg-amber-900/20 text-amber-500 border-amber-800/30", description: "Logrado en Recurvo 70m con 500+ puntos" },
  { level: 2, minScore: 550, name: "Estrella de Plata", color: "#C0C0C0", iconColor: "text-slate-400", badgeClass: "bg-slate-800/30 text-slate-350 border-slate-700/30", description: "Logrado en Recurvo 70m con 550+ puntos" },
  { level: 3, minScore: 575, name: "Estrella de Oro", color: "#FFE500", iconColor: "text-yellow-gold", badgeClass: "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20", description: "Logrado en Recurvo 70m con 575+ puntos" },
  { level: 4, minScore: 600, name: "Estrella Azul", color: "#00BFFF", iconColor: "text-cyan-neon", badgeClass: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20", description: "Logrado en Recurvo 70m con 600+ puntos" },
  { level: 5, minScore: 620, name: "Estrella Roja", color: "#FF0000", iconColor: "text-red-rival", badgeClass: "bg-red-rival/10 text-red-rival border-red-rival/20", description: "Logrado en Recurvo 70m con 620+ puntos" },
  { level: 6, minScore: 650, name: "Estrella de Oro y Negro", color: "#DAA520", iconColor: "text-amber-500", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20", description: "Logrado en Recurvo 70m con 650+ puntos" },
  { level: 7, minScore: 675, name: "Estrella Púrpura", color: "#A855F7", iconColor: "text-purple-500", badgeClass: "bg-purple-550/10 text-purple-400 border-purple-500/20", description: "Logrado en Recurvo 70m con 675+ puntos" },
  { level: 8, minScore: 700, name: "Estrella de Diamante", color: "#EC4899", iconColor: "text-pink-500", badgeClass: "bg-pink-500/10 text-pink-400 border-pink-500/20", description: "Logrado en Recurvo 70m con 700+ puntos" }
];

export const COMPOUND_STARS: StarDefinition[] = [
  { level: 1, minScore: 500, name: "Estrella de Bronce", color: "#CD7F32", iconColor: "text-amber-700", badgeClass: "bg-amber-900/20 text-amber-500 border-amber-800/30", description: "Logrado en Compuesto 50m con 500+ puntos" },
  { level: 2, minScore: 550, name: "Estrella de Plata", color: "#C0C0C0", iconColor: "text-slate-400", badgeClass: "bg-slate-800/30 text-slate-350 border-slate-700/30", description: "Logrado en Compuesto 50m con 550+ puntos" },
  { level: 3, minScore: 575, name: "Estrella de Oro", color: "#FFE500", iconColor: "text-yellow-gold", badgeClass: "bg-yellow-gold/10 text-yellow-gold border-yellow-gold/20", description: "Logrado en Compuesto 50m con 575+ puntos" },
  { level: 4, minScore: 600, name: "Estrella Azul", color: "#00BFFF", iconColor: "text-cyan-neon", badgeClass: "bg-cyan-neon/10 text-cyan-neon border-cyan-neon/20", description: "Logrado en Compuesto 50m con 600+ puntos" },
  { level: 5, minScore: 620, name: "Estrella Roja", color: "#FF0000", iconColor: "text-red-rival", badgeClass: "bg-red-rival/10 text-red-rival border-red-rival/20", description: "Logrado en Compuesto 50m con 620+ puntos" },
  { level: 6, minScore: 650, name: "Estrella de Oro y Negro", color: "#DAA520", iconColor: "text-amber-500", badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20", description: "Logrado en Compuesto 50m con 650+ puntos" },
  { level: 7, minScore: 675, name: "Estrella Púrpura", color: "#A855F7", iconColor: "text-purple-500", badgeClass: "bg-purple-550/10 text-purple-400 border-purple-500/20", description: "Logrado en Compuesto 50m con 675+ puntos" },
  { level: 8, minScore: 700, name: "Estrella de Diamante", color: "#EC4899", iconColor: "text-pink-500", badgeClass: "bg-pink-500/10 text-pink-400 border-pink-500/20", description: "Logrado en Compuesto 50m con 700+ puntos" }
];

export interface AthleteStarDoc {
  userId: string;
  userName: string;
  bowType: "Recurve" | "Compound" | "Barebow";
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
 * Evaluates a completed practice session and awards a World Archery Star if eligible.
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
    console.log(`[StarsManager] Session ${eventId} is not eligible. Total arrows: ${totalArrows}, bowType: ${bowType}, distance: ${distance}`);
    return null;
  }

  const starTiers = isRecurve70 ? RECURVE_STARS : COMPOUND_STARS;
  
  // Find highest star achieved in this session
  const achievedTiers = starTiers.filter(s => score >= s.minScore);
  if (achievedTiers.length === 0) {
    console.log(`[StarsManager] Score ${score} does not reach the minimum star threshold of 500.`);
    return null;
  }

  // Highest tier achieved in this session
  const sessionStar = achievedTiers[achievedTiers.length - 1];

  try {
    // 2. Fetch athlete's current highest star
    const currentDoc = await athleteStarsStore.getItem<AthleteStarDoc>(userId);
    const prevLevel = currentDoc ? currentDoc.highestStarLevel : 0;

    if (sessionStar.level > prevLevel) {
      // Awarding a higher star!
      const now = Date.now();
      const todayStr = new Date().toISOString().split("T")[0];

      const starDoc: AthleteStarDoc = {
        userId,
        userName,
        bowType: bowType as any,
        highestScore: score,
        highestStarLevel: sessionStar.level,
        starName: sessionStar.name,
        starColor: sessionStar.color,
        updatedAt: now
      };

      const historyId = generateResilientId("STR");
      const historyDoc: StarHistoryDoc = {
        id: historyId,
        userId,
        userName,
        bowType: bowType as any,
        score,
        starLevel: sessionStar.level,
        starName: sessionStar.name,
        starColor: sessionStar.color,
        date: todayStr,
        eventId,
        timestamp: now
      };

      // Save locally
      await athleteStarsStore.setItem(userId, starDoc);
      await starHistoryStore.setItem(historyId, historyDoc);

      // Queue for background synchronization to Firebase
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "athlete_stars",
        operation: "INSERT", // will behave as upsert in setDoc
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

      // Dispatch custom event to notify root pages (e.g. triggers confetti overlay)
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("star-unlocked", {
            detail: {
              userId,
              userName,
              score,
              star: sessionStar,
              bowType,
              distance
            }
          })
        );
      }

      console.log(`[StarsManager] NEW STAR UNLOCKED! Level: ${sessionStar.level} (${sessionStar.name}), score: ${score}`);
      return sessionStar;
    } else if (sessionStar.level === prevLevel && currentDoc && score > currentDoc.highestScore) {
      // Same star level, but higher score record
      const now = Date.now();
      const updatedDoc: AthleteStarDoc = {
        ...currentDoc,
        highestScore: score,
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

      console.log(`[StarsManager] Updated highest score for star level ${sessionStar.level} to ${score}`);
    }
  } catch (error) {
    console.error("[StarsManager] Error checking/awarding star:", error);
  }

  return null;
}
