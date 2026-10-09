import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableNetwork, disableNetwork } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

// Configurations for different environments (dynamically mapped at runtime)
const firebaseConfigs = {
  test: {
    apiKey: "AIzaSyDFhnSTI6WbxHB8duYukpEBk9wKjxpduTE",
    authDomain: "archery101010-c0bb4.firebaseapp.com",
    projectId: "archery101010-c0bb4",
    storageBucket: "archery101010-c0bb4.firebasestorage.app",
    messagingSenderId: "757910399585",
    appId: "1:757910399585:web:3cbcf50a21971cdc5b5820"
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
  
  if (isLocalhost) {
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
  } else if (host.includes("archery101010-tst") || host.includes("101010-tst") || host.includes("tst")) {
    activeConfig = firebaseConfigs.test;
  } else {
    activeConfig = firebaseConfigs.prod;
  }
} else {
  // Server-side (SSR) fallback
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

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(activeConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);

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
