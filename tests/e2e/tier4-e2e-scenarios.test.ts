import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startStaticOutServer, type StaticOutServerHandle } from "./helpers/staticOutServer.ts";
import { CdpClient } from "./helpers/cdpClient.ts";
import {
  CDP_NO_TRUNCATION_AUDIT_SCRIPT,
  extractBracedBlock,
  findTrademarkViolations,
  getGarminSdkMonkeyCBatPath,
  parseBitmapFont,
  parseExpectedVersionCodes,
  readAppVersion,
  readIqPackageInfo,
  readRepoJson,
  readRepoText,
  repoFileExists,
  repoPath,
  runCommandSync
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

describe("Tier 4 — End-to-End Real-World Acceptance Scenarios (T4-1 .. T4-6)", () => {
  it("T4-1 Multi-route Chrome CDP hydration & zero console/pageerror check at 360x800 and 1280x800", async () => {
    const routes = ["/?skipIntro=1", "/watch", "/privacy", "/terms", "/manual/index.html"];
    const viewports = [
      { width: 360, height: 800 },
      { width: 1280, height: 800 }
    ];

    for (const vp of viewports) {
      for (const route of routes) {
        const res = await cdp.navigateAndCollect(`${server.baseUrl}${route}`, {
          width: vp.width,
          height: vp.height
        });
        assert.deepEqual(
          res.pageErrors,
          [],
          `Uncaught pageerror at ${vp.width}x${vp.height} on ${route}: ${res.pageErrors.join("; ")}`
        );
        assert.deepEqual(
          res.consoleErrors,
          [],
          `Console errors at ${vp.width}x${vp.height} on ${route}: ${res.consoleErrors.join("; ")}`
        );
        assert.ok(res.bodyText.trim().length > 20, `Empty rendered body at ${vp.width}x${vp.height} on ${route}`);
      }
    }
  });

  it("T4-2 Full UI Brand, No-Trademark & No-Truncation audit across live rendered DOM & /manual/index.html", async () => {
    const routes = ["/?skipIntro=1", "/watch", "/privacy", "/terms", "/manual/index.html"];
    for (const route of routes) {
      const res = await cdp.navigateAndCollect<{
        docOverflow: boolean;
        ellipsisElements: unknown[];
        clippedElements: unknown[];
        literalEllipsisTexts: unknown[];
      }>(`${server.baseUrl}${route}`, {
        width: 360,
        height: 800,
        evalScript: CDP_NO_TRUNCATION_AUDIT_SCRIPT
      });
      const trademarks = findTrademarkViolations(res.bodyText);
      assert.deepEqual(trademarks, [], `Trademark found on ${route}: ${JSON.stringify(trademarks)}`);
      assert.equal(res.evalResult.docOverflow, false, `Horizontal overflow on ${route}`);
      assert.deepEqual(res.evalResult.ellipsisElements, [], `Ellipsis truncation on ${route}`);
      assert.deepEqual(res.evalResult.clippedElements, [], `Clipped text on ${route}`);
      assert.deepEqual(res.evalResult.literalEllipsisTexts, [], `Literal '...' on ${route}`);
    }

    const homeLogoCheck = await cdp.navigateAndCollect<{
      hasOfficialLogoImg: boolean;
      hasCss101010Spans: boolean;
    }>(`${server.baseUrl}/?skipIntro=1`, {
      width: 360,
      height: 800,
      evalScript: `(() => ({
        hasOfficialLogoImg: Boolean(document.querySelector('img[src*="brand_logo_header.png"], img[src*="brand_logo_full.png"]')),
        hasCss101010Spans: Boolean(document.querySelector('.brand-logo-101010'))
      }))()`
    });
    assert.equal(homeLogoCheck.evalResult.hasCss101010Spans, false);
    assert.equal(homeLogoCheck.evalResult.hasOfficialLogoImg, true);
  });

  it("T4-3 Cross-platform version alignment & .iq / Android / iOS / watchOS package integrity", () => {
    const appVersion = readAppVersion();
    const { fullVersion, mobileVersionCode, wearVersionCode } = parseExpectedVersionCodes(appVersion);

    // 1. Web + Hosting JSON
    assert.equal(readRepoJson<{ version: string }>("package.json").version, fullVersion);
    assert.equal(readRepoJson<{ version: string }>("public", "ota-version.json").version, appVersion);

    // 2. Android + Wear OS
    assert.match(readRepoText("android", "app", "build.gradle"), new RegExp(`versionCode\\s+${mobileVersionCode}\\b`));
    assert.match(readRepoText("android", "wear", "build.gradle"), new RegExp(`versionCode\\s+${wearVersionCode}\\b`));

    // 3. iOS + watchOS
    const escapedAppVer = appVersion.replace(/\./g, "\\.");
    const pbx = readRepoText("ios", "App", "App.xcodeproj", "project.pbxproj");
    assert.match(pbx, new RegExp(`MARKETING_VERSION = ${escapedAppVer};`));
    assert.match(pbx, /ArcheryWatchSessionManager\.swift in Sources/);
    assert.match(pbx, /watchos|WatchApp/i);
    assert.match(
      readRepoText("ios-watchos", "WatchApp", "Info.plist"),
      new RegExp(`<string>(?:${escapedAppVer}|\\$\\(MARKETING_VERSION\\))</string>`)
    );

    // 4. Garmin .iq archive + 87-variant manifest + 3 .fnt '%' glyph
    const garminManifest = readRepoText("garmin-ciq", "manifest.xml");
    assert.match(garminManifest, new RegExp(`version="${fullVersion.replace(/\./g, "\\.")}"`));
    const iqInfo = readIqPackageInfo(repoPath("public", "Archery101010.iq"));
    assert.equal(iqInfo.hasManifestXml, true, "Missing manifest.xml inside .iq archive");
    assert.ok(iqInfo.prgEntries.length >= 80, `Expected >=80 compiled Garmin .prg targets in .iq, got ${iqInfo.prgEntries.length}`);

    for (const fontName of ["outfit_micro.fnt", "outfit_label.fnt", "outfit_value.fnt"]) {
      assert.equal(parseBitmapFont(["garmin-ciq", "resources", "fonts", fontName]).hasPercentGlyph, true);
    }
  });

  it("T4-4 Hosting distribution & .firebaseapp.com one-tap download verification (local + opt-in E2E_DEPLOY_VERIFY=1)", async () => {
    const appVersion = readAppVersion();

    // Local staticOutServer contract
    const home = await fetch(`${server.baseUrl}/`);
    assert.equal(home.status, 200);
    assert.ok(home.headers.get("content-security-policy"), "Missing Content-Security-Policy header");

    const missingAab = await fetch(`${server.baseUrl}/missing-test-v999.9.aab`);
    assert.equal(missingAab.status, 404, "Missing .aab must return 404, not 200 index.html");

    const mobileAab = await fetch(`${server.baseUrl}/Archery101010-Mobile-v${appVersion}.aab`, { method: "HEAD" });
    assert.equal(mobileAab.status, 200);
    assert.match(mobileAab.headers.get("content-disposition") ?? "", /attachment/i);

    const wearAab = await fetch(`${server.baseUrl}/Archery101010-WearOS-v${appVersion}.aab`, { method: "HEAD" });
    assert.equal(wearAab.status, 200);
    assert.match(wearAab.headers.get("content-disposition") ?? "", /attachment/i);

    if (process.env.E2E_DEPLOY_VERIFY === "1") {
      for (const fileName of [
        `Archery101010-Mobile-v${appVersion}.aab`,
        `Archery101010-WearOS-v${appVersion}.aab`,
        "Archery101010.iq"
      ]) {
        const liveUrl = `https://archery101010-c0bb4.firebaseapp.com/${fileName}`;
        const liveRes = await fetch(liveUrl, { method: "HEAD" });
        assert.equal(liveRes.status, 200, `Live .firebaseapp.com missing ${fileName}`);
        assert.match(
          liveRes.headers.get("content-disposition") ?? "",
          /attachment/i,
          `Live ${liveUrl} missing Content-Disposition: attachment`
        );
      }
      const liveMissing = await fetch("https://archery101010-c0bb4.firebaseapp.com/nonexistent-e2e-check.aab");
      assert.equal(liveMissing.status, 404);
    }
  });

  it("T4-5 End-to-end security, billing, role escalation, Option 1a watch & GDPR purge verification", () => {
    const rules = readRepoText("firestore.rules");
    const fnSrc = readRepoText("functions", "index.js");

    // Option 1a watch pairing + 256-bit session token + watchCloudBridge
    assert.match(rules, /match \/watch_pairings\/\{pairingCode\}/);
    assert.match(rules, /match \/watch_sessions\/\{sessionToken\}/);
    assert.match(fnSrc, /exports\.watchCloudBridge/);

    // Server-authoritative billing/roles + email_verified SuperAdmin + GDPR purge
    const subLogsBlock = extractBracedBlock(rules, /match\s+\/subscription_audit_logs\/\{logId\}/);
    assert.ok(subLogsBlock, "Missing subscription_audit_logs block");
    const subCreate = subLogsBlock.match(/allow create:\s*([^;]+);/);
    assert.ok(subCreate && /isSuperAdmin\(\)/.test(subCreate[1]), "subscription_audit_logs allow create must require isSuperAdmin()");

    const escalateOnCreate = extractBracedBlock(rules, /function\s+isNotSelfEscalatingCoachClubOnCreate\b/);
    assert.ok(escalateOnCreate, "Missing isNotSelfEscalatingCoachClubOnCreate");
    assert.match(escalateOnCreate, /data\.role\s*==\s*'archer'/);

    const escalateOnUpdate = extractBracedBlock(rules, /function\s+isNotSelfEscalatingCoachClubOnUpdate\b/);
    assert.ok(escalateOnUpdate, "Missing isNotSelfEscalatingCoachClubOnUpdate");
    assert.match(
      escalateOnUpdate,
      /oldRole\s+in\s+\[\s*'coach'\s*,\s*'team_admin'\s*,\s*'team_admin_coach'\s*\][\s\S]*newRole\s+in\s+\[\s*'coach'\s*,\s*'team_admin'\s*,\s*'team_admin_coach'\s*\]/
    );

    assert.match(fnSrc, /(?:admin\.auth\(\)|auth)\.deleteUser\(/);
    assert.match(fnSrc, /store_receipt_claims/);

    if (process.env.E2E_LIVE_EMULATOR === "1") {
      const fnTest = runCommandSync("npm", ["--prefix", "functions", "test"], repoPath());
      assert.equal(fnTest.exitCode, 0, fnTest.stdout + fnTest.stderr);
    }
  });

  it("T4-6 Full CI Quality, Build & Cross-Platform Release Gate orchestration", () => {
    // Baseline core quality checks (never recurse into tests/e2e)
    const astGuard = runCommandSync(process.execPath, [repoPath("scripts", "verify-no-regressions.js")]);
    assert.equal(astGuard.exitCode, 0, astGuard.stdout + astGuard.stderr);

    const coreTests = runCommandSync(process.execPath, ["--test", repoPath("tests", "archery-core.test.ts")]);
    assert.equal(coreTests.exitCode, 0, coreTests.stdout + coreTests.stderr);

    const fnSyntax = runCommandSync(process.execPath, ["--check", repoPath("functions", "index.js")]);
    assert.equal(fnSyntax.exitCode, 0, fnSyntax.stderr);

    assert.equal(repoFileExists("out", "index.html"), true);

    if (process.env.E2E_RUN_QA_GATES === "1") {
      const lintRes = runCommandSync("npm", ["run", "lint"], repoPath());
      assert.equal(lintRes.exitCode, 0, lintRes.stdout + lintRes.stderr);

      const tscRes = runCommandSync("npx", ["tsc", "--noEmit"], repoPath());
      assert.equal(tscRes.exitCode, 0, tscRes.stdout + tscRes.stderr);
    }

    if (process.env.E2E_NATIVE_BUILD === "1") {
      const gradlew = repoPath("android", "gradlew.bat");
      const wearLint = runCommandSync(gradlew, [":wear:lintDebug", "--no-daemon", "--max-workers=1"], repoPath("android"), 300_000);
      assert.equal(wearLint.exitCode, 0, wearLint.stdout + wearLint.stderr);

      const appLint = runCommandSync(gradlew, [":app:lintDebug", ":app:testDebugUnitTest", "--no-daemon", "--max-workers=1"], repoPath("android"), 300_000);
      assert.equal(appLint.exitCode, 0, appLint.stdout + appLint.stderr);

      const monkeyc = getGarminSdkMonkeyCBatPath();
      if (monkeyc) {
        const tmpIq = path.join(os.tmpdir(), `archery-e2e-ci-check-${process.pid}.iq`);
        try {
          const iqBuild = runCommandSync(
            monkeyc,
            [
              "-e",
              "-w",
              "-r",
              "-f",
              repoPath("garmin-ciq", "monkey.jungle"),
              "-y",
              repoPath("garmin-ciq", "developer_key.der"),
              "-o",
              tmpIq
            ],
            repoPath(),
            300_000
          );
          assert.equal(iqBuild.exitCode, 0, iqBuild.stdout + iqBuild.stderr);
        } finally {
          if (fs.existsSync(tmpIq)) {
            fs.rmSync(tmpIq, { force: true });
          }
        }
      }
    }
  });
});
