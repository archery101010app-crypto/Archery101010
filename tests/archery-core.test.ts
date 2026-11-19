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
      "AppUpdateBanner must use in-place window.location.reload() for standard web/PWA"
    );
    const legacyGuardIdx = bannerSrc.indexOf("if (Boolean(winAny.ArcheryNativeAuth))");
    const webReloadIdx = bannerSrc.indexOf("window.location.reload();");
    assert.ok(
      legacyGuardIdx > 0 && legacyGuardIdx < webReloadIdx,
      "AppUpdateBanner must return early for legacy Android shells (< v2.107) BEFORE window.location.reload() so Capacitor Bridge.launchIntent never opens Chrome"
    );

    const verJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/version.json"), "utf8"));
    const appVerJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/app-version.json"), "utf8"));
    assert.equal(verJson.version, APP_VERSION);
    assert.equal(appVerJson.version, APP_VERSION);
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
});
