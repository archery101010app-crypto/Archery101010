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
  clubLogo?: string; // index "0"-"4" or URL
  clubCountry?: string; // country code for club flag
  role: "archer" | "coach" | "team_admin" | "team_admin_coach" | "superadmin";
  plan: "FREE" | "PRO";
  isClubCreator: boolean;
  whatsappNumber?: string;
  clubInviteCode?: string;
  profileSetupCompleted?: boolean;
  lastActiveAt?: number;
  createdAt?: number;
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

function sanitizeUserProfile(u: any): UserProfile {
  const copy = { ...u };
  delete copy.password;
  delete copy.actAsCoach;
  return copy as UserProfile;
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
          user = sanitizeUserProfile({
            ...querySnapshot.docs[0].data(),
            uid: authUid
          });
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
      plan: "PRO",
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
      withTimeout(setDoc(doc(db, "users", user.uid), user, { merge: true }), LOGIN_TIMEOUT_MS).catch(() => {});
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

  if (!isAdminEmail) {
    if (profileData.clubId === "CREATE_NEW" && isAdult) {
      finalRole = actAsCoach !== false ? "team_admin_coach" : "team_admin";
      isCreator = true;
      userFields.clubId = generateResilientId("CLB");
      inviteCode = generateClubInviteCode();
    } else if (profileData.clubId === "CREATE_NEW" && !isAdult) {
      userFields.clubId = null;
      userFields.clubName = null;
      finalRole = "archer";
    } else if (profileData.clubId && profileData.clubId !== "NONE") {
      finalRole = "archer";
      const invite = profileData.clubId;
      const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
      const clubCoach = usersList.find((u) => (u.role === "coach" || u.role === "team_admin_coach") && u.clubInviteCode === invite);
      if (clubCoach) {
        userFields.clubId = clubCoach.clubId;
        userFields.clubName = clubCoach.clubName;
        clubLogo = clubCoach.clubLogo || "0";
        clubCountry = clubCoach.clubCountry || clubCoach.country;
      } else {
        userFields.clubId = "CLB-JOINED";
        userFields.clubName = "Club Unido";
      }
    } else {
      userFields.clubId = null;
      userFields.clubName = null;
      finalRole = "archer";
    }
  } else {
    userFields.clubId = null;
    userFields.clubName = null;
  }

  const newProfile: UserProfile = sanitizeUserProfile({
    ...userFields,
    email: normalizedEmail,
    uid,
    role: finalRole,
    plan: "PRO", // Promoción de Lanzamiento: Acceso PRO 100% gratuito para nuevos usuarios pioneros
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
    createdAt: Date.now()
  });

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
    timestamp: Date.now()
  });

  if (typeof navigator !== "undefined" && navigator.onLine) {
    withTimeout(setDoc(doc(db, "users", newProfile.uid), newProfile, { merge: true }), LOGIN_TIMEOUT_MS).catch(() => {});
  }

  await migrateOfflineGuestData(newProfile.uid);
  await saveLocalSetting("current_user", newProfile);
  return newProfile;
}

