const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const PLAY_PACKAGE_NAME = "com.archery101010.app";
const BATCH_DELETE_CHUNK_SIZE = 400;

const ALLOWED_WATCH_SOURCES = new Set([
  "GARMIN_CIQ",
  "WEAR_OS",
  "WATCHOS",
  "WEB_WATCH"
]);

const ALLOWED_WATCH_CMD_TYPES = new Set([
  "INCREMENT_ARROW",
  "DECREMENT_ARROW",
  "SCORE_INPUT",
  "UNDO_ARROW",
  "NEXT_END",
  "SET_SENSITIVITY",
  "TOGGLE_AUTO_DETECT",
  "SYNC_TELEMETRY_FROM_WATCH",
  "ANALYSIS_SHOT",
  "ANALYSIS_MANUAL_START",
  "ANALYSIS_MANUAL_STOP",
  "ANALYSIS_MANUAL_CAPTURE",
  "ANALYSIS_CALIBRATE_ZERO",
  "ANALYSIS_ZERO_VECTOR",
  "FINISH_SESSION_FROM_WATCH",
  "HEARTBEAT"
]);

const ALLOWED_COACH_ROLES = new Set([
  "coach",
  "team_admin",
  "team_admin_coach"
]);

const ALLOWED_SKUS = new Set([
  "coach_pro_monthly",
  "coach_pro_annual",
  "archery101010_coach_pro_monthly",
  "archery101010_coach_pro_annual"
]);

const SUPERADMIN_EMAILS = new Set([
  "admin@archery101010.com",
  "admin101010@archery101010.com",
  "archery101010app@gmail.com",
  "info@archery101010.com"
]);

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a.toLowerCase(), "utf8");
  const bufB = Buffer.from(b.toLowerCase(), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function clampNumber(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function formatBowLabel(bowType) {
  if (bowType === "Recurve") return "Recurvo";
  if (bowType === "Compound") return "Compuesto";
  if (bowType === "Barebow") return "Barebow";
  return bowType || "1 vs 1";
}

function canonicalizeSku(rawSku) {
  const sku = typeof rawSku === "string" ? rawSku.trim() : "";
  if (!ALLOWED_SKUS.has(sku)) return "";
  if (sku === "archery101010_coach_pro_monthly") return "coach_pro_monthly";
  if (sku === "archery101010_coach_pro_annual") return "coach_pro_annual";
  return sku;
}

function calculateAgeYears(birthDateStr, nowMs = Date.now()) {
  if (typeof birthDateStr !== "string") return null;
  const trimmed = birthDateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - year;
  const mDiff = now.getUTCMonth() + 1 - month;
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < day)) {
    age -= 1;
  }
  return age;
}

function getCanonicalClubId(uid) {
  const cleanUid = String(uid || "").trim();
  const stripped = cleanUid.replace(/^USR-/, "");
  return `CLB-${stripped || cleanUid}`;
}

function isLinkedToExternalCoach(userData, uid) {
  if (!userData || typeof userData !== "object") return false;
  const coachId = typeof userData.coachId === "string" ? userData.coachId.trim() : "";
  if (coachId && coachId !== uid) {
    return true;
  }
  const clubId = typeof userData.clubId === "string" ? userData.clubId.trim() : "";
  if (!clubId) return false;
  const strippedUid = String(uid || "").replace(/^USR-/, "");
  return clubId !== `CLB-${uid}` && clubId !== `CLB-${strippedUid}`;
}

function isCallerSuperAdmin(authToken) {
  if (!authToken) return false;
  if (authToken.superadmin === true || authToken.role === "superadmin") return true;
  const email = typeof authToken.email === "string" ? authToken.email.toLowerCase() : "";
  return authToken.email_verified === true && SUPERADMIN_EMAILS.has(email);
}

function extractEpochMs(val) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (val && typeof val.toMillis === "function") return val.toMillis();
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildCompactWatchState(data) {
  return {
    sessionActive: Boolean(data.sessionActive),
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
    arrowsCount: Number(data.arrowsCount) || 0,
    totalScore: Number(data.totalScore) || 0,
    currentEnd: Number(data.currentEnd) || 1,
    totalEnds: Number(data.totalEnds) || 0,
    arrowsPerEnd: Number(data.arrowsPerEnd) || 0,
    distanceM: Number(data.distanceM) || 0,
    currentEndArrows: Array.isArray(data.currentEndArrows) ? data.currentEndArrows.slice(0, 30) : [],
    bowType: typeof data.bowType === "string" ? data.bowType : "",
    bowPoundageLbs: Number(data.bowPoundageLbs) || 0,
    practiceType: typeof data.practiceType === "string" ? data.practiceType : "",
    analysisMode: Boolean(data.analysisMode),
    analysisCalibrationJson:
      typeof data.analysisCalibrationJson === "string" ? data.analysisCalibrationJson : "",
    autoDetectEnabled: Boolean(data.autoDetectEnabled),
    sensitivityLevel: Number(data.sensitivityLevel) || 0,
    distanceWalkedM: Number(data.distanceWalkedM) || 0,
    stepsCount: Number(data.stepsCount) || 0,
    caloriesBurnedKcal: Number(data.caloriesBurnedKcal) || 0,
    watchHeartRateBpm: Number(data.watchHeartRateBpm) || 0,
    updatedAt: extractEpochMs(data.updatedAt)
  };
}

