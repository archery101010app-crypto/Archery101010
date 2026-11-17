import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isVolumeSession,
  countScoredArrows,
  getSessionArrows,
  getSessionScore,
  getSessionMaxScore,
  hasRealScore
} from "../src/lib/scoring/sessionMetrics.ts";

describe("Archery 101010 — Core Session Metrics & Volume Neutralization", () => {
  it("neutralizes points on pure Volume sessions so tally clicks never inflate score", () => {
    const volSession = {
      id: "SES-VOL-1",
      practiceType: "Volumen",
      isVolumeOnly: true,
      score: 720,
      maxScore: 720,
      totalArrowsVolume: 72,
      ends: [{ arrows: ["10", "10", "10"] }]
    };

    assert.equal(isVolumeSession(volSession), true);
    assert.equal(getSessionScore(volSession), 0);
    assert.equal(getSessionMaxScore(volSession), 0);
    assert.equal(hasRealScore(volSession), false);
    assert.equal(getSessionArrows(volSession), 72);
  });

  it("computes scored arrows, warmup arrows, and real points accurately on WA 720 rounds", () => {
    const waSession = {
      id: "SES-WA-720",
      practiceType: "Ronda WA",
      isVolumeOnly: false,
      score: 658,
      maxScore: 720,
      warmupArrows: 12,
      ends: [
        { arrows: ["X", "10", "9", "9", "8", "8"] },
        { arrows: ["10", "10", "9", "9", "9", "M"] }
      ]
    };

    assert.equal(isVolumeSession(waSession), false);
    assert.equal(countScoredArrows(waSession), 12);
    assert.equal(getSessionArrows(waSession), 24);
    assert.equal(getSessionScore(waSession), 658);
    assert.equal(getSessionMaxScore(waSession), 720);
    assert.equal(hasRealScore(waSession), true);
  });

  it("ignores empty arrow slots when counting scored arrows", () => {
    const partialSession = {
      id: "SES-PARTIAL",
      practiceType: "Libre",
      endsCount: 10,
      arrowsPerEnd: 3,
      ends: [
        { arrows: ["10", "9", ""] },
        { arrows: ["", "", ""] }
      ]
    };

    assert.equal(countScoredArrows(partialSession), 2);
    assert.equal(getSessionArrows(partialSession), 2);
  });
});

describe("Archery 101010 — World Archery Set System, Cumulative & Shoot-Off Rules", () => {
  function computeSetPoints(archerEndSum: number, rivalEndSum: number): [number, number] {
    if (archerEndSum > rivalEndSum) return [2, 0];
    if (archerEndSum < rivalEndSum) return [0, 2];
    return [1, 1];
  }

  function resolveShootOffWinner(
    aScore: number,
    bScore: number,
    aDistMm: number,
    bDistMm: number
  ): "A" | "B" | "TIE" {
    if (aScore > bScore) return "A";
    if (bScore > aScore) return "B";
    if (aDistMm < bDistMm) return "A";
    if (bDistMm < aDistMm) return "B";
    return "TIE";
  }

  it("awards 2-0 on end win and 1-1 on tied end in Recurve Set System", () => {
    assert.deepEqual(computeSetPoints(29, 28), [2, 0]);
    assert.deepEqual(computeSetPoints(27, 30), [0, 2]);
    assert.deepEqual(computeSetPoints(28, 28), [1, 1]);
  });

  it("resolves 5-5 / 145-145 shoot-off by higher ring first, then closest-to-spider distance", () => {
    assert.equal(resolveShootOffWinner(10, 9, 35, 12), "A");
    assert.equal(resolveShootOffWinner(10, 10, 14.2, 21.8), "A");
    assert.equal(resolveShootOffWinner(10, 10, 28.5, 9.4), "B");
  });
});

describe("Archery 101010 — Biometrics Telemetry & COPPA Age Gate Formulas", () => {
  function estimateSessionKcal(arrows: number, poundageLbs: number, walkedMeters: number): number {
    const kcalPerArrow = 0.56 + Math.max(15, poundageLbs) * 0.0165;
    const walkKcal = (Math.max(0, walkedMeters) / 1000) * 72 * 0.78;
    return Math.round(Math.max(0, arrows) * kcalPerArrow + walkKcal);
  }

  function computeExactAge(birthDateIso: string, refDateIso: string): number | null {
    const birth = new Date(`${birthDateIso}T00:00:00Z`);
    const ref = new Date(`${refDateIso}T00:00:00Z`);
    if (Number.isNaN(birth.getTime()) || birth.getTime() > ref.getTime()) return null;
    let age = ref.getUTCFullYear() - birth.getUTCFullYear();
    const mDiff = ref.getUTCMonth() - birth.getUTCMonth();
    if (mDiff < 0 || (mDiff === 0 && ref.getUTCDate() < birth.getUTCDate())) {
      age--;
    }
    return age;
  }

  it("computes realistic kcal combining bow poundage draw work and walked distance", () => {
    const kcal72 = estimateSessionKcal(72, 38, 1200);
    assert.ok(kcal72 >= 145 && kcal72 <= 165, `Expected ~154 kcal, got ${kcal72}`);
    assert.equal(estimateSessionKcal(0, 38, 0), 0);
  });

  it("enforces minimum age 13 (COPPA) and rejects future birth dates", () => {
    assert.equal(computeExactAge("2028-01-01", "2026-11-16"), null);
    assert.equal(computeExactAge("2015-06-10", "2026-11-16"), 11);
    assert.equal(computeExactAge("2013-11-16", "2026-11-16"), 13);
    assert.equal(computeExactAge("1998-04-20", "2026-11-16"), 28);
  });
});

