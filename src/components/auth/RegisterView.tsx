"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  registerUser,
  authenticateWithSocialProvider,
  processSocialRedirectResult,
  calculateAgeFromBirthDate,
  BowConfig
} from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, X } from "lucide-react";
import { COUNTRIES, COUNTRIES_MAP, getLocalizedCountryName } from "@/lib/countries";
import {
  UnitSystem,
  getLocalISODate,
  parseLocaleDecimal,
  getDefaultUnitSystemForCountry,
  cmToFeetInches,
  feetInchesToCm,
  kgToLbs,
  lbsToKg,
  getMinimumConsentAge
} from "@/lib/i18n/regionalUtils";

interface RegisterViewProps {
  onRegisterSuccess: (user: any) => void;
  onNavigateToLogin: () => void;
}

function isBareDialPrefix(val: string, prevDial?: string): boolean {
  const trimmed = val.trim();
  if (!trimmed || trimmed === "+") return true;
  if (prevDial && trimmed === prevDial.trim()) return true;
  return /^\+\d{1,4}$/.test(trimmed);
}

function normalizeOptionalPhone(raw: string, countryCode: string): string | undefined {
  const trimmed = raw.trim();
  const dialCode = (COUNTRIES_MAP[countryCode]?.dialCode || "").trim();
  if (!trimmed || trimmed === "+" || trimmed === dialCode) return undefined;
  const allDigits = trimmed.replace(/[^0-9]/g, "");
  const dialDigits = dialCode.replace(/[^0-9]/g, "");
  if (!allDigits || allDigits === dialDigits) return undefined;
  if (trimmed.startsWith("+")) return trimmed;
  const localDigits = allDigits.replace(/^0+/, "");
  return dialDigits ? `+${dialDigits}${localDigits}` : `+${allDigits}`;
}

