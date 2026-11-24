import { getMessagingInstance } from "./firebase";
import { getToken } from "firebase/messaging";
import { getLoggedUser, updateProfile } from "./authService";

const SENDER_ID = (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "757910399585").trim();
const VAPID_KEY = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "").trim();
const MESSAGING_SW_SCOPE = "/firebase-messaging";
const MAX_FCM_TOKENS = 10;

async function persistBoundedFcmToken(userUid: string, rawToken: string): Promise<void> {
  const token = rawToken.trim();
  if (!userUid || userUid === "USR-GUEST-OFFLINE" || token.length < 10 || token.length > 512) {
    return;
  }
  const currentUser = await getLoggedUser();
  const existingList =
    currentUser && currentUser.uid === userUid && Array.isArray(currentUser.fcmTokens)
      ? currentUser.fcmTokens
      : [];
  const legacySingle =
    currentUser && currentUser.uid === userUid && typeof currentUser.fcmToken === "string"
      ? currentUser.fcmToken.trim()
      : "";
  const mergedTokens: string[] = [token];
  for (const candidate of [...existingList, legacySingle]) {
    if (typeof candidate !== "string") continue;
    const clean = candidate.trim();
    if (clean.length >= 10 && clean.length <= 512 && !mergedTokens.includes(clean)) {
      mergedTokens.push(clean);
    }
    if (mergedTokens.length >= MAX_FCM_TOKENS) break;
  }
  await updateProfile(userUid, {
    fcmToken: token,
    fcmTokens: mergedTokens
  });
}

export interface PushSetupOutcome {
  enabled: boolean;
  mode: "fcm" | "in_app" | "denied";
  token: string | null;
  message: string;
}

export interface NotificationCapabilityStatus {
  supported: boolean;
  webPushAvailable: boolean;
  inAppRealtimeAvailable: boolean;
  inWebView: boolean;
  hasVapidKey: boolean;
  permission: NotificationPermission | "unsupported";
  activeMode: "fcm" | "in_app" | "denied" | "prompt";
  statusLabel: string;
  description: string;
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

function buildMessagingSwUrl(): string {
  const params = new URLSearchParams({
    messagingSenderId: SENDER_ID
  });
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    params.set("apiKey", process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  }
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    params.set("projectId", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  }
  if (process.env.NEXT_PUBLIC_FIREBASE_APP_ID) {
    params.set("appId", process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
  }
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

async function getOrRegisterMessagingServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration(MESSAGING_SW_SCOPE);
    if (existing) {
      return existing;
    }
    const swUrl = buildMessagingSwUrl();
    return await navigator.serviceWorker.register(swUrl, {
      scope: MESSAGING_SW_SCOPE
    });
  } catch (err) {
    console.warn("Could not register firebase-messaging-sw.js:", err);
    return null;
  }
}

/**
 * Exposes a clean capability summary so UI screens can clearly distinguish
 * full Web Push (FCM background notifications) vs In-App Real-Time Firestore alerts.
 */
export function getNotificationCapabilityStatus(): NotificationCapabilityStatus {
  if (typeof window === "undefined") {
    return {
      supported: false,
      webPushAvailable: false,
      inAppRealtimeAvailable: false,
      inWebView: false,
      hasVapidKey: Boolean(VAPID_KEY),
      permission: "unsupported",
      activeMode: "in_app",
      statusLabel: "No disponible",
      description: "Entorno de servidor sin soporte de notificaciones."
    };
  }

  const inWebView = isAndroidOrCapacitorWebView();
  const hasWebNotification =
    "Notification" in window && typeof Notification?.requestPermission === "function";
  const hasServiceWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const hasVapidKey = Boolean(VAPID_KEY);
  const permission: NotificationPermission | "unsupported" = hasWebNotification
    ? Notification.permission
    : "unsupported";

  const webPushAvailable = !inWebView && hasWebNotification && hasServiceWorker && hasVapidKey;

  if (!inWebView && permission === "denied") {
    return {
      supported: true,
      webPushAvailable,
      inAppRealtimeAvailable: true,
      inWebView,
      hasVapidKey,
      permission,
      activeMode: "denied",
      statusLabel: "Alertas en App (Push bloqueado)",
      description:
        "Las notificaciones del navegador están bloqueadas; recibirás alertas en vivo dentro de la app."
    };
  }

  if (webPushAvailable && permission === "granted") {
    return {
      supported: true,
      webPushAvailable: true,
      inAppRealtimeAvailable: true,
      inWebView: false,
      hasVapidKey: true,
      permission,
      activeMode: "fcm",
      statusLabel: "Web Push + Tiempo Real Activo",
      description:
        "Recibirás notificaciones Push en segundo plano y alertas instantáneas dentro de ARCHERY 101010."
    };
  }

  if (webPushAvailable && permission === "default") {
    return {
      supported: true,
      webPushAvailable: true,
      inAppRealtimeAvailable: true,
      inWebView: false,
      hasVapidKey: true,
      permission,
      activeMode: "prompt",
      statusLabel: "Push Disponible (Pendiente de Permiso)",
      description:
        "Activa las notificaciones para recibir avisos de retos en línea y vinculación de alumnos incluso con la app cerrada."
    };
  }

  return {
    supported: true,
    webPushAvailable: false,
    inAppRealtimeAvailable: true,
    inWebView,
    hasVapidKey,
    permission,
    activeMode: "in_app",
    statusLabel: "Alertas en Tiempo Real en la App",
    description: inWebView
      ? "Alertas instantáneas activas en tiempo real mientras usas la aplicación móvil."
      : "Alertas instantáneas activas en tiempo real dentro de ARCHERY 101010."
  };
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
  const hasWebNotification =
    "Notification" in window && typeof Notification?.requestPermission === "function";
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
        message:
          "Permiso de notificaciones denegado. Puedes habilitarlo en los ajustes del navegador."
      };
    }

    const [messaging, registration] = await Promise.all([
      getMessagingInstance(),
      getOrRegisterMessagingServiceWorker()
    ]);

    if (!messaging || !registration) {
      return {
        enabled: true,
        mode: "in_app",
        token: null,
        message: "Alertas en tiempo real activadas dentro de la aplicación."
      };
    }

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) {
      if (userUid && userUid !== "USR-GUEST-OFFLINE") {
        await persistBoundedFcmToken(userUid, token);
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
      message: "Alertas en tiempo real activadas dentro de la aplicación."
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
      const [messaging, registration] = await Promise.all([
        getMessagingInstance(),
        getOrRegisterMessagingServiceWorker()
      ]);

      if (messaging && registration) {
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration
        });

        if (token) {
          await persistBoundedFcmToken(userUid, token);
        }
      }
    } catch (err) {
      console.warn("Silent FCM token registration failed:", err);
    }
  }
}
