import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, AppCheck } from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore, enableNetwork, disableNetwork, Firestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const testProjectId = (process.env.NEXT_PUBLIC_FIREBASE_TEST_PROJECT_ID || "").trim();
const testApiKey = (process.env.NEXT_PUBLIC_FIREBASE_TEST_API_KEY || "").trim();
const hasDistinctTestConfig = Boolean(testProjectId && testApiKey);

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

// Select configuration based on environment and current URL
let activeConfig = firebaseConfigs.prod; // Default to production

if (typeof window !== "undefined") {
  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  const isTestEnv =
    process.env.NEXT_PUBLIC_FIREBASE_ENV === "test" ||
    host.includes("archery101010-tst") ||
    host.includes("101010-tst") ||
    host.includes("tst");

  if (isLocalhost) {
    if (process.env.NEXT_PUBLIC_FIREBASE_ENV === "test" && hasDistinctTestConfig) {
      activeConfig = firebaseConfigs.test;
      console.warn(
        `[Firebase] TEST mode active on localhost using test project "${firebaseConfigs.test.projectId}".`
      );
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
      } else {
        activeConfig = firebaseConfigs.mock;
      }
    }
  } else if (isTestEnv) {
    activeConfig = firebaseConfigs.test;
    if (hasDistinctTestConfig) {
      console.warn(
        `[Firebase] Running in TEST mode against isolated project "${firebaseConfigs.test.projectId}".`
      );
    } else {
      console.warn(
        "[Firebase] TEST host detected without NEXT_PUBLIC_FIREBASE_TEST_PROJECT_ID / NEXT_PUBLIC_FIREBASE_TEST_API_KEY — falling back safely to default Firebase config."
      );
    }
  } else {
    // Canonical Firebase Auth domain registered with Google OAuth redirect URIs
    activeConfig = firebaseConfigs.prod;
  }
} else {
  // Server-side (SSR / Static Build) fallback
  if (process.env.NEXT_PUBLIC_FIREBASE_ENV === "test" && hasDistinctTestConfig) {
    activeConfig = firebaseConfigs.test;
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
const app = getApps().length === 0 ? initializeApp(activeConfig) : getApp();

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
function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      experimentalAutoDetectLongPolling: true,
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