describe("Archery 101010 — Cloud Scalability Guard (Zero Unbounded Collection Reads)", () => {
  it("never calls getDocs(collection(...)) or onSnapshot(collection(...)) without query/limit", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walk(full));
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    }

    const srcRoot = path.resolve(process.cwd(), "src");
    const offenders: string[] = [];
    const unboundedRegex = /\b(?:getDocs|onSnapshot)\(\s*collection\s*\(/;

    for (const file of walk(srcRoot)) {
      const content = fs.readFileSync(file, "utf8");
      if (unboundedRegex.test(content)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Found unbounded Firestore collection reads without limit() in: ${offenders.join(", ")}`
    );
  });
});

describe("Archery 101010 — Internationalization, Regional Units, RTL, Timezone & Decimal Guard", () => {
  it("parses European/LatAm decimal commas and converts Metric <-> Imperial accurately", async () => {
    const {
      parseLocaleDecimal,
      cmToFeetInches,
      feetInchesToCm,
      kgToLbs,
      lbsToKg,
      yardsToMeters,
      metersToYards,
      getMinimumConsentAge,
      isRtlLanguage,
      getSpeechLocale
    } = await import("../src/lib/i18n/regionalUtils.ts");

    assert.equal(parseLocaleDecimal("38,5"), 38.5);
    assert.equal(parseLocaleDecimal("38.5"), 38.5);
    assert.equal(parseLocaleDecimal("1.234,5"), 1234.5);
    assert.equal(parseLocaleDecimal("1,234.5"), 1234.5);

    const fi = cmToFeetInches(178);
    assert.equal(fi.feet, 5);
    assert.equal(fi.inches, 10);
    assert.equal(feetInchesToCm(5, 10), 178);

    assert.equal(lbsToKg(kgToLbs(75)), 75);
    assert.ok(Math.abs(yardsToMeters(20) - 18.29) <= 0.02);
    assert.ok(Math.abs(metersToYards(18.288) - 20) <= 0.1);

    assert.equal(getMinimumConsentAge("DE"), 16);
    assert.equal(getMinimumConsentAge("FR"), 16);
    assert.equal(getMinimumConsentAge("CZ"), 15);
    assert.equal(getMinimumConsentAge("KR"), 14);
    assert.equal(getMinimumConsentAge("ES"), 14);
    assert.equal(getMinimumConsentAge("US"), 13);
    assert.equal(getMinimumConsentAge("CR"), 13);

    assert.equal(isRtlLanguage("ar"), true);
    assert.equal(isRtlLanguage("iw"), true);
    assert.equal(isRtlLanguage("en"), false);
    assert.equal(getSpeechLocale("ko"), "ko-KR");
    assert.equal(getSpeechLocale("ja"), "ja-JP");
    assert.equal(getSpeechLocale("iw"), "he-IL");
  });

  it("never injects legacy translate.google.com DOM script or UTC .toISOString().split('T')[0] in src/", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walk(full));
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    }

    const srcRoot = path.resolve(process.cwd(), "src");
    const googleTranslateOffenders: string[] = [];
    const utcDateOffenders: string[] = [];

    for (const file of walk(srcRoot)) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("translate.google.com/translate_a/element.js")) {
        googleTranslateOffenders.push(path.relative(srcRoot, file));
      }
      if (/\.toISOString\(\)\.split\(\s*["']T["']\s*\)\[0\]/.test(content)) {
        utcDateOffenders.push(path.relative(srcRoot, file));
      }
    }

    assert.deepEqual(
      googleTranslateOffenders,
      [],
      `Found legacy Google Translate DOM widget in: ${googleTranslateOffenders.join(", ")}`
    );
    assert.deepEqual(
      utcDateOffenders,
      [],
      `Found UTC midnight bug (.toISOString().split('T')[0]) in: ${utcDateOffenders.join(", ")}`
    );
  });
});
