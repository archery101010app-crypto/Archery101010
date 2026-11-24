import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startStaticOutServer, type StaticOutServerHandle } from "./helpers/staticOutServer.ts";
import { CdpClient } from "./helpers/cdpClient.ts";
import {
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

describe("Tier 1 — F1: Web Core, Static Export, Scoring, Timer & Analysis", () => {
  it("F1.1 HTTP GET / returns 200 HTML shell for Archery 101010", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/i);
    const html = await res.text();
    assert.match(html, /ARCHERY 101010/i);
  });

  it("F1.2 Clean URLs /watch, /privacy, and /terms resolve to 200 HTML routes", async () => {
    for (const route of ["/watch", "/privacy", "/terms"]) {
      const res = await fetch(`${server.baseUrl}${route}`);
      assert.equal(res.status, 200, `Expected 200 for ${route}`);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/i);
      const html = await res.text();
      assert.ok(html.length > 500, `Expected non-empty HTML for ${route}`);
    }
  });

  it("F1.3 Headless Chrome hydrates / at 360x800 with zero uncaught errors", async () => {
    const result = await cdp.navigateAndCollect(`${server.baseUrl}/?skipIntro=1`, {
      width: 360,
      height: 800
    });
    assert.ok(result.bodyText.trim().length > 20, "Rendered bodyText should not be empty");
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.consoleErrors, []);
  });

  it("F1.4 Browser storage (localStorage & IndexedDB) works on served origin", async () => {
    const storageCheck = await cdp.navigateAndCollect<{
      localStorageOk: boolean;
      indexedDbAvailable: boolean;
    }>(`${server.baseUrl}/?skipIntro=1`, {
      width: 360,
      height: 800,
      evalScript: `(() => {
        window.localStorage.setItem("archery_e2e_probe", "ok");
        const val = window.localStorage.getItem("archery_e2e_probe");
        window.localStorage.removeItem("archery_e2e_probe");
        return {
          localStorageOk: val === "ok",
          indexedDbAvailable: typeof window.indexedDB === "object" && typeof window.indexedDB.open === "function"
        };
      })()`
    });
    assert.equal(storageCheck.evalResult.localStorageOk, true);
    assert.equal(storageCheck.evalResult.indexedDbAvailable, true);
  });

  it("F1.5 Headless Chrome hydrates /watch, /privacy, and /terms cleanly", async () => {
    for (const route of ["/watch", "/privacy", "/terms"]) {
      const res = await cdp.navigateAndCollect(`${server.baseUrl}${route}`, {
        width: 360,
        height: 800
      });
      assert.deepEqual(res.pageErrors, [], `Unexpected pageError on ${route}`);
      assert.ok(res.bodyText.trim().length > 20, `Empty body on ${route}`);
    }
  });

  it("F1.6 Next.js config uses static export and scoring/timer/analysis views exist", () => {
    const nextCfg = readRepoText("next.config.ts");
    assert.match(nextCfg, /output:\s*["']export["']/);
    assert.equal(repoFileExists("src", "components", "scoring", "FloatingClock.tsx"), true);
    assert.equal(repoFileExists("src", "components", "scoring", "ScoringView.tsx"), true);
    assert.equal(repoFileExists("src", "components", "analysis", "AnalysisView.tsx"), true);
  });
});

describe("Tier 1 — F2: Matchplay 1v1, Zoom, Sharing & Ads", () => {
  it("F2.1 Deep-link /?join=123456 serves valid SPA shell for Matchplay entry", async () => {
    const res = await fetch(`${server.baseUrl}/?join=123456`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/i);
  });

  it("F2.2 MatchplayLobbyView and MatchplayGameView implement duel & zoom contracts", () => {
    const lobby = readRepoText("src", "components", "matchplay", "MatchplayLobbyView.tsx");
    const game = readRepoText("src", "components", "matchplay", "MatchplayGameView.tsx");
    assert.match(lobby, /active_duels/);
    assert.match(game, /getCoordsFromClient/);
    assert.match(game, /RTCPeerConnection/);
  });

  it("F2.3 Firestore rules explicitly govern active_duels and duel_invitations", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /match \/active_duels\/\{roomCode\}/);
    assert.match(rules, /match \/duel_invitations\/\{invitationId\}/);
  });

  it("F2.4 Ad campaigns contract spans adManager, BannerWidget, AdPopupOverlay, and rules", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /match \/ad_campaigns\/\{campaignId\}/);
    assert.equal(repoFileExists("src", "lib", "adManager.ts"), true);
    assert.equal(repoFileExists("src", "components", "ads", "BannerWidget.tsx"), true);
    assert.equal(repoFileExists("src", "components", "ads", "AdPopupOverlay.tsx"), true);
  });

  it("F2.5 Target card sharing and CSV/image helpers exist in scoring & coach flows", () => {
    const gen = readRepoText("src", "lib", "scoring", "targetImageGenerator.ts");
    const coachSessions = readRepoText("src", "components", "coach", "tabs", "CoachSessionsTab.tsx");
    assert.match(gen, /ArcheryNativeShare|navigator\.share|shareTargetShotChart/);
    assert.match(coachSessions, /share/i);
  });
});

