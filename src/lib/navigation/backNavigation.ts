/**
 * Mobile Back Navigation Manager
 * Handles physical back buttons (Android) and edge-swipe gestures (Android & Apple iOS)
 * ensuring modals close first, and screens navigate back to HOME before exiting.
 */

type DismissHandler = () => boolean | void;

const modalDismissStack: DismissHandler[] = [];
let isInitialized = false;
let lastBackPressTime = 0;

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
 * Initialize listeners for both Web (popstate) and Native Capacitor (App.addListener)
 */
export function initMobileBackNavigation(config: {
  getCurrentScreen: () => string;
  onNavigateHome: () => void;
  showToast?: (message: string) => void;
}): () => void {
  if (typeof window === "undefined" || isInitialized) {
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
  const onPopState = (event: PopStateEvent) => {
    const handled = handleBackAction(
      config.getCurrentScreen(),
      config.onNavigateHome,
      config.showToast
    );

    if (handled) {
      // Re-anchor history state so user stays in app
      try {
        window.history.pushState({ screen: config.getCurrentScreen() }, "");
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
      App.addListener("backButton", ({ canGoBack }) => {
        const handled = handleBackAction(
          config.getCurrentScreen(),
          config.onNavigateHome,
          config.showToast
        );

        if (!handled) {
          // Double press on HOME confirmed: exit native app
          App.exitApp();
        }
      }).then((listener) => {
        capacitorRemoveListener = () => listener.remove();
      });
    })
    .catch(() => {
      // Capacitor not running or running in pure web mode
    });

  return () => {
    window.removeEventListener("popstate", onPopState);
    if (capacitorRemoveListener) {
      capacitorRemoveListener();
    }
    isInitialized = false;
  };
}
