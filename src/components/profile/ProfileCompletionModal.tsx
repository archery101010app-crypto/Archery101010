"use client";

import React, { useState, useId } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile, updateProfile, calculateAgeFromBirthDate } from "@/lib/authService";
import { motion } from "framer-motion";
import { AlertCircle, User, X, ArrowLeft } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";

interface ProfileCompletionModalProps {
  user: UserProfile;
  onComplete: (updatedUser: UserProfile) => void;
  onClose?: () => void;
  onReturnToLogin?: () => void;
}

export default function ProfileCompletionModal({ user, onComplete, onClose, onReturnToLogin }: ProfileCompletionModalProps) {
  const { t } = useLanguage();
  const baseId = useId();
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
  const [birthDate, setBirthDate] = useState(user.birthDate || "");
  const [city, setCity] = useState(user.city || "");
  const [country, setCountry] = useState(user.country || "CR");
  const [gender, setGender] = useState(user.gender || "M");
  
  const [error, setError] = useState("");
  const [birthDateInvalid, setBirthDateInvalid] = useState(false);
  const [loading, setLoading] = useState(false);

  const todayIso = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBirthDateInvalid(false);

    if (!fullName.trim() || !birthDate || !city.trim() || !country || !gender) {
      setError("Por favor completa todos los campos obligatorios (Nombre, Fecha de nacimiento, Ciudad, País y Género).");
      return;
    }

    const age = calculateAgeFromBirthDate(birthDate);
    if (age === null) {
      setBirthDateInvalid(true);
      setError("Ingresa una fecha de nacimiento válida (no se permiten fechas futuras).");
      return;
    }

    if (age < 13) {
      setBirthDateInvalid(true);
      setError("Debes tener al menos 13 años para crear una cuenta en ARCHERY 101010.");
      return;
    }

    setLoading(true);
    try {
      const cleanNick = nickname.trim() || user.nickname?.trim() || fullName.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";
      const updated = await updateProfile(user.uid, {
        fullName: fullName.trim(),
        nickname: cleanNick,
        clubName: clubName.trim() || null,
        birthDate,
        city: city.trim(),
        country,
        gender
      });
      onComplete(updated);
    } catch (err: any) {
      setError(err.message || "Error al completar el perfil");
    } finally {
      setLoading(false);
    }
  };

  const handleExit = () => {
    if (onReturnToLogin) {
      onReturnToLogin();
    } else if (onClose) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 overflow-hidden overscroll-contain">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain bg-[#0A0B0E] border border-white/10 p-5 sm:p-6 rounded-3xl flex flex-col gap-4 relative"
      >
        {/* Botón X de Salida / Retorno */}
        {(onClose || onReturnToLogin) && (
          <button
            type="button"
            onClick={handleExit}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:text-white hover:bg-white/15 transition-all cursor-pointer z-20 active:scale-90"
            title="Cerrar y volver a inicio"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        )}
        
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-cyan-neon/10 flex items-center justify-center text-cyan-neon border border-cyan-neon/20">
            <User size={20} />
          </div>
          <div>
            <h3 id={`${baseId}-heading`} className="text-white text-lg font-black uppercase tracking-wide">
              Completa tu Perfil
            </h3>
            <p className="text-[10.5px] text-white uppercase tracking-wider font-bold">
              Información obligatoria requerida (13+ años)
            </p>
          </div>
        </div>

        <p className="text-xs text-white leading-relaxed">
          Para continuar usando <strong>ARCHERY 101010</strong>, completa tus datos básicos de arquero. El <strong>Alias</strong> es opcional.
        </p>

        {error && (
          <div
            id={`${baseId}-error`}
            role="alert"
            aria-live="assertive"
            className="bg-white border border-white rounded-xl p-3 flex items-center gap-2 text-black font-bold text-xs"
          >
            <AlertCircle size={16} className="shrink-0 text-black" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} aria-labelledby={`${baseId}-heading`} className="flex flex-col gap-3.5 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-fullname`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("fullName")} *
              </label>
              <input
                id={`${baseId}-fullname`}
                name="fullName"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (error) setError("");
                }}
                placeholder=""
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-nickname`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                Alias <span className="text-white font-medium normal-case">(Opcional)</span>
              </label>
              <input
                id={`${baseId}-nickname`}
                name="nickname"
                type="text"
                autoComplete="nickname"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Opcional"
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label htmlFor={`${baseId}-birthdate`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
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
                className="min-w-0 w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-3 rounded-xl outline-none transition-all duration-200 uppercase [color-scheme:dark] tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <label htmlFor={`${baseId}-city`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("city")} *
              </label>
              <input
                id={`${baseId}-city`}
                name="city"
                type="text"
                autoComplete="address-level2"
                required
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Ej. San José"
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-country`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("country")} *
              </label>
              <select
                id={`${baseId}-country`}
                name="country"
                autoComplete="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-3 rounded-xl outline-none transition-all duration-200"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-black text-white">
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${baseId}-gender`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("gender")} *
              </label>
              <select
                id={`${baseId}-gender`}
                name="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-2.5 py-3 rounded-xl outline-none transition-all duration-200"
              >
                <option value="M" className="bg-black text-white">{t("genderM")}</option>
                <option value="F" className="bg-black text-white">{t("genderF")}</option>
                <option value="O" className="bg-black text-white">{t("genderO")}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${baseId}-club`} className="text-[11.6px] text-white uppercase font-bold tracking-wider">
              Club <span className="text-white font-medium normal-case">(Opcional)</span>
            </label>
            <input
              id={`${baseId}-club`}
              name="clubName"
              type="text"
              autoComplete="organization"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Opcional"
              className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white placeholder-white/30 text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-3.5 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition-all duration-200"
          >
            {loading ? "Guardando..." : "Guardar y Continuar"}
          </button>

          {onReturnToLogin && (
            <button
              type="button"
              onClick={onReturnToLogin}
              className="w-full py-2.5 text-xs text-white hover:text-yellow-gold font-bold tracking-wide transition-colors flex items-center justify-center gap-2 cursor-pointer mt-1 border border-white/5 hover:border-yellow-gold/30 rounded-xl"
            >
              <ArrowLeft size={14} />
              <span>Volver a inicio de sesión (Usuario y contraseña)</span>
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}
