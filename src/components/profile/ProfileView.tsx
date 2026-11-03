"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  UserProfile,
  BowConfig,
  updateProfile,
  logoutUser,
  deleteUserAccount,
  joinClubByInviteCode,
  leaveCurrentClub,
  isLinkedToExternalCoach,
  getCanonicalCoachClubId
} from "@/lib/authService";
import { saveLocalSetting, getLocalSetting } from "@/lib/db/indexedDB";
import { ArrowLeft, LogOut, Check, Shield, Plus, Trash2, Target, Building2, Users, CheckCircle2, AlertCircle, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import LanguageSelector from "../ui/LanguageSelector";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";
import { triggerHaptic } from "@/lib/haptics";

interface ProfileViewProps {
  user: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  onProfileUpdated: (updatedUser: UserProfile) => void;
  onNavigate?: (screen: any) => void;
}

import { COUNTRIES } from "@/lib/countries";

export default function ProfileView({ user, onBack, onLogout, onProfileUpdated, onNavigate }: ProfileViewProps) {
  const { t } = useLanguage();
  
  // Section edit toggles
  const [editPersonal, setEditPersonal] = useState(false);
  const [editBow, setEditBow] = useState(false);
  const [editClubDetails, setEditClubDetails] = useState(false);
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
  const [country, setCountry] = useState(user.country);
  const [city, setCity] = useState(user.city || "");
  const [gender, setGender] = useState(user.gender);

  // Multi-Bow Configuration State (Arco #1, Arco #2, Arco #3)
  const parseInitialBows = (u: UserProfile): BowConfig[] => {
    if (u.bows && u.bows.length > 0) {
      return u.bows.map((b, idx) => ({
        id: b.id || `BOW-${idx + 1}`,
        name: b.name || (idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`),
        type: b.type || "Recurve",
        brand: b.brand || "",
        model: b.model || "",
        poundage: b.poundage || 0,
        drawLength: b.drawLength || 0,
        hand: b.hand || (u.physicalData?.dominantHand === "L" ? "LH" : "RH"),
        defaultDistance: b.defaultDistance || (b.type === "Compound" ? 50 : b.type === "Recurve" ? 70 : 18)
      }));
    }
    if (u.bowConfig) {
      return [{
        id: "BOW-1",
        name: "Arco Principal",
        type: u.bowConfig.type || "Recurve",
        brand: u.bowConfig.brand || "",
        model: u.bowConfig.model || "",
        poundage: u.bowConfig.poundage || 0,
        drawLength: u.bowConfig.drawLength || 0,
        hand: u.bowConfig.hand || (u.physicalData?.dominantHand === "L" ? "LH" : "RH"),
        defaultDistance: u.bowConfig.defaultDistance || (u.bowConfig.type === "Compound" ? 50 : u.bowConfig.type === "Recurve" ? 70 : 18)
      }];
    }
    return [{
      id: "BOW-1",
      name: "Arco Principal",
      type: "Recurve",
      brand: "",
      model: "",
      poundage: 0,
      drawLength: 0,
      hand: u.physicalData?.dominantHand === "L" ? "LH" : "RH",
      defaultDistance: 70
    }];
  };

  const [bowsList, setBowsList] = useState<BowConfig[]>(parseInitialBows(user));

  useEffect(() => {
    if (!editBow) {
      setBowsList(parseInitialBows(user));
    }
  }, [user.bows, user.bowConfig, editBow]);

  const handleUpdateBow = (index: number, updates: Partial<BowConfig>) => {
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
        drawLength: 0,
        hand: bowsList[0]?.hand || "RH",
        defaultDistance: 70
      }
    ]);
  };

  const handleRemoveBow = (index: number) => {
    if (index === 0) return; // Cannot delete primary bow
    setBowsList((prev) => prev.filter((_, i) => i !== index));
  };

  // Notification Toggles
  const [pushNotif, setPushNotif] = useState(true);

  // Coach WhatsApp notice field
  const [clubWhatsApp, setClubWhatsApp] = useState(user.whatsappNumber || "");

  // Athlete Coach Linking states
  const [athleteInviteCode, setAthleteInviteCode] = useState("");
  const [isJoiningClub, setIsJoiningClub] = useState(false);
  const [clubJoinFeedback, setClubJoinFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [coachProfile, setCoachProfile] = useState<UserProfile | null>(null);
  const linkedToCoach = isLinkedToExternalCoach(user);

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
            const { doc, getDoc, collection, query, where, getDocs } = await import("firebase/firestore");
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
              const qClub = query(collection(db, "users"), where("clubId", "==", user.clubId));
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
          // Self-heal missing explicit coachId/coachName/coachEmail on the athlete profile
          if (user.coachId !== resolved.uid || !user.coachName) {
            updateProfile(user.uid, {
              coachId: resolved.uid,
              coachName: resolved.fullName || "Entrenador",
              coachEmail: resolved.email || ""
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
  }, [user.uid, user.clubId, user.coachId, user.isClubCreator]);

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
          message: `¡Te has vinculado exitosamente con tu entrenador${res.clubName ? ` (${res.clubName})` : ""}!`
        });
        onProfileUpdated(res.user);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
        setAthleteInviteCode("");
      } else {
        triggerHaptic("miss");
        setClubJoinFeedback({ type: "error", message: res.error || "No se encontró el entrenador o el código de 6 dígitos es inválido." });
      }
    } catch (err: any) {
      setClubJoinFeedback({ type: "error", message: err?.message || "Error al intentar vincularte con tu entrenador." });
    } finally {
      setIsJoiningClub(false);
    }
  };

  const handleLeaveClub = async () => {
    if (!confirm("¿Estás seguro de que deseas desvincularte de tu entrenador?")) return;
    try {
      const res = await leaveCurrentClub(user.uid);
      if (res.success && res.user) {
        triggerHaptic("confirm");
        setClubJoinFeedback({ type: "success", message: "Te has desvinculado de tu entrenador exitosamente." });
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

  const handleSavePersonal = async () => {
    try {
      const updated = await updateProfile(user.uid, {
        fullName,
        nickname,
        clubName: clubName.trim() || null,
        birthDate,
        city,
        country,
        gender
      });
      onProfileUpdated(updated);
      setEditPersonal(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveBow = async () => {
    try {
      const cleanedBows: BowConfig[] = bowsList.map((b, idx) => ({
        id: b.id || `BOW-${idx + 1}`,
        name: idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`,
        type: b.type || "Recurve",
        brand: b.brand?.trim() || (idx === 0 ? "Arco Principal" : `Arco #${idx + 1}`),
        model: b.model?.trim() || "",
        poundage: Number(b.poundage) || 0,
        drawLength: Number(b.drawLength) || 0,
        hand: b.hand || "RH",
        defaultDistance: Number(b.defaultDistance) || (b.type === "Compound" ? 50 : b.type === "Recurve" ? 70 : 18)
      }));

      const primaryBow = cleanedBows[0];

      const updated = await updateProfile(user.uid, {
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
      const updated = await updateProfile(user.uid, {
        whatsappNumber: clubWhatsApp
      });
      onProfileUpdated(updated);
      alert("WhatsApp de Coach guardado correctamente");
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogoutClick = async () => {
    const confirmLogout = window.confirm("¿Seguro que deseas cerrar sesión? Cualquier sesión activa, duelo o proceso que tengas abierto se cerrará.");
    if (!confirmLogout) return;
    
    await logoutUser();
    onLogout();
  };

  const handleConfirmDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await deleteUserAccount(user.uid);
      setIsDeleteAccountOpen(false);
      onLogout();
    } catch (e) {
      console.error("Error deleting user account:", e);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleNotifToggle = async (key: string, currentVal: boolean, setVal: (v: boolean) => void) => {
    const nextVal = !currentVal;
    setVal(nextVal);
    await saveLocalSetting(key, nextVal);

    if (key === "notif_push" && nextVal === true) {
      try {
        const { requestPushPermissionAndRegister } = await import("@/lib/pushNotifications");
        const token = await requestPushPermissionAndRegister(user.uid);
        if (token) {
          alert("¡Notificaciones Push activadas con éxito! Recibirás alertas de duelos en este dispositivo.");
        } else {
          alert("No se pudieron activar las notificaciones push. Verifica los permisos de tu navegador.");
          setVal(false);
          await saveLocalSetting(key, false);
        }
      } catch (err) {
        console.error("Error activating push notifications:", err);
      }
    }
  };

  return (
    <div className="flex flex-col gap-5 py-4 min-h-full w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-[#0D1017] border border-white/[0.08] text-white hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0">
          <h2 className="text-white text-[17.6px] sm:text-[19.8px] font-black uppercase tracking-wide truncate leading-tight">
            {t("settingsTitle")}
          </h2>
          <p className="text-[11.6px] text-white uppercase tracking-wider truncate">Ajustes</p>
        </div>
      </div>

      {/* User Header Profile Card */}
      <div className="bg-[#0D1017] p-4 rounded-3xl border border-white/[0.08] flex items-center gap-4 relative overflow-hidden">
        <div className="w-15 h-15 rounded-2xl bg-cyan-neon/10 border border-cyan-neon/40 flex items-center justify-center text-cyan-neon font-black text-lg shrink-0">
          {user.fullName.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white font-extrabold text-base truncate">{user.fullName}</span>
            <span className={`text-[10.5px] font-black px-2.5 py-0.5 rounded-full uppercase whitespace-nowrap shrink-0 ${
              user.plan === "PRO" 
                ? "bg-yellow-gold/10 border border-yellow-gold/30 text-yellow-gold"
                : "bg-white/[0.06] border border-white/15 text-white"
            }`}>
              {user.plan}
            </span>
          </div>
          <span className="text-[11.6px] text-white mt-0.5 truncate">{user.email}</span>
          
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10.5px] bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon font-black px-2.5 py-0.5 rounded-full uppercase whitespace-nowrap">
              {user.role === "archer"
                ? "Atleta"
                : user.role === "coach"
                ? "Coach"
                : user.role === "team_admin_coach"
                ? "Admin / Coach"
                : user.role === "team_admin"
                ? "Administrador"
                : user.role === "superadmin"
                ? "Super Admin"
                : user.role}
            </span>
            {user.nickname && (
              <span className="text-[10.5px] text-white font-bold tabular-nums truncate">
                @{user.nickname}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 0: App Language Selector */}
      <LanguageSelector variant="card" />

      {/* SECTION 1: Personal Data */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-white text-xs font-black uppercase tracking-wider">{t("personalData")}</h4>
          <button
            onClick={() => {
              if (editPersonal) handleSavePersonal();
              else setEditPersonal(true);
            }}
            className="text-xs text-cyan-neon font-bold hover:underline cursor-pointer"
          >
            {editPersonal ? "Guardar" : "Editar"}
          </button>
        </div>

        {editPersonal ? (
          <div className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder=""
              />
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder=""
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none uppercase [color-scheme:dark]"
              />
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder={t("city")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none [color-scheme:dark]"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-black text-white">{c.flag} {c.name}</option>
                ))}
              </select>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none [color-scheme:dark]"
              >
                <option value="M" className="bg-black text-white">{t("genderM")}</option>
                <option value="F" className="bg-black text-white">{t("genderF")}</option>
                <option value="O" className="bg-black text-white">{t("genderO")}</option>
              </select>
            </div>
            <input
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              className="w-full bg-neutral-950 border border-white/10 focus:border-cyan-neon text-white text-xs p-2.5 rounded-xl outline-none"
              placeholder="Club (Opcional)"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Nombre:</span>
              <span className="text-white font-bold">{user.fullName}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Alias para Retos:</span>
              <span className="text-cyan-neon tabular-nums font-bold">@{user.nickname || "arquero"}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Club (Opcional):</span>
              <span className="text-white font-bold">{clubName.trim() || "—"}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Nacimiento:</span>
              <span className="text-white font-bold">{user.birthDate}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Ciudad:</span>
              <span className="text-white font-bold">{user.city || "-"}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">País:</span>
              <span className="text-white font-bold">
                {COUNTRIES.find((c) => c.code === user.country)?.flag} {COUNTRIES.find((c) => c.code === user.country)?.name}
              </span>
            </div>
            <div className="flex justify-between text-xs py-1">
              <span className="text-white">Género:</span>
              <span className="text-white font-bold">
                {user.gender === "M" ? t("genderM") : user.gender === "F" ? t("genderF") : t("genderO")}
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
            <h4 className="text-white text-xs md:text-sm font-black uppercase tracking-wider">
              {t("bowConfig")}
            </h4>
          </div>
          <button
            type="button"
            onClick={() => {
              if (editBow) handleSaveBow();
              else setEditBow(true);
            }}
            className="h-8 px-3.5 rounded-lg bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[11.6px] font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center"
          >
            {editBow ? "Guardar" : "Editar"}
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
                    <h5 className="text-white text-xs font-black uppercase tracking-wider">
                      Arco #{bowNumber}
                    </h5>

                    {!isPrimary && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBow(idx)}
                        className="h-7 px-2.5 rounded-lg bg-white hover:bg-neutral-200 border border-white text-black text-[11.6px] font-black flex items-center gap-1.5 transition cursor-pointer"
                        title="Eliminar este arco"
                      >
                        <Trash2 size={12} />
                        <span>Eliminar</span>
                      </button>
                    )}
                  </div>

                  {/* Tipo de Arco Selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                      Tipo de Arco
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["Recurve", "Compound", "Barebow"] as const).map((typeOption) => {
                        const isSelected = bow.type === typeOption;
                        const label = typeOption === "Recurve" ? "Recurvo" : typeOption === "Compound" ? "Compuesto" : "Barebow";
                        return (
                          <button
                            key={typeOption}
                            type="button"
                            onClick={() => handleUpdateBow(idx, { type: typeOption })}
                            className={`h-10 flex items-center justify-center rounded-xl text-[12.8px] font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
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
                      <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                        Marca
                      </label>
                      <input
                        type="text"
                        value={bow.brand}
                        onChange={(e) => handleUpdateBow(idx, { brand: e.target.value })}
                        placeholder="Ej. Hoyt, Mathews"
                        className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 rounded-xl outline-none transition placeholder:text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                        Modelo
                      </label>
                      <input
                        type="text"
                        value={bow.model}
                        onChange={(e) => handleUpdateBow(idx, { model: e.target.value })}
                        placeholder="Ej. Satori, TRX"
                        className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 rounded-xl outline-none transition placeholder:text-white"
                      />
                    </div>
                  </div>

                  {/* Fila: Potencia y Apertura */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                        Potencia
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          step="0.5"
                          value={bow.poundage || ""}
                          onChange={(e) => handleUpdateBow(idx, { poundage: e.target.value ? Number(e.target.value) : ("" as any) })}
                          placeholder="Ej. 38"
                          className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-xs pl-3.5 pr-12 rounded-xl outline-none transition placeholder:text-white"
                        />
                        <span className="absolute right-3 text-[12.8px] text-cyan-neon font-black pointer-events-none uppercase">
                          lbs
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                        Apertura
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          step="0.25"
                          value={bow.drawLength || ""}
                          onChange={(e) => handleUpdateBow(idx, { drawLength: e.target.value ? Number(e.target.value) : ("" as any) })}
                          placeholder="Ej. 28.5"
                          className="h-11 w-full bg-neutral-900 border border-white/10 focus:border-cyan-neon text-white text-xs pl-3.5 pr-10 rounded-xl outline-none transition placeholder:text-white"
                        />
                        <span className="absolute right-3.5 text-sm text-cyan-neon font-black pointer-events-none">
                          &quot;
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Fila: Lateralidad / Orientación */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11.6px] text-white uppercase font-black tracking-widest">
                      Lateralidad / Orientación
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateBow(idx, { hand: "RH" })}
                        className={`h-11 flex items-center justify-center rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
                          (bow.hand || "RH") === "RH"
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-neutral-900 text-white border-white/5 hover:border-white/15 hover:text-white"
                        }`}
                      >
                        Diestro (RH)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateBow(idx, { hand: "LH" })}
                        className={`h-11 flex items-center justify-center rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
                          bow.hand === "LH"
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-neutral-900 text-white border-white/5 hover:border-white/15 hover:text-white"
                        }`}
                      >
                        Zurdo (LH)
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Botón para desplegar Arco #2 (si solo hay 1) */}
            {bowsList.length === 1 && (
              <button
                type="button"
                onClick={handleAddBow}
                className="h-12 w-full rounded-xl border border-dashed border-cyan-neon/30 hover:border-cyan-neon bg-cyan-neon/5 hover:bg-cyan-neon/10 text-cyan-neon font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99]"
              >
                <Plus size={15} />
                <span>+ Agregar Arco #2</span>
              </button>
            )}

            {/* Botón para desplegar Arco #3 (si hay 2) */}
            {bowsList.length === 2 && (
              <button
                type="button"
                onClick={handleAddBow}
                className="h-12 w-full rounded-xl border border-dashed border-cyan-neon/30 hover:border-cyan-neon bg-cyan-neon/5 hover:bg-cyan-neon/10 text-cyan-neon font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99]"
              >
                <Plus size={15} />
                <span>+ Agregar Arco #3</span>
              </button>
            )}

            {/* Botón Guardar Arcos Rectangular y Bien Cuadrado (Sin botón de Cancelar) */}
            <button
              type="button"
              onClick={handleSaveBow}
              className="h-12 w-full rounded-xl bg-cyan-neon hover:bg-cyan-brand text-black font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition shadow-glow-cyan cursor-pointer active:scale-[0.99]"
            >
              <Check size={16} strokeWidth={3} />
              <span>Guardar Arcos</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bowsList.map((bow, idx) => {
              const bowNumber = idx + 1;
              const isPrimary = idx === 0;
              const typeName = bow.type === "Recurve" ? "Recurvo" : bow.type === "Compound" ? "Compuesto" : "Barebow";

              return (
                <div
                  key={bow.id || idx}
                  className="bg-neutral-950/70 border border-white/10 rounded-2xl p-4 flex flex-col gap-3 shadow-md"
                >
                  <div className="border-b border-white/5 pb-2 flex items-center justify-between">
                    <span className="text-white text-xs font-black uppercase tracking-wider">
                      Arco #{bowNumber} {isPrimary && <span className="text-white font-bold text-[11.6px]">(Principal)</span>}
                    </span>
                    <span className="text-[11.6px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon">
                      {typeName}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Marca</span>
                      <span className="text-white text-xs font-bold truncate">
                        {bow.brand || "Sin especificar"}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Modelo</span>
                      <span className="text-white text-xs font-bold truncate">
                        {bow.model || "Sin especificar"}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Potencia / Apertura</span>
                      <span className="text-white text-xs font-bold">
                        {bow.poundage ? `${bow.poundage} lbs` : "-"}
                        {bow.drawLength ? ` • ${bow.drawLength}"` : ""}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[10.5px] text-white uppercase font-black tracking-widest">Orientación</span>
                      <span className="text-cyan-neon text-xs font-black uppercase">
                        {(bow.hand || "RH") === "RH" ? "Diestro (RH)" : "Zurdo (LH)"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {bowsList.length < 3 && (
              <p className="text-[11.6px] text-white text-center pt-0.5 italic">
                {bowsList.length === 1 
                  ? '¿Tienes otro arco? Toca "Editar" para registrar tu Arco #2.' 
                  : '¿Tienes un tercer arco? Toca "Editar" para registrar tu Arco #3.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: Preferences Notifications */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-white text-xs font-black uppercase tracking-wider">{t("pushNotif")}</span>
          <span className="text-[11.6px] text-white leading-snug">Alertas de retos, duelos 1v1 y recordatorios</span>
        </div>
        <button
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

      {/* SECTION 4.5: Mi Entrenador (Disponible para todos los usuarios para poder vincularse/desvincularse siempre) */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-cyan-neon" />
            Mi Entrenador (Coach)
          </h4>
          {linkedToCoach && (
            <span className="text-[10.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Vinculado
            </span>
          )}
        </div>

        {clubJoinFeedback && (
          <div className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
            clubJoinFeedback.type === "success" 
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" 
              : "bg-white border-white text-black"
          }`}>
            {clubJoinFeedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-black" />
            )}
            <span className="leading-snug">{clubJoinFeedback.message}</span>
          </div>
        )}

        {linkedToCoach ? (
          <div className="flex flex-col gap-3">
            {/* Información del Entrenador */}
            <div className="bg-neutral-950/30 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-white uppercase font-black tracking-wider flex items-center gap-1">
                  <Users className="w-3 h-3 text-cyan-neon" /> Tu Entrenador
                </span>
                {coachProfile?.whatsappNumber && (
                  <a
                    href={`https://wa.me/${coachProfile.whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola Coach ${coachProfile.fullName}, soy ${user.fullName}. Te escribo desde Archery 101010.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-[11.6px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all"
                  >
                    <MessageCircle className="w-3 h-3" /> WhatsApp
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white font-bold">
                  {coachProfile?.fullName || user.coachName || "Entrenador Asignado"}
                </span>
                <span className="text-[11.6px] text-white">
                  {coachProfile?.email || user.coachEmail || "En línea"}
                </span>
              </div>
              <div className="bg-cyan-brand/10 border border-cyan-neon/15 rounded-xl p-2 text-[11.6px] text-cyan-300 leading-snug flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-neon shrink-0" />
                <span>Tus planillas y series se sincronizan en tiempo real con el panel de tu coach.</span>
              </div>
            </div>

            {/* Desvincularse */}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleLeaveClub}
                className="text-xs bg-white hover:bg-neutral-200 text-black font-black uppercase tracking-wider rounded-xl transition-colors cursor-pointer py-1.5 px-3"
              >
                Desvincularme del Coach
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[12.8px] text-white leading-snug">
              Pídele a tu entrenador su código de 6 dígitos para vincularte como su alumno. Al vincularte, tu entrenador podrá ver tus planillas de tiro, puntuaciones y darte retroalimentación al instante.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                maxLength={6}
                value={athleteInviteCode}
                onChange={(e) => setAthleteInviteCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                placeholder="Código de 6 dígitos"
                className="flex-1 bg-neutral-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white uppercase tabular-nums tracking-wider placeholder:text-white outline-none focus:border-cyan-neon transition-colors"
              />
              <button
                type="button"
                onClick={handleJoinClub}
                disabled={!athleteInviteCode.trim() || isJoiningClub}
                className="px-4 py-2.5 bg-cyan-neon text-black font-black text-xs uppercase tracking-wider rounded-2xl shadow-glow-cyan hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {isJoiningClub ? "Vinculando..." : "Vincular"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 5: Coach settings (código de 6 dígitos y WhatsApp de contacto, solo cuando NO está vinculado como alumno a otro coach) */}
      {!linkedToCoach && (user.role === "coach" || user.role === "team_admin" || user.role === "team_admin_coach") && (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider">Configuración de Coach</h4>
            <button
              type="button"
              onClick={async () => {
                if (confirm("¿Deseas desactivar el modo Coach en tu cuenta y volver a perfil exclusivo de Atleta?")) {
                  const res = await leaveCurrentClub(user.uid);
                  if (res.success && res.user) {
                    setCoachProfile(null);
                    onProfileUpdated(res.user);
                    window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
                  }
                }
              }}
              className="text-[10.5px] text-neutral-300 hover:text-white underline font-bold cursor-pointer"
            >
              Volver a modo Atleta
            </button>
          </div>

          <div className="flex flex-col gap-3 mt-1">
            {/* Invite code (6 dígitos) */}
            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] text-white font-bold uppercase tracking-wider">Código para Alumnos (6 dígitos)</span>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm tabular-nums font-black text-cyan-neon tracking-widest bg-neutral-950 p-2.5 rounded-xl border border-white/5 text-center select-all">
                  {user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode)
                    ? user.clubInviteCode
                    : "······"}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm("¿Deseas generar un código de 6 dígitos para tus alumnos?")) {
                      const { generateClubInviteCode, updateProfile } = await import("@/lib/authService");
                      const freshCode = generateClubInviteCode();
                      const canonicalClubId = getCanonicalCoachClubId(user);
                      const updated = await updateProfile(user.uid, {
                        clubInviteCode: freshCode,
                        clubId: canonicalClubId,
                        isClubCreator: true
                      });
                      onProfileUpdated(updated);
                      window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updated } }));
                      alert(`Nuevo código de 6 dígitos generado: ${freshCode}`);
                    }
                  }}
                  className="px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-cyan-neon hover:text-white text-xs font-bold transition cursor-pointer active:scale-95"
                  title="Generar nuevo código de 6 dígitos"
                >
                  Nuevo
                </button>
              </div>
            </div>

            {/* Coach personal WhatsApp */}
            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] text-white font-bold uppercase tracking-wider">WhatsApp del Coach</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clubWhatsApp}
                  onChange={(e) => setClubWhatsApp(e.target.value)}
                  className="flex-1 bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                  placeholder="Ej. +50688888888"
                />
                <button
                  onClick={handleSaveClubWhatsApp}
                  className="px-4 py-2.5 rounded-xl bg-cyan-neon/15 border border-cyan-neon/20 text-cyan-neon font-black text-xs cursor-pointer active:scale-95 transition"
                >
                  Ok
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Superadmin Panel Direct Link */}
      {user.role === "superadmin" && onNavigate && (
        <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-5 flex flex-col gap-2.5">
          <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Shield size={14} className="text-cyan-neon" />
            <span>Panel de Administración</span>
          </h3>
          <p className="text-[11.6px] text-white leading-relaxed">
            Tienes privilegios de Super Administrador para gestionar usuarios, publicidad y ajustes.
          </p>
          <button
            onClick={() => onNavigate("ADMIN")}
            className="w-full py-2.5 rounded-xl bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon font-bold text-xs uppercase cursor-pointer hover:bg-cyan-neon/20 transition active:scale-98"
          >
            Abrir Panel Admin
          </button>
        </div>
      )}

      {/* Política de Privacidad Button */}
      <button
        onClick={() => window.open("/privacy", "_blank")}
        className="w-full py-3 mt-1 rounded-full border border-white/10 hover:bg-white/5 text-white hover:text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <Shield size={15} />
        <span>Política de Privacidad</span>
      </button>

      {/* Log out Action Button */}
      <button
        onClick={handleLogoutClick}
        className="w-full py-3.5 mt-1 rounded-full bg-white hover:bg-neutral-200 border border-white text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <LogOut size={16} />
        <span>{t("logout")}</span>
      </button>

      {/* Delete Account & Data Action Button (Google Play / App Store Policy Requirement) */}
      <button
        onClick={() => setIsDeleteAccountOpen(true)}
        className="w-full py-2.5 rounded-full border border-white/10 hover:bg-white hover:text-black text-white font-bold text-[12.8px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <Trash2 size={13} />
        <span>Eliminar mi cuenta y datos</span>
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
              <h3 className="text-white text-base font-black tracking-tight">
                ¿Eliminar cuenta permanentemente?
              </h3>
              <p className="text-xs text-white leading-relaxed">
                Esta acción es <strong className="text-white">irreversible</strong>. Se eliminarán tu perfil (<span className="text-white tabular-nums">{user.email}</span>), arcos, sesiones, historial de duelos y récords.
              </p>
              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={() => setIsDeleteAccountOpen(false)}
                  className="flex-1 h-11 rounded-2xl bg-[#121620] border border-white/[0.08] text-white hover:text-white font-bold text-xs uppercase tracking-wider cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={handleConfirmDeleteAccount}
                  className="flex-1 h-11 rounded-2xl bg-white hover:bg-neutral-200 border border-white text-black font-black text-xs uppercase tracking-wider cursor-pointer transition active:scale-95 disabled:opacity-50"
                >
                  {isDeletingAccount ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
