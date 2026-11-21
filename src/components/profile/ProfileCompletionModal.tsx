"use client";

import React, { useState, useId } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  UserProfile,
  BowConfig,
  updateProfile,
  calculateAgeFromBirthDate,
  getCanonicalCoachClubId,
  generateUniqueClubInviteCode
} from "@/lib/authService";
import { motion } from "framer-motion";
import { AlertCircle, User, X, ArrowLeft } from "lucide-react";
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

interface ProfileCompletionModalProps {
  user: UserProfile;
  onComplete: (updatedUser: UserProfile) => void;
  onClose?: () => void;
  onReturnToLogin?: () => void;
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

export default function ProfileCompletionModal({
  user,
  onComplete,
  onClose,
  onReturnToLogin
}: ProfileCompletionModalProps) {
  const { language, unitSystem, setUnitSystem, t, tx } = useLanguage();
  const isEs = language === "es";
  const baseId = useId();

  const initialCountry = user.country || "CR";
  const isExistingCoach =
    user.role === "coach" ||
    user.role === "team_admin" ||
    user.role === "team_admin_coach" ||
    user.isClubCreator;

  const [fullName, setFullName] = useState(user.fullName || "");
  const [nickname, setNickname] = useState(user.nickname || "");
  const [clubName, setClubName] = useState(
    user.clubName &&
      !["club archery 101010", "club olímpico", "club olimpico", "club deportivo"].includes(
        user.clubName.trim().toLowerCase()
      )
      ? user.clubName
      : ""
  );
  const [registerAsCoach, setRegisterAsCoach] = useState(isExistingCoach);
  const [birthDate, setBirthDate] = useState(user.birthDate || "");
  const [city, setCity] = useState(user.city || "");
  const [country, setCountry] = useState(initialCountry);
  const [gender, setGender] = useState(user.gender || "M");
  const [phoneMessaging, setPhoneMessaging] = useState(() => {
    if (user.whatsappNumber && user.whatsappNumber.trim()) {
      return user.whatsappNumber;
    }
    const dial = COUNTRIES_MAP[initialCountry]?.dialCode;
    return dial ? `${dial} ` : "";
  });

  // Unit System & Equipment / Biometric state
  const [manualUnitOverride, setManualUnitOverride] = useState(false);
  const [bowType, setBowType] = useState<"Recurve" | "Compound" | "Barebow">(
    user.bowConfig?.type || "Recurve"
  );
  const [poundageRaw, setPoundageRaw] = useState(
    user.bowConfig?.poundage && user.bowConfig.poundage > 0
      ? String(user.bowConfig.poundage)
      : ""
  );
  const [drawLengthRaw, setDrawLengthRaw] = useState(
    user.bowConfig?.drawLength && user.bowConfig.drawLength > 0
      ? String(user.bowConfig.drawLength)
      : ""
  );
  const [defaultDistance, setDefaultDistance] = useState<number>(
    user.bowConfig?.defaultDistance ||
      (user.bowConfig?.type === "Compound" ? 50 : user.bowConfig?.type === "Barebow" ? 18 : 70)
  );
  const [manualDistanceOverride, setManualDistanceOverride] = useState(false);

  const initialHeightCm =
    user.physicalData?.height && user.physicalData.height > 0 ? user.physicalData.height : 0;
  const initialWeightKg =
    user.physicalData?.weight && user.physicalData.weight > 0 ? user.physicalData.weight : 0;
  const initialImpHeight = initialHeightCm > 0 ? cmToFeetInches(initialHeightCm) : null;

  const [heightCmRaw, setHeightCmRaw] = useState(
    initialHeightCm > 0 ? String(Math.round(initialHeightCm)) : ""
  );
  const [heightFtRaw, setHeightFtRaw] = useState(
    initialImpHeight ? String(initialImpHeight.feet) : ""
  );
  const [heightInRaw, setHeightInRaw] = useState(
    initialImpHeight ? String(initialImpHeight.inches) : ""
  );
  const [weightKgRaw, setWeightKgRaw] = useState(
    initialWeightKg > 0 ? String(Math.round(initialWeightKg * 10) / 10) : ""
  );
  const [weightLbsRaw, setWeightLbsRaw] = useState(
    initialWeightKg > 0 ? String(kgToLbs(initialWeightKg)) : ""
  );

  const [error, setError] = useState("");
  const [birthDateInvalid, setBirthDateInvalid] = useState(false);
  const [loading, setLoading] = useState(false);

  const todayIso = getLocalISODate();

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBirthDateInvalid(false);

    if (!fullName.trim() || !birthDate || !city.trim() || !country || !gender) {
      setError(
        tx(
          "Por favor completa todos los campos obligatorios (Nombre, Fecha de nacimiento, Ciudad, País y Género).",
          "Please fill in all required fields (Name, Date of birth, City, Country, and Gender)."
        )
      );
      return;
    }

    if (birthDate > todayIso) {
      setBirthDateInvalid(true);
      setError(t("futureBirthDateError"));
      return;
    }

    const age = calculateAgeFromBirthDate(birthDate);
    if (age === null) {
      setBirthDateInvalid(true);
      setError(
        tx(
          "Ingresa una fecha de nacimiento válida (no se permiten fechas futuras).",
          "Please enter a valid date of birth (future dates are not allowed)."
        )
      );
      return;
    }

    if (registerAsCoach || isExistingCoach) {
      if (age < 18) {
        setBirthDateInvalid(true);
        setError(
          tx(
            "Debes tener al menos 18 años para crear un club o registrarte como Coach.",
            "You must be at least 18 years old to create a club or register as a Coach."
          )
        );
        return;
      }
    } else {
      const minAge = getMinimumConsentAge(country);
      if (age < minAge) {
        setBirthDateInvalid(true);
        setError(
          tx(
            `Debes tener al menos ${minAge} años en tu país para registrarte.`,
            `You must be at least ${minAge} years old in your country to sign up.`
          )
        );
        return;
      }
    }

    setLoading(true);
    try {
      const cleanNick =
        nickname.trim() ||
        user.nickname?.trim() ||
        fullName.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) ||
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

      const domHand = user.physicalData?.dominantHand || "R";
      const updatedBow: BowConfig = {
        ...(user.bowConfig || {}),
        id: user.bowConfig?.id || "BOW-1",
        name: user.bowConfig?.name || tx("Arco Principal", "Primary Bow"),
        type: bowType,
        brand: user.bowConfig?.brand || "",
        model: user.bowConfig?.model || "",
        poundage: parsedPoundage,
        drawLength: parsedDrawLength || undefined,
        hand: user.bowConfig?.hand || (domHand === "L" ? "LH" : "RH"),
        defaultDistance
      };

      const cleanPhone = normalizeOptionalPhone(phoneMessaging, country);

      const coachFields: Partial<UserProfile> =
        registerAsCoach && !isExistingCoach && user.role !== "superadmin"
          ? {
              role: "team_admin_coach",
              isClubCreator: true,
              clubId: getCanonicalCoachClubId(user),
              clubInviteCode:
                user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode)
                  ? user.clubInviteCode
                  : await generateUniqueClubInviteCode()
            }
          : {};

