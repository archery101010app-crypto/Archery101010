"use client";

import type { UserProfile } from "@/lib/authService";

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
const DAY_MS = 24 * 60 * 60 * 1000;

function isSpanishBillingPreferred(): boolean {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("preferred_language");
      if (saved && saved.trim()) {
        return saved.trim().toLowerCase().startsWith("es");
      }
      if (typeof document !== "undefined" && document.documentElement?.lang) {
        return document.documentElement.lang.trim().toLowerCase().startsWith("es");
      }
    } catch {}
  }
  return true;
}

function txBilling(esText: string, enText: string): string {
  return isSpanishBillingPreferred() ? esText : enText;
}

/**
 * Pure testable helper to compute remaining days of Coach PRO access.
 * Returns 0 when `proExpiresAt` is undefined, invalid, or <= `nowMs`.
 */
export function computeProRemainingDays(
  proExpiresAt?: number,
  nowMs: number = Date.now()
): number {
  if (typeof proExpiresAt !== "number" || !Number.isFinite(proExpiresAt)) return 0;
  if (!Number.isFinite(nowMs) || proExpiresAt <= nowMs) return 0;
  return Math.max(0, Math.ceil((proExpiresAt - nowMs) / DAY_MS));
}

/** Pure check for active Coach PRO access (superadmins are always PRO). */
export function isCoachProActive(
  user: Pick<UserProfile, "role" | "plan" | "proExpiresAt"> | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!user) return false;
  if (user.role === "superadmin") return true;
  return user.plan === "PRO" && typeof user.proExpiresAt === "number" && user.proExpiresAt > nowMs;
}

/** True while the user has a non-expired PRO access (superadmins are always PRO). */
export function isProActive(user: UserProfile | null | undefined): boolean {
  return isCoachProActive(user);
}

/** Days left of the current PRO access (0 when inactive). */
export function proDaysLeft(user: UserProfile | null | undefined): number {
  if (!user) return 0;
  if (user.role === "superadmin" && typeof user.proExpiresAt !== "number") return 365;
  if (!isCoachProActive(user)) return 0;
  return computeProRemainingDays(user.proExpiresAt);
}

/**
 * Downgrades expired or legacy (no expiry date) PRO accounts to FREE.
 * Keeps role, club and invite code intact so athletes stay linked; only the PRO flag lapses.
 */
export async function enforceProExpiry(user: UserProfile): Promise<UserProfile> {
  if (user.role === "superadmin" || user.plan !== "PRO" || isProActive(user)) return user;
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine &&
      user.uid &&
      user.uid !== "USR-GUEST-OFFLINE"
    ) {
      const [{ doc, getDoc }, { auth, db }, { saveLocalSetting }] = await Promise.all([
        import("firebase/firestore"),
        import("@/lib/firebase"),
        import("@/lib/db/indexedDB")
      ]);
      if (auth.currentUser?.uid === user.uid) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const cloudData = snap.data() as Partial<UserProfile>;
          if (
            cloudData.plan === "PRO" &&
            typeof cloudData.proExpiresAt === "number" &&
            cloudData.proExpiresAt > Date.now()
          ) {
            const refreshed: UserProfile = {
              ...user,
              plan: "PRO",
              proExpiresAt: cloudData.proExpiresAt
            };
            await saveLocalSetting("current_user", refreshed);
            return refreshed;
          }
        }
      }
    }
    const { updateProfile } = await import("@/lib/authService");
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

export interface StoreReceiptVerificationPayload {
  platform?: "google_play" | "app_store" | "android" | "ios";
  purchaseToken?: string;
  receiptData?: string;
}

async function persistServerVerifiedCoachUser(
  baseUser: UserProfile,
  updatedFields: Record<string, unknown>,
  auditLogEntry?: Record<string, unknown> | null
): Promise<UserProfile> {
  const { getLocalSetting, saveLocalSetting } = await import("@/lib/db/indexedDB");
  const { markLocalUserWrite } = await import("@/lib/authService");

  const mergedUser: UserProfile = {
    ...baseUser,
    ...(updatedFields as Partial<UserProfile>),
    uid: baseUser.uid,
    profileSetupCompleted: true
  };

  markLocalUserWrite(baseUser.uid, Number(mergedUser.updatedAt || Date.now()));
  await saveLocalSetting("current_user", mergedUser);

  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const idx = usersList.findIndex((u) => u.uid === baseUser.uid);
  if (idx !== -1) {
    usersList[idx] = mergedUser;
  } else {
    usersList.push(mergedUser);
  }
  await saveLocalSetting("simulated_users", usersList);

  if (auditLogEntry && typeof auditLogEntry.id === "string") {
    const auditLogs = await getLocalSetting<Record<string, unknown>[]>("sub_audit_logs", []);
    const deduped = auditLogs.filter((entry) => entry?.id !== auditLogEntry.id);
    await saveLocalSetting("sub_audit_logs", [auditLogEntry, ...deduped]);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("current-user-updated", { detail: { user: mergedUser } })
    );
  }

  return mergedUser;
}

