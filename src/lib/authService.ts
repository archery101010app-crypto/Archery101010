import { saveLocalSetting, getLocalSetting, generateResilientId, addToSyncQueue, getSyncQueue, removeFromSyncQueue, updateSyncItem, sanitizeForFirestore, getLocalSessions, saveLocalSession, macrocyclesStore } from "./db/indexedDB";
import { auth, db } from "./firebase";
import {
  toStandardLangCode,
  getMinimumConsentAge,
  getDefaultUnitSystemForCountry
} from "./i18n/regionalUtils";
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, limit } from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
  deleteUser,
  updateProfile as updateFirebaseAuthProfile
} from "firebase/auth";

export interface BowConfig {
  id?: string;
  name?: string;
  type: "Recurve" | "Compound" | "Barebow";
  brand: string;
  model: string;
  poundage: number;
  drawLength?: number;
  defaultDistance?: number;
  hand?: "RH" | "LH";
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  nickname: string;
  birthDate: string;
  country: string;
  city: string;
  gender: string;
  bowConfig?: BowConfig;
  bows?: BowConfig[];
  physicalData?: {
    height: number;
    weight: number;
    dominantEye?: "L" | "R";
    dominantHand: "L" | "R";
  };
  clubId: string | null;
  clubName: string | null;
  /** UID of the Coach this athlete is linked to (never equal to the athlete's own uid). */
  coachId?: string | null;
  /** Full name of the linked Coach (persisted on the athlete profile so it never resolves to self). */
  coachName?: string | null;
  /** Email of the linked Coach. */
  coachEmail?: string | null;
  clubLogo?: string; // index "0"-"4" or URL
  clubCountry?: string; // country code for club flag
  role: "archer" | "coach" | "team_admin" | "team_admin_coach" | "superadmin";
  plan: "FREE" | "PRO";
  /** Epoch ms when the free monthly Coach PRO access expires (re-activated by the coach once a month, still free). */
  proExpiresAt?: number;
  isClubCreator: boolean;
  unitSystem?: "metric" | "imperial";
  whatsappNumber?: string;
  clubInviteCode?: string;
  /** Verified 6-digit Coach invite code proof persisted when an archer links to a club. */
  joinedWithInviteCode?: string;
  fcmToken?: string;
  fcmTokens?: string[];
  profileSetupCompleted?: boolean;
  lastActiveAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface CoachLinkNotification {
  id: string;
  coachUid: string;
  athleteUid: string;
  athleteName: string;
  athleteEmail?: string;
  bowType?: string;
  country?: string;
  clubId?: string;
  type: "athlete_linked" | "athlete_unlinked";
  read: boolean;
  createdAt: number;
  updatedAt?: number;
}

const recentLocalUserWrites = new Map<string, number>();
const lastFullUserSetDocTs = new Map<string, number>();

export function markLocalUserWrite(uid: string, ts: number = Date.now()): void {
  if (!uid) return;
  recentLocalUserWrites.set(uid, ts);
}

export function hasRecentLocalUserWrite(uid: string, windowMs: number = 15000): boolean {
  if (!uid) return false;
  const ts = recentLocalUserWrites.get(uid);
  if (!ts) return false;
  return Date.now() - ts < windowMs;
}

const LOGIN_TIMEOUT_MS = 9000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout de conexión a la nube")), timeoutMs)
    )
  ]);
}

/**
 * Computes exact age in years from a YYYY-MM-DD (or ISO) birthDate string.
 * Rejects invalid calendar dates, out-of-range years, and any future date by returning `null`.
 */
export function calculateAgeFromBirthDate(birthDateStr: string): number | null {
  if (!birthDateStr || typeof birthDateStr !== "string") return null;
  const trimmed = birthDateStr.trim();
  if (!trimmed) return null;

  let year: number;
  let month: number;
  let day: number;

  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymdMatch) {
    year = Number(ymdMatch[1]);
    month = Number(ymdMatch[2]);
    day = Number(ymdMatch[3]);
  } else {
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    year = parsed.getFullYear();
    month = parsed.getMonth() + 1;
    day = parsed.getDate();
  }

  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const birthLocal = new Date(year, month - 1, day);
  if (
    birthLocal.getFullYear() !== year ||
    birthLocal.getMonth() !== month - 1 ||
    birthLocal.getDate() !== day
  ) {
    return null;
  }

  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (birthLocal.getTime() > todayLocal.getTime()) {
    return null;
  }

  let age = todayLocal.getFullYear() - year;
  const monthDiff = todayLocal.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && todayLocal.getDate() < day)) {
    age--;
  }

  if (age < 0 || age > 125) return null;
  return age;
}

function isProfileValid(u: UserProfile | null | undefined): boolean {
  if (!u) return false;
  return !!(
    u.fullName?.trim() &&
    u.birthDate &&
    u.country &&
    u.gender
  );
}

const NON_COACH_CLUB_IDS = new Set(["CLB-DIRECTOR", "CLB-101010", "CLB-DEMO"]);

/**
 * Returns the canonical internal clubId owned by a Coach.
 * Always derived deterministically from the Coach's own UID so a Coach can never
 * inherit another user's clubId.
 */
export function getCanonicalCoachClubId(coach: Partial<UserProfile> | null | undefined): string {
  if (!coach?.uid) return "CLB-DIRECTOR";
  return "CLB-" + coach.uid.replace("USR-", "");
}

/**
 * Extracts the external Coach's UID if the user is linked to another user as their Coach.
 * Returns null if the user is not linked to an external Coach.
 */
export function getExternalCoachUid(user: Partial<UserProfile> | null | undefined): string | null {
  if (!user?.uid) return null;
  if (user.coachId && user.coachId !== user.uid) {
    return user.coachId;
  }
  const ownCanonical = "CLB-" + user.uid.replace("USR-", "");
  if (
    user.clubId &&
    user.clubId.startsWith("CLB-") &&
    user.clubId !== ownCanonical &&
    user.clubId !== `CLB-${user.uid}` &&
    !NON_COACH_CLUB_IDS.has(user.clubId)
  ) {
    const candidateUid = user.clubId.slice(4);
    if (candidateUid && candidateUid !== user.uid) {
      return candidateUid;
    }
  }
  return null;
}

/**
 * True only when the user is linked as an athlete to ANOTHER user (their Coach),
 * never when clubId points to the user's own Coach ID.
 * Does NOT rely on `!user.isClubCreator`, because an athlete who previously
 * toggled Coach mode before linking may still have `isClubCreator: true` in stale storage.
 */
export function isLinkedToExternalCoach(user: Partial<UserProfile> | null | undefined): boolean {
  if (!user?.uid) return false;
  if (getExternalCoachUid(user) !== null) return true;
  if (user.coachId && user.coachId === user.uid) return false;
  const ownCanonical = "CLB-" + user.uid.replace("USR-", "");
  if (
    user.clubId &&
    user.clubId !== ownCanonical &&
    user.clubId !== `CLB-${user.uid}` &&
    !NON_COACH_CLUB_IDS.has(user.clubId) &&
    !user.isClubCreator
  ) {
    return true;
  }
  return false;
}

function sanitizeUserProfile(u: any): UserProfile {
  const copy = { ...u };
  delete copy.password;
  delete copy.actAsCoach;

  if (copy.uid) {
    // Self-heal self-referential coachId
    if (copy.coachId && copy.coachId === copy.uid) {
      copy.coachId = null;
      copy.coachName = null;
      copy.coachEmail = null;
    }

    // Prevent unverified superadmin email from showing broken Admin UI or failing Firestore rules
    if (
      copy.role === "superadmin" &&
      auth.currentUser &&
      auth.currentUser.uid === copy.uid &&
      !auth.currentUser.emailVerified
    ) {
      copy.role = copy.isClubCreator ? "coach" : "archer";
      if (copy.plan === "PRO" && (!copy.proExpiresAt || copy.proExpiresAt <= Date.now())) {
        copy.plan = "FREE";
      }
    }

    if (isLinkedToExternalCoach(copy)) {
      // Athlete is linked to another user's Coach account: never allow self-coach flags or own invite code
      copy.isClubCreator = false;
      copy.clubInviteCode = "";
      if (copy.role !== "superadmin" && !isVerifiedSuperAdminForUid(copy.email, copy.uid)) {
        copy.role = "archer";
      }
      const externalCoachUid = getExternalCoachUid(copy);
      if (!copy.coachId && externalCoachUid) {
        copy.coachId = externalCoachUid;
      }
      if (copy.clubName === "Club Archery 101010") {
        copy.clubName = null;
      }
    } else if (copy.role === "archer" && !copy.isClubCreator) {
      // Unlinked pure archer: strip any leftover invite code or self-clubId
      copy.clubId = null;
      copy.coachId = null;
      copy.coachName = null;
      copy.coachEmail = null;
      copy.clubInviteCode = "";
      copy.joinedWithInviteCode = "";
    } else if (
      copy.role === "coach" ||
      copy.role === "team_admin" ||
      copy.role === "team_admin_coach" ||
      (copy.isClubCreator && copy.role !== "archer")
    ) {
      // Genuine Coach / club owner: ensure canonical own clubId and no external coachId
      copy.clubId = getCanonicalCoachClubId(copy);
      copy.isClubCreator = true;
      copy.coachId = null;
      copy.coachName = null;
      copy.coachEmail = null;
    }
  }

  // Strip undefined fields so Firestore never rejects the profile write
  for (const k of Object.keys(copy)) {
    if (copy[k] === undefined) delete copy[k];
  }
  return copy as UserProfile;
}

import {
  OWNER_SELF_SERVICE_PROFILE_KEYS,
  mergeUserProfilesNonDestructive,
  buildOwnerSelfServiceProfilePatch
} from "./profileMerge";

export {
  OWNER_SELF_SERVICE_PROFILE_KEYS,
  mergeUserProfilesNonDestructive,
  buildOwnerSelfServiceProfilePatch
};

/**
 * Resilient profile write to Firestore:
 * 1) When an owner updates personal/bow fields, uses surgical `updateDoc` first so unrelated
 *    club/plan/coach fields on `resource.data` can never block saving bow, height, weight, or alias.
 * 2) Falls back to full `setDoc(..., { merge: true })` (e.g. if doc doesn't exist yet or club/role changed),
 *    and if full `setDoc` is rejected by a club/plan rule, still commits all owner personal/bow fields via `updateDoc`.
 */
export async function cloudWriteUser(
  profile: UserProfile,
  partialUpdates?: Partial<UserProfile>
): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (!profile?.uid) return false;
  const userDocRef = doc(db, "users", profile.uid);
  const isSelfAuthenticated = Boolean(auth.currentUser && auth.currentUser.uid === profile.uid);
  const nowTs = profile.updatedAt || Date.now();

  const updateKeys = partialUpdates
    ? Object.keys(partialUpdates).filter((k) => (partialUpdates as any)[k] !== undefined)
    : [];
  const hasNonSelfServiceUpdates = updateKeys.some((k) => !OWNER_SELF_SERVICE_PROFILE_KEYS.has(k));
  const isPureSelfServicePatch =
    isSelfAuthenticated &&
    updateKeys.length > 0 &&
    !hasNonSelfServiceUpdates;

  if (isPureSelfServicePatch && partialUpdates) {
    const directPatch = buildOwnerSelfServiceProfilePatch({
      ...partialUpdates,
      profileSetupCompleted: true,
      updatedAt: nowTs
    });
    try {
      await withTimeout(updateDoc(userDocRef, directPatch), 6000);
      return true;
    } catch {
      // Document may not exist yet (`not-found`); fall through to full setDoc creation below
    }
  }

  try {
    await withTimeout(
      setDoc(userDocRef, sanitizeUserProfile({ ...profile, updatedAt: nowTs }), { merge: true }),
      6000
    );
    lastFullUserSetDocTs.set(profile.uid, nowTs);
    return true;
  } catch (err: any) {
    if (isSelfAuthenticated) {
      const hasUnconfirmedPrivilegeOrClubFields =
        hasNonSelfServiceUpdates ||
        (!partialUpdates &&
          (Boolean(profile.clubId) ||
            Boolean(profile.coachId) ||
            Boolean(profile.clubInviteCode) ||
            Boolean(profile.joinedWithInviteCode) ||
            Boolean(profile.isClubCreator) ||
            (Boolean(profile.role) && profile.role !== "archer") ||
            profile.plan === "PRO"));
      try {
        const safePatch = buildOwnerSelfServiceProfilePatch({
          ...profile,
          ...(partialUpdates || {}),
          profileSetupCompleted: true,
          updatedAt: nowTs
        });
        if (Object.keys(safePatch).length > 0) {
          await withTimeout(updateDoc(userDocRef, safePatch), 6000);
          if (!hasUnconfirmedPrivilegeOrClubFields) {
            return true;
          }
          console.warn(
            "Self-service profile fields saved; club/role/plan fields deferred to sync queue:",
            err?.message || err
          );
          return false;
        }
      } catch {
        // Last-resort bootstrap create if document did not exist yet and had unverified club fields
        try {
          const cleanBootstrap = sanitizeUserProfile({
            ...profile,
            role:
              profile.role === "superadmin" && !isVerifiedSuperAdminForUid(profile.email, profile.uid)
                ? "archer"
                : profile.role,
            clubId: profile.role === "archer" ? null : profile.clubId,
            coachId: profile.role === "archer" ? null : profile.coachId,
            joinedWithInviteCode: "",
            updatedAt: nowTs
          });
          await withTimeout(setDoc(userDocRef, cleanBootstrap, { merge: true }), 6000);
          const strippedPrivilegedField =
            cleanBootstrap.role !== profile.role ||
            (cleanBootstrap.clubId || null) !== (profile.clubId || null) ||
            (cleanBootstrap.coachId || null) !== (profile.coachId || null) ||
            Boolean(profile.joinedWithInviteCode);
          if (!hasNonSelfServiceUpdates && !strippedPrivilegedField) {
            lastFullUserSetDocTs.set(profile.uid, nowTs);
            return true;
          }
          return false;
        } catch {}
      }
    }
    console.warn("Cloud profile write deferred to sync queue:", err?.message || err);
    return false;
  }
}

