const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PLAY_PACKAGE_NAME = "com.archery101010.app";
const BATCH_DELETE_CHUNK_SIZE = 400;

function formatBowLabel(bowType) {
  if (bowType === "Recurve") return "Recurvo";
  if (bowType === "Compound") return "Compuesto";
  if (bowType === "Barebow") return "Barebow";
  return bowType || "1 vs 1";
}

/**
 * Firestore-backed sliding/fixed window per-sender rate limiter (`rate_limits/{key}`).
 */
async function allowRateLimitedAction(key, maxPerWindow, windowMs) {
  const safeKey = String(key || "")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 180);
  if (!safeKey || maxPerWindow <= 0 || windowMs <= 0) {
    return false;
  }

  const now = Date.now();
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
          expireAt: admin.firestore.Timestamp.fromMillis(now + ttlMs)
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
    logger.warn("Rate limiter transaction error; failing open safely", {
      key: safeKey,
      message: err && err.message
    });
    return true;
  }
}

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
  const fcmToken = typeof userData.fcmToken === "string" ? userData.fcmToken.trim() : "";
  if (!fcmToken) {
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
    await admin.messaging().send({
      token: fcmToken,
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
          sound: "default",
          icon: "ic_stat_notify"
        }
      }
    });

    logger.info("FCM push delivered", { targetUid, type: cleanData.type || "general" });
    return true;
  } catch (err) {
    const code = err && err.code ? String(err.code) : "";
    logger.warn("Failed to deliver FCM push", { targetUid, code, message: err && err.message });

    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await userRef
        .update({
          fcmToken: "",
          updatedAt: Date.now()
        })
        .catch(() => {});
    }
    return false;
  }
}

/**
 * Sends a push notification when a 1v1 online duel invitation is created.
 * Rate-limited to max 8 push invites per minute per senderUid.
 */
