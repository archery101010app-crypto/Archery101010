"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import {
  loginUser,
  loginSocialUser,
  sendPasswordReset,
  authenticateWithSocialProvider,
  processSocialRedirectResult,
  UserProfile,
} from "@/lib/authService";
import { Mail, Lock, AlertCircle, CheckCircle2, X, Eye, EyeOff, Smartphone, Unlock, Share, Plus, Zap, KeyRound } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getLocalSetting } from "@/lib/db/indexedDB";
import LanguageSelector from "@/components/ui/LanguageSelector";
import { showOledAlert } from "@/lib/oledDialog";

interface LoginViewProps {
  onLoginSuccess: (user: any) => void;
  onNavigateToRegister: () => void;
}

export default function LoginView({ onLoginSuccess, onNavigateToRegister }: LoginViewProps) {
  const { language, t, tx } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resetSuccessMsg, setResetSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Connection and bypass states
  const [isOnline, setIsOnline] = useState(true);
  const [isSocialBypassAvailable, setIsSocialBypassAvailable] = useState(false);
  const [bypassUser, setBypassUser] = useState<UserProfile | null>(null);

  // PWA states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  // Password recovery modal states
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetModalError, setResetModalError] = useState("");
  const [resetModalSuccess, setResetModalSuccess] = useState("");

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

  // Check for OAuth redirect completion (Google)
  const [isAndroidNativeApp, setIsAndroidNativeApp] = useState(false);
  useEffect(() => {
    // Apple Sign-In popups are not supported inside the Android WebView: hide the button there
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
          onLoginSuccess(user);
        }
      } catch (err: any) {
        console.error("Error al procesar retorno de redirección:", err);
      }
    }
    checkRedirect();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (
        firebaseUser &&
        !resolved &&
        firebaseUser.providerData.some((p) => p.providerId === "google.com" || p.providerId === "apple.com")
      ) {
        resolved = true;
        setLoading(true);
        try {
          const email =
            firebaseUser.email ||
            firebaseUser.providerData?.find((p) => p.email)?.email ||
            `${firebaseUser.uid}@social.archery101010.com`;
          const displayName =
            firebaseUser.displayName ||
            firebaseUser.providerData?.find((p) => p.displayName)?.displayName ||
            tx("Arquero", "Archer");
          const user = await loginSocialUser(email, displayName, firebaseUser.uid);
          onLoginSuccess(user);
        } catch (err) {
          console.error("Error en sincronización de sesión social:", err);
          setLoading(false);
        }
      }
    });

    return () => unsubscribe();
  }, [onLoginSuccess]);

  // Check if offline and typed email matches the active Firebase Auth session on this device
  useEffect(() => {
    async function checkOfflineSessionResume() {
      if (!isOnline && email && auth.currentUser) {
        try {
          const activeAuthEmail = (auth.currentUser.email || "").toLowerCase();
          if (activeAuthEmail && activeAuthEmail === email.trim().toLowerCase()) {
            const usersList = await getLocalSetting<UserProfile[]>("simulated_users", []);
            const matched = usersList.find((u) => u.uid === auth.currentUser?.uid || (u.email || "").toLowerCase() === activeAuthEmail);
            if (matched) {
              setIsSocialBypassAvailable(true);
              setBypassUser(matched);
              return;
            }
          }
        } catch (err) {
          console.error("Error checking offline session resume:", err);
        }
      }
      setIsSocialBypassAvailable(false);
      setBypassUser(null);
    }
    checkOfflineSessionResume();
  }, [email, isOnline]);

  const handleOpenPasswordReset = () => {
    setError("");
    setResetSuccessMsg("");
    setResetModalError("");
    setResetModalSuccess("");
    setResetEmail(email.trim());
    setShowResetModal(true);
  };

  const handleConfirmPasswordReset = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setResetModalError("");
    setResetModalSuccess("");
    const targetEmail = (resetEmail || email).trim().toLowerCase();
    if (!targetEmail) {
      setResetModalError(
        tx(
          "Ingresa el correo electrónico de tu cuenta.",
          "Enter your account email address."
        )
      );
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordReset(targetEmail);
      setEmail(targetEmail);
      const msg = tx(
        `Enlace enviado a ${targetEmail}.\n\n` +
          `• Revisa tu Bandeja de Entrada, Promociones o Spam.\n` +
          `• Abre el enlace para elegir tu nueva contraseña.`,
        `Reset link sent to ${targetEmail}.\n\n` +
          `• Check your Inbox, Promotions, or Spam folder.\n` +
          `• Open the link to set your new password.`
      );
      setResetModalSuccess(msg);
      setResetSuccessMsg(msg);
    } catch (err: any) {
      setResetModalError(
        err.message ||
          tx(
            "No se pudo enviar el correo de recuperación.",
            "Could not send password recovery email."
          )
      );
    } finally {
      setResetLoading(false);
    }
  };

  const handleBypassLogin = async () => {
    if (!bypassUser) return;
    setLoading(true);
    setError("");
    try {
      const { saveLocalSetting } = await import("@/lib/db/indexedDB");
      await saveLocalSetting("current_user", bypassUser);
      onLoginSuccess(bypassUser);
    } catch (err: any) {
      setError(
        err.message || tx("Error al ingresar en modo local.", "Error signing in locally.")
      );
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
      // Fallback for browsers that don't support beforeinstallprompt
      await showOledAlert(
        tx(
          "Para instalar, ve al menú del navegador (tres puntos) y selecciona 'Instalar aplicación' o 'Añadir a pantalla de inicio'.",
          "To install, open your browser menu (three dots) and select 'Install app' or 'Add to Home screen'."
        )
      );
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
      setError(tx("Por favor ingresa un correo", "Please enter an email address"));
      return;
    }
    setLoading(true);
    setError("");

    try {
      // Authenticate with mock service (IndexedDB resilient)
      const user = await loginUser(email, password);
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || tx("Error al iniciar sesión", "Error signing in"));
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "apple" = "google") => {
    setLoading(true);
    setError("");
    setResetSuccessMsg("");
    try {
      const user = await authenticateWithSocialProvider(provider);
      if (user) {
        onLoginSuccess(user);
      }
    } catch (err: any) {
      console.error("Error en autenticación social:", err);
      setError(err.message || tx("Error en autenticación social.", "Social authentication error."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between px-6 pt-6 pb-6 min-h-full">
      {/* Top right minimalist language selector pill */}
      <div className="w-full max-w-sm mx-auto flex justify-end">
        <LanguageSelector variant="pill" />
      </div>

      {/* Brand logo section: ARCHERY 101010 / THE APP (Branding Oficial Permanente) */}
      <div 
        translate="no"
        dir="ltr"
        className="notranslate w-full flex flex-col justify-center items-center my-auto pt-2 pb-6 select-none gap-1.5"
        style={{ fontFamily: "var(--font-family-logo, 'Good Times', sans-serif)" }}
      >
        <motion.h1 
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-wrap items-baseline justify-center gap-x-2 sm:gap-x-4 text-[29px] sm:text-[42.5px] md:text-[54px] leading-tight text-center"
        >
          <span className="text-white tracking-wider font-extrabold">ARCHERY</span>
          <span className="inline-flex tracking-tight font-extrabold">
            <span className="text-cyan-neon">10</span>
            <span className="text-red-rival">10</span>
            <span className="text-yellow-gold">10</span>
          </span>
        </motion.h1>
        <motion.span 
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="text-[15px] sm:text-[18px] md:text-[19.5px] text-white font-bold tracking-[0.38em] uppercase text-center pl-1"
        >
          THE APP
        </motion.span>
      </div>

      {/* Login form and fields */}
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">
        
        {/* PWA Install Banner */}
        {showInstallBanner && (() => {
          const pwaCopy: Record<string, { title: string; badge: string; desc: string; cta: string; close: string }> = {
            es: {
              title: "Instalar como App Local",
              badge: "Recomendado · Velocidad 10x",
              desc: "Instala esta app en tu pantalla de inicio. Se ejecutará 100% en local para una velocidad instantánea sin latencia, y soporte offline completo.",
              cta: "Instalar Ahora",
              close: "Cerrar aviso de instalación"
            },
            en: {
              title: "Install as Local App",
              badge: "Recommended · 10x Speed",
              desc: "Install this app on your home screen. It runs locally for instant zero-latency speed and full offline support.",
              cta: "Install Now",
              close: "Close install banner"
            },
            ko: {
              title: "로컬 앱으로 설치",
              badge: "권장 · 10배 빠른 속도",
              desc: "홈 화면에 앱을 설치하세요. 지연 없는 즉각적인 반응 속도와 완벽한 오프라인 모드를 지원합니다.",
              cta: "지금 설치",
              close: "설치 배너 닫기"
            },
            ja: {
              title: "ローカルアプリとして追加",
              badge: "推奨 · 10倍高速",
              desc: "ホーム画面に追加すると、遅延ゼロの高速動作と完全なオフライン機能をご利用いただけます。",
              cta: "今すぐインストール",
              close: "バナーを閉じる"
            },
            fr: {
              title: "Installer l'App Locale",
              badge: "Recommandé · Vitesse 10x",
              desc: "Ajoutez l'application à votre écran d'accueil pour une réactivité instantanée et un mode hors ligne complet.",
              cta: "Installer Maintenant",
              close: "Fermer la bannière"
            },
            de: {
              title: "Als Lokale App installieren",
              badge: "Empfohlen · 10x Schneller",
              desc: "Füge diese App deinem Startbildschirm hinzu für verzögerungsfreie Geschwindigkeit und vollen Offline-Modus.",
              cta: "Jetzt installieren",
              close: "Banner schließen"
            },
            pt: {
              title: "Instalar como App Local",
              badge: "Recomendado · Velocidade 10x",
              desc: "Instale este app na tela inicial para velocidade instantânea sem latência e suporte offline completo.",
              cta: "Instalar Agora",
              close: "Fechar aviso"
            },
            it: {
              title: "Installa come App Locale",
              badge: "Consigliato · Velocità 10x",
              desc: "Aggiungi l'app alla schermata Home per velocità istantanea senza latenza e supporto offline completo.",
              cta: "Installa Ora",
              close: "Chiudi avviso"
            },
            "zh-CN": {
              title: "安装为本地应用",
              badge: "推荐 · 10倍极速",
              desc: "将应用添加到主屏幕，享受零延迟极速响应与完整离线支持。",
              cta: "立即安装",
              close: "关闭安装提示"
            },
            iw: {
              title: "התקן כאפליקציה מקומית",
              badge: "מומלץ · מהירות פי 10",
              desc: "הוסף את האפליקציה למסך הבית למהירות מיידית ללא השהיה ותמיכה מלאה במצב לא מקוון.",
              cta: "התקן עכשיו",
              close: "סגור הודעה"
            },
            ru: {
              title: "Установить приложение",
              badge: "Рекомендуем · Скорость 10x",
              desc: "Добавьте приложение на главный экран для мгновенного отклика и полной работы офлайн.",
              cta: "Установить",
              close: "Закрыть баннер"
            },
            cs: {
              title: "Nainstalovat lokální aplikaci",
              badge: "Doporučeno · 10× rychlejší",
              desc: "Přidejte si aplikaci na plochu pro okamžitou odezvu bez prodlevy a plný offline režim.",
              cta: "Nainstalovat",
              close: "Zavřít oznámení"
            },
            ar: {
              title: "تثبيت كتطبيق محلي",
              badge: "موصى به · سرعة 10 أضعاف",
              desc: "ثبّت التطبيق على شاشتك الرئيسية للحصول على استجابة فورية بدون تأخير ودعم كامل دون اتصال.",
              cta: "تثبيت الآن",
              close: "إغلاق الإشعار"
            }
          };
          const c = pwaCopy[language] || pwaCopy.en;
          return (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full bg-[#0D0F12] border border-white/[0.08] p-4 rounded-2xl flex flex-col gap-2.5 relative overflow-hidden"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-cyan-neon/10 border border-cyan-neon/20 flex items-center justify-center text-cyan-neon shrink-0">
                    <Smartphone size={15} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-white text-xs font-black uppercase tracking-wider">
                      {c.title}
                    </span>
                    <span className="text-[9.3px] text-cyan-neon font-black uppercase tracking-widest mt-0.5">
                      {c.badge}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallBanner(false)}
                  aria-label={c.close}
                  className="w-9 h-9 -me-1.5 -mt-1.5 rounded-full flex items-center justify-center text-white hover:bg-white/[0.06] transition cursor-pointer shrink-0"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <p className="text-[11.6px] text-white leading-snug">
                {c.desc}
              </p>
              <button
                type="button"
                onClick={handleInstallClick}
                className="w-full py-2.5 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer text-center"
              >
                {c.cta}
              </button>
            </motion.div>
          );
        })()}

        {!isOnline && (
          <div className="bg-[#0D0F12] border border-yellow-gold/30 rounded-2xl p-3.5 flex flex-col gap-1.5">
            <span className="text-yellow-gold text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <AlertCircle size={14} className="shrink-0" />
              {language === "es" ? "Modo Desconectado" : "Offline Mode"}
            </span>
            <p className="text-[11.6px] text-white leading-snug">
              {language === "es" 
                ? "No tienes conexión a internet. Puedes ingresar usando tus credenciales guardadas previamente en este dispositivo." 
                : "No internet connection detected. You can sign in using credentials previously saved on this device."}
            </p>
          </div>
        )}

        <h2 className="text-white font-bold text-center text-[15.4px] tracking-wider uppercase">
          {t("loginTitle")}
        </h2>

        {error && (
          <div className="bg-white border border-white rounded-xl p-3.5 flex items-start gap-2.5 text-black font-bold text-xs whitespace-pre-line leading-relaxed text-start">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-black" />
            <span>{error}</span>
          </div>
        )}

        {resetSuccessMsg && (
          <div className="bg-cyan-neon/10 border border-cyan-neon/40 rounded-xl p-3.5 flex items-start gap-2.5 text-cyan-neon text-xs whitespace-pre-line leading-relaxed text-start">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-cyan-neon" />
            <span>{resetSuccessMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email field */}
          <div className="relative flex items-center">
            <span className="absolute start-4 text-white">
              <Mail size={18} />
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("emailPlaceholder")}
              className="w-full bg-[#0D0F12] border border-white/10 text-white placeholder-white text-sm ps-12 pe-4 py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200 caret-cyan-neon"
            />
          </div>

          {/* Password field */}
          <div className="relative flex items-center">
            <span className="absolute start-4 text-white">
              <Lock size={18} />
            </span>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full bg-[#0D0F12] border border-white/10 text-white placeholder-white text-sm ps-12 pe-12 py-3.5 rounded-xl outline-none focus:border-cyan-neon transition-all duration-200 caret-cyan-neon"
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

          <div className="flex justify-end -mt-2">
            <button
              type="button"
              onClick={handleOpenPasswordReset}
              className="min-h-[38px] px-1 inline-flex items-center text-[12.8px] text-cyan-neon hover:text-cyan-neon font-semibold hover:underline cursor-pointer"
            >
              {t("forgotPassword")}
            </button>
          </div>

          {/* Login button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full py-3.5 mt-2 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-widest transition-all duration-200 cursor-pointer flex justify-center items-center"
          >
            {loading ? t("loading") : t("loginBtn")}
          </motion.button>
          
          {isSocialBypassAvailable && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleBypassLogin}
              disabled={loading}
              className={`w-full py-3.5${
                language !== "es" ? " px-3 text-center leading-snug" : ""
              } rounded-xl bg-[#0D0F12] hover:bg-white/[0.04] text-cyan-neon font-black text-xs uppercase tracking-wider transition-all duration-200 cursor-pointer flex justify-center items-center gap-2 mt-2 border border-cyan-neon/30`}
            >
              <Unlock size={14} className={language !== "es" ? "shrink-0" : undefined} />
              <span>{tx("Ingresar en Modo Local (Sin Contraseña)", "Sign In Locally (Offline Session)")}</span>
            </motion.button>
          )}
        </form>

        {/* Register link */}
        <button
          type="button"
          onClick={onNavigateToRegister}
          className="min-h-[38px] flex items-center justify-center text-center text-xs text-yellow-gold font-semibold hover:underline cursor-pointer py-1"
        >
          {t("signUpLink")}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 py-2">
          <div className="h-[1px] flex-1 bg-gray-border" />
          <span className="text-xs text-white uppercase tracking-widest">{t("orDivider")}</span>
          <div className="h-[1px] flex-1 bg-gray-border" />
        </div>

        {/* Social login buttons (Google & Apple) */}
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSocialLogin("google")}
            className="w-full py-3.5 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-bold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            <svg aria-hidden="true" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>{t("googleLogin")}</span>
          </button>

          {!isAndroidNativeApp && (
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSocialLogin("apple")}
            className="w-full py-3.5 rounded-xl bg-[#0D1017] border border-white/[0.08] hover:border-white/20 text-white font-bold text-xs flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            <svg aria-hidden="true" className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            <span>{t("appleLogin")}</span>
          </button>
          )}
        </div>
      </div>

      {/* Password Recovery Modal */}
      <AnimatePresence>
        {showResetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              role="dialog"
              aria-modal="true"
              aria-label={tx("Recuperar Contraseña", "Reset Password")}
              className="w-full max-w-[360px] bg-[#0B0D12] border border-white/[0.08] p-6 rounded-3xl flex flex-col gap-4 relative shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-cyan-neon">
                    <KeyRound size={15} aria-hidden="true" />
                  </div>
                  <h3 className="text-white text-xs font-black uppercase tracking-wider">
                    {tx("Recuperar Contraseña", "Reset Password")}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  aria-label={tx("Cerrar ventana de recuperación", "Close password recovery dialog")}
                  className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] flex items-center justify-center text-white cursor-pointer shrink-0 transition"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <p className="text-xs text-white leading-relaxed">
                {tx(
                  "Ingresa el correo electrónico de tu cuenta y te enviaremos un enlace automático para crear o restablecer tu contraseña.",
                  "Enter your account email address and we will send you an automatic link to create or reset your password."
                )}
              </p>

              {resetModalError && (
                <div className="bg-white border border-white rounded-xl p-3 flex items-start gap-2 text-black font-bold text-xs leading-relaxed">
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-black" />
                  <span>{resetModalError}</span>
                </div>
              )}

              {resetModalSuccess ? (
                <div className="flex flex-col gap-4">
                  <div className="bg-cyan-neon/10 border border-cyan-neon/30 rounded-xl p-3.5 flex items-start gap-2.5 text-cyan-neon text-xs whitespace-pre-line leading-relaxed">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>{resetModalSuccess}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="w-full py-3 rounded-xl bg-white text-black font-black text-xs uppercase tracking-wider cursor-pointer text-center"
                  >
                    {tx("Entendido", "Got it")}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleConfirmPasswordReset} className="flex flex-col gap-3.5">
                  <div className="relative flex items-center">
                    <span className="absolute start-3.5 text-white">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder={tx("correo@ejemplo.com", "you@example.com")}
                      autoFocus
                      className="w-full bg-[#0D1017] border border-white/10 focus:border-cyan-neon text-white placeholder-white text-sm ps-10 pe-4 py-3 rounded-xl outline-none transition-all caret-cyan-neon"
                    />
                  </div>
                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white hover:text-white text-xs font-bold uppercase tracking-wider cursor-pointer text-center"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="flex-[1.5] py-3 rounded-xl bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider cursor-pointer text-center disabled:opacity-50"
                    >
                      {resetLoading ? tx("Enviando...", "Sending...") : tx("Enviar Enlace", "Send Link")}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer legal links & copyright */}
      <footer className="flex flex-col items-center gap-1.5 text-center text-[11.6px] text-white tracking-wider mt-8">
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href="/privacy"
            className="min-h-[38px] px-1.5 inline-flex items-center text-white/80 hover:text-cyan-neon underline underline-offset-4 transition-colors"
          >
            {t("privacyLink")}
          </a>
          <span aria-hidden="true" className="text-white/40">·</span>
          <a
            href="/terms"
            className="min-h-[38px] px-1.5 inline-flex items-center text-white/80 hover:text-cyan-neon underline underline-offset-4 transition-colors"
          >
            {t("termsLink")}
          </a>
        </div>
        <span>{t("copyright")}</span>
      </footer>

      {/* Mobile Browser Installation Steps Modal */}
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
              role="dialog"
              aria-modal="true"
              aria-label={tx("Instalación en Dispositivo Móvil", "Install on Mobile Device")}
              className="w-full max-w-[340px] bg-neutral-950 border border-neutral-800 p-5 rounded-[32px] flex flex-col gap-4 relative"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-white text-xs font-black uppercase tracking-wider">
                  {tx("Instalación en Dispositivo Móvil", "Install on Mobile Device")}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSModal(false)}
                  aria-label={tx("Cerrar guía de instalación", "Close installation guide")}
                  className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 flex items-center justify-center text-white cursor-pointer shrink-0 transition"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-col gap-3.5 text-xs text-white leading-relaxed">
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[11.6px] text-cyan-neon">
                    1
                  </div>
                  <p>
                    {tx("Abre esta app en", "Open this app in")}{" "}
                    <span className="text-white font-bold">{tx("el navegador", "your browser")}</span>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[11.6px] text-cyan-neon">
                    2
                  </div>
                  <p className="flex items-center gap-1.5 flex-wrap">
                    {tx("Presiona el botón de compartir", "Tap the share button")}
                    <span className="bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded text-[11.6px] text-white inline-flex items-center gap-1">
                      {t("share")} <Share size={10} />
                    </span>
                    {tx("abajo en la barra del sistema.", "in the bottom system bar.")}
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[11.6px] text-cyan-neon">
                    3
                  </div>
                  <p className="flex items-center gap-1.5 flex-wrap">
                    {tx("Desliza hacia abajo y pulsa", "Scroll down and tap")}
                    <span className="bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded text-[11.6px] text-white font-bold inline-flex items-center gap-1">
                      {tx("Añadir a pantalla de inicio", "Add to Home Screen")} <Plus size={10} />
                    </span>.
                  </p>
                </div>
                <div className="flex gap-2.5 items-start">
                  <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center font-black text-[11.6px] text-cyan-neon">
                    4
                  </div>
                  <p>
                    {tx("Presiona", "Tap")} <span className="text-white font-bold">{tx("Añadir", "Add")}</span>{" "}
                    {tx("arriba a la derecha. ¡Listo!", "in the top right corner. Done!")}
                  </p>
                </div>
              </div>

              <div className="bg-[#0D0F12] border border-cyan-neon/20 p-3 rounded-xl flex items-center justify-center text-center mt-2">
                <span className="text-[10.5px] text-cyan-neon font-medium leading-tight">
                  {tx(
                    "Una vez añadida, se descargará en local y cargará al instante cada vez que la abras.",
                    "Once added, it caches locally and loads instantly every time you open it."
                  )}
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
