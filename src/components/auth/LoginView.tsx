"use client";

import React, { useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { loginUser } from "@/lib/authService";
import { Mail, Lock, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

interface LoginViewProps {
  onLoginSuccess: (user: any) => void;
  onNavigateToRegister: () => void;
}

export default function LoginView({ onLoginSuccess, onNavigateToRegister }: LoginViewProps) {
  const { language, setLanguage, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Por favor ingresa un correo");
      return;
    }
    setLoading(true);
    setError("");

    try {
      // Authenticate with mock service (IndexedDB resilient)
      const user = await loginUser(email);
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: string) => {
    setLoading(true);
    try {
      // Simulated social auth using a dummy email matching the provider
      const email = provider === "google" ? "google-user@archery101010.com" : "facebook-user@archery101010.com";
      const user = await loginUser(email);
      onLoginSuccess(user);
    } catch (err: any) {
      setError("Error en autenticación social");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between px-6 pt-12 pb-6 min-h-full">
      {/* Top Bar with Language Selector */}
      <div className="flex justify-end items-center mb-6">
        <div className="flex bg-neutral-900/60 p-0.5 rounded-full border border-gray-border">
          <button
            onClick={() => setLanguage("es")}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all duration-200 ${
              language === "es"
                ? "bg-cyan-neon/10 border border-cyan-neon text-cyan-neon shadow-glow-cyan"
                : "bg-transparent border border-transparent text-gray-dim hover:text-white"
            }`}
          >
            ES
          </button>
          <button
            onClick={() => setLanguage("en")}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all duration-200 ${
              language === "en"
                ? "bg-cyan-neon/10 border border-cyan-neon text-cyan-neon shadow-glow-cyan"
                : "bg-transparent border border-transparent text-gray-dim hover:text-white"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Brand logo section */}
      <div className="flex flex-col items-center justify-center my-auto py-4">
        {/* Colorful 101010 blocks */}
        <div className="flex gap-2.5 mb-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="w-12 h-12 bg-cyan-neon rounded-2xl flex items-center justify-center font-black text-black text-xl shadow-glow-cyan"
          >
            10
          </motion.div>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="w-12 h-12 bg-red-rival rounded-2xl flex items-center justify-center font-black text-black text-xl shadow-glow-red"
          >
            10
          </motion.div>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="w-12 h-12 bg-yellow-gold rounded-2xl flex items-center justify-center font-black text-black text-xl shadow-glow-yellow"
          >
            10
          </motion.div>
        </div>
        <motion.h1
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-white text-3xl font-extrabold tracking-[0.25em] text-center"
        >
          {t("appTitle")}
        </motion.h1>
      </div>

      {/* Login form and fields */}
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">
        <h2 className="text-white/80 font-bold text-center text-sm tracking-wider uppercase">
          {t("loginTitle")}
        </h2>

        {error && (
          <div className="bg-red-rival/10 border border-red-rival/40 rounded-xl p-3 flex items-center gap-2 text-red-rival text-sm">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email field */}
          <div className="relative flex items-center">
            <span className="absolute left-4 text-gray-dim">
              <Mail size={18} />
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="w-full bg-neutral-900/60 border border-cyan-brand text-white placeholder-gray-dim text-sm pl-12 pr-4 py-3.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan transition-all duration-200 caret-yellow-gold"
            />
          </div>

          {/* Password field */}
          <div className="relative flex items-center">
            <span className="absolute left-4 text-gray-dim">
              <Lock size={18} />
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full bg-neutral-900/60 border border-cyan-brand text-white placeholder-gray-dim text-sm pl-12 pr-4 py-3.5 rounded-xl outline-none focus:border-cyan-neon focus:shadow-glow-cyan transition-all duration-200 caret-yellow-gold"
            />
          </div>

          {/* Login button */}
          <motion.button
            whileHover={{ scale: 1.02, filter: "brightness(1.15)" }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full py-3.5 mt-2 rounded-full bg-gradient-to-r from-cyan-brand to-cyan-neon text-yellow-gold font-extrabold text-sm uppercase tracking-wider shadow-glow-cyan transition-all duration-200 cursor-pointer flex justify-center items-center"
          >
            {loading ? t("loading") : t("loginBtn")}
          </motion.button>
        </form>

        {/* Register link */}
        <button
          onClick={onNavigateToRegister}
          className="text-center text-xs text-yellow-gold font-semibold hover:underline cursor-pointer py-1"
        >
          {t("signUpLink")}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 py-2">
          <div className="h-[1px] flex-1 bg-gray-border" />
          <span className="text-xs text-gray-dim uppercase tracking-widest">o</span>
          <div className="h-[1px] flex-1 bg-gray-border" />
        </div>

        {/* Social login buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleSocialLogin("google")}
            className="w-full py-3 rounded-xl bg-neutral-900/60 border border-white/10 hover:border-cyan-brand/40 text-white font-medium text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>{t("googleLogin")}</span>
          </button>
          <button
            onClick={() => handleSocialLogin("facebook")}
            className="w-full py-3 rounded-xl bg-neutral-900/60 border border-white/10 hover:border-cyan-brand/40 text-white font-medium text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-4 h-4 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            <span>{t("facebookLogin")}</span>
          </button>
        </div>
      </div>

      {/* Footer copyright */}
      <footer className="text-center text-[10px] text-gray-dim tracking-wider mt-8">
        {t("copyright")}
      </footer>
    </div>
  );
}
