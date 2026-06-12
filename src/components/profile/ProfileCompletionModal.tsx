"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { UserProfile, updateProfile } from "@/lib/authService";
import { motion } from "framer-motion";
import { AlertCircle, User } from "lucide-react";

interface ProfileCompletionModalProps {
  user: UserProfile;
  onComplete: (updatedUser: UserProfile) => void;
}

const COUNTRIES = [
  { code: "CR", name: "Costa Rica", flag: "🇨🇷" },
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

export default function ProfileCompletionModal({ user, onComplete }: ProfileCompletionModalProps) {
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

    if (!fullName.trim() || !nickname.trim() || !birthDate || !city.trim() || !country || !gender) {
      setError("Por favor completa todos los campos obligatorios.");
      return;
    }

    setLoading(true);
    try {
      const updated = await updateProfile(user.uid, {
        fullName: fullName.trim(),
        nickname: nickname.trim(),
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

  return (
    <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-neutral-950 border border-cyan-neon/30 p-6 rounded-3xl flex flex-col gap-4 shadow-[0_0_50px_rgba(0,229,255,0.15)] relative overflow-hidden"
      >
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-brand to-cyan-neon" />
        
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-cyan-neon/15 flex items-center justify-center text-cyan-neon border border-cyan-neon/20 shadow-glow-cyan">
            <User size={20} />
          </div>
          <div>
            <h3 className="text-white text-lg font-black uppercase tracking-wide">
              Completa tu Perfil
            </h3>
            <p className="text-[9px] text-gray-dim uppercase tracking-wider font-bold">
              Información obligatoria requerida
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-dim leading-relaxed">
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
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("fullName")} *
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ej. José Ángel"
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("nickname")} *
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ej. jose10"
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("birthDate")} *
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-xs px-3 py-3 rounded-xl outline-none transition-all duration-200 uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("city")} *
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ej. San José"
                className="w-full bg-neutral-900/60 border border-cyan-brand focus:border-cyan-neon focus:shadow-glow-cyan text-white text-xs px-3.5 py-3 rounded-xl outline-none transition-all duration-200 caret-yellow-gold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("country")} *
              </label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-xs px-2.5 py-3 rounded-xl outline-none transition-all duration-200"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-black text-white">
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-gray-dim uppercase font-bold tracking-wider">
                {t("gender")} *
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full bg-neutral-900/60 border border-cyan-brand text-white text-xs px-2.5 py-3 rounded-xl outline-none transition-all duration-200"
              >
                <option value="M" className="bg-black text-white">{t("genderM")}</option>
                <option value="F" className="bg-black text-white">{t("genderF")}</option>
                <option value="O" className="bg-black text-white">{t("genderO")}</option>
              </select>
            </div>
          </div>

          <div className="bg-neutral-900/40 border border-white/5 p-3 rounded-2xl text-[10px] text-gray-dim leading-snug">
            💡 <strong>Nota sobre el Apodo:</strong> El apodo es de carácter público. Será visible para tu entrenador y otros arqueros durante duelos competitivos en vivo.
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-3.5 bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-glow-cyan hover:brightness-110 active:scale-95 transition-all duration-200"
          >
            {loading ? "Guardando..." : "Guardar y Continuar"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
