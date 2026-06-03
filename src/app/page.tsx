"use client";

import React, { useState, useEffect } from "react";
import { getLoggedUser, UserProfile } from "@/lib/authService";
import LoginView from "@/components/auth/LoginView";
import RegisterView from "@/components/auth/RegisterView";
import DashboardView from "@/components/dashboard/DashboardView";
import FloatingNav from "@/components/ui/FloatingNav";
import Header from "@/components/ui/Header";

import SessionConfigView from "@/components/scoring/SessionConfigView";
import ScoringView from "@/components/scoring/ScoringView";
import HistoryView from "@/components/history/HistoryView";
import CalendarView from "@/components/calendar/CalendarView";
import ProfileView from "@/components/profile/ProfileView";
import SpotifyFloatingPlayer from "@/components/spotify/SpotifyFloatingPlayer";
import MatchplayLobbyView from "@/components/matchplay/MatchplayLobbyView";
import MatchplayGameView from "@/components/matchplay/MatchplayGameView";

import { motion, AnimatePresence } from "framer-motion";

// Ads & Admin Imports
import BannerWidget from "@/components/ads/BannerWidget";
import NotificationBar from "@/components/ads/NotificationBar";
import AdPopupOverlay from "@/components/ads/AdPopupOverlay";
import SuperAdminView from "@/components/admin/SuperAdminView";
import { AdCampaign } from "@/lib/db/adTypes";
import { startRealtimeSync, stopRealtimeSync } from "@/lib/db/realtimeSync";

// Screens that the authenticated user can access
type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA" | "ADMIN";


