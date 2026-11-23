import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isVolumeSession,
  isAnalysisOnlySession,
  countScoredArrows,
  getSessionArrows,
  getSessionScore,
  getSessionMaxScore,
  hasRealScore
} from "../src/lib/scoring/sessionMetrics.ts";
import {
  analyzeImuShotWindow,
  evaluateNormalizedTargetImpact,
  encodeCompactShotAnalysis,
  decodeCompactShotAnalysis,
  computeAnalysisSessionSummary
} from "../src/lib/scoring/shotAnalysisEngine.ts";

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

describe("Archery 101010 — Extracted Matchplay Engine, Multilingual Importer & Repo Hygiene", () => {
  it("evaluates Recurve Set System (6 pts win, 5-5 shoot-off) and Compound Cumulative (15 arrows) accurately", async () => {
    const {
      evaluateMatchStanding,
      resolveWorldArcheryShootOff
    } = await import("../src/lib/scoring/matchplayScoring.ts");

    // 3 straight end wins -> 6-0 immediate victory in Recurve
    const recurveWin = evaluateMatchStanding(
      "Recurve",
      [
        ["10", "10", "9"],
        ["X", "10", "9"],
        ["10", "9", "9"]
      ],
      [
        ["9", "9", "9"],
        ["10", "9", "8"],
        ["9", "9", "8"]
      ]
    );
    assert.equal(recurveWin.isFinished, true);
    assert.equal(recurveWin.winner, "ARCHER");
    assert.equal(recurveWin.archerMatchScore, 6);
    assert.equal(recurveWin.rivalMatchScore, 0);

    // 5-5 after 5 ends -> triggers Shoot-Off
    const recurveTie = evaluateMatchStanding(
      "Recurve",
      [
        ["10", "10", "9"],
        ["9", "9", "8"],
        ["10", "9", "9"],
        ["9", "9", "9"],
        ["10", "10", "8"]
      ],
      [
        ["9", "9", "9"],
        ["10", "9", "9"],
        ["10", "9", "9"],
        ["9", "9", "9"],
        ["10", "10", "8"]
      ]
    );
    assert.equal(recurveTie.archerMatchScore, 5);
    assert.equal(recurveTie.rivalMatchScore, 5);
    assert.equal(recurveTie.needsShootOff, true);

    // Compound 5 ends cumulative
    const compoundTie = evaluateMatchStanding(
      "Compound",
      [
        ["X", "10", "9"],
        ["10", "10", "9"],
        ["10", "10", "10"],
        ["10", "9", "9"],
        ["X", "10", "9"]
      ],
      [
        ["10", "10", "9"],
        ["10", "10", "9"],
        ["10", "10", "10"],
        ["10", "9", "9"],
        ["10", "10", "9"]
      ]
    );
    assert.equal(compoundTie.archerMatchScore, 145);
    assert.equal(compoundTie.rivalMatchScore, 145);
    assert.equal(compoundTie.needsShootOff, true);

    // Compound X beats 10 when compoundXWinsOverTen is enabled
    assert.equal(resolveWorldArcheryShootOff("X", "10", 18.0, 6.0, true), "ARCHER");
    assert.equal(resolveWorldArcheryShootOff("10", "10", 11.2, 14.5, false), "ARCHER");
  });

  it("recognizes multilingual months (ES/EN/PT/FR/DE/IT/KO/JA) and Excel serial dates in cycleImporter", async () => {
    const {
      MULTILINGUAL_MONTHS,
      excelSerialToYMD,
      extractDayOfMonthNumber
    } = await import("../src/lib/cycleImporter.ts");

    assert.equal(MULTILINGUAL_MONTHS["enero"], "01");
    assert.equal(MULTILINGUAL_MONTHS["fevereiro"], "02");
    assert.equal(MULTILINGUAL_MONTHS["février"], "02");
    assert.equal(MULTILINGUAL_MONTHS["märz"], "03");
    assert.equal(MULTILINGUAL_MONTHS["maggio"], "05");
    assert.equal(MULTILINGUAL_MONTHS["10월"], "10");
    assert.equal(MULTILINGUAL_MONTHS["12月"], "12");

    assert.equal(extractDayOfMonthNumber("Lunes 15"), 15);
    assert.equal(extractDayOfMonthNumber("Day 22"), 22);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(excelSerialToYMD(46000) || ""));
  });

  it("wires Cloud Functions in firebase.json and drops legacy devMode translation keys", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fbJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "firebase.json"), "utf8")
    );
    assert.ok(Array.isArray(fbJson.functions) && fbJson.functions.length > 0, "functions block missing in firebase.json");

    const { translations } = await import("../src/lib/translations/dict.ts");
    assert.equal("devMode" in translations.es, false);
    assert.equal("devMode" in translations.en, false);
  });

  it("evaluates Coach PRO subscription expiry math accurately and lazy-loads xlsx", async () => {
    const { computeProRemainingDays, isCoachProActive } = await import("../src/lib/billingService.ts");
    const now = 1_800_000_000_000;
    const tenDaysLater = now + 10 * 24 * 60 * 60 * 1000;

    assert.equal(computeProRemainingDays(tenDaysLater, now), 10);
    assert.equal(computeProRemainingDays(now - 1000, now), 0);
    assert.equal(isCoachProActive({ role: "coach", plan: "PRO", proExpiresAt: tenDaysLater } as any, now), true);
    assert.equal(isCoachProActive({ role: "coach", plan: "PRO", proExpiresAt: now - 5000 } as any, now), false);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const importerSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/cycleImporter.ts"), "utf8");
    assert.equal(/^import\s+\*\s+as\s+XLSX\s+from\s+["']xlsx["']/m.test(importerSrc), false);
  });

  it("keeps Service Worker and OTA updater free of navigate-RequestInit TypeErrors and external browser jumps", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { APP_VERSION } = await import("../src/lib/version.ts");

    const swSrc = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8");
    assert.equal(
      /fetch\(\s*event\.request\s*,\s*\{/.test(swSrc),
      false,
      "sw.js must never pass a navigate Request object alongside non-empty RequestInit"
    );
    assert.ok(
      swSrc.includes(`archery-101010-cache-v${APP_VERSION}`),
      "sw.js CACHE_NAME must match APP_VERSION"
    );

    const bannerSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/ui/AppUpdateBanner.tsx"),
      "utf8"
    );
    assert.equal(bannerSrc.includes("exitApp("), false, "AppUpdateBanner must not rely on exitApp on remote OTA origins");
    assert.equal(bannerSrc.includes("window.open("), false, "AppUpdateBanner must never open external browser tabs");
    assert.equal(
      /location\.(replace|assign|href\s*=)/.test(bannerSrc),
      false,
      "AppUpdateBanner must never mutate window.location URL (triggers Capacitor shouldOverrideUrlLoading -> Chrome in legacy APKs)"
    );
    assert.equal(
      bannerSrc.includes("fixed inset-0"),
      false,
      "AppUpdateBanner must never render a full-screen blocking modal that can freeze app startup"
    );
    assert.ok(
      bannerSrc.includes("window.location.reload()"),
      "AppUpdateBanner must use in-place window.location.reload() so Google Play, App Store & Web shells stay 100% in-app"
    );
    assert.equal(
      bannerSrc.includes("!canReloadNatively"),
      false,
      "AppUpdateBanner must NEVER hide or block the update popup on Google Play v2.100 or App Store shells"
    );
    assert.ok(
      bannerSrc.includes('"/ota-version.json"'),
      "AppUpdateBanner must read /ota-version.json"
    );

    const otaVerJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/ota-version.json"), "utf8"));
    const verJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/version.json"), "utf8"));
    const appVerJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/app-version.json"), "utf8"));
    assert.equal(otaVerJson.version, APP_VERSION, "ota-version.json must match APP_VERSION");
    assert.equal(
      verJson.version,
      "0.0.0",
      "Legacy public/version.json must stay 0.0.0 so old v2.100 shells never freeze or redirect to Chrome"
    );
    assert.equal(
      appVerJson.version,
      "0.0.0",
      "Legacy public/app-version.json must stay 0.0.0 so old v2.100 shells never freeze or redirect to Chrome"
    );
    assert.equal(verJson.latestVersion, APP_VERSION);
  });

  it("extracts adaptive smartwatch heart rate stats cleanly without empty placeholders when absent", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { getSessionHeartRateStats } = await import("../src/lib/scoring/sessionMetrics.ts");

    assert.deepEqual(getSessionHeartRateStats(null), {});
    assert.deepEqual(getSessionHeartRateStats({ score: 342 }), {});
    assert.deepEqual(getSessionHeartRateStats({ avgHeartRateBpm: 0 }), {});
    assert.deepEqual(
      getSessionHeartRateStats({ biometrics: { avgHeartRateBpm: 114, maxHeartRateBpm: 131 } }),
      { avgHeartRateBpm: 114, maxHeartRateBpm: 131 }
    );

    const cardGenSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/targetImageGenerator.ts"),
      "utf8"
    );
    assert.ok(cardGenSrc.includes('es: "PULSACIONES"'), "Shareable card must use PULSACIONES in Spanish");
    assert.ok(
      cardGenSrc.includes("const brandTopY = hasHeartRate ? 1290 : 1343;"),
      "Shareable card must shift layout only when heart rate exists"
    );

    const shareModalSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/scoring/StravaShareModal.tsx"),
      "utf8"
    );
    assert.equal(
      shareModalSrc.includes('"transparent"'),
      false,
      "StravaShareModal must not offer the removed Transparent mode"
    );
  });

  it("records 0 meters when seated/tapping or under indoor GPS jitter, and real meters on continuous walking", async () => {
    const {
      createGaitDetectorState,
      createGpsAnchorState,
      notifyScreenInteraction,
      processAccelerometerSample,
      processGpsCoordinateFix
    } = await import("../src/lib/scoring/walkingTracker.ts");

    // 1. Seated test: 40 finger taps + hand tilts while scoring arrows -> MUST equal 0 steps
    const seatedState = createGaitDetectorState(0);
    let t = 1_000_000;
    for (let tap = 0; tap < 40; tap++) {
      notifyScreenInteraction(seatedState, t);
      processAccelerometerSample(seatedState, 0.5, 1.2, 11.4, t + 18); // tap jolt
      processAccelerometerSample(seatedState, -0.3, 0.8, 9.5, t + 40);
      // Even 2.5s later, an isolated chair shift / hand tilt (1-2 impulses) must NOT count
      processAccelerometerSample(seatedState, 1.4, 2.1, 12.2, t + 2600);
      processAccelerometerSample(seatedState, 0.1, 0.4, 8.2, t + 2800);
      t += 3500;
    }
    assert.equal(seatedState.creditedSteps, 0, "Seated taps and tilts must yield 0 steps");

    // 2. Indoor GPS jitter: accuracy 24m bouncing 12m back and forth -> MUST equal 0m
    const indoorGps = createGpsAnchorState(0);
    processGpsCoordinateFix(indoorGps, 9.935, -84.091, 24, 1000);
    processGpsCoordinateFix(indoorGps, 9.93511, -84.091, 24, 6000);
    processGpsCoordinateFix(indoorGps, 9.93499, -84.091, 10, 45000); // slow <0.55 m/s drift
    assert.equal(indoorGps.accumulatedMeters, 0, "Indoor coarse GPS and slow stationary drift must yield 0m");

    // 3. Real downrange walk: 20 rhythmic sinusoidal footsteps at 560ms cadence -> MUST count real steps
    const walkState = createGaitDetectorState(0);
    let wt = 2_000_000;
    for (let step = 0; step < 20; step++) {
      // Simulate 560ms sinusoidal walking wave sampled every 20ms (28 samples per step)
      for (let s = 0; s < 28; s++) {
        const phase = (s / 28) * Math.PI * 2;
        const az = 9.81 + Math.sin(phase) * 3.4;
        processAccelerometerSample(walkState, 0, 0, az, wt + s * 20);
      }
      wt += 560;
    }
    assert.ok(walkState.creditedSteps >= 18 && walkState.creditedSteps <= 21, `Expected ~20 real steps, got ${walkState.creditedSteps}`);
  });

  it("keeps height and weight exclusively inside Personal Data and never inside Bow Configuration", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const profileSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/profile/ProfileView.tsx"),
      "utf8"
    );

    const personalIdx = profileSrc.indexOf("SECTION 1: Personal Data");
    const bowIdx = profileSrc.indexOf("SECTION 2: Bow configuration");
    const notifIdx = profileSrc.indexOf("SECTION 4: Preferences Notifications");
    assert.ok(personalIdx > 0 && bowIdx > personalIdx && notifIdx > bowIdx);

    const personalSection = profileSrc.slice(personalIdx, bowIdx);
    const bowSection = profileSrc.slice(bowIdx, notifIdx);

    assert.ok(
      personalSection.includes("renderBiometricEditInputs()"),
      "Personal Data section must include height and weight edit inputs"
    );
    assert.equal(
      bowSection.includes("renderBiometricEditInputs()"),
      false,
      "Bow Configuration section must NEVER display height or weight inputs"
    );
    assert.equal(
      bowSection.includes('t("height")') || bowSection.includes('t("weight")'),
      false,
      "Bow Configuration section must not reference height or weight labels"
    );
  });

  it("shields React Fiber removeChild and insertBefore from browser auto-translate <font> DOM mutations", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { applyDomMutationPatch } = await import("../src/lib/domMutationGuard.ts");

    class MockNode {
      nodeName: string;
      parentNode: MockNode | null = null;
      childNodes: MockNode[] = [];
      constructor(nodeName: string) {
        this.nodeName = nodeName;
      }
      appendChild<T extends MockNode>(child: T): T {
        if (child.parentNode) {
          child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
      }
      removeChild<T extends MockNode>(child: T): T {
        const idx = this.childNodes.indexOf(child);
        if (idx === -1 || child.parentNode !== this) {
          const err = new Error(
            "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
          );
          err.name = "NotFoundError";
          throw err;
        }
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
        return child;
      }
      insertBefore<T extends MockNode>(newNode: T, refNode: MockNode | null): T {
        if (refNode === null) {
          return this.appendChild(newNode);
        }
        const idx = this.childNodes.indexOf(refNode);
        if (idx === -1 || refNode.parentNode !== this) {
          const err = new Error(
            "NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."
          );
          err.name = "NotFoundError";
          throw err;
        }
        if (newNode.parentNode) {
          newNode.parentNode.removeChild(newNode);
        }
        newNode.parentNode = this;
        this.childNodes.splice(idx, 0, newNode);
        return newNode;
      }
    }

    applyDomMutationPatch(MockNode.prototype as any);

    // Simulate Chrome / Google Translate wrapping a React text node in <font><font>text</font></font>
    const div = new MockNode("DIV");
    const outerFont = new MockNode("FONT");
    const innerFont = new MockNode("FONT");
    const reactText = new MockNode("#text");
    const trailingSpan = new MockNode("SPAN");

    div.appendChild(outerFont);
    outerFont.appendChild(innerFont);
    innerFont.appendChild(reactText);
    div.appendChild(trailingSpan);

    // 1. React calls div.insertBefore(badge, reactText) while reactText is trapped inside <font>
    const badge = new MockNode("SPAN");
    div.insertBefore(badge, reactText);
    assert.deepEqual(
      div.childNodes,
      [badge, outerFont, trailingSpan],
      "insertBefore must locate the outer <font> wrapper and insert right before it without throwing"
    );

    // 2. React calls div.removeChild(reactText) -> must remove reactText AND prune empty <font> wrappers
    const removed = div.removeChild(reactText);
    assert.equal(removed, reactText);
    assert.equal(reactText.parentNode, null);
    assert.deepEqual(
      div.childNodes,
      [badge, trailingSpan],
      "removeChild must remove the reparented node and clean up empty <font> wrappers"
    );

    // 3. Removing an already-detached node must be a safe no-op rather than throwing NotFoundError
    const detached = new MockNode("#text");
    assert.equal(div.removeChild(detached), detached);

    // 4. Verify RootLayout enforces translate="no", notranslate, google: "notranslate", and inline pre-hydration script
    const layoutSrc = fs.readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    assert.ok(layoutSrc.includes('translate="no"'), 'RootLayout must set translate="no"');
    assert.ok(layoutSrc.includes("notranslate"), "RootLayout must include notranslate class");
    assert.ok(layoutSrc.includes('google: "notranslate"'), "RootLayout metadata must block Google auto-translate");
    assert.ok(layoutSrc.includes("DOM_MUTATION_GUARD_INLINE_SCRIPT"), "RootLayout must inject pre-hydration DOM guard");
  });

  it("parses standard BLE Heart Rate 0x2A37 packets accurately and enforces zero third-party brand names in UI", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const {
      parseHeartRateMeasurement,
      BleHeartRateSessionTracker
    } = await import("../src/lib/scoring/bleHeartRateService.ts");

    // 1. UINT8 BPM + Sensor Contact Detected (flags = 0x06 -> bit0=0, bits1..2=3) + RR-Interval (flags |= 0x10 -> 0x16)
    // RR = 820 / 1024s = 800.78ms -> 801ms (820 = 0x0334 -> LE [0x34, 0x03])
    const pktUint8 = parseHeartRateMeasurement(new Uint8Array([0x16, 114, 0x34, 0x03]));
    assert.ok(pktUint8);
    assert.equal(pktUint8.bpm, 114);
    assert.equal(pktUint8.isUint16, false);
    assert.equal(pktUint8.contactDetected, true);
    assert.equal(pktUint8.validPhysiological, true);
    assert.deepEqual(pktUint8.rrIntervalsMs, [801]);

    // 2. UINT16 Little-Endian BPM (flags = 0x01) -> 182 BPM ([0xB6, 0x00])
    const pktUint16 = parseHeartRateMeasurement(new Uint8Array([0x01, 0xb6, 0x00]));
    assert.ok(pktUint16);
    assert.equal(pktUint16.bpm, 182);
    assert.equal(pktUint16.isUint16, true);
    assert.equal(pktUint16.validPhysiological, true);

    // 3. Sensor off-skin (contact bits = 2 -> flags = 0x04) or 0 BPM -> must mark validPhysiological = false
    const pktOffSkin = parseHeartRateMeasurement(new Uint8Array([0x04, 95]));
    assert.ok(pktOffSkin);
    assert.equal(pktOffSkin.contactDetected, false);
    assert.equal(pktOffSkin.validPhysiological, false);

    // 4. Session tracker computes accurate rolling average and peak while rejecting off-skin / out-of-range noise
    const tracker = new BleHeartRateSessionTracker();
    assert.equal(tracker.recordSample(0, null, 1000), false);
    assert.equal(tracker.recordSample(110, false, 1500), false);
    assert.equal(tracker.recordSample(108, true, 2000), true);
    assert.equal(tracker.recordSample(114, true, 3000), true);
    assert.equal(tracker.recordSample(126, true, 4000), true);
    const snap = tracker.getSnapshot();
    assert.equal(snap.currentBpm, 126);
    assert.equal(snap.avgHeartRateBpm, 116); // (108 + 114 + 126) / 3 = 116
    assert.equal(snap.maxHeartRateBpm, 126);

    // 5. Verify zero third-party brand names in BleHeartRateModal.tsx and bleHeartRateService.ts
    const modalSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/watch/BleHeartRateModal.tsx"),
      "utf8"
    );
    const serviceSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/bleHeartRateService.ts"),
      "utf8"
    );
    const forbiddenBrands = /\b(whoop|polar|garmin|wahoo|coros|strava|apple watch|fitbit|suunto)\b/i;
    assert.equal(
      forbiddenBrands.test(modalSrc),
      false,
      "BleHeartRateModal.tsx must NEVER contain third-party brand names"
    );
    assert.equal(
      forbiddenBrands.test(serviceSrc),
      false,
      "bleHeartRateService.ts must NEVER contain third-party brand names"
    );
  });

  it("reconstructs Preparatory + Aiming biomechanics, encodes compact watch payloads, and isolates Análisis from competitive scores", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    // 1. Build a realistic 6.0s wrist IMU stream (1.8s preparatory lift -> 4.2s steady aiming hold -> release)
    const releaseTs = 100_000;
    const samples = [];
    for (let ms = -6000; ms <= -20; ms += 25) {
      const t = releaseTs + ms;
      const inPrep = ms < -4200;
      const prog = inPrep ? (ms + 6000) / 1800 : 1;
      const ay = inPrep ? (1 - prog) * -1.35 : Math.sin(ms * 0.012) * 0.05;
      const az = 9.75 + (inPrep ? (1 - prog) * 1.15 : Math.cos(ms * 0.015) * 0.04);
      const ax = 0.35;
      const gy = inPrep ? -0.18 * (1 - prog) : Math.cos(ms * 0.02) * 0.012;
      const gz = inPrep ? 0.22 * (1 - prog) : Math.sin(ms * 0.02) * 0.012;
      samples.push({ t, ax, ay, az, gx: 0, gy, gz });
    }

    const shot = analyzeImuShotWindow({
      samples,
      releaseTimestampMs: releaseTs,
      shotNumber: 1,
      distanceM: 18,
      bowType: "Barebow",
      bowWrist: "LEFT",
      heartRateBpm: 114
    });

    assert.ok(shot, "analyzeImuShotWindow must return a valid shot record");
    assert.equal(shot.shotNumber, 1);
    assert.equal(shot.heartRateBpm, 114);
    assert.ok(shot.prepSeconds >= 0.8 && shot.prepSeconds <= 3.5);
    assert.ok(shot.aimSeconds >= 2.5 && shot.aimSeconds <= 5.5);
    assert.ok(shot.stabilityPct >= 75 && shot.stabilityPct <= 100);
    assert.ok(shot.prepPoints.length >= 2);
    assert.ok(shot.aimPoints.length >= 2);

    // 2. Evaluate target impact rings & compact watch wire encoding (< 1.5 KB)
    const xImpact = evaluateNormalizedTargetImpact(0.02, -0.02);
    assert.equal(xImpact.ringNumber, 10);
    assert.equal(xImpact.scoreLabel, "10 · X");

    const redImpact = evaluateNormalizedTargetImpact(0.34, 0);
    assert.equal(redImpact.ringNumber, 7);

    const encoded = encodeCompactShotAnalysis(shot);
    assert.ok(encoded.length > 40 && encoded.length < 1500);
    const decoded = decodeCompactShotAnalysis(encoded);
    assert.ok(decoded);
    assert.equal(decoded.shotNumber, 1);
    assert.equal(decoded.heartRateBpm, 114);
    assert.equal(decoded.stabilityPct, shot.stabilityPct);

    const summary = computeAnalysisSessionSummary([shot]);
    assert.equal(summary.shotsCount, 1);
    assert.equal(summary.avgHeartRateBpm, 114);

    // 3. Ensure Análisis sessions never pollute competitive scores while counting arrow volume
    const analysisSession = {
      id: "SES-ANA-1",
      practiceType: "Análisis",
      isAnalysisSession: true,
      score: 0,
      maxScore: 0,
      totalArrowsVolume: 12,
      biometrics: { isAnalysisSession: true, analysisShots: [shot] }
    };
    assert.equal(isAnalysisOnlySession(analysisSession), true);
    assert.equal(hasRealScore(analysisSession), false);
    assert.equal(getSessionArrows(analysisSession), 12);

    // 4. Brand hygiene across all Análisis files
    const forbiddenBrands = /\b(whoop|polar|garmin|wahoo|coros|strava|apple watch|fitbit|suunto)\b/i;
    for (const rel of [
      "src/lib/scoring/shotAnalysisEngine.ts",
      "src/components/analysis/AnalysisDianaSvg.tsx",
      "src/components/analysis/AnalysisCalibrationModal.tsx",
      "src/components/analysis/AnalysisInspectorShared.tsx",
      "src/components/analysis/AnalysisView.tsx"
    ]) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      assert.equal(forbiddenBrands.test(content), false, `${rel} must never mention third-party brands`);
    }
  });

  it("keeps users 100% inside the app (zero APK/web exits), resets off-skin BLE BPM, and enforces Coach/Brand invariants", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { APP_VERSION } = await import("../src/lib/version.ts");
    const { BleHeartRateSessionTracker } = await import("../src/lib/scoring/bleHeartRateService.ts");

    // 1. Neither BleHeartRateModal nor AppUpdateBanner may contain APK jargon, /download-apk, or external target="_blank" exits
    for (const rel of [
      "src/components/watch/BleHeartRateModal.tsx",
      "src/components/ui/AppUpdateBanner.tsx"
    ]) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      assert.equal(
        /download-apk|\bAPK\b|target="_blank"/i.test(src),
        false,
        `${rel} must keep the user 100% inside the app with zero APK jargon or external web links`
      );
    }
    const otaParsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "public/ota-version.json"), "utf8")
    ) as { version?: string };
    assert.equal(otaParsed.version, APP_VERSION);

    // 2. Off-skin BLE heart rate packet must immediately clear currentBpm while preserving session avg/max
    const tracker = new BleHeartRateSessionTracker();
    assert.equal(tracker.recordSample(118, true, 1000), true);
    assert.equal(tracker.getSnapshot().currentBpm, 118);
    assert.equal(tracker.recordSample(92, false, 2000), false);
    assert.equal(
      tracker.getSnapshot().currentBpm,
      0,
      "Off-skin contactDetected=false must clear live currentBpm to 0"
    );
    assert.equal(tracker.getSnapshot().avgHeartRateBpm, 118);

    // 3. Firestore rules must support list/string coach notes and athlete read access to their own coach notes
    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    assert.ok(rulesSrc.includes("notesVal is list"), "firestore.rules must permit notes array on coach_records");
    assert.ok(
      rulesSrc.includes("resource.data.get('athleteUid', '') == request.auth.uid"),
      "firestore.rules must allow athletes to read their own coach technical notes"
    );
    assert.ok(
      rulesSrc.includes("isCoachOfAthlete(resource.data.userId)"),
      "firestore.rules must allow coaches to update linked athlete sessions"
    );

    // 4. Zero third-party bow brand defaults in authService.ts + unified Outfit font-sans in globals.css
    const authSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/authService.ts"), "utf8");
    assert.equal(
      /\b(Hoyt|Satori)\b/i.test(authSrc),
      false,
      "authService.ts must not inject third-party bow brand defaults"
    );
    const globalsCss = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    assert.ok(
      globalsCss.includes("--font-sans: 'Outfit', sans-serif;"),
      "globals.css @theme must map --font-sans to Outfit across the entire app"
    );
  });

  it("enforces v2.138 full-audit fixes: WA division target radii, BLE staleness/weighting, draft tombstone clearing, and hardened Firestore rules", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { getTargetFaceRadiusCm } = await import("../src/lib/scoring/shotAnalysisEngine.ts");
    const { BleHeartRateSessionTracker } = await import("../src/lib/scoring/bleHeartRateService.ts");

    // 1. World Archery target face radii by distance & bow division
    assert.equal(getTargetFaceRadiusCm(18, "Recurve"), 20);
    assert.equal(getTargetFaceRadiusCm(25, "Barebow"), 30);
    assert.equal(getTargetFaceRadiusCm(50, "Compound"), 40);
    assert.equal(getTargetFaceRadiusCm(50, "Recurve"), 61);
    assert.equal(getTargetFaceRadiusCm(50, "Barebow"), 61);
    assert.equal(getTargetFaceRadiusCm(70, "Recurve"), 61);

    // 2. BLE stale-sample expiration (>12s), invalid out-of-range BPM reset, and weighted draft resume
    const hr = new BleHeartRateSessionTracker();
    hr.resetSessionStats(110, 125, 20);
    assert.equal(hr.recordSample(131, true, 10_000), true);
    // Weighted average: (110 * 20 + 131) / 21 = 2331 / 21 = 111 (not 121!)
    assert.equal(hr.getSnapshot(11_000).avgHeartRateBpm, 111);
    assert.equal(hr.getSnapshot(11_000).currentBpm, 131);
    // Stale > 12s clears live reading while preserving session avg/max
    assert.equal(hr.getSnapshot(23_000).currentBpm, 0);
    assert.equal(hr.getSnapshot(23_000).avgHeartRateBpm, 111);
    assert.equal(hr.getSnapshot(23_000).maxHeartRateBpm, 131);
    // Out-of-range physiological noise (<30 BPM) clears currentBpm immediately
    assert.equal(hr.recordSample(122, true, 24_000), true);
    assert.equal(hr.getSnapshot(24_500).currentBpm, 122);
    assert.equal(hr.recordSample(14, true, 25_000), false);
    assert.equal(hr.getSnapshot(25_500).currentBpm, 0);

    // 3. Structural checks for tombstones, watchHeartbeatAt liveness, and Firestore security rules
    const idbSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/db/indexedDB.ts"), "utf8");
    assert.ok(
      idbSrc.includes("clearSessionTombstone"),
      "saveLocalSession must clear session tombstones so active drafts are never resurrected-deleted"
    );

    const bioSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/biometricsEngine.ts"),
      "utf8"
    );
    assert.ok(
      bioSrc.includes("watchHeartbeatAt"),
      "biometricsEngine.ts must track genuine watch liveness via watchHeartbeatAt"
    );

    const authSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/authService.ts"), "utf8");
    assert.ok(
      authSrc.includes('"users_public"'),
      "findClubOwnerByInviteCode must query PII-free users_public first"
    );

    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    assert.ok(rulesSrc.includes("'clubLogo'"), "Coach unlink whitelist must include clubLogo");
    assert.ok(
      rulesSrc.includes("isAuthorizedCoachRecordTarget"),
      "coach_records must verify coach-athlete link on create/update"
    );
    assert.ok(
      rulesSrc.includes("isAuthorizedForTargetClub"),
      "calendar_events and macrocycles must verify club membership on create/update"
    );
    assert.ok(
      rulesSrc.includes("'watchHeartbeatAt'"),
      "watch_sessions rules must permit watchHeartbeatAt"
    );
  });

  it("enforces v2.139 multilingual visual, RTL, and zero-Spanish-regression invariants across all 13 languages", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { translations, offlineFallbackTranslations } = await import(
      "../src/lib/translations/dict.ts"
    );

    // 1. Spanish dictionary must remain 100% intact (239 keys) and Italian/Japanese/German fixes must hold
    assert.equal(Object.keys(translations.es).length, 239);
    assert.equal(translations.es.navSession, "Sesión");
    assert.equal(translations.es.practiceControl, "Puntuación");
    assert.equal(offlineFallbackTranslations.it?.shareScorecardMessaging, "Condividi Tabellino");
    assert.equal(offlineFallbackTranslations.ja?.navProfile, "プロフィール");
    assert.equal(offlineFallbackTranslations.de?.dominantEye, "Dominantes Auge");

    // 2. Compact selector labels across non-Spanish languages must have zero parenthetical bloat
    for (const lang of ["fr", "de", "it", "ru", "cs", "ar"] as const) {
      const dict = offlineFallbackTranslations[lang] || {};
      for (const key of [
        "bowRecurve",
        "bowCompound",
        "bowBarebow",
        "practiceControl",
        "practicePractice",
        "practiceVolume"
      ] as const) {
        const val = dict[key] || translations.en[key] || "";
        assert.ok(
          val.length > 0 && !val.includes("("),
          `${lang}.${key} ("${val}") must not contain parenthetical bloat`
        );
      }
    }

    // 3. globals.css must scope multi-script font fallback & text-wrap strictly to non-Spanish / RTL
    const globalsCss = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
    assert.ok(globalsCss.includes('html:not([lang="es"])'), "globals.css must scope multi-script rules to html:not([lang=\"es\"])");
    assert.ok(globalsCss.includes('html[dir="rtl"]'), "globals.css must reset cursive letter-spacing under html[dir=\"rtl\"]");

    // 4. Official ARCHERY 101010 lockups must enforce dir="ltr" so RTL never reverses brand geometry
    for (const rel of [
      "src/components/ui/Header.tsx",
      "src/components/auth/LoginView.tsx",
      "src/components/dashboard/DashboardView.tsx"
    ]) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      assert.ok(src.includes('dir="ltr"'), `${rel} must protect brand/code lockups with dir="ltr"`);
    }
  });

  it("enforces v2.141 profile persistence: non-destructive cloud merge, presence ping isolation, and wide country rule", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    assert.ok(
      rulesSrc.includes("validOptionalString(data, 'country', 0, 100)"),
      "firestore.rules must permit full country names up to 100 chars so profile writes never fail"
    );

    const pageSrc = fs.readFileSync(path.resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.ok(
      pageSrc.includes("mergeUserProfilesNonDestructive"),
      "page.tsx startup reconciliation must use non-destructive profile merge"
    );
    assert.equal(
      /updateDoc\(doc\(db,\s*"users",\s*uid\),\s*\{\s*lastActiveAt:\s*now,\s*updatedAt:\s*now/.test(pageSrc),
      false,
      "bootstrapSessionPresence must NEVER bump updatedAt on users/{uid} presence pings"
    );

    const authSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/authService.ts"), "utf8");
    assert.ok(
      authSrc.includes("await cloudWriteUser("),
      "updateProfile must await cloudWriteUser before returning"
    );

    const bannerSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/ui/AppUpdateBanner.tsx"),
      "utf8"
    );
    assert.ok(
      bannerSrc.includes("runSync"),
      "AppUpdateBanner must flush pending profile sync queue before OTA reload"
    );
  });

  it("enforces v2.143 normal-account profile persistence: owner self-service rule, custom alias/bow/biometrics priority & logout isolation", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { mergeUserProfilesNonDestructive, buildOwnerSelfServiceProfilePatch } = await import(
      "../src/lib/profileMerge.ts"
    );

    // 1. Firestore rules must expose dedicated owner self-service profile & bow validator
    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    assert.ok(
      rulesSrc.includes("function isValidOwnerProfileFieldsUpdate(data)"),
      "firestore.rules must define isValidOwnerProfileFieldsUpdate for normal accounts"
    );
    assert.ok(
      rulesSrc.includes("(isOwner(userId) && isValidOwnerProfileFieldsUpdate(request.resource.data))"),
      "match /users/{userId} allow update must authorize owner personal & bow patches independently of club/PRO rules"
    );

    // 2. buildOwnerSelfServiceProfilePatch must strip role, plan, proExpiresAt, clubId, coachId, clubInviteCode
    const patch = buildOwnerSelfServiceProfilePatch({
      uid: "u-norm-1",
      email: "archer@example.com",
      role: "archer",
      plan: "PRO",
      proExpiresAt: 9999999999999,
      clubId: "CLB-STALE",
      coachId: "c-1",
      clubInviteCode: "123456",
      nickname: "HalconDorado",
      physicalData: { height: 178, weight: 76, dominantHand: "R", dominantEye: "R" },
      bowConfig: { type: "Compound", brand: "Custom", model: "X1", poundage: 58, drawLength: 28.5 },
      updatedAt: 5000
    });
    assert.equal("role" in patch, false);
    assert.equal("plan" in patch, false);
    assert.equal("proExpiresAt" in patch, false);
    assert.equal("clubId" in patch, false);
    assert.equal("coachId" in patch, false);
    assert.equal("clubInviteCode" in patch, false);
    assert.equal(patch.nickname, "HalconDorado");
    assert.equal(patch.physicalData.height, 178);
    assert.equal(patch.physicalData.weight, 76);
    assert.equal(patch.bowConfig.poundage, 58);

    // 3. mergeUserProfilesNonDestructive must preserve custom alias, bow, height & weight over initial auto-nickname & empty cloud doc
    const localSaved = {
      uid: "u-norm-1",
      email: "juanperez@gmail.com",
      fullName: "Juan Perez",
      nickname: "ElTico10",
      birthDate: "1992-08-14",
      country: "CR",
      city: "Heredia",
      gender: "M",
      role: "archer" as const,
      plan: "FREE" as const,
      isClubCreator: false,
      clubId: null,
      clubName: null,
      physicalData: { height: 181, weight: 82.5, dominantHand: "R" as const, dominantEye: "R" as const },
      bowConfig: { type: "Compound" as const, brand: "Pro", model: "Target", poundage: 59, drawLength: 29 },
      bows: [{ id: "BOW-1", type: "Compound" as const, brand: "Pro", model: "Target", poundage: 59, drawLength: 29 }],
      updatedAt: 2000
    };
    const staleCloud = {
      uid: "u-norm-1",
      email: "juanperez@gmail.com",
      fullName: "Juan Perez",
      nickname: "juanperez", // initial autoNickname!
      birthDate: "1992-08-14",
      country: "CR",
      city: "Heredia",
      gender: "M",
      role: "archer" as const,
      plan: "FREE" as const,
      isClubCreator: false,
      clubId: null,
      clubName: null,
      physicalData: { height: 0, weight: 0, dominantHand: "R" as const, dominantEye: "R" as const },
      bowConfig: { type: "Recurve" as const, brand: "", model: "", poundage: 0, defaultDistance: 18 },
      updatedAt: 3000 // even if logout previously bumped updatedAt!
    };
    const { merged, localHadMissingCloudFields } = mergeUserProfilesNonDestructive(localSaved, staleCloud);
    assert.equal(localHadMissingCloudFields, true);
    assert.equal(merged.nickname, "ElTico10", "Custom alias must never be overwritten by initial autoNickname");
    assert.equal(merged.physicalData?.height, 181, "Saved height must never be wiped by 0");
    assert.equal(merged.physicalData?.weight, 82.5, "Saved weight must never be wiped by 0");
    assert.equal(merged.bowConfig?.type, "Compound", "Saved bow type must never be wiped by initial blank bow");
    assert.equal(merged.bowConfig?.poundage, 59, "Saved bow poundage must never be wiped");
    assert.equal(merged.bows?.length, 1);

    // 4. Logout in page.tsx must NEVER bump updatedAt on users/{outgoingUid}
    const pageSrc = fs.readFileSync(path.resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    assert.equal(
      /outgoingUid[\s\S]{0,160}updatedAt:\s*Date\.now\(\)/.test(pageSrc),
      false,
      "handleLogout must NEVER bump updatedAt on users/{outgoingUid}"
    );
  });

  it("enforces v2.145 full-system audit hardening across OTA migration, Auth/Sync, Coach Invite privacy, Matchplay & Watch telemetry", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    // 1. Cross-origin localhost -> .web.app IndexedDB migration bridge & .firebaseapp.com Android download headers
    const mainActivitySrc = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/MainActivity.java"),
      "utf8"
    );
    assert.ok(mainActivitySrc.includes("saveCrossOriginMigrationSnapshot"));
    assert.ok(mainActivitySrc.includes("consumeCrossOriginMigrationSnapshot"));

    const bannerSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/ui/AppUpdateBanner.tsx"),
      "utf8"
    );
    assert.ok(bannerSrc.includes("saveCrossOriginMigrationSnapshot"));
    assert.ok(bannerSrc.includes("consumeCrossOriginMigrationSnapshot"));

    const firebaseJson = fs.readFileSync(path.resolve(process.cwd(), "firebase.json"), "utf8");
    assert.equal(
      firebaseJson.includes("raw.githubusercontent.com"),
      false,
      "firebase.json must never redirect downloads to private GitHub raw URLs"
    );
    assert.ok(
      firebaseJson.includes("https://archery101010-c0bb4.firebaseapp.com/Archery101010-Mobile-"),
      "firebase.json /download-aab must serve via Android-safe .firebaseapp.com mirror"
    );

    // 2. Auth network-timeout guard, O(1) private coach_invite_codes, and Firestore security rules
    const authSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/authService.ts"), "utf8");
    assert.ok(authSrc.includes("cloudFetchFailed"), "authService.ts must guard against overwriting profiles on cloud fetch timeout");
    assert.ok(authSrc.includes("coach_invite_codes"), "authService.ts must resolve 6-digit codes via O(1) coach_invite_codes");
    assert.ok(authSrc.includes("generateUniqueClubInviteCode"), "authService.ts must check uniqueness when generating 6-digit invite codes");

    const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    assert.ok(rulesSrc.includes("match /coach_invite_codes/{inviteCode}"));
    assert.ok(rulesSrc.includes("function isValidDuelParticipantMutation("));

    const realtimeSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/db/realtimeSync.ts"),
      "utf8"
    );
    assert.ok(
      realtimeSrc.includes("!snapshot.metadata.fromCache"),
      "realtimeSync.ts must never prune local sessions from stale cached snapshots"
    );

    // 3. Smartwatch unacked delta protection & zero third-party brand leakage across modified UI views
    const wearSrc = fs.readFileSync(
      path.resolve(process.cwd(), "android/wear/src/main/java/com/archery101010/app/WearMainActivity.java"),
      "utf8"
    );
    assert.ok(wearSrc.includes("mPendingUnackedDelta"));

    const garminSrc = fs.readFileSync(
      path.resolve(process.cwd(), "garmin-ciq/source/Archery101010WatchApp.mc"),
      "utf8"
    );
    assert.ok(garminSrc.includes("mPendingRetryCmd"));

    const forbiddenBrands = /\b(whoop|polar|garmin|wahoo|coros|strava|apple watch|fitbit|suunto|nike)\b/i;
    for (const rel of [
      "src/components/ui/AppUpdateBanner.tsx",
      "src/components/ui/ErrorBoundary.tsx",
      "src/components/auth/LoginView.tsx",
      "src/components/auth/RegisterView.tsx",
      "src/components/profile/ProfileCompletionModal.tsx",
      "src/components/matchplay/MatchplayLobbyView.tsx",
      "src/components/matchplay/MatchplayGameView.tsx",
      "src/components/coach/CoachPortalView.tsx"
    ]) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      assert.equal(forbiddenBrands.test(content), false, `${rel} must never mention third-party brands`);
    }
  });

  it("streams live pulse from paired smartwatches via the watch app when standard BLE broadcast is unavailable", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { isLikelyCompanionSmartwatch } = await import("../src/lib/scoring/bleHeartRateService.ts");

    // 1. Paired smartwatches without 0x180D are routed through the watch app, real sensors are not
    assert.equal(isLikelyCompanionSmartwatch({ id: "a", name: "Smart Watch7 (ZX3Z)", isBondedOrConnected: true }), true);
    assert.equal(isLikelyCompanionSmartwatch({ id: "b", name: "Smart Watch7", isBondedOrConnected: true, hasHrService: true }), false);
    assert.equal(isLikelyCompanionSmartwatch({ id: "c", name: "HR Strap 2", isBondedOrConnected: true }), false);
    assert.equal(isLikelyCompanionSmartwatch({ id: "d", name: "AB Shutter3", isBondedOrConnected: true }), false);

    // 2. Watch app reads the wrist pulse sensor (BODY_SENSORS ≤ API 35, READ_HEART_RATE API 36+) and streams /archery101010/hr
    const wearManifest = fs.readFileSync(path.resolve(process.cwd(), "android/wear/src/main/AndroidManifest.xml"), "utf8");
    assert.ok(wearManifest.includes("android.permission.health.READ_HEART_RATE"));
    assert.ok(/BODY_SENSORS"\s+android:maxSdkVersion="35"/.test(wearManifest));
    const wearSrc = fs.readFileSync(
      path.resolve(process.cwd(), "android/wear/src/main/java/com/archery101010/app/WearMainActivity.java"),
      "utf8"
    );
    assert.ok(wearSrc.includes("Sensor.TYPE_HEART_RATE"));
    assert.ok(wearSrc.includes("\"/archery101010/hr\""));
    assert.ok(wearSrc.includes("\"/archery101010/hr_request\""));

    // 3. Phone forwards watch pulse to the web layer and refreshes stale GATT caches before failing
    const phoneSrc = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/MainActivity.java"),
      "utf8"
    );
    assert.ok(phoneSrc.includes("__onNativeWearHrUpdate"));
    assert.ok(phoneSrc.includes("refreshBleGattCacheInternal"));
    const serviceSrc = fs.readFileSync(path.resolve(process.cwd(), "src/lib/scoring/bleHeartRateService.ts"), "utf8");
    assert.ok(serviceSrc.includes("__onNativeWearHrUpdate"));
  });

  it("enforces v2.148 universal pulse readiness across random-MAC BLE bands, watchOS HealthKit, iOS CoreBluetooth & 6-digit Cloud HR", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    // 1. Android BLE: random-MAC device cache, BLE 5 non-legacy scan, delayed CCCD/discovery retries & non-HR gadget filter
    const phoneJava = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/MainActivity.java"),
      "utf8"
    );
    assert.ok(phoneJava.includes("cachedBleDevicesByAddr"));
    assert.ok(phoneJava.includes("resolveBleRemoteDevice"));
    assert.ok(phoneJava.includes("scheduleCccdEnableAttempt"));
    assert.ok(phoneJava.includes("scheduleServiceDiscoveryAttempt"));
    assert.ok(phoneJava.includes("setLegacy(false)"));
    assert.ok(phoneJava.includes("isObviouslyNonHrAccessory"));

    // 2. watchOS Companion: HealthKit .archery workout + .heartRate live query -> WCSession & 6-digit Cloud Sync
    const watchSwift = fs.readFileSync(
      path.resolve(process.cwd(), "ios-watchos/WatchApp/Archery101010WatchApp.swift"),
      "utf8"
    );
    assert.ok(watchSwift.includes("import HealthKit"));
    assert.ok(watchSwift.includes("HKAnchoredObjectQuery"));
    assert.ok(watchSwift.includes("watchHeartRateBpm"));

    // 3. iOS Companion: CoreBluetooth 0x180D + retrieveConnectedPeripherals + Info.plist Bluetooth permission
    const iosScene = fs.readFileSync(
      path.resolve(process.cwd(), "ios/App/App/SceneDelegate.swift"),
      "utf8"
    );
    assert.ok(iosScene.includes("CBCentralManagerDelegate"));
    assert.ok(iosScene.includes("retrieveConnectedPeripherals"));
    assert.ok(iosScene.includes("window.ArcheryBleHeartRateBridge"));

    const iosPlist = fs.readFileSync(
      path.resolve(process.cwd(), "ios/App/App/Info.plist"),
      "utf8"
    );
    assert.ok(iosPlist.includes("NSBluetoothAlwaysUsageDescription"));

    // 4. Cloud Watch HR forwarded into Pulsaciones live stream
    const bioSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/biometricsEngine.ts"),
      "utf8"
    );
    assert.ok(bioSrc.includes("isFreshCloudWatchHr"));
    assert.ok(bioSrc.includes("__onNativeWearHrUpdate"));
  });

  it("tracks realistic range walks (gentle pocket gait, 2-min shooting pauses, 70m target unlocks & GPS+step fusion)", async () => {
    const {
      createGaitDetectorState,
      createGpsAnchorState,
      createWalkingFusionState,
      processAccelerometerSample,
      processGpsCoordinateFix,
      recordFusedGpsMeters,
      recordFusedSteps
    } = await import("../src/lib/scoring/walkingTracker.ts");

    // 1. Gentle pocket/wrist walking (~1.35 m/s² amplitude at 600ms cadence, 24 steps = ~18.7m)
    const gentleWalk = createGaitDetectorState(0);
    let gt = 5_000_000;
    for (let step = 0; step < 24; step++) {
      for (let s = 0; s < 30; s++) {
        const phase = (s / 30) * Math.PI * 2;
        const az = 9.81 + Math.sin(phase) * 1.35;
        processAccelerometerSample(gentleWalk, 0, 0, az, gt + s * 20);
      }
      gt += 600;
    }
    assert.ok(
      gentleWalk.creditedSteps >= 22 && gentleWalk.creditedSteps <= 25,
      `Expected ~24 gentle range steps, got ${gentleWalk.creditedSteps}`
    );

    // 2. 50m outdoor round trip AFTER standing 120s shooting on line + 45s pulling arrows at target
    const rangeGps = createGpsAnchorState(0);
    const baseLat = 9.935;
    const lon = -84.091;
    const degPerMeter = 1 / 111132;
    let clock = 10_000;

    // Stand 120s on shooting line with minor <=1.2m stationary jitter
    for (let sec = 0; sec <= 120; sec += 3) {
      processGpsCoordinateFix(rangeGps, baseLat + ((sec % 2) * 0.8) * degPerMeter, lon, 6, clock);
      clock += 3000;
    }
    assert.equal(rangeGps.accumulatedMeters, 0, "Standing 2 min on shooting line must equal 0m");

    // Walk 50m north at 1.25 m/s (40 seconds, fix every 2s = 2.5m/fix)
    for (let d = 2.5; d <= 50; d += 2.5) {
      clock += 2000;
      processGpsCoordinateFix(rangeGps, baseLat + d * degPerMeter, lon, 6, clock, 1.25);
    }
    // Stand 45s at target pulling arrows
    for (let sec = 3; sec <= 45; sec += 3) {
      clock += 3000;
      processGpsCoordinateFix(rangeGps, baseLat + 50 * degPerMeter, lon, 6, clock, 0.05);
    }
    // Walk 50m south back to shooting line at 1.25 m/s
    for (let d = 47.5; d >= 0; d -= 2.5) {
      clock += 2000;
      processGpsCoordinateFix(rangeGps, baseLat + d * degPerMeter, lon, 6, clock, 1.25);
    }
    assert.ok(
      rangeGps.accumulatedMeters >= 92 && rangeGps.accumulatedMeters <= 104,
      `Expected ~96-100m on 50m round trip, got ${rangeGps.accumulatedMeters.toFixed(1)}m`
    );

    // 3. 70m Olympic Recurve walk with screen locked in pocket, unlocked at 70m target 58s later
    const pocket70 = createGpsAnchorState(0);
    processGpsCoordinateFix(pocket70, baseLat, lon, 7, 1000, 0);
    processGpsCoordinateFix(pocket70, baseLat + 70 * degPerMeter, lon, 7, 59_000, 0);
    assert.ok(
      pocket70.accumulatedMeters >= 68 && pocket70.accumulatedMeters <= 72,
      `Expected ~70m on 70m target unlock, got ${pocket70.accumulatedMeters.toFixed(1)}m`
    );

    // 4. Incremental GPS + Step fusion: zero double-counting outdoors, zero lost distance when GPS drops indoors
    const fusion = createWalkingFusionState(0, 0);
    recordFusedSteps(fusion, 40, 10_000, 175); // ~29.4m from steps
    const outdoorFused = recordFusedGpsMeters(fusion, 36, 12_000); // GPS confirms 36m in same window
    assert.equal(outdoorFused, 36, "Outdoor GPS + steps in same window must not double-count");
    // 30 seconds later, archer walks another 48 steps (~35.3m) under a metal roof with 0 GPS fixes
    const mixedFused = recordFusedSteps(fusion, 88, 45_000, 175);
    assert.ok(
      mixedFused >= 70 && mixedFused <= 73,
      `Expected ~71m after indoor segment without GPS, got ${mixedFused}m`
    );
  });

  it("never renders Volume-only sessions as points, 10s/Xs, or synthetic impacts on shareable telemetry cards", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const cardGenSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/targetImageGenerator.ts"),
      "utf8"
    );
    assert.ok(cardGenSrc.includes("function isVolumeTelemetryParams"));
    assert.ok(cardGenSrc.includes("const impacts = isVolOnly ? [] : synthesizeImpactsFromEnds"));
    assert.ok(cardGenSrc.includes("isVolOnly ? `${totalArrowsCount}` : `${score}`"));
    assert.ok(cardGenSrc.includes("*SESIÓN DE VOLUMEN · ARCHERY 101010 THE APP*"));

    const scoringSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/scoring/ScoringView.tsx"),
      "utf8"
    );
    assert.ok(scoringSrc.includes("isVolumeOnly: isVolMode"));

    const historySrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/history/HistoryView.tsx"),
      "utf8"
    );
    assert.ok(historySrc.includes("isVolumeOnly: isVol"));
    assert.ok(historySrc.includes("score: getSessionScore(session)"));
  });

  it("supports explicit INICIO -> FINAL manual analysis windows across Phone and Physical Watch Button", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { analyzeImuShotWindow } = await import("../src/lib/scoring/shotAnalysisEngine.ts");

    // Simulate a 16.5-second manual INICIO -> FINAL shot:
    //  - 0.0s .. 3.0s: Bow raise / draw sweep (Preparatory)
    //  - 3.0s .. 15.0s: Steady 12.0s Olympic anchor hold (Aiming)
    //  - 15.05s: Sharp bowstring release impulse (18.5 m/s^2)
    //  - 15.1s .. 16.5s: Post-release arm drop while pressing FINAL button on watch
    const startTs = 100_000;
    const stopTs = 116_500;
    const samples = [];
    for (let t = startTs; t <= stopTs; t += 20) {
      const elapsedSec = (t - startTs) / 1000;
      if (elapsedSec < 3.0) {
        const p = elapsedSec / 3.0;
        samples.push({
          t,
          ax: 2.0 * (1 - p),
          ay: 6.5 + 3.2 * p,
          az: 7.2 - 5.2 * p,
          gy: -0.45 * (1 - p),
          gz: 0.25 * (1 - p)
        });
      } else if (t >= 15_040 + startTs && t <= 15_080 + startTs) {
        samples.push({ t, ax: 6.2, ay: 15.8, az: 7.4, gy: 1.8, gz: -1.4 });
      } else if (elapsedSec > 15.08) {
        // Lowering bow arm to tap FINAL button — must be trimmed automatically!
        samples.push({ t, ax: 8.5, ay: 3.1, az: 4.0, gy: 1.2, gz: 0.9 });
      } else {
        samples.push({
          t,
          ax: 0.15,
          ay: 9.72 + Math.sin(elapsedSec * 7) * 0.03,
          az: 1.95 + Math.cos(elapsedSec * 5) * 0.03,
          gy: 0.01,
          gz: -0.01
        });
      }
    }

    const record = analyzeImuShotWindow({
      samples,
      manualStartTimestampMs: startTs,
      releaseTimestampMs: stopTs,
      shotNumber: 1,
      distanceM: 18,
      bowType: "Recurve",
      bowWrist: "LEFT"
    });

    assert.ok(record, "Explicit INICIO -> FINAL window must produce a valid AnalysisShotRecord");
    assert.ok(
      record!.totalSeconds >= 13.5 && record!.totalSeconds <= 16.0,
      `Expected ~15.0s total duration (exceeding old 10s cap), got ${record!.totalSeconds}s`
    );
    assert.ok(
      record!.stabilityPct >= 88,
      `Post-release arm drop before pressing FINAL must not degrade aiming stability (${record!.stabilityPct}%)`
    );

    const analysisSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/analysis/AnalysisView.tsx"),
      "utf8"
    );
    assert.equal(
      analysisSrc.includes("Capturar tiro actual del reloj"),
      false,
      "Old single-tap 'Capturar tiro actual del reloj' button must be removed"
    );
    assert.ok(analysisSrc.includes("ANALYSIS_MANUAL_START"));
    assert.ok(analysisSrc.includes("ANALYSIS_MANUAL_STOP"));

    const wearSrc = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "android/wear/src/main/java/com/archery101010/app/WearMainActivity.java"
      ),
      "utf8"
    );
    assert.ok(wearSrc.includes("KEYCODE_STEM_PRIMARY"));
    assert.ok(wearSrc.includes("toggleManualAnalysisFromWatchHardware"));
  });

  it("enforces AST Zero-Regression Guard across all src/ files so React Error #310 can never compile", async () => {
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { inspectSourceText, verifyWorkspaceSourceTree } = req(
      "../scripts/verify-no-regressions.js"
    );

    const liveScan = verifyWorkspaceSourceTree(process.cwd());
    assert.ok(liveScan.filesScanned >= 40, "Must scan the full src/ tree");
    assert.deepEqual(
      liveScan.violations,
      [],
      `Expected 0 hook violations across src/, found: ${liveScan.violations.join("; ")}`
    );

    // Prove the AST guard blocks a hook declared after an early return (exact React #310 pattern)
    const brokenSample = `
      import { useState, useRef } from "react";
      export function SampleModal({ isOpen }: { isOpen: boolean }) {
        const [count, setCount] = useState(0);
        if (!isOpen) return null;
        const dragRef = useRef(0);
        return <div>{count + dragRef.current}</div>;
      }
    `;
    const sampleViolations = inspectSourceText(brokenSample, "SampleModal.tsx");
    assert.equal(sampleViolations.length, 1, "Must catch hook called after early return");
    assert.ok(sampleViolations[0].includes("AFTER an early return"));
  });

  it("enforces v2.154 Galaxy Watch Wear OS fixes: HR permission-first, Cloud HR sync, self-healing 6-digit code, physical buttons & XL button", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const wearSrc = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "android/wear/src/main/java/com/archery101010/app/WearMainActivity.java"
      ),
      "utf8"
    );

    // 1. Permission MUST be checked BEFORE getDefaultSensor(TYPE_HEART_RATE) inside startHeartRateStreaming
    const hrMethodStart = wearSrc.indexOf(
      "private synchronized void startHeartRateStreaming(boolean allowPermissionPrompt, boolean forcePrompt)"
    );
    assert.ok(hrMethodStart > 0, "startHeartRateStreaming overload must exist");
    const hrMethodBody = wearSrc.slice(hrMethodStart, hrMethodStart + 1800);
    const permIdx = hrMethodBody.indexOf("if (!hasHeartRatePermission())");
    const sensorIdx = hrMethodBody.indexOf("getDefaultSensor(Sensor.TYPE_HEART_RATE)");
    assert.ok(permIdx > 0 && sensorIdx > 0 && permIdx < sensorIdx, "HR permission check MUST run before getDefaultSensor(TYPE_HEART_RATE)");

    // 2. Active Wear messageListener handles /archery101010/hr_request & Cloud sync pushes watchHeartRateBpm
    const msgListenerStart = wearSrc.indexOf("messageListener = (MessageEvent event)");
    assert.ok(msgListenerStart > 0);
    assert.ok(
      wearSrc.slice(msgListenerStart, msgListenerStart + 1600).includes("/archery101010/hr_request"),
      "Active Wear messageListener must handle /archery101010/hr_request"
    );
    assert.ok(wearSrc.includes("watchHeartRateBpm"), "WearMainActivity must sync watchHeartRateBpm over 6-digit Cloud");
    assert.ok(wearSrc.includes("cloudLinkStatus"), "WearMainActivity must track honest cloudLinkStatus");
    assert.ok(wearSrc.includes("NOT_FOUND") && wearSrc.includes("NO_NET"), "WearMainActivity must surface invalid code / no internet errors");

    // 3. Galaxy Watch physical button + rotary bezel + XL Analysis button (44f) & XL Cloud Code CTA (38f)
    assert.ok(wearSrc.includes("public boolean dispatchKeyEvent(KeyEvent event)"));
    assert.ok(wearSrc.includes("public boolean onGenericMotionEvent(MotionEvent event)"));
    assert.ok(wearSrc.includes("canvasView.requestFocus()"));
    assert.ok(wearSrc.includes("float btnH = 44f * scale;"), "Analysis XL toggle button must be >= 44f * scale");
    assert.ok(wearSrc.includes("float saveH = 38f * scale;"), "Cloud Code CTA button must be >= 38f * scale");

    // 4. Phone-side HR cache + self-healing 6-digit code rotation + clock-skew-proof heartbeat
    const mainJava = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/MainActivity.java"),
      "utf8"
    );
    assert.ok(mainJava.includes("getLastWearHeartRateJson"), "MainActivity must cache & expose fresh Wear HR");

    const bioSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/scoring/biometricsEngine.ts"),
      "utf8"
    );
    assert.ok(bioSrc.includes("allocateFreshPairingCode"), "biometricsEngine must auto-rotate stale/rejected 6-digit codes");
    assert.ok(bioSrc.includes("lastObservedWatchHeartbeatAt"), "biometricsEngine must detect live heartbeat changes even with watch clock skew");
    assert.ok(bioSrc.includes("pushPairingCodeToNativeWatchBridge"), "biometricsEngine must auto-share pairingCode over native watch bridge");
  });

  it("enforces v2.156 continuous live HR streaming across steady pulse (REPORTING_MODE_ON_CHANGE), DataClient, Analysis & Scoring", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { BleHeartRateSessionTracker } = await import("../src/lib/scoring/bleHeartRateService.ts");

    // 1. Companion smartwatch window (35s) retains steady pulse across 5s Cloud / 2.5s Wear keepalives
    const tracker = new BleHeartRateSessionTracker();
    assert.equal(tracker.recordSample(78, true, 10_000), true);
    assert.equal(tracker.getSnapshot(28_000, 35_000).currentBpm, 78, "Wear OS 35s window must keep steady BPM alive at +18s");
    assert.equal(tracker.getSnapshot(46_000, 35_000).currentBpm, 0, "Wear OS 35s window must expire cleanly if silent >35s");
    tracker.syncCompanionSummary(79, 94);
    assert.equal(tracker.getSnapshot(28_000, 35_000).maxHeartRateBpm, 94, "Companion summary must sync peak BPM");

    // 2. WearMainActivity keeps steady pulse alive via hrKeepaliveRunnable + DataClient /archery101010/hr + 5s Cloud push
    const wearSrc = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "android/wear/src/main/java/com/archery101010/app/WearMainActivity.java"
      ),
      "utf8"
    );
    assert.ok(wearSrc.includes("hrKeepaliveRunnable"), "WearMainActivity must run periodic HR keepalive for REPORTING_MODE_ON_CHANGE");
    assert.ok(wearSrc.includes("PutDataMapRequest.create(\"/archery101010/hr\")"), "WearMainActivity must sync urgent DataItem /archery101010/hr");
    assert.ok(wearSrc.includes("HR_CLOUD_PUSH_INTERVAL_MS = 5000L"), "WearMainActivity must push live HR to Cloud every 5s");

    // 3. Phone MainActivity + WearDataLayerService listen to DataItem /archery101010/hr
    const mainJava = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/MainActivity.java"),
      "utf8"
    );
    const serviceJava = fs.readFileSync(
      path.resolve(process.cwd(), "android/app/src/main/java/com/archery101010/app/WearDataLayerService.java"),
      "utf8"
    );
    assert.ok(mainJava.includes("\"/archery101010/hr\".equals(path)"), "MainActivity DataClient listener must handle /archery101010/hr");
    assert.ok(serviceJava.includes("\"/archery101010/hr\".equals(path)"), "WearDataLayerService DataClient listener must handle /archery101010/hr");

    // 4. ScoringView & AnalysisView both request live watch HR and sync active session state after pairing code init
    const scoringSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/scoring/ScoringView.tsx"),
      "utf8"
    );
    const analysisSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/analysis/AnalysisView.tsx"),
      "utf8"
    );
    assert.ok(scoringSrc.includes("ensureScoringWatchReady"), "ScoringView must initialize cloud watch & publish sessionActive:true");
    assert.ok(scoringSrc.includes("requestWatchAppHeartRate()"), "ScoringView must actively request watch heart rate on entry");
    assert.ok(analysisSrc.includes("requestWatchAppHeartRate()"), "AnalysisView must actively request watch heart rate on entry");
  });
});
