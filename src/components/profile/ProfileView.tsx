"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  UserProfile,
  BowConfig,
  updateProfile,
  deleteUserAccount,
  joinClubByInviteCode,
  leaveCurrentClub,
  isLinkedToExternalCoach,
  getCanonicalCoachClubId
} from "@/lib/authService";
import { saveLocalSetting, getLocalSetting } from "@/lib/db/indexedDB";
import {
  ArrowLeft,
  LogOut,
  Check,
  Shield,
  Plus,
  Trash2,
  Target,
  Users,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  Ruler,
  Share2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import LanguageSelector from "../ui/LanguageSelector";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { triggerHaptic } from "@/lib/haptics";
import { showOledAlert, showOledConfirm } from "@/lib/oledDialog";
import { COUNTRIES, COUNTRIES_MAP, getLocalizedCountryName } from "@/lib/countries";
import {
  UnitSystem,
  parseLocaleDecimal,
  getDefaultUnitSystemForCountry,
  cmToFeetInches,
  feetInchesToCm,
  kgToLbs,
  lbsToKg,
  formatHeightRegional,
  formatWeightRegional,
  formatRegionalDate
} from "@/lib/i18n/regionalUtils";

interface ProfileViewProps {
  user: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  onProfileUpdated: (updatedUser: UserProfile) => void;
  onNavigate?: (screen: any) => void;
  onOpenCoachPortal?: () => void;
}

interface EditableBowConfig extends BowConfig {
  poundageInput: string;
  drawLengthInput: string;
}

function isBareDialPrefix(val: string, prevDial?: string): boolean {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "+") return true;
  if (prevDial && trimmed === prevDial.trim()) return true;
  return /^\+\d{1,4}$/.test(trimmed);
}

function normalizeE164Digits(rawPhone?: string | null, countryCode?: string | null): string {
  if (!rawPhone) return "";
  const trimmed = rawPhone.trim();
  if (!trimmed) return "";
  const dialCode = COUNTRIES_MAP[(countryCode || "").toUpperCase()]?.dialCode || "";
  const dialDigits = dialCode.replace(/[^0-9]/g, "");
  const allDigits = trimmed.replace(/[^0-9]/g, "");
  if (!allDigits || allDigits === dialDigits) return "";
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    return trimmed.startsWith("00") ? allDigits.slice(2) : allDigits;
  }
  if (dialDigits && !allDigits.startsWith(dialDigits)) {
    const localDigits = allDigits.replace(/^0+/, "");
    return `${dialDigits}${localDigits}`;
  }
  return allDigits;
}

function formatPhoneForSave(rawPhone: string, countryCode: string): string {
  const e164 = normalizeE164Digits(rawPhone, countryCode);
  if (!e164) return "";
  return `+${e164}`;
}

