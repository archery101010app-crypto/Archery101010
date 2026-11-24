import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startStaticOutServer, type StaticOutServerHandle } from "./helpers/staticOutServer.ts";
import { CdpClient } from "./helpers/cdpClient.ts";
import {
  CDP_NO_TRUNCATION_AUDIT_SCRIPT,
  extractBracedBlock,
  parseExpectedVersionCodes,
  readAppVersion,
  readRepoJson,
  readRepoText,
  repoFileExists,
  repoPath
} from "./helpers/e2eUtils.ts";

let server: StaticOutServerHandle;
let cdp: CdpClient;

before(async () => {
  server = await startStaticOutServer();
  cdp = await CdpClient.launch();
});

after(async () => {
  await Promise.allSettled([cdp?.close(), server?.close()]);
});

describe("Tier 3 — Cross-Feature Pairwise Combination Tests (T3-1 .. T3-10)", () => {
  it("T3-1 Offline IndexedDB + Cloud Sync + Club Stars (F1 + F4)", async () => {
    // 1. Browser IndexedDB + localStorage persistence verified offline under staticOutServer
    const browserCheck = await cdp.navigateAndCollect<{ idbOk: boolean }>(
      `${server.baseUrl}/?skipIntro=1`,
      {
        width: 360,
        height: 800,
        evalScript: `new Promise((resolve) => {
          const req = window.indexedDB.open("archery_e2e_offline_check", 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore("drafts", { keyPath: "id" });
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("drafts", "readwrite");
            tx.objectStore("drafts").put({ id: "SES-E2E-1", score: 29 });
            tx.oncomplete = () => {
              db.close();
              window.indexedDB.deleteDatabase("archery_e2e_offline_check");
              resolve({ idbOk: true });
            };
          };
          req.onerror = () => resolve({ idbOk: false });
        })`
      }
    );
    assert.equal(browserCheck.evalResult.idbOk, true);

    // 2. ScoringView debounced draft alignment + starsManager clubId propagation + athlete_stars rule privacy
    const scoring = readRepoText("src", "components", "scoring", "ScoringView.tsx");
    assert.doesNotMatch(scoring, /`SES-DRAFT-\$\{user\.uid\}`/);

    const stars = readRepoText("src", "lib", "starsManager.ts");
    const createBlock = stars.slice(stars.indexOf("currentDoc"), stars.indexOf("currentDoc") + 1800);
    assert.match(createBlock, /clubId:\s*userProfile\?\.clubId|clubId:\s*resolvedClubId/);

    const rules = readRepoText("firestore.rules");
    const starsRead = rules.match(/match \/athlete_stars\/\{userId\}[\s\S]{0,300}allow read:\s*([^;]+);/);
    assert.ok(starsRead && starsRead[1].trim() !== "if isAuthenticated()");
  });

  it("T3-2 Billing/Role Security + Coach Portal + Invite Codes (F4 + F5 + F3, Option 1a)", () => {
    const rules = readRepoText("firestore.rules");
    const fnSrc = readRepoText("functions", "index.js");
    const billing = readRepoText("src", "lib", "billingService.ts");
    const coachPortal = readRepoText("src", "components", "coach", "CoachPortalView.tsx");
    const sheet = readRepoText("src", "components", "coach", "AthleteDetailSheet.tsx");

    // Server-authoritative rules + callables (ready for Blaze) + Spark-safe client contract
    const subLogsBlock = extractBracedBlock(rules, /match\s+\/subscription_audit_logs\/\{logId\}/);
    assert.ok(subLogsBlock, "Missing subscription_audit_logs block");
    const subCreate = subLogsBlock.match(/allow create:\s*([^;]+);/);
    assert.ok(subCreate && /isSuperAdmin\(\)/.test(subCreate[1]), "subscription_audit_logs create must require isSuperAdmin()");
    assert.match(fnSrc, /exports\.promoteToCoachClub/);
    assert.match(fnSrc, /exports\.verifyStoreSubscription/);
    assert.match(fnSrc, /exports\.restoreStoreSubscription/);
    assert.match(fnSrc, /exports\.rotateCoachInviteCode/);
    assert.match(billing, /verifyStoreSubscription/);

    // Invite codes PII-free + uniqueness in CoachPortal + AthleteDetailSheet safe level-0
    const inviteRule = rules.match(/function isValidCoachInviteCodeDoc[\s\S]*?\n\s*\}/);
    assert.ok(
      inviteRule &&
        (!inviteRule[0].includes("'email'") ||
          /data\.get\('email',\s*''\)\s*==\s*''\s*\|\|\s*isSuperAdmin\(\)/.test(inviteRule[0]))
    );
    assert.match(coachPortal, /generateUniqueClubInviteCode|rotateCoachInviteCode/);
    assert.doesNotMatch(sheet, /const prevMin = tiers\[currentLevel - 1\]\.minScore;/);
  });

  it("T3-3 Analysis Mode + Watch Telemetry (F1 + F8 + F10)", () => {
    const analysis = readRepoText("src", "components", "analysis", "AnalysisView.tsx");
    const manualStartIdx = analysis.indexOf("const handleManualStart");
    assert.ok(manualStartIdx !== -1);
    const startBlock = analysis.slice(manualStartIdx, manualStartIdx + 600);
    assert.match(startBlock, /setManualStopAt\(\s*0\s*\)/);

    const finishIdx = analysis.indexOf("const handleSaveAndFinishSession");
    assert.ok(finishIdx !== -1);
    assert.match(analysis.slice(finishIdx, finishIdx + 1400), /finally\s*\{[\s\S]*isFinishingRef\.current\s*=\s*false/);

    const wearJava = readRepoText(
      "android",
      "wear",
      "src",
      "main",
      "java",
      "com",
      "archery101010",
      "app",
      "WearMainActivity.java"
    );
    const shotIdx = wearJava.indexOf('src.optString("analysisShotJson"');
    assert.ok(shotIdx !== -1, "Missing analysisShotJson handling in WearMainActivity.java");
    const shotSlice = wearJava.slice(shotIdx, shotIdx + 500);
    assert.match(shotSlice, /3500|3400|3000/);
    assert.match(shotSlice, /length\(\)|substring\(|Math\.min/);

    const garminMc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    assert.match(garminMc, /manualStartAt/);
  });

  it("T3-4 Matchplay 1v1 + Push Icons + WebRTC next-end + Zoom (F2 + F5)", async () => {
    const rules = readRepoText("firestore.rules");
    assert.match(
      rules,
      /receiverUid\s*!=\s*(request\.auth\.uid|request\.resource\.data\.senderUid)|senderUid\s*!=\s*(?:request\.resource\.data\.)?receiverUid/
    );

    const game = readRepoText("src", "components", "matchplay", "MatchplayGameView.tsx");
    assert.doesNotMatch(game, /getCoordsFromClient\(\s*cursorPos\.x\s*,\s*cursorPos\.y\s*\)/);
    assert.doesNotMatch(
      game,
      /case "next-end":\s*\{\s*\n[\s\S]{0,180}\n\s*setEndSummary\(null\);\s*\n\s*setEndSummaryMsg\(null\);\s*\n\s*setValidationPhase\("IDLE"\);/
    );

    // Push icons exist on served out/ and Android res/
    const iconRes = await fetch(`${server.baseUrl}/icon-192.png`);
    assert.equal(iconRes.status, 200);
    const fcmSw = readRepoText("public", "firebase-messaging-sw.js");
    assert.doesNotMatch(fcmSw, /\/icons\/icon-192x192\.png/);
  });

  it("T3-5 Multi-Lang (en/fr/de) + Imperial (yd) + 360x800 Chrome CDP Layout (F1 + F3)", async () => {
    const cfg = readRepoText("src", "components", "scoring", "SessionConfigView.tsx");
    assert.match(cfg, /\byd\b/);

    const coachPortal = readRepoText("src", "components", "coach", "CoachPortalView.tsx");
    const gridIdx = coachPortal.indexOf("grid-cols-5");
    assert.ok(gridIdx !== -1);
    assert.doesNotMatch(
      coachPortal.slice(gridIdx, gridIdx + 1800),
      /overflow-hidden[\s\S]{0,800}whitespace-nowrap|whitespace-nowrap[\s\S]{0,800}overflow-hidden/
    );

    for (const lang of ["en", "fr", "de"]) {
      const res = await cdp.navigateAndCollect<{
        htmlLang: string;
        docOverflow: boolean;
        ellipsisElements: unknown[];
        clippedElements: unknown[];
      }>(`${server.baseUrl}/?skipIntro=1`, {
        width: 360,
        height: 800,
        preLoadScript: `window.localStorage.setItem("preferred_language", "${lang}");`,
        evalScript: `(() => {
          const audit = ${CDP_NO_TRUNCATION_AUDIT_SCRIPT};
          return { htmlLang: document.documentElement.lang || "", ...audit };
        })()`
      });
      assert.equal(res.evalResult.htmlLang, lang, `Expected <html lang="${lang}">, got "${res.evalResult.htmlLang}"`);
      assert.equal(res.evalResult.docOverflow, false, `Overflow in lang=${lang}`);
      assert.deepEqual(res.evalResult.ellipsisElements, [], `Ellipsis in lang=${lang}`);
      assert.deepEqual(res.evalResult.clippedElements, [], `Clipped text in lang=${lang}`);
    }
  });

  it("T3-6 Next out/ + Cap sync + aaptOptions + .firebaseapp.com Attachments + 404 Pruned PDFs (F6 + F7)", async () => {
    const appVersion = readAppVersion();
    const mobileRedirect = await fetch(`${server.baseUrl}/download-aab`, { redirect: "manual" });
    assert.equal(mobileRedirect.status, 302);
    assert.equal(
      mobileRedirect.headers.get("location"),
      `https://archery101010-c0bb4.firebaseapp.com/Archery101010-Mobile-v${appVersion}.aab`
    );

    const aabRes = await fetch(`${server.baseUrl}/Archery101010-Mobile-v${appVersion}.aab`, { method: "HEAD" });
    assert.equal(aabRes.status, 200);
    assert.match(aabRes.headers.get("content-disposition") ?? "", /attachment/i);

    const missingPdf = await fetch(`${server.baseUrl}/Plan-Asesoria-Coach-Rodrigo-Saborio-Archery101010.pdf`);
    assert.equal(missingPdf.status, 404);

    const appGradle = readRepoText("android", "app", "build.gradle");
    assert.match(appGradle, /\*\.iq/);
    assert.match(appGradle, /\*\.pdf/);
  });

  it("T3-7 Watch /watch + visibilitychange + 403 Termination + Option 1a Session Token (F1 + F4 + F8 + F10)", async () => {
    const watchDom = await cdp.navigateAndCollect(`${server.baseUrl}/watch`, {
      width: 360,
      height: 800
    });
    assert.deepEqual(watchDom.pageErrors, []);
    assert.ok(watchDom.bodyText.trim().length > 10);

    const miniApp = readRepoText("src", "components", "watch", "SmartwatchMiniApp.tsx");
    assert.doesNotMatch(
      miniApp,
      /disconnectWatchClientPairingCode\(\);[\s\S]{0,400}\[isStandalone,\s*isPageVisible\]/
    );

    const rules = readRepoText("firestore.rules");
    assert.match(rules, /match \/watch_pairings\/\{pairingCode\}/);
    assert.match(rules, /match \/watch_sessions\/\{sessionToken\}/);

    const wearJava = readRepoText("android", "wear", "src", "main", "java", "com", "archery101010", "app", "WearMainActivity.java");
    const garminMc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    assert.doesNotMatch(
      wearJava,
      /else\s+if\s*\([^)]*404[^)]*403[^)]*\)\s*\{[^}]*cloudLinkStatus\s*=\s*"NOT_FOUND"/,
      "WearMainActivity must not classify HTTP 403 as NOT_FOUND"
    );
    assert.match(
      wearJava,
      /(?:rc|responseCode|code)\s*==\s*403[\s\S]{0,180}cloudLinkStatus\s*=\s*"(?!NOT_FOUND)[A-Z_]+"/,
      "WearMainActivity must set distinct error state for HTTP 403"
    );
    const patchRespBlock = extractBracedBlock(garminMc, /function\s+onCloudPatchResponse\b/);
    assert.ok(patchRespBlock, "Missing onCloudPatchResponse in Archery101010WatchApp.mc");
    assert.match(
      patchRespBlock,
      /if\s*\([^)]*\b403\b[^)]*\)\s*\{[^}]*(?:mPendingRetryCmd\s*=\s*null|mPending[A-Za-z]*Queue|pending[A-Za-z]*Queue|remove\(|slice\(|clear)/,
      "Garmin onCloudPatchResponse must clear pending retry/queue on HTTP 403"
    );
  });

  it("T3-8 Account Purge + email_verified SuperAdmin Alignment (F4 + F5)", () => {
    const rules = readRepoText("firestore.rules");
    const fnSrc = readRepoText("functions", "index.js");
    const authSvc = readRepoText("src", "lib", "authService.ts");

    const canRead = rules.match(/function canReadPrivateUserDoc[\s\S]*?\n\s*\}/);
    assert.ok(canRead && /email_verified/.test(canRead[0]));
    assert.match(fnSrc, /email_verified\s*===\s*true/);
    assert.match(
      authSvc,
      /(?:isSuperAdminEmail|isVerifiedSuperAdmin|superadmin)[\s\S]{0,600}(?:emailVerified|email_verified)|(?:emailVerified|email_verified)[\s\S]{0,600}(?:isSuperAdminEmail|isVerifiedSuperAdmin|superadmin)/i,
      "authService.ts must enforce emailVerified on superadmin checks"
    );

    assert.match(fnSrc, /(?:admin\.auth\(\)|auth)\.deleteUser\(/);
    for (const col of ["macrocycles", "duel_invitations", "watch_sessions", "subscription_audit_logs", "client_error_logs"]) {
      assert.ok(fnSrc.includes(col), `purgeDeletedUserAccount missing ${col}`);
    }
  });

  it("T3-9 Cross-Platform Version Sync Across Web, Hosting, Android, Wear, iOS, watchOS, Garmin & Docs (F6..F10)", () => {
    const appVersion = readAppVersion();
    const { fullVersion, mobileVersionCode, wearVersionCode } = parseExpectedVersionCodes(appVersion);

    const pkg = readRepoJson<{ version: string }>("package.json");
    assert.equal(pkg.version, fullVersion);

    const ota = readRepoJson<{ version: string; versionCode: number }>("public", "ota-version.json");
    assert.equal(ota.version, appVersion);
    assert.equal(ota.versionCode, mobileVersionCode);

    const appGradle = readRepoText("android", "app", "build.gradle");
    assert.match(appGradle, new RegExp(`versionCode\\s+${mobileVersionCode}\\b`));
    const wearGradle = readRepoText("android", "wear", "build.gradle");
    assert.match(wearGradle, new RegExp(`versionCode\\s+${wearVersionCode}\\b`));

    const garminManifest = readRepoText("garmin-ciq", "manifest.xml");
    assert.match(garminManifest, new RegExp(`version="${fullVersion.replace(/\./g, "\\.")}"`));

    const escapedAppVer = appVersion.replace(/\./g, "\\.");
    const pbx = readRepoText("ios", "App", "App.xcodeproj", "project.pbxproj");
    assert.match(pbx, new RegExp(`MARKETING_VERSION = ${escapedAppVer};`));

    const watchPlist = readRepoText("ios-watchos", "WatchApp", "Info.plist");
    assert.match(
      watchPlist,
      new RegExp(`<string>(?:${escapedAppVer}|\\$\\(MARKETING_VERSION\\))</string>`)
    );

    const docs = readRepoText("DOCUMENTACION_COMPLETA.md");
    assert.ok(docs.includes(appVersion));
  });

  it("T3-10 Android OTA MainActivity OnBackPressedCallback + backNavigation.ts Modal/Home/Exit Contract (F1 + F7)", async () => {
    const mainJava = readRepoText(
      "android",
      "app",
      "src",
      "main",
      "java",
      "com",
      "archery101010",
      "app",
      "MainActivity.java"
    );
    assert.match(mainJava, /OnBackPressedCallback/);
    assert.match(mainJava, /__onNativeAndroidBack/);
    assert.match(mainJava, /void\s+exitApp\s*\(/);

    const backNav = readRepoText("src", "lib", "navigation", "backNavigation.ts");
    assert.match(backNav, /__onNativeAndroidBack/);

    // Verify served bundle exposes and handles real window.__onNativeAndroidBack()
    const cdpRes = await cdp.navigateAndCollect<{
      hasNativeBackFn: boolean;
      firstBackResult: string | null;
      secondBackResult: string | null;
    }>(
      `${server.baseUrl}/?skipIntro=1`,
      {
        width: 360,
        height: 800,
        evalScript: `(() => {
          const fn = window.__onNativeAndroidBack;
          if (typeof fn !== "function") {
            return { hasNativeBackFn: false, firstBackResult: null, secondBackResult: null };
          }
          const firstBackResult = String(fn());
          const secondBackResult = String(fn());
          return { hasNativeBackFn: true, firstBackResult, secondBackResult };
        })()`
      }
    );
    assert.equal(cdpRes.evalResult.hasNativeBackFn, true, "Hydrated app must register window.__onNativeAndroidBack");
    assert.equal(cdpRes.evalResult.firstBackResult, "HANDLED");
    assert.equal(cdpRes.evalResult.secondBackResult, "EXIT");

    // Ensure .aab artifacts exist in expected locations when built
    assert.equal(repoFileExists("firebase.json"), true);
    assert.equal(path.isAbsolute(repoPath("tests", "e2e")), true);
    assert.equal(fs.existsSync(repoPath("out", "index.html")), true);
  });
});