function sanitizeWatchCmd(rawCmd, nowMs) {
  if (!rawCmd || typeof rawCmd !== "object" || Array.isArray(rawCmd)) {
    return null;
  }
  const type = typeof rawCmd.type === "string" ? rawCmd.type.trim().slice(0, 40) : "";
  if (!ALLOWED_WATCH_CMD_TYPES.has(type)) {
    return null;
  }

  const cmdId =
    (typeof rawCmd.cmdId === "string" && rawCmd.cmdId.trim().slice(0, 80)) ||
    (typeof rawCmd._cmdId === "string" && rawCmd._cmdId.trim().slice(0, 80)) ||
    (typeof rawCmd.id === "string" && rawCmd.id.trim().slice(0, 80)) ||
    `wcmd-${nowMs}-${crypto.randomUUID().slice(0, 8)}`;

  const clean = {
    type,
    cmdId,
    _ts: clampNumber(rawCmd._ts ?? rawCmd.ts, 0, 9999999999999) ?? nowMs
  };

  if (typeof rawCmd.value === "string") {
    clean.value = rawCmd.value.slice(0, 40);
  } else if (typeof rawCmd.value === "number" && Number.isFinite(rawCmd.value)) {
    clean.value = clampNumber(rawCmd.value, -100000, 100000);
  }

  const delta = clampNumber(rawCmd.delta, -20, 20);
  if (delta !== undefined) clean.delta = delta;

  const totalScore = clampNumber(rawCmd.totalScore, 0, 100000);
  if (totalScore !== undefined) clean.totalScore = totalScore;

  if (typeof rawCmd.enabled === "boolean") clean.enabled = rawCmd.enabled;

  const sensitivityLevel = clampNumber(rawCmd.sensitivityLevel, 0, 10);
  if (sensitivityLevel !== undefined) clean.sensitivityLevel = sensitivityLevel;

  if (typeof rawCmd.analysisShotJson === "string") {
    clean.analysisShotJson = rawCmd.analysisShotJson.slice(0, 3500);
  }

  if (typeof rawCmd.source === "string") {
    clean.source = rawCmd.source.slice(0, 40);
  }

  if (Array.isArray(rawCmd.zeroGravityVec) && rawCmd.zeroGravityVec.length === 3) {
    const vec = rawCmd.zeroGravityVec.map((v) => clampNumber(v, -100000, 100000));
    if (vec.every((v) => v !== undefined)) {
      clean.zeroGravityVec = vec;
    }
  }

  const calZero = clampNumber(rawCmd.calibrateZeroAt, 0, 9999999999999);
  if (calZero !== undefined) clean.calibrateZeroAt = calZero;

  return clean;
}