function isFunctionsUnavailableError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || "").toLowerCase();
  const msg = String((err as { message?: string })?.message || "").toLowerCase();
  return (
    code.includes("not-found") ||
    code.includes("unavailable") ||
    code.includes("unimplemented") ||
    (code.includes("internal") && (msg.includes("cors") || msg.includes("failed to fetch") || msg === "internal"))
  );
}

/**
 * Activa la suscripción Coach PRO bonificada 100% por lanzamiento o verificada con recibo de tienda.
 * Otorga 365 días para coach_pro_annual y 30 días para coach_pro_monthly a través de Cloud Functions (`verifyStoreSubscription`).
 */
export async function activateCoachLaunchPromo(
  user: UserProfile,
  productSku: string = "coach_pro_monthly",
  receiptPayload?: StoreReceiptVerificationPayload
): Promise<{ success: boolean; updatedUser: UserProfile }> {
  try {
    const [
      { getLocalSetting, saveLocalSetting, generateResilientId, addToSyncQueue },
      { updateProfile, generateUniqueClubInviteCode, isLinkedToExternalCoach, calculateAgeFromBirthDate },
      { getLocalISODate }
    ] = await Promise.all([
      import("@/lib/db/indexedDB"),
      import("@/lib/authService"),
      import("@/lib/i18n/regionalUtils")
    ]);

    if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") {
      throw new Error(
        txBilling(
          "Inicia sesión con tu cuenta para activar Coach PRO.",
          "Sign in to your account to activate Coach PRO."
        )
      );
    }

    if (user.role !== "superadmin") {
      const age = user.birthDate && user.birthDate.trim() ? calculateAgeFromBirthDate(user.birthDate) : null;
      if (age === null || age < 18) {
        throw new Error(
          txBilling(
            "Debes ser mayor de 18 años y tener tu fecha de nacimiento configurada para activar una cuenta de Entrenador.",
            "You must be at least 18 years old with a valid birth date configured to activate a Coach account."
          )
        );
      }
    }

    const normalizedSku = String(productSku || "").toLowerCase();
    const isAnnual =
      productSku === "coach_pro_annual" ||
      productSku === "archery101010_coach_pro_annual" ||
      normalizedSku.includes("annual");
    const canonicalSku = isAnnual ? "coach_pro_annual" : "coach_pro_monthly";

    // Non-superadmin clients MUST verify/activate via Cloud Function (`verifyStoreSubscription`)
    // and NEVER enqueue `subscription_audit_logs` or `plan: "PRO"` / `role: "coach"` writes into `cola_sincronizacion`.
    if (user.role !== "superadmin") {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(
          txBilling(
            "Se requiere conexión a internet para activar y verificar tu suscripción Coach PRO.",
            "An internet connection is required to activate and verify your Coach PRO subscription."
          )
        );
      }

      const [{ getFunctions, httpsCallable }, { app, auth, db }, { doc, getDoc }] = await Promise.all([
        import("firebase/functions"),
        import("@/lib/firebase"),
        import("firebase/firestore")
      ]);

      if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
        throw new Error(
          txBilling(
            "Tu sesión requiere reautenticación antes de activar Coach PRO.",
            "Your session requires re-authentication before activating Coach PRO."
          )
        );
      }

      try {
        const verifyFn = httpsCallable<
          Record<string, unknown>,
          {
            ok?: boolean;
            updatedFields?: Record<string, unknown>;
            auditLog?: Record<string, unknown>;
          }
        >(getFunctions(app), "verifyStoreSubscription", { timeout: 20000 });

        const callableRes = await verifyFn({
          sku: canonicalSku,
          ...(receiptPayload || {})
        });

        const data = callableRes.data;
        if (!data?.ok || !data.updatedFields) {
          throw new Error(
            txBilling(
              "No se pudo verificar la suscripción en el servidor.",
              "Could not verify subscription on the server."
            )
          );
        }

        const updatedUser = await persistServerVerifiedCoachUser(
          user,
          data.updatedFields,
          data.auditLog || null
        );
        return { success: true, updatedUser };
      } catch (fnErr: unknown) {
        if (isFunctionsUnavailableError(fnErr)) {
          // Spark fallback check: if server already granted PRO (e.g. via SuperAdmin), sync down cleanly without poisoning syncQueue
          const snap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
          const remoteData = snap && snap.exists() ? (snap.data() as Record<string, unknown>) : null;
          if (
            remoteData &&
            remoteData.plan === "PRO" &&
            typeof remoteData.proExpiresAt === "number" &&
            remoteData.proExpiresAt > Date.now()
          ) {
            const updatedUser = await persistServerVerifiedCoachUser(user, remoteData, null);
            return { success: true, updatedUser };
          }
          throw new Error(
            txBilling(
              "El servicio de activación en la nube no está disponible en este momento. Inténtalo de nuevo más tarde.",
              "The cloud subscription activation service is unavailable right now. Please try again later."
            )
          );
        }

        const code = String((fnErr as { code?: string })?.code || "").toLowerCase();
        if (code.includes("resource-exhausted")) {
          throw new Error(
            txBilling(
              "Has alcanzado el límite diario de activaciones promocionales. Inténtalo mañana.",
              "Daily promotional activation limit reached. Please try again tomorrow."
            )
          );
        }
        if (code.includes("failed-precondition")) {
          throw new Error(
            txBilling(
              "Tu cuenta no cumple los requisitos para activar Coach PRO (edad mínima 18 años o recibo vigente).",
              "Your account does not meet the requirements to activate Coach PRO (minimum age 18 or active store receipt)."
            )
          );
        }
        throw fnErr instanceof Error
          ? fnErr
          : new Error(txBilling("Error al verificar suscripción.", "Subscription verification error."));
      }
    }

    // SuperAdmin path (permitted directly by Firestore security rules)
    const periodMs = isAnnual ? COACH_PRO_ANNUAL_PERIOD_MS : COACH_PRO_PERIOD_MS;
    const now = Date.now();
    const expiresAt = now + periodMs;

    const linkedToExternal = isLinkedToExternalCoach(user);
    const existingCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
    const validCode = /^\d{6}$/.test(existingCode) ? existingCode : await generateUniqueClubInviteCode();
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
          role: "superadmin",
          clubId: resolvedClubId,
          clubInviteCode: validCode,
          isClubCreator: true
        };

    const updatedUser = await updateProfile(user.uid, profileUpdates);

    const newLog = {
      id: generateResilientId("SUB"),
      userId: user.uid,
      userName: (user.fullName || user.email || user.uid).slice(0, 128),
      previousPlan: user.plan || "FREE",
      newPlan: "PRO" as const,
      sku: canonicalSku,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      timestamp: getLocalISODate(now),
      source: "superadmin_promo",
      reason: `Activación Bonificada de Lanzamiento (${isAnnual ? "Anual 365d" : "Mensual 30d"})`
    };

    try {
      const { doc, setDoc } = await import("firebase/firestore");
      const { db, auth } = await import("@/lib/firebase");
      if (auth.currentUser) {
        await setDoc(doc(db, "subscription_audit_logs", newLog.id), newLog);
      } else {
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "subscription_audit_logs",
          operation: "INSERT",
          payloadId: newLog.id,
          payload: newLog,
          timestamp: now
        });
      }
    } catch {
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "subscription_audit_logs",
        operation: "INSERT",
        payloadId: newLog.id,
        payload: newLog,
        timestamp: now
      }).catch(() => {});
    }

    const auditLogs = await getLocalSetting<Record<string, unknown>[]>("sub_audit_logs", []);
    await saveLocalSetting("sub_audit_logs", [newLog, ...auditLogs]);

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
 * Restaura compras previas de Google Play Store / Apple App Store mediante Cloud Functions (`restoreStoreSubscription`)
 * con respaldo de lectura de `users/{uid}` y `subscription_audit_logs` autorizados por el servidor.
 */
