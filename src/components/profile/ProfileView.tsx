"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile, updateProfile, transferCoachRole, logoutUser, getLoggedUser } from "@/lib/authService";
import { saveLocalSetting, getLocalSetting } from "@/lib/db/indexedDB";
import { ArrowLeft, User, Settings, ShieldAlert, Sparkles, Volume2, HelpCircle, LogOut, Check, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import ClubLogoIcon from "../ui/ClubLogoIcon";

interface ProfileViewProps {
  user: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  onProfileUpdated: (updatedUser: UserProfile) => void;
  onNavigate?: (screen: any) => void;
}

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

export default function ProfileView({ user, onBack, onLogout, onProfileUpdated, onNavigate }: ProfileViewProps) {
  const { t } = useLanguage();
  
  // Section edit toggles
  const [editPersonal, setEditPersonal] = useState(false);
  const [editBow, setEditBow] = useState(false);
  const [editPhysical, setEditPhysical] = useState(false);
  const [editClubDetails, setEditClubDetails] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);

  // Form Fields
  const [fullName, setFullName] = useState(user.fullName);
  const [birthDate, setBirthDate] = useState(user.birthDate);
  const [country, setCountry] = useState(user.country);
  const [gender, setGender] = useState(user.gender);

  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(user.bowConfig.type);
  const [bowBrand, setBowBrand] = useState(user.bowConfig.brand);
  const [bowModel, setBowModel] = useState(user.bowConfig.model);
  const [poundage, setPoundage] = useState(user.bowConfig.poundage);
  const [defaultDistance, setDefaultDistance] = useState(user.bowConfig.defaultDistance);

  const [height, setHeight] = useState(user.physicalData.height);
  const [weight, setWeight] = useState(user.physicalData.weight);
  const [dominantEye, setDominantEye] = useState<"L" | "R">(user.physicalData.dominantEye);
  const [dominantHand, setDominantHand] = useState<"L" | "R">(user.physicalData.dominantHand);

  // Notification Toggles
  const [pushNotif, setPushNotif] = useState(true);
  const [emailNotif, setEmailNotif] = useState(true);
  const [waNotif, setWaNotif] = useState(true);
  
  // Font Size Accessibility State
  const [fontSize, setFontSize] = useState("medium");

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

  // Load toggles from settings
  useEffect(() => {
    async function loadToggles() {
      const push = await getLocalSetting("notif_push", true);
      const email = await getLocalSetting("notif_email", true);
      const wa = await getLocalSetting("notif_wa", true);
      const size = await getLocalSetting<string>("user_font_size", "medium");
      setPushNotif(push);
      setEmailNotif(email);
      setWaNotif(wa);
      setFontSize(size);
    }
    loadToggles();
  }, []);

  const handleFontSizeChange = async (size: string) => {
    setFontSize(size);
    await saveLocalSetting("user_font_size", size);
    
    // Apply font size directly to root element
    const root = document.documentElement;
    if (size === "small") {
      root.style.fontSize = "14px";
    } else if (size === "large") {
      root.style.fontSize = "18px";
    } else {
      root.style.fontSize = "16px";
    }
  };

  const handleSavePersonal = async () => {
    try {
      const updated = await updateProfile(user.uid, {
        fullName,
        birthDate,
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
      const updated = await updateProfile(user.uid, {
        bowConfig: {
          type: bowType,
          brand: bowBrand,
          model: bowModel,
          poundage: Number(poundage),
          defaultDistance: Number(defaultDistance)
        }
      });
      onProfileUpdated(updated);
      setEditBow(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSavePhysical = async () => {
    try {
      const updated = await updateProfile(user.uid, {
        physicalData: {
          height: Number(height),
          weight: Number(weight),
          dominantEye,
          dominantHand
        }
      });
      onProfileUpdated(updated);
      setEditPhysical(false);
    } catch (e) {
      console.error(e);
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
    await logoutUser();
    onLogout();
  };

  const handleNotifToggle = async (key: string, currentVal: boolean, setVal: (v: boolean) => void) => {
    const nextVal = !currentVal;
    setVal(nextVal);
    await saveLocalSetting(key, nextVal);
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
        birthDate: "1990-01-01",
        country: "CR",
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
    <div className="flex flex-col gap-5 py-4 min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-neutral-900 border border-gray-border text-gray-dim hover:text-white cursor-pointer"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-white text-lg font-black uppercase tracking-wide">
            {t("settingsTitle")}
          </h2>
          <p className="text-[10px] text-gray-dim uppercase tracking-wider">Ajustes</p>
        </div>
      </div>

      {/* User Header Profile Card */}
      <div className="bg-neutral-900/60 p-4 rounded-3xl border border-white/10 flex items-center gap-4 relative overflow-hidden">
        <div className="w-16 h-16 rounded-full bg-cyan-brand/20 border-2 border-cyan-neon flex items-center justify-center text-cyan-neon font-black text-xl shadow-glow-cyan">
          {user.fullName.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col">
          <span className="text-white font-extrabold text-base truncate max-w-[180px]">{user.fullName}</span>
          <span className="text-[10px] text-gray-dim mt-0.5 truncate max-w-[180px]">{user.email}</span>
          
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] bg-cyan-neon/10 border border-cyan-neon/20 text-cyan-neon font-black px-2 py-0.5 rounded-full uppercase">
              {user.role}
            </span>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${
              user.plan === "PRO" 
                ? "bg-yellow-gold/10 border border-yellow-gold/20 text-yellow-gold shadow-glow-yellow"
                : "bg-neutral-800 border border-neutral-700 text-gray-dim"
            }`}>
              {user.plan}
            </span>
          </div>
        </div>
      </div>

      {/* Subscription Card PRO paywall trigger */}
      <div className={`p-4 rounded-3xl border transition-all duration-300 ${
        user.plan === "PRO"
          ? "bg-neutral-900/40 border-yellow-gold/20 shadow-[0_0_12px_rgba(255,242,0,0.03)]"
          : "bg-neutral-900/60 border-white/5"
      }`}>
        <h4 className="text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles size={14} className="text-yellow-gold" />
          {t("subCardTitle")}
        </h4>
        {user.plan === "FREE" ? (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-[10px] text-gray-dim leading-snug">
              Desbloquea macrociclos de entrenamiento, tuning de flechas (Spine Matching), y guías de ejercicios premium.
            </p>
            <button
              onClick={() => setIsPaywallOpen(true)}
              className="w-full py-2.5 mt-1 rounded-xl bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider cursor-pointer shadow-glow-yellow hover:brightness-110 active:scale-95 transition"
            >
              Adquirir PRO ✦
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] text-gray-dim font-bold">
              <span>{t("billingDate")}</span>
              <span className="text-white">27 de Junio, 2026</span>
            </div>
            <div className="flex justify-between text-[10px] text-gray-dim font-bold mt-1">
              <span>Paypal email:</span>
              <span className="text-white truncate max-w-[160px]">{user.email}</span>
            </div>
            <button
              onClick={() => {
                const nextUser = { ...user, plan: "FREE" } as UserProfile;
                onProfileUpdated(nextUser);
                setDevSimulatePro(false);
                alert("Suscripción PRO cancelada (simulado)");
              }}
              className="text-[10px] text-red-rival hover:underline font-bold text-left self-start mt-2 cursor-pointer"
            >
              Cancelar Suscripción
            </button>
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
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
              placeholder={t("fullName")}
            />
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none uppercase"
            />
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
              <span className="text-gray-dim">Nombre:</span>
              <span className="text-white font-bold">{user.fullName}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Nacimiento:</span>
              <span className="text-white font-bold">{user.birthDate}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">País:</span>
              <span className="text-white font-bold">
                {COUNTRIES.find((c) => c.code === user.country)?.flag} {COUNTRIES.find((c) => c.code === user.country)?.name}
              </span>
            </div>
            <div className="flex justify-between text-xs py-1">
              <span className="text-gray-dim">Género:</span>
              <span className="text-white font-bold">
                {user.gender === "M" ? t("genderM") : user.gender === "F" ? t("genderF") : t("genderO")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Bow configuration */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-white text-xs font-black uppercase tracking-wider">{t("bowConfig")}</h4>
          <button
            onClick={() => {
              if (editBow) handleSaveBow();
              else setEditBow(true);
            }}
            className="text-xs text-cyan-neon font-bold hover:underline cursor-pointer"
          >
            {editBow ? "Guardar" : "Editar"}
          </button>
        </div>

        {editBow ? (
          <div className="flex flex-col gap-3 mt-1">
            <select
              value={bowType}
              onChange={(e) => setBowType(e.target.value as any)}
              className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
            >
              <option value="Recurve">Recurve</option>
              <option value="Compound">Compound</option>
              <option value="Barebow">Barebow</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={bowBrand}
                onChange={(e) => setBowBrand(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Marca"
              />
              <input
                type="text"
                value={bowModel}
                onChange={(e) => setBowModel(e.target.value)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Modelo"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={poundage}
                onChange={(e) => setPoundage(Number(e.target.value))}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Libras"
              />
              <input
                type="number"
                value={defaultDistance}
                onChange={(e) => setDefaultDistance(Number(e.target.value))}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Distancia"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Tipo de arco:</span>
              <span className="text-white font-bold">{user.bowConfig.type}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Marca/Modelo:</span>
              <span className="text-white font-bold">{user.bowConfig.brand} {user.bowConfig.model}</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Poundaje:</span>
              <span className="text-white font-bold">{user.bowConfig.poundage} lbs</span>
            </div>
            <div className="flex justify-between text-xs py-1">
              <span className="text-gray-dim">Distancia predeterminada:</span>
              <span className="text-white font-bold">{user.bowConfig.defaultDistance}m</span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: Physical Data */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h4 className="text-white text-xs font-black uppercase tracking-wider">{t("physicalData")}</h4>
          <button
            onClick={() => {
              if (editPhysical) handleSavePhysical();
              else setEditPhysical(true);
            }}
            className="text-xs text-cyan-neon font-bold hover:underline cursor-pointer"
          >
            {editPhysical ? "Guardar" : "Editar"}
          </button>
        </div>

        {editPhysical ? (
          <div className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Altura (cm)"
              />
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
                placeholder="Peso (kg)"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={dominantEye}
                onChange={(e) => setDominantEye(e.target.value as any)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
              >
                <option value="L">Ojo: Izquierdo (L)</option>
                <option value="R">Ojo: Derecho (R)</option>
              </select>
              <select
                value={dominantHand}
                onChange={(e) => setDominantHand(e.target.value as any)}
                className="w-full bg-neutral-950 border border-gray-border text-white text-xs p-2.5 rounded-xl outline-none"
              >
                <option value="L">Mano: Izquierda (L)</option>
                <option value="R">Mano: Derecha (R)</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Estatura / Peso:</span>
              <span className="text-white font-bold">{user.physicalData.height} cm / {user.physicalData.weight} kg</span>
            </div>
            <div className="flex justify-between text-xs py-1 border-b border-gray-border/20">
              <span className="text-gray-dim">Ojo dominante:</span>
              <span className="text-white font-bold">{user.physicalData.dominantEye === "L" ? "Izquierdo" : "Derecho"}</span>
            </div>
            <div className="flex justify-between text-xs py-1">
              <span className="text-gray-dim">Mano dominante:</span>
              <span className="text-white font-bold">{user.physicalData.dominantHand === "L" ? "Izquierda" : "Derecha"}</span>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 4: Preferences Notifications */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider">{t("notifTitle")}</h4>
        <div className="flex flex-col gap-3.5 mt-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/90 font-bold">{t("pushNotif")}</span>
            <button
              onClick={() => handleNotifToggle("notif_push", pushNotif, setPushNotif)}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                pushNotif ? "bg-cyan-neon" : "bg-gray-border"
              }`}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all"
                style={{ left: pushNotif ? "18px" : "2px" }}
              />
            </button>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-white/90 font-bold">{t("emailNotif")}</span>
            <button
              onClick={() => handleNotifToggle("notif_email", emailNotif, setEmailNotif)}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                emailNotif ? "bg-cyan-neon" : "bg-gray-border"
              }`}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all"
                style={{ left: emailNotif ? "18px" : "2px" }}
              />
            </button>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-white/90 font-bold">{t("waNotif")}</span>
            <button
              onClick={() => handleNotifToggle("notif_wa", waNotif, setWaNotif)}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                waNotif ? "bg-cyan-neon" : "bg-gray-border"
              }`}
            >
              <div
                className="w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all"
                style={{ left: waNotif ? "18px" : "2px" }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 4.5: Accessibility Settings (Font Size) */}
      <div className="bg-neutral-900/40 border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
        <h4 className="text-white text-xs font-black uppercase tracking-wider">Ajuste de Texto</h4>
        <div className="flex flex-col gap-2 mt-1">
          <p className="text-[10px] text-gray-dim leading-snug">
            Ajusta el tamaño de la letra para facilitar la lectura de las planillas de tiro y estadísticas de forma síncrona.
          </p>
          <div className="grid grid-cols-3 gap-2 bg-neutral-950/60 p-1 rounded-xl border border-white/5 mt-1">
            {[
              { id: "small", label: "Pequeño" },
              { id: "medium", label: "Mediano" },
              { id: "large", label: "Grande" }
            ].map((size) => {
              const isActive = fontSize === size.id;
              return (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => handleFontSizeChange(size.id)}
                  className={`py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? "bg-cyan-neon/10 border border-cyan-neon text-cyan-neon shadow-glow-cyan"
                      : "bg-transparent border border-transparent text-gray-dim hover:text-white"
                  }`}
                >
                  {size.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION 5: Coach management (Visible only to coaches) */}
      {user.role === "coach" && user.clubId && (
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
                  <span className="text-[9px] text-gray-dim font-bold uppercase tracking-wider">Nombre del Club</span>
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
                  <span className="text-[9px] text-gray-dim font-bold uppercase tracking-wider">País del Club</span>
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
                  <span className="text-[9px] text-gray-dim font-bold uppercase tracking-wider">Logotipo del Club</span>
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
                    <label htmlFor="useCustomLogoProfile" className="text-[9px] text-gray-dim font-bold uppercase cursor-pointer select-none">
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
                    <span className="text-[10px] text-gray-dim mt-0.5 flex items-center gap-1">
                      <span>{COUNTRIES.find((c) => c.code === user.clubCountry)?.flag || "🇨🇷"}</span>
                      <span className="truncate">{COUNTRIES.find((c) => c.code === user.clubCountry)?.name || "Costa Rica"}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Invite code */}
            <div className="flex flex-col gap-1 border-t border-white/[0.03] pt-2">
              <span className="text-[9px] text-gray-dim font-bold uppercase tracking-wider">{t("inviteCode")}</span>
              <span className="text-sm font-mono font-black text-cyan-neon tracking-widest bg-neutral-950 p-2.5 rounded-xl border border-white/5 text-center select-all">
                {user.clubInviteCode || "CLUB-1234"}
              </span>
            </div>

            {/* Coach personal WhatsApp */}
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-gray-dim font-bold uppercase tracking-wider">{t("clubWhatsApp")}</span>
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
      {user.role === "superadmin" && onNavigate && (
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 flex flex-col gap-2.5">
          <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-2">
            <Shield size={14} className="text-purple-400" />
            <span>Panel de Administración</span>
          </h3>
          <p className="text-[10px] text-white/50 leading-relaxed">
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
      <div className="border border-dashed border-red-rival/40 p-4 rounded-3xl flex flex-col gap-3 bg-neutral-950/40">
        <span className="text-xs text-red-rival font-mono font-bold leading-none">{t("devMode")}</span>
        
        <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
          <span className="text-[10px] text-white/60 font-mono">Simulate PRO Account</span>
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
          <span className="text-[10px] text-white/60 font-mono">Simulate SuperAdmin Role</span>
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

      {/* Log out Action Button */}
      <button
        onClick={handleLogoutClick}
        className="w-full py-3.5 mt-2 rounded-full border border-red-rival/30 hover:bg-red-rival/5 text-red-rival font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <LogOut size={16} />
        <span>{t("logout")}</span>
      </button>

      {/* PAYWALL DIALOG (PayPal SDK simulation modal) */}
      <AnimatePresence>
        {isPaywallOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] bg-black/85 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 15 }}
              className="w-full max-w-sm bg-neutral-900 border border-gray-border p-6 rounded-3xl flex flex-col gap-5 shadow-2xl text-left"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] text-yellow-gold font-black bg-yellow-gold/10 px-2 py-0.5 rounded-full border border-yellow-gold/20 shadow-glow-yellow">
                    PLAN PREMIUM
                  </span>
                  <h3 className="text-white text-lg font-black uppercase tracking-wide mt-1.5">
                    Adquirir Plan PRO ✦
                  </h3>
                </div>
                <button
                  onClick={() => setIsPaywallOpen(false)}
                  className="p-1.5 rounded-lg bg-neutral-800 text-gray-dim hover:text-white cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Benefits checklist */}
              <div className="flex flex-col gap-2.5">
                {[
                  "Acceso completo a planificación de Macrociclos",
                  "Módulo de Spine Matching (Tuning del arco)",
                  "Guías y rutinas de entrenamiento premium",
                  "Analytics y reportes avanzados de progresión"
                ].map((b, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-white/90">
                    <Check size={16} className="text-yellow-gold mt-0.5 shrink-0" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>

              {/* Price card */}
              <div className="bg-neutral-950 p-4 rounded-2xl border border-white/5 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-dim uppercase font-bold">Mensual</span>
                  <span className="text-xl font-black text-white">$4.99 USD</span>
                </div>
                <span className="text-[10px] text-cyan-neon font-black">Cancela cuando quieras</span>
              </div>

              {/* Mock PayPal Button */}
              <button
                onClick={handlePaypalUpgrade}
                className="w-full py-3 rounded-xl bg-[#FFC439] hover:bg-[#F2B522] text-[#003087] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg transition duration-200"
              >
                {/* Simulated PayPal typography style */}
                <span className="italic font-extrabold lowercase text-sm">Pay</span>
                <span className="italic font-extrabold lowercase text-sm text-[#0079C1] -ml-1">Pal</span>
                <span className="text-[10px] font-bold tracking-normal uppercase ml-1">Comprar</span>
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