export async function updateProfile(uid: string, updates: Partial<UserProfile>): Promise<UserProfile> {
  const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", [])).map(sanitizeUserProfile);
  let index = usersList.findIndex((u) => u.uid === uid);

  let currentLogged = await getLoggedUser();

  if (index === -1 && currentLogged && currentLogged.uid === uid) {
    usersList.push(currentLogged);
    index = usersList.length - 1;
  }

  if (index !== -1) {
    const updatedUser = sanitizeUserProfile({ ...usersList[index], ...updates, profileSetupCompleted: true });

    // Propagation: If Coach/Admin updates club name, country or logo, cascade to all club members
    if (
      (updatedUser.role === "coach" || updatedUser.role === "team_admin" || updatedUser.role === "team_admin_coach") &&
      updatedUser.clubId &&
      (updates.clubName !== undefined || updates.clubLogo !== undefined || updates.clubCountry !== undefined)
    ) {
      for (let i = 0; i < usersList.length; i++) {
        if (usersList[i].clubId === updatedUser.clubId && usersList[i].uid !== updatedUser.uid) {
          if (updates.clubName !== undefined) usersList[i].clubName = updates.clubName;
          if (updates.clubLogo !== undefined) usersList[i].clubLogo = updates.clubLogo;
          if (updates.clubCountry !== undefined) usersList[i].clubCountry = updates.clubCountry;
        }
      }
    }

    usersList[index] = updatedUser;
    await saveLocalSetting("simulated_users", usersList);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "UPDATE",
      payloadId: updatedUser.uid,
      payload: updatedUser,
      timestamp: Date.now()
    });

    if (currentLogged && currentLogged.uid === uid) {
      currentLogged = sanitizeUserProfile({ ...currentLogged, ...updates, profileSetupCompleted: true });
      if (updatedUser.role === "coach" || updatedUser.role === "team_admin" || updatedUser.role === "team_admin_coach") {
        currentLogged.clubLogo = updatedUser.clubLogo;
        currentLogged.clubCountry = updatedUser.clubCountry;
        currentLogged.clubName = updatedUser.clubName;
      }
      await saveLocalSetting("current_user", currentLogged);
    }
    return usersList[index];
  }

  if (currentLogged && currentLogged.uid === uid) {
    const updated = sanitizeUserProfile({ ...currentLogged, ...updates, profileSetupCompleted: true });
    await saveLocalSetting("current_user", updated);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "UPDATE",
      payloadId: updated.uid,
      payload: updated,
      timestamp: Date.now()
    });

    return updated;
  }

  throw new Error("User not found");
}

export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.warn("Firebase signOut warning:", err);
  }
  await saveLocalSetting("current_user", null);
}

/**
 * Permanently deletes a user account and all associated local & cloud data
 * (Mandatory Google Play Store & Apple App Store Account Deletion compliance)
 */
export async function deleteUserAccount(uid: string): Promise<void> {
  // 1. Remove user from local simulated_users list
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const filteredUsers = usersList.filter((u) => u.uid !== uid).map(sanitizeUserProfile);
  await saveLocalSetting("simulated_users", filteredUsers);

  // 2. Delete all local sessions belonging specifically to this user
  try {
    const { deleteLocalSession, athleteStarsStore } = await import("./db/indexedDB");
    const localSessions = await getLocalSessions();
    for (const sess of localSessions) {
      if (sess.userId === uid || sess.userUid === uid) {
        await deleteLocalSession(sess.id);
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "DELETE",
          payloadId: sess.id,
          payload: { id: sess.id },
          timestamp: Date.now()
        });
      }
    }
    await athleteStarsStore.removeItem(uid);
  } catch (err) {
    console.warn("Error cleaning local sessions during account deletion:", err);
  }

  // 3. Delete cloud sessions, stars, and user profile in Firestore if online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      const { deleteDoc } = await import("firebase/firestore");
      // Delete all sessions of this user across any device in Firestore
      const sessQuery = query(collection(db, "sessions"), where("userId", "==", uid));
      const sessSnap = await withTimeout(getDocs(sessQuery), LOGIN_TIMEOUT_MS);
      for (const sDoc of sessSnap.docs) {
        await deleteDoc(doc(db, "sessions", sDoc.id)).catch(() => {});
      }
      // Delete athlete stars & user profile document
      await deleteDoc(doc(db, "athlete_stars", uid)).catch(() => {});
      await deleteDoc(doc(db, "users", uid)).catch(() => {});
    } catch (err) {
      console.warn("Direct Firestore cleanup deferred to sync queue:", err);
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "DELETE",
        payloadId: uid,
        payload: { uid },
        timestamp: Date.now()
      });
    }

    // 4. Delete Firebase Authentication user record
    try {
      if (auth.currentUser && auth.currentUser.uid === uid) {
        await deleteUser(auth.currentUser);
      }
    } catch (authDelErr) {
      console.warn("Firebase Auth user delete warning:", authDelErr);
    }
  } else {
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "DELETE",
      payloadId: uid,
      payload: { uid },
      timestamp: Date.now()
    });
  }

  // 5. Clear active session
  await saveLocalSetting("current_user", null);
}

