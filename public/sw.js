const CACHE_NAME = "archery-101010-cache-v2.136";

// Install event - pre-warm offline root shell bypassing HTTP disk cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled([
        fetch("/", { cache: "reload", credentials: "same-origin" }).then((res) => {
          if (res && res.ok) return cache.put("/", res);
        }),
        fetch("/favicon.ico", { cache: "reload", credentials: "same-origin" }).then((res) => {
          if (res && res.ok) return cache.put("/favicon.ico", res);
        }),
      ]);
    })
  );
  // Activate immediately without waiting for open tabs/WebViews to close
  self.skipWaiting();
});

// Activate event - purge every older cache version immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              return caches.delete(cache);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch event - strict same-origin GET only (never intercept Firestore, Google Auth, Spotify, or chrome-extension://)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Only handle same-origin HTTP/HTTPS requests
  if (url.origin !== self.location.origin) return;

  // Never cache or intercept live version manifests, SW scripts, or Firebase Auth redirect handlers
  if (
    url.pathname === "/ota-version.json" ||
    url.pathname === "/version.json" ||
    url.pathname === "/app-version.json" ||
    url.pathname === "/sw.js" ||
    url.pathname === "/firebase-messaging-sw.js" ||
    url.pathname.startsWith("/__/auth/")
  ) {
    return;
  }

  const acceptHeader = event.request.headers.get("accept") || "";
  const isNavigation =
    event.request.mode === "navigate" || acceptHeader.includes("text/html");
  const isJsOrCssChunk =
    url.pathname.startsWith("/_next/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css");

  // IMPORTANT: Pass URL string (event.request.url) when setting RequestInit ({ cache: "no-store" }).
  // Passing a Request object with mode === "navigate" + non-empty RequestInit throws a TypeError in Chromium!
  const networkFetch = isNavigation
    ? fetch(event.request.url, { cache: "no-store", credentials: "same-origin" })
    : fetch(event.request);

  event.respondWith(
    networkFetch
      .then((response) => {
        if (response && response.ok && response.status === 200 && response.type === "basic") {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            if (isNavigation && url.pathname === "/") {
              cache.put("/", responseClone.clone()).catch(() => {});
            }
            cache.put(event.request, responseClone).catch(() => {});
          });
        }
        return response;
      })
      .catch(async () => {
        // Retry once bypassing stale connection state for JS/CSS chunks when online
        if (isJsOrCssChunk) {
          try {
            const retryRes = await fetch(event.request.url, {
              cache: "no-cache",
              credentials: "same-origin",
            });
            if (retryRes && retryRes.ok) {
              const retryClone = retryRes.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, retryClone).catch(() => {});
              });
              return retryRes;
            }
          } catch {
            // Fall through to cache match
          }
        }

        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        if (isNavigation) {
          const cachedRoot = await caches.match("/");
          if (cachedRoot) {
            return cachedRoot;
          }
          return new Response(
            "<!DOCTYPE html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ARCHERY 101010</title></head><body style=\"background:#020305;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px\"><div><h2 style=\"margin:0 0 8px\">Modo sin conexión</h2><p style=\"opacity:0.75;font-size:14px\">Conéctate a internet una vez para sincronizar los recursos locales.</p></div></body></html>",
            {
              status: 503,
              statusText: "Offline",
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          );
        }

        return Response.error();
      })
  );
});

// Listen for control commands from the main thread
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
