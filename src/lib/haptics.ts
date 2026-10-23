import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticFeedbackType = "arrow" | "gold" | "miss" | "undo" | "confirm" | "tick";

/**
 * Triggers zero-latency haptic feedback.
 * Uses native Capacitor Haptics on Android/iOS with fallback to Web Vibration API.
 */
export async function triggerHaptic(type: HapticFeedbackType = "arrow"): Promise<void> {
  // 1. Try native Capacitor Haptics first
  try {
    switch (type) {
      case "gold":
        await Haptics.notification({ type: NotificationType.Success });
        return;
      case "miss":
        await Haptics.notification({ type: NotificationType.Warning });
        return;
      case "confirm":
        await Haptics.impact({ style: ImpactStyle.Heavy });
        return;
      case "undo":
        await Haptics.impact({ style: ImpactStyle.Medium });
        return;
      case "arrow":
        await Haptics.impact({ style: ImpactStyle.Light });
        return;
      case "tick":
      default:
        await Haptics.selectionChanged();
        return;
    }
  } catch {
    // Native Capacitor failed or running in standard browser/PWA; proceed to Web Vibration fallback
  }

  // 2. Web Vibration API fallback
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      switch (type) {
        case "gold":
          navigator.vibrate([25, 40, 35]); // Celebratory double pulse
          break;
        case "miss":
          navigator.vibrate([45, 30, 45]); // Buzz for miss
          break;
        case "confirm":
          navigator.vibrate([35, 45, 35]);
          break;
        case "undo":
          navigator.vibrate(30);
          break;
        case "arrow":
          navigator.vibrate(20); // Crisp click
          break;
        case "tick":
        default:
          navigator.vibrate(10);
          break;
      }
    } catch {
      // Ignore vibration errors on unsupported hardware
    }
  }
}