function createHandlers(customDeps = {}) {
  const db = customDeps.db || admin.firestore();
  const messaging = customDeps.messaging || admin.messaging();
  const auth = customDeps.auth || admin.auth();
  const fetchImpl = customDeps.fetchImpl || globalThis.fetch;
  const nowFn = customDeps.nowFn || (() => Date.now());
  const FieldValue = customDeps.FieldValue || admin.firestore.FieldValue;
  const Timestamp = customDeps.Timestamp || admin.firestore.Timestamp;
  const randomIntFn = customDeps.randomIntFn || ((min, max) => crypto.randomInt(min, max));

  /**
   * Firestore-backed sliding/fixed window per-sender rate limiter (`rate_limits/{key}`).
   * Fail-closed by default (`failClosed = true`) so DB/transaction errors never bypass limits.
   */
  async function allowRateLimitedAction(key, maxPerWindow, windowMs, failClosed = true) {
    const safeKey = String(key || "")
      .replace(/[^a-zA-Z0-9:_-]/g, "_")
      .slice(0, 180);
    if (!safeKey || maxPerWindow <= 0 || windowMs <= 0) {
      return false;
    }

    const now = nowFn();
    const limitRef = db.collection("rate_limits").doc(safeKey);
    const ttlMs = Math.max(windowMs * 2, 60 * 60 * 1000);

    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(limitRef);
        const data = snap.exists ? snap.data() || {} : {};
        const windowStart = Number(data.windowStart) || 0;
        const currentCount = Number(data.count) || 0;

        if (windowStart <= 0 || now - windowStart >= windowMs) {
          tx.set(limitRef, {
            key: safeKey,
            windowStart: now,
            count: 1,
            updatedAt: now,
            expireAt: Timestamp.fromMillis(now + ttlMs)
          });
          return true;
        }

        if (currentCount >= maxPerWindow) {
          return false;
        }

        tx.update(limitRef, {
          count: currentCount + 1,
          updatedAt: now
        });
        return true;
      });
    } catch (err) {
      logger.warn("Rate limiter transaction error", {
        key: safeKey,
        failClosed,
        message: err && err.message
      });
      return !failClosed;
    }
  }

  /**
   * Multi-device FCM push sender reading both `fcmTokens` (`string[]`) and legacy `fcmToken` (`string`),
   * cleaning up dead/unregistered tokens automatically.
   */
  async function sendFcmPushToUser(targetUid, notificationPayload, dataPayload) {
    if (!targetUid || typeof targetUid !== "string") {
      return false;
    }

    const userRef = db.collection("users").doc(targetUid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      logger.info("Target user document not found for push", { targetUid });
      return false;
    }

    const userData = userSnap.data() || {};
    const legacyToken = typeof userData.fcmToken === "string" ? userData.fcmToken.trim() : "";
    const arrayTokens = Array.isArray(userData.fcmTokens)
      ? userData.fcmTokens
          .filter((t) => typeof t === "string" && t.trim().length >= 10)
          .map((t) => t.trim())
      : [];

    const tokens = Array.from(
      new Set([
        ...arrayTokens,
        ...(legacyToken.length >= 10 ? [legacyToken] : [])
      ])
    ).slice(0, 10);

    if (tokens.length === 0) {
      logger.info("User has no registered FCM token; skipping push", { targetUid });
      return false;
    }

    const cleanData = {};
    Object.entries(dataPayload || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        cleanData[k] = String(v);
      }
    });

    const targetUrl = cleanData.url || "/";

    try {
      const multicastRes = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: notificationPayload.title,
          body: notificationPayload.body
        },
        data: cleanData,
        webpush: {
          notification: {
            title: notificationPayload.title,
            body: notificationPayload.body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            vibrate: [180, 90, 180],
            tag: cleanData.tag || cleanData.type || "archery-101010-push",
            renotify: true
          },
          fcmOptions: {
            link: targetUrl
          }
        },
        android: {
          priority: "high",
          notification: {
            sound: "default"
          }
        }
      });

      const responses = Array.isArray(multicastRes && multicastRes.responses)
        ? multicastRes.responses
        : [];
      const deadTokens = [];
      responses.forEach((resp, idx) => {
        if (!resp || resp.success) return;
        const code = resp.error && resp.error.code ? String(resp.error.code) : "";
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          deadTokens.push(tokens[idx]);
        }
      });

      if (deadTokens.length > 0) {
        const cleanupPatch = { updatedAt: nowFn() };
        if (Array.isArray(userData.fcmTokens)) {
          cleanupPatch.fcmTokens = FieldValue.arrayRemove(...deadTokens);
        }
        if (legacyToken && deadTokens.includes(legacyToken)) {
          cleanupPatch.fcmToken = "";
        }
        await userRef.update(cleanupPatch).catch(() => {});
      }

      const successCount = Number(multicastRes && multicastRes.successCount) || 0;
      logger.info("FCM multicast push processed", {
        targetUid,
        type: cleanData.type || "general",
        sent: successCount,
        cleaned: deadTokens.length
      });
      return successCount > 0;
    } catch (err) {
      logger.warn("Failed to deliver FCM multicast push", {
        targetUid,
        code: err && err.code ? String(err.code) : "",
        message: err && err.message
      });
      return false;
    }
  }

  async function deleteQueryInChunks(baseQuery, chunkSize = BATCH_DELETE_CHUNK_SIZE) {
    let deleted = 0;
    while (true) {
      const snap = await baseQuery.limit(chunkSize).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();

      deleted += snap.size;
      if (snap.size < chunkSize) break;
    }
    return deleted;
  }

  async function allocateUniqueInviteCodeInTx(tx, uid, existingCode) {
    if (typeof existingCode === "string" && /^[0-9]{6}$/.test(existingCode.trim())) {
      const code = existingCode.trim();
      const ref = db.collection("coach_invite_codes").doc(code);
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() && snap.data().coachUid === uid)) {
        return code;
      }
    }

    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = String(randomIntFn(100000, 1000000));
      const ref = db.collection("coach_invite_codes").doc(candidate);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        return candidate;
      }
    }
    throw new HttpsError("resource-exhausted", "Unable to allocate a unique 6-digit invite code.");
  }

  async function getGooglePlayAccessToken(serviceAccount) {
    const nowSec = Math.floor(nowFn() / 1000);
    const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = toBase64Url(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: nowSec,
        exp: nowSec + 3600
      })
    );
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const signature = signer
      .sign(serviceAccount.private_key, "base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    let tokenRes;
    let tokenJson;
    try {
      tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${header}.${claim}.${signature}`
        })
      });
      if (!tokenRes.ok) {
        throw new HttpsError("unavailable", "Google Play OAuth endpoint rejected token request.");
      }
      tokenJson = await tokenRes.json();
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("unavailable", "Failed to communicate with Google Play OAuth endpoint.");
    }
    if (!tokenJson || !tokenJson.access_token) {
      throw new HttpsError("internal", "Failed to obtain Google Play verification access token.");
    }
    return tokenJson.access_token;
  }

  async function verifyGooglePlayPurchaseToken(purchaseToken) {
    const rawSa = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "";
    if (!rawSa.trim()) {
      throw new HttpsError(
        "failed-precondition",
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured on the server."
      );
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(rawSa);
    } catch {
      throw new HttpsError("internal", "Invalid GOOGLE_PLAY_SERVICE_ACCOUNT_JSON configuration.");
    }

    const accessToken = await getGooglePlayAccessToken(serviceAccount);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(
      purchaseToken
    )}`;

    let payload;
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        throw new HttpsError("permission-denied", "Invalid or unrecognized Google Play purchase token.");
      }
      payload = await res.json();
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("unavailable", "Google Play verification endpoint returned an invalid response.");
    }

    const lineItems = Array.isArray(payload && payload.lineItems) ? payload.lineItems : [];
    let maxExpiryMs = 0;
    let resolvedSku = "";
    for (const item of lineItems) {
      const expMs = item && item.expiryTime ? Date.parse(item.expiryTime) : 0;
      if (Number.isFinite(expMs) && expMs > maxExpiryMs) {
        maxExpiryMs = expMs;
        resolvedSku = item.productId || resolvedSku;
      }
    }
    return { expiresAtMs: maxExpiryMs, sku: resolvedSku };
  }

  async function verifyAppleAppStoreReceipt(receiptData) {
    const sharedSecret = (process.env.APPLE_SHARED_SECRET || "").trim();
    if (!sharedSecret) {
      throw new HttpsError("failed-precondition", "APPLE_SHARED_SECRET is not configured on the server.");
    }

    const postReceipt = async (endpoint) => {
      try {
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "receipt-data": receiptData,
            password: sharedSecret,
            "exclude-old-transactions": true
          })
        });
        if (!res.ok) {
          throw new HttpsError("unavailable", "Apple App Store verification service unavailable.");
        }
        return await res.json();
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        throw new HttpsError("unavailable", "Apple App Store verification returned an invalid response.");
      }
    };

    let body = await postReceipt("https://buy.itunes.apple.com/verifyReceipt");
    if (body && body.status === 21007) {
      body = await postReceipt("https://sandbox.itunes.apple.com/verifyReceipt");
    }
    if (!body || body.status !== 0) {
      throw new HttpsError("permission-denied", "Invalid Apple App Store subscription receipt.");
    }

    const latestList = Array.isArray(body.latest_receipt_info) ? body.latest_receipt_info : [];
    let maxExpiryMs = 0;
    let resolvedSku = "";
    for (const tx of latestList) {
      const expMs = Number(tx && tx.expires_date_ms) || 0;
      if (expMs > maxExpiryMs) {
        maxExpiryMs = expMs;
        resolvedSku = tx.product_id || resolvedSku;
      }
    }
    return { expiresAtMs: maxExpiryMs, sku: resolvedSku };
  }

  async function handleDuelInvitationCreated(event) {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data || !data.receiverUid || data.status !== "pending") {
      return;
    }

    const senderUid = typeof data.senderUid === "string" ? data.senderUid.trim() : "";
    if (!senderUid) {
      return;
    }

    const allowed = await allowRateLimitedAction(`duel_invite_${senderUid}`, 8, 60 * 1000, true);
    if (!allowed) {
      logger.warn("Rate limit exceeded for duel invitation push", {
        senderUid,
        invitationId: event.params.invitationId
      });
      return;
    }

    const senderName = data.senderName || "Un arquero";
    const bowLabel = formatBowLabel(data.bowType);
    const distPart = data.distance ? ` a ${data.distance} m` : "";
    const roomCode = data.roomCode ? String(data.roomCode) : "";
    const joinPath = roomCode ? `/?join=${encodeURIComponent(roomCode)}` : "/";

    await sendFcmPushToUser(
      data.receiverUid,
      {
        title: "Nuevo reto en línea",
        body: `${senderName} te desafió a una eliminatoria ${bowLabel}${distPart} en ARCHERY 101010.`
      },
      {
        type: "duel_invitation",
        tag: `duel-invite-${event.params.invitationId}`,
        invitationId: event.params.invitationId,
        roomCode,
        senderUid,
        url: joinPath
      }
    );
  }

  async function handleCoachNotificationCreated(event) {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data || !data.coachUid || data.read === true) {
      return;
    }

    const athleteUid = typeof data.athleteUid === "string" ? data.athleteUid.trim() : "";
    if (athleteUid) {
      const allowed = await allowRateLimitedAction(`coach_notif_${athleteUid}`, 10, 60 * 1000, true);
      if (!allowed) {
        logger.warn("Rate limit exceeded for coach notification push", {
          athleteUid,
          notificationId: event.params.notificationId
        });
        return;
      }
    }

    const athleteName = data.athleteName || "Un arquero";
    const isUnlink = data.type === "athlete_unlinked";

    await sendFcmPushToUser(
      data.coachUid,
      {
        title: isUnlink ? "Alumno desvinculado" : "Nuevo alumno vinculado",
        body: isUnlink
          ? `${athleteName} se ha desvinculado de tu equipo en ARCHERY 101010.`
          : `${athleteName} se vinculó a tu equipo en ARCHERY 101010.`
      },
      {
        type: data.type || "athlete_linked",
        tag: `coach-notif-${event.params.notificationId}`,
        notificationId: event.params.notificationId,
        athleteUid,
        url: "/"
      }
    );
  }

  async function handleWatchCloudBridge(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Watch-Token, X-Watch-Device-Id");
    res.set("Cache-Control", "no-store");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    const rawPath = String(req.path || req.url || "/").split("?")[0];
    const normalizedPath = rawPath
      .replace(/^\/api\/watch(?=\/|$)/i, "")
      .replace(/^\/watchCloudBridge(?=\/|$)/i, "") || "/";

    const headers = req.headers || {};
    const getHeader = (name) => {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower) {
          return Array.isArray(v) ? String(v[0] || "") : String(v || "");
        }
      }
      return "";
    };

    if (req.method === "POST" && normalizedPath === "/pair") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim() : "";
      const watchDeviceId = typeof body.watchDeviceId === "string" ? body.watchDeviceId.trim() : "";
      const watchSource = typeof body.watchSource === "string" ? body.watchSource.trim() : "";

      if (
        !/^[0-9]{6}$/.test(pairingCode) ||
        watchDeviceId.length < 1 ||
        watchDeviceId.length > 80 ||
        !ALLOWED_WATCH_SOURCES.has(watchSource)
      ) {
        return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
      }

      const clientIp =
        getHeader("x-forwarded-for").split(",")[0].trim() ||
        String(req.ip || "unknown");
      const ipAllowed = await allowRateLimitedAction(
        `pair_ip_${sha256Hex(clientIp).slice(0, 16)}`,
        15,
        300 * 1000,
        true
      );
      const codeAllowed = await allowRateLimitedAction(
        `pair_code_${pairingCode}`,
        10,
        300 * 1000,
        true
      );
      if (!ipAllowed || !codeAllowed) {
        return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
      }

      const now = nowFn();
      const docRef = db.collection("watch_sessions").doc(pairingCode);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          return { status: 404, body: { ok: false, error: "CODE_NOT_FOUND" } };
        }
        const data = snap.data() || {};
        const expiresAt = extractEpochMs(data.expiresAt);
        if (expiresAt <= now) {
          return { status: 403, body: { ok: false, error: "CODE_EXPIRED" } };
        }

        const pairingOpenUntil = extractEpochMs(data.pairingOpenUntil);
        const eligible =
          !data.watchTokenHash ||
          now <= pairingOpenUntil ||
          data.watchDeviceId === watchDeviceId;

        if (!eligible) {
          return { status: 403, body: { ok: false, error: "PAIRING_WINDOW_CLOSED" } };
        }

        const watchToken = crypto.randomBytes(32).toString("hex");
        const watchTokenHash = sha256Hex(watchToken);
        const patch = {
          watchTokenHash,
          watchDeviceId,
          watchSource,
          pairingOpenUntil: 0,
          watchHeartbeatAt: now,
          updatedAt: now
        };
        tx.update(docRef, patch);

        return {
          status: 200,
          body: {
            ok: true,
            watchToken,
            expiresAt,
            state: buildCompactWatchState({ ...data, ...patch })
          }
        };
      });

      return res.status(result.status).json(result.body);
    }

    if (req.method === "GET" && normalizedPath === "/state") {
      const code = String((req.query && req.query.code) || "").trim();
      const watchToken = getHeader("X-Watch-Token").trim();
      const watchDeviceId = getHeader("X-Watch-Device-Id").trim();

      if (!/^[0-9]{6}$/.test(code) || !watchToken || !watchDeviceId || watchDeviceId.length > 80) {
        return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
      }

      const allowed = await allowRateLimitedAction(`watch_state_${code}`, 120, 60 * 1000, true);
      if (!allowed) {
        return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
      }

      const docRef = db.collection("watch_sessions").doc(code);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ ok: false, error: "CODE_NOT_FOUND" });
      }
      const data = snap.data() || {};
      const now = nowFn();
      if (extractEpochMs(data.expiresAt) <= now) {
        return res.status(403).json({ ok: false, error: "CODE_EXPIRED" });
      }
      if (!data.watchDeviceId || data.watchDeviceId !== watchDeviceId) {
        return res.status(403).json({ ok: false, error: "DEVICE_MISMATCH" });
      }
      if (!data.watchTokenHash || !timingSafeEqualHex(sha256Hex(watchToken), data.watchTokenHash)) {
        return res.status(401).json({ ok: false, error: "INVALID_TOKEN" });
      }

      if (now - extractEpochMs(data.watchHeartbeatAt) >= 30 * 1000) {
        await docRef.update({ watchHeartbeatAt: now }).catch(() => {});
      }

      return res.status(200).json({ ok: true, ...buildCompactWatchState(data) });
    }

    if (req.method === "POST" && normalizedPath === "/cmd") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const watchDeviceId =
        getHeader("X-Watch-Device-Id").trim() ||
        (typeof body.watchDeviceId === "string" ? body.watchDeviceId.trim() : "");
      const watchToken = getHeader("X-Watch-Token").trim();
      const watchSource = typeof body.watchSource === "string" ? body.watchSource.trim() : "";

      if (
        !/^[0-9]{6}$/.test(code) ||
        !watchToken ||
        !watchDeviceId ||
        watchDeviceId.length > 80 ||
        (watchSource && !ALLOWED_WATCH_SOURCES.has(watchSource))
      ) {
        return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
      }

      const now = nowFn();
      const cleanCmd = sanitizeWatchCmd(body.cmd, now);
      if (!cleanCmd) {
        return res.status(400).json({ ok: false, error: "INVALID_COMMAND" });
      }

      const allowed = await allowRateLimitedAction(`watch_cmd_${code}`, 90, 60 * 1000, true);
      if (!allowed) {
        return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
      }

      const telemetry = body.telemetry && typeof body.telemetry === "object" ? body.telemetry : {};
      const docRef = db.collection("watch_sessions").doc(code);

      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          return { status: 404, body: { ok: false, error: "CODE_NOT_FOUND" } };
        }
        const data = snap.data() || {};
        if (extractEpochMs(data.expiresAt) <= now) {
          return { status: 403, body: { ok: false, error: "CODE_EXPIRED" } };
        }
        if (!data.watchDeviceId || data.watchDeviceId !== watchDeviceId) {
          return { status: 403, body: { ok: false, error: "DEVICE_MISMATCH" } };
        }
        if (!data.watchTokenHash || !timingSafeEqualHex(sha256Hex(watchToken), data.watchTokenHash)) {
          return { status: 401, body: { ok: false, error: "INVALID_TOKEN" } };
        }

        const nextSeq = (Number(data.lastWatchCmdSeq) || 0) + 1;
        const patch = {
          lastWatchCmd: { ...cleanCmd, seq: nextSeq },
          lastWatchCmdId: cleanCmd.cmdId,
          lastWatchCmdSeq: nextSeq,
          watchHeartbeatAt: now,
          updatedAt: now
        };
        if (watchSource) {
          patch.watchSource = watchSource;
        }

        const steps = clampNumber(telemetry.watchStepsCount, 0, 1000000);
        if (steps !== undefined) patch.watchStepsCount = steps;

        const dist = clampNumber(telemetry.watchDistanceM, 0, 1000000);
        if (dist !== undefined) patch.watchDistanceM = dist;

        const kcal = clampNumber(telemetry.watchCaloriesKcal, 0, 100000);
        if (kcal !== undefined) patch.watchCaloriesKcal = kcal;

        const hr = clampNumber(telemetry.watchHeartRateBpm, 0, 260);
        if (hr !== undefined) patch.watchHeartRateBpm = hr;

        const avgHr = clampNumber(telemetry.watchAvgHeartRateBpm, 0, 260);
        if (avgHr !== undefined) patch.watchAvgHeartRateBpm = avgHr;

        const maxHr = clampNumber(telemetry.watchMaxHeartRateBpm, 0, 260);
        if (maxHr !== undefined) patch.watchMaxHeartRateBpm = maxHr;

        if (Array.isArray(cleanCmd.zeroGravityVec)) {
          patch.zeroGravityVec = cleanCmd.zeroGravityVec;
        }
        if (cleanCmd.calibrateZeroAt !== undefined) {
          patch.calibrateZeroAt = cleanCmd.calibrateZeroAt;
        }

        tx.update(docRef, patch);
        return {
          status: 200,
          body: {
            ok: true,
            cmdId: cleanCmd.cmdId,
            updatedAt: now,
            state: buildCompactWatchState({ ...data, ...patch })
          }
        };
      });

      return res.status(result.status).json(result.body);
    }

    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }

  async function handlePromoteToCoachClub(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const uid = request.auth.uid;
    const allowed = await allowRateLimitedAction(`promote_coach_${uid}`, 5, 3600 * 1000, true);
    if (!allowed) {
      throw new HttpsError("resource-exhausted", "Too many coach promotion attempts. Please try again later.");
    }

    const payload = request.data && typeof request.data === "object" ? request.data : {};
    const desiredRole =
      typeof payload.desiredRole === "string" && payload.desiredRole.trim()
        ? payload.desiredRole.trim()
        : "team_admin_coach";
    if (!ALLOWED_COACH_ROLES.has(desiredRole)) {
      throw new HttpsError("invalid-argument", "Invalid desired coach role.");
    }

    const now = nowFn();
    const userRef = db.collection("users").doc(uid);
    const publicRef = db.collection("users_public").doc(uid);

    return await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};

      if (isLinkedToExternalCoach(userData, uid)) {
        throw new HttpsError(
          "permission-denied",
          "Cannot create a club while linked to an external coach. Leave your current club first."
        );
      }

      const birthDate =
        typeof payload.birthDate === "string" && payload.birthDate.trim()
          ? payload.birthDate.trim()
          : userData.birthDate;
      const age = calculateAgeYears(birthDate, now);
      if (age === null || age < 18) {
        throw new HttpsError("failed-precondition", "Coach registration requires age >= 18.");
      }

      const clubId = getCanonicalClubId(uid);
      const clubInviteCode = await allocateUniqueInviteCodeInTx(tx, uid, userData.clubInviteCode);
      const clubName =
        typeof payload.clubName === "string" && payload.clubName.trim()
          ? payload.clubName.trim().slice(0, 100)
          : userData.clubName || null;
      const clubCountry =
        typeof payload.clubCountry === "string" && payload.clubCountry.trim()
          ? payload.clubCountry.trim().slice(0, 100)
          : userData.clubCountry || userData.country || "";
      const fullName = String(
        userData.fullName || (request.auth.token && request.auth.token.name) || "Coach"
      ).slice(0, 100);

      const inviteRef = db.collection("coach_invite_codes").doc(clubInviteCode);
      tx.set(inviteRef, {
        code: clubInviteCode,
        coachUid: uid,
        fullName,
        clubId,
        clubName,
        clubCountry,
        clubLogo: typeof userData.clubLogo === "string" ? userData.clubLogo : null,
        role: desiredRole,
        updatedAt: now
      });

      const userPatch = {
        uid,
        role: desiredRole,
        isClubCreator: true,
        clubId,
        clubInviteCode,
        clubName,
        clubCountry,
        coachId: null,
        updatedAt: now
      };
      if (userSnap.exists) {
        tx.update(userRef, userPatch);
      } else {
        tx.set(
          userRef,
          {
            ...userPatch,
            email: (request.auth.token && request.auth.token.email) || "",
            fullName,
            plan: "FREE",
            createdAt: now
          },
          { merge: true }
        );
      }

      tx.set(
        publicRef,
        {
          uid,
          fullName,
          role: desiredRole,
          clubId,
          clubName,
          clubInviteCode: "",
          updatedAt: now
        },
        { merge: true }
      );

      return {
        ok: true,
        profile: {
          role: desiredRole,
          isClubCreator: true,
          clubId,
          clubInviteCode,
          clubName,
          clubCountry,
          coachId: null,
          updatedAt: now
        }
      };
    });
  }

  async function handleVerifyStoreSubscription(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required to verify subscriptions.");
    }

    const uid = request.auth.uid;
    const payload = request.data && typeof request.data === "object" ? request.data : {};
    const requestedSkuRaw = typeof payload.sku === "string" ? payload.sku.trim() : "coach_pro_monthly";
    const canonicalRequestedSku = canonicalizeSku(requestedSkuRaw);
    if (!canonicalRequestedSku) {
      throw new HttpsError("invalid-argument", "Unsupported subscription SKU.");
    }

    const userRef = db.collection("users").doc(uid);
    const userPreSnap = await userRef.get();
    const userPreData = userPreSnap.exists ? userPreSnap.data() || {} : {};
    const now = nowFn();

    const age = calculateAgeYears(userPreData.birthDate, now);
    if (age === null || age < 18) {
      throw new HttpsError("failed-precondition", "Coach PRO subscription requires age >= 18.");
    }

    const enforceReceipts = process.env.BILLING_ENFORCE_SERVER_RECEIPTS === "true";

    if (!enforceReceipts) {
      const allowed = await allowRateLimitedAction(`sub_promo_${uid}`, 3, 86400 * 1000, true);
      if (!allowed) {
        throw new HttpsError("resource-exhausted", "Daily launch promo activation limit reached.");
      }

      const isAnnual = canonicalRequestedSku === "coach_pro_annual";
      const expiresAtMs = now + (isAnnual ? 365 : 30) * 86400 * 1000;
      const logId = `SUB-${now}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const prevUser = snap.exists ? snap.data() || {} : {};

        const updatedFields = {
          plan: "PRO",
          proExpiresAt: expiresAtMs,
          updatedAt: now
        };

        if (!isLinkedToExternalCoach(prevUser, uid)) {
          const targetRole = ALLOWED_COACH_ROLES.has(prevUser.role)
            ? prevUser.role
            : "team_admin_coach";
          const clubId = getCanonicalClubId(uid);
          const clubInviteCode = await allocateUniqueInviteCodeInTx(tx, uid, prevUser.clubInviteCode);
          Object.assign(updatedFields, {
            role: targetRole,
            isClubCreator: true,
            clubId,
            clubInviteCode,
            coachId: null
          });

          tx.set(db.collection("coach_invite_codes").doc(clubInviteCode), {
            code: clubInviteCode,
            coachUid: uid,
            fullName: String(prevUser.fullName || "Coach").slice(0, 100),
            clubId,
            clubName: prevUser.clubName || null,
            clubCountry: prevUser.clubCountry || prevUser.country || "",
            clubLogo: typeof prevUser.clubLogo === "string" ? prevUser.clubLogo : null,
            role: targetRole,
            updatedAt: now
          });
        }

        const auditLog = {
          id: logId,
          userId: uid,
          userName: String(prevUser.fullName || prevUser.email || uid).slice(0, 128),
          previousPlan: prevUser.plan === "PRO" ? "PRO" : "FREE",
          newPlan: "PRO",
          sku: canonicalRequestedSku,
          expiresAt: expiresAtMs,
          createdAt: now,
          updatedAt: now,
          timestamp: new Date(now).toISOString().slice(0, 10),
          source: "launch_promo",
          reason: "Activación de Pase Coach PRO (Lanzamiento)"
        };

        tx.set(userRef, updatedFields, { merge: true });
        tx.set(db.collection("subscription_audit_logs").doc(logId), auditLog);

        return {
          ok: true,
          mode: "launch_promo",
          plan: "PRO",
          proExpiresAt: expiresAtMs,
          sku: canonicalRequestedSku,
          auditLog,
          updatedFields
        };
      });
    }

    const platform = typeof payload.platform === "string" ? payload.platform.trim().toLowerCase() : "";
    const purchaseToken =
      typeof payload.purchaseToken === "string" ? payload.purchaseToken.trim() : "";
    const receiptData =
      typeof payload.receiptData === "string" && payload.receiptData.trim()
        ? payload.receiptData.trim()
        : purchaseToken;

    let normalizedPlatform;
    let rawCredential;
    let verification;
    if (platform === "google_play" || platform === "android") {
      if (!purchaseToken) {
        throw new HttpsError("invalid-argument", "Missing Google Play purchaseToken.");
      }
      normalizedPlatform = "google_play";
      rawCredential = purchaseToken;
      verification = await verifyGooglePlayPurchaseToken(purchaseToken);
    } else if (platform === "app_store" || platform === "ios") {
      if (!receiptData) {
        throw new HttpsError("invalid-argument", "Missing Apple App Store receiptData.");
      }
      normalizedPlatform = "app_store";
      rawCredential = receiptData;
      verification = await verifyAppleAppStoreReceipt(receiptData);
    } else {
      throw new HttpsError("invalid-argument", "Unsupported store platform.");
    }

    if (!verification || !verification.expiresAtMs || verification.expiresAtMs <= now) {
      throw new HttpsError("failed-precondition", "Store subscription is expired or inactive.");
    }

    const finalSku = canonicalizeSku(verification.sku) || canonicalRequestedSku;
    const claimId = sha256Hex(`${normalizedPlatform}:${rawCredential}`);
    const claimRef = db.collection("store_receipt_claims").doc(claimId);
    const logId = `SUB-${now}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return await db.runTransaction(async (tx) => {
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists && claimSnap.data() && claimSnap.data().uid !== uid) {
        throw new HttpsError("already-exists", "Receipt already claimed by another account.");
      }

      const snap = await tx.get(userRef);
      const prevUser = snap.exists ? snap.data() || {} : {};

      const updatedFields = {
        plan: "PRO",
        proExpiresAt: verification.expiresAtMs,
        updatedAt: now
      };

      if (!isLinkedToExternalCoach(prevUser, uid)) {
        const targetRole = ALLOWED_COACH_ROLES.has(prevUser.role)
          ? prevUser.role
          : "team_admin_coach";
        const clubId = getCanonicalClubId(uid);
        const clubInviteCode = await allocateUniqueInviteCodeInTx(tx, uid, prevUser.clubInviteCode);
        Object.assign(updatedFields, {
          role: targetRole,
          isClubCreator: true,
          clubId,
          clubInviteCode,
          coachId: null
        });

        tx.set(db.collection("coach_invite_codes").doc(clubInviteCode), {
          code: clubInviteCode,
          coachUid: uid,
          fullName: String(prevUser.fullName || "Coach").slice(0, 100),
          clubId,
          clubName: prevUser.clubName || null,
          clubCountry: prevUser.clubCountry || prevUser.country || "",
          clubLogo: typeof prevUser.clubLogo === "string" ? prevUser.clubLogo : null,
          role: targetRole,
          updatedAt: now
        });
      }

      const auditLog = {
        id: logId,
        userId: uid,
        userName: String(prevUser.fullName || prevUser.email || uid).slice(0, 128),
        previousPlan: prevUser.plan === "PRO" ? "PRO" : "FREE",
        newPlan: "PRO",
        sku: String(finalSku).slice(0, 80),
        expiresAt: verification.expiresAtMs,
        createdAt: now,
        updatedAt: now,
        timestamp: new Date(now).toISOString().slice(0, 10),
        source: normalizedPlatform,
        reason: `Suscripción verificada en tienda (${normalizedPlatform})`
      };

      tx.set(claimRef, {
        id: claimId,
        uid,
        platform: normalizedPlatform,
        sku: finalSku,
        expiresAt: verification.expiresAtMs,
        updatedAt: now
      });
      tx.set(userRef, updatedFields, { merge: true });
      tx.set(db.collection("subscription_audit_logs").doc(logId), auditLog);

      logger.info("Verified store subscription receipt", {
        uid,
        platform: normalizedPlatform,
        sku: finalSku,
        expiresAt: verification.expiresAtMs
      });

      return {
        ok: true,
        mode: "verified_store_receipt",
        plan: "PRO",
        proExpiresAt: verification.expiresAtMs,
        sku: finalSku,
        auditLog,
        updatedFields
      };
    });
  }

  async function handleRestoreStoreSubscription(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required to restore subscriptions.");
    }

    const uid = request.auth.uid;
    const allowed = await allowRateLimitedAction(`sub_restore_${uid}`, 10, 600 * 1000, true);
    if (!allowed) {
      throw new HttpsError("resource-exhausted", "Too many restore attempts. Please wait a few minutes.");
    }

    const now = nowFn();
    const logsSnap = await db
      .collection("subscription_audit_logs")
      .where("userId", "==", uid)
      .get();

    let bestExpiresAt = 0;
    logsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const planVal = data.newPlan || data.plan;
      const expMs = extractEpochMs(data.expiresAt);
      if (planVal === "PRO" && expMs > now && expMs > bestExpiresAt) {
        bestExpiresAt = expMs;
      }
    });

    if (bestExpiresAt <= now) {
      return { ok: false, restored: false, code: "NO_ACTIVE_SUBSCRIPTION" };
    }

    const userRef = db.collection("users").doc(uid);
    return await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.exists ? userSnap.data() || {} : {};
      const updatedFields = {
        plan: "PRO",
        proExpiresAt: bestExpiresAt,
        updatedAt: now
      };

      if (!isLinkedToExternalCoach(userData, uid)) {
        const targetRole = ALLOWED_COACH_ROLES.has(userData.role)
          ? userData.role
          : "team_admin_coach";
        const clubId = getCanonicalClubId(uid);
        const clubInviteCode = await allocateUniqueInviteCodeInTx(tx, uid, userData.clubInviteCode);
        Object.assign(updatedFields, {
          role: targetRole,
          isClubCreator: true,
          clubId,
          clubInviteCode,
          coachId: null
        });
      }

      tx.set(userRef, updatedFields, { merge: true });
      return {
        ok: true,
        restored: true,
        plan: "PRO",
        proExpiresAt: bestExpiresAt,
        updatedFields
      };
    });
  }

  async function handleLookupCoachInviteCode(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const uid = request.auth.uid;
    const allowed = await allowRateLimitedAction(`invite_lookup_${uid}`, 10, 300 * 1000, true);
    if (!allowed) {
      throw new HttpsError("resource-exhausted", "Too many invite code lookups. Please wait a few minutes.");
    }

    const payload = request.data && typeof request.data === "object" ? request.data : {};
    const code = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!/^[0-9]{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "Invite code must be a 6-digit number.");
    }

    const codeSnap = await db.collection("coach_invite_codes").doc(code).get();
    if (codeSnap.exists) {
      const data = codeSnap.data() || {};
      if (data.coachUid === uid) {
        throw new HttpsError("failed-precondition", "Cannot join your own invite code.");
      }
      return {
        found: true,
        coach: {
          uid: data.coachUid,
          fullName: data.fullName || "",
          clubId: data.clubId || getCanonicalClubId(data.coachUid),
          clubName: data.clubName || null,
          clubCountry: data.clubCountry || "",
          clubLogo: data.clubLogo || null,
          role: data.role || "coach",
          clubInviteCode: code
        }
      };
    }

    const usersSnap = await db
      .collection("users")
      .where("clubInviteCode", "==", code)
      .limit(5)
      .get();

    for (const docSnap of usersSnap.docs) {
      const data = docSnap.data() || {};
      if (!ALLOWED_COACH_ROLES.has(data.role) && data.isClubCreator !== true) {
        continue;
      }
      if (docSnap.id === uid) {
        throw new HttpsError("failed-precondition", "Cannot join your own invite code.");
      }
      return {
        found: true,
        coach: {
          uid: docSnap.id,
          fullName: data.fullName || "",
          clubId: data.clubId || getCanonicalClubId(docSnap.id),
          clubName: data.clubName || null,
          clubCountry: data.clubCountry || data.country || "",
          clubLogo: data.clubLogo || null,
          role: data.role || "coach",
          clubInviteCode: code
        }
      };
    }

    return { found: false };
  }

  async function handleRotateCoachInviteCode(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const uid = request.auth.uid;
    const allowed = await allowRateLimitedAction(`invite_rotate_${uid}`, 5, 600 * 1000, true);
    if (!allowed) {
      throw new HttpsError("resource-exhausted", "Too many invite code rotations. Please wait.");
    }

    const now = nowFn();
    const userRef = db.collection("users").doc(uid);

    return await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }
      const userData = userSnap.data() || {};
      if (isLinkedToExternalCoach(userData, uid)) {
        throw new HttpsError("permission-denied", "Linked athletes cannot rotate a club invite code.");
      }
      const age = calculateAgeYears(userData.birthDate, now);
      if (age === null || age < 18) {
        throw new HttpsError("failed-precondition", "Coach club management requires age >= 18.");
      }

      const oldCode = typeof userData.clubInviteCode === "string" ? userData.clubInviteCode.trim() : "";
      let oldInviteRef = null;
      let oldInviteOwned = false;
      if (/^[0-9]{6}$/.test(oldCode)) {
        oldInviteRef = db.collection("coach_invite_codes").doc(oldCode);
        const oldSnap = await tx.get(oldInviteRef);
        if (oldSnap.exists && oldSnap.data() && oldSnap.data().coachUid === uid) {
          oldInviteOwned = true;
        }
      }

      let newCode = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = String(randomIntFn(100000, 1000000));
        if (candidate === oldCode) continue;
        const candidateSnap = await tx.get(db.collection("coach_invite_codes").doc(candidate));
        if (!candidateSnap.exists) {
          newCode = candidate;
          break;
        }
      }
      if (!newCode) {
        throw new HttpsError("resource-exhausted", "Unable to allocate a unique 6-digit invite code.");
      }

      const clubId = getCanonicalClubId(uid);
      const role = ALLOWED_COACH_ROLES.has(userData.role) ? userData.role : "coach";

      if (oldInviteOwned && oldInviteRef) {
        tx.delete(oldInviteRef);
      }

      tx.set(db.collection("coach_invite_codes").doc(newCode), {
        code: newCode,
        coachUid: uid,
        fullName: String(userData.fullName || "Coach").slice(0, 100),
        clubId,
        clubName: userData.clubName || null,
        clubCountry: userData.clubCountry || userData.country || "",
        clubLogo: typeof userData.clubLogo === "string" ? userData.clubLogo : null,
        role,
        updatedAt: now
      });

      tx.update(userRef, {
        clubInviteCode: newCode,
        clubId,
        updatedAt: now
      });

      return {
        ok: true,
        clubInviteCode: newCode,
        clubId
      };
    });
  }

  async function handlePurgeDeletedUserAccount(request) {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required to purge account data.");
    }

    const callerUid = request.auth.uid;
    const requestedUid =
      request.data && typeof request.data.uid === "string" && request.data.uid.trim()
        ? request.data.uid.trim()
        : callerUid;

    if (requestedUid !== callerUid && !isCallerSuperAdmin(request.auth.token)) {
      throw new HttpsError("permission-denied", "Only the account owner or SuperAdmin can purge this account.");
    }

    const uid = requestedUid;
    const ownerHash = sha256Hex(uid);
    const scopedQueries = [
      { label: "sessions", query: db.collection("sessions").where("userId", "==", uid) },
      { label: "calendar_events", query: db.collection("calendar_events").where("createdByUid", "==", uid) },
      { label: "macrocycles", query: db.collection("macrocycles").where("coachId", "==", uid) },
      { label: "star_history", query: db.collection("star_history").where("userId", "==", uid) },
      { label: "active_duels.creatorUid", query: db.collection("active_duels").where("creatorUid", "==", uid) },
      { label: "active_duels.playerUid", query: db.collection("active_duels").where("playerUid", "==", uid) },
      { label: "duel_invitations.senderUid", query: db.collection("duel_invitations").where("senderUid", "==", uid) },
      { label: "duel_invitations.receiverUid", query: db.collection("duel_invitations").where("receiverUid", "==", uid) },
      { label: "coach_notifications.athleteUid", query: db.collection("coach_notifications").where("athleteUid", "==", uid) },
      { label: "coach_notifications.coachUid", query: db.collection("coach_notifications").where("coachUid", "==", uid) },
      { label: "coach_records.athleteUid", query: db.collection("coach_records").where("athleteUid", "==", uid) },
      { label: "coach_records.coachId", query: db.collection("coach_records").where("coachId", "==", uid) },
      { label: "coach_invite_codes", query: db.collection("coach_invite_codes").where("coachUid", "==", uid) },
      { label: "watch_sessions", query: db.collection("watch_sessions").where("userId", "==", uid) },
      { label: "watch_pairings", query: db.collection("watch_pairings").where("ownerHash", "==", ownerHash) },
      { label: "subscription_audit_logs", query: db.collection("subscription_audit_logs").where("userId", "==", uid) },
      { label: "client_error_logs", query: db.collection("client_error_logs").where("userId", "==", uid) },
      { label: "store_receipt_claims", query: db.collection("store_receipt_claims").where("uid", "==", uid) }
    ];

    let deletedCount = 0;
    const failedCollections = [];
    for (const item of scopedQueries) {
      try {
        deletedCount += await deleteQueryInChunks(item.query, BATCH_DELETE_CHUNK_SIZE);
      } catch (err) {
        failedCollections.push(item.label);
        logger.warn("Purge collection query failed", {
          uid,
          collection: item.label,
          message: err && err.message
        });
      }
    }

    try {
      const directBatch = db.batch();
      directBatch.delete(db.collection("athlete_stars").doc(uid));
      directBatch.delete(db.collection("users_public").doc(uid));
      directBatch.delete(db.collection("users").doc(uid));
      await directBatch.commit();
      deletedCount += 3;
    } catch (err) {
      failedCollections.push("direct_user_docs");
      logger.warn("Purge direct user docs failed", { uid, message: err && err.message });
    }

    let authDeleted = false;
    const shouldDeleteAuth = !request.data || request.data.deleteAuth !== false;
    if (shouldDeleteAuth) {
      try {
        await auth.deleteUser(uid);
        authDeleted = true;
      } catch (err) {
        if (err && err.code === "auth/user-not-found") {
          authDeleted = true;
        } else {
          failedCollections.push("firebase_auth");
          logger.warn("Purge auth user failed", { uid, message: err && err.message });
        }
      }
    }

    logger.info("Purged deleted user account data", {
      uid,
      deletedCount,
      authDeleted,
      failedCollections
    });
    return { ok: true, uid, deletedCount, authDeleted, failedCollections };
  }

  return {
    allowRateLimitedAction,
    sendFcmPushToUser,
    handleDuelInvitationCreated,
    handleCoachNotificationCreated,
    handleWatchCloudBridge,
    handlePromoteToCoachClub,
    handleVerifyStoreSubscription,
    handleRestoreStoreSubscription,
    handleLookupCoachInviteCode,
    handleRotateCoachInviteCode,
    handlePurgeDeletedUserAccount
  };
}