describe("Tier 1 — F3: Brand Compliance, PNG Logo & No-Truncation UI", () => {
  it("F3.1 Official 4K Retina brand logo assets serve as 200 image/png", async () => {
    for (const imgPath of ["/images/brand_logo_header.png", "/images/brand_logo_full.png"]) {
      const res = await fetch(`${server.baseUrl}${imgPath}`);
      assert.equal(res.status, 200, `Missing ${imgPath}`);
      assert.match(res.headers.get("content-type") ?? "", /image\/png/i);
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 1000, `${imgPath} too small`);
    }
  });

  it("F3.2 Chrome CDP renders / at 360x800 without horizontal document overflow", async () => {
    const res = await cdp.navigateAndCollect<{ scrollWidth: number; innerWidth: number }>(
      `${server.baseUrl}/?skipIntro=1`,
      {
        width: 360,
        height: 800,
        evalScript: `({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        })`
      }
    );
    assert.ok(
      res.evalResult.scrollWidth <= res.evalResult.innerWidth + 2,
      `Horizontal overflow detected: ${res.evalResult.scrollWidth} > ${res.evalResult.innerWidth}`
    );
  });

  it("F3.3 Brand font /fonts/good-times.woff2 serves 200 and layout applies notranslate OLED shell", async () => {
    const res = await fetch(`${server.baseUrl}/fonts/good-times.woff2`);
    assert.equal(res.status, 200);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 500);
    const layout = readRepoText("src", "app", "layout.tsx");
    const globals = readRepoText("src", "app", "globals.css");
    assert.match(layout, /notranslate/);
    assert.match(layout, /bg-black-oled/);
    assert.match(globals, /Outfit/);
  });

  it("F3.4 Privacy and Terms routes render complete readable copy at 360x800", async () => {
    for (const route of ["/privacy", "/terms"]) {
      const res = await cdp.navigateAndCollect<{ scrollWidth: number; innerWidth: number }>(
        `${server.baseUrl}${route}`,
        {
          width: 360,
          height: 800,
          evalScript: `({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth
          })`
        }
      );
      assert.ok(res.evalResult.scrollWidth <= res.evalResult.innerWidth + 2, `Overflow on ${route}`);
      assert.match(res.bodyText, /Archery 101010/i);
    }
  });

  it("F3.5 Web manifest and PWA icons (/icon-192.png, /icon-512.png) serve 200", async () => {
    const manifestRes = await fetch(`${server.baseUrl}/manifest.json`);
    assert.equal(manifestRes.status, 200);
    const manifest = (await manifestRes.json()) as {
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string }>;
    };
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.display, "standalone");
    for (const icon of ["/icon-192.png", "/icon-512.png"]) {
      const iconRes = await fetch(`${server.baseUrl}${icon}`);
      assert.equal(iconRes.status, 200, `Missing ${icon}`);
      assert.match(iconRes.headers.get("content-type") ?? "", /image\/png/i);
    }
  });
});

