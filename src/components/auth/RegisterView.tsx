"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerUser } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff } from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("CR");
  const [gender, setGender] = useState("M");

  const handleNext = () => {
    setError("");
    if (step === 1) {
      if (!email.trim() || !password || !confirmPassword) {
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
    }
    setStep(step + 1);
  };

  const handlePrev = () => {
    setError("");
    setStep(step - 1);
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !nickname.trim() || !birthDate || !city.trim()) {
      setError("Completa todos los campos obligatorios");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const user = await registerUser({
        email,
        password,
        fullName: fullName.trim(),
        nickname: nickname.trim(),
        birthDate,
        city: city.trim(),
        country,
        gender,
        clubId: null,
        clubName: null,
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
        {[1, 2].map((i) => (
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
            {i < 2 && (
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
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 text-gray-dim hover:text-white transition cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="relative flex items-center">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmar contraseña"
                  className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 text-gray-dim hover:text-white transition cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Personal information */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-3.5"
            >
              <h3 className="text-white text-lg font-bold tracking-wide mb-1">{t("step2")}</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("fullName")} *</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. José Ángel"
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("nickname")} *</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Ej. jose10"
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("birthDate")} *</label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 uppercase"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("city")} *</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ej. San José"
                    className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("country")} *</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-3 py-3 rounded-xl outline-none transition-all duration-200"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-black text-white">
                        {c.flag} {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-dim">{t("gender")} *</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-sm px-3 py-3 rounded-xl outline-none transition-all duration-200"
                  >
                    <option value="M" className="bg-black text-white">{t("genderM")}</option>
                    <option value="F" className="bg-black text-white">{t("genderF")}</option>
                    <option value="O" className="bg-black text-white">{t("genderO")}</option>
                  </select>
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

        {step < 2 ? (
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