/** Roles that own a club and hand out invite codes */
function isClubOwnerRole(u: Partial<UserProfile> | null | undefined): boolean {
  if (!u || isLinkedToExternalCoach(u)) return false;
  return (
    u.role === "coach" ||
    u.role === "team_admin" ||
    u.role === "team_admin_coach" ||
    u.role === "superadmin" ||
    !!u.isClubCreator
  );
}

/**
 * Registers or updates the private O(1) lookup-only `coach_invite_codes/{code}` document for a Coach.
 * Never persists coach `email` PII (`email: null` is enforced by `firestore.rules`).
 */
export async function syncCoachInviteCodeDoc(
  coach: Partial<UserProfile>,
  options?: { throwOnError?: boolean }
): Promise<boolean> {
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  const cleanCode = (coach?.clubInviteCode || "").trim();
  if (
    !coach?.uid ||
    !isOnline ||
    !auth.currentUser ||
    isLinkedToExternalCoach(coach) ||
    !isClubOwnerRole(coach) ||
    !/^\d{6}$/.test(cleanCode)
  ) {
    return false;
  }

  const resolvedRole =
    coach.role === "team_admin" || coach.role === "team_admin_coach"
      ? coach.role
      : coach.role === "superadmin" && isVerifiedSuperAdminForUid(coach.email, coach.uid)
      ? "superadmin"
      : "coach";

  try {
    // Write complete validated document (no `{ merge: true }`) so any legacy `email` field is wiped clean
    await withTimeout(
      setDoc(
        doc(db, "coach_invite_codes", cleanCode),
        sanitizeForFirestore({
          code: cleanCode,
          coachUid: coach.uid,
          fullName: (coach.fullName || "").slice(0, 100),
          email: null,
          clubId: getCanonicalCoachClubId(coach),
          clubName: coach.clubName || null,
          clubCountry: coach.clubCountry || coach.country || "CR",
          clubLogo: coach.clubLogo || "0",
          role: resolvedRole,
          updatedAt: Date.now()
        })
      ),
      6000
    );
    return true;
  } catch (err) {
    console.warn("Could not sync coach_invite_codes doc:", err);
    if (options?.throwOnError) {
      throw err;
    }
    return false;
  }
}

function isFunctionsCallableUnavailable(err: unknown): boolean {
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
 * Promotes an adult (18+) independent archer to Coach / Club Creator via the `promoteToCoachClub` Cloud Function.
 * Never poisons `cola_sincronizacion` with forbidden client self-escalation writes on Spark.
 */
export async function promoteUserToCoachClub(
  user: UserProfile,
  opts?: {
    desiredRole?: "coach" | "team_admin" | "team_admin_coach";
    birthDate?: string;
    clubName?: string | null;
    clubCountry?: string;
  }
): Promise<UserProfile> {
  if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") {
    throw new Error(
      txAuth(
        "Inicia sesión con tu cuenta para activar tu club de entrenador.",
        "Sign in with your account to activate your coach club."
      )
    );
  }
  if (isLinkedToExternalCoach(user)) {
    throw new Error(
      txAuth(
        "Debes desvincularte de tu entrenador actual antes de crear tu propio club.",
        "You must leave your current coach's club before creating your own club."
      )
    );
  }

  const effectiveBirthDate = (opts?.birthDate || user.birthDate || "").trim();
  const age = calculateAgeFromBirthDate(effectiveBirthDate);
  if (user.role !== "superadmin" && (age === null || age < 18)) {
    throw new Error(
      txAuth(
        "Debes tener al menos 18 años para activar un perfil de Entrenador.",
        "You must be at least 18 years old to activate a Coach profile."
      )
    );
  }

  const desiredRole = opts?.desiredRole || "team_admin_coach";

  // SuperAdmin is permitted directly by Firestore rules
  if (user.role === "superadmin" && isVerifiedSuperAdminForUid(user.email, user.uid)) {
    const inviteCode =
      user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode.trim())
        ? user.clubInviteCode.trim()
        : await generateUniqueClubInviteCode();
    return await updateProfile(user.uid, {
      isClubCreator: true,
      clubId: getCanonicalCoachClubId(user),
      clubInviteCode: inviteCode,
      clubName: opts?.clubName !== undefined ? opts.clubName : user.clubName,
      clubCountry: opts?.clubCountry || user.clubCountry || user.country
    });
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(
      txAuth(
        "Se requiere conexión a internet para activar tu perfil de Entrenador.",
        "An internet connection is required to activate your Coach profile."
      )
    );
  }

  const [{ getFunctions, httpsCallable }, { app }] = await Promise.all([
    import("firebase/functions"),
    import("./firebase")
  ]);

  try {
    const promoteFn = httpsCallable<
      Record<string, unknown>,
      { ok?: boolean; profile?: Partial<UserProfile> }
    >(getFunctions(app), "promoteToCoachClub", { timeout: 20000 });

    const res = await promoteFn({
      desiredRole,
      birthDate: effectiveBirthDate,
      clubName: opts?.clubName ?? user.clubName ?? null,
      clubCountry: opts?.clubCountry || user.clubCountry || user.country || ""
    });

    if (!res.data?.ok || !res.data.profile) {
      throw new Error(
        txAuth(
          "No se pudo completar la activación del club en el servidor.",
          "Could not complete club activation on the server."
        )
      );
    }

    const nowTs = Number(res.data.profile.updatedAt || Date.now());
    const merged = sanitizeUserProfile({
      ...user,
      ...res.data.profile,
      uid: user.uid,
      profileSetupCompleted: true,
      updatedAt: nowTs
    });

    markLocalUserWrite(user.uid, nowTs);
    await saveLocalSetting("current_user", merged);
    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
    const idx = usersList.findIndex((u) => u.uid === user.uid);
    if (idx !== -1) {
      usersList[idx] = merged;
    } else {
      usersList.push(merged);
    }
    await saveLocalSetting("simulated_users", usersList);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: merged } }));
    }

    return merged;
  } catch (err: unknown) {
    if (isFunctionsCallableUnavailable(err)) {
      throw new Error(
        txAuth(
          "El servicio de activación de Entrenador en la nube no está disponible en este momento. Inténtalo más tarde.",
          "The cloud Coach activation service is unavailable right now. Please try again later."
        )
      );
    }
    throw err instanceof Error
      ? err
      : new Error(txAuth("Error al activar el club de Entrenador.", "Error activating Coach club."));
  }
}

/**
 * Rotates a Coach's 6-digit invite code safely without collisions or silent failures.
 * Uses `rotateCoachInviteCode` Cloud Function first, falling back to collision-checked `coach_invite_codes` swap for existing coaches.
 */
export async function rotateCoachClubInviteCode(
  user: UserProfile
): Promise<{ clubInviteCode: string; clubId: string; updatedUser: UserProfile }> {
  if (!user?.uid || user.uid === "USR-GUEST-OFFLINE") {
    throw new Error(
      txAuth(
        "Inicia sesión para generar un código de invitación.",
        "Sign in to generate an invite code."
      )
    );
  }
  if (isLinkedToExternalCoach(user)) {
    throw new Error(
      txAuth(
        "Los atletas vinculados a un entrenador externo no pueden rotar el código del club.",
        "Athletes linked to an external coach cannot rotate the club invite code."
      )
    );
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(
      txAuth(
        "Necesitas conexión a internet para generar un nuevo código de invitación.",
        "An internet connection is required to generate a new invite code."
      )
    );
  }

  let workingUser = user;
  if (workingUser.role === "archer" && !workingUser.isClubCreator) {
    workingUser = await promoteUserToCoachClub(workingUser, { desiredRole: "coach" });
    if (workingUser.clubInviteCode && /^\d{6}$/.test(workingUser.clubInviteCode)) {
      return {
        clubInviteCode: workingUser.clubInviteCode,
        clubId: getCanonicalCoachClubId(workingUser),
        updatedUser: workingUser
      };
    }
  }

  // 1. Primary path: transactional `rotateCoachInviteCode` Cloud Function
  if (auth.currentUser && auth.currentUser.uid === workingUser.uid) {
    try {
      const [{ getFunctions, httpsCallable }, { app }] = await Promise.all([
        import("firebase/functions"),
        import("./firebase")
      ]);
      const rotateFn = httpsCallable<
        Record<string, never>,
        { ok?: boolean; clubInviteCode?: string; clubId?: string }
      >(getFunctions(app), "rotateCoachInviteCode", { timeout: 15000 });

      const res = await rotateFn({});
      if (res.data?.ok && res.data.clubInviteCode) {
        const nowTs = Date.now();
        const canonicalClubId = res.data.clubId || getCanonicalCoachClubId(workingUser);
        const merged = sanitizeUserProfile({
          ...workingUser,
          clubInviteCode: res.data.clubInviteCode,
          clubId: canonicalClubId,
          isClubCreator: true,
          updatedAt: nowTs
        });
        markLocalUserWrite(workingUser.uid, nowTs);
        await saveLocalSetting("current_user", merged);
        const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
        const idx = usersList.findIndex((u) => u.uid === workingUser.uid);
        if (idx !== -1) {
          usersList[idx] = merged;
        } else {
          usersList.push(merged);
        }
        await saveLocalSetting("simulated_users", usersList);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: merged } }));
        }
        return {
          clubInviteCode: res.data.clubInviteCode,
          clubId: canonicalClubId,
          updatedUser: merged
        };
      }
    } catch (fnErr) {
      if (!isFunctionsCallableUnavailable(fnErr)) {
        console.warn("rotateCoachInviteCode callable warning, trying direct swap:", fnErr);
      }
    }
  }

  // 2. Spark fallback for existing verified coaches: allocate unique code, claim `coach_invite_codes/{newCode}` first, update profile, delete old code
  const oldCode = (workingUser.clubInviteCode || "").trim();
  const canonicalClubId = getCanonicalCoachClubId(workingUser);
  let allocatedCode = "";

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = await generateUniqueClubInviteCode();
    if (candidate === oldCode) continue;
    try {
      await syncCoachInviteCodeDoc(
        {
          ...workingUser,
          clubId: canonicalClubId,
          clubInviteCode: candidate
        },
        { throwOnError: true }
      );
      allocatedCode = candidate;
      break;
    } catch (claimErr) {
      console.warn("Invite code claim collision or error on attempt", attempt + 1, claimErr);
    }
  }

  if (!allocatedCode) {
    throw new Error(
      txAuth(
        "No se pudo reservar un nuevo código único de 6 dígitos en la nube. Inténtalo de nuevo.",
        "Could not allocate a unique 6-digit invite code in the cloud. Please try again."
      )
    );
  }

  const updatedUser = await updateProfile(workingUser.uid, {
    clubInviteCode: allocatedCode,
    clubId: canonicalClubId,
    isClubCreator: true
  });

  if (/^\d{6}$/.test(oldCode) && oldCode !== allocatedCode) {
    await deleteDoc(doc(db, "coach_invite_codes", oldCode)).catch((delErr) => {
      console.warn("Could not delete previous coach_invite_codes doc:", delErr);
    });
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updatedUser } }));
  }

  return {
    clubInviteCode: allocatedCode,
    clubId: canonicalClubId,
    updatedUser
  };
}

