"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerUser } from "@/lib/authService";
import ClubLogoIcon from "../ui/ClubLogoIcon";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Award, Eye, User } from "lucide-react";

interface RegisterViewProps {
  onRegisterSuccess: (user: any) => void;
  onNavigateToLogin: () => void;
}

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

export default function RegisterView({ onRegisterSuccess, onNavigateToLogin }: RegisterViewProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState("CR");
  const [gender, setGender] = useState("M");

  const [clubOption, setClubOption] = useState<"CREATE" | "JOIN" | "NONE">("NONE");
  const [clubName, setClubName] = useState("");
  const [clubInviteCode, setClubInviteCode] = useState("");
  
  // Club Customization States
  const [clubCountry, setClubCountry] = useState("CR");
  const [clubLogo, setClubLogo] = useState("0");
  const [customLogoUrl, setCustomLogoUrl] = useState("");
  const [isCustomLogo, setIsCustomLogo] = useState(false);

  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">("Barebow");
  const [bowBrand, setBowBrand] = useState("");
  const [bowModel, setBowModel] = useState("");
  const [poundage, setPoundage] = useState(35);
  const [defaultDistance, setDefaultDistance] = useState(18);

  const [height, setHeight] = useState(175);
  const [weight, setWeight] = useState(70);
  const [dominantEye, setDominantEye] = useState<"L" | "R">("R");
  const [dominantHand, setDominantHand] = useState<"L" | "R">("R");

  const isAdult = () => {
    if (!birthDate) return false;
    const dob = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 18;
  };

  const handleNext = () => {
    setError("");
    if (step === 1) {
      if (!email || !password || !confirmPassword) {
        setError("Completa todos los campos");
        return;
      }
      if (password !== confirmPassword) {
        setError("Las contraseñas no coinciden");
        return;
      }
      if (password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres");
        return;
      }
    } else if (step === 2) {
      if (!fullName || !birthDate) {
        setError("Ingresa tu nombre y fecha de nacimiento");
        return;
      }
    } else if (step === 3) {
      if (clubOption === "CREATE" && !isAdult()) {
        setError("Debes ser mayor de edad para crear un club.");
        return;
      }
      if (clubOption === "CREATE" && !clubName) {
        setError("Ingresa el nombre del club");
        return;
      }
      if (clubOption === "JOIN" && !clubInviteCode) {
        setError("Ingresa el código del club");
        return;
      }
    } else if (step === 4) {
      if (!bowBrand || !bowModel) {
        setError("Ingresa la marca y modelo de tu arco");
        return;
      }
    }
    setStep(step + 1);
  };

  const handlePrev = () => {
    setError("");
    setStep(step - 1);
  };

  const handleRegister = async () => {
    setLoading(true);
    setError("");

    const clubIdParam =
      clubOption === "CREATE"
        ? "CREATE_NEW"
        : clubOption === "JOIN"
        ? clubInviteCode
        : "NONE";

    try {
      const user = await registerUser({
        email,
        password,
        fullName,
        birthDate,
        country,
        gender,
        clubId: clubIdParam,
        clubName: clubOption === "CREATE" ? clubName : null,
        clubLogo: clubOption === "CREATE" ? (isCustomLogo ? customLogoUrl : clubLogo) : undefined,
        clubCountry: clubOption === "CREATE" ? clubCountry : undefined,
        bowConfig: {
          type: bowType,
          brand: bowBrand,
          model: bowModel,
          poundage: Number(poundage),
          defaultDistance: Number(defaultDistance)
        },
        physicalData: {
          height: Number(height),
          weight: Number(weight),
          dominantEye,
          dominantHand
        }
      });
      onRegisterSuccess(user);
    } catch (err: any) {
      setError(err.message || "Error en el registro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between px-6 py-6 min-h-full">
      {/* Top Header */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={onNavigateToLogin}
          className="text-gray-dim hover:text-white flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>{t("back")}</span>
        </button>
        <span className="text-xs text-gray-dim font-bold tracking-widest uppercase">
          {t("registerTitle")}
        </span>
      </div>

      {/* Progress Stepper Indicator */}
      <div className="flex items-center justify-between w-full max-w-xs mx-auto mb-8 px-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <React.Fragment key={i}>
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border transition-all duration-200 ${
                step === i
                  ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon shadow-glow-cyan"
                  : step > i
                  ? "bg-cyan-brand/10 border-cyan-brand text-cyan-brand"
                  : "bg-transparent border-gray-border text-gray-dim"
              }`}
            >
              {step > i ? <Check size={12} /> : i}
            </div>
            {i < 5 && (
              <div
                className={`h-[2px] flex-1 mx-2 rounded-full transition-all duration-200 ${
                  step > i ? "bg-cyan-brand" : "bg-gray-border"
                }`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main Step Container */}
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto my-auto py-2">
        {error && (
          <div className="bg-red-rival/10 border border-red-rival/40 rounded-xl p-3 flex items-center gap-2 text-red-rival text-sm mb-4">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* STEP 1: Account credentials */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-2">{t("step1")}</h3>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmar contraseña"
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
            </motion.div>
          )}

          {/* STEP 2: Personal information */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-2">{t("step2")}</h3>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-dim">{t("fullName")}</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej. José Ángel"
                  className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-dim">{t("birthDate")}</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("country")}</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-3 py-3.5 rounded-xl outline-none transition-all duration-200"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-black text-white">
                        {c.flag} {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("gender")}</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-3 py-3.5 rounded-xl outline-none transition-all duration-200"
                  >
                    <option value="M" className="bg-black text-white">{t("genderM")}</option>
                    <option value="F" className="bg-black text-white">{t("genderF")}</option>
                    <option value="O" className="bg-black text-white">{t("genderO")}</option>
                  </select>
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Club logic */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-2">{t("step3")}</h3>

              {/* Club option cards */}
              <div className="flex flex-col gap-3">
                {/* Create club card (Adults only) */}
                <button
                  type="button"
                  onClick={() => isAdult() && setClubOption("CREATE")}
                  className={`w-full p-4 rounded-xl border text-left flex items-start gap-3.5 transition-all duration-200 cursor-pointer ${
                    !isAdult()
                      ? "border-neutral-800 bg-neutral-950/20 opacity-50 cursor-not-allowed"
                      : clubOption === "CREATE"
                      ? "border-cyan-neon bg-cyan-neon/5 shadow-glow-cyan"
                      : "border-white/10 bg-neutral-900/40 hover:border-cyan-brand/35"
                  }`}
                >
                  <Award className={clubOption === "CREATE" ? "text-cyan-neon" : "text-gray-dim"} size={22} />
                  <div>
                    <h4 className="text-white text-sm font-bold">{t("clubOptA")}</h4>
                    <p className="text-xs text-gray-dim mt-0.5">
                      Crea un club y conviértete en Coach (requiere ser mayor de edad).
                    </p>
                  </div>
                </button>

                {/* Join club card */}
                <button
                  type="button"
                  onClick={() => setClubOption("JOIN")}
                  className={`w-full p-4 rounded-xl border text-left flex items-start gap-3.5 transition-all duration-200 cursor-pointer ${
                    clubOption === "JOIN"
                      ? "border-cyan-neon bg-cyan-neon/5 shadow-glow-cyan"
                      : "border-white/10 bg-neutral-900/40 hover:border-cyan-brand/35"
                  }`}
                >
                  <User className={clubOption === "JOIN" ? "text-cyan-neon" : "text-gray-dim"} size={22} />
                  <div>
                    <h4 className="text-white text-sm font-bold">{t("clubOptB")}</h4>
                    <p className="text-xs text-gray-dim mt-0.5">
                      Únete a un club deportivo usando un código de invitación.
                    </p>
                  </div>
                </button>

                {/* Independent card */}
                <button
                  type="button"
                  onClick={() => setClubOption("NONE")}
                  className={`w-full p-4 rounded-xl border text-left flex items-start gap-3.5 transition-all duration-200 cursor-pointer ${
                    clubOption === "NONE"
                      ? "border-cyan-neon bg-cyan-neon/5 shadow-glow-cyan"
                      : "border-white/10 bg-neutral-900/40 hover:border-cyan-brand/35"
                  }`}
                >
                  <Eye className={clubOption === "NONE" ? "text-cyan-neon" : "text-gray-dim"} size={22} />
                  <div>
                    <h4 className="text-white text-sm font-bold">{t("clubOptC")}</h4>
                    <p className="text-xs text-gray-dim mt-0.5">
                      Continúa sin club, entrenando como arquero independiente.
                    </p>
                  </div>
                </button>
              </div>

              {/* Dynamic form depending on selected option */}
              {clubOption === "CREATE" && isAdult() && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="flex flex-col gap-3 mt-1"
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">Nombre del Club</label>
                    <input
                      type="text"
                      value={clubName}
                      onChange={(e) => setClubName(e.target.value)}
                      placeholder={t("clubNamePlaceholder")}
                      className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">País de origen</label>
                    <select
                      value={clubCountry}
                      onChange={(e) => setClubCountry(e.target.value)}
                      className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-xs px-3 py-2.5 rounded-xl outline-none"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code} className="bg-black text-white">
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-gray-dim font-bold uppercase tracking-wider">Diseño del Logotipo</label>
                    <div className="grid grid-cols-5 gap-2 bg-neutral-950/40 p-2 rounded-xl border border-white/5">
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
                              : "border-transparent bg-neutral-900/50 hover:bg-neutral-855 hover:border-white/5"
                          }`}
                        >
                          <ClubLogoIcon logo={idx} className="w-6 h-6" />
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="checkbox"
                        id="useCustomLogo"
                        checked={isCustomLogo}
                        onChange={(e) => setIsCustomLogo(e.target.checked)}
                        className="rounded border-neutral-700 bg-neutral-950 text-cyan-neon focus:ring-0 w-4 h-4 cursor-pointer"
                      />
                      <label htmlFor="useCustomLogo" className="text-[9px] text-gray-dim font-bold uppercase cursor-pointer select-none">
                        Imagen personalizada (URL)
                      </label>
                    </div>

                    {isCustomLogo && (
                      <input
                        type="text"
                        value={customLogoUrl}
                        onChange={(e) => setCustomLogoUrl(e.target.value)}
                        placeholder="https://ejemplo.com/mi-logo.png"
                        className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-xs px-3 py-2.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                      />
                    )}
                  </div>

                  <div className="p-3 bg-cyan-neon/5 border border-cyan-neon/20 rounded-xl text-[10px] text-cyan-neon font-medium leading-relaxed">
                    {t("coachNotice")}
                  </div>
                </motion.div>
              )}

              {clubOption === "JOIN" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  className="flex flex-col gap-3 mt-1"
                >
                  <input
                    type="text"
                    value={clubInviteCode}
                    onChange={(e) => setClubInviteCode(e.target.value)}
                    placeholder={t("clubCodePlaceholder")}
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 uppercase font-mono tracking-widest text-center caret-yellow-gold"
                  />
                  <div className="p-3.5 bg-neutral-900/60 border border-white/5 rounded-xl text-[11px] text-gray-dim">
                    {t("archerNotice")}
                  </div>
                </motion.div>
              )}

              {clubOption === "NONE" && (
                <div className="p-3.5 bg-neutral-900/60 border border-white/5 rounded-xl text-[11px] text-gray-dim mt-1">
                  {t("indepNotice")}
                </div>
              )}
            </motion.div>
          )}

          {/* STEP 4: Bow configuration (Barebow only restriction) */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-3.5"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-1">{t("step4")}</h3>

              {/* Bow Type custom cards (includes only olympic Recurve, Compound & Barebow) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-dim">{t("bowType")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["Recurve", "Compound", "Barebow"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setBowType(type)}
                      className={`py-3 rounded-xl border font-bold text-xs transition-all duration-200 cursor-pointer ${
                        bowType === type
                          ? "border-cyan-neon bg-cyan-neon/10 text-cyan-neon shadow-glow-cyan"
                          : "border-white/10 bg-neutral-900/40 text-gray-dim hover:text-white"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("bowBrand")}</label>
                  <input
                    type="text"
                    value={bowBrand}
                    onChange={(e) => setBowBrand(e.target.value)}
                    placeholder="Ej. Hoyt"
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("bowModel")}</label>
                  <input
                    type="text"
                    value={bowModel}
                    onChange={(e) => setBowModel(e.target.value)}
                    placeholder="Ej. Formula"
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("poundage")}</label>
                  <input
                    type="number"
                    value={poundage}
                    onChange={(e) => setPoundage(Number(e.target.value))}
                    min="10"
                    max="80"
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-center text-sm py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("defaultDist")}</label>
                  <input
                    type="number"
                    value={defaultDistance}
                    onChange={(e) => setDefaultDistance(Number(e.target.value))}
                    min="5"
                    max="90"
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-center text-sm py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 5: Physical configurations */}
          {step === 5 && (
            <motion.div
              key="step5"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-3.5"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-1">{t("step5")}</h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("height")}</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value))}
                    min="100"
                    max="230"
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-center text-sm py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("weight")}</label>
                  <input
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                    min="30"
                    max="180"
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-center text-sm py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Dominant Eye toggle button */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("dominantEye")}</label>
                  <div className="flex bg-neutral-900/60 p-0.5 rounded-xl border border-cyan-brand">
                    <button
                      type="button"
                      onClick={() => setDominantEye("L")}
                      className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                        dominantEye === "L"
                          ? "bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                          : "text-gray-dim hover:text-white"
                      }`}
                    >
                      {t("eyeL")} (L)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDominantEye("R")}
                      className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                        dominantEye === "R"
                          ? "bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                          : "text-gray-dim hover:text-white"
                      }`}
                    >
                      {t("eyeR")} (R)
                    </button>
                  </div>
                </div>

                {/* Dominant Hand toggle button */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("dominantHand")}</label>
                  <div className="flex bg-neutral-900/60 p-0.5 rounded-xl border border-cyan-brand">
                    <button
                      type="button"
                      onClick={() => setDominantHand("L")}
                      className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                        dominantHand === "L"
                          ? "bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                          : "text-gray-dim hover:text-white"
                      }`}
                    >
                      {t("handL")} (L)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDominantHand("R")}
                      className={`flex-1 py-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                        dominantHand === "R"
                          ? "bg-cyan-neon/15 text-cyan-neon shadow-glow-cyan"
                          : "text-gray-dim hover:text-white"
                      }`}
                    >
                      {t("handR")} (R)
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation Buttons footer */}
      <div className="flex justify-between items-center mt-8 gap-4">
        {step > 1 ? (
          <button
            onClick={handlePrev}
            className="flex-1 py-3.5 rounded-full border border-gray-border text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-neutral-900/60 transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>{t("prev")}</span>
          </button>
        ) : (
          <div className="flex-1" />
        )}

        {step < 5 ? (
          <button
            onClick={handleNext}
            className="flex-1 py-3.5 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-glow-cyan hover:brightness-110 transition-all duration-200 cursor-pointer"
          >
            <span>{t("next")}</span>
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleRegister}
            disabled={loading}
            className="flex-1 py-3.5 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-black text-xs uppercase tracking-wider flex items-center justify-center shadow-glow-cyan hover:brightness-110 transition-all duration-200 cursor-pointer"
          >
            {loading ? t("loading") : t("confirm")}
          </button>
        )}
      </div>
    </div>
  );
}