export function isSuperAdmin(user: UserProfile | null): boolean {
  return user?.role === "superadmin";
}

export async function loginSocialUser(email: string, displayName: string, explicitUid?: string): Promise<UserProfile> {
  const targetEmail = email.trim().toLowerCase();
  const isAdminEmail = isSuperAdminEmail(targetEmail);
  const authUid = explicitUid || auth.currentUser?.uid || generateResilientId("USR");
  let user: UserProfile | undefined = undefined;

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
          user = sanitizeUserProfile({
            ...querySnapshot.docs[0].data(),
            uid: authUid
          });
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
    }
  }

  // 3. Create default profile if user doesn't exist anywhere (leave birthDate empty so ProfileCompletionModal prompts them once)
  if (!user) {
    user = {
      uid: authUid,
      email: targetEmail,
      fullName: cleanDisplay,
      nickname: autoNickname,
      birthDate: isAdminEmail ? "1995-05-15" : "",
      country: "CR",
      city: "",
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
      plan: "PRO",
      isClubCreator: false,
      profileSetupCompleted: isAdminEmail,
      createdAt: Date.now()
    };

    const usersList = (await getLocalSetting<UserProfile[]>("simulated_users", []))
      .filter((u) => u.uid !== authUid && (u.email || "").toLowerCase() !== targetEmail)
      .map(sanitizeUserProfile);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);

    if (isProfileValid(user)) {
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "INSERT",
        payloadId: user.uid,
        payload: user,
        timestamp: Date.now()
      });

      if (typeof navigator !== "undefined" && navigator.onLine) {
        withTimeout(setDoc(doc(db, "users", user.uid), user, { merge: true }), LOGIN_TIMEOUT_MS).catch(() => {});
      }
    }
  }

  if (isAdminEmail && user.role !== "superadmin") {
    user.role = "superadmin";
    user.plan = "PRO";
  }

  await migrateOfflineGuestData(user.uid);
  await saveLocalSetting("current_user", user);
  return user;
}

