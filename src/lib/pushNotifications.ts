import { getMessagingInstance } from "./firebase";
import { getToken } from "firebase/messaging";
import { updateProfile } from "./authService";

const SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890";
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/**
 * Actively requests notification permissions from the user.
 * If granted, registers the service worker and updates the FCM token on their profile.
 */
export async function requestPushPermissionAndRegister(userUid: string): Promise<string | null> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("Notifications are not supported in this browser.");
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("Notification permission was denied by the user.");
      return null;
    }

    if (!VAPID_KEY) {
      console.warn("FCM Web Push requires NEXT_PUBLIC_FIREBASE_VAPID_KEY in environment. Push token registration skipped.");
      return null;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      console.warn("Firebase Messaging is not initialized or supported.");
      return null;
    }

    // Register FCM Service Worker dynamically passing the sender ID as query param
    const swUrl = `/firebase-messaging-sw.js?messagingSenderId=${encodeURIComponent(SENDER_ID)}`;
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: "/firebase-messaging" // Give it a separate scope to prevent colliding with root sw.js
    });

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) {
      console.log("FCM push token registered successfully:", token);
      await updateProfile(userUid, { fcmToken: token } as any);
      return token;
    }
  } catch (err) {
    console.error("Error setting up Firebase Cloud Messaging push token:", err);
  }

  return null;
}

/**
 * Checks if the user already granted permissions, and silently registers/refreshes the FCM token.
 */
export async function registerPushSilent(userUid: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  if (Notification.permission === "granted" && VAPID_KEY) {
    try {
      const messaging = await getMessagingInstance();
      if (messaging) {
        const swUrl = `/firebase-messaging-sw.js?messagingSenderId=${encodeURIComponent(SENDER_ID)}`;
        const registration = await navigator.serviceWorker.register(swUrl, {
          scope: "/firebase-messaging"
        });

        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration
        });

        if (token) {
          console.log("FCM silent token refresh success.");
          await updateProfile(userUid, { fcmToken: token } as any);
        }
      }
    } catch (err) {
      console.warn("Silent FCM token registration failed:", err);
    }
  }
}
