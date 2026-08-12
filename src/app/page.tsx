"use client";

import React, { useState, useEffect } from "react";
import { getLoggedUser, UserProfile } from "@/lib/authService";
import LoginView from "@/components/auth/LoginView";
import RegisterView from "@/components/auth/RegisterView";
import DashboardView from "@/components/dashboard/DashboardView";
import FloatingNav from "@/components/ui/FloatingNav";
import Header from "@/components/ui/Header";
import IntroScreen from "@/components/ui/IntroScreen";

import SessionConfigView from "@/components/scoring/SessionConfigView";
import ScoringView from "@/components/scoring/ScoringView";
import HistoryView from "@/components/history/HistoryView";
import CalendarView from "@/components/calendar/CalendarView";
import ProfileView from "@/components/profile/ProfileView";
import ProfileCompletionModal from "@/components/profile/ProfileCompletionModal";
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
  const [showIntro, setShowIntro] = useState(true);
  const [activeDraft, setActiveDraft] = useState<any | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Ads campaigns state
  const [activePopup, setActivePopup] = useState<AdCampaign | null>(null);
  const [activeBanner, setActiveBanner] = useState<AdCampaign | null>(null);
  const [activeNotification, setActiveNotification] = useState<AdCampaign | null>(null);
  const [dbVersion, setDbVersion] = useState(0);

  const [pendingInvitation, setPendingInvitation] = useState<any | null>(null);
  
  const mainRef = React.useRef<HTMLElement | null>(null);
  const bypassBeforeUnloadRef = React.useRef(false);

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
        
        // Helper to check for simulated/demo accounts
        const isDemoUser = (u: any) => {
          if (!u) return false;
          const name = (u.fullName || "").toLowerCase();
          const email = (u.email || "").toLowerCase();
          const uid = (u.uid || "").toLowerCase();
          return name.includes("demo") || 
                 name.includes("google-user") || 
                 name.includes("facebook-user") ||
                 email.includes("demo") || 
                 email.includes("google-user") || 
                 email.includes("facebook-user") ||
                 uid.includes("demo") ||
                 uid.includes("google-user") ||
                 uid.includes("facebook-user");
        };

        if (loggedUser && isDemoUser(loggedUser)) {
          console.warn("[Auth Startup] Demo account detected. Forcing clean logout:", loggedUser.email);
          const { logoutUser } = await import("@/lib/authService");
          await logoutUser();
          setUser(null);
        } else {
          setUser(loggedUser);
          if (loggedUser) {
            import("@/lib/pushNotifications").then(({ registerPushSilent }) => {
              registerPushSilent(loggedUser.uid);
            }).catch((err) => console.warn("Failed to load push notifications helper", err));
          }
        }

        // Clean up all mock/demo users from simulated_users to avoid listing or retaining them
        try {
          const { getLocalSetting, saveLocalSetting } = await import("@/lib/db/indexedDB");
          const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const cleanedUsers = localUsers.filter(u => !isDemoUser(u));
          if (localUsers.length !== cleanedUsers.length) {
            await saveLocalSetting("simulated_users", cleanedUsers);
            console.log("[Auth Startup] Cleaned mock/demo users from local database:", localUsers.length - cleanedUsers.length, "removed.");
          }
        } catch (e) {
          console.error("Error cleaning up local simulated users:", e);
        }
      } catch (e) {
        console.error("Error reading authentication", e);
      } finally {
        setLoading(false);
      }
    }
    initApp();
  }, []);
 
  // Periodic user presence heartbeat to mark user as online in Firestore (self-healing)
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    const updatePresence = async () => {
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        const docRef = doc(db, "users", uid);
        await setDoc(docRef, {
          lastActiveAt: Date.now()
        }, { merge: true });
      } catch (err) {
        // Silently catch offline/network errors
      }
    };

    updatePresence();
    const interval = setInterval(updatePresence, 25000);

    return () => clearInterval(interval);
  }, [user?.uid]);

  // Listen to visibilitychange to force instant cloud reconnection on wake/refocus
  useEffect(() => {
    if (!user?.uid) return;
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        console.log("[Presence] App visible/focused. Forcing Firestore network reconnection...");
        try {
          const { disableNetwork, enableNetwork } = await import("@/lib/firebase");
          const { db } = await import("@/lib/firebase");
          await disableNetwork(db);
          await enableNetwork(db);
          console.log("[Presence] Firestore network re-enabled successfully.");
          
          // Trigger immediate sync queue process
          const { runSync } = await import("@/lib/db/syncManager");
          runSync().catch((err) => console.error("Auto sync on visibility change failed:", err));
        } catch (err) {
          console.error("Error toggling network on visibility change:", err);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [user?.uid]);

  // Listen for "?join=..." invite code in the URL on startup or login
  useEffect(() => {
    if (!user?.uid) return;

    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");

    if (joinCode) {
      // Clear URL parameter so it doesn't try to join again if refreshed
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, document.title, url.pathname + url.search);

      const handleAutoJoin = async () => {
        const code = joinCode.toUpperCase().trim();
        try {
          const { doc, getDoc, updateDoc } = await import("firebase/firestore");
          const { db } = await import("@/lib/firebase");

          const docRef = doc(db, "active_duels", code);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();

            // Connect the player to this room in Firestore
            await updateDoc(docRef, {
              playerUid: user.uid,
              playerName: user.fullName,
              playerConnected: true,
              playerConnectedAt: Date.now(),
              status: "active",
              updatedAt: Date.now()
            });

            const matchConfig = {
              id: data.id,
              bowType: data.bowType,
              distance: data.distance,
              system: data.bowType === "Compound" ? "cumulative" : "set",
              isCreator: false,
              rival: {
                uid: "RIV-FRIEND-CREATOR",
                fullName: data.creatorName || "Anfitrión del Duelo",
                country: data.creatorCountry || "CR",
                clubName: "Lobby Archery",
                clubLogo: "1",
                clubCountry: "CR",
                rating: 9.2
              }
            };

            setDuelConfig(matchConfig);
            setCurrentScreen("MATCHPLAY_ARENA");
          } else {
            alert(`El código de desafío "${code}" no existe o es inválido.`);
          }
        } catch (err) {
          console.error("Error joining duel from URL parameter:", err);
          alert("No se pudo conectar al desafío automáticamente. Intenta ingresar el código manual.");
        }
      };

      handleAutoJoin();
    }
  }, [user?.uid]);

  // Listen for real-time duel invitations directed to the logged-in user
  useEffect(() => {
    if (!user?.uid) return;
    const currentUid = user.uid;

    let unsubscribe: () => void = () => {};

    async function initInviteListener() {
      try {
        const { collection, query, where, onSnapshot } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");

        const q = query(
          collection(db, "duel_invitations"),
          where("receiverUid", "==", currentUid),
          where("status", "==", "pending")
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          snapshot.forEach((snap) => {
            const data = snap.data();
            // Show pending invitation modal
            setPendingInvitation({
              id: snap.id,
              ...data
            });
          });
        });
      } catch (err) {
        console.error("Error setting up real-time duel invitation listener:", err);
      }
    }

    initInviteListener();

    return () => {
      unsubscribe();
    };
  }, [user?.uid]);

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
  }, [currentScreen, user?.uid, user?.role, user?.plan, dbVersion]);

  // Start real-time Firestore synchronization when user is authenticated
  useEffect(() => {
    if (user?.uid) {
      startRealtimeSync(user.uid);
    } else {
      stopRealtimeSync();
    }
    return () => {
      stopRealtimeSync();
    };
  }, [user?.uid]);

  // Check for active session draft in IndexedDB when user is loaded
  useEffect(() => {
    async function checkForDrafts() {
      if (!user?.uid) {
        setActiveDraft(null);
        return;
      }
      try {
        const { getLocalSessions } = await import("@/lib/db/indexedDB");
        const localSessions = await getLocalSessions();
        const draft = localSessions.find((s) => s.userId === user.uid && s.isDraft === true);
        if (draft) {
          console.log("[Persistence] Active draft found:", draft);
          setActiveDraft(draft);
        }
      } catch (err) {
        console.error("Error checking for drafts:", err);
      }
    }
    checkForDrafts();
  }, [user?.uid]);

  // Check for restored sessions by coach to show notification
  useEffect(() => {
    if (!user?.uid) return;
    const userUid = user.uid;
    
    async function checkForRestoredSessions() {
      try {
        const { getLocalSessions, saveLocalSession, addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
        const { runSync } = await import("@/lib/db/syncManager");
        const list = await getLocalSessions();
        
        // Find sessions restored by coach that belong to this user
        const restored = list.filter(s => s.userId === userUid && s.restoredByCoach === true);
        
        for (const session of restored) {
          // Notify the user
          alert(`Tu coach ha restituido tu entrenamiento de ${session.format} (${session.distance}m) del ${new Date(session.timestamp).toLocaleDateString()}.`);
          
          // Clear restoredByCoach flag so the alert doesn't show again
          const updatedSession = { ...session, restoredByCoach: false };
          await saveLocalSession(session.id, updatedSession);
          
          // Sync update to Firestore
          await addToSyncQueue({
            id: generateResilientId("TXN"),
            collection: "sessions",
            operation: "UPDATE",
            payloadId: session.id,
            payload: updatedSession,
            timestamp: Date.now()
          });
        }
        
        if (restored.length > 0) {
          runSync();
        }
      } catch (err) {
        console.error("Error checking for restored sessions:", err);
      }
    }

    checkForRestoredSessions();
    
    const handleDbChange = (e: any) => {
      if (e.detail?.store === "sessions_local") {
        checkForRestoredSessions();
      }
    };
    
    window.addEventListener("local-db-change", handleDbChange);
    return () => {
      window.removeEventListener("local-db-change", handleDbChange);
    };
  }, [user?.uid]);

  // Listen to visibilitychange to force Firestore network reconnection and update presence
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!user?.uid) return;
      const uid = user.uid;

      if (document.visibilityState === "visible") {
        console.log("[Firebase Reconnect] Tab focused. Reconnecting Firestore...");
        try {
          const { db, disableNetwork, enableNetwork } = await import("@/lib/firebase");
          await disableNetwork(db);
          await enableNetwork(db);
          console.log("[Firebase Reconnect] Firestore reconnected successfully.");
          const { runSync } = await import("@/lib/db/syncManager");
          runSync();

          // Set presence online immediately
          const { doc, setDoc } = await import("firebase/firestore");
          await setDoc(doc(db, "users", uid), {
            lastActiveAt: Date.now()
          }, { merge: true });
        } catch (err) {
          console.error("[Firebase Reconnect] Error during reconnect:", err);
        }
      } else if (document.visibilityState === "hidden") {
        // Tab closed or minimized: set presence offline immediately
        // BUT skip if the user is in the middle of a Matchplay duel
        if (currentScreen === "MATCHPLAY_ARENA") {
          console.log("[Presence] Tab hidden during active duel. Preserving online presence.");
          return;
        }
        try {
          const { db } = await import("@/lib/firebase");
          const { doc, setDoc } = await import("firebase/firestore");
          await setDoc(doc(db, "users", uid), {
            lastActiveAt: 0
          }, { merge: true });
          console.log("[Presence] Tab hidden. Presence set to offline.");
        } catch (err) {
          // Silently catch errors
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user?.uid, currentScreen]);

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
  }, [user?.uid]);

  // Prevent accidental reload whenever a user session is active
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassBeforeUnloadRef.current) return;
      e.preventDefault();
      e.returnValue = "¿Seguro que deseas salir o recargar la página?";
      return "¿Seguro que deseas salir o recargar la página?";
    };

    if (user !== null) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [user?.uid]);

  const handleLoginSuccess = (loggedInUser: UserProfile) => {
    setUser(loggedInUser);
    setCurrentScreen("HOME");
  };

  const handleRegisterSuccess = (registeredUser: UserProfile) => {
    setUser(registeredUser);
    setCurrentScreen("HOME");
  };

  const handleLogout = async () => {
    if (user?.uid) {
      try {
        const { doc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");
        await setDoc(doc(db, "users", user.uid), {
          lastActiveAt: 0
        }, { merge: true });
      } catch (err) {
        console.warn("Failed to clean up presence on logout:", err);
      }
    }
    setUser(null);
    setAuthScreen("LOGIN");
    setSessionConfig(null);
  };

  const resumeSession = (draft: any) => {
    const configToLoad = {
      ...draft,
      draftId: draft.id // ensure draftId is set
    };
    setSessionConfig(configToLoad);
    setCurrentScreen("TARGET");
    setActiveDraft(null);
  };

  const handleDiscardDraft = async () => {
    if (activeDraft) {
      try {
        const { deleteLocalSession } = await import("@/lib/db/indexedDB");
        await deleteLocalSession(activeDraft.id);
        console.log("[Persistence] Draft discarded:", activeDraft.id);
        setActiveDraft(null);
        setShowDiscardConfirm(false);
      } catch (err) {
        console.error("Error discarding draft:", err);
      }
    }
  };

  if (showIntro) {
    return <IntroScreen onComplete={() => setShowIntro(false)} />;
  }

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
      <AnimatePresence>
        {activeBanner && (
          <BannerWidget 
            campaign={activeBanner} 
            onSlideClick={() => {}} 
            onClose={() => setActiveBanner(null)} 
            showCloseButton={user?.plan === "PRO"}
          />
        )}
      </AnimatePresence>
      <NotificationBar 
        campaign={activeNotification} 
        onClose={() => setActiveNotification(null)} 
      />

      {/* Screen Router Container */}
      <main 
        ref={mainRef}
        className="flex-1 overflow-y-auto pb-24 px-4 transition-[padding-top] duration-300 ease-in-out relative" 
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

      {/* Active Session Recovery Modal */}
      <AnimatePresence>
        {activeDraft && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-950 border border-cyan-neon/30 rounded-3xl p-6 w-full max-w-sm text-center relative shadow-[0_0_50px_rgba(0,229,255,0.15)] overflow-hidden"
            >
              {/* Radial gradient background light */}
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{ background: "radial-gradient(circle, #00E5FF 0%, transparent 70%)" }}
              />

              <div className="relative z-10 flex flex-col items-center">
                {/* Glowing Target icon */}
                <div className="w-16 h-16 flex items-center justify-center rounded-full bg-neutral-900 border border-cyan-neon/20 shadow-lg text-3xl mb-4 text-cyan-neon animate-pulse">
                  🎯
                </div>

                {!showDiscardConfirm ? (
                  <>
                    <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase block mb-1">
                      ¡SESIÓN PENDIENTE DETECTADA!
                    </span>
                    <h3 className="text-white text-lg font-black uppercase tracking-wide">
                      ¿Reanudar Entrenamiento?
                    </h3>
                    
                    <div className="my-4 bg-neutral-900/60 border border-white/5 rounded-2xl px-4 py-3 w-full text-left">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                        <span className="text-[10px] text-gray-dim uppercase font-bold">Formato WA</span>
                        <span className="text-xs font-black text-white">{activeDraft.format} · {activeDraft.distance}m</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                        <span className="text-[10px] text-gray-dim uppercase font-bold">Puntuación</span>
                        <span className="text-xs font-black text-cyan-neon">{activeDraft.score} pts</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                        <span className="text-[10px] text-gray-dim uppercase font-bold">Progreso</span>
                        <span className="text-xs font-black text-white">
                          {(() => {
                            const shotCount = activeDraft.ends.reduce((sum: number, e: any) => sum + e.arrows.filter((a: string) => a !== "").length, 0);
                            const total = activeDraft.endsCount * activeDraft.arrowsPerEnd;
                            return `${shotCount} / ${total} flechas`;
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-gray-dim uppercase font-bold">Guardado</span>
                        <span className="text-[10px] text-gray-dim font-medium">
                          {activeDraft.timestamp ? (
                            (() => {
                              const date = new Date(activeDraft.timestamp);
                              return isNaN(date.getTime()) ? "Fecha N/A" : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                            })()
                          ) : "Fecha N/A"}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-gray-dim leading-relaxed px-2">
                      Tienes un borrador de sesión guardado. ¿Deseas continuar registrando tus tiros donde lo dejaste?
                    </p>

                    <div className="mt-6 flex flex-col gap-2 w-full">
                      <button
                        onClick={() => resumeSession(activeDraft)}
                        className="w-full py-3 bg-gradient-to-r from-cyan-brand to-cyan-neon text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-glow-cyan hover:brightness-110 active:scale-95 transition"
                      >
                        Reanudar Entrenamiento
                      </button>
                      <button
                        onClick={() => setShowDiscardConfirm(true)}
                        className="w-full py-3 bg-neutral-900 border border-white/10 text-red-rival font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:bg-neutral-800 transition"
                      >
                        Descartar Borrador
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] text-red-rival font-black tracking-widest uppercase block mb-1">
                      ⚠️ CONFIRMACIÓN DE DESCARTE
                    </span>
                    <h3 className="text-white text-lg font-black uppercase tracking-wide">
                      ¿Descartar Borrador?
                    </h3>
                    
                    <p className="text-xs text-gray-dim leading-relaxed px-2 my-4">
                      Esta action es irreversible y se perderán todos los tiros registrados en esta sesión de entrenamiento. ¿Estás completamente seguro?
                    </p>

                    <div className="mt-4 flex flex-col gap-2 w-full">
                      <button
                        onClick={handleDiscardDraft}
                        className="w-full py-3 bg-red-rival text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:bg-red-700 transition"
                      >
                        Sí, Descartar Permanentemente
                      </button>
                      <button
                        onClick={() => setShowDiscardConfirm(false)}
                        className="w-full py-3 bg-neutral-900 border border-white/10 text-gray-dim font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:text-white transition"
                      >
                        No, Volver Atrás
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Blocking Profile Completion Modal */}
      {user && (!user.nickname?.trim() || !user.fullName?.trim() || !user.birthDate || !user.city?.trim() || !user.country || !user.gender) && (
        <ProfileCompletionModal
          user={user}
          onComplete={(updatedUser) => setUser(updatedUser)}
        />
      )}

      {/* Invitation Challenge Modal */}
      <AnimatePresence>
        {pendingInvitation && (
          <div className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-[340px] bg-neutral-950 border border-purple-500/30 p-6 rounded-[36px] flex flex-col gap-4 text-center shadow-[0_0_50px_rgba(168,85,247,0.15)] relative overflow-hidden"
            >
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-purple-600 to-indigo-600" />
              
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto mt-2 animate-pulse">
                🏆
              </div>

              <div className="flex flex-col gap-1.5 mt-2">
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  ¡Reto Recibido!
                </h3>
                <p className="text-xs text-gray-dim leading-relaxed">
                  <strong>{pendingInvitation.senderName}</strong> te ha desafiado a un duelo de <strong>{pendingInvitation.bowType}</strong> a <strong>{pendingInvitation.distance}m</strong>.
                </p>
              </div>

              <div className="flex flex-col gap-2.5 mt-4">
                <button
                  onClick={async () => {
                    try {
                      const { doc, updateDoc } = await import("firebase/firestore");
                      const { db } = await import("@/lib/firebase");
                      // Accept the challenge
                      const inviteRef = doc(db, "duel_invitations", pendingInvitation.id);
                      await updateDoc(inviteRef, { status: "accepted" });
                      
                      // Also join the duel room in Firestore
                      const duelRef = doc(db, "active_duels", pendingInvitation.roomCode);
                      await updateDoc(duelRef, {
                        playerUid: user.uid,
                        playerName: user.fullName,
                        playerConnected: true,
                        playerConnectedAt: Date.now(),
                        status: "active",
                        updatedAt: Date.now()
                      });

                      // Setup match configuration for Arena
                      const matchConfig = {
                        id: pendingInvitation.roomCode,
                        bowType: pendingInvitation.bowType,
                        distance: pendingInvitation.distance,
                        system: pendingInvitation.bowType === "Compound" ? "cumulative" : "set",
                        isCreator: false,
                        rival: {
                          uid: pendingInvitation.senderUid,
                          fullName: pendingInvitation.senderName,
                          country: "CR",
                          clubName: "Oponente en Línea",
                          clubLogo: "0",
                          clubCountry: "CR",
                          rating: 9.0
                        }
                      };

                      setPendingInvitation(null);
                      setDuelConfig(matchConfig);
                      setCurrentScreen("MATCHPLAY_ARENA");
                    } catch (err) {
                      console.error("Error accepting duel invite:", err);
                      setPendingInvitation(null);
                    }
                  }}
                  className="w-full py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer shadow-glow-purple hover:brightness-110 active:scale-95 transition"
                >
                  Aceptar Desafío
                </button>
                <button
                  onClick={async () => {
                    try {
                      const { doc, updateDoc } = await import("firebase/firestore");
                      const { db } = await import("@/lib/firebase");
                      const inviteRef = doc(db, "duel_invitations", pendingInvitation.id);
                      await updateDoc(inviteRef, { status: "rejected" });
                    } catch (err) {
                      console.error("Error rejecting duel invite:", err);
                    } finally {
                      setPendingInvitation(null);
                    }
                  }}
                  className="w-full py-3 bg-neutral-900 border border-white/5 text-gray-dim font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:text-white transition"
                >
                  Rechazar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
