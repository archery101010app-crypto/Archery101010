"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile, updateProfile } from "@/lib/authService";
import { motion } from "framer-motion";
import { AlertCircle, User, X, ArrowLeft } from "lucide-react";

interface ProfileCompletionModalProps {
  user: UserProfile;
  onComplete: (updatedUser: UserProfile) => void;
  onClose?: () => void;
  onReturnToLogin?: () => void;
}

import { COUNTRIES } from "@/lib/countries";

export default function ProfileCompletionModal({ user, onComplete, onClose, onReturnToLogin }: ProfileCompletionModalProps) {
  const { t } = useLanguage();
  const [fullName, setFullName] = useState(user.fullName || "");
  const [nickname, setNickname] = useState(user.nickname || "");
  const [birthDate, setBirthDate] = useState(user.birthDate || "");
  const [city, setCity] = useState(user.city || "");
  const [country, setCountry] = useState(user.country || "CR");
  const [gender, setGender] = useState(user.gender || "M");
  
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!fullName.trim() || !birthDate || !country || !gender) {
      setError("Por favor completa todos los campos obligatorios.");
      return;
    }

    setLoading(true);
    try {
      const cleanNick = nickname.trim() || user.nickname?.trim() || fullName.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "arquero";
      const updated = await updateProfile(user.uid, {
        fullName: fullName.trim(),
        nickname: cleanNick,
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
    <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-[#0A0B0E] border border-white/10 p-6 rounded-3xl flex flex-col gap-4 relative overflow-hidden"
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
            <h3 className="text-white text-lg font-black uppercase tracking-wide">
              Completa tu Perfil
            </h3>
            <p className="text-[10.5px] text-white uppercase tracking-wider font-bold">
              Información obligatoria requerida
            </p>
          </div>
        </div>

        <p className="text-xs text-white leading-relaxed">
          Para continuar usando <strong>Archery 101010</strong>, debes definir tu apodo público y otros datos indispensables.
        </p>

        {error && (
          <div className="bg-red-rival/10 border border-red-rival/40 rounded-xl p-3 flex items-center gap-2 text-red-rival text-xs">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-3.5 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("fullName")} *
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder=""
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("nickname")} *
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder=""
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("birthDate")} *
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3 py-3 rounded-xl outline-none transition-all duration-200 uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("city")} *
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ej. San José"
                className="w-full bg-[#0D0F12] border border-white/10 focus:border-cyan-neon text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-cyan-neon"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("country")} *
              </label>
              <select
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
              <label className="text-[11.6px] text-white uppercase font-bold tracking-wider">
                {t("gender")} *
              </label>
              <select
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

          <div className="bg-[#0D0F12] border border-white/[0.06] p-3 rounded-xl text-[11.6px] text-white leading-snug">
            <strong className="text-white uppercase tracking-wider">Nota sobre el Apodo:</strong> El apodo es de carácter público. Será visible para tu entrenador y otros arqueros durante duelos competitivos en vivo.
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
