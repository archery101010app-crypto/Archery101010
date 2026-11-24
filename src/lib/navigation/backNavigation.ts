/**
 * Mobile Back Navigation Manager
 * Handles physical back buttons (Android) and edge-swipe gestures (Android & Apple iOS)
 * ensuring modals close first, and screens navigate back to HOME before exiting.
 */

type DismissHandler = () => boolean | void;

interface BackNavigationConfig {
  getCurrentScreen: () => string;
  onNavigateHome: () => void;
  showToast?: (message: string) => void;
}

declare global {
  interface Window {
    __onNativeAndroidBack?: () => "HANDLED" | "EXIT";
    ArcheryNativeAuth?: {
      exitApp?: () => void;
      [key: string]: unknown;
    };
  }
}

const modalDismissStack: DismissHandler[] = [];
let isInitialized = false;
let lastBackPressTime = 0;
let activeBackConfig: BackNavigationConfig | null = null;

/**
 * Register a dismiss callback for an open modal, popup, or drawer.
 * Returns an unregister function to call on natural unmount.
 */
export function registerModalDismiss(handler: DismissHandler): () => void {
  modalDismissStack.push(handler);
  
  // Push a state so web/iOS swipe gestures trigger popstate instead of leaving
  if (typeof window !== "undefined") {
    try {
      window.history.pushState({ type: "modal", depth: modalDismissStack.length }, "");
    } catch {
      // Ignore security errors in strict iframe environments
    }
  }

  return () => {
    const idx = modalDismissStack.indexOf(handler);
    if (idx !== -1) {
      modalDismissStack.splice(idx, 1);
    }
  };
}

/**
 * Trigger back action programmatically or from native events
 */
export function handleBackAction(
  currentScreen: string,
  onNavigateHome: () => void,
  showExitToast?: (message: string) => void
): boolean {
  // 1. If any modal/overlay is open, close the topmost one
  if (modalDismissStack.length > 0) {
    const topHandler = modalDismissStack.pop();
    if (topHandler) {
      topHandler();
      return true;
    }
  }

  // 2. If inside a sub-screen, navigate back to HOME
  if (currentScreen !== "HOME") {
    onNavigateHome();
    return true;
  }

  // 3. Already on HOME: handle double-press to exit on native Android
  const now = Date.now();
  if (now - lastBackPressTime < 2000) {
    return false; // Allow exit
  }

  lastBackPressTime = now;
  if (showExitToast) {
    showExitToast("Presiona atrás nuevamente para salir");
  }

  return true; // Consumed
}

/**
 * Initialize listeners for Web (`popstate`), Native Android WebView (`window.__onNativeAndroidBack`),
 * and Native Capacitor (`App.addListener`).
 */
export function initMobileBackNavigation(config: BackNavigationConfig): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  activeBackConfig = config;

  // Always expose `window.__onNativeAndroidBack` for Android `MainActivity.onBackPressedCallback`
  window.__onNativeAndroidBack = (): "HANDLED" | "EXIT" => {
    const cfg = activeBackConfig;
    if (!cfg) return "EXIT";
    const handled = handleBackAction(
      cfg.getCurrentScreen(),
      cfg.onNavigateHome,
      cfg.showToast
    );
    return handled ? "HANDLED" : "EXIT";
  };

  if (isInitialized) {
    return () => {};
  }

  isInitialized = true;

  // Initialize initial history baseline if needed
  try {
    if (!window.history.state) {
      window.history.replaceState({ screen: "HOME" }, "");
    }
  } catch {
    // ignore
  }

  // 1. Web & iOS Safari Edge Swipe Listener
  const onPopState = (_event: PopStateEvent) => {
    const cfg = activeBackConfig || config;
    const handled = handleBackAction(
      cfg.getCurrentScreen(),
      cfg.onNavigateHome,
      cfg.showToast
    );

    if (handled) {
      // Re-anchor history state so user stays in app
      try {
        window.history.pushState({ screen: cfg.getCurrentScreen() }, "");
      } catch {
        // ignore
      }
    }
  };

  window.addEventListener("popstate", onPopState);

  // 2. Native Capacitor (Android Back Button & Native Gesture)
  let capacitorRemoveListener: (() => void) | null = null;
  import("@capacitor/app")
    .then(({ App }) => {
      try {
        const listenerPromise = App.addListener("backButton", () => {
          const cfg = activeBackConfig || config;
          const handled = handleBackAction(
            cfg.getCurrentScreen(),
            cfg.onNavigateHome,
            cfg.showToast
          );

          if (!handled) {
            // Double press on HOME confirmed: exit native app via native bridge or Capacitor App.exitApp
            try {
              if (typeof window.ArcheryNativeAuth?.exitApp === "function") {
                window.ArcheryNativeAuth.exitApp();
                return;
              }
            } catch {
              // Fall through to Capacitor App.exitApp
            }
            try {
              const exitPromise = App.exitApp();
              if (exitPromise && typeof (exitPromise as Promise<void>).catch === "function") {
                (exitPromise as Promise<void>).catch(() => {
                  window.ArcheryNativeAuth?.exitApp?.();
                });
              }
            } catch {
              try {
                window.ArcheryNativeAuth?.exitApp?.();
              } catch {}
            }
          }
        });

        if (listenerPromise && typeof listenerPromise.then === "function") {
          listenerPromise
            .then((listener) => {
              capacitorRemoveListener = () => {
                try {
                  const rm = listener.remove();
                  if (rm && typeof rm.catch === "function") {
                    rm.catch(() => {});
                  }
                } catch {
                  // ignore
                }
              };
            })
            .catch(() => {
              // Running on remote OTA origin or pure web without Capacitor JS bridge
            });
        }
      } catch {
        // Ignore synchronous Capacitor plugin errors
      }
    })
    .catch(() => {
      // Capacitor not running or running in pure web mode
    });

  return () => {
    window.removeEventListener("popstate", onPopState);
    if (capacitorRemoveListener) {
      capacitorRemoveListener();
    }
    delete window.__onNativeAndroidBack;
    activeBackConfig = null;
    isInitialized = false;
  };
}
