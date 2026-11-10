import { getMessagingInstance } from "./firebase";
import { getToken } from "firebase/messaging";
import { updateProfile } from "./authService";

const SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "757910399585";
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

export interface PushSetupOutcome {
  enabled: boolean;
  mode: "fcm" | "in_app" | "denied";
  token: string | null;
  message: string;
}

export function isAndroidOrCapacitorWebView(): boolean {
  if (typeof window === "undefined") return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  return Boolean(
    (window as any).Capacitor?.isNativePlatform?.() ||
      (window as any).ArcheryNativeAuth ||
      /; wv\)/i.test(ua) ||
      (/Android/i.test(ua) && /Version\/\d+/i.test(ua))
  );
}

/**
 * Requests notification permissions cleanly across Web and Android WebView.
 * Detects Android WebView or missing VAPID_KEY gracefully and falls back to in-app notifications
 * without crashing or forcing false permission rejections.
 */
export async function configurePushOrInAppNotifications(
  userUid: string
): Promise<PushSetupOutcome> {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      mode: "denied",
      token: null,
      message: "Entorno no compatible con notificaciones."
    };
  }

  const inWebView = isAndroidOrCapacitorWebView();
  const hasWebNotification = "Notification" in window && typeof Notification?.requestPermission === "function";
  const hasServiceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;

  // Android WebView or environments without Web Push API / VAPID_KEY -> enable clean In-App alerts
  if (inWebView || !hasWebNotification || !hasServiceWorker || !VAPID_KEY) {
    if (hasWebNotification && !inWebView) {
      try {
        const perm = await Notification.requestPermission();
        if (perm === "denied") {
          return {
            enabled: false,
            mode: "denied",
            token: null,
            message: "Permiso de notificaciones bloqueado en el navegador."
          };
        }
      } catch {
        // Proceed with in-app notifications
      }
    }

    return {
      enabled: true,
      mode: "in_app",
      token: null,
      message: inWebView
        ? "Alertas activadas dentro de la aplicación móvil en tiempo real."
        : "Alertas en tiempo real activadas dentro de la aplicación."
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        enabled: false,
        mode: "denied",
        token: null,
        message: "Permiso de notificaciones denegado. Puedes habilitarlo en los ajustes del navegador."
      };
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
      return {
        enabled: true,
        mode: "in_app",
        token: null,
        message: "Alertas activadas dentro de la aplicación."
      };
    }

    const swUrl = `/firebase-messaging-sw.js?messagingSenderId=${encodeURIComponent(SENDER_ID)}`;
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: "/firebase-messaging"
    });

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) {
      if (userUid && userUid !== "USR-GUEST-OFFLINE") {
        await updateProfile(userUid, { fcmToken: token } as any);
      }
      return {
        enabled: true,
        mode: "fcm",
        token,
        message: "¡Notificaciones Push activadas y vinculadas a tu dispositivo!"
      };
    }

    return {
      enabled: true,
      mode: "in_app",
      token: null,
      message: "Alertas activadas dentro de la aplicación."
    };
  } catch (err) {
    console.warn("Web Push fallback to in-app notifications:", err);
    return {
      enabled: true,
      mode: "in_app",
      token: null,
      message: "Alertas en tiempo real activadas dentro de la aplicación."
    };
  }
}

/**
 * Actively requests notification permissions from the user.
 * If granted, registers the service worker and updates the FCM token on their profile.
 */
export async function requestPushPermissionAndRegister(userUid: string): Promise<string | null> {
  const outcome = await configurePushOrInAppNotifications(userUid);
  if (outcome.token) return outcome.token;
  return outcome.enabled ? "IN_APP_ENABLED" : null;
}

/**
 * Checks if the user already granted permissions, and silently registers/refreshes the FCM token.
 */
export async function registerPushSilent(userUid: string): Promise<void> {
  if (
    typeof window === "undefined" ||
    !userUid ||
    userUid === "USR-GUEST-OFFLINE" ||
    isAndroidOrCapacitorWebView() ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

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
          await updateProfile(userUid, { fcmToken: token } as any);
        }
      }
    } catch (err) {
      console.warn("Silent FCM token registration failed:", err);
    }
  }
}
