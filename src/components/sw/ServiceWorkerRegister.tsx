"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Prevent multiple reload loops
      let refreshing = false;

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("Service Worker registered successfully with scope:", registration.scope);

          // Check for updates in progress
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  // A new Service Worker is installed and waiting. Notify the user or auto skip waiting.
                  console.log("New service worker update available. Skipping waiting...");
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                }
              });
            }
          });

          // Check if there is already a waiting worker on page load
          if (registration.waiting) {
            console.log("Waiting service worker found. Skipping waiting...");
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    }
  }, []);

  return null; // This component has no visual UI
}