const GOOGLE_WEB_CLIENT_ID = "757910399585-q71dprgcodk5s2t67965gdfusr1lv441.apps.googleusercontent.com";
const FIREBASE_AUTH_HANDLER_URI = "https://archery101010-c0bb4.firebaseapp.com/__/auth/handler";

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
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      const u = result.user;
      const email =
        u.email ||
        u.providerData?.find((p) => p.email)?.email ||
        `${u.uid}@google.archery101010.com`;
      const displayName =
        u.displayName ||
        u.providerData?.find((p) => p.displayName)?.displayName ||
        "Arquero Google";
      return await loginSocialUser(email, displayName, u.uid);
    }

    // 2. Standard Firebase Redirect Result fallback
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      const u = result.user;
      const email =
        u.email ||
        u.providerData?.find((p) => p.email)?.email ||
        `${u.uid}@social.archery101010.com`;
      const displayName =
        u.displayName ||
        u.providerData?.find((p) => p.displayName)?.displayName ||
        "Arquero";
      return await loginSocialUser(email, displayName, u.uid);
    }

    if (
      auth.currentUser &&
      auth.currentUser.providerData.some((p) => p.providerId === "google.com" || p.providerId === "apple.com")
    ) {
      const u = auth.currentUser;
      const email =
        u.email ||
        u.providerData?.find((p) => p.email)?.email ||
        `${u.uid}@social.archery101010.com`;
      const displayName =
        u.displayName ||
        u.providerData?.find((p) => p.displayName)?.displayName ||
        "Arquero";
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
    typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();

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
      const email =
        u.email ||
        u.providerData?.find((p) => p.email)?.email ||
        `${u.uid}@apple.archery101010.com`;
      const displayName =
        u.displayName ||
        u.providerData?.find((p) => p.displayName)?.displayName ||
        "Arquero Apple";
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
        (window as any).__onNativeGoogleSignIn = (res: any) => {
          delete (window as any).__onNativeGoogleSignIn;
          resolve(res);
        };
        nativeAuth.startGoogleSignIn();
      });

      if (!payload || !payload.success) {
        if (payload?.statusCode === 12501 || payload?.statusCode === 16) {
          throw new Error("Inicio de sesión cancelado.");
        }
        throw new Error(
          payload?.error
            ? `No se pudo completar el acceso con Google (${payload.error}).`
            : "Inicio de sesión con Google cancelado."
        );
      }

      if (payload.idToken) {
        try {
          const credential = GoogleAuthProvider.credential(payload.idToken);
          const result = await signInWithCredential(auth, credential);
          const u = result.user;
          const email =
            payload.email ||
            u.email ||
            u.providerData?.find((p) => p.email)?.email ||
            `${u.uid}@google.archery101010.com`;
          const displayName =
            payload.displayName ||
            u.displayName ||
            u.providerData?.find((p) => p.displayName)?.displayName ||
            "Arquero Google";
          return await loginSocialUser(email, displayName, u.uid);
        } catch (credErr) {
          console.warn("signInWithCredential warning, using verified native Google account:", credErr);
        }
      }

      if (payload.email) {
        const fallbackUid = payload.googleId ? `GGL-${payload.googleId}` : undefined;
        return await loginSocialUser(
          payload.email,
          payload.displayName || "Arquero Google",
          fallbackUid
        );
      }

      throw new Error("No se pudo obtener el correo de la cuenta de Google seleccionada.");
    }

    const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
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
    const email =
      u.email ||
      u.providerData?.find((p) => p.email)?.email ||
      `${u.uid}@google.archery101010.com`;
    const displayName =
      u.displayName ||
      u.providerData?.find((p) => p.displayName)?.displayName ||
      "Arquero Google";

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
  const cleanCode = inviteCode.trim().toUpperCase();
  if (!cleanCode) {
    return { success: false, error: "Ingresa un código de club válido." };
  }

  // 1. Search in local simulated_users
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  let clubCoach = usersList.find(
    (u) =>
      (u.role === "coach" || u.role === "team_admin" || u.role === "team_admin_coach") &&
      (u.clubInviteCode?.toUpperCase() === cleanCode || u.clubId?.toUpperCase() === cleanCode)
  );

  // 2. Fallback: Search Firestore if available
  if (!clubCoach) {
    try {
      const q1 = query(collection(db, "users"), where("clubInviteCode", "==", cleanCode));
      const snap1 = await getDocs(q1);
      if (!snap1.empty) {
        clubCoach = snap1.docs[0].data() as UserProfile;
      } else {
        const q2 = query(collection(db, "users"), where("clubId", "==", cleanCode));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          clubCoach = snap2.docs[0].data() as UserProfile;
        }
      }
    } catch (err) {
      console.warn("Could not query Firestore for club coach:", err);
    }
  }

  if (!clubCoach || !clubCoach.clubId) {
    return {
      success: false,
      error: "Código no encontrado. Verifica el código de invitación con tu Coach."
    };
  }

  const updates: Partial<UserProfile> = {
    clubId: clubCoach.clubId,
    clubName: clubCoach.clubName || "Club Archery 101010",
    clubLogo: clubCoach.clubLogo || "0",
    clubCountry: clubCoach.clubCountry || clubCoach.country || "CR"
  };

  const updated = await updateProfile(userUid, updates);
  return { success: true, clubName: updates.clubName ?? undefined, user: updated };
}

/**
 * Leaves the current club, returning to independent archer status.
 */
export async function leaveCurrentClub(userUid: string): Promise<{ success: boolean; user?: UserProfile }> {
  const updated = await updateProfile(userUid, {
    clubId: null,
    clubName: null,
    clubLogo: undefined,
    clubCountry: undefined
  });
  return { success: true, user: updated };
}
