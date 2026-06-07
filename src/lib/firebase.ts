import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableNetwork, disableNetwork } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

// Configurations for different environments (dynamically mapped at runtime)
const firebaseConfigs = {
  test: {
    apiKey: "AIzaSyDXsjd5FRo-WpE4-32hJnyZSvqlW-88I0E",
    authDomain: "archery101010-tst.firebaseapp.com",
    projectId: "archery101010-tst",
    storageBucket: "archery101010-tst.firebasestorage.app",
    messagingSenderId: "205974427894",
    appId: "1:205974427894:web:16aee6e14fb8ad49f534d7"
  },
  prod: {
    apiKey: "AIzaSyBYrK69NQRfuSR73HF_lJP22g1bw0LDPTo",
    authDomain: "archery101010-prd.firebaseapp.com",
    projectId: "archery101010-prd",
    storageBucket: "archery101010-prd.firebasestorage.app",
    messagingSenderId: "201321373574",
    appId: "1:201321373574:web:f9c4aba8b9e86e5835d607"
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
let activeConfig = firebaseConfigs.mock;

if (typeof window !== "undefined") {
  const host = window.location.hostname;
  if (host.includes("archery101010-tst") || host.includes("101010-tst")) {
    activeConfig = firebaseConfigs.test;
  } else if (
    host.includes("archery101010-prd") || 
    host.includes("101010-prd") || 
    host === "archery101010.web.app" || 
    host === "archery101010.firebaseapp.com"
  ) {
    activeConfig = firebaseConfigs.prod;
  } else {
    // If running locally but environment variables are set, use them
    const envKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (envKey && !envKey.includes("mock-api-key")) {
      activeConfig = {
        apiKey: envKey,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "archery101010.firebaseapp.com",
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "archery101010",
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "archery101010.appspot.com",
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456"
      };
    }
  }
} else {
  // Server-side (SSR) fallback
  const envKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (envKey && !envKey.includes("mock-api-key")) {
    activeConfig = {
      apiKey: envKey,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "archery101010.firebaseapp.com",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "archery101010",
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "archery101010.appspot.com",
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456"
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