/**
 * Generates a unique 6-digit Coach invite code verified against `coach_invite_codes/{candidate}` when online,
 * falling back to `generateClubInviteCode()` offline.
 */
export async function generateUniqueClubInviteCode(): Promise<string> {
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  if (!isOnline || !auth.currentUser) {
    return generateClubInviteCode();
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = generateClubInviteCode();
    try {
      const snap = await withTimeout(getDoc(doc(db, "coach_invite_codes", candidate)), 4000);
      if (!snap.exists()) {
        return candidate;
      }
    } catch {
      return candidate;
    }
  }
  return generateClubInviteCode();
}

/**
 * Finds the Coach / club owner that owns a 6-digit invite code.
 * Primary lookup uses the O(1) non-listable `coach_invite_codes/{code}` directory (never `users_public`).
 * Never returns the requesting athlete himself or any non-coach account.
 */
export async function findClubOwnerByInviteCode(rawCode: string, excludeUid?: string): Promise<UserProfile | null> {
  const cleanCode = (rawCode || "").trim().toUpperCase();
  if (!cleanCode) return null;

  if (typeof navigator === "undefined" || navigator.onLine) {
    // 1. Primary O(1) lookup on private non-listable `coach_invite_codes/{cleanCode}`
    try {
      const codeSnap = await withTimeout(getDoc(doc(db, "coach_invite_codes", cleanCode)), 6500);
      if (codeSnap.exists()) {
        const data = codeSnap.data() as Record<string, any>;
        if (data?.coachUid && (!excludeUid || data.coachUid !== excludeUid)) {
          return sanitizeUserProfile({
            uid: data.coachUid,
            fullName: data.fullName || "Entrenador",
            email: data.email || "",
            clubId: data.clubId || getCanonicalCoachClubId({ uid: data.coachUid }),
            clubName: data.clubName || null,
            clubCountry: data.clubCountry || "CR",
            clubLogo: data.clubLogo || "0",
            clubInviteCode: cleanCode,
            role: data.role || "coach",
            isClubCreator: true
          });
        }
      }
    } catch (codeErr) {
      console.warn("Primary coach_invite_codes lookup failed, trying users fallback:", codeErr);
    }

    // 2. Server-side callable lookup (`lookupCoachInviteCode`) so athletes never fail Firestore read rules on legacy coaches
    if (auth.currentUser) {
      try {
        const [{ getFunctions, httpsCallable }, { app }] = await Promise.all([
          import("firebase/functions"),
          import("./firebase")
        ]);
        const lookupFn = httpsCallable<
          { code: string },
          { found?: boolean; coach?: Record<string, unknown> }
        >(getFunctions(app), "lookupCoachInviteCode", { timeout: 8000 });
        const lookupRes = await lookupFn({ code: cleanCode });
        const coachData = lookupRes.data?.coach;
        if (
          lookupRes.data?.found &&
          coachData &&
          typeof coachData.uid === "string" &&
          (!excludeUid || coachData.uid !== excludeUid)
        ) {
          return sanitizeUserProfile({
            uid: coachData.uid,
            fullName: String(coachData.fullName || "Entrenador"),
            email: "",
            clubId: String(coachData.clubId || getCanonicalCoachClubId({ uid: coachData.uid })),
            clubName: (coachData.clubName as string | null) || null,
            clubCountry: String(coachData.clubCountry || "CR"),
            clubLogo: String(coachData.clubLogo || "0"),
            clubInviteCode: cleanCode,
            role: (coachData.role as UserProfile["role"]) || "coach",
            isClubCreator: true
          });
        }
      } catch (callableErr) {
        if (!isFunctionsCallableUnavailable(callableErr)) {
          console.warn("lookupCoachInviteCode callable warning:", callableErr);
        }
      }
    }

    // 3. Fallback lookup on `users` filtered strictly to `isClubOwnerRole(u)`
    try {
      const snap = await withTimeout(
        getDocs(query(collection(db, "users"), where("clubInviteCode", "==", cleanCode), limit(10))),
        6500
      );
      const owners = snap.docs
        .map((d) => sanitizeUserProfile({ ...d.data(), uid: (d.data() as any).uid || d.id }))
        .filter((u) => (!excludeUid || u.uid !== excludeUid) && isClubOwnerRole(u));
      if (owners.length > 0) {
        return owners.find((u) => u.isClubCreator) || owners[0];
      }
    } catch (err) {
      console.warn("Cloud lookup of invite code failed, trying local cache:", err);
    }
  }

  const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
  const localOwners = usersList.filter(
    (u) =>
      (!excludeUid || u.uid !== excludeUid) &&
      isClubOwnerRole(u) &&
      (u.clubInviteCode || "").trim().toUpperCase() === cleanCode
  );
  return localOwners.find((u) => u.isClubCreator) || localOwners[0] || null;
}

function resolveActiveAuthLanguage(): string {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("preferred_language");
      if (saved && saved.trim()) {
        return toStandardLangCode(saved);
      }
    } catch {}
    const browserLang =
      typeof navigator !== "undefined" ? navigator.language?.split("-")[0] : "";
    return toStandardLangCode(browserLang || "en");
  }
  return "en";
}

function txAuth(esText: string, enText: string): string {
  return resolveActiveAuthLanguage() === "es" ? esText : enText;
}

export function translateFirebaseAuthError(err: any): string {
  const code = err?.code || "";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-login-credentials"
  ) {
    return txAuth(
      "Correo o contraseña incorrectos. Si creaste tu cuenta con Google, usa el botón 'Iniciar con Google' o pulsa '¿Olvidaste tu contraseña?' para asignarle una clave.",
      "Incorrect email or password. If you signed up with Google, use 'Sign in with Google' or tap 'Forgot your password?' to set a password."
    );
  }
  if (code === "auth/email-already-in-use") {
    return txAuth(
      "Este correo electrónico ya está registrado. Por favor inicia sesión o recupera tu contraseña.",
      "This email address is already registered. Please sign in or reset your password."
    );
  }
  if (code === "auth/account-exists-with-different-credential") {
    return txAuth(
      "Ya existe una cuenta con este correo vinculada a otro método de ingreso (Google o Correo). Inicia sesión con el método que usaste originalmente.",
      "An account with this email already exists under another sign-in method (Google, Apple, or Email). Please sign in using your original method."
    );
  }
  if (code === "auth/weak-password") {
    return txAuth(
      "La contraseña debe tener al menos 6 caracteres.",
      "Password must be at least 6 characters long."
    );
  }
  if (code === "auth/invalid-email") {
    return txAuth(
      "El formato del correo electrónico no es válido.",
      "Invalid email address format."
    );
  }
  if (code === "auth/user-disabled") {
    return txAuth(
      "Esta cuenta ha sido deshabilitada temporalmente. Contacta al soporte de Archery 101010.",
      "This account has been temporarily disabled. Please contact ARCHERY 101010 support."
    );
  }
  if (code === "auth/too-many-requests") {
    return txAuth(
      "Demasiados intentos fallidos. Por seguridad, espera unos minutos o restablece tu contraseña.",
      "Too many failed attempts. For security, please wait a few minutes or reset your password."
    );
  }
  if (code === "auth/network-request-failed") {
    return txAuth(
      "Error de conexión. Verifica tu acceso a internet e inténtalo de nuevo.",
      "Network connection error. Please check your internet access and try again."
    );
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return txAuth("Inicio de sesión cancelado.", "Sign-in cancelled.");
  }
  if (code === "auth/popup-blocked") {
    return txAuth(
      "Las ventanas emergentes están bloqueadas en tu navegador. Permítelas o ingresa con tu correo y contraseña.",
      "Pop-up windows are blocked in your browser. Please allow them or sign in with email and password."
    );
  }
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
    return txAuth(
      "Este método de inicio de sesión aún no está habilitado en el servidor. Por favor ingresa con tu correo y contraseña.",
      "This sign-in method is not enabled yet. Please sign in with your email and password."
    );
  }
  if (code === "auth/requires-recent-login") {
    return txAuth(
      "Por seguridad, cierra sesión y vuelve a ingresar antes de eliminar tu cuenta.",
      "For security, please log out and sign in again before deleting your account."
    );
  }
  return err?.message || txAuth("Error de autenticación.", "Authentication error.");
}

function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return (
    clean === "admin101010" ||
    clean === "admin@archery101010.com" ||
    clean === "admin101010@archery101010.com" ||
    clean === "info@archery101010.com" ||
    clean === "archery101010app@gmail.com"
  );
}

/**
 * Verifies SuperAdmin eligibility aligned with `firestore.rules` (`email_verified == true`).
 * Unverified accounts are never auto-promoted to `superadmin` on the client.
 */
function isVerifiedSuperAdminForUid(email?: string | null, uid?: string | null): boolean {
  if (!isSuperAdminEmail(email)) return false;
  const currentUser = auth.currentUser;
  if (!currentUser) return false;
  if (uid && currentUser.uid !== uid) return false;
  return currentUser.emailVerified === true;
}

export async function getLoggedUser(): Promise<UserProfile | null> {
  const u = await getLocalSetting<UserProfile | null>("current_user", null);
  if (!u) return null;
  const sanitized = sanitizeUserProfile(u);
  if (isVerifiedSuperAdminForUid(sanitized.email, sanitized.uid) && sanitized.role !== "superadmin") {
    sanitized.role = "superadmin";
    sanitized.plan = "PRO";
  }
  return sanitized;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error(
      txAuth(
        "Ingresa tu correo electrónico para enviarte el enlace de recuperación.",
        "Enter your email address to receive a password reset link."
      )
    );
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error(
      txAuth(
        "El formato del correo electrónico no es válido.",
        "Invalid email address format."
      )
    );
  }
  try {
    const activeLang = resolveActiveAuthLanguage();
    auth.languageCode = activeLang;
    const continueUrl =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://archery101010-c0bb4.firebaseapp.com";
    try {
      await sendPasswordResetEmail(auth, cleanEmail, {
        url: continueUrl,
        handleCodeInApp: false,
      });
    } catch (innerErr: any) {
      if (
        innerErr?.code === "auth/invalid-continue-uri" ||
        innerErr?.code === "auth/unauthorized-continue-uri" ||
        innerErr?.code === "auth/missing-continue-uri"
      ) {
        await sendPasswordResetEmail(auth, cleanEmail);
      } else {
        throw innerErr;
      }
    }
  } catch (err: any) {
    throw new Error(translateFirebaseAuthError(err));
  }
}