export default function ProfileView({
  user,
  onBack,
  onLogout,
  onProfileUpdated,
  onNavigate,
  onOpenCoachPortal
}: ProfileViewProps) {
  const { language, unitSystem, setUnitSystem, t, tx } = useLanguage();

  // Section edit toggles
  const [editPersonal, setEditPersonal] = useState(false);
  const [editBow, setEditBow] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Hook into mobile back button and gestures
  useEffect(() => {
    if (isDeleteAccountOpen) {
      return registerModalDismiss(() => setIsDeleteAccountOpen(false));
    }
  }, [isDeleteAccountOpen]);

  // Form Fields
  const [fullName, setFullName] = useState(user.fullName);
  const [nickname, setNickname] = useState(user.nickname || "");
  const [clubName, setClubName] = useState(
    user.clubName &&
      !["club archery 101010", "club olímpico", "club olimpico", "club deportivo", "arqueros"].includes(
        user.clubName.trim().toLowerCase()
      )
      ? user.clubName
      : ""
  );
  const [birthDate, setBirthDate] = useState(user.birthDate);
  const [country, setCountry] = useState(user.country || "CR");
  const [city, setCity] = useState(user.city || "");
  const [gender, setGender] = useState(user.gender);

  // Phone / Messaging field (shared between Personal & Coach settings, with dialCode suggestion)
  const [clubWhatsApp, setClubWhatsApp] = useState(() => {
    if (user.whatsappNumber && user.whatsappNumber.trim()) {
      return user.whatsappNumber;
    }
    const dial = COUNTRIES_MAP[user.country || "CR"]?.dialCode;
    return dial ? `${dial} ` : "";
  });

  // Canonical + Regional Biometric Drafts
  const initHeightCmVal =
    user.physicalData?.height && user.physicalData.height > 0 ? user.physicalData.height : 0;
  const initWeightKgVal =
    user.physicalData?.weight && user.physicalData.weight > 0 ? user.physicalData.weight : 0;
  const initFtIn = initHeightCmVal > 0 ? cmToFeetInches(initHeightCmVal) : null;

  const [heightCm, setHeightCm] = useState<string>(
    initHeightCmVal > 0 ? String(Math.round(initHeightCmVal)) : ""
  );
  const [heightFt, setHeightFt] = useState<string>(initFtIn ? String(initFtIn.feet) : "");
  const [heightIn, setHeightIn] = useState<string>(initFtIn ? String(initFtIn.inches) : "");
  const [weightKg, setWeightKg] = useState<string>(
    initWeightKgVal > 0 ? String(Math.round(initWeightKgVal * 10) / 10) : ""
  );
  const [weightLbs, setWeightLbs] = useState<string>(
    initWeightKgVal > 0 ? String(kgToLbs(initWeightKgVal)) : ""
  );

  useEffect(() => {
    if (!editPersonal) {
      const h = user.physicalData?.height && user.physicalData.height > 0 ? user.physicalData.height : 0;
      const w = user.physicalData?.weight && user.physicalData.weight > 0 ? user.physicalData.weight : 0;
      if (h > 0) {
        setHeightCm(String(Math.round(h)));
        const { feet, inches } = cmToFeetInches(h);
        setHeightFt(String(feet));
        setHeightIn(String(inches));
      } else {
        setHeightCm("");
        setHeightFt("");
        setHeightIn("");
      }
      if (w > 0) {
        setWeightKg(String(Math.round(w * 10) / 10));
        setWeightLbs(String(kgToLbs(w)));
      } else {
        setWeightKg("");
        setWeightLbs("");
      }
    }
  }, [user.physicalData, editPersonal]);

  // Multi-Bow Configuration State (Arco #1, Arco #2, Arco #3)
  const parseInitialBows = (u: UserProfile): EditableBowConfig[] => {
    if (u.bows && u.bows.length > 0) {
      return u.bows.map((b, idx) => ({
        id: b.id || `BOW-${idx + 1}`,
        name: b.name || (idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`),
        type: b.type || "Recurve",
        brand: b.brand || "",
        model: b.model || "",
        poundage: b.poundage || 0,
        poundageInput: b.poundage && b.poundage > 0 ? String(b.poundage) : "",
        drawLength: b.drawLength || 0,
        drawLengthInput: b.drawLength && b.drawLength > 0 ? String(b.drawLength) : "",
        hand: b.hand || (u.physicalData?.dominantHand === "L" ? "LH" : "RH"),
        defaultDistance:
          b.defaultDistance || (b.type === "Compound" ? 50 : b.type === "Recurve" ? 70 : 18)
      }));
    }
    if (u.bowConfig) {
      return [
        {
          id: "BOW-1",
          name: "Arco Principal",
          type: u.bowConfig.type || "Recurve",
          brand: u.bowConfig.brand || "",
          model: u.bowConfig.model || "",
          poundage: u.bowConfig.poundage || 0,
          poundageInput:
            u.bowConfig.poundage && u.bowConfig.poundage > 0 ? String(u.bowConfig.poundage) : "",
          drawLength: u.bowConfig.drawLength || 0,
          drawLengthInput:
            u.bowConfig.drawLength && u.bowConfig.drawLength > 0
              ? String(u.bowConfig.drawLength)
              : "",
          hand: u.bowConfig.hand || (u.physicalData?.dominantHand === "L" ? "LH" : "RH"),
          defaultDistance:
            u.bowConfig.defaultDistance ||
            (u.bowConfig.type === "Compound" ? 50 : u.bowConfig.type === "Recurve" ? 70 : 18)
        }
      ];
    }
    return [
      {
        id: "BOW-1",
        name: "Arco Principal",
        type: "Recurve",
        brand: "",
        model: "",
        poundage: 0,
        poundageInput: "",
        drawLength: 0,
        drawLengthInput: "",
        hand: u.physicalData?.dominantHand === "L" ? "LH" : "RH",
        defaultDistance: 70
      }
    ];
  };

  const [bowsList, setBowsList] = useState<EditableBowConfig[]>(parseInitialBows(user));

  useEffect(() => {
    if (!editBow) {
      setBowsList(parseInitialBows(user));
    }
  }, [user.bows, user.bowConfig, editBow]);

  const handleUpdateBow = (index: number, updates: Partial<EditableBowConfig>) => {
    setBowsList((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  };

  const handleAddBow = () => {
    if (bowsList.length >= 3) return;
    const nextIdx = bowsList.length + 1;
    setBowsList((prev) => [
      ...prev,
      {
        id: `BOW-${nextIdx}`,
        name: `Arco #${nextIdx}`,
        type: "Recurve",
        brand: "",
        model: "",
        poundage: 0,
        poundageInput: "",
        drawLength: 0,
        drawLengthInput: "",
        hand: bowsList[0]?.hand || "RH",
        defaultDistance: 70
      }
    ]);
  };

  const handleRemoveBow = (index: number) => {
    if (index === 0) return; // Cannot delete primary bow
    setBowsList((prev) => prev.filter((_, i) => i !== index));
  };

  const convertDraftBiometrics = (fromUnits: UnitSystem, toUnits: UnitSystem) => {
    if (fromUnits === toUnits) return;
    if (toUnits === "imperial") {
      const cm = parseLocaleDecimal(heightCm, 0);
      if (cm > 0) {
        const { feet, inches } = cmToFeetInches(cm);
        setHeightFt(String(feet));
        setHeightIn(String(inches));
      }
      const kg = parseLocaleDecimal(weightKg, 0);
      if (kg > 0) {
        setWeightLbs(String(kgToLbs(kg)));
      }
    } else {
      const ft = parseLocaleDecimal(heightFt, 0);
      const inch = parseLocaleDecimal(heightIn, 0);
      if (ft > 0 || inch > 0) {
        setHeightCm(String(feetInchesToCm(ft, inch)));
      }
      const lbs = parseLocaleDecimal(weightLbs, 0);
      if (lbs > 0) {
        setWeightKg(String(lbsToKg(lbs)));
      }
    }
  };

  const handleSelectUnitSystem = async (nextUnits: UnitSystem) => {
    if (nextUnits === unitSystem && user.unitSystem === nextUnits) return;
    convertDraftBiometrics(unitSystem, nextUnits);
    await setUnitSystem(nextUnits);
    try {
      const updated = await updateProfile(user.uid, { unitSystem: nextUnits });
      onProfileUpdated(updated);
    } catch (err) {
      console.warn("Could not save unitSystem on profile:", err);
    }
  };

  const handleCountryChangeInProfile = (newCountry: string) => {
    const prevDial = COUNTRIES_MAP[country]?.dialCode || "";
    setCountry(newCountry);
    const nextDial = COUNTRIES_MAP[newCountry]?.dialCode || "+";
    setClubWhatsApp((prev) => {
      if (isBareDialPrefix(prev, prevDial)) {
        return nextDial === "+" ? "+" : `${nextDial} `;
      }
      return prev;
    });
    if (!user.unitSystem) {
      const suggestedUnits = getDefaultUnitSystemForCountry(newCountry);
      if (suggestedUnits !== unitSystem) {
        convertDraftBiometrics(unitSystem, suggestedUnits);
        setUnitSystem(suggestedUnits);
      }
    }
  };

  // Notification Toggles
  const [pushNotif, setPushNotif] = useState(true);

  // Athlete Coach Linking states
  const [athleteInviteCode, setAthleteInviteCode] = useState("");
  const [isJoiningClub, setIsJoiningClub] = useState(false);
  const [clubJoinFeedback, setClubJoinFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [coachProfile, setCoachProfile] = useState<UserProfile | null>(null);
  const [coachStudents, setCoachStudents] = useState<UserProfile[]>([]);
  const linkedToCoach = isLinkedToExternalCoach(user);
  const isCoachProfile =
    !linkedToCoach &&
    (user.role === "coach" ||
      user.role === "team_admin" ||
      user.role === "team_admin_coach" ||
      user.role === "superadmin");

  useEffect(() => {
    let cancelled = false;
    async function loadCoachInfo() {
      if (!isLinkedToExternalCoach(user)) {
        setCoachProfile(null);
        return;
      }
      try {
        const { getLocalSetting } = await import("@/lib/db/indexedDB");
        const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const findCoachInList = (candidates: UserProfile[]): UserProfile | undefined => {
          const others = candidates.filter((u) => u && u.uid && u.uid !== user.uid);
          if (user.coachId && user.coachId !== user.uid) {
            const byId = others.find((u) => u.uid === user.coachId);
            if (byId) return byId;
          }
          if (user.clubId) {
            const byRoleAndClub = others.find(
              (u) =>
                (u.clubId === user.clubId ||
                  getCanonicalCoachClubId(u) === user.clubId ||
                  "CLB-" + u.uid.replace("USR-", "") === user.clubId) &&
                (u.role === "coach" ||
                  u.role === "team_admin" ||
                  u.role === "team_admin_coach" ||
                  u.role === "superadmin" ||
                  u.isClubCreator)
            );
            if (byRoleAndClub) return byRoleAndClub;
            const byDerivedId = others.find(
              (u) => "CLB-" + u.uid.replace("USR-", "") === user.clubId
            );
            if (byDerivedId) return byDerivedId;
          }
          return undefined;
        };

        let resolved = findCoachInList(list);

        if (!resolved && typeof navigator !== "undefined" && navigator.onLine) {
          try {
            const { doc, getDoc, collection, query, where, limit, getDocs } = await import(
              "firebase/firestore"
            );
            const { db } = await import("@/lib/firebase");

            const candidateCoachUid =
              user.coachId && user.coachId !== user.uid
                ? user.coachId
                : user.clubId?.startsWith("CLB-")
                ? user.clubId.replace(/^CLB-/, "")
                : "";

            if (candidateCoachUid && candidateCoachUid !== user.uid) {
              const directSnap = await getDoc(doc(db, "users", candidateCoachUid));
              if (directSnap.exists()) {
                const data = directSnap.data() as UserProfile;
                if (data && (data.uid || directSnap.id) !== user.uid) {
                  resolved = { ...data, uid: data.uid || directSnap.id };
                }
              }
            }

            if (!resolved && user.clubId) {
              const qClub = query(
                collection(db, "users"),
                where("clubId", "==", user.clubId),
                limit(100)
              );
              const snapClub = await getDocs(qClub);
              const remoteList: UserProfile[] = [];
              snapClub.forEach((d) => {
                const data = d.data() as UserProfile;
                const uid = data?.uid || d.id;
                if (data && uid && uid !== user.uid) {
                  remoteList.push({ ...data, uid });
                }
              });
              resolved = findCoachInList(remoteList);
            }
          } catch (cloudErr) {
            console.warn("Could not fetch coach profile from cloud:", cloudErr);
          }
        }

        if (cancelled) return;

        if (resolved && resolved.uid !== user.uid) {
          setCoachProfile(resolved);
          const expectedRole: UserProfile["role"] =
            user.role === "superadmin" ? "superadmin" : "archer";
          const expectedClubId = getCanonicalCoachClubId(resolved);
          if (
            user.coachId !== resolved.uid ||
            !user.coachName ||
            user.isClubCreator ||
            user.role !== expectedRole ||
            user.clubId !== expectedClubId ||
            !!user.clubInviteCode
          ) {
            updateProfile(user.uid, {
              role: expectedRole,
              isClubCreator: false,
              clubId: expectedClubId,
              coachId: resolved.uid,
              coachName: resolved.fullName || tx("Entrenador", "Coach"),
              coachEmail: resolved.email || "",
              clubInviteCode: ""
            })
              .then((updated) => onProfileUpdated(updated))
              .catch(() => {});
          }
        } else {
          setCoachProfile(null);
        }
      } catch (e) {
        console.error("Error loading coach profile:", e);
      }
    }
    loadCoachInfo();
    return () => {
      cancelled = true;
    };
  }, [user.uid, user.clubId, user.coachId, user.isClubCreator, user.role]);

  // Load linked students for the Coach profile section & ensure Coach's 6-digit invite code is persisted in cloud
  useEffect(() => {
    let cancelled = false;
    async function loadCoachStudents() {
      if (!isCoachProfile) {
        setCoachStudents([]);
        return;
      }
      try {
        const { getLocalSetting, saveLocalSetting, isFictitiousUser } = await import(
          "@/lib/db/indexedDB"
        );
        const { generateClubInviteCode } = await import("@/lib/authService");
        const canonicalClubId = getCanonicalCoachClubId(user);

        if (
          !user.clubInviteCode ||
          !/^\d{6}$/.test(user.clubInviteCode) ||
          user.clubId !== canonicalClubId ||
          !user.isClubCreator
        ) {
          const codeToUse =
            user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode)
              ? user.clubInviteCode
              : generateClubInviteCode();
          updateProfile(user.uid, {
            clubInviteCode: codeToUse,
            clubId: canonicalClubId,
            isClubCreator: true
          })
            .then((updated) => onProfileUpdated(updated))
            .catch(() => {});
        }

        const unlinkedIds = await getLocalSetting<string[]>(
          `unlinked_athletes_${canonicalClubId}`,
          []
        );
        const matchStudent = (u: UserProfile): boolean => {
          if (!u || !u.uid || u.uid === user.uid || isFictitiousUser(u)) return false;
          if (u.coachId === user.uid) return true;
          if (u.coachId && u.coachId !== user.uid && user.role !== "superadmin") return false;
          if (unlinkedIds.includes(u.uid)) return false;
          if (u.clubId === canonicalClubId || (!!user.clubId && u.clubId === user.clubId))
            return true;
          if (user.role === "superadmin" && isLinkedToExternalCoach(u)) return true;
          return false;
        };

        const localList = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const mergedMap = new Map<string, UserProfile>();
        for (const u of localList) {
          if (matchStudent(u)) mergedMap.set(u.uid, u);
        }

        if (typeof navigator !== "undefined" && navigator.onLine) {
          try {
            const { collection, query, where, limit, getDocs } = await import(
              "firebase/firestore"
            );
            const { db } = await import("@/lib/firebase");

            const addDocSnap = (d: any) => {
              const raw = d.data() as UserProfile;
              const uid = raw?.uid || d.id;
              if (!raw || !uid || uid === user.uid) return;
              const u = { ...raw, uid };
              if (matchStudent(u)) {
                mergedMap.set(uid, u);
              }
            };

            const [snapByCoach, snapByClub] = await Promise.all([
              getDocs(
                query(collection(db, "users"), where("coachId", "==", user.uid), limit(250))
              ).catch(() => null),
              getDocs(
                query(collection(db, "users"), where("clubId", "==", canonicalClubId), limit(250))
              ).catch(() => null)
            ]);
            snapByCoach?.forEach(addDocSnap);
            snapByClub?.forEach(addDocSnap);

            if (user.role === "superadmin") {
              const snapAll = await getDocs(query(collection(db, "users"), limit(50))).catch(
                () => null
              );
              snapAll?.forEach(addDocSnap);
            }

            if (mergedMap.size > 0) {
              const updatedLocal = [...localList];
              for (const student of mergedMap.values()) {
                const idx = updatedLocal.findIndex((x) => x.uid === student.uid);
                if (idx === -1) updatedLocal.push(student);
                else updatedLocal[idx] = { ...updatedLocal[idx], ...student };
              }
              await saveLocalSetting("simulated_users", updatedLocal);
            }
          } catch (err) {
            console.warn("Could not fetch linked students in ProfileView:", err);
          }
        }

        if (!cancelled) {
          setCoachStudents(Array.from(mergedMap.values()));
        }
      } catch (err) {
        console.warn("Error loading coach students:", err);
      }
    }
    loadCoachStudents();
    const handleRosterChange = () => loadCoachStudents();
    const handleDbChange = (e: any) => {
      if (!e?.detail || e.detail.store === "simulated_users") {
        loadCoachStudents();
      }
    };
    window.addEventListener("users-roster-updated", handleRosterChange);
    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      cancelled = true;
      window.removeEventListener("users-roster-updated", handleRosterChange);
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [isCoachProfile, user.uid, user.clubId, user.clubInviteCode, user.isClubCreator, user.role]);

  const handleJoinClub = async () => {
    if (!athleteInviteCode.trim()) return;
    setIsJoiningClub(true);
    setClubJoinFeedback(null);
    try {
      const res = await joinClubByInviteCode(user.uid, athleteInviteCode.trim());
      if (res.success && res.user) {
        triggerHaptic("confirm");
        setClubJoinFeedback({
          type: "success",
          message: tx(
            `¡Te has vinculado exitosamente con tu entrenador${res.clubName ? ` (${res.clubName})` : ""}!`,
            `Successfully linked with your Coach${res.clubName ? ` (${res.clubName})` : ""}!`
          )
        });
        onProfileUpdated(res.user);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
        setAthleteInviteCode("");
      } else {
        triggerHaptic("miss");
        setClubJoinFeedback({
          type: "error",
          message:
            res.error ||
            tx(
              "No se encontró el entrenador o el código de 6 dígitos es inválido.",
              "Coach not found or invalid 6-digit code."
            )
        });
      }
    } catch (err: any) {
      setClubJoinFeedback({
        type: "error",
        message:
          err?.message ||
          tx("Error al intentar vincularte con tu entrenador.", "Error linking with your Coach.")
      });
    } finally {
      setIsJoiningClub(false);
    }
  };

  const handleLeaveClub = async () => {
    if (
      !(await showOledConfirm(
        tx(
          "¿Estás seguro de que deseas desvincularte de tu entrenador?",
          "Are you sure you want to unlink from your Coach?"
        )
      ))
    )
      return;
    try {
      const res = await leaveCurrentClub(user.uid);
      if (res.success && res.user) {
        triggerHaptic("confirm");
        setClubJoinFeedback({
          type: "success",
          message: tx(
            "Te has desvinculado de tu entrenador exitosamente.",
            "Successfully unlinked from your Coach."
          )
        });
        setCoachProfile(null);
        onProfileUpdated(res.user);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
      }
    } catch (err) {
      console.error("Error leaving coach:", err);
    }
  };

  // Load notification toggles from settings
  useEffect(() => {
    async function loadToggles() {
      const push = await getLocalSetting("notif_push", true);
      setPushNotif(push);
    }
    loadToggles();
  }, [user]);

  const resolveCanonicalBiometrics = () => {
    if (unitSystem === "imperial") {
      const ft = parseLocaleDecimal(heightFt, 0);
      const inch = parseLocaleDecimal(heightIn, 0);
      const hCm = ft > 0 || inch > 0 ? feetInchesToCm(ft, inch) : 0;
      const lbs = parseLocaleDecimal(weightLbs, 0);
      const wKg = lbs > 0 ? lbsToKg(lbs) : 0;
      return { height: hCm, weight: wKg };
    }
    const hCm = Math.max(0, Math.round(parseLocaleDecimal(heightCm, 0)));
    const wKg = Math.max(0, Math.round(parseLocaleDecimal(weightKg, 0) * 10) / 10);
    return { height: hCm, weight: wKg };
  };

  const handleSavePersonal = async () => {
    try {
      const { height: parsedHeight, weight: parsedWeight } = resolveCanonicalBiometrics();
      const primaryHand =
        bowsList[0]?.hand ||
        user.bowConfig?.hand ||
        (user.physicalData?.dominantHand === "L" ? "LH" : "RH");
      const formattedPhone = formatPhoneForSave(clubWhatsApp, country);
      const updated = await updateProfile(user.uid, {
        fullName,
        nickname,
        clubName: clubName.trim() || null,
        birthDate,
        city,
        country,
        gender,
        unitSystem,
        whatsappNumber: formattedPhone,
        physicalData: {
          height: parsedHeight,
          weight: parsedWeight,
          dominantEye: user.physicalData?.dominantEye || (primaryHand === "LH" ? "L" : "R"),
          dominantHand: user.physicalData?.dominantHand || (primaryHand === "LH" ? "L" : "R")
        }
      });
      onProfileUpdated(updated);
      setEditPersonal(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveBow = async () => {
    try {
      const cleanedBows: BowConfig[] = bowsList.map((b, idx) => {
        const parsedPoundage = Math.max(
          0,
          Math.round(parseLocaleDecimal(b.poundageInput, 0) * 10) / 10
        );
        const parsedDrawLength = Math.max(
          0,
          Math.round(parseLocaleDecimal(b.drawLengthInput, 0) * 100) / 100
        );
        return {
          id: b.id || `BOW-${idx + 1}`,
          name: idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`,
          type: b.type || "Recurve",
          brand: b.brand?.trim() || (idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`),
          model: b.model?.trim() || "",
          poundage: parsedPoundage,
          drawLength: parsedDrawLength,
          hand: b.hand || "RH",
          defaultDistance:
            Number(b.defaultDistance) ||
            (b.type === "Compound" ? 50 : b.type === "Recurve" ? 70 : 18)
        };
      });

      const primaryBow = cleanedBows[0];

      const updated = await updateProfile(user.uid, {
        unitSystem,
        bowConfig: primaryBow,
        bows: cleanedBows,
        physicalData: {
          height: user.physicalData?.height || 0,
          weight: user.physicalData?.weight || 0,
          dominantEye: user.physicalData?.dominantEye || (primaryBow.hand === "LH" ? "L" : "R"),
          dominantHand: primaryBow.hand === "LH" ? "L" : "R"
        }
      });
      onProfileUpdated(updated);
      setEditBow(false);
    } catch (e) {
      console.error("Error saving bow configuration:", e);
    }
  };

  const handleSaveClubWhatsApp = async () => {
    try {
      const normalized = formatPhoneForSave(clubWhatsApp, country);
      if (normalized) {
        setClubWhatsApp(normalized);
      }
      const updated = await updateProfile(user.uid, {
        whatsappNumber: normalized
      });
      onProfileUpdated(updated);
      await showOledAlert(
        tx(
          "Teléfono / Mensajería del Coach guardado correctamente",
          "Coach Phone / Messaging saved"
        )
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleShareInviteCode = async () => {
    const code = user.clubInviteCode;
    if (!code || !/^\d{6}$/.test(code)) return;
    const shareText = tx(
      `Únete a mi equipo en ARCHERY 101010 con mi código de Coach de 6 dígitos: ${code}`,
      `Join my team on ARCHERY 101010 using my 6-digit Coach code: ${code}`
    );

    // Prefer universal native OS Share Sheet first (works across all regional messaging apps)
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "ARCHERY 101010",
          text: shareText
        });
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
        await showOledAlert(
          tx(
            `Código ${code} copiado al portapapeles.`,
            `Invite code ${code} copied to clipboard.`
          )
        );
        return;
      } catch {}
    }

    if (typeof window !== "undefined") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(shareText)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  };

  const handleLogoutClick = async () => {
    const confirmLogout = await showOledConfirm(
      tx(
        "¿Seguro que deseas cerrar sesión? Cualquier sesión activa, duelo o proceso que tengas abierto se cerrará.",
        "Are you sure you want to log out? Any active session or live match will be closed."
      ),
      { confirmLabel: t("logout"), cancelLabel: t("cancel") }
    );
    if (!confirmLogout) return;
    if (typeof window !== "undefined") {
      (window as any).__archeryManualLogout = true;
    }
    onLogout();
  };

  const handleConfirmDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await deleteUserAccount(user.uid);
      setIsDeleteAccountOpen(false);
      onLogout();
    } catch (e: any) {
      console.error("Error deleting user account:", e);
      await showOledAlert(
        e?.message ||
          tx(
            "Por seguridad, cierra sesión y vuelve a ingresar antes de eliminar tu cuenta.",
            "For security, please log out and sign in again before deleting your account."
          )
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleNotifToggle = async (
    key: string,
    currentVal: boolean,
    setVal: (v: boolean) => void
  ) => {
    const nextVal = !currentVal;
    setVal(nextVal);
    await saveLocalSetting(key, nextVal);

    if (key === "notif_push" && nextVal === true) {
      try {
        const { configurePushOrInAppNotifications } = await import("@/lib/pushNotifications");
        const outcome = await configurePushOrInAppNotifications(user.uid);
        if (outcome.enabled) {
          await showOledAlert(outcome.message);
        } else {
          await showOledAlert(outcome.message);
          setVal(false);
          await saveLocalSetting(key, false);
        }
      } catch (err) {
        console.error("Error activating push notifications:", err);
        await showOledAlert(
          tx(
            "Alertas internas de la app activadas en este dispositivo.",
            "In-app alerts enabled on this device."
          )
        );
      }
    }
  };

  const coachE164 = normalizeE164Digits(
    coachProfile?.whatsappNumber,
    coachProfile?.country || user.country
  );

  const currentDialCode = COUNTRIES_MAP[country]?.dialCode || "+506";

  const renderBiometricEditInputs = () => {
    if (unitSystem === "imperial") {
      return (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-white uppercase font-black tracking-wider truncate">
              {t("heightImperialFeet")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={heightFt}
              onChange={(e) => setHeightFt(e.target.value)}
              className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3 rounded-xl outline-none tabular-nums transition"
              placeholder="5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-white uppercase font-black tracking-wider truncate">
              {t("heightImperialInches")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={heightIn}
              onChange={(e) => setHeightIn(e.target.value)}
              className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3 rounded-xl outline-none tabular-nums transition"
              placeholder="9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] text-white uppercase font-black tracking-wider truncate">
              {t("weightImperialLbs")}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={weightLbs}
              onChange={(e) => setWeightLbs(e.target.value)}
              className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3 rounded-xl outline-none tabular-nums transition"
              placeholder={tx("Ej. 158,5", "e.g. 158.5")}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
            {t("height")}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none tabular-nums transition"
            placeholder={tx("Ej. 175", "e.g. 175")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
            {t("weight")}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none tabular-nums transition"
            placeholder={tx("Ej. 72,5", "e.g. 72.5")}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5 py-4 min-h-full w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="w-9 h-9 rounded-xl bg-[#0D1017] border border-white/[0.08] text-white hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 className="text-white text-[20.2px] sm:text-[22.8px] font-black uppercase tracking-wide truncate leading-tight">
            {t("settingsTitle")}
          </h2>
        </div>
      </div>

      {/* User Header Profile Card */}
      <div className="bg-[#0D1017] p-4 rounded-3xl border border-white/[0.08] flex items-center gap-4 relative overflow-hidden">
        <div className="w-15 h-15 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/40 flex items-center justify-center text-cyan-neon font-black text-[20.7px] shrink-0">
          {user.fullName.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-extrabold text-[18.4px] truncate">{user.fullName}</span>
            <span
              className={`text-[12.1px] font-black px-2.5 py-0.5 rounded-full uppercase whitespace-nowrap shrink-0 ${
                user.plan === "PRO"
                  ? "bg-yellow-gold/10 border border-yellow-gold/30 text-yellow-gold"
                  : "bg-white/[0.06] border border-white/15 text-white"
              }`}
            >
              {user.plan}
            </span>
          </div>
          <span className="text-[13.3px] text-white mt-0.5 truncate">{user.email}</span>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[12.1px] bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon font-black px-2.5 py-0.5 rounded-full uppercase whitespace-nowrap">
              {user.role === "archer"
                ? t("roleAthlete")
                : user.role === "coach"
                ? t("roleCoach")
                : user.role === "team_admin_coach"
                ? "Admin / Coach"
                : user.role === "team_admin"
                ? t("roleAdmin")
                : user.role === "superadmin"
                ? "Super Admin"
                : user.role}
            </span>
            {user.nickname && (
              <span className="text-[12.1px] text-white font-bold tabular-nums truncate">
                @{user.nickname}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 1: Personal Data */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 md:p-5 flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-white/5 pb-3">
          <h4 className="text-white text-[13.8px] md:text-[16.1px] font-black uppercase tracking-wider">
            {t("personalData")}
          </h4>
          <button
            type="button"
            onClick={() => {
              if (editPersonal) handleSavePersonal();
              else setEditPersonal(true);
            }}
            className="h-8 px-3.5 rounded-lg bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[13.3px] font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center"
          >
            {editPersonal ? t("save") : tx("Editar", "Edit")}
          </button>
        </div>

        {editPersonal ? (
          <div className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                  {t("fullName")}
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition"
                  placeholder=""
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest truncate">
                  {t("nickname")}
                </label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition"
                  placeholder=""
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                  {t("birthDate")}
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="h-11 min-w-0 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-xs sm:text-sm px-2.5 rounded-xl outline-none uppercase [color-scheme:dark] tabular-nums transition"
                />
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                  {t("city")}
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="h-11 min-w-0 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition"
                  placeholder={t("city")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                  {t("country")}
                </label>
                <select
                  value={country}
                  onChange={(e) => handleCountryChangeInProfile(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none [color-scheme:dark] transition"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-black text-white">
                      {c.flag} {getLocalizedCountryName(c.code, language)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                  {t("gender")}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none [color-scheme:dark] transition"
                >
                  <option value="M" className="bg-black text-white">
                    {t("genderM")}
                  </option>
                  <option value="F" className="bg-black text-white">
                    {t("genderF")}
                  </option>
                  <option value="O" className="bg-black text-white">
                    {t("genderO")}
                  </option>
                </select>
              </div>
            </div>

            {/* Regional Height / Weight Inputs */}
            {renderBiometricEditInputs()}

            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] text-white uppercase font-black tracking-wider truncate">
                  {t("phoneMessagingLabel")}
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={clubWhatsApp}
                  onChange={(e) => setClubWhatsApp(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none tabular-nums transition"
                  placeholder={`${currentDialCode} 88888888`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] text-white uppercase font-black tracking-wider truncate">
                  {tx("Club (Opcional)", "Club (Optional)")}
                </label>
                <input
                  type="text"
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                  className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition"
                  placeholder={tx("Club (Opcional)", "Club (Optional)")}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {t("fullName")}:
              </span>
              <span className="text-white text-[13.8px] font-bold">{user.fullName}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {tx("Alias para Retos:", "Match Alias:")}
              </span>
              <span className="text-cyan-neon text-[13.8px] tabular-nums font-bold">
                @{user.nickname || "arquero"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {tx("Club (Opcional):", "Club (Optional):")}
              </span>
              <span className="text-white text-[13.8px] font-bold">{clubName.trim() || "—"}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {t("birthDate")}:
              </span>
              <span className="text-white text-[13.8px] tabular-nums font-bold">
                {user.birthDate ? formatRegionalDate(user.birthDate, language) : "—"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {t("city")}:
              </span>
              <span className="text-white text-[13.8px] font-bold">{user.city || "—"}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {t("country")}:
              </span>
              <span className="text-white text-[13.8px] font-bold">
                {COUNTRIES_MAP[user.country]?.flag ||
                  COUNTRIES.find((c) => c.code === user.country)?.flag}{" "}
                {getLocalizedCountryName(user.country, language)}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {t("gender")}:
              </span>
              <span className="text-white text-[13.8px] font-bold">
                {user.gender === "M"
                  ? t("genderM")
                  : user.gender === "F"
                  ? t("genderF")
                  : t("genderO")}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-gray-border/20">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {unitSystem === "imperial"
                  ? tx("Estatura (ft/in):", "Height (ft/in):")
                  : `${t("height")}:`}
              </span>
              <span className="text-white text-[13.8px] tabular-nums font-bold">
                {formatHeightRegional(user.physicalData?.height, unitSystem)}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                {unitSystem === "imperial" ? `${t("weightImperialLbs")}:` : `${t("weight")}:`}
              </span>
              <span className="text-white text-[13.8px] tabular-nums font-bold">
                {formatWeightRegional(user.physicalData?.weight, unitSystem)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Bow configuration (Arco #1, Arco #2, Arco #3) */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 md:p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-cyan-neon" />
            <h4 className="text-white text-[13.8px] md:text-[16.1px] font-black uppercase tracking-wider">
              {t("bowConfig")}
            </h4>
          </div>
          <button
            type="button"
            onClick={() => {
              if (editBow) handleSaveBow();
              else setEditBow(true);
            }}
            className="h-8 px-3.5 rounded-lg bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[13.3px] font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center"
          >
            {editBow ? t("save") : tx("Editar", "Edit")}
          </button>
        </div>

        {editBow ? (
          <div className="flex flex-col gap-4">
            {bowsList.map((bow, idx) => {
              const bowNumber = idx + 1;
              const isPrimary = idx === 0;

              return (
                <div
                  key={bow.id || idx}
                  className="bg-neutral-950/80 border border-white/10 rounded-2xl p-4 flex flex-col gap-3.5 shadow-md relative"
                >
                  {/* Bow Header */}
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <h5 className="text-white text-[13.8px] font-black uppercase tracking-wider tabular-nums">
                      {tx(`Arco #${bowNumber}`, `Bow #${bowNumber}`)}
                    </h5>

                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBow(idx)}
                        className="h-7 px-2.5 rounded-lg bg-white hover:bg-neutral-200 border border-white text-black text-[13.3px] font-black flex items-center gap-1.5 transition cursor-pointer"
                        title={tx("Eliminar este arco", "Delete this bow")}
                      >
                        <Trash2 size={12} />
                        <span>{t("delete")}</span>
                      </button>
                    )}
                  </div>

                  {/* Tipo de Arco Selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                      {t("bowType")}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {(["Recurve", "Compound", "Barebow"] as const).map((typeOption) => {
                        const isSelected = bow.type === typeOption;
                        const label =
                          typeOption === "Recurve"
                            ? t("bowRecurve")
                            : typeOption === "Compound"
                            ? t("bowCompound")
                            : t("bowBarebow");
                        return (
                          <button
                            key={typeOption}
                            type="button"
                            onClick={() => handleUpdateBow(idx, { type: typeOption })}
                            className={`h-10 px-1 flex items-center justify-center rounded-xl text-[12.6px] sm:text-[15px] font-black uppercase tracking-tighter sm:tracking-tight whitespace-nowrap truncate transition border cursor-pointer ${
                              isSelected
                                ? "bg-cyan-neon text-black border-cyan-neon"
                                : "bg-neutral-900 text-white border-white/5 hover:border-white/15 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fila: Marca y Modelo */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                        {t("bowBrand")}
                      </label>
                      <input
                        type="text"
                        value={bow.brand}
                        onChange={(e) => handleUpdateBow(idx, { brand: e.target.value })}
                        placeholder={tx("Ej. Olímpico, Pro", "e.g. Olympic, Pro")}
                        className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition placeholder:text-white/40"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                        {t("bowModel")}
                      </label>
                      <input
                        type="text"
                        value={bow.model}
                        onChange={(e) => handleUpdateBow(idx, { model: e.target.value })}
                        placeholder={tx("Ej. Competición", "e.g. Competition")}
                        className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] px-3.5 rounded-xl outline-none transition placeholder:text-white/40"
                      />
                    </div>
                  </div>

                  {/* Fila: Potencia y Apertura (Decimal comma friendly) */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                        {t("poundage")}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={bow.poundageInput}
                          onChange={(e) => handleUpdateBow(idx, { poundageInput: e.target.value })}
                          placeholder={tx("Ej. 38,5", "e.g. 38.5")}
                          className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] pl-3.5 pr-12 rounded-xl outline-none tabular-nums transition placeholder:text-white/40"
                        />
                        <span className="absolute right-3 text-[14.7px] text-cyan-neon font-black pointer-events-none uppercase">
                          lbs
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                        {tx("Apertura", "Draw Length")}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={bow.drawLengthInput}
                          onChange={(e) =>
                            handleUpdateBow(idx, { drawLengthInput: e.target.value })
                          }
                          placeholder={tx("Ej. 28,5", "e.g. 28.5")}
                          className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-[13.8px] pl-3.5 pr-10 rounded-xl outline-none tabular-nums transition placeholder:text-white/40"
                        />
                        <span className="absolute right-3.5 text-[16.1px] text-cyan-neon font-black pointer-events-none">
                          &quot;
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Fila: Lateralidad / Orientación */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13.3px] text-white uppercase font-black tracking-widest">
                      {t("dominantHand")}
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateBow(idx, { hand: "RH" })}
                        className={`h-11 flex items-center justify-center rounded-xl text-[13.8px] font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
                          (bow.hand || "RH") === "RH"
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-neutral-900 text-white border-white/5 hover:border-white/15 hover:text-white"
                        }`}
                      >
                        {tx("Diestro (RH)", "Right-Handed (RH)")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateBow(idx, { hand: "LH" })}
                        className={`h-11 flex items-center justify-center rounded-xl text-[13.8px] font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
                          bow.hand === "LH"
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-neutral-900 text-white border-white/5 hover:border-white/15 hover:text-white"
                        }`}
                      >
                        {tx("Zurdo (LH)", "Left-Handed (LH)")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {bowsList.length === 1 && (
              <button
                type="button"
                onClick={handleAddBow}
                className="h-12 w-full rounded-xl border border-dashed border-cyan-neon/30 hover:border-cyan-neon bg-cyan-neon/5 hover:bg-cyan-neon/10 text-cyan-neon font-black text-[13.8px] uppercase tracking-widest flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99]"
              >
                <Plus size={15} />
                <span>{tx("+ Agregar Arco #2", "+ Add Bow #2")}</span>
              </button>
            )}

            {bowsList.length === 2 && (
              <button
                type="button"
                onClick={handleAddBow}
                className="h-12 w-full rounded-xl border border-dashed border-cyan-neon/30 hover:border-cyan-neon bg-cyan-neon/5 hover:bg-cyan-neon/10 text-cyan-neon font-black text-[13.8px] uppercase tracking-widest flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99]"
              >
                <Plus size={15} />
                <span>{tx("+ Agregar Arco #3", "+ Add Bow #3")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSaveBow}
              className="h-12 w-full rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-[13.8px] uppercase tracking-widest flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99]"
            >
              <Check size={16} strokeWidth={3} />
              <span>{tx("Guardar Arcos", "Save Bows")}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bowsList.map((bow, idx) => {
              const bowNumber = idx + 1;
              const isPrimary = idx === 0;
              const typeName =
                bow.type === "Recurve"
                  ? t("bowRecurve")
                  : bow.type === "Compound"
                  ? t("bowCompound")
                  : t("bowBarebow");

              return (
                <div
                  key={bow.id || idx}
                  className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-md"
                >
                  <div className="border-b border-white/5 pb-2 flex items-center justify-between">
                    <span className="text-white text-[13.8px] font-black uppercase tracking-wider tabular-nums">
                      {tx(`Arco #${bowNumber}`, `Bow #${bowNumber}`)}{" "}
                      {isPrimary && (
                        <span className="text-white font-bold text-[13.3px]">
                          ({tx("Principal", "Primary")})
                        </span>
                      )}
                    </span>
                    <span className="text-[13.3px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon">
                      {typeName}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="min-h-[48px] bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-0">
                      <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                        {t("bowBrand")}
                      </span>
                      <span className="text-white text-[13.8px] font-bold truncate">
                        {bow.brand || tx("Sin especificar", "Unspecified")}
                      </span>
                    </div>
                    <div className="min-h-[48px] bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-0">
                      <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                        {t("bowModel")}
                      </span>
                      <span className="text-white text-[13.8px] font-bold truncate">
                        {bow.model || tx("Sin especificar", "Unspecified")}
                      </span>
                    </div>
                    <div className="min-h-[48px] h-auto py-2 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center min-w-0">
                      <span className="text-[12.1px] text-white uppercase font-black tracking-wider leading-tight">
                        {tx("Potencia / Apertura", "Draw Weight / Length")}
                      </span>
                      <span className="text-white text-[13.8px] font-bold tabular-nums">
                        {bow.poundage ? `${bow.poundage} lbs` : "-"}
                        {bow.drawLength ? ` • ${bow.drawLength}"` : ""}
                      </span>
                    </div>
                    <div className="min-h-[48px] bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-0">
                      <span className="text-[12.1px] text-white uppercase font-black tracking-widest">
                        {tx("Orientación", "Handedness")}
                      </span>
                      <span className="text-cyan-neon text-[13.8px] font-black uppercase truncate">
                        {(bow.hand || "RH") === "RH"
                          ? tx("Diestro (RH)", "Right (RH)")
                          : tx("Zurdo (LH)", "Left (LH)")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {bowsList.length < 3 && (
              <p className="text-[13.3px] text-white text-center pt-0.5 italic">
                {bowsList.length === 1
                  ? tx(
                      '¿Tienes otro arco? Toca "Editar" para registrar tu Arco #2.',
                      'Have another bow? Tap "Edit" to register Bow #2.'
                    )
                  : tx(
                      '¿Tienes un tercer arco? Toca "Editar" para registrar tu Arco #3.',
                      'Have a third bow? Tap "Edit" to register Bow #3.'
                    )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: Preferences Notifications */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-white text-[13.8px] font-black uppercase tracking-wider">
            {t("pushNotif")}
          </span>
          <span className="text-[13.3px] text-white leading-snug">
            {tx(
              "Alertas de retos, duelos 1v1 y recordatorios",
              "Match challenges, 1v1 duels, and training reminders"
            )}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pushNotif}
          aria-label={t("pushNotif")}
          onClick={() => handleNotifToggle("notif_push", pushNotif, setPushNotif)}
          className={`w-10 h-6 rounded-full relative transition-colors cursor-pointer shrink-0 ${
            pushNotif ? "bg-cyan-neon" : "bg-neutral-800 border border-white/10"
          }`}
        >
          <div
            className="w-4.5 h-4.5 bg-white rounded-full absolute top-[3px] transition-all shadow-md"
            style={{ left: pushNotif ? "19px" : "3px" }}
          />
        </button>
      </div>

      {/* SECTION 4.5: Mi Entrenador (Coach) */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-white text-[13.8px] font-black uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-cyan-neon" />
            {tx("Mi Entrenador (Coach)", "My Coach")}
          </h4>
          {linkedToCoach && (
            <span className="text-[14.5px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-neon/15 text-white border border-cyan-neon/35 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-neon" />{" "}
              {tx("Vinculado", "Linked")}
            </span>
          )}
        </div>

        {clubJoinFeedback && (
          <div
            className={`p-3.5 rounded-2xl text-[16.6px] font-bold flex items-center justify-center text-center gap-2.5 border ${
              clubJoinFeedback.type === "success"
                ? "bg-cyan-neon/10 border-cyan-neon/35 text-white"
                : "bg-white border-white text-black"
            }`}
          >
            {clubJoinFeedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-cyan-neon" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-black" />
            )}
            <span className="leading-snug">{clubJoinFeedback.message}</span>
          </div>
        )}

        {linkedToCoach ? (
          <div className="flex flex-col gap-3">
            <div className="bg-neutral-950/30 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.1px] text-white uppercase font-black tracking-wider flex items-center gap-1">
                  <Users className="w-3 h-3 text-cyan-neon" />{" "}
                  {tx("Tu Entrenador", "Your Coach")}
                </span>
                {coachE164 && (
                  <a
                    href={`https://wa.me/${coachE164}?text=${encodeURIComponent(
                      tx(
                        `Hola Coach ${coachProfile?.fullName || ""}, soy ${user.fullName}. Te escribo desde ARCHERY 101010.`,
                        `Hi Coach ${coachProfile?.fullName || ""}, this is ${user.fullName} reaching out from ARCHERY 101010.`
                      )
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-[13.3px] font-black uppercase tracking-wider inline-flex items-center gap-1.5 transition-all"
                  >
                    <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />{" "}
                    {t("messagingLabel")}
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 min-w-0 text-[13.8px]">
                <span className="text-white font-bold truncate min-w-0">
                  {coachProfile?.fullName || user.coachName || tx("Entrenador Asignado", "Assigned Coach")}
                </span>
                <span className="text-[13.3px] text-white truncate min-w-0">
                  {coachProfile?.email || user.coachEmail || tx("En línea", "Online")}
                </span>
              </div>
              <div className="bg-cyan-brand/10 border border-cyan-neon/15 rounded-xl p-2 text-[13.3px] text-cyan-300 leading-snug flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-neon shrink-0" />
                <span>
                  {tx(
                    "Tus planillas y series se sincronizan en tiempo real con el panel de tu coach.",
                    "Your scorecards and ends sync in real time with your Coach's dashboard."
                  )}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleLeaveClub}
                className="text-[13.8px] bg-white hover:bg-neutral-200 text-black font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer py-1.5 px-3"
              >
                {tx("Desvincularme del Coach", "Unlink from Coach")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[14.7px] text-white leading-snug">
              {tx(
                "Pídele a tu entrenador su código de 6 dígitos para vincularte como su alumno. Al vincularte, tu entrenador podrá ver tus planillas de tiro, puntuaciones y darte retroalimentación al instante.",
                "Ask your Coach for their 6-digit invite code to link your account. Once linked, your Coach can follow your scorecards, arrow plots, and progress in real time."
              )}
            </p>

            <div className="flex gap-2 min-w-0">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={athleteInviteCode}
                onChange={(e) =>
                  setAthleteInviteCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                }
                placeholder={tx("Código de 6 dígitos", "6-digit code")}
                className="flex-1 min-w-0 bg-neutral-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-[13.8px] text-white uppercase tabular-nums tracking-wider placeholder:text-white/50 outline-none focus:border-cyan-neon transition-colors"
              />
              <button
                type="button"
                onClick={handleJoinClub}
                disabled={!athleteInviteCode.trim() || isJoiningClub}
                className="shrink-0 px-4 py-2.5 bg-cyan-neon text-black font-black text-[13.8px] uppercase tracking-wider rounded-2xl hover:bg-[#19c8ff] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {isJoiningClub ? tx("Vinculando...", "Linking...") : tx("Vincular", "Link")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 5: Coach settings */}
      {isCoachProfile && (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center gap-2 min-w-0">
            <h4 className="text-white text-[13.8px] font-black uppercase tracking-wider truncate">
              {tx("Configuración de Coach", "Coach Settings")}
            </h4>
            {user.role !== "superadmin" && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    await showOledConfirm(
                      tx(
                        "¿Deseas desactivar el modo Coach en tu cuenta y volver a perfil exclusivo de Atleta?",
                        "Switch off Coach mode and return to Athlete-only profile?"
                      )
                    )
                  ) {
                    const res = await leaveCurrentClub(user.uid);
                    if (res.success && res.user) {
                      setCoachProfile(null);
                      setCoachStudents([]);
                      onProfileUpdated(res.user);
                      window.dispatchEvent(
                        new CustomEvent("current-user-updated", { detail: { user: res.user } })
                      );
                    }
                  }
                }}
                className="text-[12.1px] text-white hover:text-white underline font-bold cursor-pointer shrink-0"
              >
                {tx("Volver a modo Atleta", "Switch to Athlete Mode")}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 mt-1">
            {/* Invite code (6 dígitos) + Universal Share */}
            <div className="flex flex-col gap-1">
              <span className="text-[12.1px] text-white font-bold uppercase tracking-wider">
                {t("inviteCode")}
              </span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex-1 min-w-0 text-[16.1px] tabular-nums font-black text-cyan-neon tracking-widest bg-neutral-950 p-2.5 rounded-xl border border-white/5 text-center select-all truncate">
                  {user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode)
                    ? user.clubInviteCode
                    : "······"}
                </span>
                {user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode) && (
                  <button
                    type="button"
                    onClick={handleShareInviteCode}
                    className="shrink-0 px-3 py-2.5 bg-cyan-neon/15 border border-cyan-neon/25 rounded-xl text-cyan-neon hover:text-white text-[13.8px] font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                    title={t("share")}
                  >
                    <Share2 size={14} aria-hidden="true" />
                    <span>{t("share")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (
                      await showOledConfirm(
                        tx(
                          "¿Deseas generar un código de 6 dígitos para tus alumnos?",
                          "Generate a new 6-digit invite code for your athletes?"
                        )
                      )
                    ) {
                      const { generateClubInviteCode, updateProfile } = await import(
                        "@/lib/authService"
                      );
                      const freshCode = generateClubInviteCode();
                      const canonicalClubId = getCanonicalCoachClubId(user);
                      const updated = await updateProfile(user.uid, {
                        clubInviteCode: freshCode,
                        clubId: canonicalClubId,
                        isClubCreator: true
                      });
                      onProfileUpdated(updated);
                      window.dispatchEvent(
                        new CustomEvent("current-user-updated", { detail: { user: updated } })
                      );
                      await showOledAlert(
                        tx(
                          `Nuevo código de 6 dígitos generado: ${freshCode}`,
                          `New 6-digit code generated: ${freshCode}`
                        )
                      );
                    }
                  }}
                  className="shrink-0 px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-cyan-neon hover:text-white text-[13.8px] font-bold transition cursor-pointer active:scale-95"
                  title={tx("Generar nuevo código de 6 dígitos", "Generate new 6-digit code")}
                >
                  {tx("Nuevo", "New")}
                </button>
              </div>
            </div>

            {/* Coach personal messaging phone with dialCode suggestion */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.1px] text-white font-bold uppercase tracking-wider">
                  {t("clubWhatsApp")}
                </span>
                <span className="text-[11px] text-cyan-neon font-bold tabular-nums">
                  {COUNTRIES_MAP[country]?.emoji} {currentDialCode}
                </span>
              </div>
              <div className="flex gap-2 min-w-0">
                <input
                  type="tel"
                  inputMode="tel"
                  value={clubWhatsApp}
                  onChange={(e) => setClubWhatsApp(e.target.value)}
                  className="flex-1 min-w-0 bg-neutral-950 border border-gray-border text-white text-[13.8px] p-2.5 rounded-xl outline-none tabular-nums"
                  placeholder={`${currentDialCode} 88888888`}
                />
                <button
                  type="button"
                  onClick={handleSaveClubWhatsApp}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-cyan-neon/15 border border-cyan-neon/20 text-cyan-neon font-black text-[13.8px] cursor-pointer active:scale-95 transition"
                >
                  {t("save")}
                </button>
              </div>
            </div>

            {/* Linked students roster directly in Coach Profile */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-[12.1px] text-white font-bold uppercase tracking-wider tabular-nums truncate">
                  {tx(
                    `Mis Alumnos Vinculados (${coachStudents.length})`,
                    `My Linked Athletes (${coachStudents.length})`
                  )}
                </span>
                {(onOpenCoachPortal || onNavigate) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenCoachPortal) onOpenCoachPortal();
                      else if (onNavigate) onNavigate("HOME");
                    }}
                    className="text-[12.1px] text-cyan-neon font-black uppercase tracking-wider hover:underline cursor-pointer"
                  >
                    {tx("Abrir Portal Coach →", "Open Coach Portal →")}
                  </button>
                )}
              </div>

              {coachStudents.length === 0 ? (
                <p className="text-[12.7px] text-white bg-neutral-950/60 border border-white/5 rounded-xl p-3">
                  {tx(
                    "Aún no tienes arqueros vinculados. Comparte tu código de 6 dígitos para que tus alumnos lo ingresen en su Perfil.",
                    "No linked athletes yet. Share your 6-digit code so your athletes can enter it in their Profile."
                  )}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {coachStudents.map((student) => (
                    <div
                      key={student.uid}
                      className="flex items-center justify-between gap-2 bg-neutral-950 border border-white/[0.06] rounded-xl px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-cyan-neon/15 border border-cyan-neon/30 flex items-center justify-center text-cyan-neon font-black text-[13.8px] shrink-0">
                          {(student.fullName || "A").charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[13.8px] font-bold text-white truncate">
                            {student.fullName || tx("Arquero", "Archer")}
                          </span>
                          <span className="text-[11.5px] text-white truncate">
                            {student.email}
                            {student.clubName ? ` • ${student.clubName}` : ""}
                          </span>
                        </div>
                      </div>
                      <span className="text-[11.5px] font-black uppercase tracking-wider text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/20 px-2 py-0.5 rounded-lg shrink-0">
                        {student.bowConfig?.type || "Recurve"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Superadmin Panel Direct Link */}
      {user.role === "superadmin" && onNavigate && (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-5 flex flex-col gap-2.5">
          <h3 className="text-[13.8px] font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Shield size={14} className="text-cyan-neon" />
            <span>{t("adminDashboard")}</span>
          </h3>
          <p className="text-[13.3px] text-white leading-relaxed">
            {tx(
              "Tienes privilegios de Super Administrador para gestionar usuarios, publicidad y ajustes.",
              "You have Super Administrator privileges to manage users, campaigns, and settings."
            )}
          </p>
          <button
            type="button"
            onClick={() => onNavigate("ADMIN")}
            className="w-full py-2.5 rounded-xl bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon font-bold text-[13.8px] uppercase cursor-pointer hover:bg-cyan-neon/20 transition active:scale-98"
          >
            {tx("Abrir Panel Admin", "Open Admin Panel")}
          </button>
        </div>
      )}

      {/* App Language Selector */}
      <LanguageSelector variant="card" />

      {/* Unit System Card (Metric vs Imperial) */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Ruler size={17} className="text-cyan-neon shrink-0" />
            <h4 className="text-white text-[13.8px] font-black uppercase tracking-wider truncate">
              {t("unitSystemLabel")}
            </h4>
          </div>
          <span className="text-[12.1px] font-bold text-cyan-neon bg-cyan-neon/10 border border-cyan-neon/25 px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
            {unitSystem === "imperial" ? "yd · ft/in · lbs" : "m · cm · kg"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleSelectUnitSystem("metric")}
            className={`h-11 px-3.5 rounded-xl border text-[13.3px] font-bold flex items-center justify-between transition cursor-pointer ${
              unitSystem === "metric"
                ? "bg-[#111622] border-cyan-neon text-white"
                : "bg-[#090B0F] border-white/[0.06] text-white hover:border-white/20"
            }`}
          >
            <span className="truncate">{t("unitMetric")}</span>
            {unitSystem === "metric" && <Check size={15} className="text-cyan-neon shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => handleSelectUnitSystem("imperial")}
            className={`h-11 px-3.5 rounded-xl border text-[13.3px] font-bold flex items-center justify-between transition cursor-pointer ${
              unitSystem === "imperial"
                ? "bg-[#111622] border-cyan-neon text-white"
                : "bg-[#090B0F] border-white/[0.06] text-white hover:border-white/20"
            }`}
          >
            <span className="truncate">{t("unitImperial")}</span>
            {unitSystem === "imperial" && <Check size={15} className="text-cyan-neon shrink-0" />}
          </button>
        </div>
      </div>

      {/* Política de Privacidad Button */}
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") {
            if (window.location.protocol === "file:") {
              window.open(
                "https://archery101010-c0bb4.web.app/privacy",
                "_blank",
                "noopener,noreferrer"
              );
            } else {
              window.location.href = "/privacy";
            }
          }
        }}
        className="w-full py-3 mt-1 rounded-full border border-white/10 hover:bg-white/5 text-white hover:text-white font-black text-[13.8px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <Shield size={15} />
        <span>{t("privacyLink")}</span>
      </button>

      {/* Log out Action Button */}
      <button
        type="button"
        onClick={handleLogoutClick}
        className="w-full py-3.5 mt-1 rounded-full bg-white hover:bg-neutral-200 border border-white text-black font-black text-[13.8px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <LogOut size={16} />
        <span>{t("logout")}</span>
      </button>

      {/* Delete Account & Data Action Button (Google Play / App Store Policy Requirement) */}
      <button
        type="button"
        onClick={() => setIsDeleteAccountOpen(true)}
        className="w-full py-2.5 rounded-full border border-white/10 hover:bg-white hover:text-black text-white font-bold text-[14.7px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <Trash2 size={13} />
        <span>{tx("Eliminar mi cuenta y datos", "Delete My Account & Data")}</span>
      </button>

      {/* DELETE ACCOUNT CONFIRMATION MODAL */}
      <AnimatePresence>
        {isDeleteAccountOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              className="w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] p-6 rounded-3xl flex flex-col gap-4 shadow-2xl text-center"
            >
              <div className="w-11 h-11 rounded-2xl bg-white border border-white flex items-center justify-center mx-auto text-black">
                <Trash2 size={20} />
              </div>
              <h3 className="text-white text-[18.4px] font-black tracking-tight">
                {tx("¿Eliminar cuenta permanentemente?", "Permanently delete account?")}
              </h3>
              <p className="text-[13.8px] text-white leading-relaxed">
                {tx(
                  `Esta acción es irreversible. Se eliminarán tu perfil (${user.email}), arcos, sesiones, historial de duelos y récords.`,
                  `This action is irreversible. Your profile (${user.email}), bows, sessions, duel history, and records will be permanently deleted.`
                )}
              </p>
              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={() => setIsDeleteAccountOpen(false)}
                  className="flex-1 h-11 rounded-2xl bg-[#121620] border border-white/[0.08] text-white hover:text-white font-bold text-[13.8px] uppercase tracking-wider cursor-pointer transition"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={handleConfirmDeleteAccount}
                  className="flex-1 h-11 rounded-2xl bg-white hover:bg-neutral-200 border border-white text-black font-black text-[13.8px] uppercase tracking-wider cursor-pointer transition active:scale-95 disabled:opacity-50"
                >
                  {isDeletingAccount ? tx("Eliminando...", "Deleting...") : t("delete")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
