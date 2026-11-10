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

/** Monthly Coach PRO period (30 days) and Annual Coach PRO period (365 days). */
export const COACH_PRO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
export const COACH_PRO_ANNUAL_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;

/** True while the user has a non-expired PRO access (superadmins are always PRO). */
export function isProActive(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return user.plan === "PRO" && typeof user.proExpiresAt === "number" && user.proExpiresAt > Date.now();
}

/** Days left of the current PRO access (0 when inactive). */
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
 * Otorga 365 días para coach_pro_annual y 30 días para coach_pro_monthly.
 */
export async function activateCoachLaunchPromo(
  user: UserProfile,
  productSku: string = "coach_pro_monthly"
): Promise<{ success: boolean; updatedUser: UserProfile }> {
  try {
    const normalizedSku = String(productSku || "").toLowerCase();
    const isAnnual =
      productSku === "coach_pro_annual" ||
      productSku === "archery101010_coach_pro_annual" ||
      normalizedSku.includes("annual");
    const periodMs = isAnnual ? COACH_PRO_ANNUAL_PERIOD_MS : COACH_PRO_PERIOD_MS;
    const now = Date.now();
    const expiresAt = now + periodMs;

    const linkedToExternal = isLinkedToExternalCoach(user);
    const existingCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
    const validCode = /^\d{6}$/.test(existingCode) ? existingCode : generateClubInviteCode();
    const canonicalCoachClubId = "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
    const resolvedClubId =
      user.isClubCreator && user.clubId ? user.clubId : canonicalCoachClubId;

    const profileUpdates: Partial<UserProfile> = linkedToExternal
      ? {
          plan: "PRO",
          proExpiresAt: expiresAt
        }
      : {
          plan: "PRO",
          proExpiresAt: expiresAt,
          role: user.role === "archer" ? "coach" : user.role,
          clubId: resolvedClubId,
          clubInviteCode: validCode,
          isClubCreator: true
        };

    const updatedUser = await updateProfile(user.uid, profileUpdates);

    const newLog = {
      id: generateResilientId("SUB"),
      userId: user.uid,
      userName: user.fullName || user.email,
      previousPlan: user.plan || "FREE",
      newPlan: "PRO" as const,
      sku: isAnnual ? "coach_pro_annual" : "coach_pro_monthly",
      expiresAt,
      createdAt: now,
      timestamp: new Date(now).toISOString().split("T")[0],
      reason: `Activación Bonificada de Lanzamiento (${isAnnual ? "Anual 365d" : "Mensual 30d"})`
    };

    // Confirm the coach code and audit log reach the cloud
    try {
      const { doc, setDoc } = await import("firebase/firestore");
      const { db, auth } = await import("@/lib/firebase");
      if (auth.currentUser && user.uid !== "USR-GUEST-OFFLINE") {
        await setDoc(doc(db, "users", user.uid), updatedUser, { merge: true });
        await setDoc(doc(db, "subscription_audit_logs", newLog.id), newLog, { merge: true }).catch(
          () => {}
        );
      }
    } catch (cloudErr) {
      console.warn("Coach activation saved locally; cloud sync pending:", cloudErr);
    }

    // Register real subscription audit log in IndexedDB
    const auditLogs = await getLocalSetting<any[]>("sub_audit_logs", []);
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
 * Restaura compras previas de Google Play Store / Apple App Store.
 * Consulta subscription_audit_logs en Firestore para userId == user.uid con expiresAt > Date.now()
 * antes de restaurar PRO — nunca otorga un periodo PRO gratuito nuevo si el usuario no tenía uno vigente.
 */
export async function restoreCoachStorePurchases(
  user: UserProfile
): Promise<{ success: boolean; message: string; updatedUser?: UserProfile }> {
  if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") {
    return {
      success: false,
      message: "Inicia sesión con tu cuenta para restaurar suscripciones."
    };
  }

  const now = Date.now();
  let validExpiresAt = 0;

  // 1. Query subscription_audit_logs in Firestore for userId == user.uid where expiresAt > Date.now()
  try {
    const { collection, query, where, getDocs, doc, getDoc } = await import("firebase/firestore");
    const { db, auth } = await import("@/lib/firebase");

    if (auth.currentUser) {
      try {
        const q = query(
          collection(db, "subscription_audit_logs"),
          where("userId", "==", user.uid)
        );
        const snap = await getDocs(q);
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const exp = Number(data?.expiresAt) || 0;
          if ((data?.newPlan === "PRO" || !data?.newPlan) && exp > now && exp > validExpiresAt) {
            validExpiresAt = exp;
          }
        });
      } catch {
        // Fallback if audit log read is restricted: check remote users/{uid}.proExpiresAt without granting new PRO
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          const uData = userSnap.data();
          const remoteExp = Number(uData?.proExpiresAt) || 0;
          if (uData?.plan === "PRO" && remoteExp > now) {
            validExpiresAt = remoteExp;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not query cloud subscription_audit_logs:", err);
  }

  // 2. Offline fallback against local IndexedDB sub_audit_logs (only unexpired entries for this user)
  if (validExpiresAt <= now) {
    const localLogs = await getLocalSetting<any[]>("sub_audit_logs", []);
    for (const entry of localLogs) {
      const exp = Number(entry?.expiresAt) || 0;
      if (
        entry?.userId === user.uid &&
        entry?.newPlan === "PRO" &&
        exp > now &&
        exp > validExpiresAt
      ) {
        validExpiresAt = exp;
      }
    }
  }

  if (validExpiresAt <= now) {
    return {
      success: false,
      message: "No se encontraron suscripciones Coach PRO activas para restaurar."
    };
  }

  const linkedToExternal = isLinkedToExternalCoach(user);
  const existingCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
  const validCode = /^\d{6}$/.test(existingCode) ? existingCode : generateClubInviteCode();
  const canonicalCoachClubId = "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
  const resolvedClubId =
    user.isClubCreator && user.clubId ? user.clubId : canonicalCoachClubId;

  const profileUpdates: Partial<UserProfile> = linkedToExternal
    ? {
        plan: "PRO",
        proExpiresAt: validExpiresAt
      }
    : {
        plan: "PRO",
        proExpiresAt: validExpiresAt,
        role: user.role === "archer" ? "coach" : user.role,
        clubId: resolvedClubId,
        clubInviteCode: validCode,
        isClubCreator: true
      };

  const updatedUser = await updateProfile(user.uid, profileUpdates);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("current-user-updated", { detail: { user: updatedUser } })
    );
  }

  return {
    success: true,
    message: "¡Acceso Coach PRO restaurado y validado con éxito!",
    updatedUser
  };
}
