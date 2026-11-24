const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { _internal } = require("../index.js");

const { createHandlers, sha256Hex, isCallerSuperAdmin } = _internal;

function cloneVal(val) {
  if (val === null || typeof val !== "object") return val;
  if (typeof val.toMillis === "function") return { toMillis: () => val.toMillis() };
  if (Array.isArray(val)) return val.map(cloneVal);
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = cloneVal(v);
  }
  return out;
}

function createInMemoryDb(initialCollections = {}, options = {}) {
  const store = new Map();
  for (const [colName, docs] of Object.entries(initialCollections)) {
    const colMap = new Map();
    for (const [docId, data] of Object.entries(docs)) {
      colMap.set(docId, cloneVal(data));
    }
    store.set(colName, colMap);
  }

  function getColMap(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }

  function applyPatch(existing, patch) {
    const base = existing ? cloneVal(existing) : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v && v.__type === "arrayRemove") {
        const cur = Array.isArray(base[k]) ? base[k] : [];
        base[k] = cur.filter((item) => !v.values.includes(item));
      } else {
        base[k] = cloneVal(v);
      }
    }
    return base;
  }

  function makeDocRef(colName, docId) {
    return {
      path: `${colName}/${docId}`,
      id: docId,
      colName,
      async get() {
        const data = getColMap(colName).get(docId);
        return {
          exists: data !== undefined,
          id: docId,
          ref: this,
          data: () => (data !== undefined ? cloneVal(data) : undefined)
        };
      },
      async set(data, opts) {
        const col = getColMap(colName);
        if (opts && opts.merge && col.has(docId)) {
          col.set(docId, applyPatch(col.get(docId), data));
        } else {
          col.set(docId, applyPatch(null, data));
        }
      },
      async update(patch) {
        const col = getColMap(colName);
        if (!col.has(docId)) {
          throw new Error(`Document ${colName}/${docId} does not exist`);
        }
        col.set(docId, applyPatch(col.get(docId), patch));
      },
      async delete() {
        getColMap(colName).delete(docId);
      }
    };
  }

  function makeQuery(colName, filters = [], maxLimit = Infinity) {
    return {
      where(field, op, value) {
        return makeQuery(colName, [...filters, { field, op, value }], maxLimit);
      },
      limit(n) {
        return makeQuery(colName, filters, n);
      },
      async get() {
        if (options.failQueryCollections && options.failQueryCollections.has(colName)) {
          throw new Error(`Simulated query failure on ${colName}`);
        }
        const col = getColMap(colName);
        const docs = [];
        for (const [docId, rawData] of col.entries()) {
          const matches = filters.every((f) => {
            if (f.op === "==") return rawData[f.field] === f.value;
            return false;
          });
          if (matches) {
            docs.push({
              id: docId,
              ref: makeDocRef(colName, docId),
              data: () => cloneVal(rawData)
            });
          }
          if (docs.length >= maxLimit) break;
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs
        };
      }
    };
  }

  return {
    _store: store,
    collection(colName) {
      return {
        doc(docId) {
          return makeDocRef(colName, docId);
        },
        where(field, op, value) {
          return makeQuery(colName, [{ field, op, value }]);
        },
        limit(n) {
          return makeQuery(colName, [], n);
        }
      };
    },
    async runTransaction(fn) {
      if (options.failTransaction) {
        throw new Error("Simulated transaction error");
      }
      const ops = [];
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data, opts) {
          ops.push({ type: "set", ref, data, opts });
        },
        update(ref, data) {
          ops.push({ type: "update", ref, data });
        },
        delete(ref) {
          ops.push({ type: "delete", ref });
        }
      };
      const result = await fn(tx);
      for (const op of ops) {
        if (op.type === "set") await op.ref.set(op.data, op.opts);
        else if (op.type === "update") await op.ref.update(op.data);
        else if (op.type === "delete") await op.ref.delete();
      }
      return result;
    },
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push({ type: "delete", ref });
        },
        set(ref, data, opts) {
          ops.push({ type: "set", ref, data, opts });
        },
        async commit() {
          for (const op of ops) {
            if (op.type === "delete") await op.ref.delete();
            else if (op.type === "set") await op.ref.set(op.data, op.opts);
          }
        }
      };
    }
  };
}

