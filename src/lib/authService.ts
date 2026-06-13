import { saveLocalSetting, getLocalSetting, generateResilientId, addToSyncQueue, getLocalSessions, saveLocalSession } from "./db/indexedDB";
import { db } from "./firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  nickname: string;
  birthDate: string;
  country: string;
  city: string;
  gender: string;
  bowConfig?: {
    type: "Recurve" | "Compound" | "Barebow";
    brand: string;
    model: string;
    poundage: number;
    defaultDistance: number;
  };
  physicalData?: {
    height: number;
    weight: number;
    dominantEye: "L" | "R";
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
  password?: string;
  profileSetupCompleted?: boolean;
  lastActiveAt?: number;
}

// Emulates real backend Firebase calls using local DB to support zero-config developer onboarding
export async function getLoggedUser(): Promise<UserProfile | null> {
  return await getLocalSetting<UserProfile | null>("current_user", null);
}

const LOGIN_TIMEOUT_MS = 3000; // 3 seconds timeout

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
    u.nickname?.trim() &&
    u.fullName?.trim() &&
    u.birthDate &&
    u.city?.trim() &&
    u.country &&
    u.gender
  );
}

export async function loginUser(email: string, password?: string): Promise<UserProfile> {
  const normalizedEmail = email.trim().toLowerCase();
  const isAdminInput = normalizedEmail === "admin101010" || 
                       normalizedEmail === "admin@archery101010.com" || 
                       normalizedEmail === "admin101010@archery101010.com";

  const targetEmail = isAdminInput ? "admin@archery101010.com" : normalizedEmail;

  if (isAdminInput) {
    if (password !== "Rod@admin26") {
      throw new Error("Contraseña incorrecta. Solo el administrador puede iniciar sesión aquí.");
    }
  }

  let user: UserProfile | undefined = undefined;

  // 1. Try to fetch from Firestore if online to enable real-time multi-device sync
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      // Check if the api key is the mock placeholder to prevent hanging on mock environments
      const isLocalhost = typeof window !== "undefined" && 
                          (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const isMockFirebase = (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 
                             process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) && isLocalhost;
      
      if (!isMockFirebase) {
        const q = query(collection(db, "users"), where("email", "==", targetEmail));
        const querySnapshot = await withTimeout(getDocs(q), LOGIN_TIMEOUT_MS);
        if (!querySnapshot.empty) {
          const remoteUser = querySnapshot.docs[0].data() as UserProfile;
          
          // Save/update in local simulated list to keep it updated offline
          const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const localUser = localUsers.find((u) => u.uid === remoteUser.uid || (u.email || "").toLowerCase() === (remoteUser.email || "").toLowerCase());
          
          if (localUser && isProfileValid(localUser) && !isProfileValid(remoteUser)) {
            console.warn("[Auth] Local profile is complete, but remote is incomplete. Merging local fields to prevent setup loop.");
            user = { ...remoteUser, ...localUser, profileSetupCompleted: true };
          } else {
            user = remoteUser;
          }
          
          const idx = localUsers.findIndex((u) => u.uid === user!.uid);
          if (idx !== -1) {
            localUsers[idx] = user;
          } else {
            localUsers.push(user);
          }
          await saveLocalSetting("simulated_users", localUsers);
        }
      }
    } catch (err) {
      console.warn("Firestore user fetch timed out or failed, falling back to local database:", err);
    }
  }

  // 2. Fallback to local IndexedDB store if offline or not found in Firestore
  if (!user) {
    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    user = usersList.find((u) => (u.email || "").toLowerCase() === targetEmail);
  }

  // 3. If user exists, validate password
  if (user) {
    if (isAdminInput && password !== "Rod@admin26") {
      throw new Error("Contraseña incorrecta. Solo el administrador puede iniciar sesión aquí.");
    }
    if (user.password) {
      if (!password || user.password !== password) {
        throw new Error("Contraseña incorrecta. Por favor intenta de nuevo.");
      }
    }
  } else {
    // 4. Create default profile depending on the input type
    if (isAdminInput) {
      user = {
        uid: "USR-SUPERADMIN-ADMIN101010",
        email: "admin@archery101010.com",
        fullName: "Admin101010",
        nickname: "admin",
        birthDate: "1990-01-01",
        country: "CR",
        city: "San José",
        gender: "M",
        bowConfig: {
          type: "Barebow",
          brand: "Hoyt",
          model: "Satori",
          poundage: 40,
          defaultDistance: 18
        },
        physicalData: {
          height: 180,
          weight: 75,
          dominantEye: "R",
          dominantHand: "R"
        },
        clubId: null,
        clubName: null,
        role: "superadmin",
        plan: "PRO",
        isClubCreator: false,
        password: "Rod@admin26",
        profileSetupCompleted: true
      };
    } else {
      const isSocialLogin = targetEmail.includes("google-user") || targetEmail.includes("facebook-user");
      if (isSocialLogin) {
        const providerName = targetEmail.includes("google") ? "Google User" : "Facebook User";
        user = {
          uid: generateResilientId("USR"),
          email: targetEmail,
          fullName: providerName,
          nickname: "",
          birthDate: "1995-05-15",
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
          role: "archer",
          plan: "FREE",
          isClubCreator: false,
          profileSetupCompleted: false
        };
      } else {
        // Enforce registration for normal users
        throw new Error("El correo ingresado no está registrado. Por favor, ve a la opción 'Registrarse' para crear una cuenta.");
      }
    }

    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);

    // Queue new user profile to Firestore sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "INSERT",
      payloadId: user.uid,
      payload: user,
      timestamp: Date.now()
    });
  }

  await migrateOfflineGuestData(user.uid);
  await saveLocalSetting("current_user", user);
  return user;
}