export async function loginUser(email: string, password?: string): Promise<UserProfile> {
  const normalizedEmail = email.trim().toLowerCase();

  const targetEmail = normalizedEmail === "admin101010" ? "admin@archery101010.com" : normalizedEmail;

  if (!password) {
    throw new Error(txAuth("Por favor ingresa tu contraseña.", "Please enter your password."));
  }

  let authUid = "";
  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  // 1. Authenticate with Firebase Authentication (server-side password verification)
  if (isOnline) {
    try {
      const cred = await signInWithEmailAndPassword(auth, targetEmail, password);
      authUid = cred.user.uid;
    } catch (authErr: any) {
      throw new Error(translateFirebaseAuthError(authErr));
    }
  } else {
    // Offline fallback: only allow if this user is already the active Firebase Auth session on this device
    if (auth.currentUser && (auth.currentUser.email || "").toLowerCase() === targetEmail) {
      authUid = auth.currentUser.uid;
    } else {
      throw new Error(
        txAuth(
          "Se requiere conexión a internet para verificar tus credenciales de inicio de sesión.",
          "An internet connection is required to verify your sign-in credentials."
        )
      );
    }
  }

  const isAdminEmail = isVerifiedSuperAdminForUid(targetEmail, authUid);

  let user: UserProfile | undefined = undefined;
  let cloudFetchFailed = false;

  // 2. Fetch user profile from Firestore by UID (or email fallback)
  if (isOnline && authUid) {
    try {
      const directSnap = await withTimeout(getDoc(doc(db, "users", authUid)), LOGIN_TIMEOUT_MS);
      if (directSnap.exists()) {
        user = sanitizeUserProfile({ ...directSnap.data(), uid: authUid });
      } else {
        const q = query(collection(db, "users"), where("email", "==", targetEmail), limit(5));
        const querySnapshot = await withTimeout(getDocs(q), LOGIN_TIMEOUT_MS);
        if (!querySnapshot.empty) {
          // Legacy account with the same email but a different UID: adopt its data under the real Auth UID
          // and persist users/{authUid} right away so future logins resolve directly (no duplicate lookups).
          user = sanitizeUserProfile({
            ...querySnapshot.docs[0].data(),
            uid: authUid,
            email: targetEmail
          });
          await cloudWriteUser(user);
        }
      }

      if (user) {
        const localUsers = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
        const currentCached = await getLocalSetting<UserProfile | null>("current_user", null);
        const fromList = localUsers.find(
          (u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail
        );
        const localCandidate =
          currentCached &&
          (currentCached.uid === authUid || (currentCached.email || "").toLowerCase() === targetEmail) &&
          Number(currentCached.updatedAt || 0) >= Number(fromList?.updatedAt || 0)
            ? sanitizeUserProfile({ ...currentCached, uid: authUid })
            : fromList
            ? sanitizeUserProfile({ ...fromList, uid: authUid })
            : null;

        if (localCandidate) {
          const { merged, localHadMissingCloudFields } = mergeUserProfilesNonDestructive(localCandidate, {
            ...user,
            uid: authUid
          });
          user = merged;
          if (localHadMissingCloudFields) {
            await cloudWriteUser(user);
          }
        }
        const cleanedList = localUsers
          .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
          .map(sanitizeUserProfile);
        cleanedList.push(user);
        await saveLocalSetting("simulated_users", cleanedList);
      }
    } catch (err) {
      cloudFetchFailed = true;
      console.warn("Firestore user fetch timed out or failed, falling back to local cache:", err);
    }
  }

  // 3. Fallback to local IndexedDB cache (`current_user` or `simulated_users`) WITHOUT overwriting cloud on timeout (Fixes A6)
  if (!user) {
    const currentCached = await getLocalSetting<UserProfile | null>("current_user", null);
    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
    const fromList = usersList.find(
      (u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail
    );
    const cached =
      currentCached &&
      (currentCached.uid === authUid || (currentCached.email || "").toLowerCase() === targetEmail) &&
      Number(currentCached.updatedAt || 0) >= Number(fromList?.updatedAt || 0)
        ? currentCached
        : fromList || null;
    if (cached) {
      user = sanitizeUserProfile({ ...cached, uid: authUid || cached.uid });
    }
  }

  // Never fabricate a blank profile when cloud fetch failed or timed out (Fixes C3)
  if (!user && cloudFetchFailed) {
    throw new Error(
      txAuth(
        "Conexión inestable al cargar tu perfil. Verifica tu señal e inténtalo de nuevo.",
        "Unstable connection while loading your profile. Check your signal and try again."
      )
    );
  }

  // 4. Confirmed new account in Firestore (`!cloudFetchFailed && !user && authUid`): initialize with clean blank/0 defaults
  if (isOnline && !cloudFetchFailed && !user && authUid) {
    const autoNickname = isAdminEmail
      ? "admin"
      : targetEmail.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";
    user = {
      uid: authUid,
      email: targetEmail,
      fullName: auth.currentUser?.displayName || (isAdminEmail ? "Admin101010" : "Arquero"),
      nickname: autoNickname,
      birthDate: isAdminEmail ? "1995-05-15" : "",
      country: isAdminEmail ? "CR" : "",
      city: "",
      gender: (isAdminEmail ? "M" : "") as any,
      bowConfig: {
        type: "Recurve",
        brand: "",
        model: "",
        poundage: 0,
        defaultDistance: 18
      },
      physicalData: {
        height: 0,
        weight: 0,
        dominantEye: "R",
        dominantHand: "R"
      },
      clubId: null,
      clubName: null,
      role: isAdminEmail ? "superadmin" : "archer",
      plan: isAdminEmail ? "PRO" : "FREE",
      isClubCreator: false,
      profileSetupCompleted: isAdminEmail,
      createdAt: Date.now()
    };

    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", []))
      .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
      .map(sanitizeUserProfile);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);

    const wroteCloud = await cloudWriteUser(user);
    if (!wroteCloud) {
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "INSERT",
        payloadId: user.uid,
        payload: user,
        timestamp: Date.now()
      });
    }
  }

  if (!user) {
    throw new Error(txAuth("No se encontró el perfil del usuario.", "User profile not found."));
  }

  if (isAdminEmail && user.role !== "superadmin") {
    user.role = "superadmin";
  }

  await migrateOfflineGuestData(user.uid);
  await saveLocalSetting("current_user", user);
  return user;
}

/**
 * Genera un código de invitación para alumnos limpio y corto de 6 dígitos numéricos (máximo 6 dígitos).
 * Ej. 748291
 */
export function generateClubInviteCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function registerUser(
  profileData: Omit<UserProfile, "uid" | "role" | "plan" | "isClubCreator" | "clubInviteCode"> & { password?: string; actAsCoach?: boolean }
): Promise<UserProfile> {
  const normalizedEmail = profileData.email.trim().toLowerCase();
  const rawPassword = profileData.password;

  if (!rawPassword || rawPassword.length < 6) {
    throw new Error(
      txAuth(
        "La contraseña debe tener al menos 6 caracteres.",
        "Password must be at least 6 characters long."
      )
    );
  }

  // Validate birthDate and enforce regional digital consent age gate (18+ mandatory for Coaches) BEFORE creating Firebase Auth account
  const age = calculateAgeFromBirthDate(profileData.birthDate);
  if (age === null) {
    throw new Error(
      txAuth(
        "Ingresa una fecha de nacimiento válida (no se permiten fechas futuras).",
        "Please enter a valid date of birth (future dates are not allowed)."
      )
    );
  }
  const minConsentAge = getMinimumConsentAge(profileData.country);
  const requiresCoachAdultAge =
    profileData.clubId === "CREATE_NEW" || profileData.actAsCoach === true;
  if (requiresCoachAdultAge && age < 18) {
    throw new Error(
      txAuth(
        "Debes tener al menos 18 años para crear un club o registrarte como Coach.",
        "You must be at least 18 years old to create a club or register as a Coach."
      )
    );
  }
  if (age < minConsentAge) {
    throw new Error(
      txAuth(
        `Debes tener al menos ${minConsentAge} años en tu país para crear una cuenta en ARCHERY 101010.`,
        `You must be at least ${minConsentAge} years old in your country to create an ARCHERY 101010 account.`
      )
    );
  }

  auth.languageCode = resolveActiveAuthLanguage();

  // 1. Create account in Firebase Authentication so UID matches request.auth.uid in Firestore rules
  let uid = "";
  try {
    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, rawPassword);
    uid = cred.user.uid;
    if (profileData.fullName) {
      await updateFirebaseAuthProfile(cred.user, { displayName: profileData.fullName.trim() }).catch(() => {});
    }
  } catch (authErr: any) {
    throw new Error(translateFirebaseAuthError(authErr));
  }

  const isAdult = age >= 18;
  const isAdminEmail = isVerifiedSuperAdminForUid(normalizedEmail, uid);
  const requestedCoachClubCreation = !isAdminEmail && profileData.clubId === "CREATE_NEW" && isAdult;
  const requestedCoachRole: "team_admin_coach" | "team_admin" =
    profileData.actAsCoach !== false ? "team_admin_coach" : "team_admin";

  const finalRole: UserProfile["role"] = isAdminEmail ? "superadmin" : "archer";
  const isCreator = false;
  const inviteCode = "";
  let clubLogo = profileData.clubLogo || "0";
  let clubCountry = profileData.clubCountry || profileData.country;

  // Strip password and actAsCoach so they are NEVER saved in UserProfile
  const { actAsCoach: _discardedActAsCoach, password: _discardedPassword, ...userFields } = profileData;
  let linkedCoachOnRegister: UserProfile | null = null;

  if (!isAdminEmail) {
    if (profileData.clubId === "CREATE_NEW") {
      // Initial user document is created as a valid `archer` first so Firestore `create` rules pass;
      // server-verified coach club promotion runs immediately after via `promoteUserToCoachClub`.
      userFields.clubId = null;
    } else if (profileData.clubId && profileData.clubId !== "NONE") {
      const clubCoach = await findClubOwnerByInviteCode(profileData.clubId, uid);
      if (clubCoach && clubCoach.uid !== uid) {
        linkedCoachOnRegister = clubCoach;
        userFields.clubId = getCanonicalCoachClubId(clubCoach);
        userFields.coachId = clubCoach.uid;
        userFields.coachName = clubCoach.fullName || "Entrenador";
        userFields.coachEmail = clubCoach.email || "";
        (userFields as any).joinedWithInviteCode = String(
          clubCoach.clubInviteCode || profileData.clubId || ""
        )
          .trim()
          .toUpperCase();
        clubLogo = clubCoach.clubLogo || "0";
        clubCountry = clubCoach.clubCountry || clubCoach.country;
      } else {
        // Code not found: register as independent archer (they can link later from Profile)
        userFields.clubId = null;
      }
    } else {
      userFields.clubId = null;
    }
  } else {
    userFields.clubId = null;
  }

  const nowTs = Date.now();
  let newProfile: UserProfile = sanitizeUserProfile({
    ...userFields,
    email: normalizedEmail,
    uid,
    role: finalRole,
    plan: finalRole === "superadmin" ? "PRO" : "FREE", // Todas las cuentas inician FREE; Coach PRO se activa gratis cada mes
    isClubCreator: isCreator,
    unitSystem: profileData.unitSystem || getDefaultUnitSystemForCountry(profileData.country),
    clubInviteCode: inviteCode,
    clubLogo,
    clubCountry,
    profileSetupCompleted: true,
    bowConfig: profileData.bowConfig || {
      type: "Barebow",
      brand: "",
      model: "",
      poundage: 35,
      defaultDistance: 18
    },
    physicalData: profileData.physicalData || {
      height: 175,
      weight: 70,
      dominantEye: "R",
      dominantHand: "R"
    },
    createdAt: nowTs,
    updatedAt: nowTs
  });

  markLocalUserWrite(newProfile.uid, nowTs);
  await saveLocalSetting("current_user", newProfile);

  // Save to local cache without plaintext password
  const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", []))
    .filter((u) => u.uid !== uid && (u.email || "").toLowerCase() !== normalizedEmail)
    .map(sanitizeUserProfile);
  usersList.push(newProfile);
  await saveLocalSetting("simulated_users", usersList);

  // Queue to Firestore sync queue (document ID == Firebase Auth UID)
  await addToSyncQueue({
    id: generateResilientId("TXN"),
    collection: "users",
    operation: "INSERT",
    payloadId: newProfile.uid,
    payload: newProfile,
    timestamp: nowTs
  });

  if (typeof navigator === "undefined" || navigator.onLine) {
    const wroteCloud = await cloudWriteUser(newProfile);
    if (wroteCloud && lastFullUserSetDocTs.get(newProfile.uid) === nowTs) {
      try {
        const queue = await getSyncQueue();
        await Promise.allSettled(
          queue
            .filter(
              (item) =>
                item.collection === "users" &&
                item.payloadId === newProfile.uid &&
                item.operation !== "DELETE"
            )
            .map((item) => removeFromSyncQueue(item.id))
        );
      } catch {}
    }
    if (requestedCoachClubCreation) {
      try {
        newProfile = await promoteUserToCoachClub(newProfile, {
          desiredRole: requestedCoachRole,
          birthDate: profileData.birthDate,
          clubName: profileData.clubName ?? null,
          clubCountry
        });
      } catch (promoteErr) {
        console.warn("Coach club server promotion deferred during registration:", promoteErr);
      }
    } else if (isClubOwnerRole(newProfile) && /^\d{6}$/.test(newProfile.clubInviteCode || "")) {
      await syncCoachInviteCodeDoc(newProfile).catch(() => {});
    }
  }

  if (linkedCoachOnRegister) {
    emitCoachLinkNotification(linkedCoachOnRegister, newProfile, "athlete_linked").catch(() => {});
  }

  await migrateOfflineGuestData(newProfile.uid);
  return newProfile;
}

export async function emitCoachLinkNotification(
  coach: Partial<UserProfile>,
  athlete: UserProfile,
  type: "athlete_linked" | "athlete_unlinked" = "athlete_linked"
): Promise<void> {
  if (!coach?.uid || !athlete?.uid || coach.uid === athlete.uid) return;
  const now = Date.now();
  const notifId = `NTF-LINK-${coach.uid}-${athlete.uid}-${now}`;
  const notif: CoachLinkNotification = {
    id: notifId,
    coachUid: coach.uid,
    athleteUid: athlete.uid,
    athleteName: athlete.fullName || athlete.nickname || "Arquero",
    athleteEmail: athlete.email || "",
    bowType: athlete.bowConfig?.type || athlete.bows?.[0]?.type || "Recurve",
    country: athlete.country || "CR",
    clubId: getCanonicalCoachClubId(coach),
    type,
    read: false,
    createdAt: now,
    updatedAt: now
  };

  try {
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "coach_notifications",
      operation: "INSERT",
      payloadId: notifId,
      payload: notif,
      timestamp: now
    });
  } catch {}

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      await withTimeout(setDoc(doc(db, "coach_notifications", notifId), notif, { merge: true }), 6000);
    } catch (err: any) {
      console.warn("Coach link notification queued for background sync:", err?.message || err);
    }
  }
}

