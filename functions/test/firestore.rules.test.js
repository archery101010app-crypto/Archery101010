const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  limit,
  increment
} = require("firebase/firestore");

const PROJECT_ID = "archery101010-c0bb4";
const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

function sha256Hex(v) {
  return crypto.createHash("sha256").update(String(v), "utf8").digest("hex").toLowerCase();
}

let testEnv;

function authedDb(uid, tokenOverrides = {}) {
  return testEnv.authenticatedContext(uid, { email_verified: true, ...tokenOverrides }).firestore();
}

function unauthedDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function superAdminDb() {
  return testEnv
    .authenticatedContext("super-uid", {
      email: "admin@archery101010.com",
      email_verified: true
    })
    .firestore();
}

async function seedDocs(docsByPath) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [docPath, data] of Object.entries(docsByPath)) {
      await setDoc(doc(db, docPath), data);
    }
  });
}

describe("Firestore Security Rules — M1 Adversarial Verification (Option 1a)", () => {
  before(async () => {
    const rules = fs.readFileSync(RULES_PATH, "utf8");
    const hostPort = process.env.FIRESTORE_EMULATOR_HOST || "";
    const [host, portStr] = hostPort ? hostPort.split(":") : ["127.0.0.1", "8080"];
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host,
        port: Number(portStr) || 8080
      }
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it("AUD-FB-01: watch_pairings enforces zero PII, <=120s TTL, and single-use claim", async () => {
    const ownerUid = "u-watch-owner";
    const ownerHash = sha256Hex(ownerUid);
    const sessionToken = "tok_" + "a".repeat(40);
    const now = Date.now();
    const ownerDb = authedDb(ownerUid);
    const anonDb = unauthedDb();
    const otherDb = authedDb("u-attacker");

    // 1. Reject pairing with userId / PII or TTL > 120s
    await assertFails(
      setDoc(doc(ownerDb, "watch_pairings", "123456"), {
        pairingCode: "123456",
        sessionToken,
        ownerHash,
        userId: ownerUid,
        pairingOpenUntil: now + 60_000,
        claimed: false
      })
    );
    await assertFails(
      setDoc(doc(ownerDb, "watch_pairings", "123456"), {
        pairingCode: "123456",
        sessionToken,
        ownerHash,
        pairingOpenUntil: now + 300_000,
        claimed: false
      })
    );

    // 2. Valid pairing create succeeds
    await assertSucceeds(
      setDoc(doc(ownerDb, "watch_pairings", "123456"), {
        pairingCode: "123456",
        sessionToken,
        ownerHash,
        pairingOpenUntil: now + 90_000,
        claimed: false,
        watchDeviceId: ""
      })
    );

    // 3. List forbidden for everyone
    await assertFails(getDocs(query(collection(anonDb, "watch_pairings"), limit(5))));
    await assertFails(getDocs(query(collection(ownerDb, "watch_pairings"), limit(5))));

    // 4. Unauthenticated get allowed while active & unclaimed; missing code denied
    await assertSucceeds(getDoc(doc(anonDb, "watch_pairings", "123456")));
    await assertFails(getDoc(doc(anonDb, "watch_pairings", "654321")));

    // 5. Unauthenticated watch claims once; second claim fails
    await assertSucceeds(
      updateDoc(doc(anonDb, "watch_pairings", "123456"), {
        claimed: true,
        watchDeviceId: "garmin-fr965-1",
        watchSource: "GARMIN_CIQ",
        updatedAt: now
      })
    );
    await assertFails(getDoc(doc(anonDb, "watch_pairings", "123456")));
    await assertFails(
      updateDoc(doc(anonDb, "watch_pairings", "123456"), {
        claimed: true,
        watchDeviceId: "evil-watch",
        watchSource: "WEB_WATCH",
        updatedAt: now
      })
    );

    // 6. Non-owner cannot read or delete
    await assertFails(getDoc(doc(otherDb, "watch_pairings", "123456")));
    await assertFails(deleteDoc(doc(otherDb, "watch_pairings", "123456")));
    await assertSucceeds(deleteDoc(doc(ownerDb, "watch_pairings", "123456")));
  });

  it("AUD-FB-01: watch_sessions/{sessionToken} blocks 6-digit IDs, restricts watch updates & binds watchDeviceId", async () => {
    const ownerUid = "u-owner";
    const token = "sess_" + "B9".repeat(20);
    const now = Date.now();
    const ownerDb = authedDb(ownerUid);
    const anonDb = unauthedDb();

    // 6-digit doc ID denied even for owner
    await assertFails(
      setDoc(doc(ownerDb, "watch_sessions", "123456"), {
        userId: ownerUid,
        expiresAt: now + 3600_000
      })
    );

    // 256-bit sessionToken doc ID allowed for owner
    await assertSucceeds(
      setDoc(doc(ownerDb, "watch_sessions", token), {
        sessionToken: token,
        pairingCode: "123456",
        userId: ownerUid,
        arrowsCount: 6,
        totalScore: 54,
        expiresAt: now + 3600_000,
        updatedAt: now
      })
    );

    // List denied
    await assertFails(getDocs(query(collection(anonDb, "watch_sessions"), limit(5))));

    // Unauthenticated watch can read with exact token and bind watchDeviceId + send watch-only HR/cmd
    await assertSucceeds(getDoc(doc(anonDb, "watch_sessions", token)));
    await assertSucceeds(
      updateDoc(doc(anonDb, "watch_sessions", token), {
        watchDeviceId: "wear-pixel-1",
        watchSource: "WEAR_OS",
        watchHeartRateBpm: 92,
        lastWatchCmd: { type: "SCORE_INPUT", cmdId: "c1", value: "X" },
        lastWatchCmdId: "c1",
        lastWatchCmdSeq: 1,
        updatedAt: now
      })
    );

    // Different watchDeviceId is rejected once bound
    await assertFails(
      updateDoc(doc(anonDb, "watch_sessions", token), {
        watchDeviceId: "hijack-device",
        watchHeartRateBpm: 95,
        updatedAt: now
      })
    );

    // Unauthenticated watch cannot tamper with totalScore or expiresAt
    await assertFails(
      updateDoc(doc(anonDb, "watch_sessions", token), {
        watchDeviceId: "wear-pixel-1",
        totalScore: 720,
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(anonDb, "watch_sessions", token), {
        watchDeviceId: "wear-pixel-1",
        expiresAt: now + 9999_999,
        updatedAt: now
      })
    );
  });

  it("AUD-FB-02 & AUD-FB-03: blocks PRO/coach self-escalation while allowing FREE downgrade & leaveCurrentClub", async () => {
    const uid = "u-archer";
    const now = Date.now();
    const userDb = authedDb(uid);
    const adminDb = superAdminDb();

    // Self-create with PRO or coach role denied
    await assertFails(
      setDoc(doc(userDb, "users", uid), {
        uid,
        email: "archer@test.com",
        fullName: "Archer One",
        role: "archer",
        plan: "PRO",
        proExpiresAt: now + 86400_000
      })
    );
    await assertFails(
      setDoc(doc(userDb, "users", uid), {
        uid,
        email: "archer@test.com",
        fullName: "Archer One",
        role: "coach",
        isClubCreator: true,
        clubId: `CLB-${uid}`,
        plan: "FREE"
      })
    );

    // Legitimate archer FREE create succeeds
    await assertSucceeds(
      setDoc(doc(userDb, "users", uid), {
        uid,
        email: "archer@test.com",
        fullName: "Archer One",
        role: "archer",
        plan: "FREE",
        isClubCreator: false
      })
    );

    // Self-upgrade update to PRO or coach denied
    await assertFails(
      updateDoc(doc(userDb, "users", uid), {
        plan: "PRO",
        proExpiresAt: now + 86400_000
      })
    );
    await assertFails(
      updateDoc(doc(userDb, "users", uid), {
        role: "team_admin_coach",
        isClubCreator: true,
        clubId: `CLB-${uid}`
      })
    );

    // Client forging subscription_audit_logs denied; SuperAdmin allowed
    await assertFails(
      setDoc(doc(userDb, "subscription_audit_logs", "SUB-1"), {
        id: "SUB-1",
        userId: uid,
        newPlan: "PRO",
        expiresAt: now + 86400_000
      })
    );
    await assertSucceeds(
      setDoc(doc(adminDb, "subscription_audit_logs", "SUB-1"), {
        id: "SUB-1",
        userId: uid,
        newPlan: "PRO",
        expiresAt: now + 86400_000
      })
    );

    // store_receipt_claims locked to SuperAdmin
    await assertFails(getDoc(doc(userDb, "store_receipt_claims", "claim-1")));
    await assertSucceeds(setDoc(doc(adminDb, "store_receipt_claims", "claim-1"), { uid }));

    // Existing Coach PRO can downgrade PRO -> FREE (enforceProExpiry) and coach -> archer (leaveCurrentClub)
    await seedDocs({
      "users/u-coach-pro": {
        uid: "u-coach-pro",
        email: "coach@test.com",
        fullName: "Coach Pro",
        role: "coach",
        isClubCreator: true,
        clubId: "CLB-u-coach-pro",
        clubInviteCode: "123456",
        plan: "PRO",
        proExpiresAt: now - 1000
      }
    });
    const coachDb = authedDb("u-coach-pro");
    await assertSucceeds(
      updateDoc(doc(coachDb, "users", "u-coach-pro"), {
        plan: "FREE",
        proExpiresAt: 0,
        role: "archer",
        isClubCreator: false,
        clubId: null,
        clubInviteCode: ""
      })
    );
  });

  it("AUD-FB-04, AUD-FB-07, AUD-FB-08: athlete_stars isolation, coach_invite_codes PII/coach guard, email_verified guard", async () => {
    await seedDocs({
      "users/u-coach": {
        uid: "u-coach",
        email: "coach@club.com",
        fullName: "Coach",
        role: "coach",
        clubId: "CLB-u-coach",
        isClubCreator: true,
        plan: "PRO"
      },
      "users/u-clubmate": {
        uid: "u-clubmate",
        email: "mate@club.com",
        fullName: "Mate",
        role: "archer",
        clubId: "CLB-u-coach",
        coachId: "u-coach"
      },
      "users/u-outsider": {
        uid: "u-outsider",
        email: "out@other.com",
        fullName: "Outsider",
        role: "archer",
        clubId: "CLB-other"
      },
      "athlete_stars/u-clubmate": {
        userId: "u-clubmate",
        clubId: "CLB-u-coach",
        highestScore: 650,
        highestStarLevel: 5
      }
    });

    // athlete_stars read isolation
    await assertFails(getDoc(doc(authedDb("u-outsider"), "athlete_stars", "u-clubmate")));
    await assertSucceeds(getDoc(doc(authedDb("u-coach"), "athlete_stars", "u-clubmate")));
    await assertSucceeds(getDoc(doc(authedDb("u-clubmate"), "athlete_stars", "u-clubmate")));

    // coach_invite_codes: archer create denied, email PII denied, coach without email allowed
    await assertFails(
      setDoc(doc(authedDb("u-outsider"), "coach_invite_codes", "222333"), {
        code: "222333",
        coachUid: "u-outsider",
        clubId: "CLB-u-outsider"
      })
    );
    await assertFails(
      setDoc(doc(authedDb("u-coach"), "coach_invite_codes", "222333"), {
        code: "222333",
        coachUid: "u-coach",
        clubId: "CLB-u-coach",
        email: "pii@leak.com"
      })
    );
    await assertSucceeds(
      setDoc(doc(authedDb("u-coach"), "coach_invite_codes", "222333"), {
        code: "222333",
        coachUid: "u-coach",
        clubId: "CLB-u-coach",
        fullName: "Coach",
        role: "coach"
      })
    );
    // List denied for non-superadmin
    await assertFails(getDocs(query(collection(authedDb("u-coach"), "coach_invite_codes"), limit(5))));

    // AUD-FB-08: email_verified == false blocks email-fallback private read & SuperAdmin
    const unverifiedAdminDb = authedDb("wrong-uid", {
      email: "admin@archery101010.com",
      email_verified: false
    });
    await assertFails(getDoc(doc(unverifiedAdminDb, "users", "u-coach")));
    const unverifiedEmailMatchDb = authedDb("wrong-uid", {
      email: "mate@club.com",
      email_verified: false
    });
    await assertFails(getDoc(doc(unverifiedEmailMatchDb, "users", "u-clubmate")));
  });

  it("AUD-FB-12 & AUD-FB-14: validates fcmTokens and rejects unbounded/extra-key nested maps", async () => {
    const uid = "u-maps";
    const db = authedDb(uid);
    await seedDocs({
      [`users/${uid}`]: {
        uid,
        email: "maps@test.com",
        fullName: "Map User",
        role: "archer",
        plan: "FREE"
      }
    });

    // Valid fcmTokens + bowConfig + bows + physicalData allowed
    await assertSucceeds(
      updateDoc(doc(db, "users", uid), {
        fcmTokens: ["token-abcdef123456"],
        bowConfig: { type: "Recurve", brand: "Apex", model: "Pro", poundage: 38, hand: "RH" },
        bows: [{ type: "Compound", brand: "B", model: "M", poundage: 55 }],
        physicalData: { height: 175, weight: 72, dominantEye: "R", dominantHand: "R" }
      })
    );

    // Extra keys or bad enum rejected
    await assertFails(
      updateDoc(doc(db, "users", uid), {
        bowConfig: { type: "Laser", brand: "X", model: "Y", poundage: 38, evil: true }
      })
    );
    await assertFails(
      updateDoc(doc(db, "users", uid), {
        physicalData: { height: 175, weight: 72, dominantHand: "R", secretPayload: "123" }
      })
    );

    // Session biometrics & blockStats bounded
    await assertSucceeds(
      setDoc(doc(db, "sessions", "SES-1"), {
        id: "SES-1",
        userId: uid,
        timestamp: Date.now(),
        biometrics: { activeKcal: 120, avgHeartRateBpm: 105 },
        blockStats: { b1Score: 300, b2Score: 310, diff: 10, completedB2: true }
      })
    );
    await assertFails(
      setDoc(doc(db, "sessions", "SES-2"), {
        id: "SES-2",
        userId: uid,
        timestamp: Date.now(),
        biometrics: { activeKcal: 120, arbitraryKey: "bad" }
      })
    );
    await assertFails(
      setDoc(doc(db, "sessions", "SES-3"), {
        id: "SES-3",
        userId: uid,
        timestamp: Date.now(),
        blockStats: { b1Score: 300, b2Score: 310, diff: 10, completedB2: true, extra: 1 }
      })
    );
  });

  it("AUD-FB-13: enforces all 6 collection isolation fixes", async () => {
    const now = Date.now();
    await seedDocs({
      "users/u-coach": { uid: "u-coach", email: "c@t.com", fullName: "Coach", role: "coach", clubId: "CLB-u-coach" },
      "users/u-a1": { uid: "u-a1", email: "a1@t.com", fullName: "A1", role: "archer", clubId: "CLB-u-coach", coachId: "u-coach" },
      "users/u-a2": { uid: "u-a2", email: "a2@t.com", fullName: "A2", role: "archer", clubId: "CLB-u-coach", coachId: "u-coach" },
      "users/u-out": { uid: "u-out", email: "o@t.com", fullName: "Out", role: "archer", clubId: "CLB-other" },
      "calendar_events/EVT-1": {
        id: "EVT-1",
        title: "Drill",
        date: "2026-11-24",
        createdByUid: "u-coach",
        clubId: "CLB-u-coach",
        completedByAthlete: { "u-a2": ["item1"] },
        completedItems: []
      },
      "ad_campaigns/AD-1": {
        id: "AD-1",
        name: "Promo",
        type: "popup",
        status: "active",
        impressions: 5,
        clicks: 1
      },
      "sessions/SES-PRIV": {
        id: "SES-PRIV",
        userId: "u-a1",
        clubId: null,
        timestamp: now,
        score: 600
      },
      "sessions/SES-CLUB": {
        id: "SES-CLUB",
        userId: "u-a1",
        clubId: "CLB-u-coach",
        timestamp: now,
        score: 620
      }
    });

    const a1Db = authedDb("u-a1");
    const a2Db = authedDb("u-a2");
    const coachDb = authedDb("u-coach");
    const outDb = authedDb("u-out");

    // 1. calendar_events: own completedByAthlete key allowed; overwriting another athlete or completedItems denied
    await assertSucceeds(
      updateDoc(doc(a1Db, "calendar_events", "EVT-1"), {
        "completedByAthlete.u-a1": ["item1"],
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "calendar_events", "EVT-1"), {
        "completedByAthlete.u-a2": [],
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "calendar_events", "EVT-1"), {
        completedItems: ["hack"],
        updatedAt: now
      })
    );

    // 2. ad_campaigns: +1 allowed, +100 denied
    await assertSucceeds(
      updateDoc(doc(a1Db, "ad_campaigns", "AD-1"), {
        impressions: increment(1),
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "ad_campaigns", "AD-1"), {
        impressions: 500,
        updatedAt: now
      })
    );

    // 3. coach_notifications: unlinked or read:true create denied; linked unread allowed; athlete marking read denied; coach marking read allowed
    await assertFails(
      setDoc(doc(outDb, "coach_notifications", "NTF-BAD"), {
        id: "NTF-BAD",
        coachUid: "u-coach",
        athleteUid: "u-out",
        athleteName: "Out",
        type: "athlete_linked",
        read: false,
        createdAt: now
      })
    );
    await assertSucceeds(
      setDoc(doc(a1Db, "coach_notifications", "NTF-OK"), {
        id: "NTF-OK",
        coachUid: "u-coach",
        athleteUid: "u-a1",
        athleteName: "A1",
        type: "athlete_linked",
        read: false,
        createdAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "coach_notifications", "NTF-OK"), {
        read: true,
        updatedAt: now
      })
    );
    await assertSucceeds(
      updateDoc(doc(coachDb, "coach_notifications", "NTF-OK"), {
        read: true,
        updatedAt: now
      })
    );

    // 4. duel_invitations: self-invite and extra fields denied; system field allowed; transitions enforced
    await assertFails(
      setDoc(doc(a1Db, "duel_invitations", "INV-SELF"), {
        senderUid: "u-a1",
        receiverUid: "u-a1",
        roomCode: "MAT-1",
        status: "pending"
      })
    );
    await assertFails(
      setDoc(doc(a1Db, "duel_invitations", "INV-EXTRA"), {
        senderUid: "u-a1",
        receiverUid: "u-a2",
        roomCode: "MAT-1",
        status: "pending",
        evilExtra: true
      })
    );
    await assertSucceeds(
      setDoc(doc(a1Db, "duel_invitations", "INV-OK"), {
        senderUid: "u-a1",
        receiverUid: "u-a2",
        roomCode: "MAT-1",
        system: "set",
        status: "pending",
        createdAt: now
      })
    );
    // Sender cannot accept own invite
    await assertFails(
      updateDoc(doc(a1Db, "duel_invitations", "INV-OK"), {
        status: "accepted",
        updatedAt: now
      })
    );
    // Receiver can accept
    await assertSucceeds(
      updateDoc(doc(a2Db, "duel_invitations", "INV-OK"), {
        status: "accepted",
        updatedAt: now
      })
    );

    // 5. active_duels: connected W.O. hijack denied, self-forfeit & terminal cleanup allowed, resurrection denied
    await assertSucceeds(
      setDoc(doc(a1Db, "active_duels", "MAT-1"), {
        id: "MAT-1",
        creatorUid: "u-a1",
        creatorConnected: true,
        playerUid: "u-a2",
        playerConnected: true,
        status: "active",
        updatedAt: now
      })
    );
    // Creator cannot hijack playerShots or claim W.O. win while playerConnected == true
    await assertFails(
      updateDoc(doc(a1Db, "active_duels", "MAT-1"), {
        playerShots: [10],
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "active_duels", "MAT-1"), {
        status: "forfeited",
        winnerUid: "u-a1",
        updatedAt: now
      })
    );
    // Rival (u-a2) self-forfeits -> creator awards W.O. victory -> resurrection to 'active' fails
    await assertSucceeds(
      updateDoc(doc(a2Db, "active_duels", "MAT-1"), {
        status: "forfeited",
        forfeitByUid: "u-a2",
        winnerUid: "u-a1",
        updatedAt: now
      })
    );
    await assertFails(
      updateDoc(doc(a1Db, "active_duels", "MAT-1"), {
        status: "active",
        updatedAt: now
      })
    );

    // 6. sessions: coach cannot read/update private session (clubId: null), CAN read/update club session
    await assertFails(getDoc(doc(coachDb, "sessions", "SES-PRIV")));
    await assertFails(
      updateDoc(doc(coachDb, "sessions", "SES-PRIV"), {
        sessionNote: "Unauthorized note",
        updatedAt: now
      })
    );
    await assertSucceeds(getDoc(doc(coachDb, "sessions", "SES-CLUB")));
    await assertSucceeds(
      updateDoc(doc(coachDb, "sessions", "SES-CLUB"), {
        sessionNote: "Great grouping",
        updatedAt: now
      })
    );
  });
});