const defaultHandlers = createHandlers();

exports.onDuelInvitationCreated = onDocumentCreated(
  "duel_invitations/{invitationId}",
  defaultHandlers.handleDuelInvitationCreated
);

exports.onCoachNotificationCreated = onDocumentCreated(
  "coach_notifications/{notificationId}",
  defaultHandlers.handleCoachNotificationCreated
);

exports.watchCloudBridge = onRequest(
  { region: "us-central1", cors: true, maxInstances: 20 },
  defaultHandlers.handleWatchCloudBridge
);

exports.promoteToCoachClub = onCall(defaultHandlers.handlePromoteToCoachClub);
exports.verifyStoreSubscription = onCall(defaultHandlers.handleVerifyStoreSubscription);
exports.restoreStoreSubscription = onCall(defaultHandlers.handleRestoreStoreSubscription);
exports.lookupCoachInviteCode = onCall(defaultHandlers.handleLookupCoachInviteCode);
exports.rotateCoachInviteCode = onCall(defaultHandlers.handleRotateCoachInviteCode);
exports.purgeDeletedUserAccount = onCall(defaultHandlers.handlePurgeDeletedUserAccount);

exports._internal = {
  createHandlers,
  sha256Hex,
  timingSafeEqualHex,
  clampNumber,
  canonicalizeSku,
  calculateAgeYears,
  getCanonicalClubId,
  isLinkedToExternalCoach,
  isCallerSuperAdmin,
  buildCompactWatchState,
  sanitizeWatchCmd
};