export async function updateProfile(uid: string, updates: Partial<UserProfile>): Promise<UserProfile> {
  const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
  let index = usersList.findIndex((u) => u.uid === uid);

  let currentLogged = await getLoggedUser();

  if (index === -1 && currentLogged && currentLogged.uid === uid) {
    usersList.push(currentLogged);
    index = usersList.length - 1;
  }

  // Fallback if neither simulated_users nor current_user has uid yet: fetch from Firestore
  if (index === -1 && (typeof navigator === "undefined" || navigator.onLine)) {
    try {
      const snap = await withTimeout(getDoc(doc(db, "users", uid)), LOGIN_TIMEOUT_MS);
      if (snap.exists()) {
        const fetched = sanitizeUserProfile({ ...snap.data(), uid });
        usersList.push(fetched);
        index = usersList.length - 1;
      }
    } catch {}
  }

  const nowTs = Date.now();
  const prevProfile =
    index !== -1
      ? usersList[index]
      : currentLogged && currentLogged.uid === uid
      ? currentLogged
      : null;
  const prevInviteCode = (prevProfile?.clubInviteCode || "").trim();

  const persistUserCloudOrQueue = async (finalProfile: UserProfile) => {
    const isOnlineNow = typeof navigator === "undefined" || navigator.onLine;
    let wroteCloud = false;
    if (isOnlineNow) {
      wroteCloud = await cloudWriteUser(finalProfile, updates);
    }

    if (isOnlineNow && auth.currentUser) {
      const nextInviteCode = (finalProfile.clubInviteCode || "").trim();
      if (isClubOwnerRole(finalProfile) && /^\d{6}$/.test(nextInviteCode)) {
        await syncCoachInviteCodeDoc(finalProfile).catch(() => {});
      }
      if (/^\d{6}$/.test(prevInviteCode) && prevInviteCode !== nextInviteCode) {
        await deleteDoc(doc(db, "coach_invite_codes", prevInviteCode)).catch(() => {});
      }
    }

    if (wroteCloud) {
      const confirmedFullSetDoc = lastFullUserSetDocTs.get(finalProfile.uid) === nowTs;
      try {
        const queue = await getSyncQueue();
        const queuedUserItems = queue.filter(
          (item) =>
            item.collection === "users" &&
            item.payloadId === finalProfile.uid &&
            item.operation !== "DELETE"
        );
        if (confirmedFullSetDoc) {
          // Full setDoc succeeded: safe to remove any older queued user items for this uid
          await Promise.allSettled(
            queuedUserItems.map((item) => removeFromSyncQueue(item.id))
          );
        } else if (queuedUserItems.length > 0) {
          // Pure self-service updateDoc succeeded: preserve queued items that carry pending club/role diffs,
          // merging the latest profile fields so newly saved self-service values are never overwritten on replay
          const CLUB_OR_ROLE_KEYS = [
            "role",
            "plan",
            "proExpiresAt",
            "clubId",
            "coachId",
            "isClubCreator",
            "clubInviteCode",
            "joinedWithInviteCode"
          ] as const;
          await Promise.allSettled(
            queuedUserItems.map((item) => {
              const p = item.payload || {};
              const hasClubOrRolePayload = CLUB_OR_ROLE_KEYS.some(
                (k) =>
                  k in p &&
                  (Boolean(p[k]) ||
                    (p[k] ?? null) !== ((finalProfile as any)[k] ?? null))
              );
              if (hasClubOrRolePayload) {
                return updateSyncItem(item.id, {
                  payload: sanitizeForFirestore({ ...p, ...finalProfile })
                });
              }
              return removeFromSyncQueue(item.id);
            })
          );
        }
      } catch {}
      import("@/lib/db/realtimeSync")
        .then(({ syncPublicUserPresence }) => syncPublicUserPresence(finalProfile))
        .catch(() => {});
      import("@/lib/db/syncManager").then(({ runSync }) => runSync()).catch(() => {});
    } else {
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "UPDATE",
        payloadId: finalProfile.uid,
        payload: finalProfile,
        timestamp: nowTs
      });
    }
  };

  if (index !== -1) {
    const updatedUser = sanitizeUserProfile({
      ...usersList[index],
      ...updates,
      uid,
      profileSetupCompleted: true,
      updatedAt: nowTs
    });

    markLocalUserWrite(uid, nowTs);
    usersList[index] = updatedUser;

    // Persist current_user FIRST before any async cloud write or sync trigger can fire a snapshot listener
    if (currentLogged && currentLogged.uid === uid) {
      currentLogged = sanitizeUserProfile({
        ...currentLogged,
        ...updates,
        uid,
        profileSetupCompleted: true,
        updatedAt: nowTs
      });
      await saveLocalSetting("current_user", currentLogged);
    }

    await saveLocalSetting("simulated_users", usersList);
    await persistUserCloudOrQueue(updatedUser);

    return updatedUser;
  }

  if (currentLogged && currentLogged.uid === uid) {
    const updated = sanitizeUserProfile({
      ...currentLogged,
      ...updates,
      uid,
      profileSetupCompleted: true,
      updatedAt: nowTs
    });
    markLocalUserWrite(uid, nowTs);
    await saveLocalSetting("current_user", updated);
    await persistUserCloudOrQueue(updated);

    return updated;
  }

  throw new Error("User not found");
}

export async function logoutUser(): Promise<void> {
  if (typeof window !== "undefined") {
    (window as any).__archeryManualLogout = true;
  }
  if (auth.currentUser && (typeof navigator === "undefined" || navigator.onLine)) {
    try {
      const { runSync } = await import("./db/syncManager");
      await Promise.race([
        runSync(undefined, true).catch(() => {}),
        new Promise((r) => setTimeout(r, 3500))
      ]);
    } catch {}
  }
  await saveLocalSetting("current_user", null);
  try {
    await signOut(auth);
  } catch (err) {
    console.warn("Firebase signOut warning:", err);
  } finally {
    if (typeof window !== "undefined") {
      setTimeout(() => {
        (window as any).__archeryManualLogout = false;
      }, 3000);
    }
  }
}

/**
 * Permanently deletes a user account and all associated local & cloud data
 * (Mandatory Google Play Store & Apple App Store Account Deletion compliance)
 */
export async function deleteUserAccount(uid: string): Promise<void> {
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  const isGuest = uid === "USR-GUEST-OFFLINE";

  // 1. Pre-check recent sign-in BEFORE wiping Firestore or local data to avoid partial destructive deletes
  if (isOnline && !isGuest) {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error(translateFirebaseAuthError({ code: "auth/requires-recent-login" }));
    }
    const lastSignInRaw = auth.currentUser.metadata?.lastSignInTime;
    const lastSignInMs = lastSignInRaw ? Date.parse(lastSignInRaw) : 0;
    // Firebase Auth requires sign-in within the last 5 minutes for deleteUser()
    if (!lastSignInMs || isNaN(lastSignInMs) || Date.now() - lastSignInMs > 5 * 60 * 1000) {
      throw new Error(translateFirebaseAuthError({ code: "auth/requires-recent-login" }));
    }
    try {
      await withTimeout(auth.currentUser.getIdToken(true), 8000);
    } catch (tokenErr: any) {
      if (tokenErr?.code === "auth/requires-recent-login" || tokenErr?.code === "auth/user-token-expired") {
        throw new Error(translateFirebaseAuthError({ code: "auth/requires-recent-login" }));
      }
    }
  }

  // Resolve current profile to check if Coach owner needs to unlink students first
  let targetProfile: UserProfile | null = null;
  try {
    const logged = await getLoggedUser();
    if (logged && logged.uid === uid) {
      targetProfile = logged;
    } else {
      const localList = await getLocalSetting<UserProfile[]>("simulated_users", []);
      targetProfile = localList.find((u) => u.uid === uid) || null;
    }
    if (!targetProfile && isOnline && !isGuest) {
      const snap = await withTimeout(getDoc(doc(db, "users", uid)), LOGIN_TIMEOUT_MS).catch(() => null);
      if (snap && snap.exists()) {
        targetProfile = sanitizeUserProfile({ ...snap.data(), uid });
      }
    }
  } catch {}

  const isCoachOwner = Boolean(
    targetProfile &&
      !isLinkedToExternalCoach(targetProfile) &&
      (targetProfile.role === "coach" ||
        targetProfile.role === "team_admin" ||
        targetProfile.role === "team_admin_coach" ||
        targetProfile.isClubCreator)
  );

  // Unlink students while caller still holds Coach permissions and profile exists
  if (isCoachOwner && !isGuest) {
    try {
      await leaveCurrentClub(uid);
    } catch (unlinkErr) {
      console.warn("Could not fully unlink students before deleting Coach account:", unlinkErr);
    }
  }

  // Capture & clear local 6-digit watch pairing code and 256-bit watch session token before cloud cleanup
  let savedPairingCode = "";
  let savedSessionToken = "";
  if (typeof window !== "undefined") {
    const pairingStorageKey = `archery_watch_pairing_code_${uid}`;
    const tokenStorageKey = `archery_watch_session_token_${uid}`;
    try {
      savedPairingCode = (localStorage.getItem(pairingStorageKey) || "").trim();
      savedSessionToken = (localStorage.getItem(tokenStorageKey) || "").trim();
      localStorage.removeItem(pairingStorageKey);
      localStorage.removeItem(tokenStorageKey);
    } catch {}
  }

  const DELETE_BATCH_TIMEOUT_MS = 45000;
  const PURGE_CALLABLE_TIMEOUT_MS = 30000;

  // 2. Delete all user cloud records BEFORE calling deleteUser(auth.currentUser)
  if (isOnline && !isGuest) {
    try {
      const { deleteDoc } = await import("firebase/firestore");

      const deleteByQuery = async (colName: string, field: string) => {
        const PAGE_LIMIT = 250;
        const CHUNK_SIZE = 25;
        const MAX_PAGES = 20;
        for (let page = 0; page < MAX_PAGES; page++) {
          const q = query(collection(db, colName), where(field, "==", uid), limit(PAGE_LIMIT));
          const snap = await getDocs(q).catch((err) => {
            console.warn(`Cleanup query skipped for ${colName}.${field}:`, err);
            return null;
          });
          if (!snap || snap.empty) break;
          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
            const chunk = docs.slice(i, i + CHUNK_SIZE);
            await Promise.allSettled(
              chunk.map((d) =>
                deleteDoc(doc(db, colName, d.id)).catch((delErr) => {
                  console.warn(`Cleanup delete warning for ${colName}/${d.id}:`, delErr);
                })
              )
            );
          }
          if (docs.length < PAGE_LIMIT) break;
        }
      };

      await withTimeout(
        (async () => {
          await Promise.allSettled([
            deleteByQuery("sessions", "userId"),
            deleteByQuery("calendar_events", "createdByUid"),
            deleteByQuery("macrocycles", "coachId"),
            deleteByQuery("coach_records", "coachId"),
            deleteByQuery("coach_records", "athleteUid"),
            deleteByQuery("star_history", "userId"),
            deleteByQuery("coach_notifications", "athleteUid"),
            deleteByQuery("coach_notifications", "coachUid"),
            deleteByQuery("duel_invitations", "senderUid"),
            deleteByQuery("duel_invitations", "receiverUid"),
            deleteByQuery("active_duels", "creatorUid"),
            deleteByQuery("active_duels", "playerUid"),
            deleteByQuery("watch_sessions", "userId"),
            /^[0-9]{6}$/.test(savedPairingCode)
              ? deleteDoc(doc(db, "watch_pairings", savedPairingCode)).catch(() => {})
              : Promise.resolve(),
            /^[0-9]{6}$/.test(savedPairingCode)
              ? deleteDoc(doc(db, "watch_sessions", savedPairingCode)).catch(() => {})
              : Promise.resolve(),
            /^[A-Za-z0-9_-]{32,64}$/.test(savedSessionToken)
              ? deleteDoc(doc(db, "watch_sessions", savedSessionToken)).catch(() => {})
              : Promise.resolve(),
            targetProfile?.clubInviteCode && /^[0-9]{6}$/.test(targetProfile.clubInviteCode.trim())
              ? deleteDoc(doc(db, "coach_invite_codes", targetProfile.clubInviteCode.trim())).catch(() => {})
              : Promise.resolve(),
            deleteDoc(doc(db, "athlete_stars", uid)).catch(() => {})
          ]);

          // Delete users_public/{uid} and invoke server-side recursive purge callable (`purgeDeletedUserAccount`) before deleting users/{uid}
          await deleteDoc(doc(db, "users_public", uid)).catch((pubErr) => {
            console.warn("Cleanup warning for users_public:", pubErr);
          });
          try {
            const { getFunctions, httpsCallable } = await import("firebase/functions");
            const { app } = await import("./firebase");
            const purgeFn = httpsCallable(getFunctions(app), "purgeDeletedUserAccount", {
              timeout: PURGE_CALLABLE_TIMEOUT_MS
            });
            await withTimeout(purgeFn({ uid, deleteAuth: false }), PURGE_CALLABLE_TIMEOUT_MS);
          } catch (purgeErr) {
            if (!isFunctionsCallableUnavailable(purgeErr)) {
              console.warn("purgeDeletedUserAccount callable warning:", purgeErr);
            }
          }
          await deleteDoc(doc(db, "users", uid)).catch((userErr) => {
            console.warn("Cleanup warning for users doc:", userErr);
          });
        })(),
        DELETE_BATCH_TIMEOUT_MS
      );
    } catch (err) {
      // Never push DELETE users/{uid} to syncQueue right before deleteUser(auth.currentUser) when online
      console.warn("Direct Firestore cleanup timed out:", err);
    }

    // Purge any pending syncQueue items for this uid (e.g. from leaveCurrentClub) before destroying auth session
    try {
      const { getSyncQueue, removeFromSyncQueue } = await import("./db/indexedDB");
      const queue = await getSyncQueue();
      await Promise.allSettled(
        queue
          .filter(
            (item) =>
              item.payloadId === uid ||
              item.payload?.uid === uid ||
              item.payload?.userId === uid ||
              item.payload?.createdByUid === uid ||
              item.payload?.coachId === uid
          )
          .map((item) => removeFromSyncQueue(item.id))
      );
    } catch {}

    // 3. Delete Firebase Authentication user record
    try {
      if (auth.currentUser && auth.currentUser.uid === uid) {
        await withTimeout(deleteUser(auth.currentUser), DELETE_BATCH_TIMEOUT_MS);
      }
    } catch (authDelErr: any) {
      if (authDelErr?.code === "auth/requires-recent-login") {
        throw new Error(translateFirebaseAuthError(authDelErr));
      }
      console.warn("Firebase Auth user delete warning:", authDelErr);
    }
  } else if (!isGuest) {
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "DELETE",
      payloadId: uid,
      payload: { uid },
      timestamp: Date.now()
    });
  }

  // 4. Remove user from local simulated_users list and delete local sessions, stars, star_history, events & macrocycles
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const filteredUsers = usersList.filter((u) => u.uid !== uid).map(sanitizeUserProfile);
  await saveLocalSetting("simulated_users", filteredUsers);

  try {
    const {
      deleteLocalSession,
      athleteStarsStore,
      starHistoryStore,
      calendarStore,
      macrocyclesStore
    } = await import("./db/indexedDB");

    const localSessions = await getLocalSessions();
    const ownLocalSessions = localSessions.filter((sess) => sess.userId === uid || sess.userUid === uid);
    await Promise.allSettled(
      ownLocalSessions.map(async (sess) => {
        await deleteLocalSession(sess.id);
        if (!isOnline && !isGuest) {
          await addToSyncQueue({
            id: generateResilientId("TXN"),
            collection: "sessions",
            operation: "DELETE",
            payloadId: sess.id,
            payload: { id: sess.id },
            timestamp: Date.now()
          });
        }
      })
    );

    await athleteStarsStore.removeItem(uid);

    const starHistoryKeysToDelete: string[] = [];
    await starHistoryStore.iterate((val: any, key: string) => {
      if (val?.userId === uid) {
        starHistoryKeysToDelete.push(key);
      }
    });
    await Promise.allSettled(starHistoryKeysToDelete.map((k) => starHistoryStore.removeItem(k)));

    const eventKeysToDelete: string[] = [];
    await calendarStore.iterate((val: any, key: string) => {
      if (val?.createdByUid === uid) {
        eventKeysToDelete.push(key);
      }
    });
    await Promise.allSettled(eventKeysToDelete.map((k) => calendarStore.removeItem(k)));

    const macroKeysToDelete: string[] = [];
    await macrocyclesStore.iterate((val: any, key: string) => {
      if (val?.coachId === uid) {
        macroKeysToDelete.push(key);
      }
    });
    await Promise.allSettled(macroKeysToDelete.map((k) => macrocyclesStore.removeItem(k)));
  } catch (err) {
    console.warn("Error cleaning local stores during account deletion:", err);
  }

  // 5. Clear active session
  await saveLocalSetting("current_user", null);
}