export async function restoreCoachStorePurchases(
  user: UserProfile
): Promise<{ success: boolean; message: string; updatedUser?: UserProfile }> {
  if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") {
    return {
      success: false,
      message: txBilling(
        "Inicia sesión con tu cuenta para restaurar suscripciones.",
        "Sign in to your account to restore subscriptions."
      )
    };
  }

  const [
    { getLocalSetting },
    { updateProfile, generateUniqueClubInviteCode, isLinkedToExternalCoach }
  ] = await Promise.all([import("@/lib/db/indexedDB"), import("@/lib/authService")]);

  const now = Date.now();

  // 1. Primary path: invoke `restoreStoreSubscription` Cloud Function so server restores `users/{uid}` atomically
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const [{ getFunctions, httpsCallable }, { app, auth }] = await Promise.all([
        import("firebase/functions"),
        import("@/lib/firebase")
      ]);
      if (auth.currentUser && auth.currentUser.uid === user.uid) {
        const restoreFn = httpsCallable<
          Record<string, never>,
          {
            ok?: boolean;
            restored?: boolean;
            code?: string;
            updatedFields?: Record<string, unknown>;
          }
        >(getFunctions(app), "restoreStoreSubscription", { timeout: 20000 });

        const res = await restoreFn({});
        if (res.data?.ok && res.data.restored && res.data.updatedFields) {
          const updatedUser = await persistServerVerifiedCoachUser(user, res.data.updatedFields, null);
          return {
            success: true,
            message: txBilling(
              "¡Acceso Coach PRO restaurado y validado con éxito!",
              "Coach PRO access restored and verified!"
            ),
            updatedUser
          };
        }
      }
    } catch (fnErr) {
      if (!isFunctionsUnavailableError(fnErr)) {
        console.warn("restoreStoreSubscription callable warning, trying server document read:", fnErr);
      }
    }
  }

  // 2. Fallback read: inspect remote `users/{uid}` and server-authored `subscription_audit_logs`
  let validExpiresAt = 0;
  let remoteServerProfile: Record<string, unknown> | null = null;

  try {
    const { collection, query, where, getDocs, doc, getDoc, limit } = await import("firebase/firestore");
    const { db, auth } = await import("@/lib/firebase");

    if (auth.currentUser && auth.currentUser.uid === user.uid) {
      const userSnap = await getDoc(doc(db, "users", user.uid)).catch(() => null);
      if (userSnap && userSnap.exists()) {
        const uData = userSnap.data() as Record<string, unknown>;
        remoteServerProfile = uData;
        const remoteExp = Number(uData?.proExpiresAt) || 0;
        if (uData?.plan === "PRO" && remoteExp > now) {
          validExpiresAt = remoteExp;
        }
      }

      if (validExpiresAt <= now) {
        const q = query(
          collection(db, "subscription_audit_logs"),
          where("userId", "==", user.uid),
          limit(100)
        );
        const snap = await getDocs(q).catch(() => null);
        snap?.forEach((docSnap) => {
          const data = docSnap.data();
          const exp = Number(data?.expiresAt) || 0;
          if ((data?.newPlan === "PRO" || data?.plan === "PRO") && exp > now && exp > validExpiresAt) {
            validExpiresAt = exp;
          }
        });
      }
    }
  } catch (err) {
    console.warn("Could not query cloud subscription records:", err);
  }

  if (validExpiresAt <= now && user.role === "superadmin") {
    const localLogs = await getLocalSetting<Record<string, unknown>[]>("sub_audit_logs", []);
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
      message: txBilling(
        "No se encontraron suscripciones Coach PRO activas para restaurar.",
        "No active Coach PRO subscriptions found to restore."
      )
    };
  }

  // If server `users/{uid}` already carries active PRO, sync down locally without queueing client writes
  if (
    remoteServerProfile &&
    remoteServerProfile.plan === "PRO" &&
    Number(remoteServerProfile.proExpiresAt) > now
  ) {
    const updatedUser = await persistServerVerifiedCoachUser(user, remoteServerProfile, null);
    return {
      success: true,
      message: txBilling(
        "¡Acceso Coach PRO restaurado y validado con éxito!",
        "Coach PRO access restored and verified!"
      ),
      updatedUser
    };
  }

  // Non-superadmin cannot write `plan: "PRO"` directly when Cloud Functions is unreachable
  if (user.role !== "superadmin") {
    return {
      success: false,
      message: txBilling(
        "Se encontró un registro previo, pero el servidor de restauración no está disponible en este momento. Inténtalo más tarde.",
        "A previous subscription record was found, but the restoration service is currently unavailable. Please try again later."
      )
    };
  }

  const linkedToExternal = isLinkedToExternalCoach(user);
  const existingCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
  const validCode = /^\d{6}$/.test(existingCode) ? existingCode : await generateUniqueClubInviteCode();
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
        role: "superadmin",
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
    message: txBilling(
      "¡Acceso Coach PRO restaurado y validado con éxito!",
      "Coach PRO access restored and verified!"
    ),
    updatedUser
  };
}
