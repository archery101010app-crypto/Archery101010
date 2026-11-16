const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function formatBowLabel(bowType) {
  if (bowType === "Recurve") return "Recurvo";
  if (bowType === "Compound") return "Compuesto";
  if (bowType === "Barebow") return "Barebow";
  return bowType || "1 vs 1";
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
          icon: "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
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
        senderUid: data.senderUid || "",
        url: joinPath
      }
    );
  }
);

/**
 * Sends a push notification to the Coach when an athlete links or unlinks via invite code.
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
        athleteUid: data.athleteUid || "",
        url: "/"
      }
    );
  }
);