export function isSuperAdmin(user: UserProfile | null): boolean {
  return user?.role === "superadmin";
}

// De-duplicates concurrent social logins for the same Firebase UID (redirect handler + onAuthStateChanged race)
const inFlightSocialLogins = new Map<string, Promise<UserProfile>>();

export async function loginSocialUser(email: string, displayName: string, explicitUid?: string): Promise<UserProfile> {
  const key = explicitUid || auth.currentUser?.uid || email.trim().toLowerCase();
  const pending = inFlightSocialLogins.get(key);
  if (pending) return pending;
  const task = loginSocialUserInternal(email, displayName, explicitUid).finally(() => {
    inFlightSocialLogins.delete(key);
  });
  inFlightSocialLogins.set(key, task);
  return task;
}

async function loginSocialUserInternal(email: string, displayName: string, explicitUid?: string): Promise<UserProfile> {
  const targetEmail = email.trim().toLowerCase();
  const authUid = explicitUid || auth.currentUser?.uid || "";
  const isAdminEmail = isVerifiedSuperAdminForUid(targetEmail, authUid);
  if (!authUid) {
    // Never fabricate a local-only UID: without a real Firebase Auth session every cloud write is rejected
    throw new Error(
      txAuth(
        "No se pudo verificar tu cuenta de Google. Intenta iniciar sesión de nuevo.",
        "Could not verify your Google account. Please try signing in again."
      )
    );
  }
  let user: UserProfile | undefined = undefined;
  let needsCloudWrite = false;
  let cloudFetchFailed = false;
  const isOnline = typeof navigator === "undefined" || navigator.onLine;

  const cleanDisplay = (displayName || targetEmail.split("@")[0] || "Arquero").trim();
  const autoNickname = isAdminEmail
    ? "admin"
    : cleanDisplay.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";

  // 1. Try to fetch from Firestore if online
  if (isOnline && authUid) {
    try {
      const directSnap = await withTimeout(getDoc(doc(db, "users", authUid)), LOGIN_TIMEOUT_MS);
      if (directSnap.exists()) {
        user = sanitizeUserProfile({ ...directSnap.data(), uid: authUid });
      } else {
        const q = query(collection(db, "users"), where("email", "==", targetEmail), limit(5));
        const querySnapshot = await withTimeout(getDocs(q), LOGIN_TIMEOUT_MS);
        if (!querySnapshot.empty) {
          // Legacy account with the same email but a different UID: adopt its data under the real Auth UID
          // and persist users/{authUid} right away so future logins resolve directly (no duplicate lookups).
          user = sanitizeUserProfile({
            ...querySnapshot.docs[0].data(),
            uid: authUid,
            email: targetEmail
          });
          needsCloudWrite = true;
        }
      }

      if (user) {
        const localUsers = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
        const currentCached = await getLocalSetting<UserProfile | null>("current_user", null);
        const fromList = localUsers.find(
          (u) => u.uid === user!.uid || (u.email || "").toLowerCase() === targetEmail
        );
        const localCandidate =
          currentCached &&
          (currentCached.uid === user.uid || (currentCached.email || "").toLowerCase() === targetEmail) &&
          Number(currentCached.updatedAt || 0) >= Number(fromList?.updatedAt || 0)
            ? sanitizeUserProfile({ ...currentCached, uid: authUid })
            : fromList
            ? sanitizeUserProfile({ ...fromList, uid: authUid })
            : null;

        if (localCandidate) {
          const { merged, localHadMissingCloudFields } = mergeUserProfilesNonDestructive(localCandidate, {
            ...user,
            uid: authUid
          });
          user = merged;
          if (localHadMissingCloudFields) {
            needsCloudWrite = true;
          }
        }

        if (!user.nickname?.trim()) {
          user.nickname = autoNickname;
        }
        if (!user.fullName?.trim()) {
          user.fullName = cleanDisplay;
        }
        if (isAdminEmail && user.role !== "superadmin") {
          user.role = "superadmin";
          user.plan = "PRO";
        }

        const idx = localUsers.findIndex((u) => u.uid === user!.uid);
        if (idx !== -1) {
          localUsers[idx] = user;
        } else {
          localUsers.push(user);
        }
        await saveLocalSetting("simulated_users", localUsers);
      }
    } catch (err) {
      cloudFetchFailed = true;
      console.warn("Firestore user fetch failed, falling back to local database:", err);
    }
  }

  // 2. Fallback to local IndexedDB store (`current_user` or `simulated_users`)
  if (!user) {
    const currentCached = await getLocalSetting<UserProfile | null>("current_user", null);
    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
    const fromList = usersList.find((u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail);
    const cached =
      currentCached &&
      (currentCached.uid === authUid || (currentCached.email || "").toLowerCase() === targetEmail) &&
      Number(currentCached.updatedAt || 0) >= Number(fromList?.updatedAt || 0)
        ? currentCached
        : fromList || undefined;

    if (cached) {
      user = sanitizeUserProfile({
        ...cached,
        uid: authUid || cached.uid,
        nickname: cached.nickname?.trim() || autoNickname,
        fullName: cached.fullName?.trim() || cleanDisplay,
        role: isAdminEmail ? "superadmin" : cached.role,
        plan: isAdminEmail ? "PRO" : cached.plan
      });
      // Only queue a cloud write if Firestore fetch succeeded and confirmed no remote document existed.
      // Never overwrite cloud with stale local cache during a network timeout (Fixes A6).
      if (isOnline && !cloudFetchFailed) {
        needsCloudWrite = true;
      }
    }
  }

  // Never fabricate a blank profile when cloud fetch failed or device is offline (Fixes C3)
  if (!user && (cloudFetchFailed || !isOnline)) {
    throw new Error(
      txAuth(
        "Conexión inestable al cargar tu perfil. Verifica tu señal e inténtalo de nuevo.",
        "Unstable connection while loading your profile. Check your signal and try again."
      )
    );
  }

  // 3. Create default profile ONLY when Firestore fetch succeeded and confirmed user doesn't exist anywhere.
  // No fictitious equipment/body data: blank values, ProfileCompletionModal asks the real data once.
  if (!cloudFetchFailed && !user) {
    user = {
      uid: authUid,
      email: targetEmail,
      fullName: cleanDisplay,
      nickname: autoNickname,
      birthDate: isAdminEmail ? "1995-05-15" : "",
      country: isAdminEmail ? "CR" : "",
      city: "",
      gender: (isAdminEmail ? "M" : "") as any,
      bowConfig: {
        type: "Recurve",
        brand: "",
        model: "",
        poundage: 0,
        defaultDistance: 18
      },
      physicalData: {
        height: 0,
        weight: 0,
        dominantEye: "R",
        dominantHand: "R"
      },
      clubId: null,
      clubName: null,
      role: isAdminEmail ? "superadmin" : "archer",
      plan: isAdminEmail ? "PRO" : "FREE",
      isClubCreator: false,
      profileSetupCompleted: isAdminEmail,
      createdAt: Date.now()
    };

    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", []))
      .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
      .map(sanitizeUserProfile);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);
    // Always persist the new account in the cloud (even before the profile is completed),
    // otherwise an athlete who closes the app early is invisible to the Coach / invite code.
    needsCloudWrite = true;
  }

  if (!user) {
    throw new Error(txAuth("No se encontró el perfil del usuario.", "User profile not found."));
  }

  if (isAdminEmail && user.role !== "superadmin") {
    user.role = "superadmin";
    user.plan = "PRO";
  }

  if (needsCloudWrite) {
    let wroteCloud = false;
    if (typeof navigator !== "undefined" && navigator.onLine) {
      wroteCloud = await cloudWriteUser(user);
    }
    if (!wroteCloud) {
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "INSERT",
        payloadId: user.uid,
        payload: user,
        timestamp: Date.now()
      });
    }
  }

  await migrateOfflineGuestData(user.uid);
  await saveLocalSetting("current_user", user);
  return user;
}

const GOOGLE_WEB_CLIENT_ID = "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";
const FIREBASE_AUTH_HANDLER_URI = "https://archery101010-c0bb4.firebaseapp.com/__/auth/handler";
const OAUTH_NONCE_KEY = "archery_google_oauth_nonce";
const NATIVE_SIGNIN_TIMEOUT_MS = 120000;

