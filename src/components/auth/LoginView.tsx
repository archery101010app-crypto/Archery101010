"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { loginUser, loginSocialUser, UserProfile } from "@/lib/authService";
import { Mail, Lock, AlertCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { auth } from "@/lib/firebase";
import { signInWithPopup, GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";
import { getLocalSetting } from "@/lib/db/indexedDB";

interface LoginViewProps {
  onLoginSuccess: (user: any) => void;
  onNavigateToRegister: () => void;
}

export default function LoginView({ onLoginSuccess, onNavigateToRegister }: LoginViewProps) {
  const { language, t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Connection and bypass states
  const [isOnline, setIsOnline] = useState(true);
  const [isSocialBypassAvailable, setIsSocialBypassAvailable] = useState(false);
  const [bypassUser, setBypassUser] = useState<UserProfile | null>(null);

  // PWA states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  // Capture beforeinstallprompt and check if app is already standalone
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches 
      || (window.navigator as any).standalone === true;
    
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isStandalone) {
      setShowInstallBanner(false);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // If it is iOS and not standalone, show the banner manually to trigger the guide
    if (isIOS && !isStandalone) {
      setShowInstallBanner(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  // Track online status
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Check if typed email matches a local social account with no password
  useEffect(() => {
    async function checkSocialBypass() {
      if (!isOnline && email) {
        try {
          const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const matched = usersList.find(
            (u) => u.email.toLowerCase() === email.trim().toLowerCase()
          );
          if (matched && !matched.password) {
            setIsSocialBypassAvailable(true);
            setBypassUser(matched);
            return;
          }
        } catch (err) {
          console.error("Error checking social bypass list:", err);
        }
      }
      setIsSocialBypassAvailable(false);
      setBypassUser(null);
    }
    checkSocialBypass();
  }, [email, isOnline]);

  const handleBypassLogin = async () => {
    if (!bypassUser) return;
    setLoading(true);
    setError("");
    try {
      const { saveLocalSetting } = await import("@/lib/db/indexedDB");
      await saveLocalSetting("current_user", bypassUser);
      onLoginSuccess(bypassUser);
    } catch (err: any) {
      setError(err.message || "Error al ingresar en modo local.");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const { loginGuestOffline } = await import("@/lib/authService");
      const guestUser = await loginGuestOffline();
      onLoginSuccess(guestUser);
    } catch (err: any) {
      setError(err.message || "Error al ingresar como invitado.");
    } finally {
      setLoading(false);
    }
  };

  const handleInstallClick = async () => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) {
      // Fallback for browsers that don't support beforeinstallprompt but are Android/Chrome
      alert("Para instalar, ve al menú del navegador (tres puntos) y selecciona 'Instalar aplicación' o 'Añadir a pantalla de inicio'.");
      return;
    }
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA installation outcome: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };

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
      const user = await loginUser(email, password);
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (providerName: string) => {
    if (providerName === "facebook") {
      setError("El inicio de sesión con Facebook no está disponible temporalmente.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const isLocalhost = typeof window !== "undefined" && 
                          (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const isMockFirebase = (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 
                             process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("mock-api-key")) && isLocalhost;

      let email = "";
      let displayName = "";

      if (!isMockFirebase) {
        const provider = providerName === "google" 
          ? new GoogleAuthProvider() 
          : new FacebookAuthProvider();
          
        const result = await signInWithPopup(auth, provider);
        email = result.user.email || "";
        displayName = result.user.displayName || "";
      } else {
        // Fallback simulated logic for developer local testing
        email = providerName === "google" ? "google-user@archery101010.com" : "facebook-user@archery101010.com";
        displayName = providerName === "google" ? "Google User" : "Facebook User";
      }

      if (!email) {
        throw new Error("No se pudo obtener el correo de la cuenta social.");
      }

      const user = await loginSocialUser(email, displayName);
      onLoginSuccess(user);
    } catch (err: any) {
      console.error("Error en autenticación social:", err);
      let msg = "Error en autenticación social.";
      if (err.code === "auth/popup-closed-by-user") {
        msg = "Inicio de sesión cancelado por el usuario.";
      } else if (err.code === "auth/configuration-not-found" || err.code === "auth/operation-not-allowed") {
        msg = `El acceso con ${providerName === "google" ? "Google" : "Facebook"} no está activado en la consola de Firebase. Por favor regístrate normalmente.`;
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between px-6 pt-12 pb-6 min-h-full">


      {/* Brand logo section */}
      <div className="flex flex-col items-center justify-center my-auto py-6">
        <motion.div 
          initial={{ y: -15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex text-[52px] md:text-6xl tracking-tighter font-extrabold select-none mb-1.5"
          style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
        >
          <span className="text-cyan-neon drop-shadow-[0_0_20px_rgba(0,191,255,0.4)]">10</span>
          <span className="text-red-rival drop-shadow-[0_0_20px_rgba(255,0,0,0.3)]">10</span>
          <span className="text-yellow-gold drop-shadow-[0_0_20px_rgba(255,229,0,0.3)]">10</span>
        </motion.div>
        <motion.span
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-white/40 text-[10px] font-black tracking-[0.55em] uppercase text-center pl-1.5"
        >
          ARCHERY
        </motion.span>
      </div>

      {/* Login form and fields */}
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">
        
        {/* PWA Install Banner */}
        {showInstallBanner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-gradient-to-r from-neutral-900/90 to-neutral-950/90 border border-cyan-neon/30 p-4 rounded-3xl flex flex-col gap-2 shadow-[0_0_20px_rgba(0,229,255,0.05)] relative overflow-hidden"
          >
            <div className="flex justify-between items-start">
              <div className="flex gap-2">
                <span className="text-base">📱</span>
                <div className="flex flex-col">
                  <span className="text-white text-xs font-black uppercase tracking-wider">
                    Instalar como App Local
                  </span>
                  <span className="text-[8px] text-cyan-neon font-black uppercase tracking-widest mt-0.5 animate-pulse">
                    Recomendado · Velocidad 10x
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallBanner(false)}
                className="text-gray-dim hover:text-white p-0.5 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[10px] text-gray-dim leading-snug">
              Instala esta app en tu pantalla de inicio. Se ejecutará 100% en local para una velocidad instantánea sin latencia, y soporte offline completo.
            </p>
            <button
              type="button"
              onClick={handleInstallClick}
              className="w-full py-2.5 rounded-xl bg-cyan-neon/15 border border-cyan-neon/30 hover:border-cyan-neon text-cyan-neon hover:text-white text-xs font-bold transition-all cursor-pointer text-center"
            >
              Instalar Ahora
            </button>
          </motion.div>
        )}

        {!isOnline && (
          <div className="bg-yellow-gold/10 border border-yellow-gold/30 rounded-2xl p-3.5 flex flex-col gap-1.5 shadow-[0_0_15px_rgba(255,229,0,0.05)]">
            <span className="text-yellow-gold text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              ⚠️ {language === "es" ? "Modo Desconectado" : "Offline Mode"}
            </span>
            <p className="text-[10px] text-gray-dim leading-snug">
              {language === "es" 
                ? "No tienes conexión a internet. Puedes ingresar usando tus credenciales guardadas en este dispositivo o registrar tiros usando el modo Invitado." 
                : "No internet connection detected. You can sign in using credentials saved on this device or log sessions using Guest Mode."}
            </p>
          </div>
        )}

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
          
          {isSocialBypassAvailable && (
            <motion.button
              whileHover={{ scale: 1.02, filter: "brightness(1.15)" }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleBypassLogin}
              disabled={loading}
              className="w-full py-3.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-extrabold text-sm uppercase tracking-wider shadow-[0_0_15px_rgba(168,85,247,0.2)] transition-all duration-200 cursor-pointer flex justify-center items-center mt-2 border border-purple-400/20"
            >
              🔓 Ingresar en Modo Local (Sin Contraseña)
            </motion.button>
          )}
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
          
          {/* Offline Guest Option */}
          <button
            type="button"
            onClick={handleGuestLogin}
            className="w-full py-3.5 rounded-xl bg-neutral-900/40 border border-dashed border-cyan-neon/20 hover:border-cyan-neon/50 text-cyan-neon font-bold text-xs flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer mt-1"
          >
            <span>⚡ Registrar Tiros como Invitado (Sin Conexión)</span>
          </button>
        </div>
      </div>

      {/* Footer copyright */}
      <footer className="text-center text-[10px] text-gray-dim tracking-wider mt-8">
        {t("copyright")}
      </footer>

      {/* iOS Safari Installation Steps Modal */}
      <AnimatePresence>
        {showIOSModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-[340px] bg-neutral-950 border border-neutral-800 p-5 rounded-[32px] flex flex-col gap-4 relative"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-white text-xs font-black uppercase tracking-wider">
                  Instalación en iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSModal(false)}
                  className="p-1 rounded-full bg-neutral-900 border border-neutral-800 text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-col gap-3.5 text-xs text-gray-dim leading-relaxed">
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[10px] text-cyan-neon">
                    1
                  </div>
                  <p>
                    Abre esta app en el navegador <span className="text-white font-bold">Safari</span>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[10px] text-cyan-neon">
                    2
                  </div>
                  <p className="flex items-center gap-1.5 flex-wrap">
                    Presiona el botón de compartir 
                    <span className="bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded text-[10px] text-white">
                      Compartir 📤
                    </span> 
                    abajo en la barra del sistema.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[10px] text-cyan-neon">
                    3
                  </div>
                  <p className="flex items-center gap-1.5 flex-wrap">
                    Desliza hacia abajo y pulsa 
                    <span className="bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded text-[10px] text-white font-bold">
                      Añadir a pantalla de inicio ➕
                    </span>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[10px] text-cyan-neon">
                    4
                  </div>
                  <p>
                    Presiona <span className="text-white font-bold">Añadir</span> arriba a la derecha. ¡Listo!
                  </p>
                </div>
              </div>

              <div className="bg-cyan-neon/5 border border-cyan-neon/20 p-3 rounded-xl flex items-center gap-2 mt-2">
                <span className="text-lg">⚡</span>
                <span className="text-[9px] text-[#00E5FF] font-medium leading-tight">
                  Una vez añadida, se descargará en local y cargará al instante cada vez que la abras.
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
