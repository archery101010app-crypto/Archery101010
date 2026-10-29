"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { registerUser, authenticateWithSocialProvider } from "@/lib/authService";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, X } from "lucide-react";

interface RegisterViewProps {
  onRegisterSuccess: (user: any) => void;
  onNavigateToLogin: () => void;
}

import { COUNTRIES } from "@/lib/countries";

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
  const [birthDate, setBirthDate] = useState("");
  const [country, setCountry] = useState("CR");
  const [gender, setGender] = useState("M");

  const handleNext = () => {
    setError("");
    if (step === 1) {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password || !confirmPassword) {
        setError("Completa todos los campos");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        setError("El formato del correo electrónico no es válido");
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

  const handleSocialRegister = async (providerName: "google" | "facebook") => {
    setLoading(true);
    setError("");
    try {
      const user = await authenticateWithSocialProvider(providerName);
      if (user) {
        onRegisterSuccess(user);
      }
    } catch (err: any) {
      setError(err.message || "Error al registrarse con cuenta social");
    } finally {
      setLoading(false);
    }
  };

  const handlePrev = () => {
    setError("");
    setStep(step - 1);
  };

  const handleRegister = async () => {
    if (!fullName.trim() || !birthDate) {
      setError("Completa todos los campos obligatorios");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const cleanFullName = fullName.trim();
      const autoNickname = cleanFullName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";
      const user = await registerUser({
        email,
        password,
        fullName: cleanFullName,
        nickname: autoNickname,
        birthDate,
        city: "",
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
          className="text-white hover:text-white flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>{t("back")}</span>
        </button>
        <span className="text-xs text-white font-bold tracking-widest uppercase">
          {t("registerTitle")}
        </span>
        <button
          onClick={onNavigateToLogin}
          className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:text-white hover:bg-white/15 transition-all cursor-pointer"
          title="Cerrar y volver al inicio de sesión"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress Stepper Indicator */}
      <div className="flex items-center justify-between w-full max-w-xs mx-auto mb-8 px-4">
        {[1, 2].map((i) => (
          <React.Fragment key={i}>
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border transition-all duration-200 ${
                step === i
                  ? "bg-cyan-neon/15 border-cyan-neon text-cyan-neon"
                  : step > i
                  ? "bg-cyan-brand/10 border-cyan-brand text-cyan-brand"
                  : "bg-transparent border-gray-border text-white"
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
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm px-4 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 text-white hover:text-white transition cursor-pointer"
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
                  className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-4 text-white hover:text-white transition cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* 1-tap Social Registration */}
              <div className="flex items-center gap-4 pt-2 pb-1">
                <div className="h-[1px] flex-1 bg-white/10" />
                <span className="text-[11.6px] text-white font-bold uppercase tracking-widest">
                  o regístrate en 1 toque
                </span>
                <div className="h-[1px] flex-1 bg-white/10" />
              </div>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSocialRegister("google")}
                  className="w-full py-3 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-semibold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span>{t("googleLogin")}</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleSocialRegister("facebook")}
                  className="w-full py-3 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-semibold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-[#1877F2] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  <span>{t("facebookLogin")}</span>
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
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-white">{t("fullName")} *</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder=""
                  className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white">{t("birthDate")} *</label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm px-4 py-3 rounded-xl outline-none transition-all duration-200 uppercase"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white">{t("country")} *</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm px-3 py-3 rounded-xl outline-none transition-all duration-200"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code} className="bg-black text-white">
                        {c.flag} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-white">{t("gender")} *</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-sm px-3 py-3 rounded-xl outline-none transition-all duration-200"
                >
                  <option value="M" className="bg-black text-white">{t("genderM")}</option>
                  <option value="F" className="bg-black text-white">{t("genderF")}</option>
                  <option value="O" className="bg-black text-white">{t("genderO")}</option>
                </select>
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
            className="flex-1 py-3.5 rounded-xl border border-white/10 bg-[#0D0F12] text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-white/[0.05] transition-all duration-200 cursor-pointer"
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
            className="flex-1 py-3.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
          >
            <span>{t("next")}</span>
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
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
