import { saveLocalSetting, getLocalSetting, generateResilientId, addToSyncQueue, getLocalSessions, saveLocalSession } from "./db/indexedDB";
import { auth, db } from "./firebase";
import { collection, doc, getDoc, setDoc, query, where, getDocs } from "firebase/firestore";
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
  whatsappNumber?: string;
  clubInviteCode?: string;
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

const LOGIN_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout de conexión a la nube")), timeoutMs)
    )
  ]);
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

    if (isLinkedToExternalCoach(copy)) {
      // Athlete is linked to another user's Coach account: never allow self-coach flags or own invite code
      copy.isClubCreator = false;
      copy.clubInviteCode = "";
      if (copy.role !== "superadmin" && !isSuperAdminEmail(copy.email)) {
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

/**
 * Fire-and-forget profile write to Firestore that can NEVER break the calling flow
 * (catches both async rejections and synchronous SDK throws).
 */
function cloudWriteUser(profile: UserProfile): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (!profile?.uid) return;
  try {
    withTimeout(setDoc(doc(db, "users", profile.uid), sanitizeUserProfile(profile), { merge: true }), LOGIN_TIMEOUT_MS).catch(
      (err) => console.warn("Cloud profile write deferred to sync queue:", err?.message || err)
    );
  } catch (err: any) {
    console.warn("Cloud profile write deferred to sync queue:", err?.message || err);
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
 * Finds the Coach / club owner that owns a 6-digit invite code.
 * Cloud (Firestore) is the source of truth; local cache is only an offline fallback.
 * Never returns the requesting athlete himself or an athlete linked to another coach.
 */
export async function findClubOwnerByInviteCode(rawCode: string, excludeUid?: string): Promise<UserProfile | null> {
  const cleanCode = (rawCode || "").trim().toUpperCase();
  if (!cleanCode) return null;

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const snap = await withTimeout(
        getDocs(query(collection(db, "users"), where("clubInviteCode", "==", cleanCode))),
        8000
      );
      const allMatches = snap.docs
        .map((d) => sanitizeUserProfile({ ...d.data(), uid: (d.data() as any).uid || d.id }))
        .filter((u) => (!excludeUid || u.uid !== excludeUid) && !isLinkedToExternalCoach(u));
      const owners = allMatches.filter((u) => isClubOwnerRole(u));
      if (owners.length > 0) {
        return owners.find((u) => u.isClubCreator) || owners[0];
      }
      if (allMatches.length > 0) {
        return allMatches[0];
      }
    } catch (err) {
      console.warn("Cloud lookup of invite code failed, trying local cache:", err);
    }
  }

  const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
  const localMatches = usersList.filter(
    (u) =>
      (!excludeUid || u.uid !== excludeUid) &&
      !isLinkedToExternalCoach(u) &&
      (u.clubInviteCode || "").trim().toUpperCase() === cleanCode
  );
  const localOwners = localMatches.filter((u) => isClubOwnerRole(u));
  return localOwners.find((u) => u.isClubCreator) || localOwners[0] || localMatches[0] || null;
}

export function translateFirebaseAuthError(err: any): string {
  const code = err?.code || "";
  if (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-login-credentials"
  ) {
    return "Correo o contraseña incorrectos. Si creaste tu cuenta con Google, usa el botón 'Iniciar con Google' o pulsa '¿Olvidaste tu contraseña?' para asignarle una clave.";
  }
  if (code === "auth/email-already-in-use") {
    return "Este correo electrónico ya está registrado. Por favor inicia sesión o recupera tu contraseña.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "Ya existe una cuenta con este correo vinculada a otro método de ingreso (Google o Correo). Inicia sesión con el método que usaste originalmente.";
  }
  if (code === "auth/weak-password") {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (code === "auth/invalid-email") {
    return "El formato del correo electrónico no es válido.";
  }
  if (code === "auth/user-disabled") {
    return "Esta cuenta ha sido deshabilitada temporalmente. Contacta al soporte de Archery 101010.";
  }
  if (code === "auth/too-many-requests") {
    return "Demasiados intentos fallidos. Por seguridad, espera unos minutos o restablece tu contraseña.";
  }
  if (code === "auth/network-request-failed") {
    return "Error de conexión. Verifica tu acceso a internet e inténtalo de nuevo.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Inicio de sesión cancelado.";
  }
  if (code === "auth/popup-blocked") {
    return "Las ventanas emergentes están bloqueadas en tu navegador. Permítelas o ingresa con tu correo y contraseña.";
  }
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
    return "Este método de inicio de sesión aún no está habilitado en el servidor. Por favor ingresa con tu correo y contraseña.";
  }
  if (code === "auth/requires-recent-login") {
    return "Por seguridad, cierra sesión y vuelve a ingresar antes de eliminar tu cuenta.";
  }
  return err?.message || "Error de autenticación.";
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

export async function getLoggedUser(): Promise<UserProfile | null> {
  const u = await getLocalSetting<UserProfile | null>("current_user", null);
  if (!u) return null;
  const sanitized = sanitizeUserProfile(u);
  if (isSuperAdminEmail(sanitized.email) && sanitized.role !== "superadmin") {
    sanitized.role = "superadmin";
    sanitized.plan = "PRO";
  }
  return sanitized;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error("Ingresa tu correo electrónico para enviarte el enlace de recuperación.");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    throw new Error("El formato del correo electrónico no es válido.");
  }
  try {
    auth.languageCode = "es";
    const continueUrl =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://archery101010-c0bb4.web.app";
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
  const isAdminEmail = isSuperAdminEmail(normalizedEmail);

  const targetEmail = normalizedEmail === "admin101010" ? "admin@archery101010.com" : normalizedEmail;

  if (!password) {
    throw new Error("Por favor ingresa tu contraseña.");
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
      throw new Error("Se requiere conexión a internet para verificar tus credenciales de inicio de sesión.");
    }
  }

  let user: UserProfile | undefined = undefined;

  // 2. Fetch user profile from Firestore by UID (or email fallback)
  if (isOnline && authUid) {
    try {
      const directSnap = await withTimeout(getDoc(doc(db, "users", authUid)), LOGIN_TIMEOUT_MS);
      if (directSnap.exists()) {
        user = sanitizeUserProfile(directSnap.data());
      } else {
        const q = query(collection(db, "users"), where("email", "==", targetEmail));
        const querySnapshot = await withTimeout(getDocs(q), LOGIN_TIMEOUT_MS);
        if (!querySnapshot.empty) {
          // Legacy account with the same email but a different UID: adopt its data under the real Auth UID
          // and persist users/{authUid} right away so future logins resolve directly (no duplicate lookups).
          user = sanitizeUserProfile({
            ...querySnapshot.docs[0].data(),
            uid: authUid,
            email: targetEmail
          });
          cloudWriteUser(user);
        }
      }

      if (user) {
        const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const localUser = localUsers.find(
          (u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail
        );
        if (localUser && isProfileValid(localUser) && !isProfileValid(user)) {
          user = sanitizeUserProfile({ ...user, ...localUser, uid: authUid, profileSetupCompleted: true });
        }
        const cleanedList = localUsers
          .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
          .map(sanitizeUserProfile);
        cleanedList.push(user);
        await saveLocalSetting("simulated_users", cleanedList);
      }
    } catch (err) {
      console.warn("Firestore user fetch timed out or failed, falling back to local cache:", err);
    }
  }

  // 3. Fallback to local IndexedDB cache if Firestore had no document yet
  if (!user) {
    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const cached = usersList.find(
      (u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail
    );
    if (cached) {
      user = sanitizeUserProfile({ ...cached, uid: authUid || cached.uid });
    }
  }

  // 4. If authenticated in Firebase Auth but profile doc doesn't exist yet, initialize it
  if (!user && authUid) {
    const autoNickname = isAdminEmail
      ? "admin"
      : targetEmail.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";
    user = {
      uid: authUid,
      email: targetEmail,
      fullName: auth.currentUser?.displayName || (isAdminEmail ? "Admin101010" : "Arquero"),
      nickname: autoNickname,
      birthDate: "1995-05-15",
      country: "CR",
      city: "San José",
      gender: "M",
      bowConfig: {
        type: "Barebow",
        brand: "Hoyt",
        model: "Satori",
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
      role: isAdminEmail ? "superadmin" : "archer",
      plan: isAdminEmail ? "PRO" : "FREE",
      isClubCreator: false,
      profileSetupCompleted: true,
      createdAt: Date.now()
    };

    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", []))
      .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
      .map(sanitizeUserProfile);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "INSERT",
      payloadId: user.uid,
      payload: user,
      timestamp: Date.now()
    });

    if (isOnline) {
      cloudWriteUser(user);
    }
  }

  if (!user) {
    throw new Error("No se encontró el perfil del usuario.");
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
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }

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

  // Calculate age
  const birthDate = new Date(profileData.birthDate);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  const isAdult = age >= 18;
  const isAdminEmail = isSuperAdminEmail(normalizedEmail);

  let finalRole: UserProfile["role"] = isAdminEmail ? "superadmin" : "archer";
  let isCreator = false;
  let inviteCode = "";
  let clubLogo = profileData.clubLogo || "0";
  let clubCountry = profileData.clubCountry || profileData.country;

  // Strip password and actAsCoach so they are NEVER saved in UserProfile
  const { actAsCoach, password: _discardedPassword, ...userFields } = profileData;
  let linkedCoachOnRegister: UserProfile | null = null;

  if (!isAdminEmail) {
    if (profileData.clubId === "CREATE_NEW" && isAdult) {
      finalRole = actAsCoach !== false ? "team_admin_coach" : "team_admin";
      isCreator = true;
      userFields.clubId = getCanonicalCoachClubId({ uid });
      inviteCode = generateClubInviteCode();
    } else if (profileData.clubId === "CREATE_NEW" && !isAdult) {
      userFields.clubId = null;
      finalRole = "archer";
    } else if (profileData.clubId && profileData.clubId !== "NONE") {
      finalRole = "archer";
      const clubCoach = await findClubOwnerByInviteCode(profileData.clubId, uid);
      if (clubCoach && clubCoach.uid !== uid) {
        linkedCoachOnRegister = clubCoach;
        userFields.clubId = getCanonicalCoachClubId(clubCoach);
        userFields.coachId = clubCoach.uid;
        userFields.coachName = clubCoach.fullName || "Entrenador";
        userFields.coachEmail = clubCoach.email || "";
        clubLogo = clubCoach.clubLogo || "0";
        clubCountry = clubCoach.clubCountry || clubCoach.country;
      } else {
        // Code not found: register as independent archer (they can link later from Profile)
        userFields.clubId = null;
      }
    } else {
      userFields.clubId = null;
      finalRole = "archer";
    }
  } else {
    userFields.clubId = null;
  }

  const nowTs = Date.now();
  const newProfile: UserProfile = sanitizeUserProfile({
    ...userFields,
    email: normalizedEmail,
    uid,
    role: finalRole,
    plan: finalRole === "superadmin" ? "PRO" : "FREE", // Todas las cuentas inician FREE; Coach PRO se activa gratis cada mes
    isClubCreator: isCreator,
    clubInviteCode: inviteCode,
    clubLogo,
    clubCountry,
    profileSetupCompleted: true,
    bowConfig: profileData.bowConfig || {
      type: "Barebow",
      brand: "Hoyt",
      model: "Satori",
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

  if (typeof navigator !== "undefined" && navigator.onLine) {
    cloudWriteUser(newProfile);
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
  const notifId = `NTF-LINK-${coach.uid}-${athlete.uid}`;
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
      operation: "UPDATE",
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

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "UPDATE",
      payloadId: updatedUser.uid,
      payload: updatedUser,
      timestamp: nowTs
    });

    if (typeof navigator !== "undefined" && navigator.onLine) {
      cloudWriteUser(updatedUser);
      import("@/lib/db/syncManager").then(({ runSync }) => runSync()).catch(() => {});
    }

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

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "UPDATE",
      payloadId: updated.uid,
      payload: updated,
      timestamp: nowTs
    });

    if (typeof navigator !== "undefined" && navigator.onLine) {
      cloudWriteUser(updated);
      import("@/lib/db/syncManager").then(({ runSync }) => runSync()).catch(() => {});
    }

    return updated;
  }

  throw new Error("User not found");
}

export async function logoutUser(): Promise<void> {
  if (typeof window !== "undefined") {
    (window as any).__archeryManualLogout = true;
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

  const DELETE_BATCH_TIMEOUT_MS = 15000;

  // 2. Delete cloud sessions, stars, and user profile in parallel batches (Promise.allSettled) with a 15s timeout
  if (isOnline && !isGuest) {
    try {
      const { deleteDoc } = await import("firebase/firestore");
      await withTimeout(
        (async () => {
          const sessQuery = query(collection(db, "sessions"), where("userId", "==", uid));
          const sessSnap = await getDocs(sessQuery).catch(() => null);
          if (sessSnap && !sessSnap.empty) {
            const docs = sessSnap.docs;
            const CHUNK_SIZE = 25;
            for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
              const chunk = docs.slice(i, i + CHUNK_SIZE);
              await Promise.allSettled(chunk.map((sDoc) => deleteDoc(doc(db, "sessions", sDoc.id))));
            }
          }
          await Promise.allSettled([
            deleteDoc(doc(db, "athlete_stars", uid)),
            deleteDoc(doc(db, "users", uid))
          ]);
        })(),
        DELETE_BATCH_TIMEOUT_MS
      );
    } catch (err) {
      console.warn("Direct Firestore cleanup timed out or deferred to sync queue:", err);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "DELETE",
        payloadId: uid,
        payload: { uid },
        timestamp: Date.now()
      });
    }

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

  // 4. Remove user from local simulated_users list and delete local sessions & stars
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const filteredUsers = usersList.filter((u) => u.uid !== uid).map(sanitizeUserProfile);
  await saveLocalSetting("simulated_users", filteredUsers);

  try {
    const { deleteLocalSession, athleteStarsStore } = await import("./db/indexedDB");
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
  } catch (err) {
    console.warn("Error cleaning local sessions during account deletion:", err);
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
  const isAdminEmail = isSuperAdminEmail(targetEmail);
  const authUid = explicitUid || auth.currentUser?.uid || "";
  if (!authUid) {
    // Never fabricate a local-only UID: without a real Firebase Auth session every cloud write is rejected
    throw new Error("No se pudo verificar tu cuenta de Google. Intenta iniciar sesión de nuevo.");
  }
  let user: UserProfile | undefined = undefined;
  let needsCloudWrite = false;

  const cleanDisplay = (displayName || targetEmail.split("@")[0] || "Arquero").trim();
  const autoNickname = isAdminEmail
    ? "admin"
    : cleanDisplay.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";

  // 1. Try to fetch from Firestore if online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      const directSnap = await withTimeout(getDoc(doc(db, "users", authUid)), LOGIN_TIMEOUT_MS);
      if (directSnap.exists()) {
        user = sanitizeUserProfile(directSnap.data());
      } else {
        const q = query(collection(db, "users"), where("email", "==", targetEmail));
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
        const localUser = localUsers.find(
          (u) => u.uid === user!.uid || (u.email || "").toLowerCase() === targetEmail
        );

        if (localUser && isProfileValid(localUser) && !isProfileValid(user)) {
          user = sanitizeUserProfile({ ...user, ...localUser, uid: authUid, profileSetupCompleted: true });
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
      console.warn("Firestore user fetch failed, falling back to local database:", err);
    }
  }

  // 2. Fallback to local IndexedDB store
  if (!user) {
    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
    user = usersList.find((u) => u.uid === authUid || (u.email || "").toLowerCase() === targetEmail);
    if (user) {
      user = sanitizeUserProfile({
        ...user,
        uid: authUid || user.uid,
        nickname: user.nickname?.trim() || autoNickname,
        fullName: user.fullName?.trim() || cleanDisplay,
        role: isAdminEmail ? "superadmin" : user.role,
        plan: isAdminEmail ? "PRO" : user.plan,
      });
      // Profile only existed on this device: make sure it reaches the cloud so the Coach can find it
      needsCloudWrite = true;
    }
  }

  // 3. Create default profile if user doesn't exist anywhere.
  // No fictitious equipment/body data: blank values, ProfileCompletionModal asks the real data once.
  if (!user) {
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

  if (isAdminEmail && user.role !== "superadmin") {
    user.role = "superadmin";
    user.plan = "PRO";
  }

  if (needsCloudWrite) {
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "INSERT",
      payloadId: user.uid,
      payload: user,
      timestamp: Date.now()
    });
    if (typeof navigator !== "undefined" && navigator.onLine) {
      cloudWriteUser(user);
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
    throw new Error("Google no compartió tu correo. Vuelve a intentarlo y acepta el permiso de correo electrónico.");
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

  auth.languageCode = "es";

  // Apple Sign-In (Apple App Store Guideline 4.8 compliance)
  if (providerName === "apple") {
    const appleProvider = new OAuthProvider("apple.com");
    appleProvider.addScope("email");
    appleProvider.addScope("name");
    appleProvider.setCustomParameters({ locale: auth.languageCode || "es" });

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
          throw new Error("Inicio de sesión cancelado.");
        }
        if (payload?.statusCode === -2) {
          throw new Error("Google tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.");
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
          } catch (credErr) {
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
      `&prompt=select_account`;
    window.location.assign(oauthUrl);
    return null;
  }

  const provider = new GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const result = await signInWithPopup(auth, provider);
    const u = result.user;
    const email = requireRealEmail(u.email, u.providerData?.find((p) => p.email)?.email);
    const displayName = u.displayName || u.providerData?.find((p) => p.displayName)?.displayName || "";

    return await loginSocialUser(email, displayName, u.uid);
  } catch (popupErr: any) {
    if (popupErr?.code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
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
      brand: "Hoyt",
      model: "Satori",
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
    return { success: false, error: "El código de club debe tener 6 dígitos." };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { success: false, error: "Necesitas conexión a internet para vincularte con tu Coach." };
  }

  if (!auth.currentUser || auth.currentUser.uid !== userUid) {
    return {
      success: false,
      error: "Tu sesión expiró. Cierra sesión y vuelve a ingresar para vincularte con tu Coach."
    };
  }

  const currentLogged = await getLoggedUser();
  if (currentLogged && (currentLogged.clubInviteCode || "").trim().toUpperCase() === cleanCode) {
    return { success: false, error: "Este es tu propio código de Coach. Ingresa el código de 6 dígitos de tu entrenador." };
  }

  // 1. Resolve the real Coach that owns this code (cloud first, never the athlete himself)
  const clubCoach = await findClubOwnerByInviteCode(cleanCode, userUid);

  if (!clubCoach) {
    return {
      success: false,
      error: "Código no encontrado. Pide a tu Coach que abra su Portal Coach para activar su código y vuelve a intentarlo."
    };
  }

  if (clubCoach.uid === userUid) {
    return { success: false, error: "Este es tu propio código de Coach. Compártelo con tus alumnos." };
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
    currentLogged?.role === "superadmin" || isSuperAdminEmail(currentLogged?.email)
      ? "superadmin"
      : "archer";

  const updates: Partial<UserProfile> = {
    role: preservedRole,
    plan: preservedRole === "superadmin" ? "PRO" : "FREE",
    proExpiresAt: preservedRole === "superadmin" ? currentLogged?.proExpiresAt : 0,
    isClubCreator: false,
    clubId: resolvedClubId,
    coachId: clubCoach.uid,
    coachName: clubCoach.fullName || "Entrenador",
    coachEmail: clubCoach.email || "",
    clubInviteCode: ""
  };

  const updated = await updateProfile(userUid, updates);

  // 4. Confirm the link reached the cloud right away (so the Coach sees the athlete immediately)
  try {
    await withTimeout(
      setDoc(
        doc(db, "users", userUid),
        sanitizeUserProfile({ ...updated, uid: userUid, updatedAt: Date.now() }),
        { merge: true }
      ),
      8000
    );
  } catch (err: any) {
    console.warn("Link saved locally; cloud confirmation pending in sync queue:", err?.message || err);
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
        getDocs(query(collection(db, "sessions"), where("userId", "==", userUid))),
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
      try {
        const { updateDoc } = await import("firebase/firestore");
        await withTimeout(
          (async () => {
            const [byCoachSnap, byClubSnap] = await Promise.all([
              getDocs(query(collection(db, "users"), where("coachId", "==", userUid))).catch(() => null),
              getDocs(query(collection(db, "users"), where("clubId", "==", canonicalClubId))).catch(() => null)
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
                    coachId: null,
                    coachName: null,
                    coachEmail: null,
                    isClubCreator: false,
                    role: "archer",
                    updatedAt: now
                  })
                )
              );
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

  const preservedRole: UserProfile["role"] =
    currentLogged?.role === "superadmin" || isSuperAdminEmail(currentLogged?.email)
      ? "superadmin"
      : "archer";

  const updated = await updateProfile(userUid, {
    role: preservedRole,
    plan: preservedRole === "superadmin" ? "PRO" : "FREE",
    proExpiresAt: preservedRole === "superadmin" ? currentLogged?.proExpiresAt : 0,
    isClubCreator: false,
    clubId: null,
    coachId: null,
    coachName: null,
    coachEmail: null,
    clubInviteCode: ""
  });

  if (externalCoachUid && externalCoachUid !== userUid) {
    emitCoachLinkNotification({ uid: externalCoachUid }, updated, "athlete_unlinked").catch(() => {});
  }

  return { success: true, user: updated };
}