/** Cryptographically random nonce, persisted so the returning id_token can be verified (anti token-injection). */
function createAndStoreOAuthNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(OAUTH_NONCE_KEY, JSON.stringify({ nonce, ts: Date.now() }));
  } catch {}
  return nonce;
}

/** Validates that the id_token was issued for OUR client and carries the nonce we generated (single use, 10 min TTL). */
function verifyGoogleIdTokenNonce(idToken: string): boolean {
  let stored: { nonce: string; ts: number } | null = null;
  try {
    const raw = localStorage.getItem(OAUTH_NONCE_KEY);
    localStorage.removeItem(OAUTH_NONCE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!stored || !stored.nonce || Date.now() - stored.ts > 10 * 60 * 1000) return false;
  try {
    const part = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(decodeURIComponent(escape(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")))));
    return claims.nonce === stored.nonce && claims.aud === GOOGLE_WEB_CLIENT_ID;
  } catch {
    return false;
  }
}

/** Real Google email is mandatory: never fabricate synthetic addresses. */
function requireRealEmail(...candidates: (string | null | undefined)[]): string {
  const found = candidates.find((c) => typeof c === "string" && c.includes("@"));
  if (!found) {
    throw new Error(
      txAuth(
        "Google no compartió tu correo. Vuelve a intentarlo y acepta el permiso de correo electrónico.",
        "Google did not share your email address. Please try again and allow email access."
      )
    );
  }
  return found;
}

export async function processSocialRedirectResult(): Promise<UserProfile | null> {
  if (typeof window === "undefined") return null;
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const isMockFirebase =
    (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) &&
    isLocalhost;
  if (isMockFirebase) return null;

  try {
    // 1. Check direct Google OAuth token in URL hash/query (intercepted by Android MainActivity WebViewClient)
    const rawHash = window.location.hash ? window.location.hash.substring(1) : "";
    const rawSearch = window.location.search ? window.location.search.substring(1) : "";
    const hashParams = new URLSearchParams(rawHash);
    const searchParams = new URLSearchParams(rawSearch);

    const idToken = hashParams.get("id_token") || searchParams.get("id_token");
    const oauthError = hashParams.get("error") || searchParams.get("error");

    if (idToken || oauthError) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    if (oauthError) {
      console.warn("OAuth retornó error:", oauthError);
      return null;
    }

    if (idToken) {
      if (!verifyGoogleIdTokenNonce(idToken)) {
        console.warn("id_token rechazado: nonce/audiencia no coinciden con una solicitud iniciada en este dispositivo.");
        return null;
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      const u = result.user;
      const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
      const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";
      return await loginSocialUser(email, displayName, u.uid);
    }

    // 2. Standard Firebase Redirect Result fallback
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      const u = result.user;
      const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
      const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";
      return await loginSocialUser(email, displayName, u.uid);
    }

    if (
      auth.currentUser &&
      auth.currentUser.providerData.some((p) => p.providerId === "google.com" || p.providerId === "apple.com")
    ) {
      const u = auth.currentUser;
      const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
      const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";
      return await loginSocialUser(email, displayName, u.uid);
    }
  } catch (err) {
    console.error("Error procesando redirección social:", err);
  }
  return null;
}

export async function authenticateWithSocialProvider(
  providerName: "google" | "apple" = "google"
): Promise<UserProfile | null> {
  const isCapacitorNative =
    typeof window !== "undefined" &&
    (!!(window as any).Capacitor?.isNativePlatform?.() ||
      !!(window as any).ArcheryNativeAuth);

  const activeLang = resolveActiveAuthLanguage();
  auth.languageCode = activeLang;

  // Apple Sign-In (Apple App Store Guideline 4.8 compliance)
  if (providerName === "apple") {
    const appleProvider = new OAuthProvider("apple.com");
    appleProvider.addScope("email");
    appleProvider.addScope("name");
    appleProvider.setCustomParameters({ locale: activeLang });

    try {
      const result = await signInWithPopup(auth, appleProvider);
      const u = result.user;
      const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
      const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";
      return await loginSocialUser(email, displayName, u.uid);
    } catch (appleErr: any) {
      if (appleErr?.code === "auth/popup-blocked" || isCapacitorNative) {
        await signInWithRedirect(auth, appleProvider);
        return null;
      }
      throw new Error(translateFirebaseAuthError(appleErr));
    }
  }

  // Inside native Android APK: use Native Android Google Account Picker (1-tap system bottom sheet, zero typing)
  if (isCapacitorNative && providerName === "google") {
    const nativeAuth = typeof window !== "undefined" ? (window as any).ArcheryNativeAuth : null;
    if (nativeAuth && typeof nativeAuth.startGoogleSignIn === "function") {
      const payload: {
        success: boolean;
        idToken?: string;
        email?: string;
        displayName?: string;
        googleId?: string;
        statusCode?: number;
        error?: string;
      } = await new Promise((resolve) => {
        // Never hang forever: if the native picker never answers, resolve with a timeout status
        const timer = setTimeout(() => {
          delete (window as any).__onNativeGoogleSignIn;
          resolve({ success: false, statusCode: -2, error: "timeout" });
        }, NATIVE_SIGNIN_TIMEOUT_MS);
        (window as any).__onNativeGoogleSignIn = (res: any) => {
          clearTimeout(timer);
          delete (window as any).__onNativeGoogleSignIn;
          resolve(res);
        };
        nativeAuth.startGoogleSignIn();
      });

      if (!payload || !payload.success) {
        if (payload?.statusCode === 12501 || payload?.statusCode === 16) {
          throw new Error(txAuth("Inicio de sesión cancelado.", "Sign-in cancelled."));
        }
        if (payload?.statusCode === -2) {
          throw new Error(
            txAuth(
              "Google tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.",
              "Google took too long to respond. Check your connection and try again."
            )
          );
        }
        // If native Play Services GoogleSignIn fails with statusCode 10 (e.g., Play App Signing SHA-1 mismatch) or 12500,
        // seamlessly fall through to the Web OAuth 2.0 id_token flow (which uses GOOGLE_WEB_CLIENT_ID and never checks SHA-1)
        console.warn("Native GoogleSignIn fallback to Web OAuth 2.0 id_token flow:", payload?.error || payload?.statusCode);
      } else {
        if (payload.idToken) {
          try {
            const credential = GoogleAuthProvider.credential(payload.idToken);
            const result = await signInWithCredential(auth, credential);
            const u = result.user;
            const email = requireRealEmail(payload.email, u.email, u.providerData?.find((p) => p.email)?.email);
            const displayName =
              payload.displayName || u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";
            return await loginSocialUser(email, displayName, u.uid);
          } catch (credErr: any) {
            if (
              (typeof navigator !== "undefined" && !navigator.onLine) ||
              credErr?.code === "auth/network-request-failed"
            ) {
              throw new Error(translateFirebaseAuthError(credErr));
            }
            console.warn("signInWithCredential warning, falling back to Web OAuth 2.0 id_token flow:", credErr);
          }
        }
      }
    }

    const nonce = createAndStoreOAuthNonce();
    const oauthUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(GOOGLE_WEB_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(FIREBASE_AUTH_HANDLER_URI)}` +
      `&response_type=id_token` +
      `&scope=${encodeURIComponent("openid email profile")}` +
      `&nonce=${encodeURIComponent(nonce)}` +
      `&hl=${encodeURIComponent(activeLang)}` +
      `&prompt=select_account`;
    window.location.assign(oauthUrl);
    return null;
  }

  const googleProvider = new GoogleAuthProvider();
  googleProvider.addScope("email");
  googleProvider.addScope("profile");
  googleProvider.setCustomParameters({ prompt: "select_account", hl: activeLang });

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;
    const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
    const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";

    return await loginSocialUser(email, displayName, u.uid);
  } catch (popupErr: any) {
    if (popupErr?.code === "auth/popup-blocked") {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw new Error(translateFirebaseAuthError(popupErr));
  }
}

export async function loginGuestOffline(): Promise<UserProfile> {
  const guest: UserProfile = {
    uid: "USR-GUEST-OFFLINE",
    email: "invitado@archery101010.com",
    fullName: "Invitado Offline",
    nickname: "invitado",
    birthDate: "1995-05-15",
    country: "CR",
    city: "San José",
    gender: "M",
    bowConfig: {
      type: "Barebow",
      brand: "",
      model: "",
      poundage: 35,
      defaultDistance: 18
    },
    physicalData: {
      height: 175,
      weight: 70,
      dominantEye: "R",
      dominantHand: "R"
    },
    clubId: null,
    clubName: null,
    role: "archer",
    plan: "FREE",
    isClubCreator: false,
    profileSetupCompleted: false
  };

  await saveLocalSetting("current_user", guest);
  return guest;
}

export async function migrateOfflineGuestData(newUid: string): Promise<void> {
  try {
    const localSessions = await getLocalSessions();
    const guestSessions = localSessions.filter(
      (s) => s.userId === "USR-GUEST-OFFLINE" || s.userUid === "USR-GUEST-OFFLINE"
    );

    for (const session of guestSessions) {
      const updatedSession = { ...session, userId: newUid };
      delete updatedSession.userUid;
      await saveLocalSession(session.id, updatedSession);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "sessions",
        operation: "INSERT",
        payloadId: session.id,
        payload: updatedSession,
        timestamp: Date.now()
      });
    }
  } catch (err) {
    console.error("Error migrating guest offline data:", err);
  }
}

/**
 * Joins an existing club using the Coach's invite code or club ID.
 */
export async function joinClubByInviteCode(
  userUid: string,
  inviteCode: string
): Promise<{ success: boolean; clubName?: string | null; user?: UserProfile; error?: string }> {
  const cleanCode = (inviteCode || "").trim().toUpperCase();
  if (!/^\d{6}$/.test(cleanCode)) {
    return {
      success: false,
      error: txAuth("El código de club debe tener 6 dígitos.", "The club code must be 6 digits.")
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      success: false,
      error: txAuth(
        "Necesitas conexión a internet para vincularte con tu Coach.",
        "An internet connection is required to link with your Coach."
      )
    };
  }

  if (!auth.currentUser || auth.currentUser.uid !== userUid) {
    return {
      success: false,
      error: txAuth(
        "Tu sesión expiró. Cierra sesión y vuelve a ingresar para vincularte con tu Coach.",
        "Your session has expired. Please sign out and sign in again to link with your Coach."
      )
    };
  }

  const currentLogged = await getLoggedUser();
  if (currentLogged && (currentLogged.clubInviteCode || "").trim().toUpperCase() === cleanCode) {
    return {
      success: false,
      error: txAuth(
        "Este es tu propio código de Coach. Ingresa el código de 6 dígitos de tu entrenador.",
        "This is your own Coach code. Enter your Coach's 6-digit invite code."
      )
    };
  }

  // 1. Resolve the real Coach that owns this code (cloud first, never the athlete himself)
  const clubCoach = await findClubOwnerByInviteCode(cleanCode, userUid);

  if (!clubCoach) {
    return {
      success: false,
      error: txAuth(
        "Código no encontrado. Pide a tu Coach que abra su Portal Coach para activar su código y vuelve a intentarlo.",
        "Code not found. Ask your Coach to open their Coach Portal to activate their code and try again."
      )
    };
  }

  if (clubCoach.uid === userUid) {
    return {
      success: false,
      error: txAuth(
        "Este es tu propio código de Coach. Compártelo con tus alumnos.",
        "This is your own Coach code. Share it with your athletes."
      )
    };
  }

  // 2. Canonical coach clubId + explicit coachId/coachName/coachEmail so the link is unambiguous.
  const resolvedClubId = getCanonicalCoachClubId(clubCoach);

  // Cache coach locally so ProfileView immediately shows coach info
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const coachIdx = usersList.findIndex((u) => u.uid === clubCoach.uid);
  const coachRecord = sanitizeUserProfile({
    ...clubCoach,
    clubId: resolvedClubId,
    isClubCreator: true
  });
  if (coachIdx === -1) {
    usersList.push(coachRecord);
  } else {
    usersList[coachIdx] = coachRecord;
  }
  await saveLocalSetting("simulated_users", usersList);

  // Clear athlete from unlinked_athletes list if previously unlinked
  for (const cid of new Set([resolvedClubId, clubCoach.clubId || "", "CLB-" + clubCoach.uid.replace("USR-", "")])) {
    if (!cid) continue;
    const unlinkedKey = `unlinked_athletes_${cid}`;
    const prevUnlinked = await getLocalSetting<string[]>(unlinkedKey, []);
    if (prevUnlinked.includes(userUid)) {
      await saveLocalSetting(
        unlinkedKey,
        prevUnlinked.filter((id) => id !== userUid)
      );
    }
  }

  // 3. Link the athlete to the Coach and reset any accidental self-coach flags
  const preservedRole: UserProfile["role"] =
    currentLogged?.role === "superadmin" || isVerifiedSuperAdminForUid(currentLogged?.email, userUid)
      ? "superadmin"
      : "archer";
  const hasValidPro =
    preservedRole === "superadmin" ||
    (currentLogged?.plan === "PRO" &&
      typeof currentLogged?.proExpiresAt === "number" &&
      currentLogged.proExpiresAt > Date.now());

  const updates: Partial<UserProfile> = {
    role: preservedRole,
    plan: hasValidPro ? "PRO" : "FREE",
    proExpiresAt: hasValidPro ? currentLogged?.proExpiresAt : 0,
    isClubCreator: false,
    clubId: resolvedClubId,
    coachId: clubCoach.uid,
    coachName: clubCoach.fullName || "Entrenador",
    coachEmail: clubCoach.email || "",
    clubInviteCode: "",
    joinedWithInviteCode: cleanCode
  };

  const updated = await updateProfile(userUid, updates);

  // 4. Confirm the link reached the cloud right away (so the Coach sees the athlete immediately)
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const confirmTs = Date.now();
      await withTimeout(
        setDoc(
          doc(db, "users", userUid),
          sanitizeUserProfile({ ...updated, uid: userUid, updatedAt: confirmTs }),
          { merge: true }
        ),
        8000
      );
      lastFullUserSetDocTs.set(userUid, confirmTs);
      try {
        const queue = await getSyncQueue();
        await Promise.allSettled(
          queue
            .filter(
              (item) =>
                item.collection === "users" &&
                item.payloadId === userUid &&
                item.operation !== "DELETE"
            )
            .map((item) => removeFromSyncQueue(item.id))
        );
      } catch {}
    } catch (err: any) {
      const errCode = String(err?.code || "");
      const errMsg = String(err?.message || "");
      if (
        errCode.includes("permission-denied") ||
        errCode.includes("invalid-argument") ||
        errMsg.includes("Missing or insufficient permissions") ||
        errMsg.includes("invalid-argument")
      ) {
        if (currentLogged && currentLogged.uid === userUid) {
          const restored = sanitizeUserProfile({ ...currentLogged, updatedAt: Date.now() });
          markLocalUserWrite(userUid, restored.updatedAt!);
          await saveLocalSetting("current_user", restored);
          const latestList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(
            sanitizeUserProfile
          );
          const uIdx = latestList.findIndex((u) => u.uid === userUid);
          if (uIdx !== -1) {
            latestList[uIdx] = restored;
            await saveLocalSetting("simulated_users", latestList);
          }
        }
        try {
          const queue = await getSyncQueue();
          await Promise.allSettled(
            queue
              .filter(
                (item) =>
                  item.collection === "users" &&
                  item.payloadId === userUid &&
                  item.operation !== "DELETE"
              )
              .map((item) => removeFromSyncQueue(item.id))
          );
        } catch {}
        return {
          success: false,
          error: txAuth(
            "No se pudo confirmar la vinculación en el servidor. Pide a tu Coach abrir su perfil para sincronizar su código e inténtalo de nuevo.",
            "Could not confirm linking on the server. Ask your Coach to open their profile to sync their code and try again."
          )
        };
      }
      console.warn("Link saved locally; cloud confirmation pending in sync queue:", err?.message || err);
    }
  }

  // 5. Emit real-time Coach linking notification so the Coach is alerted immediately
  emitCoachLinkNotification(clubCoach, updated, "athlete_linked").catch(() => {});

  // 6. Re-tag the athlete's existing sessions with the new clubId so the Coach receives their history
  try {
    const localSessions = await getLocalSessions();
    for (const s of localSessions) {
      if ((s.userId === userUid || s.userUid === userUid) && !s.isDraft && s.clubId !== resolvedClubId) {
        const retagged = { ...s, clubId: resolvedClubId, updatedAt: Date.now() };
        await saveLocalSession(s.id, retagged);
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "UPDATE",
          payloadId: s.id,
          payload: retagged,
          timestamp: Date.now()
        });
      }
    }
    if (typeof navigator === "undefined" || navigator.onLine) {
      const snapSess = await withTimeout(
        getDocs(query(collection(db, "sessions"), where("userId", "==", userUid), limit(250))),
        6000
      ).catch(() => null);
      if (snapSess) {
        for (const d of snapSess.docs) {
          const data = d.data();
          if (data && !data.isDraft && data.clubId !== resolvedClubId) {
            await setDoc(doc(db, "sessions", d.id), { clubId: resolvedClubId, updatedAt: Date.now() }, { merge: true }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not re-tag athlete sessions with clubId:", err);
  }

  return { success: true, clubName: clubCoach.fullName, user: updated };
}

/**
 * Unlinks from the current Coach without modifying the archer's optional clubName.
 * If called by a Coach switching back to Athlete mode ("Volver a modo Atleta"),
 * cleanly unlinks all their students first (in Firestore and locally) before resetting role to "archer".
 */
export async function leaveCurrentClub(userUid: string): Promise<{ success: boolean; user?: UserProfile }> {
  const currentLogged = await getLoggedUser();
  const now = Date.now();
  const isOnline = typeof navigator === "undefined" || navigator.onLine;
  const wasCoachOwner = Boolean(
    currentLogged &&
      !isLinkedToExternalCoach(currentLogged) &&
      (currentLogged.role === "coach" ||
        currentLogged.role === "team_admin" ||
        currentLogged.role === "team_admin_coach" ||
        currentLogged.isClubCreator)
  );
  const externalCoachUid = currentLogged ? getExternalCoachUid(currentLogged) : null;

  if (wasCoachOwner && userUid && userUid !== "USR-GUEST-OFFLINE") {
    const canonicalClubId = getCanonicalCoachClubId({ uid: userUid });
    const ownedClubIds = new Set<string>(
      [canonicalClubId, currentLogged?.clubId || "", `CLB-${userUid}`].filter(Boolean)
    );
    const coachInviteCode = (currentLogged?.clubInviteCode || "").trim().toUpperCase();

    const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const studentUids = new Set<string>();

    for (const u of localUsers) {
      if (!u?.uid || u.uid === userUid) continue;
      if (
        u.coachId === userUid ||
        (u.clubId && ownedClubIds.has(u.clubId)) ||
        (coachInviteCode && (u.clubInviteCode || "").trim().toUpperCase() === coachInviteCode)
      ) {
        studentUids.add(u.uid);
      }
    }

    // Unlink students in Firestore FIRST while the caller still holds Coach permissions in Firestore rules
    if (isOnline && auth.currentUser && auth.currentUser.uid === userUid) {
      if (/^\d{6}$/.test(coachInviteCode)) {
        await deleteDoc(doc(db, "coach_invite_codes", coachInviteCode)).catch(() => {});
      }
      try {
        const { updateDoc } = await import("firebase/firestore");
        await withTimeout(
          (async () => {
            const [byCoachSnap, byClubSnap] = await Promise.all([
              getDocs(query(collection(db, "users"), where("coachId", "==", userUid), limit(250))).catch(() => null),
              getDocs(query(collection(db, "users"), where("clubId", "==", canonicalClubId), limit(250))).catch(() => null)
            ]);
            byCoachSnap?.forEach((d) => {
              const id = (d.data() as any)?.uid || d.id;
              if (id && id !== userUid) studentUids.add(id);
            });
            byClubSnap?.forEach((d) => {
              const id = (d.data() as any)?.uid || d.id;
              if (id && id !== userUid) studentUids.add(id);
            });

            if (studentUids.size > 0) {
              await Promise.allSettled(
                Array.from(studentUids).map((studentUid) =>
                  updateDoc(doc(db, "users", studentUid), {
                    clubId: null,
                    clubInviteCode: "",
                    joinedWithInviteCode: "",
                    coachId: null,
                    coachName: null,
                    coachEmail: null,
                    isClubCreator: false,
                    role: "archer",
                    updatedAt: now
                  })
                )
              );
              const clubSessSnap = await getDocs(
                query(collection(db, "sessions"), where("clubId", "==", canonicalClubId), limit(250))
              ).catch(() => null);
              if (clubSessSnap && !clubSessSnap.empty) {
                await Promise.allSettled(
                  clubSessSnap.docs
                    .filter((d) => {
                      const ownerUid = (d.data() as any)?.userId || (d.data() as any)?.userUid;
                      return ownerUid && studentUids.has(ownerUid);
                    })
                    .map((d) =>
                      updateDoc(doc(db, "sessions", d.id), {
                        clubId: null,
                        updatedAt: now
                      })
                    )
                );
              }
            }
          })(),
          10000
        );
      } catch (err) {
        console.warn("Could not unlink all students in cloud before switching to athlete mode:", err);
      }
    }

    if (studentUids.size > 0) {
      const updatedLocalUsers = localUsers.map((u) => {
        if (u?.uid && studentUids.has(u.uid)) {
          return sanitizeUserProfile({
            ...u,
            clubId: null,
            clubInviteCode: "",
            coachId: null,
            coachName: null,
            coachEmail: null,
            isClubCreator: false,
            role: u.role === "superadmin" ? "superadmin" : "archer",
            updatedAt: now
          });
        }
        return sanitizeUserProfile(u);
      });
      await saveLocalSetting("simulated_users", updatedLocalUsers);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("local-db-change", { detail: { store: "simulated_users" } }));
        window.dispatchEvent(new CustomEvent("users-roster-updated"));
      }
    }
  }

  // Clean ex-coach macrocycles locally when an athlete unlinks (Fixes M9)
  if (!wasCoachOwner && userUid && userUid !== "USR-GUEST-OFFLINE") {
    try {
      const macroKeysToRemove: string[] = [];
      await macrocyclesStore.iterate((val: any, key: string) => {
        if (val?.coachId && val.coachId !== userUid) {
          macroKeysToRemove.push(key);
        }
      });
      if (macroKeysToRemove.length > 0) {
        await Promise.allSettled(macroKeysToRemove.map((k) => macrocyclesStore.removeItem(k)));
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("local-db-change", { detail: { store: "macrocycles_local" } })
          );
        }
      }
    } catch (macroErr) {
      console.warn("Could not clean ex-coach macrocycles locally:", macroErr);
    }
  }

  // Detach athlete's own completed sessions from the ex-coach's clubId so private history is no longer shared
  if (userUid && userUid !== "USR-GUEST-OFFLINE") {
    try {
      const localSessions = await getLocalSessions();
      for (const s of localSessions) {
        if ((s.userId === userUid || s.userUid === userUid) && s.clubId) {
          const detached = { ...s, clubId: null, updatedAt: now };
          await saveLocalSession(s.id, detached);
          if (!s.isDraft) {
            await addToSyncQueue({
              id: generateResilientId("TXN"),
              collection: "sessions",
              operation: "UPDATE",
              payloadId: s.id,
              payload: detached,
              timestamp: now
            });
          }
        }
      }
      if (isOnline && auth.currentUser?.uid === userUid) {
        const { updateDoc } = await import("firebase/firestore");
        const ownSessSnap = await withTimeout(
          getDocs(query(collection(db, "sessions"), where("userId", "==", userUid), limit(250))),
          6000
        ).catch(() => null);
        if (ownSessSnap && !ownSessSnap.empty) {
          await Promise.allSettled(
            ownSessSnap.docs
              .filter((d) => Boolean(d.data()?.clubId))
              .map((d) => updateDoc(doc(db, "sessions", d.id), { clubId: null, updatedAt: now }))
          );
        }
      }
    } catch (sessErr) {
      console.warn("Could not detach clubId from unlinked athlete sessions:", sessErr);
    }
  }

  const preservedRole: UserProfile["role"] =
    currentLogged?.role === "superadmin" || isVerifiedSuperAdminForUid(currentLogged?.email, userUid)
      ? "superadmin"
      : "archer";
  const hasValidProOnLeave =
    preservedRole === "superadmin" ||
    (currentLogged?.plan === "PRO" &&
      typeof currentLogged?.proExpiresAt === "number" &&
      currentLogged.proExpiresAt > now);

  const updated = await updateProfile(userUid, {
    role: preservedRole,
    plan: hasValidProOnLeave ? "PRO" : "FREE",
    proExpiresAt: hasValidProOnLeave ? currentLogged?.proExpiresAt : 0,
    isClubCreator: false,
    clubId: null,
    coachId: null,
    coachName: null,
    coachEmail: null,
    clubInviteCode: "",
    joinedWithInviteCode: ""
  });

  if (externalCoachUid && externalCoachUid !== userUid) {
    emitCoachLinkNotification({ uid: externalCoachUid }, updated, "athlete_unlinked").catch(() => {});
  }

  return { success: true, user: updated };
}