const FakeFieldValue = {
  arrayRemove: (...values) => ({ __type: "arrayRemove", values })
};

const FakeTimestamp = {
  fromMillis: (ms) => ({ toMillis: () => ms })
};

function makeMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe("Cloud Functions v2 — M1 Security & Business Logic", () => {
  it("allowRateLimitedAction enforces window cap, resets after expiry, and fails CLOSED by default", async () => {
    let now = 1_700_000_000_000;
    const db = createInMemoryDb();
    const h = createHandlers({
      db,
      nowFn: () => now,
      Timestamp: FakeTimestamp,
      FieldValue: FakeFieldValue
    });

    assert.equal(await h.allowRateLimitedAction("k1", 2, 60_000), true);
    assert.equal(await h.allowRateLimitedAction("k1", 2, 60_000), true);
    assert.equal(await h.allowRateLimitedAction("k1", 2, 60_000), false);

    now += 61_000;
    assert.equal(await h.allowRateLimitedAction("k1", 2, 60_000), true);

    const failingDb = createInMemoryDb({}, { failTransaction: true });
    const hFail = createHandlers({
      db: failingDb,
      nowFn: () => now,
      Timestamp: FakeTimestamp,
      FieldValue: FakeFieldValue
    });
    assert.equal(await hFail.allowRateLimitedAction("k2", 5, 60_000), false);
    assert.equal(await hFail.allowRateLimitedAction("k2", 5, 60_000, false), true);
  });

  it("sendFcmPushToUser sends multicast across fcmTokens+fcmToken, omits ic_stat_notify, and cleans dead tokens", async () => {
    const db = createInMemoryDb({
      users: {
        u1: {
          fcmToken: "dead-legacy-token-123456",
          fcmTokens: ["valid-token-1234567890", "dead-legacy-token-123456", "invalid-token-987654321"]
        }
      }
    });

    let sentPayload = null;
    const messaging = {
      async sendEachForMulticast(payload) {
        sentPayload = payload;
        return {
          successCount: 1,
          responses: [
            { success: true },
            { success: false, error: { code: "messaging/registration-token-not-registered" } },
            { success: false, error: { code: "messaging/invalid-registration-token" } }
          ]
        };
      }
    };

    const h = createHandlers({
      db,
      messaging,
      FieldValue: FakeFieldValue,
      Timestamp: FakeTimestamp,
      nowFn: () => 1_700_000_005_000
    });

    const ok = await h.sendFcmPushToUser(
      "u1",
      { title: "Reto", body: "Nuevo reto" },
      { type: "duel_invitation", url: "/?join=123" }
    );
    assert.equal(ok, true);
    assert.deepEqual(sentPayload.tokens, [
      "valid-token-1234567890",
      "dead-legacy-token-123456",
      "invalid-token-987654321"
    ]);
    assert.equal(sentPayload.android.notification.icon, undefined);

    const updatedUser = db._store.get("users").get("u1");
    assert.equal(updatedUser.fcmToken, "");
    assert.deepEqual(updatedUser.fcmTokens, ["valid-token-1234567890"]);
  });

  it("watchCloudBridge enforces /pair token issuance, device binding, /state auth, and /cmd sanitization", async () => {
    let now = 1_700_000_000_000;
    const db = createInMemoryDb({
      watch_sessions: {
        "482910": {
          pairingCode: "482910",
          userId: "u-owner",
          sessionActive: true,
          sessionId: "SES-1",
          arrowsCount: 6,
          totalScore: 54,
          currentEnd: 1,
          totalEnds: 12,
          arrowsPerEnd: 6,
          distanceM: 18,
          currentEndArrows: ["X", "10", "9"],
          expiresAt: now + 3600_000,
          pairingOpenUntil: now + 120_000,
          updatedAt: now
        }
      }
    });

    const h = createHandlers({
      db,
      nowFn: () => now,
      Timestamp: FakeTimestamp,
      FieldValue: FakeFieldValue
    });

    // 1. OPTIONS preflight
    const optRes = makeMockRes();
    await h.handleWatchCloudBridge({ method: "OPTIONS", path: "/pair", headers: {} }, optRes);
    assert.equal(optRes.statusCode, 204);

    // 2. Pair succeeds for first device
    const pairRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "POST",
        path: "/api/watch/pair",
        headers: { "x-forwarded-for": "1.2.3.4" },
        body: { pairingCode: "482910", watchDeviceId: "garmin-fr965-1", watchSource: "GARMIN_CIQ" }
      },
      pairRes
    );
    assert.equal(pairRes.statusCode, 200);
    assert.equal(pairRes.body.ok, true);
    assert.match(pairRes.body.watchToken, /^[a-f0-9]{64}$/);
    assert.equal(pairRes.body.state.userId, undefined);
    assert.equal(pairRes.body.state.watchTokenHash, undefined);

    const token = pairRes.body.watchToken;

    // 3. Second device rejected while pairing window is closed
    const hijackPairRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "POST",
        path: "/pair",
        headers: { "x-forwarded-for": "5.6.7.8" },
        body: { pairingCode: "482910", watchDeviceId: "attacker-watch", watchSource: "WEB_WATCH" }
      },
      hijackPairRes
    );
    assert.equal(hijackPairRes.statusCode, 403);
    assert.equal(hijackPairRes.body.error, "PAIRING_WINDOW_CLOSED");

    // 4. GET /state rejects wrong token and wrong deviceId
    const badTokRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "GET",
        path: "/state",
        query: { code: "482910" },
        headers: { "X-Watch-Token": "0".repeat(64), "X-Watch-Device-Id": "garmin-fr965-1" }
      },
      badTokRes
    );
    assert.equal(badTokRes.statusCode, 401);

    const badDevRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "GET",
        path: "/state",
        query: { code: "482910" },
        headers: { "X-Watch-Token": token, "X-Watch-Device-Id": "attacker-watch" }
      },
      badDevRes
    );
    assert.equal(badDevRes.statusCode, 403);

    // 5. GET /state succeeds with valid token & deviceId
    const okStateRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "GET",
        path: "/state",
        query: { code: "482910" },
        headers: { "X-Watch-Token": token, "X-Watch-Device-Id": "garmin-fr965-1" }
      },
      okStateRes
    );
    assert.equal(okStateRes.statusCode, 200);
    assert.equal(okStateRes.body.totalScore, 54);

    // 6. POST /cmd rejects disallowed command type
    const badCmdRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "POST",
        path: "/cmd",
        headers: { "X-Watch-Token": token, "X-Watch-Device-Id": "garmin-fr965-1" },
        body: { code: "482910", cmd: { type: "DROP_DATABASE" } }
      },
      badCmdRes
    );
    assert.equal(badCmdRes.statusCode, 400);

    // 7. POST /cmd clamps delta & telemetry and increments lastWatchCmdSeq
    now += 1000;
    const okCmdRes = makeMockRes();
    await h.handleWatchCloudBridge(
      {
        method: "POST",
        path: "/cmd",
        headers: { "X-Watch-Token": token, "X-Watch-Device-Id": "garmin-fr965-1" },
        body: {
          code: "482910",
          watchSource: "GARMIN_CIQ",
          cmd: { type: "SCORE_INPUT", cmdId: "g-1", value: "X", delta: 999 },
          telemetry: { watchHeartRateBpm: 500, watchStepsCount: 150 }
        }
      },
      okCmdRes
    );
    assert.equal(okCmdRes.statusCode, 200);
    assert.equal(okCmdRes.body.cmdId, "g-1");
    const storedSession = db._store.get("watch_sessions").get("482910");
    assert.equal(storedSession.lastWatchCmdSeq, 1);
    assert.equal(storedSession.lastWatchCmd.delta, 20);
    assert.equal(storedSession.watchHeartRateBpm, 260);
    assert.equal(storedSession.watchStepsCount, 150);
  });

  it("promoteToCoachClub enforces age >= 18, external club lock, and PII-free unique coach_invite_codes", async () => {
    const now = Date.UTC(2026, 10, 24);
    const db = createInMemoryDb({
      users: {
        uMinor: { uid: "uMinor", fullName: "Minor", birthDate: "2012-01-01", role: "archer" },
        uLinked: { uid: "uLinked", fullName: "Linked", birthDate: "1990-01-01", coachId: "c1", clubId: "CLB-c1" },
        uAdult: { uid: "uAdult", fullName: "Coach Ana", email: "ana@example.com", birthDate: "1990-01-01", role: "archer" }
      }
    });

    const h = createHandlers({
      db,
      nowFn: () => now,
      Timestamp: FakeTimestamp,
      FieldValue: FakeFieldValue,
      randomIntFn: () => 654321
    });

    await assert.rejects(
      () => h.handlePromoteToCoachClub({ auth: { uid: "uMinor" }, data: {} }),
      (err) => err instanceof HttpsError && err.code === "failed-precondition"
    );

    await assert.rejects(
      () => h.handlePromoteToCoachClub({ auth: { uid: "uLinked" }, data: {} }),
      (err) => err instanceof HttpsError && err.code === "permission-denied"
    );

    const res = await h.handlePromoteToCoachClub({
      auth: { uid: "uAdult" },
      data: { desiredRole: "team_admin_coach", clubName: "Club Elite" }
    });
    assert.equal(res.ok, true);
    assert.equal(res.profile.role, "team_admin_coach");
    assert.equal(res.profile.isClubCreator, true);
    assert.equal(res.profile.clubId, "CLB-uAdult");
    assert.equal(res.profile.clubInviteCode, "654321");

    const inviteDoc = db._store.get("coach_invite_codes").get("654321");
    assert.equal(inviteDoc.coachUid, "uAdult");
    assert.equal(inviteDoc.email, undefined);
  });

  it("verifyStoreSubscription handles launch_promo and verified_store_receipt with anti-replay & JSON safety", async () => {
    const now = Date.UTC(2026, 10, 24);
    const db = createInMemoryDb({
      users: {
        u1: { uid: "u1", fullName: "Coach 1", email: "c1@test.com", birthDate: "1990-05-01", plan: "FREE", role: "archer" },
        u2: { uid: "u2", fullName: "Coach 2", email: "c2@test.com", birthDate: "1990-05-01", plan: "FREE", role: "archer" }
      }
    });

    const prevEnv = process.env.BILLING_ENFORCE_SERVER_RECEIPTS;
    const prevSecret = process.env.APPLE_SHARED_SECRET;
    try {
      process.env.BILLING_ENFORCE_SERVER_RECEIPTS = "false";
      const hPromo = createHandlers({
        db,
        nowFn: () => now,
        Timestamp: FakeTimestamp,
        FieldValue: FakeFieldValue,
        randomIntFn: () => 222333
      });

      await assert.rejects(
        () => hPromo.handleVerifyStoreSubscription({ auth: { uid: "u1" }, data: { sku: "invalid_sku" } }),
        (err) => err instanceof HttpsError && err.code === "invalid-argument"
      );

      const promoRes = await hPromo.handleVerifyStoreSubscription({
        auth: { uid: "u1" },
        data: { sku: "archery101010_coach_pro_annual" }
      });
      assert.equal(promoRes.ok, true);
      assert.equal(promoRes.mode, "launch_promo");
      assert.equal(promoRes.plan, "PRO");
      assert.equal(promoRes.sku, "coach_pro_annual");
      assert.equal(db._store.get("users").get("u1").plan, "PRO");

      // Switch to server receipt enforcement
      process.env.BILLING_ENFORCE_SERVER_RECEIPTS = "true";
      process.env.APPLE_SHARED_SECRET = "test-secret";

      // 1. Malformed upstream JSON throws HttpsError('unavailable') instead of SyntaxError
      const hBadJson = createHandlers({
        db,
        nowFn: () => now,
        Timestamp: FakeTimestamp,
        FieldValue: FakeFieldValue,
        fetchImpl: async () => ({
          ok: true,
          async json() {
            throw new SyntaxError("Unexpected token <");
          }
        })
      });
      await assert.rejects(
        () =>
          hBadJson.handleVerifyStoreSubscription({
            auth: { uid: "u1" },
            data: { platform: "app_store", sku: "coach_pro_monthly", receiptData: "rcpt-bad" }
          }),
        (err) => err instanceof HttpsError && err.code === "unavailable"
      );

      // 2. Valid Apple receipt succeeds for u1 and writes anti-replay claim
      const hApple = createHandlers({
        db,
        nowFn: () => now,
        Timestamp: FakeTimestamp,
        FieldValue: FakeFieldValue,
        randomIntFn: () => 444555,
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return {
              status: 0,
              latest_receipt_info: [
                { expires_date_ms: String(now + 30 * 86400_000), product_id: "coach_pro_monthly" }
              ]
            };
          }
        })
      });

      const okApple = await hApple.handleVerifyStoreSubscription({
        auth: { uid: "u1" },
        data: { platform: "ios", sku: "coach_pro_monthly", receiptData: "unique-receipt-xyz" }
      });
      assert.equal(okApple.ok, true);
      assert.equal(okApple.mode, "verified_store_receipt");
      const expectedClaimId = sha256Hex("app_store:unique-receipt-xyz");
      assert.equal(db._store.get("store_receipt_claims").get(expectedClaimId).uid, "u1");

      // 3. Replay by u2 is blocked with already-exists
      await assert.rejects(
        () =>
          hApple.handleVerifyStoreSubscription({
            auth: { uid: "u2" },
            data: { platform: "ios", sku: "coach_pro_monthly", receiptData: "unique-receipt-xyz" }
          }),
        (err) => err instanceof HttpsError && err.code === "already-exists"
      );
    } finally {
      process.env.BILLING_ENFORCE_SERVER_RECEIPTS = prevEnv;
      process.env.APPLE_SHARED_SECRET = prevSecret;
    }
  });

  it("restoreStoreSubscription, lookupCoachInviteCode, and rotateCoachInviteCode enforce contracts", async () => {
    const now = Date.UTC(2026, 10, 24);
    const db = createInMemoryDb({
      users: {
        c1: {
          uid: "c1",
          fullName: "Coach One",
          email: "secret@coach.com",
          birthDate: "1988-01-01",
          role: "coach",
          clubId: "CLB-c1",
          clubInviteCode: "111222",
          plan: "FREE"
        },
        a1: { uid: "a1", fullName: "Archer", birthDate: "1995-01-01", role: "archer" }
      },
      coach_invite_codes: {
        "111222": {
          code: "111222",
          coachUid: "c1",
          fullName: "Coach One",
          clubId: "CLB-c1",
          role: "coach"
        }
      },
      subscription_audit_logs: {
        s1: { id: "s1", userId: "c1", newPlan: "PRO", expiresAt: now + 10 * 86400_000 }
      }
    });

    const h = createHandlers({
      db,
      nowFn: () => now,
      Timestamp: FakeTimestamp,
      FieldValue: FakeFieldValue,
      randomIntFn: () => 777888
    });

    // Restore PRO for c1
    const restored = await h.handleRestoreStoreSubscription({ auth: { uid: "c1" }, data: {} });
    assert.equal(restored.ok, true);
    assert.equal(restored.restored, true);
    assert.equal(db._store.get("users").get("c1").plan, "PRO");

    // No active sub for a1
    const notFoundSub = await h.handleRestoreStoreSubscription({ auth: { uid: "a1" }, data: {} });
    assert.equal(notFoundSub.ok, false);
    assert.equal(notFoundSub.code, "NO_ACTIVE_SUBSCRIPTION");

    // Lookup returns PII-free coach data
    const lookup = await h.handleLookupCoachInviteCode({ auth: { uid: "a1" }, data: { code: "111222" } });
    assert.equal(lookup.found, true);
    assert.equal(lookup.coach.uid, "c1");
    assert.equal(lookup.coach.email, undefined);

    // Self-lookup rejected
    await assert.rejects(
      () => h.handleLookupCoachInviteCode({ auth: { uid: "c1" }, data: { code: "111222" } }),
      (err) => err instanceof HttpsError && err.code === "failed-precondition"
    );

    // Rotate replaces 111222 -> 777888 atomically
    const rotated = await h.handleRotateCoachInviteCode({ auth: { uid: "c1" }, data: {} });
    assert.equal(rotated.ok, true);
    assert.equal(rotated.clubInviteCode, "777888");
    assert.equal(db._store.get("coach_invite_codes").has("111222"), false);
    assert.equal(db._store.get("coach_invite_codes").get("777888").coachUid, "c1");
  });

  it("purgeDeletedUserAccount enforces email_verified superadmin, deletes all 18 collections + direct docs + Auth", async () => {
    const targetUid = "u-purge";
    const ownerHash = sha256Hex(targetUid);
    const db = createInMemoryDb({
      sessions: { s1: { userId: targetUid } },
      calendar_events: { e1: { createdByUid: targetUid } },
      macrocycles: { m1: { coachId: targetUid } },
      star_history: { sh1: { userId: targetUid } },
      active_duels: { d1: { creatorUid: targetUid }, d2: { playerUid: targetUid } },
      duel_invitations: { di1: { senderUid: targetUid }, di2: { receiverUid: targetUid } },
      coach_notifications: { cn1: { athleteUid: targetUid }, cn2: { coachUid: targetUid } },
      coach_records: { cr1: { athleteUid: targetUid }, cr2: { coachId: targetUid } },
      coach_invite_codes: { "999111": { coachUid: targetUid } },
      watch_sessions: { tok1: { userId: targetUid } },
      watch_pairings: { "123456": { ownerHash } },
      subscription_audit_logs: { sub1: { userId: targetUid } },
      client_error_logs: { err1: { userId: targetUid } },
      store_receipt_claims: { cl1: { uid: targetUid } },
      athlete_stars: { [targetUid]: { userId: targetUid } },
      users_public: { [targetUid]: { uid: targetUid } },
      users: { [targetUid]: { uid: targetUid } }
    });

    const deletedAuthUids = [];
    const auth = {
      async deleteUser(uid) {
        deletedAuthUids.push(uid);
      }
    };

    const h = createHandlers({ db, auth, Timestamp: FakeTimestamp, FieldValue: FakeFieldValue });

    // Unverified admin email cannot purge another user
    assert.equal(
      isCallerSuperAdmin({ email: "admin@archery101010.com", email_verified: false }),
      false
    );
    await assert.rejects(
      () =>
        h.handlePurgeDeletedUserAccount({
          auth: {
            uid: "other-uid",
            token: { email: "admin@archery101010.com", email_verified: false }
          },
          data: { uid: targetUid }
        }),
      (err) => err instanceof HttpsError && err.code === "permission-denied"
    );

    // Verified superadmin purges all 18 queries + 3 direct docs + Auth user
    const res = await h.handlePurgeDeletedUserAccount({
      auth: {
        uid: "super-uid",
        token: { email: "admin@archery101010.com", email_verified: true }
      },
      data: { uid: targetUid }
    });
    assert.equal(res.ok, true);
    assert.equal(res.authDeleted, true);
    assert.deepEqual(res.failedCollections, []);
    assert.equal(res.deletedCount, 21);
    assert.deepEqual(deletedAuthUids, [targetUid]);

    for (const [colName, colMap] of db._store.entries()) {
      assert.equal(colMap.size, 0, `Expected ${colName} to be empty after purge`);
    }
  });
});
