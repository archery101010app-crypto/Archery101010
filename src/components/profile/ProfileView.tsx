"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile, BowConfig, updateProfile, transferCoachRole, logoutUser, deleteUserAccount, getLoggedUser, joinClubByInviteCode, leaveCurrentClub } from "@/lib/authService";
import { saveLocalSetting, getLocalSetting } from "@/lib/db/indexedDB";
import { ArrowLeft, User, Settings, ShieldAlert, Lock, Volume2, HelpCircle, LogOut, Check, Shield, BookOpen, Plus, Trash2, Target, Building2, Users, CheckCircle2, AlertCircle, ExternalLink, MessageCircle, Star } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { RECURVE_STARS, COMPOUND_STARS } from "@/lib/starsManager";
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
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Hook into mobile back button and gestures
  useEffect(() => {
    if (isPaywallOpen) {
      return registerModalDismiss(() => setIsPaywallOpen(false));
    }
    if (isDeleteAccountOpen) {
      return registerModalDismiss(() => setIsDeleteAccountOpen(false));
    }
  }, [isPaywallOpen, isDeleteAccountOpen]);

  // Form Fields
  const [fullName, setFullName] = useState(user.fullName);
  const [nickname, setNickname] = useState(user.nickname || "");
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
  
  // Athlete Star State
  const [maxStar, setMaxStar] = useState<any | null>(null);

  // Coach WhatsApp notice field
  const [clubWhatsApp, setClubWhatsApp] = useState(user.whatsappNumber || "");

  // Club customization form fields (Coach only)
  const [clubName, setClubName] = useState(user.clubName || "");
  const [clubCountry, setClubCountry] = useState(user.clubCountry || user.country);
  const [clubLogo, setClubLogo] = useState(user.clubLogo || "0");
  const [customLogoUrl, setCustomLogoUrl] = useState(user.clubLogo && (user.clubLogo.startsWith("http") || user.clubLogo.startsWith("/")) ? user.clubLogo : "");
  const [isCustomLogo, setIsCustomLogo] = useState(user.clubLogo && (user.clubLogo.startsWith("http") || user.clubLogo.startsWith("/")) ? true : false);

  // DEV Simulate PRO flag state
  const [devSimulatePro, setDevSimulatePro] = useState(user.plan === "PRO");
  // DEV Simulate Superadmin flag state
  const [devSimulateSuperAdmin, setDevSimulateSuperAdmin] = useState(user.role === "superadmin");

  // Club roster states
  const [clubMembers, setClubMembers] = useState<UserProfile[]>([]);

  // Athlete Club & Coach Linking states
  const [athleteInviteCode, setAthleteInviteCode] = useState("");
  const [isJoiningClub, setIsJoiningClub] = useState(false);
  const [clubJoinFeedback, setClubJoinFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [coachProfile, setCoachProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    async function loadClubMembers() {
      if (user.clubId) {
        const { getLocalSetting } = await import("@/lib/db/indexedDB");
        const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const members = list.filter((u) => u.clubId === user.clubId);
        setClubMembers(members);
      }
    }
    loadClubMembers();
  }, [user.clubId, user.role]);

  useEffect(() => {
    async function loadCoachInfo() {
      if (user.clubId) {
        try {
          const { getLocalSetting } = await import("@/lib/db/indexedDB");
          const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const coach = list.find((u) => u.clubId === user.clubId && (u.role === "coach" || u.role === "team_admin" || u.role === "team_admin_coach" || u.isClubCreator));
          if (coach) {
            setCoachProfile(coach);
          }
        } catch (e) {
          console.error("Error loading coach profile:", e);
        }
      } else {
        setCoachProfile(null);
      }
    }
    loadCoachInfo();
  }, [user.clubId]);

  const handleJoinClub = async () => {
    if (!athleteInviteCode.trim()) return;
    setIsJoiningClub(true);
    setClubJoinFeedback(null);
    try {
      const res = await joinClubByInviteCode(user.uid, athleteInviteCode.trim());
      if (res.success && res.user) {
        triggerHaptic("confirm");
        setClubJoinFeedback({ type: "success", message: `¡Te has vinculado exitosamente al club "${res.user.clubName || "Arqueros"}"!` });
        onProfileUpdated(res.user);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
        setAthleteInviteCode("");
      } else {
        triggerHaptic("miss");
        setClubJoinFeedback({ type: "error", message: res.error || "No se encontró el club o código de invitación inválido." });
      }
    } catch (err: any) {
      setClubJoinFeedback({ type: "error", message: err?.message || "Error al intentar vincularte al club." });
    } finally {
      setIsJoiningClub(false);
    }
  };

  const handleLeaveClub = async () => {
    if (!confirm("¿Estás seguro de que deseas desvincularte de este club y entrenador?")) return;
    try {
      const res = await leaveCurrentClub(user.uid);
      if (res.success && res.user) {
        triggerHaptic("confirm");
        setClubJoinFeedback({ type: "success", message: "Te has desvinculado del club exitosamente." });
        setCoachProfile(null);
        onProfileUpdated(res.user);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: res.user } }));
      }
    } catch (err) {
      console.error("Error leaving club:", err);
    }
  };

  const handleSelectUserRole = async (targetRole: "archer" | "coach") => {
    let nextRole: UserProfile["role"] = targetRole;
    if (user.role === "team_admin" || user.role === "team_admin_coach") {
      nextRole = targetRole === "coach" ? "team_admin_coach" : "team_admin";
    } else if (user.role === "superadmin") {
      nextRole = "superadmin";
    }
    const updatedUser: UserProfile = {
      ...user,
      role: nextRole
    };
    await updateProfile(user.uid, { role: nextRole });
    onProfileUpdated(updatedUser);
    window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updatedUser } }));
  };

  const handlePromoteToCoach = async (memberUid: string) => {
    const { getLocalSetting, saveLocalSetting, generateResilientId, addToSyncQueue } = await import("@/lib/db/indexedDB");
    const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const idx = list.findIndex((u) => u.uid === memberUid);
    if (idx !== -1) {
      const currentMember = list[idx];
      let nextRole: UserProfile["role"] = "coach";
      if (currentMember.role === "team_admin") {
        nextRole = "team_admin_coach";
      }
      const updatedUser = {
        ...currentMember,
        role: nextRole
      };
      list[idx] = updatedUser;
      await saveLocalSetting("simulated_users", list);

      // Push to Firestore Sync Queue
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "UPDATE",
        payloadId: memberUid,
        payload: updatedUser,
        timestamp: Date.now()
      });

      // Update local state
      setClubMembers(list.filter((u) => u.clubId === user.clubId));
      
      // If it is the current user, notify
      if (memberUid === user.uid) {
        await saveLocalSetting("current_user", updatedUser);
        onProfileUpdated(updatedUser);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updatedUser } }));
      }
    }
  };

  const handleDemoteToArcher = async (memberUid: string) => {
    const { getLocalSetting, saveLocalSetting, generateResilientId, addToSyncQueue } = await import("@/lib/db/indexedDB");
    const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const idx = list.findIndex((u) => u.uid === memberUid);
    if (idx !== -1) {
      const currentMember = list[idx];
      let nextRole: UserProfile["role"] = "archer";
      if (currentMember.role === "team_admin_coach") {
        nextRole = "team_admin";
      }
      const updatedUser = {
        ...currentMember,
        role: nextRole
      };
      list[idx] = updatedUser;
      await saveLocalSetting("simulated_users", list);

      // Push to Firestore Sync Queue
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "UPDATE",
        payloadId: memberUid,
        payload: updatedUser,
        timestamp: Date.now()
      });

      // Update local state
      setClubMembers(list.filter((u) => u.clubId === user.clubId));

      // If it is the current user, notify
      if (memberUid === user.uid) {
        await saveLocalSetting("current_user", updatedUser);
        onProfileUpdated(updatedUser);
        window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updatedUser } }));
      }
    }
  };

  const handleToggleAdminCoachSelf = async () => {
    const { getLocalSetting, saveLocalSetting, generateResilientId, addToSyncQueue } = await import("@/lib/db/indexedDB");
    const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const idx = list.findIndex((u) => u.uid === user.uid);
    if (idx !== -1) {
      const nextRole: UserProfile["role"] = user.role === "team_admin" ? "team_admin_coach" : "team_admin";
      const updatedUser = {
        ...list[idx],
        role: nextRole
      };
      list[idx] = updatedUser;
      await saveLocalSetting("simulated_users", list);

      // Push to Firestore Sync Queue
      await addToSyncQueue({
        id: generateResilientId("TXN"),
        collection: "users",
        operation: "UPDATE",
        payloadId: user.uid,
        payload: updatedUser,
        timestamp: Date.now()
      });

      // Update current user
      await saveLocalSetting("current_user", updatedUser);
      onProfileUpdated(updatedUser);
      window.dispatchEvent(new CustomEvent("current-user-updated", { detail: { user: updatedUser } }));
      
      // Update local state
      setClubMembers(list.filter((u) => u.clubId === user.clubId));
    }
  };

  // Load toggles and star data from settings
  useEffect(() => {
    async function loadToggles() {
      const push = await getLocalSetting("notif_push", true);
      setPushNotif(push);

      // Load star achievement
      try {
        const { athleteStarsStore } = await import("@/lib/db/indexedDB");
        const doc = await athleteStarsStore.getItem<any>(user.uid);
        setMaxStar(doc);
      } catch (err) {
        console.error("Error loading athlete star in profile:", err);
      }
    }
    loadToggles();
  }, [user]);

  const handleSavePersonal = async () => {
    try {
      const updated = await updateProfile(user.uid, {
        fullName,
        nickname,
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
      alert("WhatsApp del club guardado correctamente");
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveClubDetails = async () => {
    try {
      const finalLogo = isCustomLogo ? customLogoUrl : clubLogo;
      const updated = await updateProfile(user.uid, {
        clubName,
        clubLogo: finalLogo,
        clubCountry
      });
      onProfileUpdated(updated);
      setEditClubDetails(false);
      alert("Ficha de Club premium guardada y propagada a todos los miembros.");
    } catch (e) {
      console.error(e);
    }
  };

  const handleDevProToggle = async () => {
    const nextPlan = devSimulatePro ? "FREE" : "PRO";
    setDevSimulatePro(!devSimulatePro);
    
    try {
      const updated = await updateProfile(user.uid, {
        plan: nextPlan
      });
      onProfileUpdated(updated);
      
      if (nextPlan === "PRO") {
        confetti({
          particleCount: 100,
          spread: 50,
          origin: { y: 0.6 }
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDevSuperAdminToggle = async () => {
    const nextRole = devSimulateSuperAdmin ? "archer" : "superadmin";
    setDevSimulateSuperAdmin(!devSimulateSuperAdmin);
    try {
      const updated = await updateProfile(user.uid, {
        role: nextRole
      });
      onProfileUpdated(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePaypalUpgrade = async () => {
    setIsPaywallOpen(false);
    try {
      const updated = await updateProfile(user.uid, {
        plan: "PRO"
      });
      setDevSimulatePro(true);
      onProfileUpdated(updated);

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.7 }
      });
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

  const handleCoachTransfer = async () => {
    const confirm = window.confirm("¿Seguro que deseas transferir tu rol de Coach? Al hacerlo pasarás a ser Archer de este club y ya no podrás editar la planificación.");
    if (!confirm) return;

    // Simulate transfer to a demo adult user in the club database
    const success = await transferCoachRole("USR-DEMO-MEMBER-ADULT");
    if (success) {
      const updated = await getLoggedUser();
      if (updated) onProfileUpdated(updated);
      alert("Rol de Coach transferido con éxito");
    } else {
      // In demo mode, if there is no other adult member registered, we simulate it
      // Let's create an adult member first to transfer to
      const usersList = await getLocalSetting<any[]>("simulated_users", []);
      const demoMember = {
        uid: "USR-DEMO-MEMBER-ADULT",
        email: "coach.ayudante@archery101010.com",
        fullName: "Entrenador Asistente",
        nickname: "ayudante",
        birthDate: "1990-01-01",
        country: "CR",
        city: "San José",
        gender: "M",
        bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 44, defaultDistance: 70 },
        physicalData: { height: 185, weight: 80, dominantEye: "R", dominantHand: "R" },
        clubId: user.clubId,
        clubName: user.clubName,
        role: "archer",
        plan: "FREE",
        isClubCreator: false
      };
      
      usersList.push(demoMember);
      await saveLocalSetting("simulated_users", usersList);
      
      // Retry transfer
      const retrySuccess = await transferCoachRole("USR-DEMO-MEMBER-ADULT");
      if (retrySuccess) {
        const updated = await getLoggedUser();
        if (updated) onProfileUpdated(updated);
        alert("Rol de Coach transferido con éxito al Entrenador Asistente (ayudante)");
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
          <h2 className="text-white text-base sm:text-lg font-black uppercase tracking-wide truncate leading-tight">
            {t("settingsTitle")}
          </h2>
          <p className="text-[13.2px] text-white uppercase tracking-wider truncate">Ajustes</p>
        </div>
      </div>

      {/* User Header Profile Card */}
      <div className="bg-[#0D1017] p-4 rounded-3xl border border-white/[0.08] flex items-center gap-4 relative overflow-hidden">
        <div className="w-16 h-16 rounded-full bg-cyan-neon/10 border-2 border-cyan-neon/50 flex items-center justify-center text-cyan-neon font-black text-xl shrink-0">
          {user.fullName.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-white font-extrabold text-base truncate">{user.fullName}</span>
          <span className="text-[13.2px] text-white mt-0.5 truncate">{user.email}</span>
          
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[11.9px] bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap">
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
            <span className={`text-[11.9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${
              user.plan === "PRO" 
                ? "bg-yellow-gold/10 border border-yellow-gold/25 text-yellow-gold"
                : "bg-neutral-800 border border-neutral-700 text-white"
            }`}>
              {user.plan}
            </span>
          </div>
        </div>
      </div>

      {/* Role Selection Switcher Card */}
      <div className="p-4 rounded-3xl bg-[#0D1017] border border-white/[0.08] flex items-center justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <span className="text-white text-xs font-black uppercase tracking-wider">Rol de Cuenta</span>
          <span className="text-[13.2px] text-white leading-snug [text-wrap:pretty]">Selecciona si entrenas como Atleta o gestionas como Coach</span>
        </div>
        <div className="flex bg-[#090B0E] p-1 rounded-2xl border border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectUserRole("archer")}
            className={`h-8 px-3 rounded-xl text-[13.2px] font-black uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer ${
              user.role === "archer" || user.role === "team_admin"
                ? "bg-cyan-neon text-black font-extrabold"
                : "text-white hover:text-white"
            }`}
          >
            Atleta
          </button>
          <button
            type="button"
            onClick={() => handleSelectUserRole("coach")}
            className={`relative h-8 px-3 rounded-xl text-[13.2px] font-black uppercase tracking-wider flex items-center justify-center whitespace-nowrap transition cursor-pointer ${
              user.role === "coach" || user.role === "team_admin_coach"
                ? "bg-cyan-neon text-black font-extrabold"
                : "text-white hover:text-white"
            }`}
          >
            Coach
            <span className="absolute -top-1.5 -right-2 text-[9.2px] bg-yellow-gold text-black font-black px-1 rounded-sm uppercase scale-90 z-20">
              PRO
            </span>
          </button>
        </div>
      </div>

      {/* Subscription Card PRO paywall trigger */}
      <div className="p-5 rounded-3xl bg-[#0D1017] border border-white/[0.08] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
            <Shield size={14} className="text-cyan-neon" />
            {t("subCardTitle")}
          </h4>
          <span className="text-[11.9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/[0.05] text-white border border-white/[0.08]">
            {user.plan === "FREE" ? "Lanzamiento" : "Pro Activo"}
          </span>
        </div>
        {user.plan === "FREE" ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-white leading-relaxed">
              Desbloquea planificación de macrociclos, Spine Tuning y herramientas avanzadas sin costo por lanzamiento.
            </p>
            <button
              onClick={() => setIsPaywallOpen(true)}
              className="h-11 w-full rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-widest cursor-pointer active:scale-[0.99] transition flex items-center justify-center gap-1.5"
            >
              <span>Activar Pro Gratis</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.05] text-xs">
            <span className="text-white">Acceso completo desbloqueado</span>
            <span className="text-cyan-neon font-bold">Ilimitado</span>
          </div>
        )}
      </div>

      {/* SECTION 1: Personal Data */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
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
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none uppercase"
              />
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder={t("city")}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
              >
                <option value="M">{t("genderM")}</option>
                <option value="F">{t("genderF")}</option>
                <option value="O">{t("genderO")}</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Nombre:</span>
              <span className="text-white font-bold">{user.fullName}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-white">Alias para Retos:</span>
              <span className="text-cyan-neon font-mono font-bold">@{user.nickname || "arquero"}</span>
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
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 md:p-5 flex flex-col gap-4">
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
            className="h-8 px-3.5 rounded-lg bg-cyan-neon/10 hover:bg-cyan-neon/20 border border-cyan-neon/30 text-cyan-neon text-[13.2px] font-black uppercase tracking-wider transition cursor-pointer flex items-center justify-center"
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
                        className="h-7 px-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-rival text-[13.2px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                        title="Eliminar este arco"
                      >
                        <Trash2 size={12} />
                        <span>Eliminar</span>
                      </button>
                    )}
                  </div>

                  {/* Tipo de Arco Selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                            className={`h-10 flex items-center justify-center rounded-xl text-[14.5px] font-black uppercase tracking-wider whitespace-nowrap transition border cursor-pointer ${
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
                      <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                      <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                      <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                        <span className="absolute right-3 text-[14.5px] text-cyan-neon font-black pointer-events-none uppercase">
                          lbs
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                    <label className="text-[13.2px] text-white uppercase font-black tracking-widest">
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
                      Arco #{bowNumber} {isPrimary && <span className="text-white font-bold text-[13.2px]">(Principal)</span>}
                    </span>
                    <span className="text-[13.2px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-cyan-neon/10 border border-cyan-neon/25 text-cyan-neon">
                      {typeName}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[11.9px] text-white uppercase font-black tracking-widest">Marca</span>
                      <span className="text-white text-xs font-bold truncate">
                        {bow.brand || "Sin especificar"}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[11.9px] text-white uppercase font-black tracking-widest">Modelo</span>
                      <span className="text-white text-xs font-bold truncate">
                        {bow.model || "Sin especificar"}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[11.9px] text-white uppercase font-black tracking-widest">Potencia / Apertura</span>
                      <span className="text-white text-xs font-bold">
                        {bow.poundage ? `${bow.poundage} lbs` : "-"}
                        {bow.drawLength ? ` • ${bow.drawLength}"` : ""}
                      </span>
                    </div>
                    <div className="h-12 bg-neutral-900/60 border border-white/5 rounded-xl px-3.5 flex flex-col justify-center">
                      <span className="text-[11.9px] text-white uppercase font-black tracking-widest">Orientación</span>
                      <span className="text-cyan-neon text-xs font-black uppercase">
                        {(bow.hand || "RH") === "RH" ? "Diestro (RH)" : "Zurdo (LH)"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {bowsList.length < 3 && (
              <p className="text-[13.2px] text-white text-center pt-0.5 italic">
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
          <span className="text-[13.2px] text-white leading-snug">Alertas de retos, duelos 1v1 y recordatorios</span>
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

      {/* SECTION 3.8: Estrellas 101010 720 */}
      <div className="bg-[#0D1017] border border-white/[0.08] rounded-3xl p-5 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-2">
          <Star size={14} className="text-yellow-gold fill-yellow-gold" />
          {t("starsShelfTitle")}
        </h4>

        {maxStar ? (
          <div className="flex flex-col gap-3">
            {/* Medalla estrella activa */}
            <div className="flex items-center gap-3.5 bg-[#090B0E] p-3.5 rounded-2xl border border-white/[0.06]">
              <div 
                className="w-12 h-12 rounded-full border flex items-center justify-center shrink-0"
                style={{ 
                  borderColor: maxStar.starColor,
                  color: maxStar.starColor,
                  backgroundColor: `${maxStar.starColor}15`
                }}
              >
                <Star size={20} fill="currentColor" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-white text-xs font-black uppercase tracking-wide truncate">
                  {maxStar.starName}
                </span>
                <span className="text-[13.2px] text-white mt-0.5 font-bold uppercase tabular-nums">
                  {t("recordLabel")} {maxStar.highestScore} pts ({maxStar.bowType === "Compound" ? "Compuesto" : maxStar.bowType === "Recurve" ? "Recurvo" : maxStar.bowType})
                </span>
              </div>
            </div>

            {/* Progreso a la siguiente meta */}
            {(() => {
              const bow = maxStar.bowType;
              const tiers = bow === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
              const currentLevel = maxStar.highestStarLevel;
              
              if (currentLevel >= 8) {
                return (
                  <div className="bg-cyan-brand/10 border border-cyan-neon/20 p-2.5 rounded-xl text-[13.2px] text-center text-cyan-neon font-black uppercase tracking-wider">
                    {t("maxStarAchieved")}
                  </div>
                );
              }
              
              const nextStar = tiers[currentLevel]; // level is 1-indexed, so tiers[currentLevel] is level + 1
              const prevMin = tiers[currentLevel - 1].minScore;
              const highestScore = maxStar.highestScore;
              const targetMin = nextStar.minScore;
              
              const percent = Math.min(100, Math.max(0, ((highestScore - prevMin) / (targetMin - prevMin)) * 100));
              
              return (
                <div className="flex flex-col gap-1.5 mt-1">
                  <div className="flex justify-between text-[11.9px] text-white font-black uppercase tracking-wider tabular-nums">
                    <span>{t("nextLabel")} {nextStar.name}</span>
                    <span className="text-white">{highestScore} / {targetMin} pts</span>
                  </div>
                  <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-white/5 relative">
                    <div 
                      className="h-full rounded-full transition-all duration-500"
                      style={{ 
                        width: `${percent}%`,
                        backgroundColor: nextStar.color
                      }}
                    />
                  </div>
                  <span className="text-[11.9px] text-white leading-none tabular-nums">
                    Faltan {targetMin - highestScore} {t("pointsToNextStar")}
                  </span>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 py-1">
            <p className="text-[14.5px] text-white leading-snug">
              {t("lockedStarNotice")}
            </p>
          </div>
        )}

        {/* Vitrina completa de 8 Estrellas (Bloqueadas/Desbloqueadas) */}
        {(() => {
          const bowTypeForStars = user?.bowConfig?.type === "Compound" ? "Compound" : "Recurve";
          const starsList = bowTypeForStars === "Compound" ? COMPOUND_STARS : RECURVE_STARS;
          const highestLevel = maxStar ? maxStar.highestStarLevel : 0;
          
          return (
            <div className="grid grid-cols-4 gap-3.5 mt-2 pt-3 border-t border-white/[0.05]">
              {starsList.map((star) => {
                const isUnlocked = star.level <= highestLevel;
                return (
                  <div key={star.level} className="flex flex-col items-center gap-1 text-center group">
                    <div 
                      className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all duration-300 relative ${
                        isUnlocked 
                          ? "" 
                          : "grayscale opacity-35 bg-neutral-950 border-neutral-850"
                      }`}
                      style={{
                        borderColor: isUnlocked ? star.color : '#2d2d2d',
                        color: isUnlocked ? star.color : '#3d3d3d',
                        backgroundColor: isUnlocked ? `${star.color}12` : 'rgba(0,0,0,0.2)',
                      }}
                      title={`${star.name}: ${star.minScore}+ pts`}
                    >
                      <Star size={14} fill="currentColor" />
                      {!isUnlocked && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                          <Lock size={9} className="text-white" />
                        </div>
                      )}
                    </div>
                    <span 
                      className={`text-[10.6px] font-black truncate max-w-[55px] uppercase tracking-wider leading-none mt-1 ${
                        isUnlocked ? "text-white" : "text-white"
                      }`}
                    >
                      {star.name.replace("Estrella de ", "").replace("Estrella ", "")}
                    </span>
                    <span className="text-[10.6px] text-white font-bold leading-none tabular-nums">
                      {star.minScore}+
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* SECTION 4.5: Mi Club y Entrenador (Para atletas / arqueros) */}
      {(user.role === "archer" || (!user.isClubCreator && user.role !== "coach" && user.role !== "team_admin" && user.role !== "team_admin_coach")) && (
        <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-cyan-neon" />
              Mi Club y Entrenador
            </h4>
            {user.clubId && (
              <span className="text-[11.9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Vinculado
              </span>
            )}
          </div>

          {clubJoinFeedback && (
            <div className={`p-3 rounded-2xl text-xs font-medium flex items-center gap-2 border ${
              clubJoinFeedback.type === "success" 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" 
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}>
              {clubJoinFeedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              )}
              <span className="leading-snug">{clubJoinFeedback.message}</span>
            </div>
          )}

          {user.clubId ? (
            <div className="flex flex-col gap-3">
              {/* Tarjeta del Club Vinculado */}
              <div className="flex items-center gap-3.5 bg-neutral-950/50 p-3.5 rounded-2xl border border-white/5">
                <ClubLogoIcon logo={user.clubLogo || "0"} className="w-12 h-12 shrink-0 bg-neutral-900 border border-white/10 rounded-xl p-1.5" />
                <div className="flex flex-col min-w-0">
                  <span className="text-white text-xs font-black truncate">{user.clubName || "Club Deportivo"}</span>
                  <span className="text-[13.2px] text-white flex items-center gap-1 mt-0.5">
                    <span className="text-[11.9px] font-bold uppercase tracking-wider text-cyan-neon/90 shrink-0">{COUNTRIES.find((c) => c.code === user.clubCountry)?.flag || "🇨🇷 CRC"}</span>
                    <span>·</span>
                    <span className="truncate">{COUNTRIES.find((c) => c.code === user.clubCountry)?.name || user.country}</span>
                  </span>
                  {user.clubInviteCode && (
                    <span className="text-[11.9px] font-mono text-cyan-neon/90 mt-0.5">
                      Código: {user.clubInviteCode}
                    </span>
                  )}
                </div>
              </div>

              {/* Información del Entrenador */}
              <div className="bg-neutral-950/30 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11.9px] text-white uppercase font-black tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3 text-cyan-neon" /> Tu Entrenador
                  </span>
                  {coachProfile?.whatsappNumber && (
                    <a
                      href={`https://wa.me/${coachProfile.whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola Coach ${coachProfile.fullName}, soy ${user.fullName}. Te escribo desde Archery 101010.`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-[13.2px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all"
                    >
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </a>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white font-bold">{coachProfile?.fullName || "Entrenador Asignado"}</span>
                  <span className="text-[13.2px] text-white">{coachProfile?.email || "En línea"}</span>
                </div>
                <div className="bg-cyan-brand/10 border border-cyan-neon/15 rounded-xl p-2 text-[13.2px] text-cyan-300 leading-snug flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-neon shrink-0" />
                  <span>Tus planillas y series se sincronizan en tiempo real con el panel de tu coach.</span>
                </div>
              </div>

              {/* Desvincularse */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleLeaveClub}
                  className="text-[14.5px] text-red-400/80 hover:text-red-400 font-bold transition-colors cursor-pointer py-1 px-2"
                >
                  Desvincularme del club
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[14.5px] text-white leading-snug">
                Pídele a tu entrenador o club su código de invitación de 6 dígitos (ej. <strong className="text-white">101010</strong>) para vincularte. Al vincularte, tu entrenador podrá ver tus planillas de tiro, puntuaciones y darte retroalimentación al instante.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={athleteInviteCode}
                  onChange={(e) => setAthleteInviteCode(e.target.value.replace(/[^0-9a-zA-Z]/g, "").slice(0, 6))}
                  placeholder="Código de 6 dígitos"
                  className="flex-1 bg-neutral-950 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white uppercase font-mono tracking-wider placeholder:text-white outline-none focus:border-cyan-neon transition-colors"
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
      )}

      {/* SECTION 5: Coach/Admin management */}
      {(user.role === "coach" || user.role === "team_admin" || user.role === "team_admin_coach") && user.clubId && (
        <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <h4 className="text-white text-xs font-black uppercase tracking-wider">{t("clubManage")}</h4>
            <button
              onClick={() => {
                if (editClubDetails) handleSaveClubDetails();
                else setEditClubDetails(true);
              }}
              className="text-xs text-cyan-neon font-bold hover:underline cursor-pointer"
            >
              {editClubDetails ? "Guardar Ficha" : "Editar Ficha"}
            </button>
          </div>

          <div className="flex flex-col gap-3 mt-1">
            {editClubDetails ? (
              <div className="flex flex-col gap-3 p-1">
                {/* Edit Club Name */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11.9px] text-white font-bold uppercase tracking-wider">Nombre del Club</span>
                  <input
                    type="text"
                    value={clubName}
                    onChange={(e) => setClubName(e.target.value)}
                    className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                    placeholder="Nombre del club"
                  />
                </div>

                {/* Edit Club Country */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11.9px] text-white font-bold uppercase tracking-wider">País del Club</span>
                  <select
                    value={clubCountry}
                    onChange={(e) => setClubCountry(e.target.value)}
                    className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Edit Club Logo */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11.9px] text-white font-bold uppercase tracking-wider">Logotipo del Club</span>
                  <div className="grid grid-cols-5 gap-2 bg-neutral-950/60 p-2 rounded-xl border border-white/5">
                    {["0", "1", "2", "3", "4"].map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setClubLogo(idx);
                          setIsCustomLogo(false);
                        }}
                        className={`aspect-square p-1 rounded-lg border flex items-center justify-center transition-all ${
                          !isCustomLogo && clubLogo === idx
                            ? "border-cyan-neon bg-cyan-neon/10"
                            : "border-transparent bg-neutral-900/50 hover:bg-neutral-800"
                        }`}
                      >
                        <ClubLogoIcon logo={idx} className="w-6 h-6" />
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="checkbox"
                      id="useCustomLogoProfile"
                      checked={isCustomLogo}
                      onChange={(e) => setIsCustomLogo(e.target.checked)}
                      className="rounded border-neutral-700 bg-neutral-950 text-cyan-neon focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <label htmlFor="useCustomLogoProfile" className="text-[11.9px] text-white font-bold uppercase cursor-pointer select-none">
                      Imagen personalizada (URL)
                    </label>
                  </div>

                  {isCustomLogo && (
                    <input
                      type="text"
                      value={customLogoUrl}
                      onChange={(e) => setCustomLogoUrl(e.target.value)}
                      placeholder="https://ejemplo.com/logo.png"
                      className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 mt-1">
                {/* Preview Card */}
                <div className="flex items-center gap-3 bg-neutral-950/40 p-3 rounded-2xl border border-white/5">
                  <ClubLogoIcon logo={user.clubLogo || "0"} className="w-12 h-12 shrink-0 bg-neutral-900 border border-white/10 rounded-xl p-1.5" />
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-white text-xs font-black truncate">{user.clubName || "Club Olímpico"}</span>
                    <span className="text-[13.2px] text-white mt-0.5 flex items-center gap-1">
                      <span className="text-[11.9px] font-bold uppercase tracking-wider text-cyan-neon/90 shrink-0">{COUNTRIES.find((c) => c.code === user.clubCountry)?.flag || "🇨🇷 CRC"}</span>
                      <span>·</span>
                      <span className="truncate">{COUNTRIES.find((c) => c.code === user.clubCountry)?.name || "Costa Rica"}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Invite code (6 dígitos) */}
            <div className="flex flex-col gap-1 border-t border-white/[0.03] pt-2">
              <span className="text-[11.9px] text-white font-bold uppercase tracking-wider">{t("inviteCode")} (6 dígitos)</span>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-mono font-black text-cyan-neon tracking-widest bg-neutral-950 p-2.5 rounded-xl border border-white/5 text-center select-all">
                  {user.clubInviteCode && user.clubInviteCode.length <= 6 && /^\d+$/.test(user.clubInviteCode) 
                    ? user.clubInviteCode 
                    : "101010"}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm("¿Deseas generar un nuevo código de 6 dígitos para tus alumnos?")) {
                      const { generateClubInviteCode, updateProfile } = await import("@/lib/authService");
                      const freshCode = generateClubInviteCode();
                      const updated = await updateProfile(user.uid, { clubInviteCode: freshCode });
                      onProfileUpdated(updated);
                      alert(`Nuevo código de 6 dígitos generado: ${freshCode}`);
                    }
                  }}
                  className="px-3 py-2.5 bg-neutral-900 border border-white/10 rounded-xl text-cyan-neon hover:text-white text-xs font-bold transition cursor-pointer active:scale-95"
                  title="Borrar y generar nuevo código de 6 dígitos"
                >
                  Nuevo
                </button>
              </div>
            </div>

            {/* Coach personal WhatsApp */}
            <div className="flex flex-col gap-1">
              <span className="text-[11.9px] text-white font-bold uppercase tracking-wider">{t("clubWhatsApp")}</span>
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

            {/* Act as Coach switcher for Team Admin */}
            {(user.role === "team_admin" || user.role === "team_admin_coach" || user.isClubCreator) && (
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-neutral-950/60 border border-white/5 mt-1">
                <div className="flex flex-col">
                  <span className="text-[13.2px] text-white font-extrabold uppercase">Actuar como Coach</span>
                  <span className="text-[10.6px] text-white mt-0.5 leading-snug">Habilita el panel de coach y la vista de atletas.</span>
                </div>
                <input
                  type="checkbox"
                  checked={user.role === "team_admin_coach" || user.role === "coach"}
                  onChange={handleToggleAdminCoachSelf}
                  className="w-4 h-4 accent-cyan-neon cursor-pointer"
                />
              </div>
            )}

            {/* Club Members Roster Section */}
            {user.clubId && (user.role === "team_admin" || user.role === "team_admin_coach" || user.isClubCreator) && (
              <div className="flex flex-col gap-2.5 border-t border-white/[0.03] pt-4 mt-2">
                <span className="text-[13.2px] text-white font-bold uppercase tracking-wider">Miembros del Roster ({clubMembers.length})</span>
                
                <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {clubMembers.map((member) => {
                    const isSelf = member.uid === user.uid;
                    const isMemberCoach = member.role === "coach" || member.role === "team_admin_coach";
                    
                    return (
                      <div key={member.uid} className="flex items-center justify-between p-2 rounded-xl bg-neutral-950/60 border border-white/5">
                        <div className="flex flex-col min-w-0 pr-2 pl-2">
                          <span className="text-[13.2px] font-black text-white truncate">
                            {member.fullName} {isSelf && <span className="text-cyan-neon font-normal text-[10.6px]">(Tú)</span>}
                          </span>
                          <span className="text-[10.6px] text-white uppercase mt-0.5 font-bold">
                            {member.role === "team_admin_coach" 
                              ? "Admin / Coach" 
                              : member.role === "team_admin" 
                                ? "Administrador" 
                                : member.role === "coach" 
                                  ? "Coach" 
                                  : "Atleta"}
                          </span>
                        </div>

                        <div className="flex gap-1.5 shrink-0 pr-2">
                          {!isMemberCoach ? (
                            <button
                              type="button"
                              onClick={() => handlePromoteToCoach(member.uid)}
                              className="px-2 py-1 bg-cyan-neon/10 border border-cyan-neon/20 hover:bg-cyan-neon/20 text-cyan-neon font-black text-[11.9px] uppercase tracking-wider rounded-lg transition active:scale-95"
                            >
                              Hacer Coach
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSelf && member.role === "team_admin_coach"} // cannot demote self from coach if it's the admin this way (use the toggle instead)
                              onClick={() => handleDemoteToArcher(member.uid)}
                              className={`px-2 py-1 bg-yellow-gold/10 border border-yellow-gold/20 hover:bg-yellow-gold/20 text-yellow-gold font-black text-[11.9px] uppercase tracking-wider rounded-lg transition active:scale-95 ${
                                isSelf && member.role === "team_admin_coach" ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                            >
                              Quitar Coach
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Transfer role */}
            <button
              onClick={handleCoachTransfer}
              className="w-full py-2.5 mt-1 rounded-xl bg-red-rival/10 border border-red-rival/35 text-red-rival font-bold text-xs uppercase cursor-pointer hover:bg-red-rival/20 transition active:scale-98"
            >
              {t("transferBtn")}
            </button>
          </div>
        </div>
      )}

      {/* Superadmin Panel Direct Link */}
      {(user.role === "superadmin" || user.email?.toLowerCase().includes("admin") || devSimulateSuperAdmin) && onNavigate && (
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 flex flex-col gap-2.5">
          <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Shield size={14} className="text-purple-400" />
            <span>Panel de Administración</span>
          </h3>
          <p className="text-[13.2px] text-white leading-relaxed">
            Tienes privilegios de Super Administrador para gestionar usuarios, publicidad y ajustes.
          </p>
          <button
            onClick={() => onNavigate("ADMIN")}
            className="w-full py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 font-bold text-xs uppercase cursor-pointer hover:bg-purple-500/20 transition active:scale-98"
          >
            Abrir Panel Admin
          </button>
        </div>
      )}

      {/* DEV TOOLS Simulator PRO Toggle */}
      {user.role === "superadmin" && (
        <div className="border border-dashed border-red-rival/40 p-4 rounded-3xl flex flex-col gap-3 bg-neutral-950/40">
          <span className="text-xs text-red-rival font-mono font-bold leading-none">{t("devMode")}</span>
          
          <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
            <span className="text-[13.2px] text-white font-mono">Simulate PRO Account</span>
            <button
              onClick={handleDevProToggle}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                devSimulatePro ? "bg-red-rival" : "bg-gray-border"
              }`}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all"
                style={{ left: devSimulatePro ? "18px" : "2px" }}
              />
            </button>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-[13.2px] text-white font-mono">Simulate SuperAdmin Role</span>
            <button
              onClick={handleDevSuperAdminToggle}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                devSimulateSuperAdmin ? "bg-red-rival" : "bg-gray-border"
              }`}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all"
                style={{ left: devSimulateSuperAdmin ? "18px" : "2px" }}
              />
            </button>
          </div>
        </div>
      )}

      {/* Botones de Soporte y Legal */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {/* Manual de Usuario Button */}
        <button
          onClick={() => window.open("/manual/", "_blank")}
          className="py-3 rounded-full border border-cyan-neon/30 hover:bg-cyan-neon/5 text-cyan-neon font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <BookOpen size={15} />
          <span>Manual</span>
        </button>

        {/* Política de Privacidad Button */}
        <button
          onClick={() => window.open("/privacy", "_blank")}
          className="py-3 rounded-full border border-white/10 hover:bg-white/5 text-white hover:text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <Shield size={15} />
          <span>Privacidad</span>
        </button>
      </div>

      {/* Log out Action Button */}
      <button
        onClick={handleLogoutClick}
        className="w-full py-3.5 mt-2 rounded-full border border-red-rival/30 hover:bg-red-rival/5 text-red-rival font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <LogOut size={16} />
        <span>{t("logout")}</span>
      </button>

      {/* Delete Account & Data Action Button (Google Play / App Store Policy Requirement) */}
      <button
        onClick={() => setIsDeleteAccountOpen(true)}
        className="w-full py-2.5 rounded-full border border-white/5 hover:border-red-rival/40 text-white hover:text-red-rival font-bold text-[14.5px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
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
              <div className="w-11 h-11 rounded-2xl bg-red-rival/10 border border-red-rival/25 flex items-center justify-center mx-auto text-red-rival">
                <Trash2 size={20} />
              </div>
              <h3 className="text-white text-base font-black tracking-tight">
                ¿Eliminar cuenta permanentemente?
              </h3>
              <p className="text-xs text-white leading-relaxed">
                Esta acción es <strong className="text-white">irreversible</strong>. Se eliminarán tu perfil (<span className="text-white font-mono">{user.email}</span>), arcos, sesiones, historial de duelos y récords.
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
                  className="flex-1 h-11 rounded-2xl bg-red-rival hover:brightness-110 text-white font-black text-xs uppercase tracking-wider cursor-pointer transition active:scale-95 disabled:opacity-50"
                >
                  {isDeletingAccount ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PAYWALL DIALOG */}
      <AnimatePresence>
        {isPaywallOpen && (
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
              className="w-full max-w-sm bg-[#0B0D12] border border-white/[0.08] p-6 rounded-3xl flex flex-col gap-5 shadow-2xl text-left"
            >
              <div className="flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <span className="text-[13.2px] text-cyan-neon font-bold uppercase tracking-widest">
                    Lanzamiento Oficial
                  </span>
                  <h3 className="text-white text-xl font-black tracking-tight">
                    Archery Pro
                  </h3>
                </div>
                <button
                  onClick={() => setIsPaywallOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] text-white hover:text-white flex items-center justify-center cursor-pointer transition"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Benefits checklist */}
              <div className="bg-[#0D1017] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-2.5">
                {[
                  "Planificación de ciclos y macroestructuras",
                  "Spine Matching y ajuste balístico de flechas",
                  "Portal Coach con seguimiento en vivo",
                  "Analítica avanzada de dispersión olímpica"
                ].map((b, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 text-xs text-white">
                    <Check size={14} className="text-cyan-neon mt-0.5 shrink-0" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              {/* Price card: Launch special */}
              <div className="bg-[#0D1017] p-4 rounded-2xl border border-white/[0.08] flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[13.2px] text-white line-through font-mono tabular-nums">$4.99 USD / mes</span>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-2xl font-black text-white tabular-nums tracking-tight">
                      $0.00
                    </span>
                    <span className="text-[13.2px] text-cyan-neon font-bold uppercase tracking-wider">
                      Bonificado
                    </span>
                  </div>
                </div>
                <span className="text-[11.9px] text-white font-bold uppercase tracking-wider bg-white/[0.05] border border-white/[0.08] px-2.5 py-1 rounded-lg">
                  Pioneros
                </span>
              </div>

              {/* Free Launch Activation Button */}
              <button
                onClick={handlePaypalUpgrade}
                className="h-12 w-full rounded-2xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.99]"
              >
                <span>Activar Cuenta Pro</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// X Close Icon helper
function X({ size, className, ...props }: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