      const updated = await updateProfile(user.uid, {
        fullName: fullName.trim().slice(0, 100),
        nickname: cleanNick.slice(0, 50),
        clubName: clubName.trim().slice(0, 100) || null,
        birthDate,
        city: city.trim().slice(0, 100),
        country,
        gender,
        unitSystem,
        ...(cleanPhone !== undefined ? { whatsappNumber: cleanPhone } : {}),
        bowConfig: updatedBow,
        bows: user.bows && user.bows.length > 1 ? [updatedBow, ...user.bows.slice(1)] : [updatedBow],
        physicalData: {
          height: canonicalHeightCm,
          weight: canonicalWeightKg,
          dominantEye: user.physicalData?.dominantEye || domHand,
          dominantHand: domHand
        },
        ...coachFields
      });
      onComplete(updated);
    } catch (err: any) {
      setError(err.message || tx("Error al completar el perfil", "Error completing profile"));
    } finally {
      setLoading(false);
    }
  };

  const handleExit = () => {
    if (onClose) {
      onClose();
    } else if (onReturnToLogin) {
      onReturnToLogin();
    }
  };

  const requiredMinAge =
    registerAsCoach || isExistingCoach ? 18 : getMinimumConsentAge(country);

  const distanceOptions = [
    { meters: 18, label: "18m" },
    { meters: 30, label: "30m" },
    { meters: 50, label: "50m" },
    { meters: 70, label: "70m" }
  ];

  return (
    <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden overscroll-contain">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain bg-[#0A0B0E] border border-white/10 p-5 sm:p-6 rounded-3xl flex flex-col gap-3.5 relative"
      >
        {(onClose || onReturnToLogin) && (
          <button
            type="button"
            onClick={handleExit}
            className="absolute top-4 end-4 w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:text-white hover:bg-white/15 transition-all cursor-pointer z-20 active:scale-90"
            title={tx("Cerrar", "Close")}
            aria-label={tx("Cerrar", "Close")}
          >
            <X size={18} />
          </button>
        )}

        <div className="flex items-center gap-3 mb-1 pe-8">
          <div className="w-10 h-10 rounded-xl bg-cyan-neon/10 flex items-center justify-center text-cyan-neon border border-cyan-neon/20 shrink-0">
            <User size={20} />
          </div>
          <div>
            <h3 id={`${baseId}-heading`} className="text-white text-base sm:text-lg font-black uppercase tracking-wide">
              {tx("Completa tu Perfil", "Complete Your Profile")}
            </h3>
            <p className="text-[10.5px] text-cyan-neon uppercase tracking-wider font-bold tabular-nums">
              {tx(
                `Información obligatoria (${requiredMinAge}+ años)`,
                `Required information (${requiredMinAge}+ yrs)`
              )}
            </p>
          </div>
        </div>

        <p className="text-xs text-white leading-relaxed">
          {tx(
            "Para continuar usando ARCHERY 101010, completa tus datos básicos de arquero.",
            "To continue using ARCHERY 101010, please complete your archer profile details."
          )}
        </p>

        {error && (
          <div
            id={`${baseId}-error`}
            role="alert"
            aria-live="assertive"
            className="bg-white border border-white rounded-xl p-3 flex items-center gap-2 text-black font-bold text-xs leading-snug"
          >
            <AlertCircle size={16} className="shrink-0 text-black" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} aria-labelledby={`${baseId}-heading`} className="flex flex-col gap-3 mt-1">
          <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-fullname`} className={`text-[11px] text-white uppercase font-bold tracking-wider${!isEs ? " truncate" : ""}`}>
                {t("fullName")} *
              </label>
              <input
                id={`${baseId}-fullname`}
                name="fullName"
                type="text"
                autoComplete="name"
                maxLength={100}
                required
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (error) setError("");
                }}
                placeholder=""
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-nickname`} className="text-[11px] text-white uppercase font-bold tracking-wider truncate">
                {t("nickname")}
              </label>
              <input
                id={`${baseId}-nickname`}
                name="nickname"
                type="text"
                autoComplete="nickname"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={50}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={tx("Opcional", "Optional")}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor={`${baseId}-birthdate`} className={`text-[11px] text-white uppercase font-bold tracking-wider${!isEs ? " truncate" : ""}`}>
                {t("birthDate")} *
              </label>
              <input
                id={`${baseId}-birthdate`}
                name="birthDate"
                type="date"
                autoComplete="bday"
                required
                max={todayIso}
                aria-invalid={birthDateInvalid ? "true" : undefined}
                aria-describedby={birthDateInvalid && error ? `${baseId}-error` : undefined}
                value={birthDate}
                onChange={(e) => {
                  setBirthDate(e.target.value);
                  if (birthDateInvalid) setBirthDateInvalid(false);
                  if (error) setError("");
                }}
                className="min-w-0 w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-2.5 rounded-xl outline-none transition-all duration-200 uppercase [color-scheme:dark] tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor={`${baseId}-city`} className={`text-[11px] text-white uppercase font-bold tracking-wider${!isEs ? " truncate" : ""}`}>
                {t("city")} *
              </label>
              <input
                id={`${baseId}-city`}
                name="city"
                type="text"
                autoComplete="address-level2"
                maxLength={100}
                required
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (error) setError("");
                }}
                placeholder={tx("Ej. San José", "e.g. Seoul")}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-country`} className={`text-[11px] text-white uppercase font-bold tracking-wider${!isEs ? " truncate" : ""}`}>
                {t("country")} *
              </label>
              <select
                id={`${baseId}-country`}
                name="country"
                autoComplete="country"
                value={country}
                onChange={(e) => handleCountryChange(e.target.value)}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-2.5 rounded-xl outline-none transition-all duration-200 [color-scheme:dark]"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-black text-white">
                    {c.flag} {getLocalizedCountryName(c.code, language)}
                  </option>
                ))}
              </select>
            </div>

            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-gender`} className={`text-[11px] text-white uppercase font-bold tracking-wider${!isEs ? " truncate" : ""}`}>
                {t("gender")} *
              </label>
              <select
                id={`${baseId}-gender`}
                name="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-2.5 rounded-xl outline-none transition-all duration-200 [color-scheme:dark]"
              >
                <option value="M" className="bg-black text-white">{t("genderM")}</option>
                <option value="F" className="bg-black text-white">{t("genderF")}</option>
                <option value="O" className="bg-black text-white">{t("genderO")}</option>
              </select>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-2.5${!isEs ? " items-end" : ""}`}>
            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-phone`} className="text-[11px] text-white uppercase font-bold tracking-wider truncate">
                {t("phoneMessagingLabel")}
              </label>
              <input
                id={`${baseId}-phone`}
                name="phoneMessaging"
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={phoneMessaging}
                onChange={(e) => setPhoneMessaging(e.target.value)}
                placeholder={`${COUNTRIES_MAP[country]?.dialCode || "+506"} 88888888`}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none tabular-nums transition-all duration-200 caret-cyan-neon"
              />
            </div>
            <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
              <label htmlFor={`${baseId}-club`} className="text-[11px] text-white uppercase font-bold tracking-wider truncate">
                {tx("Club (Opcional)", "Club (Optional)")}
              </label>
              <input
                id={`${baseId}-club`}
                name="clubName"
                type="text"
                autoComplete="organization"
                maxLength={100}
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                placeholder={tx("Opcional", "Optional")}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3 py-2.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          {/* Role Toggle (Athlete vs Coach 18+) */}
          {!isExistingCoach && user.role !== "superadmin" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRegisterAsCoach(false)}
                className={`h-9 rounded-xl border text-xs font-black uppercase tracking-wide transition cursor-pointer ${
                  !registerAsCoach
                    ? "bg-cyan-neon text-black border-cyan-neon"
                    : "bg-[#0D0F12] text-white border-white/10 hover:border-white/25"
                }`}
              >
                {t("roleAthlete")}
              </button>
              <button
                type="button"
                onClick={() => setRegisterAsCoach(true)}
                className={`h-9 rounded-xl border text-xs font-black uppercase tracking-wide transition cursor-pointer ${
                  registerAsCoach
                    ? "bg-cyan-neon text-black border-cyan-neon"
                    : "bg-[#0D0F12] text-white border-white/10 hover:border-white/25"
                }`}
              >
                {t("roleCoach")} (18+)
              </button>
            </div>
          )}

          {/* Unit System & Personal Biometrics (Height / Weight) */}
          <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-black uppercase tracking-wider text-white">
                {t("unitSystemLabel")}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleManualUnitSwitch("metric")}
                  className={`h-7 px-2.5 rounded-lg border text-[11px] font-black transition cursor-pointer ${
                    unitSystem === "metric"
                      ? "bg-cyan-neon text-black border-cyan-neon"
                      : "bg-[#090B0F] text-white border-white/10 hover:border-white/25"
                  }`}
                >
                  {tx("Métrico", "Metric")}
                </button>
                <button
                  type="button"
                  onClick={() => handleManualUnitSwitch("imperial")}
                  className={`h-7 px-2.5 rounded-lg border text-[11px] font-black transition cursor-pointer ${
                    unitSystem === "imperial"
                      ? "bg-cyan-neon text-black border-cyan-neon"
                      : "bg-[#090B0F] text-white border-white/10 hover:border-white/25"
                  }`}
                >
                  {tx("Imperial", "Imperial")}
                </button>
              </div>
            </div>

            {/* Height & Weight according to UnitSystem */}
            {unitSystem === "imperial" ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                    {t("heightImperialFeet")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={heightFtRaw}
                    onChange={(e) => setHeightFtRaw(e.target.value)}
                    placeholder="5"
                    className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                    {t("heightImperialInches")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={heightInRaw}
                    onChange={(e) => setHeightInRaw(e.target.value)}
                    placeholder="9"
                    className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                    {t("weightImperialLbs")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={weightLbsRaw}
                    onChange={(e) => setWeightLbsRaw(e.target.value)}
                    placeholder="158"
                    className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                  />
                </div>
              </div>
            ) : (
              <div className={`grid grid-cols-2 gap-2${!isEs ? " items-end" : ""}`}>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                    {t("height")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={heightCmRaw}
                    onChange={(e) => setHeightCmRaw(e.target.value)}
                    placeholder="175"
                    className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                  />
                </div>
                <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                  <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                    {t("weight")}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={weightKgRaw}
                    onChange={(e) => setWeightKgRaw(e.target.value)}
                    placeholder={tx("70,5", "70.5")}
                    className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bow Configuration Only */}
          <div className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-3 flex flex-col gap-2.5">
            <span className="text-[10.5px] font-black uppercase tracking-wider text-white">
              {t("bowConfig")}
            </span>

            {/* Bow Type & Default Distance */}
            <div className="grid grid-cols-3 gap-1.5">
              {(["Recurve", "Compound", "Barebow"] as const).map((bType) => {
                const label =
                  bType === "Recurve"
                    ? t("bowRecurve")
                    : bType === "Compound"
                    ? t("bowCompound")
                    : t("bowBarebow");
                return (
                  <button
                    key={bType}
                    type="button"
                    onClick={() => handleBowTypeChange(bType)}
                    className={`h-8 px-1 rounded-lg border text-[11px] font-black uppercase truncate transition cursor-pointer ${
                      bowType === bType
                        ? "bg-cyan-neon text-black border-cyan-neon"
                        : "bg-[#090B0F] text-white border-white/10 hover:border-white/25"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {distanceOptions.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    setManualDistanceOverride(true);
                    setDefaultDistance(opt.meters);
                  }}
                  className={`h-8 rounded-lg border text-[11px] font-black tabular-nums transition cursor-pointer ${
                    defaultDistance === opt.meters
                      ? "bg-cyan-neon text-black border-cyan-neon"
                      : "bg-[#090B0F] text-white border-white/10 hover:border-white/25"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Poundage & Draw Length */}
            <div className={`grid grid-cols-2 gap-2${!isEs ? " items-end" : ""}`}>
              <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                  {t("poundage")}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={poundageRaw}
                  onChange={(e) => setPoundageRaw(e.target.value)}
                  placeholder={tx("Ej. 38,5", "e.g. 38.5")}
                  className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                />
              </div>
              <div className={`flex flex-col gap-1${!isEs ? " min-w-0" : ""}`}>
                <label className="text-[10.5px] text-white uppercase font-bold tracking-wider truncate">
                  {tx("Apertura (in)", "Draw length (in)")}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={drawLengthRaw}
                  onChange={(e) => setDrawLengthRaw(e.target.value)}
                  placeholder={tx("Ej. 28,5", "e.g. 28.5")}
                  className="w-full bg-[#090B0F] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-2.5 py-2 rounded-lg outline-none tabular-nums transition"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full py-3.5 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition-all duration-200"
          >
            {loading
              ? tx("Guardando...", "Saving...")
              : tx("Guardar y Continuar", "Save & Continue")}
          </button>

          {onReturnToLogin && (
            <button
              type="button"
              onClick={onReturnToLogin}
              className={`w-full py-2.5${
                !isEs ? " px-3 text-center" : ""
              } text-xs text-white hover:text-yellow-gold font-bold tracking-wide transition-colors flex items-center justify-center gap-2 cursor-pointer border border-white/5 hover:border-yellow-gold/30 rounded-xl`}
            >
              <ArrowLeft size={14} className="rtl:rotate-180 shrink-0" />
              <span>
                {tx(
                  "Volver a inicio de sesión (Usuario y contraseña)",
                  "Return to Sign In (Email & password)"
                )}
              </span>
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}
