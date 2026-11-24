import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startStaticOutServer, type StaticOutServerHandle } from "./helpers/staticOutServer.ts";
import { CdpClient } from "./helpers/cdpClient.ts";
import {
  CDP_NO_TRUNCATION_AUDIT_SCRIPT,
  extractBracedBlock,
  extractParenCallBlocks,
  findTrademarkViolations,
  listAllFilesRecursive,
  parseBitmapFont,
  readAppVersion,
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

describe("Tier 2 — F1: Web Core, Scoring, Timer & Analysis Boundaries", () => {
  it("F1.N1 AUD-WEB-01 FloatingClock avoids side-effects inside setTimeLeft updater", () => {
    const src = readRepoText("src", "components", "scoring", "FloatingClock.tsx");
    const setTimeLeftCalls = extractParenCallBlocks(src, /\bsetTimeLeft\s*\(/);
    assert.ok(setTimeLeftCalls.length > 0, "FloatingClock must invoke setTimeLeft");
    const functionalUpdaters = setTimeLeftCalls.filter((call) => /=>/.test(call));
    const timerLoopBlock = extractBracedBlock(src, /const\s+startTimerLoop\s*=\s*\(\s*\)\s*=>\s*\{/);
    assert.ok(timerLoopBlock, "FloatingClock must define startTimerLoop");
    assert.ok(
      functionalUpdaters.length > 0 || /\bsetTimeLeft\s*\(/.test(timerLoopBlock),
      "FloatingClock startTimerLoop must update timeLeft"
    );
    for (const call of functionalUpdaters) {
      const bracedUpdater = extractBracedBlock(call, /=>\s*\{/);
      const arrowIdx = call.indexOf("=>");
      const targetBody = bracedUpdater ?? call.slice(arrowIdx + 2);
      assert.doesNotMatch(
        targetBody,
        /\b(setPhase|setIsActive|setTimeLeft|setTotalPhaseTime|playShootSignal|playEndSignal|speakNumber)\s*\(/,
        "FloatingClock must not trigger state/audio side-effects inside setTimeLeft functional updater"
      );
    }
    assert.doesNotMatch(
      src,
      /setPhase\(["']prep["']\)[\s\S]{0,200}startTimerLoop\(\)/,
      "handleStart must not invoke startTimerLoop() synchronously before phase state commits"
    );
  });

  it("F1.N2 AUD-WEB-02 ScoringView debounces autoSave, aligns draft IDs, and guards closing in handleSaveDraft", () => {
    const src = readRepoText("src", "components", "scoring", "ScoringView.tsx");
    const autoSaveBlock = src.slice(
      src.indexOf("const autoSave = async"),
      src.indexOf("const autoSave = async") + 2600
    );
    assert.match(autoSaveBlock, /setTimeout\s*\(/, "ScoringView autoSave must be debounced");
    assert.doesNotMatch(
      src,
      /const sessionId = config\.draftId \|\| config\.id \|\| `SES-DRAFT-\$\{user\.uid\}`/,
      "autoSave must use aligned activeSessionIdRef instead of conflicting SES-DRAFT-* ID"
    );
    const saveDraftIdx = src.indexOf("const handleSaveDraft");
    assert.ok(saveDraftIdx !== -1);
    const saveDraftBlock = src.slice(saveDraftIdx, saveDraftIdx + 800);
    assert.match(
      saveDraftBlock,
      /isClosingSessionRef\.current\s*=\s*true/,
      "handleSaveDraft must set isClosingSessionRef.current = true before closing"
    );
  });

  it("F1.N3 AUD-WEB-12 ScoringView guards multi-touch (touches.length === 1) and clamps magnifier within viewport", () => {
    const src = readRepoText("src", "components", "scoring", "ScoringView.tsx");
    assert.match(src, /touches\.length\s*(===|!==|>|<)\s*1/);
    assert.doesNotMatch(
      src,
      /left:\s*lupaState\.clientX\s*-\s*86,\s*\n\s*top:\s*lupaState\.clientY\s*-\s*185/,
      "Floating magnifier must clamp left/top to viewport bounds instead of raw clientX-86/clientY-185"
    );
  });

  it("F1.N4 AUD-WEB-11 & AUD-GAR-03 AnalysisView resets manualStopAt(0), uses Date.now(), and resets isFinishingRef in finally", () => {
    const src = readRepoText("src", "components", "analysis", "AnalysisView.tsx");
    const manualStartIdx = src.indexOf("const handleManualStart");
    assert.ok(manualStartIdx !== -1);
    const manualStartBlock = src.slice(manualStartIdx, manualStartIdx + 600);
    assert.match(
      manualStartBlock,
      /setManualStopAt\(\s*0\s*\)/,
      "handleManualStart must reset setManualStopAt(0) so Garmin/watches do not block shot #2+"
    );
    assert.doesNotMatch(
      src,
      /updatedAt:\s*sessionStartTsRef\.current\s*\+\s*shots\.length/,
      "persistSessionSnapshot must use real Date.now() instead of synthetic sessionStartTs + shots.length"
    );
    const finishIdx = src.indexOf("const handleSaveAndFinishSession");
    assert.ok(finishIdx !== -1);
    const finishBlock = src.slice(finishIdx, finishIdx + 1400);
    assert.match(finishBlock, /finally\s*\{[\s\S]*isFinishingRef\.current\s*=\s*false/);
  });

  it("F1.N5 AUD-WEB-13 & AUD-WEB-15 HistoryView waits for auth, CalendarView avoids loop, SessionConfig supports imperial yd", () => {
    const hist = readRepoText("src", "components", "history", "HistoryView.tsx");
    assert.match(hist, /onAuthStateChanged/, "HistoryView must wait for auth state before remote sync");

    const cal = readRepoText("src", "components", "calendar", "CalendarView.tsx");
    const syncMacroMatch = cal.match(/useEffect\([\s\S]{0,800}setSyncMacroId[\s\S]{0,600}\[[^\]]*syncMacroId[^\]]*\]/);
    assert.equal(syncMacroMatch, null, "CalendarView must not include syncMacroId in deps of effect mutating it");

    const cfg = readRepoText("src", "components", "scoring", "SessionConfigView.tsx");
    assert.match(cfg, /\byd\b/, "SessionConfigView must support imperial yard (yd) labels");
  });

  it("F1.N6 AUD-WEB-09 & AUD-WEB-14 SmartwatchMiniApp hoists WatchFaceContent and preserves pairing across visibilitychange", () => {
    const src = readRepoText("src", "components", "watch", "SmartwatchMiniApp.tsx");
    const mainExportIdx = src.indexOf("export default function SmartwatchMiniApp");
    assert.ok(mainExportIdx !== -1);
    const insideComponent = src.slice(mainExportIdx);
    assert.doesNotMatch(
      insideComponent,
      /function\s+WatchFaceContent\b|const\s+WatchFaceContent\s*=/,
      "WatchFaceContent must be hoisted outside SmartwatchMiniApp render"
    );
    assert.doesNotMatch(
      src,
      /disconnectWatchClientPairingCode\(\);[\s\S]{0,400}\[isStandalone,\s*isPageVisible\]/,
      "SmartwatchMiniApp must NOT disconnect pairing code on page visibilitychange cleanup"
    );
  });
});

describe("Tier 2 — F2: Matchplay 1v1, Zoom, Sharing & Ads Boundaries", () => {
  it("F2.N1 AUD-WEB-03 Matchplay next-end does not unconditionally wipe opponent end summary", () => {
    const src = readRepoText("src", "components", "matchplay", "MatchplayGameView.tsx");
    const idx = src.indexOf('case "next-end"');
    assert.ok(idx !== -1);
    const block = src.slice(idx, idx + 700);
    assert.doesNotMatch(
      block,
      /case "next-end":\s*\{\s*\n[\s\S]{0,180}\n\s*setEndSummary\(null\);\s*\n\s*setEndSummaryMsg\(null\);\s*\n\s*setValidationPhase\("IDLE"\);/,
      "next-end handler must guard active validation/endSummary state before resetting opponent view"
    );
  });

  it("F2.N2 AUD-WEB-05 Matchplay zoom magnifier does not feed 0..100 SVG viewBox coords directly to getCoordsFromClient", () => {
    const src = readRepoText("src", "components", "matchplay", "MatchplayGameView.tsx");
    assert.doesNotMatch(
      src,
      /getCoordsFromClient\(\s*cursorPos\.x\s*,\s*cursorPos\.y\s*\)/,
      "Matchplay zoom must not pass SVG % cursorPos directly into viewport getCoordsFromClient()"
    );
  });

  it("F2.N3 AUD-WEB-10 Sharing uses https://wa.me/ fallback and adManager avoids .web.app download hijacks", () => {
    for (const segments of [
      ["src", "components", "matchplay", "MatchplayGameView.tsx"],
      ["src", "components", "coach", "tabs", "CoachSessionsTab.tsx"],
      ["src", "lib", "scoring", "targetImageGenerator.ts"]
    ]) {
      const src = readRepoText(...segments);
      assert.doesNotMatch(
        src,
        /whatsapp:\/\/send/,
        `${segments.join("/")} must use https://wa.me/ or Web Share/clipboard instead of whatsapp://send`
      );
    }
    const adMgr = readRepoText("src", "lib", "adManager.ts");
    assert.doesNotMatch(
      adMgr,
      /archery101010-c0bb4\.web\.app\/[^\s"']*\.(?:aab|iq|pdf)/i,
      "adManager direct download links must use .firebaseapp.com, not .web.app"
    );
  });

  it("F2.N4 AUD-WEB-16 & AUD-WEB-13 Ad banners validate http(s): URLs and page.tsx wires BannerWidget onSlideClick", () => {
    for (const comp of [
      ["src", "components", "ads", "BannerWidget.tsx"],
      ["src", "components", "ads", "AdPopupOverlay.tsx"],
      ["src", "components", "ads", "NotificationBar.tsx"]
    ]) {
      const src = readRepoText(...comp);
      assert.match(
        src,
        /https?:/i,
        `${comp.join("/")} must validate http:/https: protocol before window.open()`
      );
    }
    const page = readRepoText("src", "app", "page.tsx");
    assert.doesNotMatch(
      page,
      /onSlideClick=\{?\(\)\s*=>\s*\{\s*\}\}?/,
      "page.tsx must wire BannerWidget onSlideClick handler (no empty noop)"
    );
  });

  it("F2.N5 AUD-WEB-13, AUD-WEB-14 & AUD-FB-13 MatchplayLobby awaits setDoc, drafts use id/userId, and unmount preserves opponent WebRTC", () => {
    const lobby = readRepoText("src", "components", "matchplay", "MatchplayLobbyView.tsx");
    assert.doesNotMatch(
      lobby,
      /setCreatedRoomCode\([^)]+\);\s*\n\s*await\s+setDoc/,
      "MatchplayLobbyView must await setDoc before revealing created room code"
    );
    const game = readRepoText("src", "components", "matchplay", "MatchplayGameView.tsx");
    const draftBlock = extractBracedBlock(game, /const\s+draftSession\s*=\s*\{/);
    assert.ok(draftBlock, "MatchplayGameView must define draftSession");
    assert.doesNotMatch(
      draftBlock,
      /\buid:\s*config\.id\b|\buserUid:\s*user\.uid\b/,
      "MatchplayGameView duel draftSession must use id/userId instead of uid/userUid (AUD-WEB-14)"
    );
    assert.match(draftBlock, /\bid:\s*config\.id\b/);
    assert.match(draftBlock, /\buserId:\s*user\.uid\b/);
    assert.doesNotMatch(
      game,
      /webrtcOffer:\s*null[\s\S]{0,120}webrtcAnswer:\s*null/,
      "Matchplay unmount cleanup must not wipe both players' WebRTC offer/answer simultaneously"
    );
  });
});

describe("Tier 2 — F3: Brand Compliance, PNG Logo & No-Truncation UI Boundaries", () => {
  it("F3.N1 GEMINI.md R1 & AUD-WEB-08 Header uses official brand_logo_header.png instead of CSS Good Times 101010 spans", async () => {
    const header = readRepoText("src", "components", "ui", "Header.tsx");
    assert.match(header, /\/images\/brand_logo_header\.png/);
    assert.doesNotMatch(header, /brand-logo-101010[\s\S]{0,160}Good Times/);

    const domCheck = await cdp.navigateAndCollect<{
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
    assert.equal(domCheck.evalResult.hasCss101010Spans, false);
    assert.equal(domCheck.evalResult.hasOfficialLogoImg, true);
  });

  it("F3.N2 GEMINI.md R5 & AUD-WEB-07 Zero third-party trademarks in UI components, /manual/index.html, or live DOM", async () => {
    for (const route of ["/?skipIntro=1", "/watch", "/privacy", "/terms", "/manual/index.html"]) {
      const res = await cdp.navigateAndCollect(`${server.baseUrl}${route}`, {
        width: 360,
        height: 800
      });
      const hits = findTrademarkViolations(res.bodyText);
      assert.deepEqual(
        hits,
        [],
        `Forbidden third-party trademarks found on live DOM ${route}: ${JSON.stringify(hits)}`
      );
    }

    for (const rel of [
      ["src", "components", "ui", "FloatingNav.tsx"],
      ["src", "components", "admin", "tabs", "AdminSettingsTab.tsx"]
    ]) {
      const src = readRepoText(...rel)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\bopen-spotify-player\b/g, "")
        .replace(/\bSpotifyFloatingPlayer\b/g, "")
        .replace(/\bSpotifyNavIcon\b/g, "")
        .replace(/\bset?SpotifyEnabled\b/gi, "")
        .replace(/\bspotifyEnabled\b/g, "")
        .replace(/id:\s*["']SPOTIFY["']/g, "");
      const hits = findTrademarkViolations(src, ["Spotify", "Strava", "WHOOP", "Nike", "Instagram", "Facebook"]);
      assert.deepEqual(hits, [], `Trademark violation in visible UI copy of ${rel.join("/")}: ${JSON.stringify(hits)}`);
    }
  });

  it("F3.N3 GEMINI.md R6 & AUD-WEB-15 Zero ellipsis/truncation/clipping on live DOM at 360x800 and Coach/Notification bars", async () => {
    for (const route of ["/?skipIntro=1", "/watch", "/privacy", "/terms"]) {
      const res = await cdp.navigateAndCollect<{
        vw: number;
        docOverflow: boolean;
        ellipsisElements: unknown[];
        clippedElements: unknown[];
        literalEllipsisTexts: unknown[];
      }>(`${server.baseUrl}${route}`, {
        width: 360,
        height: 800,
        evalScript: CDP_NO_TRUNCATION_AUDIT_SCRIPT
      });
      assert.equal(res.evalResult.docOverflow, false, `Document overflow on ${route}`);
      assert.deepEqual(res.evalResult.ellipsisElements, [], `Ellipsis CSS/class on ${route}`);
      assert.deepEqual(res.evalResult.clippedElements, [], `Clipped text on ${route}`);
      assert.deepEqual(res.evalResult.literalEllipsisTexts, [], `Literal '...' truncation on ${route}`);
    }

    const coachPortal = readRepoText("src", "components", "coach", "CoachPortalView.tsx");
    const gridIdx = coachPortal.indexOf("grid-cols-5");
    assert.ok(gridIdx !== -1);
    const gridBlock = coachPortal.slice(gridIdx, gridIdx + 1800);
    assert.doesNotMatch(
      gridBlock,
      /overflow-hidden[\s\S]{0,800}whitespace-nowrap|whitespace-nowrap[\s\S]{0,800}overflow-hidden/,
      "CoachPortalView 5-tab bar must not clip labels with whitespace-nowrap + overflow-hidden"
    );
  });

  it("F3.N4 AUD-WEB-04 & AUD-WEB-06 AthleteDetailSheet guards highestStarLevel===0 and views guard empty fullName", () => {
    const sheet = readRepoText("src", "components", "coach", "AthleteDetailSheet.tsx");
    assert.doesNotMatch(
      sheet,
      /const prevMin = tiers\[currentLevel - 1\]\.minScore;/,
      "AthleteDetailSheet must guard currentLevel <= 0 instead of indexing tiers[-1]"
    );
    const profile = readRepoText("src", "components", "profile", "ProfileView.tsx");
    assert.doesNotMatch(profile, /user\.fullName\.substring\(/, "ProfileView must guard empty/undefined fullName");
    const macro = readRepoText("src", "components", "coach", "tabs", "CoachMacrocycleTab.tsx");
    assert.doesNotMatch(macro, /a\.fullName\.substring\(/, "CoachMacrocycleTab must guard empty/undefined fullName");
  });

  it("F3.N5 AUD-FB-06 & AUD-WEB-17 realtimeSync retains assigned macrocycles for independent archers and CoachMacrocycleTab filters demos", () => {
    const sync = readRepoText("src", "lib", "db", "realtimeSync.ts");
    const shouldAcceptIdx = sync.indexOf("shouldAcceptRemoteDoc");
    assert.ok(shouldAcceptIdx !== -1);
    const block = sync.slice(shouldAcceptIdx, shouldAcceptIdx + 900);
    assert.match(
      block,
      /assignedAthleteIds/,
      "realtimeSync shouldAcceptRemoteDoc must check assignedAthleteIds before rejecting macrocycles without clubId"
    );

    const macroTab = readRepoText("src", "components", "coach", "tabs", "CoachMacrocycleTab.tsx");
    assert.doesNotMatch(
      macroTab,
      /getAllLocal<[^>]+>\(["']macrocycles["']\)[\s\S]{0,80}setMacrocycles\(all\)/,
      "CoachMacrocycleTab must filter demo macrocycles when reloading local store"
    );
  });
});

describe("Tier 2 — F4: Firebase Firestore Security Rules & Auth Isolation (Option 1a)", () => {
  it("F4.N1 AUD-FB-01 Option 1a: Two-collection Spark-safe watch_pairings + 256-bit watch_sessions lock", () => {
    const rules = readRepoText("firestore.rules");
    // Pre-fix vulnerable rule allowed unauth get/update on 6-digit watch_sessions/{pairingCode}
    const pairingsBlock = extractBracedBlock(rules, /match\s+\/watch_pairings\/\{pairingCode\}/);
    assert.ok(pairingsBlock, "Option 1a requires watch_pairings/{pairingCode} ephemeral 6-digit pairing doc");
    assert.match(pairingsBlock, /allow list:\s*if false;/, "watch_pairings must disable listing");
    const pairingsGetMatch = pairingsBlock.match(/allow get:\s*([^;]+);/);
    assert.ok(pairingsGetMatch, "watch_pairings must define allow get rule");
    const pairingsGetRule = pairingsGetMatch[1];
    assert.match(
      pairingsGetRule,
      /pairingCode\.matches\('\^\[0-9\]\{6\}\$'\)/,
      "watch_pairings allow get must validate 6-digit pairingCode"
    );
    assert.match(
      pairingsGetRule,
      /pairingOpenUntil\s*>\s*request\.time\.toMillis\(\)/,
      "watch_pairings allow get must enforce active pairingOpenUntil > request.time.toMillis()"
    );
    assert.match(
      pairingsGetRule,
      /(?:resource\.data\.get\(\s*'claimed'\s*,\s*false\s*\)\s*!=\s*true|resource\.data\.claimed\s*==\s*false|claimed\s*!=\s*true)/,
      "watch_pairings allow get must enforce unclaimed pairing for unauthenticated reads"
    );
    assert.match(
      pairingsGetRule,
      /watchOwnerHash\(\s*request\.auth\.uid\s*\)/,
      "watch_pairings allow get must scope authenticated owner reads via watchOwnerHash(request.auth.uid)"
    );
    assert.match(
      pairingsGetRule,
      /isSuperAdmin\(\)/,
      "watch_pairings allow get must allow isSuperAdmin()"
    );

    const watchSessionsBlock = extractBracedBlock(rules, /match\s+\/watch_sessions\/\{sessionToken\}/);
    assert.ok(watchSessionsBlock, "Option 1a requires watch_sessions/{sessionToken} keyed by unguessable 256-bit token");
    assert.match(watchSessionsBlock, /allow list:\s*if false;/, "watch_sessions must disable listing");
    assert.match(
      watchSessionsBlock,
      /allow update:[\s\S]*isValidWatchTelemetryUpdate\s*\(/,
      "watch_sessions unauthenticated update must enforce isValidWatchTelemetryUpdate"
    );

    const telemetryFn = extractBracedBlock(rules, /function\s+isValidWatchTelemetryUpdate\b/);
    assert.ok(telemetryFn, "Missing isValidWatchTelemetryUpdate helper");
    assert.match(telemetryFn, /affectedKeys\(\)\.hasOnly\(/, "Watch telemetry update must restrict affectedKeys().hasOnly(...)");
    assert.match(
      telemetryFn,
      /data\.get\(\s*'watchDeviceId'\s*,\s*''\s*\)\s*==\s*resource\.data\.watchDeviceId/,
      "Watch telemetry update must lock watchDeviceId once claimed"
    );

    assert.match(rules, /\[A-Za-z0-9_-\]\{32,64\}/);
    assert.doesNotMatch(
      rules,
      /match \/watch_sessions\/\{pairingCode\}[\s\S]{0,600}pairingCode\.matches\('\^\[0-9\]\{6\}\$'\)[\s\S]{0,200}isWatchSessionNotExpired/,
      "watch_sessions must NOT allow unauthenticated 6-digit pairingCode lookups/writes"
    );
  });

  it("F4.N2 AUD-FB-02 Option 1a: Blocks client self-granting PRO plan and client subscription_audit_logs creation", () => {
    const rules = readRepoText("firestore.rules");
    const subBlock = extractBracedBlock(rules, /match\s+\/subscription_audit_logs\/\{logId\}/);
    assert.ok(subBlock, "Missing subscription_audit_logs match block");
    const subMatch = subBlock.match(/allow create:\s*([^;]+);/);
    assert.ok(subMatch, "Missing subscription_audit_logs create rule");
    assert.match(
      subMatch[1],
      /isSuperAdmin\(\)/,
      "subscription_audit_logs allow create must require isSuperAdmin()"
    );
    assert.doesNotMatch(
      subMatch[1],
      /request\.resource\.data\.userId\s*==\s*request\.auth\.uid/,
      "Regular clients must NOT be allowed to forge subscription_audit_logs"
    );
    assert.match(
      rules,
      /isValidPlanMutationOnCreate|isValidPlanMutationOnUpdate/,
      "firestore.rules must enforce server-authoritative PRO plan mutation guard on create/update"
    );
  });

  it("F4.N3 AUD-FB-03 Option 1a: Blocks client self-escalation to coach / team_admin / isClubCreator", () => {
    const rules = readRepoText("firestore.rules");
    const onCreateBlock = extractBracedBlock(rules, /function\s+isNotSelfEscalatingCoachClubOnCreate\b/);
    assert.ok(onCreateBlock, "Missing isNotSelfEscalatingCoachClubOnCreate");
    assert.match(
      onCreateBlock,
      /data\.role\s*==\s*'archer'/,
      "isNotSelfEscalatingCoachClubOnCreate must enforce data.role == 'archer' for non-superadmin creates"
    );
    assert.match(
      onCreateBlock,
      /isClubCreator/,
      "isNotSelfEscalatingCoachClubOnCreate must forbid isClubCreator: true on client create"
    );

    const onUpdateBlock = extractBracedBlock(rules, /function\s+isNotSelfEscalatingCoachClubOnUpdate\b/);
    assert.ok(onUpdateBlock, "Missing isNotSelfEscalatingCoachClubOnUpdate");
    assert.match(
      onUpdateBlock,
      /oldRole\s+in\s+\[\s*'coach'\s*,\s*'team_admin'\s*,\s*'team_admin_coach'\s*\][\s\S]*newRole\s+in\s+\[\s*'coach'\s*,\s*'team_admin'\s*,\s*'team_admin_coach'\s*\]/,
      "isNotSelfEscalatingCoachClubOnUpdate must gate coach/team_admin roles on oldRole already being coach/team_admin"
    );
  });

  it("F4.N4 AUD-FB-04, AUD-FB-07 & AUD-FB-08 Option 1a: Restricts athlete_stars reads, strips email from coach_invite_codes, requires email_verified", () => {
    const rules = readRepoText("firestore.rules");
    const starsRead = rules.match(/match \/athlete_stars\/\{userId\}[\s\S]{0,300}allow read:\s*([^;]+);/);
    assert.ok(starsRead);
    assert.notEqual(
      starsRead[1].trim(),
      "if isAuthenticated()",
      "athlete_stars read must be scoped to owner/coach/club/superadmin, not global isAuthenticated()"
    );

    const inviteValidator = rules.match(/function isValidCoachInviteCodeDoc[\s\S]*?\n\s*\}/);
    assert.ok(inviteValidator);
    assert.ok(
      !inviteValidator[0].includes("'email'") ||
        /data\.get\('email',\s*''\)\s*==\s*''\s*\|\|\s*isSuperAdmin\(\)/.test(inviteValidator[0]),
      "coach_invite_codes must strip or forbid non-empty coach email PII for non-superadmins"
    );

    const canRead = rules.match(/function canReadPrivateUserDoc[\s\S]*?\n\s*\}/);
    assert.ok(canRead);
    assert.match(
      canRead[0],
      /email_verified/,
      "canReadPrivateUserDoc token.email match must require email_verified == true"
    );

    const authSvc = readRepoText("src", "lib", "authService.ts");
    assert.match(
      authSvc,
      /(?:isSuperAdminEmail|isVerifiedSuperAdmin|superadmin)[\s\S]{0,600}(?:emailVerified|email_verified)|(?:emailVerified|email_verified)[\s\S]{0,600}(?:isSuperAdminEmail|isVerifiedSuperAdmin|superadmin)/i,
      "Client superadmin checks in authService.ts must enforce emailVerified/email_verified"
    );
  });

  it("F4.N5 AUD-FB-13 Collection isolation on calendar_events, ad_campaigns, duel_invitations, active_duels, sessions", () => {
    const rules = readRepoText("firestore.rules");
    const duelCreate = rules.match(/match \/duel_invitations\/\{invitationId\}[\s\S]{0,600}allow create:\s*([^;]+);/);
    assert.ok(duelCreate);
    assert.match(
      rules,
      /receiverUid\s*!=\s*(request\.auth\.uid|request\.resource\.data\.senderUid)|senderUid\s*!=\s*(?:request\.resource\.data\.)?receiverUid/,
      "duel_invitations must reject self-invitations"
    );

    const monoFn = extractBracedBlock(rules, /function\s+isValidMonotonicMetric\b/);
    assert.ok(monoFn, "Missing isValidMonotonicMetric in firestore.rules");
    assert.match(monoFn, /newVal\s*>=\s*base/);
    assert.match(monoFn, /newVal\s*<=\s*base\s*\+\s*1/, "ad_campaigns monotonic metric must enforce newVal <= base + 1");

    const adMetricFn = extractBracedBlock(rules, /function\s+isValidAdMetricUpdate\b/);
    assert.ok(adMetricFn, "Missing isValidAdMetricUpdate in firestore.rules");
    assert.match(adMetricFn, /isValidMonotonicMetric\(/);

    const adCampaignsBlock = extractBracedBlock(rules, /match\s+\/ad_campaigns\/\{campaignId\}/);
    assert.ok(adCampaignsBlock, "Missing ad_campaigns match block");
    assert.match(adCampaignsBlock, /allow update:[\s\S]*isValidAdMetricUpdate\(/);

    const calToggleFn = extractBracedBlock(rules, /function\s+isValidCalendarChecklistToggle\b/);
    assert.ok(calToggleFn, "Missing isValidCalendarChecklistToggle in firestore.rules");
    assert.match(
      calToggleFn,
      /affectedKeys\(\)\.hasOnly\(\[\s*request\.auth\.uid\s*\]\)/,
      "calendar_events checklist toggle must scope completedByAthlete edits to request.auth.uid"
    );

    const activeDuelsBlock = extractBracedBlock(rules, /match\s+\/active_duels\/\{roomCode\}/);
    assert.ok(activeDuelsBlock, "Missing active_duels match block");
    assert.match(activeDuelsBlock, /request\.resource\.data\.creatorUid\s*==\s*resource\.data\.creatorUid/);
    assert.match(activeDuelsBlock, /isValidDuelParticipantMutation\(/);

    const sessionsBlock = extractBracedBlock(rules, /match\s+\/sessions\/\{sessionId\}/);
    assert.ok(sessionsBlock, "Missing sessions match block");
    assert.match(
      sessionsBlock,
      /resource\.data\.get\(\s*'clubId'\s*,\s*null\s*\)\s*!=\s*null[\s\S]{0,80}resource\.data\.get\(\s*'clubId'\s*,\s*''\s*\)\s*!=\s*''/,
      "sessions coach read must require non-empty clubId so private personal sessions stay isolated"
    );
    assert.match(sessionsBlock, /request\.resource\.data\.userId\s*==\s*resource\.data\.userId/);
  });

  it("F4.N6 AUD-FB-14 firestore.rules bounds nested maps (bowConfig, physicalData, biometrics, blockStats)", () => {
    const rules = readRepoText("firestore.rules");
    assert.match(rules, /isValidBowConfigMap|validOptionalBoundedMap\(\s*data\s*,\s*['"]bowConfig['"]/);
    assert.match(rules, /isValidPhysicalDataMap|validOptionalBoundedMap\(\s*data\s*,\s*['"]physicalData['"]/);
  });

  it("F4.N7 AUD-FB-05 ProfileView & CoachPortalView club/athlete queries align with users_public / canReadPrivateUserDoc", () => {
    const profile = readRepoText("src", "components", "profile", "ProfileView.tsx");
    const loadCoachBlock = extractBracedBlock(profile, /async\s+function\s+loadCoachInfo\b/);
    assert.ok(loadCoachBlock, "Missing loadCoachInfo in ProfileView.tsx");
    assert.doesNotMatch(
      loadCoachBlock,
      /collection\(\s*db\s*,\s*["']users["']\s*\)[\s\S]{0,120}where\(\s*["']clubId["']/,
      "ProfileView loadCoachInfo must query users_public (not private users collection) by clubId"
    );

    const coachPortal = readRepoText("src", "components", "coach", "CoachPortalView.tsx");
    assert.doesNotMatch(
      coachPortal,
      /collection\(\s*db\s*,\s*["']users["']\s*\)[\s\S]{0,120}where\(\s*["']clubInviteCode["']/,
      "CoachPortalView must not query private users collection by clubInviteCode (triggers PERMISSION_DENIED on collisions)"
    );
  });
});

describe("Tier 2 — F5: Cloud Functions, Push Icons, Indexes & Env Isolation (Option 1a)", () => {
  it("F5.N1 AUD-FB-02 & Option 1a: functions/index.js implements hardened callables + watchCloudBridge + billingService integration", () => {
    const fnSrc = readRepoText("functions", "index.js");
    for (const fnName of [
      "promoteToCoachClub",
      "verifyStoreSubscription",
      "restoreStoreSubscription",
      "lookupCoachInviteCode",
      "rotateCoachInviteCode",
      "purgeDeletedUserAccount",
      "watchCloudBridge"
    ]) {
      assert.ok(fnSrc.includes(`exports.${fnName}`), `Missing Cloud Function export: ${fnName}`);
    }
    assert.match(fnSrc, /store_receipt_claims/, "verifyStoreSubscription must enforce anti-replay claims");
    assert.doesNotMatch(fnSrc, /Math\.random\(\)/, "functions/index.js must use crypto instead of Math.random()");
    const billing = readRepoText("src", "lib", "billingService.ts");
    assert.match(billing, /verifyStoreSubscription/);
  });

  it("F5.N2 AUD-FB-09 Account purge covers all 15+ collections + admin.auth().deleteUser(uid) + paginated client purge", () => {
    const fnSrc = readRepoText("functions", "index.js");
    for (const col of [
      "macrocycles",
      "duel_invitations",
      "watch_sessions",
      "subscription_audit_logs",
      "client_error_logs",
      "coach_invite_codes"
    ]) {
      assert.ok(fnSrc.includes(`"${col}"`) || fnSrc.includes(`'${col}'`), `purgeDeletedUserAccount missing ${col}`);
    }
    assert.match(fnSrc, /(?:admin\.auth\(\)|auth)\.deleteUser\(/);
  });

  it("F5.N3 AUD-FB-11 .firebaserc test alias isolated from prod, functions Node >= 22, functions/node_modules present", () => {
    const rc = readRepoJson<{ projects: Record<string, string> }>(".firebaserc");
    assert.notEqual(
      rc.projects.test,
      rc.projects.prod,
      ".firebaserc 'test' alias must NOT point to production project"
    );
    const fnPkg = readRepoJson<{ engines?: { node?: string } }>("functions", "package.json");
    const nodeVer = Number(String(fnPkg.engines?.node ?? "0").replace(/\D/g, ""));
    assert.ok(nodeVer >= 22, `functions/package.json engines.node must be >= 22, got ${fnPkg.engines?.node}`);
    assert.equal(repoFileExists("functions", "node_modules"), true, "functions/node_modules must be installed");
  });

  it("F5.N4 AUD-FB-12 Rate limiter fails closed, FCM SW uses /icon-192.png & Firebase 12.x, Android has ic_stat_notify", () => {
    const fnSrc = readRepoText("functions", "index.js");
    const rlMatch = fnSrc.match(/async function allowRateLimitedAction[\s\S]*?\n\}/);
    assert.ok(rlMatch);
    assert.doesNotMatch(
      rlMatch[0],
      /catch\s*\([^)]*\)\s*\{[\s\S]{0,200}return true;/,
      "allowRateLimitedAction must fail closed (return false) on transaction error"
    );
    assert.match(fnSrc, /fcmTokens/, "Push delivery must support multi-device fcmTokens array");

    const fcmSw = readRepoText("public", "firebase-messaging-sw.js");
    assert.doesNotMatch(fcmSw, /\/icons\/icon-192x192\.png/, "FCM SW must use /icon-192.png, not missing /icons/icon-192x192.png");
    assert.match(fcmSw, /firebasejs\/12\./, "FCM SW compat SDK should align with Firebase 12.x");

    const resFiles = listAllFilesRecursive(repoPath("android", "app", "src", "main", "res"));
    assert.ok(
      resFiles.some((f) => path.basename(f).startsWith("ic_stat_notify")),
      "android/app/src/main/res must contain ic_stat_notify icon resource"
    );
  });

  it("F5.N5 AUD-FB-15 & AUD-FB-16 firestore.indexes.json declares all 3 missing composite indexes and Admin writes cleanly", () => {
    const idx = readRepoJson<{
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>;
    }>("firestore.indexes.json");
    const hasIndex = (col: string, f1: string, f2: string): boolean =>
      idx.indexes.some(
        (i) =>
          i.collectionGroup === col &&
          i.fields.some((f) => f.fieldPath === f1) &&
          i.fields.some((f) => f.fieldPath === f2)
      );
    assert.equal(hasIndex("duel_invitations", "senderUid", "status"), true, "Missing duel_invitations(senderUid, status)");
    assert.equal(hasIndex("active_duels", "status", "clubId"), true, "Missing active_duels(status, clubId)");
    assert.equal(hasIndex("coach_records", "type", "athleteUid"), true, "Missing coach_records(type, athleteUid)");

    const adminUsers = readRepoText("src", "components", "admin", "tabs", "AdminUsersTab.tsx");
    assert.match(adminUsers, /newPlan:/, "AdminUsersTab subscription audit log must record newPlan");
  });
});

describe("Tier 2 — F6: Firebase Hosting, .firebaseapp.com Downloads & Public Hygiene Boundaries", () => {
  it("F6.N1 AUD-FB-10 Missing .aab, .pdf, and .iq paths return 404 (NEVER HTTP 200 index.html)", async () => {
    for (const missingPath of [
      "/nonexistent-package-v999.9.aab",
      "/nonexistent-guide.pdf",
      "/nonexistent-watch.iq"
    ]) {
      const res = await fetch(`${server.baseUrl}${missingPath}`);
      assert.equal(
        res.status,
        404,
        `Missing asset ${missingPath} must return 404 (not rewrite ** -> 200 index.html)`
      );
    }
  });

  it("F6.N2 AUD-FB-10 & GEMINI.md R6 Versioned Mobile & WearOS .aab endpoints exist and serve attachment headers", async () => {
    const appVersion = readAppVersion();
    for (const aabName of [
      `Archery101010-Mobile-v${appVersion}.aab`,
      `Archery101010-WearOS-v${appVersion}.aab`
    ]) {
      const res = await fetch(`${server.baseUrl}/${aabName}`, { method: "HEAD" });
      assert.equal(res.status, 200, `Expected ${aabName} in out/`);
      assert.match(res.headers.get("content-type") ?? "", /application\/octet-stream/i);
      assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`attachment;\\s*filename="${aabName.replace(/\./g, "\\.")}"`, "i"));
    }
  });

  it("F6.N3 AUD-FB-14 HTTP / includes Content-Security-Policy header", async () => {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp && csp.includes("default-src"), "Hosting must serve Content-Security-Policy header");
  });

  it("F6.N4 AUD-QA-04 Public/out directories contain zero private/trademarked PDFs or t-shirt draft PNGs and no orphan PDF headers", () => {
    for (const dir of ["public", "out"]) {
      if (!fs.existsSync(repoPath(dir))) continue;
      const dirFiles = fs.readdirSync(repoPath(dir));
      const badAssets = dirFiles.filter(
        (f) => f.toLowerCase().endsWith(".pdf") || /^archery101010-tshirt-/i.test(f)
      );
      assert.deepEqual(badAssets, [], `Prune internal/trademarked assets from ${dir}/: ${badAssets.join(", ")}`);
    }
    const fbJson = readRepoText("firebase.json");
    assert.doesNotMatch(fbJson, /Guia-Neon-vs-Carbon-Archery101010-Movil\.pdf/);
  });

  it("F6.N5 AUD-GAR-10 & AUD-IOS-05 Stale Archery101010-Garmin-CIQ.zip and Archery101010-v2.124.iq are removed", () => {
    assert.equal(repoFileExists("public", "Archery101010-Garmin-CIQ.zip"), false);
    assert.equal(repoFileExists("ios", "App", "App", "public", "Archery101010-v2.124.iq"), false);
  });
});

describe("Tier 2 — F7: Android Mobile App Boundaries", () => {
  it("F7.N1 AUD-AND-01 MainActivity registers OnBackPressedCallback (LIFO) + exitApp() for OTA back navigation", () => {
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
    assert.match(mainJava, /OnBackPressedCallback/, "MainActivity must register OnBackPressedCallback after super.onCreate()");
    assert.match(mainJava, /__onNativeAndroidBack/, "MainActivity must evaluate window.__onNativeAndroidBack()");
    assert.match(mainJava, /void\s+exitApp\s*\(/, "ArcheryNativeAuth must expose exitApp() for OTA origin");
  });

  it("F7.N2 AUD-AND-02, AUD-AND-15 & AUD-QA-01 Android gitignore protects keystores, buildDir redirected outside OneDrive, InstrumentedTest package fixed", () => {
    const androidGitignore = readRepoText("android", ".gitignore");
    assert.match(androidGitignore, /^\*\.jks$/m, "android/.gitignore must ignore *.jks");
    assert.match(androidGitignore, /^\*\.keystore$/m, "android/.gitignore must ignore *.keystore");
    assert.match(androidGitignore, /^keystore\.properties$/m, "android/.gitignore must ignore keystore.properties");

    const rootGradle = readRepoText("android", "build.gradle");
    assert.match(rootGradle, /buildDirectory/, "android/build.gradle must redirect buildDir outside OneDrive");

    const instrTest = readRepoText(
      "android",
      "app",
      "src",
      "androidTest",
      "java",
      "com",
      "getcapacitor",
      "myapp",
      "ExampleInstrumentedTest.java"
    );
    assert.match(instrTest, /com\.archery101010\.app/);
    assert.doesNotMatch(instrTest, /"com\.getcapacitor\.app"/);
  });

  it("F7.N3 AUD-AND-04 & AUD-AND-05 Location Foreground Service declared, WakeLock released in onDestroy, appUrlOpen handled", () => {
    const manifest = readRepoText("android", "app", "src", "main", "AndroidManifest.xml");
    assert.match(manifest, /FOREGROUND_SERVICE_LOCATION/);
    assert.match(manifest, /foregroundServiceType="location"/);

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
    const onDestroyIdx = mainJava.indexOf("public void onDestroy()");
    assert.ok(onDestroyIdx !== -1);
    const onDestroyBlock = mainJava.slice(onDestroyIdx, onDestroyIdx + 1200);
    assert.match(onDestroyBlock, /releaseSessionTrackingWakeLock|sessionTrackingWakeLock[\s\S]{0,120}\.release\(/);

    const page = readRepoText("src", "app", "page.tsx");
    const backNav = readRepoText("src", "lib", "navigation", "backNavigation.ts");
    assert.match(page + backNav, /appUrlOpen/, "JS must register Capacitor appUrlOpen listener for App Links");
  });

  it("F7.N4 AUD-AND-07, 08, 09, 10, 14 Queue flush checks listener readiness, CSV uses downloadOrShareFile, IME insets, camera persistence, strict Google auth hosts", () => {
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
    const flushIdx = mainJava.indexOf("flushPendingWatchCommandsToWebView");
    assert.ok(flushIdx !== -1);
    const flushBlock = mainJava.slice(flushIdx, flushIdx + 800);
    const readyIdx = flushBlock.indexOf("isWebWatchListenerReady");
    const clearIdx = flushBlock.indexOf("remove(KEY_PENDING_WATCH_COMMANDS)");
    assert.ok(readyIdx !== -1 && (clearIdx === -1 || readyIdx < clearIdx), "Must check isWebWatchListenerReady BEFORE clearing queue");

    assert.match(mainJava, /ime\(\)/, "WindowInsets must include Type.ime()");
    assert.match(mainJava, /displayCutout\(\)/, "WindowInsets must include Type.displayCutout()");
    assert.doesNotMatch(mainJava, /host\.endsWith\("\.google\.com"\)/, "Privileged WebView must not whitelist all *.google.com subdomains");

    assert.match(
      mainJava,
      /(?:onSaveInstanceState|savedInstanceState|KEY_PENDING_CAMERA|pending_camera)[\s\S]{0,600}pendingCameraCaptureFile|pendingCameraCaptureFile[\s\S]{0,600}(?:onSaveInstanceState|savedInstanceState|KEY_PENDING_CAMERA|pending_camera)/,
      "AUD-AND-10: MainActivity must persist pendingCameraCaptureFile across Activity recreation"
    );

    const interceptBlock = extractBracedBlock(mainJava, /public\s+WebResourceResponse\s+shouldInterceptRequest\b/);
    assert.ok(interceptBlock, "Missing shouldInterceptRequest in MainActivity.java");
    assert.doesNotMatch(
      interceptBlock,
      /if\s*\(\s*urlStr\.startsWith\("https:\/\/archery101010-c0bb4\.firebaseapp\.com\/__\/auth\/handler"\)\s*\|\|\s*\n?\s*urlStr\.startsWith\("https:\/\/archery101010-c0bb4\.web\.app\/__\/auth\/handler"\)\s*\)\s*\{/,
      "AUD-AND-08: shouldInterceptRequest must not unconditionally hijack all /__/auth/handler requests"
    );

    const hist = readRepoText("src", "components", "history", "HistoryView.tsx");
    assert.match(hist, /downloadOrShareFile/, "HistoryView CSV export must use downloadOrShareFile for Android WebView compatibility");
  });

  it("F7.N5 AUD-AND-13 aaptOptions excludes .iq/.pdf/.mp4 and Capacitor android public assets omit bloated media", () => {
    const appGradle = readRepoText("android", "app", "build.gradle");
    assert.match(appGradle, /\*\.iq/, "aaptOptions.ignoreAssetsPattern must exclude *.iq");
    assert.match(appGradle, /\*\.pdf/, "aaptOptions.ignoreAssetsPattern must exclude *.pdf");
    assert.match(appGradle, /\*\.mp4/, "aaptOptions.ignoreAssetsPattern must exclude *.mp4");
  });
});

describe("Tier 2 — F8: Android Wear OS Companion Boundaries", () => {
  it("F8.N1 AUD-AND-11 WearMainActivity removes unpermitted AudioRecord DSP (0 MissingPermission lint errors)", () => {
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
    assert.doesNotMatch(wearJava, /new\s+AudioRecord\s*\(/, "WearMainActivity must remove unpermitted AudioRecord call");
  });

  it("F8.N2 AUD-AND-12 WearMainActivity replaces deprecated onBackPressed() with OnBackPressedCallback", () => {
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
    assert.doesNotMatch(wearJava, /public\s+void\s+onBackPressed\s*\(/);
    assert.match(wearJava, /OnBackPressedCallback/);
  });

  it("F8.N3 AUD-AND-03 WearMainActivity guards Integer.parseInt against non-numeric undo tokens", () => {
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
    const matches = [...wearJava.matchAll(/Integer\.parseInt\(removed\)/g)];
    for (const m of matches) {
      const ctx = wearJava.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120);
      assert.match(ctx, /try\s*\{/, "Integer.parseInt(removed) must be guarded with try/catch NumberFormatException");
    }
  });

  it("F8.N4 AUD-AND-06 WearMainActivity.onPause() unconditionally releases WakeLock and sensors", () => {
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
    const onPauseIdx = wearJava.indexOf("protected void onPause()");
    assert.ok(onPauseIdx !== -1);
    const block = wearJava.slice(onPauseIdx, onPauseIdx + 900);
    assert.doesNotMatch(block, /if\s*\(\s*idleNoSession\s*\)/, "onPause must not gate WakeLock/sensor release behind idleNoSession");
  });

  it("F8.N5 AUD-AND-07 WearMainActivity caps analysisShotJson <= 3500 and handles HTTP 403 expiration", () => {
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
    assert.match(shotSlice, /3500|3400|3000/, "WearMainActivity must cap analysisShotJson <= 3500 chars");
    assert.match(shotSlice, /length\(\)|substring\(|Math\.min/, "WearMainActivity must check length/substring when capping analysisShotJson");

    assert.doesNotMatch(
      wearJava,
      /else\s+if\s*\([^)]*404[^)]*403[^)]*\)\s*\{[^}]*cloudLinkStatus\s*=\s*"NOT_FOUND"/,
      "WearMainActivity must NOT classify HTTP 403 as NOT_FOUND"
    );
    assert.match(
      wearJava,
      /(?:rc|responseCode|code)\s*==\s*403[\s\S]{0,180}cloudLinkStatus\s*=\s*"(?!NOT_FOUND)[A-Z_]+"/,
      "WearMainActivity must set an expired/auth error state on HTTP 403 distinct from NOT_FOUND"
    );
  });
});

describe("Tier 2 — F9: Apple iOS & watchOS Boundaries", () => {
  it("F9.N1 AUD-IOS-01 & AUD-IOS-02 project.pbxproj compiles ArcheryWatchSessionManager.swift & SceneDelegate registers ArcheryWatchNativeBridge", () => {
    const pbx = readRepoText("ios", "App", "App.xcodeproj", "project.pbxproj");
    assert.match(pbx, /ArcheryWatchSessionManager\.swift in Sources/);
    const scene = readRepoText("ios", "App", "App", "SceneDelegate.swift");
    assert.match(scene, /ArcheryWatchNativeBridge/);
  });

  it("F9.N2 AUD-IOS-03 iOS OAuth supports ASWebAuthenticationSession/ASAuthorizationController, entitlements, URL types, and AASA", () => {
    const scene = readRepoText("ios", "App", "App", "SceneDelegate.swift");
    const appDel = readRepoText("ios", "App", "App", "AppDelegate.swift");
    assert.match(scene + appDel, /ASWebAuthenticationSession|ASAuthorizationController/);
    const plist = readRepoText("ios", "App", "App", "Info.plist");
    assert.match(plist, /CFBundleURLTypes/);
    assert.equal(
      repoFileExists("public", ".well-known", "apple-app-site-association"),
      true,
      "Missing public/.well-known/apple-app-site-association"
    );
  });

  it("F9.N3 AUD-IOS-04, AUD-IOS-06 & AUD-QA-03 Info.plist uses arm64 + bluetooth-central + encryption flag, BLE shim complete, dark LaunchScreen", () => {
    const plist = readRepoText("ios", "App", "App", "Info.plist");
    assert.doesNotMatch(plist, /<string>armv7<\/string>/);
    assert.match(plist, /<string>arm64<\/string>/);
    assert.match(plist, /bluetooth-central/);
    assert.match(plist, /ITSAppUsesNonExemptEncryption/);

    const scene = readRepoText("ios", "App", "App", "SceneDelegate.swift");
    assert.match(scene, /getLastWearHeartRateJson/);

    const storyboard = readRepoText("ios", "App", "App", "Base.lproj", "LaunchScreen.storyboard");
    assert.doesNotMatch(storyboard, /systemBackgroundColor/, "LaunchScreen must use OLED dark background instead of systemBackgroundColor");
  });

  it("F9.N4 AUD-WATCH-01, 02, 05 & AUD-IOS-05 watchOS target & Assets.xcassets in pbxproj, synced versions, safe mic & HealthKit", () => {
    const appVersion = readAppVersion();
    const escapedAppVer = appVersion.replace(/\./g, "\\.");
    const pbx = readRepoText("ios", "App", "App.xcodeproj", "project.pbxproj");
    assert.match(pbx, /watchos|WatchApp/i, "project.pbxproj must define watchOS target");
    assert.match(pbx, new RegExp(`MARKETING_VERSION = ${escapedAppVer};`));
    assert.equal(repoFileExists("ios-watchos", "WatchApp", "Assets.xcassets"), true);

    const watchPlist = readRepoText("ios-watchos", "WatchApp", "Info.plist");
    assert.match(
      watchPlist,
      new RegExp(`<string>(?:${escapedAppVer}|\\$\\(MARKETING_VERSION\\))</string>`),
      "WatchApp/Info.plist must carry current APP_VERSION or $(MARKETING_VERSION)"
    );

    const watchSwift = readRepoText("ios-watchos", "WatchApp", "Archery101010WatchApp.swift");
    if (/requestRecordPermission/.test(watchSwift)) {
      assert.match(watchPlist, /NSMicrophoneUsageDescription/);
    }
    assert.match(watchSwift, /stopHeartRateStreaming\(\)[\s\S]{0,600}finishSession|finishSession[\s\S]{0,600}stopHeartRateStreaming/);
  });

  it("F9.N5 AUD-WATCH-03..08 watchOS serialized FIFO sync, 403 handling, _ts TTL, no 40mm .lineLimit(1) truncation", () => {
    const watchSwift = readRepoText("ios-watchos", "WatchApp", "Archery101010WatchApp.swift");
    const bridgeSwift = readRepoText("ios-watchos", "PhoneBridge", "ArcheryWatchSessionManager.swift");

    // AUD-WATCH-03: Serialized FIFO cloud queue + ack-before-reset in finishSession()
    const finishBlock = extractBracedBlock(watchSwift, /func\s+finishSession\s*\(/);
    assert.ok(finishBlock, "Missing finishSession() in Archery101010WatchApp.swift");
    assert.doesNotMatch(
      finishBlock,
      /sendCommandToPhone\(\[\s*"type":\s*"FINISH_SESSION_FROM_WATCH"\s*\]\)\s*\n\s*resetSessionCounters\(/,
      "AUD-WATCH-03: finishSession() must confirm/ack before calling resetSessionCounters()"
    );
    assert.match(
      watchSwift,
      /pendingCloudQueue|cloudPatchQueue|pendingPatches|cloudQueue|DispatchQueue\([^)]*label:/i,
      "AUD-WATCH-03: watchOS must serialize Firestore PATCHes through a FIFO queue"
    );

    // AUD-WATCH-06: _ts TTL staleness check on incoming WatchConnectivity payloads
    assert.match(
      bridgeSwift,
      /"_ts"/,
      "AUD-WATCH-06: ArcheryWatchSessionManager must check incoming _ts TTL to reject stale transferUserInfo replay"
    );

    assert.match(watchSwift, /statusCode\s*==\s*403|403/);
    assert.doesNotMatch(watchSwift, /72\.0\s*\*\s*0\.78/, "watchOS kcal calculation must use athlete weight when available, not fixed 72.0");
    assert.doesNotMatch(
      watchSwift,
      /struct WatchBrandHeaderView[\s\S]{0,600}\.lineLimit\(1\)/,
      "WatchBrandHeaderView must not truncate with .lineLimit(1) without scale/wrapping"
    );
  });
});

describe("Tier 2 — F10: Garmin Connect IQ, Scripts, CI & Docs Boundaries", () => {
  it("F10.N1 AUD-GAR-01 & AUD-GAR-02 Garmin uses persistent FIFO queue in Application.Storage and acks before reset", () => {
    const mc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    assert.doesNotMatch(
      mc,
      /function finishSessionAndReset\(\)\s*\{\s*\n\s*syncWithPhoneApp\("FINISH_SESSION_FROM_WATCH",\s*null\);\s*\n\s*resetAllCounters\(""\);/,
      "finishSessionAndReset() must confirm and wait for ack before wiping counters"
    );
    assert.match(mc, /Storage\.setValue\([^)]*(queue|pending)/i, "Garmin must persist offline command queue in Application.Storage");
  });

  it("F10.N2 AUD-GAR-04, AUD-GAR-05 & AUD-GAR-08 Garmin supports button-only score cycling/undo, 403 termination, and Back confirmation", () => {
    const mc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    const nextPageIdx = mc.indexOf("function onNextPage()");
    assert.ok(nextPageIdx !== -1);
    const buttonBlock = mc.slice(nextPageIdx, nextPageIdx + 2500);
    assert.match(buttonBlock, /selectedScoreIdx/, "Garmin button navigation must cycle selectedScoreIdx for non-touch watches");

    const patchRespBlock = extractBracedBlock(mc, /function\s+onCloudPatchResponse\b/);
    assert.ok(patchRespBlock, "Missing onCloudPatchResponse in Archery101010WatchApp.mc");
    assert.match(
      patchRespBlock,
      /if\s*\([^)]*\b403\b[^)]*\)\s*\{[^}]*(?:mPendingRetryCmd\s*=\s*null|mPending[A-Za-z]*Queue|pending[A-Za-z]*Queue|remove\(|slice\(|clear)/,
      "AUD-GAR-05: onCloudPatchResponse must clear mPendingRetryCmd/queue on HTTP 403 to stop infinite PATCH loop"
    );

    const onBackBlock = extractBracedBlock(mc, /function\s+onBack\s*\(/);
    assert.ok(onBackBlock, "Missing onBack() in Archery101010WatchApp.mc");
    assert.match(
      onBackBlock,
      /confirm|lastBack|backPress|exitConfirm|Prompt/i,
      "AUD-GAR-08: onBack() on home screen must require confirmation/double-press before exiting"
    );
  });

  it("F10.N3 AUD-GAR-06, AUD-GAR-07 & AUD-GAR-09 All 3 Garmin .fnt fonts include '%' glyph (id=37), monochrome Instinct 2 rendering, and duplicate strings-spa removed", () => {
    for (const fontName of ["outfit_micro.fnt", "outfit_label.fnt", "outfit_value.fnt"]) {
      const parsed = parseBitmapFont(["garmin-ciq", "resources", "fonts", fontName]);
      assert.equal(
        parsed.hasPercentGlyph,
        true,
        `${fontName} is missing '%' (char id=37) glyph`
      );
    }
    assert.equal(
      repoFileExists("garmin-ciq", "resources", "strings-spa", "strings.xml"),
      false,
      "Duplicate garmin-ciq/resources/strings-spa/strings.xml must be removed"
    );
    const mc = readRepoText("garmin-ciq", "source", "Archery101010WatchApp.mc");
    const headerBlock = extractBracedBlock(mc, /function\s+drawArchery101010Header\b/);
    assert.ok(headerBlock);
    assert.match(
      headerBlock,
      /isMono|minDim\s*<=\s*180/,
      "AUD-GAR-07: drawArchery101010Header must handle monochrome Instinct 2 rendering"
    );
    const dotsBlock = extractBracedBlock(mc, /function\s+drawPagerDots\b/);
    assert.ok(dotsBlock);
    assert.match(
      dotsBlock,
      /isMono|minDim\s*<=\s*180/,
      "AUD-GAR-07: drawPagerDots must handle monochrome Instinct 2 rendering"
    );
    const monoDrawables = readRepoText("garmin-ciq", "resources-mono", "drawables", "drawables.xml");
    assert.match(monoDrawables, /id="LauncherIcon"/);
    assert.doesNotMatch(mc, /function\s+startAcoustic|\(:typecheck\(false\)\)/, "Remove (:typecheck(false)) / dead acoustic code");
  });

  it("F10.N4 AUD-QA-02 & AUD-QA-03 Active GitHub CI workflows exist (no ephemeral RSA keygen), sharp installed, eslint ignores ios/ & functions/", () => {
    assert.equal(repoFileExists(".github", "workflows"), true, "Missing .github/workflows directory");
    const workflowFiles = fs
      .readdirSync(repoPath(".github", "workflows"))
      .filter((f) => /\.ya?ml$/i.test(f));
    assert.ok(workflowFiles.length > 0, ".github/workflows must contain active workflow YAML files");
    for (const wf of workflowFiles) {
      const wfText = readRepoText(".github", "workflows", wf);
      assert.doesNotMatch(wfText, /openssl genrsa/, `.github/workflows/${wf} must never generate ephemeral RSA keys`);
    }

    const pkg = readRepoJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>("package.json");
    assert.ok(
      Boolean(pkg.dependencies?.sharp || pkg.devDependencies?.sharp),
      "sharp must be declared in package.json for generate-garmin-resources.js"
    );
    const eslintCfg = readRepoText("eslint.config.mjs");
    assert.match(eslintCfg, /ios\/\*\*/);
    assert.match(eslintCfg, /functions\/\*\*/);

    const garminWorkflow = repoFileExists("garmin-ciq", "github-workflow-template.yml")
      ? readRepoText("garmin-ciq", "github-workflow-template.yml")
      : "";
    assert.doesNotMatch(garminWorkflow, /openssl genrsa/, "CI workflow must never generate ephemeral RSA keys for Garmin");
  });

  it("F10.N5 AUD-QA-04, AUD-QA-05 & AUD-IOS-05 Scripts contain zero hardcoded C:/Users or C:\\Users paths, increment-version updates iOS, zero MODULE_TYPELESS warning", () => {
    const scriptsDir = repoPath("scripts");
    for (const file of fs.readdirSync(scriptsDir)) {
      if (!file.endsWith(".js")) continue;
      const content = fs.readFileSync(path.join(scriptsDir, file), "utf8");
      assert.doesNotMatch(
        content,
        /C:[\\/]Users[\\/]Archery 101010/i,
        `scripts/${file} must not contain hardcoded local C:/Users or C:\\Users path`
      );
    }
    const inc = readRepoText("scripts", "increment-version.js");
    assert.match(inc, /project\.pbxproj/, "increment-version.js must update iOS project.pbxproj version");
    assert.match(inc, /WatchApp\/Info\.plist|Info\.plist/, "increment-version.js must update watchOS Info.plist version");

    const coreCheck = runCommandSync(process.execPath, ["--test", repoPath("tests", "archery-core.test.ts")]);
    assert.equal(coreCheck.exitCode, 0);
    assert.doesNotMatch(
      coreCheck.stderr,
      /MODULE_TYPELESS_PACKAGE_JSON/,
      "Running Node tests should not emit MODULE_TYPELESS_PACKAGE_JSON warning"
    );
  });

  it("F10.N6 AUD-DOC-01 DOCUMENTACION_COMPLETA.md & /manual/index.html match current version, $9.99 pricing, no-glow, watches & Analysis Mode", () => {
    const appVersion = readAppVersion();
    const docs = readRepoText("DOCUMENTACION_COMPLETA.md");
    const manual = readRepoText("public", "manual", "index.html");
    for (const [label, content] of [
      ["DOCUMENTACION_COMPLETA.md", docs],
      ["public/manual/index.html", manual]
    ] as const) {
      assert.ok(content.includes(appVersion), `${label} must document current version ${appVersion}`);
      assert.doesNotMatch(content, /v2\.3\.0/i, `${label} still references stale v2.3.0`);
      assert.doesNotMatch(content, /\/api\/paypal\/webhook/i, `${label} still references obsolete /api/paypal/webhook`);
      assert.doesNotMatch(content, /\$4\.99/i, `${label} still references obsolete $4.99 pricing`);
      assert.match(content, /9\.99/, `${label} must document $9.99 monthly plan`);
      assert.match(
        content,
        /Wear OS|watchOS|Smartwatch Deportivo|Reloj Inteligente/i,
        `${label} must document smartwatch integration without third-party trademarks`
      );
      assert.match(content, /Análisis|Analysis/i, `${label} must document Analysis Mode`);
    }
  });
});