export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authScreen, setAuthScreen] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [currentScreen, setCurrentScreen] = useState<Screen>("HOME");
  const [coachViewMode, setCoachViewMode] = useState(false);
  const [sessionConfig, setSessionConfig] = useState<any | null>(null);
  const [duelConfig, setDuelConfig] = useState<any | null>(null);
  const [initialHistoryTab, setInitialHistoryTab] = useState<"SESSIONS" | "VOLUME">("SESSIONS");
  const [loading, setLoading] = useState(true);
  const [unlockedStar, setUnlockedStar] = useState<any | null>(null);

  // Ads campaigns state
  const [activePopup, setActivePopup] = useState<AdCampaign | null>(null);
  const [activeBanner, setActiveBanner] = useState<AdCampaign | null>(null);
  const [activeNotification, setActiveNotification] = useState<AdCampaign | null>(null);
  const [dbVersion, setDbVersion] = useState(0);

  // Check authentication status and initialize database on mount
  useEffect(() => {
    async function initApp() {
      try {
        // Seed default ad campaigns if none exist in local storage
        const { seedDemoAdCampaigns } = await import("@/lib/adManager");
        await seedDemoAdCampaigns();
      } catch (err) {
        console.error("Error seeding default ad campaigns:", err);
      }

      try {
        const loggedUser = await getLoggedUser();
        setUser(loggedUser);
      } catch (e) {
        console.error("Error reading authentication", e);
      } finally {
        setLoading(false);
      }
    }
    initApp();
  }, []);

  // Check active ad campaigns on screen, user, or local database change
  useEffect(() => {
    async function checkAds() {
      if (!user || (user.plan === "PRO" && user.role !== "superadmin") || currentScreen === "ADMIN") {
        setActivePopup(null);
        setActiveBanner(null);
        setActiveNotification(null);
        return;
      }
      try {
        const { getNextPopup, getActiveBannerCampaign, getActiveNotificationBar } = await import("@/lib/adManager");
        const popup = await getNextPopup(currentScreen, user.role, user.plan);
        const banner = await getActiveBannerCampaign(currentScreen, user.role, user.plan);
        const notif = await getActiveNotificationBar(currentScreen, user.role, user.plan);

         setActivePopup(popup);
         setActiveBanner(banner);
         setActiveNotification(notif);
      } catch (err) {
        console.error("Error checking active ads:", err);
      }
    }
    checkAds();
  }, [currentScreen, user, dbVersion]);

  // Start real-time Firestore synchronization when user is authenticated
  useEffect(() => {
    if (user) {
      startRealtimeSync(user.uid);
    } else {
      stopRealtimeSync();
    }
    return () => {
      stopRealtimeSync();
    };
  }, [user]);

  // Listen to visibilitychange to force Firestore network reconnection
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        console.log("[Firebase Reconnect] Tab focused. Reconnecting Firestore...");
        try {
          const { db, disableNetwork, enableNetwork } = await import("@/lib/firebase");
          await disableNetwork(db);
          await enableNetwork(db);
          console.log("[Firebase Reconnect] Firestore reconnected successfully.");
          const { runSync } = await import("@/lib/db/syncManager");
          runSync();
        } catch (err) {
          console.error("[Firebase Reconnect] Error during reconnect:", err);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Listen to database changes and user updates in real-time
  useEffect(() => {
    const handleUserUpdate = (e: any) => {
      if (e.detail?.user) {
        setUser(e.detail.user);
      }
    };

    const handleDbChange = (e: any) => {
      if (e.detail?.store === "ad_campaigns") {
        setDbVersion((prev) => prev + 1);
      }
    };

    const handleStarUnlocked = (e: any) => {
      setUnlockedStar(e.detail);
      // Trigger canvas-confetti burst dynamically
      import("canvas-confetti")
        .then((module) => {
          const confetti = module.default;
          confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 }
          });
        })
        .catch((err) => console.error("Confetti loading failed:", err));
    };

    window.addEventListener("current-user-updated", handleUserUpdate);
    window.addEventListener("local-db-change", handleDbChange);
    window.addEventListener("star-unlocked", handleStarUnlocked);

    return () => {
      window.removeEventListener("current-user-updated", handleUserUpdate);
      window.removeEventListener("local-db-change", handleDbChange);
      window.removeEventListener("star-unlocked", handleStarUnlocked);
    };
  }, []);

  // Load persistent font size and theme contrast from IndexedDB on mount
  useEffect(() => {
    async function loadFontSizeAndTheme() {
      try {
        const { getLocalSetting } = await import("@/lib/db/indexedDB");
        const savedSize = await getLocalSetting<string>("user_font_size", "large");
        const root = document.documentElement;
        
        // Scale root font size
        if (savedSize === "small") {
          root.style.fontSize = "18px";
        } else if (savedSize === "medium") {
          root.style.fontSize = "20px";
        } else {
          root.style.fontSize = "22px";
        }

        // Apply theme contrast
        const savedTheme = await getLocalSetting<string>("app_theme", "dark");
        if (savedTheme === "light") {
          root.classList.add("light-contrast");
        } else {
          root.classList.remove("light-contrast");
        }
      } catch (e) {
        console.error("Error loading font size and theme settings", e);
      }
    }
    loadFontSizeAndTheme();
  }, [user]);

  // Prevent accidental reload during active scoring sessions or matchplay duels
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Los datos no guardados se perderán. ¿Deseas salir?";
      return "Los datos no guardados se perderán. ¿Deseas salir?";
    };

    const isSessionActive = (currentScreen === "TARGET" && sessionConfig !== null) || currentScreen === "MATCHPLAY_ARENA";

    if (isSessionActive) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [currentScreen, sessionConfig]);

  const handleLoginSuccess = (loggedInUser: UserProfile) => {
    setUser(loggedInUser);
    setCurrentScreen("HOME");
  };

  const handleRegisterSuccess = (registeredUser: UserProfile) => {
    setUser(registeredUser);
    setCurrentScreen("HOME");
  };

  const handleLogout = () => {
    setUser(null);
    setAuthScreen("LOGIN");
    setSessionConfig(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black-oled text-cyan-neon font-black text-lg tracking-widest animate-pulse">
        ARCHERY 101010
      </div>
    );
  }

  // Not authenticated flow
  if (!user) {
    return authScreen === "LOGIN" ? (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        onNavigateToRegister={() => setAuthScreen("REGISTER")}
      />
    ) : (
      <RegisterView
        onRegisterSuccess={handleRegisterSuccess}
        onNavigateToLogin={() => setAuthScreen("LOGIN")}
      />
    );
  }

  // Redirect to full screen SuperAdmin panel
  if (currentScreen === "ADMIN") {
    return (
      <SuperAdminView 
        user={user} 
        onBack={() => setCurrentScreen("PROFILE")} 
      />
    );
  }

  // Calculate dynamic main padding top based on active ads and safe areas.
  const hasBanner = activeBanner !== null;
  const paddingTopStyle = hasBanner
    ? "calc(8rem + env(safe-area-inset-top))"
    : "calc(3.25rem + env(safe-area-inset-top))";

  // Authenticated application flow
  return (
    <div className="flex-1 flex flex-col min-h-full">
      {/* Top Header common to all screens */}
      <Header user={user} coachViewMode={coachViewMode} onToggleCoachViewMode={setCoachViewMode} />

      {/* Ads widgets */}
      <BannerWidget campaign={activeBanner} onSlideClick={() => {}} />
      <NotificationBar 
        campaign={activeNotification} 
        onClose={() => setActiveNotification(null)} 
      />

      {/* Screen Render Router */}
      <main 
        className="flex-1 overflow-y-auto pb-24 px-4" 
        style={{ paddingTop: paddingTopStyle }}
      >
        {currentScreen === "HOME" && (
          <DashboardView
            user={user}
            coachViewMode={coachViewMode}
            onNavigate={(screen, tab) => {
              if (tab) setInitialHistoryTab(tab);
              else setInitialHistoryTab("SESSIONS");
              setCurrentScreen(screen);
            }}
            onUserUpdate={setUser}
          />
        )}
        {currentScreen === "TARGET" && (
          !sessionConfig ? (
            <SessionConfigView
              user={user}
              onBack={() => setCurrentScreen("HOME")}
              onStartSession={(config) => setSessionConfig(config)}
            />
          ) : (
            <ScoringView
              user={user}
              config={sessionConfig}
              onBack={() => setSessionConfig(null)}
              onSessionSaved={() => {
                setSessionConfig(null);
                setCurrentScreen("HOME");
              }}
            />
          )
        )}
        {currentScreen === "MATCHPLAY_LOBBY" && (
          <MatchplayLobbyView
            user={user}
            onBack={() => setCurrentScreen("HOME")}
            onStartDuel={(config) => {
              setDuelConfig(config);
              setCurrentScreen("MATCHPLAY_ARENA");
            }}
          />
        )}
        {currentScreen === "MATCHPLAY_ARENA" && (
          <MatchplayGameView
            user={user}
            config={duelConfig}
            onBack={() => {
              setDuelConfig(null);
              setCurrentScreen("MATCHPLAY_LOBBY");
            }}
            onDuelSaved={() => {
              setDuelConfig(null);
              setCurrentScreen("HOME");
            }}
          />
        )}
        {currentScreen === "HISTORY" && (
          <HistoryView
            user={user}
            initialTab={initialHistoryTab}
            onBack={() => setCurrentScreen("HOME")}
          />
        )}
        {currentScreen === "CALENDAR" && (
          <CalendarView user={user} onBack={() => setCurrentScreen("HOME")} />
        )}
        {currentScreen === "PROFILE" && (
          <ProfileView
            user={user}
            onBack={() => setCurrentScreen("HOME")}
            onLogout={handleLogout}
            onProfileUpdated={(updated) => setUser(updated)}
            onNavigate={setCurrentScreen}
          />
        )}
      </main>

      {/* Popup Overlay */}
      {activePopup && (
        <AdPopupOverlay 
          campaign={activePopup} 
          onClose={() => setActivePopup(null)} 
          userId={user.uid} 
        />
      )}

      {/* Floating Bottom Navigation */}
      <FloatingNav
        activeScreen={currentScreen}
        onScreenChange={(screen) => {
          // Block coaches from accessing personal scoring sessions while in coach mode
          if (screen === "TARGET" && user?.role === "coach" && coachViewMode) return;
          setCurrentScreen(screen);
        }}
        user={user}
        coachViewMode={coachViewMode}
      />

      {/* Spotify Floating Player */}
      <SpotifyFloatingPlayer />

      {/* Star Unlock Celebrate Overlay Modal */}
      <AnimatePresence>
        {unlockedStar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-950 border border-yellow-gold/30 rounded-3xl p-6 w-full max-w-sm text-center relative shadow-[0_0_50px_rgba(255,229,0,0.15)] overflow-hidden"
            >
              {/* Animated rays or backdrop glow */}
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{ background: `radial-gradient(circle, ${unlockedStar.star.color} 0%, transparent 70%)` }}
              />

              <div className="relative z-10 flex flex-col items-center">
                {/* Colored Glowing Star Icon */}
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    rotate: [0, 15, -15, 0]
                  }}
                  transition={{ 
                    duration: 1.5,
                    repeat: Infinity,
                    repeatType: "reverse"
                  }}
                  className="w-20 h-20 flex items-center justify-center rounded-full bg-neutral-900 border border-white/10 shadow-lg text-4xl mb-4"
                  style={{ color: unlockedStar.star.color }}
                >
                  ★
                </motion.div>

                <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase block mb-1">
                  ¡NUEVA MARCA HISTÓRICA!
                </span>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  {unlockedStar.star.name}
                </h3>
                
                <div className="my-4 bg-neutral-900/60 border border-white/5 rounded-2xl px-4 py-3 w-full">
                  <span className="text-[9px] text-gray-dim uppercase font-bold block">
                    Puntuación Registrada
                  </span>
                  <span className="text-2xl font-black text-white block mt-0.5">
                    {unlockedStar.score} <span className="text-xs text-gray-dim">/ 720</span>
                  </span>
                  <span className="text-[9px] text-cyan-neon/70 uppercase font-black tracking-wider block mt-1">
                    {unlockedStar.bowType} · {unlockedStar.distance}m (72 flechas)
                  </span>
                </div>

                <p className="text-xs text-gray-dim leading-relaxed px-2">
                  ¡Felicitaciones {unlockedStar.userName}! Has logrado superar la marca mínima de {unlockedStar.star.minScore} puntos y desbloquear esta prestigiosa Estrella 101010.
                </p>

                <button
                  onClick={() => setUnlockedStar(null)}
                  className="mt-6 w-full py-3 bg-gradient-to-r from-yellow-gold to-amber-500 text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-glow-yellow hover:brightness-110 active:scale-95 transition"
                >
                  ¡Excelente! Aceptar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