exports.onDuelInvitationCreated = onDocumentCreated(
  "duel_invitations/{invitationId}",
  async (event) => {
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

    const allowed = await allowRateLimitedAction(`duel_invite_${senderUid}`, 8, 60 * 1000);
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
);

/**
 * Sends a push notification to the Coach when an athlete links or unlinks via invite code.
 * Rate-limited to max 10 notifications per minute per athleteUid.
 */
exports.onCoachNotificationCreated = onDocumentCreated(
  "coach_notifications/{notificationId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data || !data.coachUid || data.read === true) {
      return;
    }

    const athleteUid = typeof data.athleteUid === "string" ? data.athleteUid.trim() : "";
    if (athleteUid) {
      const allowed = await allowRateLimitedAction(`coach_notif_${athleteUid}`, 10, 60 * 1000);
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
);

/**
 * Deletes all documents matching `baseQuery` in bounded chunks of 400 (below Firestore 500-op WriteBatch limit).
 */
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

function isCallerSuperAdmin(authToken) {
  if (!authToken) return false;
  if (authToken.superadmin === true || authToken.role === "superadmin") return true;
  const email = typeof authToken.email === "string" ? authToken.email.toLowerCase() : "";
  return (
    authToken.email_verified === true &&
    [
      "admin@archery101010.com",
      "admin101010@archery101010.com",
      "archery101010app@gmail.com",
      "info@archery101010.com"
    ].includes(email)
  );
}

/**
 * GDPR / Play Store / App Store Account Data Purge (`onCall` v2).
 * Batch-deletes all user documents across core collections in chunks of 400.
 */
exports.purgeDeletedUserAccount = onCall(async (request) => {
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
  const scopedQueries = [
    db.collection("sessions").where("userId", "==", uid),
    db.collection("calendar_events").where("createdByUid", "==", uid),
    db.collection("star_history").where("userId", "==", uid),
    db.collection("active_duels").where("creatorUid", "==", uid),
    db.collection("coach_notifications").where("athleteUid", "==", uid),
    db.collection("coach_notifications").where("coachUid", "==", uid),
    db.collection("coach_records").where("athleteUid", "==", uid),
    db.collection("coach_records").where("coachId", "==", uid)
  ];

  let deletedCount = 0;
  for (const q of scopedQueries) {
    deletedCount += await deleteQueryInChunks(q, BATCH_DELETE_CHUNK_SIZE);
  }

  const directBatch = db.batch();
  directBatch.delete(db.collection("athlete_stars").doc(uid));
  directBatch.delete(db.collection("users_public").doc(uid));
  directBatch.delete(db.collection("users").doc(uid));
  await directBatch.commit();
  deletedCount += 3;

  logger.info("Purged deleted user account data", { uid, deletedCount });
  return { ok: true, uid, deletedCount };
});

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getGooglePlayAccessToken(serviceAccount) {
  const nowSec = Math.floor(Date.now() / 1000);
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

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`
    })
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
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
  const serviceAccount = JSON.parse(rawSa);
  const accessToken = await getGooglePlayAccessToken(serviceAccount);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(
    purchaseToken
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new HttpsError("permission-denied", "Invalid or unrecognized Google Play purchase token.");
  }

  const lineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
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
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "receipt-data": receiptData,
        password: sharedSecret,
        "exclude-old-transactions": true
      })
    });
    return res.json();
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

/**
 * Server-side Google Play / Apple App Store subscription receipt verifier (`onCall` v2).
 * Returns `{ ok: true, mode: "launch_promo" }` while launch promo is active (`BILLING_ENFORCE_SERVER_RECEIPTS !== "true"`).
 */
exports.verifyStoreSubscription = onCall(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required to verify subscriptions.");
  }

  if (process.env.BILLING_ENFORCE_SERVER_RECEIPTS !== "true") {
    return { ok: true, mode: "launch_promo" };
  }

  const uid = request.auth.uid;
  const payload = request.data || {};
  const platform = typeof payload.platform === "string" ? payload.platform.trim().toLowerCase() : "";
  const requestedSku = typeof payload.sku === "string" ? payload.sku.trim() : "coach_pro_monthly";
  const purchaseToken =
    typeof payload.purchaseToken === "string" ? payload.purchaseToken.trim() : "";
  const receiptData =
    typeof payload.receiptData === "string"
      ? payload.receiptData.trim()
      : purchaseToken;

  let verification;
  if (platform === "google_play" || platform === "android") {
    if (!purchaseToken) {
      throw new HttpsError("invalid-argument", "Missing Google Play purchaseToken.");
    }
    verification = await verifyGooglePlayPurchaseToken(purchaseToken);
  } else if (platform === "app_store" || platform === "ios") {
    if (!receiptData) {
      throw new HttpsError("invalid-argument", "Missing Apple App Store receiptData.");
    }
    verification = await verifyAppleAppStoreReceipt(receiptData);
  } else {
    throw new HttpsError("invalid-argument", "Unsupported store platform.");
  }

  const now = Date.now();
  if (!verification || !verification.expiresAtMs || verification.expiresAtMs <= now) {
    throw new HttpsError("failed-precondition", "Store subscription is expired or inactive.");
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const prevUser = userSnap.exists ? userSnap.data() || {} : {};
  const finalSku = verification.sku || requestedSku;
  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  const logId = `SUB-${now}-${randomSuffix}`;

  const auditEntry = {
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
    source: platform,
    reason: `Suscripción verificada en tienda (${platform})`
  };

  const batch = db.batch();
  batch.set(
    userRef,
    {
      plan: "PRO",
      proExpiresAt: verification.expiresAtMs,
      updatedAt: now
    },
    { merge: true }
  );
  batch.set(db.collection("subscription_audit_logs").doc(logId), auditEntry);
  await batch.commit();

  logger.info("Verified store subscription receipt", {
    uid,
    platform,
    sku: finalSku,
    expiresAt: verification.expiresAtMs
  });

  return {
    ok: true,
    mode: "verified_store_receipt",
    plan: "PRO",
    proExpiresAt: verification.expiresAtMs,
    sku: finalSku
  };
});
