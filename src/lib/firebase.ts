import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  enableNetwork,
  disableNetwork,
  type Firestore
} from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const rawFirebaseEnv = (process.env.NEXT_PUBLIC_FIREBASE_ENV || "").trim().toLowerCase();
const testProjectId = (process.env.NEXT_PUBLIC_FIREBASE_TEST_PROJECT_ID || "").trim();
const testApiKey = (process.env.NEXT_PUBLIC_FIREBASE_TEST_API_KEY || "").trim();
const hasDistinctTestConfig = Boolean(
  testProjectId && testProjectId !== "archery101010-c0bb4" && testApiKey
);

// Configurations for different environments (dynamically mapped at runtime)
const firebaseConfigs = {
  test: {
    apiKey: testApiKey || "AIzaSyDFhnSTI6WbxHB8duYukpEBk9wKjxpduTE",
    authDomain:
      process.env.NEXT_PUBLIC_FIREBASE_TEST_AUTH_DOMAIN ||
      (testProjectId ? `${testProjectId}.firebaseapp.com` : "archery101010-c0bb4.firebaseapp.com"),
    projectId: testProjectId || "archery101010-c0bb4",
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_TEST_STORAGE_BUCKET ||
      (testProjectId ? `${testProjectId}.firebasestorage.app` : "archery101010-c0bb4.firebasestorage.app"),
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_TEST_MESSAGING_SENDER_ID || "757910399585",
    appId: process.env.NEXT_PUBLIC_FIREBASE_TEST_APP_ID || "1:757910399585:web:3cbcf50a21971cdc5b5820"
  },
  prod: {
    apiKey: "AIzaSyDFhnSTI6WbxHB8duYukpEBk9wKjxpduTE",
    authDomain: "archery101010-c0bb4.firebaseapp.com",
    projectId: "archery101010-c0bb4",
    storageBucket: "archery101010-c0bb4.firebasestorage.app",
    messagingSenderId: "757910399585",
    appId: "1:757910399585:web:3cbcf50a21971cdc5b5820"
  },
  mock: {
    apiKey: "mock-api-key-archery101010-2026",
    authDomain: "archery101010.firebaseapp.com",
    projectId: "archery101010",
    storageBucket: "archery101010.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
  }
};

export function isNativeCapacitorRuntime(win?: any): boolean {
  const w = win ?? (typeof window !== "undefined" ? (window as any) : null);
  if (!w) return false;
  const protocol = String(w.location?.protocol || "");
  if (protocol === "capacitor:" || protocol === "ionic:") return true;
  if (typeof w.Capacitor?.isNativePlatform === "function" && w.Capacitor.isNativePlatform()) {
    return true;
  }
  return Boolean(
    w.ArcheryNativeAuth ||
      w.ArcheryWatchNativeBridge ||
      w.ArcheryBleHeartRateBridge ||
      w.ArcheryBleHrBridge
  );
}

// Select configuration based on environment and current URL
let activeConfig = firebaseConfigs.prod; // Default to production
export let ACTIVE_ENV: "test" | "prod" | "mock" =
  rawFirebaseEnv === "test" ? "test" : "prod";