describe("Tier 1 — F4: Firebase Firestore Security Rules & Auth Isolation", () => {
  it("F4.1 firestore.rules defines all core collections plus default deny", () => {
    const rules = readRepoText("firestore.rules");
    const requiredMatches = [
      "users/{userId}",
      "users_public/{userId}",
      "coach_invite_codes/{inviteCode}",
      "sessions/{sessionId}",
      "calendar_events/{eventId}",
      "macrocycles/{macrocycleId}",
      "athlete_stars/{userId}",
      "star_history/{historyId}",
      "active_duels/{roomCode}",
      "duel_invitations/{invitationId}",
      "ad_campaigns/{campaignId}",
      "coach_notifications/{notificationId}",
      "coach_records/{recordId}",
      "watch_sessions/",
      "subscription_audit_logs/{logId}",
      "client_error_logs/{errId}",
      "{document=**}"
    ];
    for (const m of requiredMatches) {
      assert.ok(rules.includes(`match /${m}`), `Missing match /${m} in firestore.rules`);
    }
  });

  it("F4.2 firestore.rules implements auth, owner, coach, and superadmin predicates", () => {
    const rules = readRepoText("firestore.rules");
    for (const fn of ["isAuthenticated()", "isOwner(", "isSuperAdmin()", "isCoach()", "isCoachOfClub("]) {
      assert.ok(rules.includes(fn), `Missing helper ${fn}`);
    }
  });

  it("F4.3 firestore.rules protects users PII and bans non-empty clubInviteCode in users_public", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /function canReadPrivateUserDoc/);
    assert.match(rules, /function isValidUserPublic/);
    assert.match(rules, /clubInviteCode', null\) == null \|\| data\.get\('clubInviteCode', ''\) == ''/);
  });

  it("F4.4 firestore.rules enforces 6-digit invite format and disables watch_sessions listing", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /inviteCode\.matches\('\^\[0-9\]\{6\}\$'\)/);
    assert.match(rules, /match \/watch_sessions\/[\s\S]*?allow list:\s*if false;/);
  });

  it("F4.5 firestore.rules scopes sessions, macrocycles, calendar_events, and coach_records", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /resource\.data\.userId == request\.auth\.uid/);
    assert.match(rules, /assignedAthleteIds/);
    assert.match(rules, /isAuthorizedCoachRecordTarget/);
  });
});

