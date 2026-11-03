"use client";

import { getLocalSetting, saveLocalSetting, generateResilientId } from "@/lib/db/indexedDB";
import { UserProfile, updateProfile, generateClubInviteCode, isLinkedToExternalCoach } from "@/lib/authService";

export interface StoreProduct {
  id: string;
  sku: string;
  title: string;
  description: string;
  regularPrice: string;
  promoPrice: string;
  period: "monthly" | "annual";
  savingsBadge?: string;
  features: string[];
}

export const COACH_STORE_PRODUCTS: StoreProduct[] = [
  {
    id: "coach_pro_monthly",
    sku: "archery101010_coach_pro_monthly",
    title: "COACH PRO Mensual",
    description: "Acceso total para entrenadores y directores de tiro (facturación mensual).",
    regularPrice: "$9.99 USD",
    promoPrice: "$0.00 USD",
    period: "monthly",
    features: [
      "Director de Tiro y monitoreo de dianas en tiempo real",
      "Planificador de Agenda Mensual y Microciclos",
      "Asignación de planes a 1 alumno, varios o todo el equipo",
      "Sincronización instantánea con la agenda de los arqueros",
      "Estadísticas de agrupación y volumen World Archery"
    ]
  },
  {
    id: "coach_pro_annual",
    sku: "archery101010_coach_pro_annual",
    title: "COACH PRO Anual (-25%)",
    description: "Temporada completa de alto rendimiento con 25% de rebajo ($7.49/mes).",
    regularPrice: "$89.91 USD",
    promoPrice: "$0.00 USD",
    period: "annual",
    savingsBadge: "-25%",
    features: [
      "Todo lo incluido en el plan mensual con 25% de descuento",
      "Prioridad de soporte técnico y pedagógico",
      "Gestión multi-club y arqueros ilimitados",
      "Respaldo en la nube y auditoría de sesiones",
      "Actualizaciones prioritarias de nuevas herramientas"
    ]
  }
];

// Launch phase status
export const IS_LAUNCH_PROMO_FREE = true;

/** Free Coach PRO access lasts 30 days; the coach re-activates it (still $0) once a month. */
export const COACH_PRO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** True while the user has a non-expired PRO access (superadmins are always PRO). */
export function isProActive(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return user.plan === "PRO" && typeof user.proExpiresAt === "number" && user.proExpiresAt > Date.now();
}

/** Days left of the current monthly PRO access (0 when inactive). */
export function proDaysLeft(user: UserProfile | null | undefined): number {
  if (!user || !isProActive(user) || typeof user.proExpiresAt !== "number") return 0;
  return Math.max(0, Math.ceil((user.proExpiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

/**
 * Downgrades expired or legacy (no expiry date) PRO accounts to FREE.
 * Keeps role, club and invite code intact so athletes stay linked; only the PRO flag lapses.
 */
export async function enforceProExpiry(user: UserProfile): Promise<UserProfile> {
  if (user.role === "superadmin" || user.plan !== "PRO" || isProActive(user)) return user;
  try {
    return await updateProfile(user.uid, { plan: "FREE" });
  } catch (err) {
    console.warn("Could not downgrade expired PRO plan:", err);
    return { ...user, plan: "FREE" };
  }
}

/**
 * Retorna los productos configurados para las tiendas Google Play Store y Apple App Store
 */
export function getCoachStoreProducts(): StoreProduct[] {
  return COACH_STORE_PRODUCTS;
}

/**
 * Activa la suscripción Coach PRO bonificada 100% por lanzamiento
 */
export async function activateCoachLaunchPromo(
  user: UserProfile,
  productSku: string = "archery101010_coach_pro_monthly"
): Promise<{ success: boolean; updatedUser: UserProfile }> {
  try {
    const linkedToExternal = isLinkedToExternalCoach(user);
    const existingCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
    const validCode = /^\d{6}$/.test(existingCode) ? existingCode : generateClubInviteCode();
    const canonicalCoachClubId = "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
    const resolvedClubId =
      user.isClubCreator && user.clubId ? user.clubId : canonicalCoachClubId;

    const profileUpdates: Partial<UserProfile> = linkedToExternal
      ? {
          plan: "PRO",
          proExpiresAt: Date.now() + COACH_PRO_PERIOD_MS
        }
      : {
          plan: "PRO",
          proExpiresAt: Date.now() + COACH_PRO_PERIOD_MS,
          role: user.role === "archer" ? "coach" : user.role,
          clubId: resolvedClubId,
          clubInviteCode: validCode,
          isClubCreator: true
        };

    const updatedUser = await updateProfile(user.uid, profileUpdates);

    // Confirm the coach code reaches the cloud so athletes can find it immediately
    try {
      const { doc, setDoc } = await import("firebase/firestore");
      const { db } = await import("@/lib/firebase");
      await setDoc(doc(db, "users", user.uid), updatedUser, { merge: true });
    } catch (cloudErr) {
      console.warn("Coach activation saved locally; cloud sync pending:", cloudErr);
    }

    // Register real subscription audit log in IndexedDB
    const auditLogs = await getLocalSetting<any[]>("sub_audit_logs", []);
    const newLog = {
      id: generateResilientId("SUB"),
      userName: user.fullName || user.email,
      previousPlan: user.plan || "FREE",
      newPlan: "PRO",
      sku: productSku,
      timestamp: new Date().toISOString().split("T")[0],
      reason: "Activación Bonificada de Lanzamiento (Google Play / App Store Ready)"
    };
    await saveLocalSetting("sub_audit_logs", [newLog, ...auditLogs]);

    // Notify components
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("current-user-updated", { detail: { user: updatedUser } })
      );
    }

    return { success: true, updatedUser };
  } catch (err) {
    console.error("Error activating coach launch promo:", err);
    throw err;
  }
}

/**
 * Restaura compras previas de Google Play Store / Apple App Store
 */
export async function restoreCoachStorePurchases(
  user: UserProfile
): Promise<{ success: boolean; message: string; updatedUser?: UserProfile }> {
  // If in native mobile environment with In-App Purchase plugin:
  const isCapacitorNative =
    typeof window !== "undefined" &&
    !!(window as any).Capacitor?.isNativePlatform?.();

  if (isCapacitorNative) {
    // When Google Play / StoreKit billing plugin is active in future builds:
    // Capacitor.Plugins.Purchase.restorePurchases()
  }

  // During promotional launch phase:
  const res = await activateCoachLaunchPromo(user);
  return {
    success: true,
    message: "¡Acceso Coach PRO de lanzamiento restaurado y validado con éxito!",
    updatedUser: res.updatedUser
  };
}