if (typeof window !== "undefined") {
  const host = window.location.hostname;
  const isNative = isNativeCapacitorRuntime(window);
  const isLocalhost = !isNative && (host === "localhost" || host === "127.0.0.1");
  const isTestEnv =
    rawFirebaseEnv === "test" ||
    host.includes("archery101010-tst") ||
    host.includes("101010-tst") ||
    host.includes("tst");

  if (isLocalhost) {
    if (rawFirebaseEnv === "test") {
      ACTIVE_ENV = "test";
      if (!testProjectId || testProjectId === "archery101010-c0bb4" || !hasDistinctTestConfig) {
        console.warn(
          "[Firebase] Test environment variables not configured; refusing silent alias without explicit test project."
        );
        activeConfig = firebaseConfigs.mock;
      } else {
        activeConfig = firebaseConfigs.test;
        console.warn(
          `[Firebase] TEST mode active on localhost using test project "${firebaseConfigs.test.projectId}".`
        );
      }
    } else {
      const envKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
      if (envKey && !envKey.includes("mock-api-key")) {
        ACTIVE_ENV = "prod";
        activeConfig = {
          apiKey: envKey,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "archery101010-c0bb4.firebaseapp.com",
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "archery101010-c0bb4",
          storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "archery101010-c0bb4.firebasestorage.app",
          messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "757910399585",
          appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:757910399585:web:3cbcf50a21971cdc5b5820"
        };
      } else {
        ACTIVE_ENV = "mock";
        activeConfig = firebaseConfigs.mock;
      }
    }
  } else if (isTestEnv) {
    ACTIVE_ENV = "test";
    activeConfig = firebaseConfigs.test;
    if (!testProjectId || testProjectId === "archery101010-c0bb4" || !hasDistinctTestConfig) {
      console.warn(
        "[Firebase] Test environment variables not configured; refusing silent alias without explicit test project."
      );
    } else {
      console.warn(
        `[Firebase] Running in TEST mode against isolated project "${firebaseConfigs.test.projectId}".`
      );
    }
  } else {
    // Canonical Firebase Auth domain registered with Google OAuth redirect URIs
    ACTIVE_ENV = "prod";
    activeConfig = firebaseConfigs.prod;
  }
} else {
  // Server-side (SSR / Static Build) fallback
  if (ACTIVE_ENV === "test") {
    if (!testProjectId || testProjectId === "archery101010-c0bb4" || !hasDistinctTestConfig) {
      console.warn(
        "[Firebase] Test environment variables not configured; refusing silent alias without explicit test project."
      );
    } else {
      activeConfig = firebaseConfigs.test;
    }
  } else {
    const envKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (envKey && !envKey.includes("mock-api-key")) {
      activeConfig = {
        apiKey: envKey,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "archery101010-c0bb4.firebaseapp.com",
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "archery101010-c0bb4",
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "archery101010-c0bb4.firebasestorage.app",
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "757910399585",
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:757910399585:web:3cbcf50a21971cdc5b5820"
      };
    }
  }
}

// Initialize Firebase
export const app = getApps().length === 0 ? initializeApp(activeConfig) : getApp();

// Optional client-side Firebase App Check initialization (safe for offline & Capacitor builds)
export let appCheck: AppCheck | null = null;
if (typeof window !== "undefined") {
  const recaptchaSiteKey = (process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "").trim();
  if (recaptchaSiteKey) {
    try {
      const win = window as unknown as { __archeryAppCheck?: AppCheck };
      if (win.__archeryAppCheck) {
        appCheck = win.__archeryAppCheck;
      } else {
        appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true
        });
        win.__archeryAppCheck = appCheck;
      }
    } catch (err) {
      console.warn("[Firebase] App Check initialization skipped:", err);
    }
  }
}

export const auth = getAuth(app);

// ignoreUndefinedProperties: never reject a write because an optional field is `undefined`
// (root cause of sessions/profiles silently failing to sync to the cloud).
// persistentLocalCache + persistentMultipleTabManager cuts cold-start Firestore reads via resume tokens.
function createFirestore(): Firestore {
  if (typeof window !== "undefined") {
    try {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        }),
        ignoreUndefinedProperties: true,
        experimentalAutoDetectLongPolling: true
      });
    } catch {
      try {
        return initializeFirestore(app, {
          ignoreUndefinedProperties: true,
          experimentalAutoDetectLongPolling: true
        });
      } catch {
        return getFirestore(app);
      }
    }
  }

  try {
    return initializeFirestore(app, {
      ignoreUndefinedProperties: true
    });
  } catch {
    // Already initialized (hot reload) – reuse existing instance
    return getFirestore(app);
  }
}
export const db = createFirestore();

// Safe messaging initialization (only in client browser, checking compatibility)
export const getMessagingInstance = async () => {
  if (typeof window !== "undefined") {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
  }
  return null;
};

export { enableNetwork, disableNetwork };
export default app;