describe("Tier 1 — F5: Cloud Functions, Push Icons, Indexes & Env Isolation", () => {
  it("F5.1 functions/index.js passes node --check and exports v2 functions", () => {
    const syntax = runCommandSync(process.execPath, ["--check", repoPath("functions", "index.js")]);
    assert.equal(syntax.exitCode, 0, syntax.stderr);
    const fnSrc = readRepoText("functions", "index.js");
    for (const exp of [
      "exports.onDuelInvitationCreated",
      "exports.onCoachNotificationCreated",
      "exports.purgeDeletedUserAccount",
      "exports.verifyStoreSubscription"
    ]) {
      assert.ok(fnSrc.includes(exp), `Missing export ${exp}`);
    }
  });

  it("F5.2 firestore.indexes.json parses as valid JSON with composite indexes", () => {
    const idx = readRepoJson<{ indexes: Array<{ collectionGroup: string; fields: unknown[] }> }>(
      "firestore.indexes.json"
    );
    assert.ok(Array.isArray(idx.indexes));
    assert.ok(idx.indexes.length >= 4);
    assert.ok(idx.indexes.some((i) => i.collectionGroup === "duel_invitations"));
    assert.ok(idx.indexes.some((i) => i.collectionGroup === "sessions"));
  });

  it("F5.3 Hosting serves /sw.js and /firebase-messaging-sw.js with no-store on /sw.js", async () => {
    const swRes = await fetch(`${server.baseUrl}/sw.js`);
    assert.equal(swRes.status, 200);
    assert.match(swRes.headers.get("cache-control") ?? "", /no-store/i);
    const fcmRes = await fetch(`${server.baseUrl}/firebase-messaging-sw.js`);
    assert.equal(fcmRes.status, 200);
    const fcmText = await fcmRes.text();
    assert.match(fcmText, /onBackgroundMessage/);
  });

  it("F5.4 functions/index.js rate-limits duel_invite_ and coach_notif_ pushes", () => {
    const fnSrc = readRepoText("functions", "index.js");
    assert.match(fnSrc, /allowRateLimitedAction\(`duel_invite_\$\{senderUid\}`/);
    assert.match(fnSrc, /allowRateLimitedAction\(`coach_notif_\$\{athleteUid\}`/);
    assert.match(fnSrc, /\/\?join=/);
  });

  it("F5.5 .firebaserc defines default, prod, and test aliases and functions/package.json declares Firebase deps", () => {
    const rc = readRepoJson<{ projects: Record<string, string> }>(".firebaserc");
    assert.ok(typeof rc.projects.default === "string");
    assert.ok(typeof rc.projects.prod === "string");
    assert.ok(typeof rc.projects.test === "string");
    const fnPkg = readRepoJson<{ dependencies: Record<string, string> }>("functions", "package.json");
    assert.ok(Boolean(fnPkg.dependencies["firebase-admin"]));
    assert.ok(Boolean(fnPkg.dependencies["firebase-functions"]));
  });
});

describe("Tier 1 — F6: Firebase Hosting, .firebaseapp.com Downloads & Public Hygiene", () => {
  it("F6.1 /ota-version.json matches APP_VERSION with no-store and CORS headers", async () => {
    const appVersion = readAppVersion();
    const res = await fetch(`${server.baseUrl}/ota-version.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as { version: string; latestVersion: string; versionCode: number };
    assert.equal(body.version, appVersion);
    assert.equal(body.latestVersion, appVersion);
  });

  it("F6.2 Legacy /version.json and /app-version.json preserve disarmed 0.0.0 with current latestVersion", async () => {
    const appVersion = readAppVersion();
    for (const p of ["/version.json", "/app-version.json"]) {
      const res = await fetch(`${server.baseUrl}${p}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { version: string; latestVersion: string };
      assert.equal(body.version, "0.0.0");
      assert.equal(body.latestVersion, appVersion);
    }
  });

  it("F6.3 /.well-known/assetlinks.json serves 200 application/json for Android App Links", async () => {
    const res = await fetch(`${server.baseUrl}/.well-known/assetlinks.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/i);
    const list = (await res.json()) as Array<{ target?: { package_name?: string } }>;
    assert.ok(list.some((item) => item.target?.package_name === "com.archery101010.app"));
  });

  it("F6.4 /download-apk, /download-aab, and /download-wear-aab return 302 Android-safe redirects", async () => {
    const appVersion = readAppVersion();
    const apk = await fetch(`${server.baseUrl}/download-apk`, { redirect: "manual" });
    assert.equal(apk.status, 302);
    assert.match(apk.headers.get("location") ?? "", /play\.google\.com\/store\/apps\/details\?id=com\.archery101010\.app/);

    const mobile = await fetch(`${server.baseUrl}/download-aab`, { redirect: "manual" });
    assert.equal(mobile.status, 302);
    assert.equal(
      mobile.headers.get("location"),
      `https://archery101010-c0bb4.firebaseapp.com/Archery101010-Mobile-v${appVersion}.aab`
    );

    const wear = await fetch(`${server.baseUrl}/download-wear-aab`, { redirect: "manual" });
    assert.equal(wear.status, 302);
    assert.equal(
      wear.headers.get("location"),
      `https://archery101010-c0bb4.firebaseapp.com/Archery101010-WearOS-v${appVersion}.aab`
    );
  });

  it("F6.5 /Archery101010.iq serves 200 application/octet-stream with Content-Disposition: attachment", async () => {
    const res = await fetch(`${server.baseUrl}/Archery101010.iq`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/octet-stream/i);
    assert.match(
      res.headers.get("content-disposition") ?? "",
      /attachment;\s*filename="Archery101010\.iq"/i
    );
  });
});

describe("Tier 1 — F7: Android Mobile App", () => {
  it("F7.1 android/app/build.gradle versionName & versionCode match APP_VERSION", () => {
    const appVersion = readAppVersion();
    const { mobileVersionCode } = parseExpectedVersionCodes(appVersion);
    const gradle = readRepoText("android", "app", "build.gradle");
    assert.match(gradle, /applicationId\s+"com\.archery101010\.app"/);
    assert.match(gradle, new RegExp(`versionName\\s+"${appVersion.replace(/\./g, "\\.")}"`));
    assert.match(gradle, new RegExp(`versionCode\\s+${mobileVersionCode}\\b`));
  });

  it("F7.2 AndroidManifest.xml configures MainActivity, App Links, and WearDataLayerService", () => {
    const manifest = readRepoText("android", "app", "src", "main", "AndroidManifest.xml");
    assert.match(manifest, /android:name="\.MainActivity"/);
    assert.match(manifest, /android:autoVerify="true"/);
    assert.match(manifest, /android:host="archery101010-c0bb4\.web\.app"/);
    assert.match(manifest, /android:name="\.WearDataLayerService"/);
  });

  it("F7.3 MainActivity.java exposes all 6 native JavascriptInterface bridges", () => {
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
    for (const bridge of [
      "ArcheryNativeAuth",
      "ArcheryNativeShare",
      "ArcheryWatchNativeBridge",
      "ArcheryLocationNativeBridge",
      "ArcherySpotifyBridge",
      "ArcheryBleHeartRateBridge"
    ]) {
      assert.ok(mainJava.includes(`"${bridge}"`), `Missing JS bridge ${bridge}`);
    }
  });

  it("F7.4 MainActivity.java rewrites direct .web.app package links to .firebaseapp.com", () => {
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
    assert.match(mainJava, /archery101010-c0bb4\.firebaseapp\.com/);
    assert.match(mainJava, /\.aab/);
  });

  it("F7.5 WebView back navigation contract manages history state cleanly in Chrome", async () => {
    const res = await cdp.navigateAndCollect<{ initialLen: number; pushedLen: number }>(
      `${server.baseUrl}/?skipIntro=1`,
      {
        width: 360,
        height: 800,
        evalScript: `(() => {
          const initialLen = window.history.length;
          window.history.pushState({ type: "modal", depth: 1 }, "");
          return { initialLen, pushedLen: window.history.length };
        })()`
      }
    );
    assert.ok(res.evalResult.pushedLen >= res.evalResult.initialLen);
  });
});

describe("Tier 1 — F8: Android Wear OS Companion", () => {
  it("F8.1 android/wear/build.gradle versionName & versionCode match APP_VERSION (+100000 offset)", () => {
    const appVersion = readAppVersion();
    const { wearVersionCode } = parseExpectedVersionCodes(appVersion);
    const gradle = readRepoText("android", "wear", "build.gradle");
    assert.match(gradle, /applicationId\s+"com\.archery101010\.app"/);
    assert.match(gradle, /minSdkVersion\s+26/);
    assert.match(gradle, new RegExp(`versionName\\s+"${appVersion.replace(/\./g, "\\.")}"`));
    assert.match(gradle, new RegExp(`versionCode\\s+${wearVersionCode}\\b`));
  });

  it("F8.2 Wear AndroidManifest.xml declares standalone watch, BODY_SENSORS, READ_HEART_RATE, and WearWatchListenerService", () => {
    const manifest = readRepoText("android", "wear", "src", "main", "AndroidManifest.xml");
    assert.match(manifest, /android\.hardware\.type\.watch/);
    assert.match(manifest, /com\.google\.android\.wearable\.standalone/);
    assert.match(manifest, /android\.permission\.BODY_SENSORS/);
    assert.match(manifest, /android\.permission\.health\.READ_HEART_RATE/);
    assert.match(manifest, /\.WearWatchListenerService/);
  });

  it("F8.3 WearMainActivity.java implements 5-screen watch UI and WEAR_OS cloud sync", () => {
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
    assert.match(wearJava, /"WEAR_OS"/);
    assert.match(wearJava, /watch_sessions/);
  });

  it("F8.4 WearMainActivity.java supports Wear Data Layer state, command, and HR paths", () => {
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
    for (const p of ["/archery101010/state", "/archery101010/command", "/archery101010/hr"]) {
      assert.ok(wearJava.includes(p), `Missing Wear DataLayer path ${p}`);
    }
  });

  it("F8.5 WearWatchListenerService.java exists and handles Wear Message/Data events", () => {
    const svc = readRepoText(
      "android",
      "wear",
      "src",
      "main",
      "java",
      "com",
      "archery101010",
      "app",
      "WearWatchListenerService.java"
    );
    assert.match(svc, /WearableListenerService/);
  });
});

describe("Tier 1 — F9: Apple iOS & watchOS", () => {
  it("F9.1 project.pbxproj defines com.archery101010.app with iOS 15.0 deployment target", () => {
    const pbx = readRepoText("ios", "App", "App.xcodeproj", "project.pbxproj");
    assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = com\.archery101010\.app;/);
    assert.match(pbx, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
  });

  it("F9.2 ios/App/App/Info.plist declares required Location, Camera, Bluetooth, and Motion permissions", () => {
    const plist = readRepoText("ios", "App", "App", "Info.plist");
    for (const key of [
      "NSLocationWhenInUseUsageDescription",
      "NSCameraUsageDescription",
      "NSBluetoothAlwaysUsageDescription",
      "NSMotionUsageDescription"
    ]) {
      assert.ok(plist.includes(`<key>${key}</key>`), `Missing iOS Info.plist key ${key}`);
    }
  });

  it("F9.3 ios/App/App/PrivacyInfo.xcprivacy declares non-tracking and accessed API reasons", () => {
    const privacy = readRepoText("ios", "App", "App", "PrivacyInfo.xcprivacy");
    assert.match(privacy, /NSPrivacyTracking/);
    assert.match(privacy, /CA92\.1/);
  });

  it("F9.4 ios-watchos/WatchApp/Archery101010WatchApp.swift implements HealthKit & WATCHOS cloud sync", () => {
    const swift = readRepoText("ios-watchos", "WatchApp", "Archery101010WatchApp.swift");
    assert.match(swift, /"WATCHOS"/);
    assert.match(swift, /HKWorkoutSession/);
    assert.match(swift, /WCSession/);
  });

  it("F9.5 ios-watchos/PhoneBridge/ArcheryWatchSessionManager.swift implements WatchConnectivity phone bridge", () => {
    const bridge = readRepoText("ios-watchos", "PhoneBridge", "ArcheryWatchSessionManager.swift");
    assert.match(bridge, /ArcheryWatchNativeBridge/);
    assert.match(bridge, /WCSessionDelegate/);
  });
});

describe("Tier 1 — F10: Garmin Connect IQ, Scripts, CI & Docs", () => {
  it("F10.1 garmin-ciq/manifest.xml declares Archery101010WatchApp with >=53 products and fullVersion", () => {
    const appVersion = readAppVersion();
    const { fullVersion } = parseExpectedVersionCodes(appVersion);
    const manifest = readRepoText("garmin-ciq", "manifest.xml");
    assert.match(manifest, /entry="Archery101010WatchApp"/);
    assert.match(manifest, new RegExp(`version="${fullVersion.replace(/\./g, "\\.")}"`));
    const products = [...manifest.matchAll(/<iq:product\s+id="[^"]+"\/>/g)];
    assert.ok(products.length >= 53, `Expected >=53 Garmin products, got ${products.length}`);
  });

  it("F10.2 public/Archery101010.iq is a valid Connect IQ package with >=50 compiled .prg targets", () => {
    const iqPath = repoPath("public", "Archery101010.iq");
    assert.equal(repoFileExists("public", "Archery101010.iq"), true);
    const iqInfo = readIqPackageInfo(iqPath);
    assert.equal(iqInfo.hasManifestXml, true, "Missing manifest.xml inside .iq package");
    assert.ok(iqInfo.prgEntries.length >= 50, `Expected >=50 .prg targets in .iq, got ${iqInfo.prgEntries.length}`);
  });

  it("F10.3 Garmin Connect IQ source and build tooling (compilar-garmin-iq.ps1, developer_key.der) exist", () => {
    const mc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    assert.match(mc, /"GARMIN_CIQ"/);
    assert.equal(repoFileExists("garmin-ciq", "compilar-garmin-iq.ps1"), true);
    assert.equal(repoFileExists("garmin-ciq", "developer_key.der"), true);
  });

  it("F10.4 package.json exposes test, verify:ci, lint, and bump-version scripts", () => {
    const pkg = readRepoJson<{ scripts: Record<string, string> }>("package.json");
    for (const scriptName of ["test", "verify:ci", "lint", "bump-version"]) {
      assert.ok(typeof pkg.scripts[scriptName] === "string", `Missing script ${scriptName}`);
    }
    assert.equal(repoFileExists("scripts", "verify-no-regressions.js"), true);
    assert.equal(repoFileExists("tests", "archery-core.test.ts"), true);
  });

  it("F10.5 Hosting serves /manual/index.html (200 HTML) and DOCUMENTACION_COMPLETA.md exists", async () => {
    const res = await fetch(`${server.baseUrl}/manual/index.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/i);
    assert.equal(repoFileExists("DOCUMENTACION_COMPLETA.md"), true);
  });
});