export default function RegisterView({ onRegisterSuccess, onNavigateToLogin }: RegisterViewProps) {
  const { language, unitSystem, setUnitSystem, t, tx } = useLanguage();
  const isEs = language === "es";
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Step 1: Account credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 2: Personal & Club
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [clubMode, setClubMode] = useState<"NONE" | "JOIN" | "CREATE_NEW">("NONE");
  const [clubName, setClubName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState("CR");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("M");
  const [phoneMessaging, setPhoneMessaging] = useState(() => {
    const initialDial = COUNTRIES_MAP["CR"]?.dialCode;
    return initialDial ? `${initialDial} ` : "";
  });

  // Step 3: Bow & Physical + Regional Unit System
  const [manualUnitOverride, setManualUnitOverride] = useState(false);
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">("Recurve");
  const [bowBrand, setBowBrand] = useState("");
  const [bowModel, setBowModel] = useState("");
  const [poundageRaw, setPoundageRaw] = useState("");
  const [drawLengthRaw, setDrawLengthRaw] = useState("");
  const [defaultDistance, setDefaultDistance] = useState<number>(70);
  const [manualDistanceOverride, setManualDistanceOverride] = useState(false);
  const [dominantHand, setDominantHand] = useState<"R" | "L">("R");

  // Metric / Imperial biometric inputs
  const [heightCmRaw, setHeightCmRaw] = useState("");
  const [heightFtRaw, setHeightFtRaw] = useState("");
  const [heightInRaw, setHeightInRaw] = useState("");
  const [weightKgRaw, setWeightKgRaw] = useState("");
  const [weightLbsRaw, setWeightLbsRaw] = useState("");

  const [isAndroidNativeApp, setIsAndroidNativeApp] = useState(false);
  const todayIso = getLocalISODate();

  useEffect(() => {
    const w = window as any;
    setIsAndroidNativeApp(!!w.ArcheryNativeAuth || w.Capacitor?.getPlatform?.() === "android");
  }, []);

  useEffect(() => {
    let resolved = false;
    async function checkRedirect() {
      try {
        const user = await processSocialRedirectResult();
        if (user && !resolved) {
          resolved = true;
          setLoading(true);
          onRegisterSuccess(user);
        }
      } catch (err) {
        console.error("Error procesando redirección en registro:", err);
      }
    }
    checkRedirect();
  }, [onRegisterSuccess]);

  const handleCountryChange = (newCountry: string) => {
    const prevDial = COUNTRIES_MAP[country]?.dialCode || "";
    setCountry(newCountry);
    if (!manualUnitOverride) {
      const targetUnits = getDefaultUnitSystemForCountry(newCountry);
      if (targetUnits !== unitSystem) {
        convertBiometricDrafts(unitSystem, targetUnits);
        setUnitSystem(targetUnits);
      }
    }
    const nextDial = COUNTRIES_MAP[newCountry]?.dialCode || "+";
    setPhoneMessaging((prev) => {
      if (isBareDialPrefix(prev, prevDial)) {
        return nextDial === "+" ? "+" : `${nextDial} `;
      }
      return prev;
    });
  };

  const convertBiometricDrafts = (fromUnits: UnitSystem, toUnits: UnitSystem) => {
    if (fromUnits === toUnits) return;
    if (toUnits === "imperial") {
      const cm = parseLocaleDecimal(heightCmRaw, 0);
      if (cm > 0) {
        const { feet, inches } = cmToFeetInches(cm);
        setHeightFtRaw(String(feet));
        setHeightInRaw(String(inches));
      }
      const kg = parseLocaleDecimal(weightKgRaw, 0);
      if (kg > 0) {
        setWeightLbsRaw(String(kgToLbs(kg)));
      }
    } else {
      const ft = parseLocaleDecimal(heightFtRaw, 0);
      const inch = parseLocaleDecimal(heightInRaw, 0);
      if (ft > 0 || inch > 0) {
        setHeightCmRaw(String(feetInchesToCm(ft, inch)));
      }
      const lbs = parseLocaleDecimal(weightLbsRaw, 0);
      if (lbs > 0) {
        setWeightKgRaw(String(lbsToKg(lbs)));
      }
    }
  };

  const handleManualUnitSwitch = async (nextUnits: UnitSystem) => {
    setManualUnitOverride(true);
    if (nextUnits !== unitSystem) {
      convertBiometricDrafts(unitSystem, nextUnits);
      await setUnitSystem(nextUnits);
    }
  };

  const handleBowTypeChange = (nextType: "Recurve" | "Compound" | "Barebow") => {
    setBowType(nextType);
    if (!manualDistanceOverride) {
      setDefaultDistance(nextType === "Compound" ? 50 : nextType === "Recurve" ? 70 : 18);
    }
  };

  const validatePersonalStep = (): boolean => {
    if (!fullName.trim() || !birthDate) {
      setError(
        tx(
          "Completa todos los campos obligatorios",
          "Please fill in all required fields"
        )
      );
      return false;
    }

    if (birthDate > todayIso) {
      setError(t("futureBirthDateError"));
      return false;
    }

    const age = calculateAgeFromBirthDate(birthDate);
    if (age === null) {
      setError(
        tx(
          "Ingresa una fecha de nacimiento válida",
          "Please enter a valid date of birth"
        )
      );
      return false;
    }

    if (clubMode === "CREATE_NEW") {
      if (age < 18) {
        setError(
          tx(
            "Debes tener al menos 18 años para crear un club o registrarte como Coach.",
            "You must be at least 18 years old to create a club or register as a Coach."
          )
        );
        return false;
      }
      if (!clubName.trim()) {
        setError(
          tx(
            "Ingresa el nombre de tu club.",
            "Please enter your club name."
          )
        );
        return false;
      }
    } else {
      const minAge = getMinimumConsentAge(country);
      if (age < minAge) {
        setError(
          tx(
            `Debes tener al menos ${minAge} años en tu país para registrarte.`,
            `You must be at least ${minAge} years old in your country to sign up.`
          )
        );
        return false;
      }
    }

    if (clubMode === "JOIN" && !/^\d{6}$/.test(inviteCode.trim())) {
      setError(
        tx(
          "Ingresa el código de invitación de 6 dígitos de tu Coach.",
          "Enter your Coach's 6-digit invitation code."
        )
      );
      return false;
    }

    return true;
  };

  const handleNext = () => {
    setError("");
    if (step === 1) {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password || !confirmPassword) {
        setError(tx("Completa todos los campos", "Please fill in all fields"));
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        setError(
          tx(
            "El formato del correo electrónico no es válido",
            "Invalid email address format"
          )
        );
        return;
      }
      if (password !== confirmPassword) {
        setError(tx("Las contraseñas no coinciden", "Passwords do not match"));
        return;
      }
      if (password.length < 6) {
        setError(
          tx(
            "La contraseña debe tener al menos 6 caracteres",
            "Password must be at least 6 characters long"
          )
        );
        return;
      }
    } else if (step === 2) {
      if (!validatePersonalStep()) return;
    }
    setStep(step + 1);
  };

  const handleSocialRegister = async (provider: "google" | "apple" = "google") => {
    setLoading(true);
    setError("");
    try {
      const user = await authenticateWithSocialProvider(provider);
      if (user) {
        onRegisterSuccess(user);
      }
    } catch (err: any) {
      setError(
        err.message ||
          (provider === "apple"
            ? tx("Error al registrarse con Apple", "Error signing up with Apple")
            : tx("Error al registrarse con Google", "Error signing up with Google"))
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => {
    setError("");
    setStep(step - 1);
  };

  const handleRegister = async () => {
    setError("");
    if (!validatePersonalStep()) return;

    setLoading(true);
    try {
      const cleanFullName = fullName.trim();
      const autoNickname =
        nickname.trim() ||
        cleanFullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) ||
        "arquero";

      const canonicalHeightCm =
        unitSystem === "imperial"
          ? (() => {
              const ft = parseLocaleDecimal(heightFtRaw, 0);
              const inch = parseLocaleDecimal(heightInRaw, 0);
              return ft > 0 || inch > 0 ? feetInchesToCm(ft, inch) : 0;
            })()
          : Math.max(0, Math.round(parseLocaleDecimal(heightCmRaw, 0)));

      const canonicalWeightKg =
        unitSystem === "imperial"
          ? (() => {
              const lbs = parseLocaleDecimal(weightLbsRaw, 0);
              return lbs > 0 ? lbsToKg(lbs) : 0;
            })()
          : Math.max(0, Math.round(parseLocaleDecimal(weightKgRaw, 0) * 10) / 10);

      const parsedPoundage = Math.max(0, Math.round(parseLocaleDecimal(poundageRaw, 0) * 10) / 10);
      const parsedDrawLength = Math.max(0, Math.round(parseLocaleDecimal(drawLengthRaw, 0) * 100) / 100);

      const primaryBow: BowConfig = {
        id: "BOW-1",
        name: tx("Arco Principal", "Primary Bow"),
        type: bowType,
        brand: bowBrand.trim(),
        model: bowModel.trim(),
        poundage: parsedPoundage,
        drawLength: parsedDrawLength || undefined,
        hand: dominantHand === "L" ? "LH" : "RH",
        defaultDistance
      };

      const cleanPhone = normalizeOptionalPhone(phoneMessaging, country);

      const resolvedClubId =
        clubMode === "CREATE_NEW"
          ? "CREATE_NEW"
          : clubMode === "JOIN"
          ? inviteCode.trim()
          : null;

      const user = await registerUser({
        email,
        password,
        fullName: cleanFullName,
        nickname: autoNickname,
        birthDate,
        city: city.trim(),
        country,
        gender,
        unitSystem,
        ...(cleanPhone ? { whatsappNumber: cleanPhone } : {}),
        clubId: resolvedClubId,
        clubName: clubName.trim() || null,
        actAsCoach: clubMode === "CREATE_NEW",
        bowConfig: primaryBow,
        bows: [primaryBow],
        physicalData: {
          height: canonicalHeightCm,
          weight: canonicalWeightKg,
          dominantEye: dominantHand,
          dominantHand
        }
      });
      onRegisterSuccess(user);
    } catch (err: any) {
      setError(err.message || tx("Error en el registro", "Registration error"));
    } finally {
      setLoading(false);
    }
  };

  const minAgeForSelectedCountry =
    clubMode === "CREATE_NEW" ? 18 : getMinimumConsentAge(country);

  const distanceOptions = [
    { meters: 18, label: "18m" },
    { meters: 30, label: "30m" },
    { meters: 50, label: "50m" },
    { meters: 70, label: "70m" }
  ];

  return (
    <div className="flex-1 flex flex-col justify-between px-6 py-6 min-h-full">
      {/* Top Header */}
      <div className="flex justify-between items-center mb-5">
        <button
          type="button"
          onClick={onNavigateToLogin}
          className="min-h-[38px] px-2 -ms-2 rounded-xl text-white hover:bg-white/[0.06] flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition"
        >
          <ArrowLeft size={16} aria-hidden="true" className="rtl:rotate-180" />
          <span>{t("back")}</span>
        </button>
        <span className="text-xs text-white font-bold tracking-widest uppercase">
          {t("registerTitle")}
        </span>
        <button
          type="button"
          onClick={onNavigateToLogin}
          className="w-9.5 h-9.5 min-w-[38px] min-h-[38px] rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:text-white hover:bg-white/15 transition-all cursor-pointer"
          title={tx("Cerrar y volver al inicio de sesión", "Close and return to sign in")}
          aria-label={tx("Cerrar", "Close")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Progress Stepper Indicator */}
      <div className="flex items-center justify-between w-full max-w-xs mx-auto mb-6 px-2">
        {[1, 2, 3].map((i) => (
          <React.Fragment key={i}>
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs tabular-nums border transition-all duration-200 ${
                step === i
                  ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                  : step > i
                  ? "bg-cyan-brand/10 border-cyan-brand text-cyan-brand"
                  : "bg-transparent border-gray-border text-white"
              }`}
            >
              {step > i ? <Check size={12} /> : i}
            </div>
            {i < 3 && (
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
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto my-auto py-1">
        {error && (
          <div className="bg-white border border-white rounded-xl p-3 flex items-center gap-2 text-black font-bold text-xs mb-4 leading-snug">
            <AlertCircle size={17} className="shrink-0 text-black" />
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
              <h3 className="text-white text-base font-black uppercase tracking-wider text-center mb-1">
                {t("step1")}
              </h3>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="new-password"
                  className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white text-sm ps-4 pe-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? tx("Ocultar contraseña", "Hide password") : tx("Mostrar contraseña", "Show password")}
                  aria-pressed={showPassword}
                  className="absolute end-1.5 w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/[0.06] transition cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>
              <div className="relative flex items-center">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={tx("Confirmar contraseña", "Confirm password")}
                  autoComplete="new-password"
                  className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white text-sm ps-4 pe-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? tx("Ocultar confirmación de contraseña", "Hide password confirmation") : tx("Mostrar confirmación de contraseña", "Show password confirmation")}
                  aria-pressed={showConfirmPassword}
                  className="absolute end-1.5 w-9 h-9 rounded-lg flex items-center justify-center text-white hover:bg-white/[0.06] transition cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
              </div>

              {/* 1-tap Social Registration (Google & Apple) */}
              <div className="flex items-center gap-4 pt-2 pb-1">
                <div className="h-[1px] flex-1 bg-white/10" />
                <span className="text-[11.6px] text-white font-bold uppercase tracking-widest">
                  {tx("o regístrate en 1 toque", "or sign up in 1 tap")}
                </span>
                <div className="h-[1px] flex-1 bg-white/10" />
              </div>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSocialRegister("google")}
                  className="w-full py-3.5 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-bold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  <svg aria-hidden="true" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>{t("googleRegister")}</span>
                </button>

                {!isAndroidNativeApp && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleSocialRegister("apple")}
                    className="w-full py-3.5 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-bold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
                  >
                    <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <span>{t("appleRegister")}</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 2: Personal information & Club */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col items-center gap-0.5 mb-0.5">
                <h3 className="text-white text-base font-black uppercase tracking-wider text-center">
                  {t("step2")}
                </h3>
                <span className="text-[10.5px] text-cyan-neon font-bold uppercase tracking-wider tabular-nums">
                  {tx(`Edad mínima: ${minAgeForSelectedCountry}+ años`, `Minimum age: ${minAgeForSelectedCountry}+ yrs`)}
                </span>
              </div>

              <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("fullName")} *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder=""
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white text-sm px-3.5 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                  />
                </div>

                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-white truncate">
                    {t("nickname")}
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={tx("Opcional", "Optional")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-sm px-3.5 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                  />
                </div>
              </div>

              <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                <div className="flex flex-col gap-1 min-w-0">
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("birthDate")} *
                  </label>
                  <input
                    type="date"
                    max={todayIso}
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="min-w-0 w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white text-xs sm:text-sm px-2.5 py-2.5 rounded-xl outline-none transition-all duration-200 uppercase [color-scheme:dark] tabular-nums"
                  />
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("country")} *
                  </label>
                  <select
                    value={country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="min-w-0 w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white text-xs sm:text-sm px-2.5 py-2.5 rounded-xl outline-none transition-all duration-200 [color-scheme:dark]"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-black text-white">
                        {c.flag} {getLocalizedCountryName(c.code, language)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                <div className="flex flex-col gap-1 min-w-0">
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("city")}
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={tx("Opcional", "Optional")}
                    className="min-w-0 w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-sm px-3.5 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                  />
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("gender")} *
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white text-sm px-3 py-2.5 rounded-xl outline-none transition-all duration-200 [color-scheme:dark]"
                  >
                    <option value="M" className="bg-black text-white">{t("genderM")}</option>
                    <option value="F" className="bg-black text-white">{t("genderF")}</option>
                    <option value="O" className="bg-black text-white">{t("genderO")}</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-white">
                  {t("phoneMessagingLabel")}{" "}
                  <span className="text-white/60 font-medium normal-case">
                    ({tx("Opcional", "Optional")})
                  </span>
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={phoneMessaging}
                  onChange={(e) => setPhoneMessaging(e.target.value)}
                  placeholder={`${COUNTRIES_MAP[country]?.dialCode || "+506"} 8888 8888`}
                  className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-sm px-3.5 py-2.5 rounded-xl outline-none transition-all duration-200 tabular-nums caret-cyan-neon"
                />
              </div>

              {/* Club / Role Selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-white">
                  {t("step3")}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setClubMode("NONE")}
                    className={`py-2 px-1.5 rounded-xl border text-[11px] font-black uppercase tracking-tight truncate transition cursor-pointer ${
                      clubMode === "NONE"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {isEs ? (
                      t("roleAthlete")
                    ) : (
                      <span className="block truncate max-w-full text-center">{t("roleAthlete")}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClubMode("JOIN")}
                    className={`py-2 px-1.5 rounded-xl border text-[11px] font-black uppercase tracking-tight truncate transition cursor-pointer ${
                      clubMode === "JOIN"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {isEs ? (
                      t("clubOptB")
                    ) : (
                      <span className="block truncate max-w-full text-center">{t("clubOptB")}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClubMode("CREATE_NEW")}
                    className={`py-2 px-1.5 rounded-xl border text-[11px] font-black uppercase tracking-tight truncate transition cursor-pointer ${
                      clubMode === "CREATE_NEW"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {isEs ? (
                      <>{t("roleCoach")} 18+</>
                    ) : (
                      <span className="block truncate max-w-full text-center">{t("roleCoach")} 18+</span>
                    )}
                  </button>
                </div>

                {clubMode === "JOIN" ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder={t("clubCodePlaceholder")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/40 text-sm px-3.5 py-2.5 rounded-xl outline-none tabular-nums tracking-widest transition-all caret-cyan-neon"
                  />
                ) : (
                  <input
                    type="text"
                    value={clubName}
                    onChange={(e) => setClubName(e.target.value)}
                    placeholder={
                      clubMode === "CREATE_NEW"
                        ? t("clubNamePlaceholder")
                        : tx("Club (Opcional)", "Club (Optional)")
                    }
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-sm px-3.5 py-2.5 rounded-xl outline-none transition-all caret-cyan-neon"
                  />
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 3: Unit System + Bow & Physical */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-3"
            >
              <h3 className="text-white text-base font-black uppercase tracking-wider text-center mb-0.5">
                {tx("Arco y Físico", "Bow & Physical")}
              </h3>

              {/* Unit System Toggle (Metric vs Imperial) */}
              <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-2.5 flex flex-col gap-1.5">
                <span className="text-[10.5px] font-black uppercase tracking-wider text-white/90">
                  {t("unitSystemLabel")}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleManualUnitSwitch("metric")}
                    className={`h-9 px-2 rounded-xl border text-[11.5px] font-black transition cursor-pointer truncate ${
                      unitSystem === "metric"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#080A0F] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {tx("Métrico (m · cm · kg)", "Metric (m · cm · kg)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleManualUnitSwitch("imperial")}
                    className={`h-9 px-2 rounded-xl border text-[11.5px] font-black transition cursor-pointer truncate ${
                      unitSystem === "imperial"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#080A0F] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {tx("Imperial (yd · ft/in · lbs)", "Imperial (yd · ft/in · lbs)")}
                  </button>
                </div>
              </div>

              {/* Bow Type */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-white">
                  {t("bowType")}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["Recurve", "Compound", "Barebow"] as const).map((bType) => {
                    const label =
                      bType === "Recurve"
                        ? t("bowRecurve")
                        : bType === "Compound"
                        ? t("bowCompound")
                        : t("bowBarebow");
                    const selected = bowType === bType;
                    return (
                      <button
                        key={bType}
                        type="button"
                        onClick={() => handleBowTypeChange(bType)}
                        className={`h-9 px-1.5 rounded-xl border text-[11.5px] font-black uppercase tracking-tight truncate transition cursor-pointer ${
                          selected
                            ? "bg-cyan-neon text-black border-cyan-neon"
                            : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                        }`}
                      >
                        {isEs ? (
                          label
                        ) : (
                          <span className="block truncate max-w-full text-center">{label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Brand & Model */}
              <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("bowBrand")}
                  </label>
                  <input
                    type="text"
                    value={bowBrand}
                    onChange={(e) => setBowBrand(e.target.value)}
                    placeholder={tx("Opcional", "Optional")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none transition caret-cyan-neon"
                  />
                </div>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("bowModel")}
                  </label>
                  <input
                    type="text"
                    value={bowModel}
                    onChange={(e) => setBowModel(e.target.value)}
                    placeholder={tx("Opcional", "Optional")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none transition caret-cyan-neon"
                  />
                </div>
              </div>

              {/* Poundage & Draw Length (Decimal comma friendly) */}
              <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {t("poundage")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={poundageRaw}
                    onChange={(e) => setPoundageRaw(e.target.value)}
                    placeholder={tx("Ej. 38,5", "e.g. 38.5")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                  />
                </div>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                    {tx("Apertura (in)", "Draw length (in)")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={drawLengthRaw}
                    onChange={(e) => setDrawLengthRaw(e.target.value)}
                    placeholder={tx("Ej. 28,5", "e.g. 28.5")}
                    className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                  />
                </div>
              </div>

              {/* Default Distance */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-white">
                  {t("defaultDist")}
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {distanceOptions.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => {
                        setManualDistanceOverride(true);
                        setDefaultDistance(opt.meters);
                      }}
                      className={`h-9 rounded-xl border text-xs font-black tabular-nums transition cursor-pointer ${
                        defaultDistance === opt.meters
                          ? "bg-cyan-neon text-black border-cyan-neon"
                          : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Height & Weight according to UnitSystem */}
              {unitSystem === "imperial" ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10.5px] font-bold uppercase tracking-wider text-white truncate">
                      {t("heightImperialFeet")}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={heightFtRaw}
                      onChange={(e) => setHeightFtRaw(e.target.value)}
                      placeholder="5"
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10.5px] font-bold uppercase tracking-wider text-white truncate">
                      {t("heightImperialInches")}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={heightInRaw}
                      onChange={(e) => setHeightInRaw(e.target.value)}
                      placeholder="9"
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10.5px] font-bold uppercase tracking-wider text-white truncate">
                      {t("weightImperialLbs")}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={weightLbsRaw}
                      onChange={(e) => setWeightLbsRaw(e.target.value)}
                      placeholder="158"
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                    />
                  </div>
                </div>
              ) : (
                <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
                  <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                    <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                      {t("height")}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={heightCmRaw}
                      onChange={(e) => setHeightCmRaw(e.target.value)}
                      placeholder="175"
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                    />
                  </div>
                  <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                    <label className={`text-[11px] font-bold uppercase tracking-wider text-white${!isEs ? " truncate" : ""}`}>
                      {t("weight")}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={weightKgRaw}
                      onChange={(e) => setWeightKgRaw(e.target.value)}
                      placeholder={tx("70,5", "70.5")}
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition caret-cyan-neon"
                    />
                  </div>
                </div>
              )}

              {/* Dominant Hand */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-white">
                  {t("dominantHand")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDominantHand("R")}
                    className={`h-9 rounded-xl border text-xs font-black uppercase transition cursor-pointer ${
                      dominantHand === "R"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {t("handR")} (RH)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDominantHand("L")}
                    className={`h-9 rounded-xl border text-xs font-black uppercase transition cursor-pointer ${
                      dominantHand === "L"
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#0D1017] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {t("handL")} (LH)
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pre-registration Legal Consent Notice (#19) */}
      <p className="text-[11.5px] text-white/80 text-center leading-relaxed max-w-sm mx-auto mt-4">
        {t("legalConsentPrefix")}{" "}
        <a
          href="/terms"
          className="text-cyan-neon hover:underline underline-offset-2 font-semibold"
        >
          {t("termsLink")}
        </a>{" "}
        {t("legalConsentAnd")}{" "}
        <a
          href="/privacy"
          className="text-cyan-neon hover:underline underline-offset-2 font-semibold"
        >
          {t("privacyLink")}
        </a>
        .
      </p>

      {/* Navigation Buttons footer */}
      <div className="flex justify-between items-center mt-4 gap-4">
        {step > 1 ? (
          <button
            type="button"
            onClick={handlePrev}
            className="flex-1 py-3.5 rounded-xl border border-white/10 bg-[#0D0F12] text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft size={16} aria-hidden="true" className="rtl:rotate-180" />
            <span>{t("prev")}</span>
          </button>
        ) : (
          <div className="flex-1" />
        )}

        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            className="flex-1 py-3.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
          >
            <span>{t("next")}</span>
            <ArrowRight size={16} aria-hidden="true" className="rtl:rotate-180" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRegister}
            disabled={loading}
            className="flex-1 py-3.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center transition-all duration-200 cursor-pointer"
          >
            {loading ? t("loading") : t("confirm")}
          </button>
        )}
      </div>
    </div>
  );
}
