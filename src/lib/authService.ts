import { saveLocalSetting, getLocalSetting } from "./db/indexedDB";
import { generateResilientId } from "./db/indexedDB";

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  birthDate: string;
  country: string;
  gender: string;
  bowConfig: {
    type: "Recurve" | "Compound" | "Barebow";
    brand: string;
    model: string;
    poundage: number;
    defaultDistance: number;
  };
  physicalData: {
    height: number;
    weight: number;
    dominantEye: "L" | "R";
    dominantHand: "L" | "R";
  };
  clubId: string | null;
  clubName: string | null;
  clubLogo?: string; // index "0"-"4" or URL
  clubCountry?: string; // country code for club flag
  role: "archer" | "coach" | "admin" | "superadmin";
  plan: "FREE" | "PRO";
  isClubCreator: boolean;
  whatsappNumber?: string;
  clubInviteCode?: string;
}

// Emulates real backend Firebase calls using local DB to support zero-config developer onboarding
export async function getLoggedUser(): Promise<UserProfile | null> {
  return await getLocalSetting<UserProfile | null>("current_user", null);
}

export async function loginUser(email: string): Promise<UserProfile> {
  // Mock login: find if user exists in database list or create a default one
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  let user = usersList.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    const isSuperAdminEmail = email.toLowerCase() === "admin@archery101010.com";
    // Return a default demo coach profile if no user was registered yet
    user = {
      uid: isSuperAdminEmail ? "USR-SUPERADMIN" : "USR-DEMO-101010",
      email: email,
      fullName: isSuperAdminEmail ? "Super Administrador" : "Arquero Demo",
      birthDate: "1995-05-15",
      country: "CR",
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
      clubId: isSuperAdminEmail ? null : "CLB-DEMO",
      clubName: isSuperAdminEmail ? null : "Club Olímpico San José",
      clubLogo: isSuperAdminEmail ? undefined : "0",
      clubCountry: isSuperAdminEmail ? undefined : "CR",
      role: isSuperAdminEmail ? "superadmin" : "coach",
      plan: isSuperAdminEmail ? "PRO" : "FREE",
      isClubCreator: !isSuperAdminEmail,
      whatsappNumber: isSuperAdminEmail ? undefined : "+50688888888",
      clubInviteCode: isSuperAdminEmail ? undefined : "ARC-1010"
    };
    
    // Add to simulation database list
    usersList.push(user);
    await saveLocalSetting("simulated_users", usersList);
  }

  await saveLocalSetting("current_user", user);
  return user;
}

export async function registerUser(profileData: Omit<UserProfile, "uid" | "role" | "plan" | "isClubCreator" | "clubInviteCode">): Promise<UserProfile> {
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
  
  let finalRole: "archer" | "coach" = "archer";
  let isCreator = false;
  let inviteCode = "";
  let clubLogo = profileData.clubLogo || "0";
  let clubCountry = profileData.clubCountry || profileData.country;

  if (profileData.clubId === "CREATE_NEW" && isAdult) {
    finalRole = "coach";
    isCreator = true;
    profileData.clubId = generateResilientId("CLB");
    inviteCode = `INV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  } else if (profileData.clubId === "CREATE_NEW" && !isAdult) {
    // If minor, they cannot create a club, default to independent archer
    profileData.clubId = null;
    profileData.clubName = null;
    finalRole = "archer";
  } else if (profileData.clubId && profileData.clubId !== "NONE") {
    // Joining an existing club via invite code
    finalRole = "archer";
    const invite = profileData.clubId; // the invite code entered
    const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const clubCoach = usersList.find((u) => u.role === "coach" && u.clubInviteCode === invite);
    if (clubCoach) {
      profileData.clubId = clubCoach.clubId;
      profileData.clubName = clubCoach.clubName;
      clubLogo = clubCoach.clubLogo || "0";
      clubCountry = clubCoach.clubCountry || clubCoach.country;
    } else {
      // fallback
      profileData.clubId = "CLB-JOINED";
      profileData.clubName = "Club Unido";
    }
  } else {
    // Independent
    profileData.clubId = null;
    profileData.clubName = null;
    finalRole = "archer";
  }

  const newProfile: UserProfile = {
    ...profileData,
    uid,
    role: finalRole,
    plan: "FREE", // default register is free tier
    isClubCreator: isCreator,
    clubInviteCode: inviteCode,
    clubLogo,
    clubCountry
  };

  // Save to database lists
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  usersList.push(newProfile);
  await saveLocalSetting("simulated_users", usersList);

  // Set as current logged user
  await saveLocalSetting("current_user", newProfile);
  return newProfile;
}

export async function updateProfile(uid: string, updates: Partial<UserProfile>): Promise<UserProfile> {
  const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
  const index = usersList.findIndex((u) => u.uid === uid);
  
  let currentLogged = await getLoggedUser();

  if (index !== -1) {
    let updatedUser = { ...usersList[index], ...updates };

    // Propagation: If Coach updates club name, country or logo, cascade to all club members
    if (
      updatedUser.role === "coach" && 
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
    
    if (currentLogged && currentLogged.uid === uid) {
      // Refresh current user cache with all propagated changes too
      currentLogged = { ...currentLogged, ...updates };
      if (updatedUser.role === "coach") {
        currentLogged.clubLogo = updatedUser.clubLogo;
        currentLogged.clubCountry = updatedUser.clubCountry;
        currentLogged.clubName = updatedUser.clubName;
      }
      await saveLocalSetting("current_user", currentLogged);
    }
    return usersList[index];
  }

  if (currentLogged && currentLogged.uid === uid) {
    const updated = { ...currentLogged, ...updates };
    await saveLocalSetting("current_user", updated);
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