export async function registerUser(
  profileData: Omit<UserProfile, "uid" | "role" | "plan" | "isClubCreator" | "clubInviteCode"> & { password?: string; actAsCoach?: boolean }
): Promise<UserProfile> {
  const uid = generateResilientId("USR");
  
  // Rule 8: Es coach si es mayor de edad (>=18 años) y es el que se registra de primero en un club que crea
  // Calculate age
  const birthDate = new Date(profileData.birthDate);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  const isAdult = age >= 18;
  
  let finalRole: UserProfile["role"] = "archer";
  let isCreator = false;
  let inviteCode = "";
  let clubLogo = profileData.clubLogo || "0";
  let clubCountry = profileData.clubCountry || profileData.country;

  // Extract actAsCoach to avoid adding it to the final UserProfile object
  const { actAsCoach, ...userFields } = profileData;

  if (profileData.clubId === "CREATE_NEW" && isAdult) {
    finalRole = actAsCoach !== false ? "team_admin_coach" : "team_admin";
    isCreator = true;
    userFields.clubId = generateResilientId("CLB");
    inviteCode = `INV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  } else if (profileData.clubId === "CREATE_NEW" && !isAdult) {
    // If minor, they cannot create a club, default to independent archer
    userFields.clubId = null;
    userFields.clubName = null;
    finalRole = "archer";
  } else if (profileData.clubId && profileData.clubId !== "NONE") {
    // Joining an existing club via invite code
    finalRole = "archer";
    const invite = profileData.clubId; // the invite code entered
    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const clubCoach = usersList.find((u) => (u.role === "coach" || u.role === "team_admin_coach") && u.clubInviteCode === invite);
    if (clubCoach) {
      userFields.clubId = clubCoach.clubId;
      userFields.clubName = clubCoach.clubName;
      clubLogo = clubCoach.clubLogo || "0";
      clubCountry = clubCoach.clubCountry || clubCoach.country;
    } else {
      // fallback
      userFields.clubId = "CLB-JOINED";
      userFields.clubName = "Club Unido";
    }
  } else {
    // Independent
    userFields.clubId = null;
    userFields.clubName = null;
    finalRole = "archer";
  }

  const newProfile: UserProfile = {
    ...userFields,
    uid,
    role: finalRole,
    plan: "FREE", // default register is free tier
    isClubCreator: isCreator,
    clubInviteCode: inviteCode,
    clubLogo,
    clubCountry,
    password: profileData.password,
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
    }
  };

  // Save to database lists
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  usersList.push(newProfile);
  await saveLocalSetting("simulated_users", usersList);

  // Queue to Firestore sync queue
  await addToSyncQueue({
    id: generateResilientId("TXN"),
    collection: "users",
    operation: "INSERT",
    payloadId: newProfile.uid,
    payload: newProfile,
    timestamp: Date.now()
  });

  // Set as current logged user
  await saveLocalSetting("current_user", newProfile);
  return newProfile;
}

export async function updateProfile(uid: string, updates: Partial<UserProfile>): Promise<UserProfile> {
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  let index = usersList.findIndex((u) => u.uid === uid);
  
  let currentLogged = await getLoggedUser();

  if (index === -1 && currentLogged && currentLogged.uid === uid) {
    usersList.push(currentLogged);
    index = usersList.length - 1;
  }

  if (index !== -1) {
    const updatedUser = { ...usersList[index], ...updates, profileSetupCompleted: true };

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

    // Queue update to Firestore sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "UPDATE",
      payloadId: updatedUser.uid,
      payload: updatedUser,
      timestamp: Date.now()
    });
    
    if (currentLogged && currentLogged.uid === uid) {
      // Refresh current user cache with all propagated changes too
      currentLogged = { ...currentLogged, ...updates, profileSetupCompleted: true };
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
    const updated = { ...currentLogged, ...updates, profileSetupCompleted: true };
    await saveLocalSetting("current_user", updated);

    // Queue update to Firestore sync queue
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

export async function transferCoachRole(newCoachUid: string): Promise<boolean> {
  const currentLogged = await getLoggedUser();
  if (!currentLogged || currentLogged.role !== "coach" || !currentLogged.clubId) {
    return false;
  }

  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const newCoachIndex = usersList.findIndex((u) => u.uid === newCoachUid && u.clubId === currentLogged.clubId);

  if (newCoachIndex === -1) {
    return false;
  }

  // Calculate age of new coach
  const birthDate = new Date(usersList[newCoachIndex].birthDate);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 18) {
    // New coach must be an adult
    return false;
  }

  // Perform transfer
  const oldCoachIndex = usersList.findIndex((u) => u.uid === currentLogged.uid);

  if (oldCoachIndex !== -1) {
    // Current coach becomes archer
    usersList[oldCoachIndex].role = "archer";
    usersList[oldCoachIndex].isClubCreator = false;
  }

  // Target member becomes coach
  usersList[newCoachIndex].role = "coach";
  usersList[newCoachIndex].isClubCreator = true;

  await saveLocalSetting("simulated_users", usersList);

  // Update session state of the logged-in user (who is now an archer)
  const updatedCurrentLogged: UserProfile = {
    ...currentLogged,
    role: "archer",
    isClubCreator: false
  };
  await saveLocalSetting("current_user", updatedCurrentLogged);

  return true;
}

export async function logoutUser(): Promise<void> {
  await saveLocalSetting("current_user", null);
}

export function isSuperAdmin(user: UserProfile | null): boolean {
  return user?.role === "superadmin";
}

export async function loginSocialUser(email: string, displayName: string): Promise<UserProfile> {
  const targetEmail = email.trim().toLowerCase();
  let user: UserProfile | undefined = undefined;

  // 1. Try to fetch from Firestore if online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    try {
      const isLocalhost = typeof window !== "undefined" && 
                          (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const isMockFirebase = (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 
                             process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) && isLocalhost;
      
      if (!isMockFirebase) {
        const q = query(collection(db, "users"), where("email", "==", targetEmail));
        const querySnapshot = await withTimeout(getDocs(q), LOGIN_TIMEOUT_MS);
        if (!querySnapshot.empty) {
          const remoteUser = querySnapshot.docs[0].data() as UserProfile;
          
          // Save/update in local simulated list
          const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const localUser = localUsers.find((u) => u.uid === remoteUser.uid || (u.email || "").toLowerCase() === (remoteUser.email || "").toLowerCase());
          
          if (localUser && isProfileValid(localUser) && !isProfileValid(remoteUser)) {
            console.warn("[Auth] Local profile is complete, but remote is incomplete. Merging local fields to prevent setup loop.");
            user = { ...remoteUser, ...localUser, profileSetupCompleted: true };
          } else {
            user = remoteUser;
          }
          
          const idx = localUsers.findIndex((u) => u.uid === user!.uid);
          if (idx !== -1) {
            localUsers[idx] = user;
          } else {
            localUsers.push(user);
          }
          await saveLocalSetting("simulated_users", localUsers);
        }
      }
    } catch (err) {
      console.warn("Firestore user fetch failed, falling back to local database:", err);
    }
  }

  // 2. Fallback to local IndexedDB store
  if (!user) {
    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    user = usersList.find((u) => (u.email || "").toLowerCase() === targetEmail);
  }

  // 3. Create default profile if user doesn't exist anywhere
  if (!user) {
    user = {
      uid: generateResilientId("USR"),
      email: targetEmail,
      fullName: displayName || "Usuario Social",
      nickname: "",
      birthDate: "1995-05-15",
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
      role: "archer",
      plan: "FREE",
      isClubCreator: false,
      profileSetupCompleted: false
    };

    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);

    // Queue new user profile to Firestore sync queue
    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "users",
      operation: "INSERT",
      payloadId: user.uid,
      payload: user,
      timestamp: Date.now()
    });
  }

  await migrateOfflineGuestData(user.uid);
  await saveLocalSetting("current_user", user);
  return user;
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
    const guestSessions = localSessions.filter(s => s.userUid === "USR-GUEST-OFFLINE");
    
    for (const session of guestSessions) {
      const updatedSession = { ...session, userUid: newUid };
      // Save updated session
      await saveLocalSession(session.id, updatedSession);
      // Queue sync
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
