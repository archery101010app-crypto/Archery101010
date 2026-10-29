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
import AcousticChronographView from "@/components/tools/AcousticChronographView";
import CoachPaymentModal from "@/components/subscription/CoachPaymentModal";

import { motion, AnimatePresence } from "framer-motion";

// Ads & Admin Imports
import BannerWidget from "@/components/ads/BannerWidget";
import NotificationBar from "@/components/ads/NotificationBar";
import AdPopupOverlay from "@/components/ads/AdPopupOverlay";
import SuperAdminView from "@/components/admin/SuperAdminView";
import { AdCampaign } from "@/lib/db/adTypes";
import { startRealtimeSync, stopRealtimeSync } from "@/lib/db/realtimeSync";
import { initMobileBackNavigation, registerModalDismiss } from "@/lib/navigation/backNavigation";

// Screens that the authenticated user can access
type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA" | "ADMIN" | "CHRONOGRAPH";


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
  const [dismissedProfileModal, setDismissedProfileModal] = useState(false);

  // Ads campaigns state
  const [activePopup, setActivePopup] = useState<AdCampaign | null>(null);
  const [activeBanner, setActiveBanner] = useState<AdCampaign | null>(null);
  const [activeNotification, setActiveNotification] = useState<AdCampaign | null>(null);
  const [dbVersion, setDbVersion] = useState(0);

  const [pendingInvitation, setPendingInvitation] = useState<any | null>(null);
  const [backToast, setBackToast] = useState<string | null>(null);
  const [showCoachPaymentModal, setShowCoachPaymentModal] = useState<boolean>(false);

  const mainRef = React.useRef<HTMLElement | null>(null);
  const bypassBeforeUnloadRef = React.useRef(false);
  const currentScreenRef = React.useRef<Screen>(currentScreen);

  useEffect(() => {
    currentScreenRef.current = currentScreen;
    // Push history state on screen navigation so iOS/Android edge-swipe pops cleanly to previous screen
    if (typeof window !== "undefined" && currentScreen !== "HOME") {
      try {
        window.history.pushState({ screen: currentScreen }, "");
      } catch {
        // ignore
      }
    }
  }, [currentScreen]);

  // Mobile Back Navigation (Android hardware button & Apple iOS / Android edge-swipe)
  useEffect(() => {
    const cleanup = initMobileBackNavigation({
      getCurrentScreen: () => currentScreenRef.current,
      onNavigateHome: () => {
        if (currentScreenRef.current !== "HOME") {
          setCurrentScreen("HOME");
        }
      },
      showToast: (msg) => {
        setBackToast(msg);
        setTimeout(() => setBackToast(null), 2200);
      }
    });

    return () => cleanup();
  }, []);

  // Register modal dismissals so back gesture closes modals first
  useEffect(() => {
    if (pendingInvitation) {
      return registerModalDismiss(() => setPendingInvitation(null));
    }
  }, [pendingInvitation]);

  useEffect(() => {
    if (showDiscardConfirm) {
      return registerModalDismiss(() => setShowDiscardConfirm(false));
    }
  }, [showDiscardConfirm]);

  useEffect(() => {
    if (activePopup) {
      return registerModalDismiss(() => setActivePopup(null));
    }
  }, [activePopup]);

  useEffect(() => {
    if (unlockedStar) {
      return registerModalDismiss(() => setUnlockedStar(null));
    }
  }, [unlockedStar]);

  useEffect(() => {
    if (user && !dismissedProfileModal && (!user.fullName?.trim() || !user.birthDate || !user.country || !user.gender)) {
      return registerModalDismiss(() => {
        handleReturnToLoginFromProfile();
      });
    }
  }, [user, dismissedProfileModal]);

  useEffect(() => {
    if (showCoachPaymentModal) {
      return registerModalDismiss(() => setShowCoachPaymentModal(false));
    }
  }, [showCoachPaymentModal]);

  useEffect(() => {
    const handleOpenPay = () => setShowCoachPaymentModal(true);
    window.addEventListener("open-coach-payment", handleOpenPay);
    return () => window.removeEventListener("open-coach-payment", handleOpenPay);
  }, []);

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
        
        // Helper to check for simulated/demo or legacy non-Firebase-Auth accounts
        const isLegacyOrDemoUser = (u: any) => {
          if (!u) return false;
          const email = (u.email || "").trim().toLowerCase();
          const uid = String(u.uid || "");
          const uidLower = uid.toLowerCase();
          const isSyntheticLegacyUid = uid.startsWith("USR-") && uid !== "USR-GUEST-OFFLINE";
          const hasPlaintextPassword = typeof u.password === "string" && u.password.length > 0;
          const isMockEmail =
            email === "demo@archery101010.com" ||
            email === "google-user@archery101010.com" ||
            email === "facebook-user@archery101010.com";
          return (
            isSyntheticLegacyUid ||
            hasPlaintextPassword ||
            isMockEmail ||
            uidLower === "usr-demo" ||
            uidLower.includes("google-user") ||
            uidLower.includes("facebook-user")
          );
        };

        // Helper to check for incomplete registration that was abandoned or never finished
        const isIncompleteUser = (u: any) => {
          if (!u) return false;
          // Must have an email and a valid fullName & birthDate to be considered an established user session
          return !u.email || !u.fullName?.trim() || !u.birthDate;
        };

        if (loggedUser && (isLegacyOrDemoUser(loggedUser) || isIncompleteUser(loggedUser))) {
          console.warn("[Auth Startup] Incomplete or legacy account detected. Forcing clean logout to Login:", loggedUser.email);
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

        // Clean up all mock/demo/legacy users from simulated_users and stale sync queue items
        try {
          const { getLocalSetting, saveLocalSetting, getSyncQueue, removeFromSyncQueue } = await import("@/lib/db/indexedDB");
          const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
          const cleanedUsers = localUsers.filter(u => !isLegacyOrDemoUser(u));
          if (localUsers.length !== cleanedUsers.length) {
            await saveLocalSetting("simulated_users", cleanedUsers);
            console.log("[Auth Startup] Cleaned legacy/fictitious users from local database:", localUsers.length - cleanedUsers.length, "removed.");
          }
          const queue = await getSyncQueue();
          for (const item of queue) {
            if (item.collection === "users" && (String(item.payloadId || "").startsWith("USR-") || item.payload?.password)) {
              await removeFromSyncQueue(item.id);
            }
          }

          // Clean up any legacy demo macrocycles/events referencing "Indoor 2026" or "offline mode active"
          const { getLocalMacrocycles, deleteLocalMacrocycle, getLocalEvents, deleteLocalEvent, saveLocalEvent } = await import("@/lib/db/indexedDB");
          const macros = await getLocalMacrocycles();
          for (const m of macros) {
            const mName = (m.name || "").toLowerCase();
            if (m.id === "MAC-DEMO-1" || 
                mName.includes("indoor 2026") || 
                mName.includes("preparación indoor") ||
                mName.includes("preparacion indoor") ||
                mName.includes("offline mode active") ||
                mName.includes("connect to the internet")) {
              await deleteLocalMacrocycle(m.id);
            }
          }
          const events = await getLocalEvents();
          for (const ev of events) {
            const fullDesc = `${ev.title || ""} ${ev.description || ""} ${ev.coachNotes || ""} ${ev.phaseName || ""}`.toLowerCase();
            if (ev.macrocycleId === "MAC-DEMO-1" || 
                fullDesc.includes("indoor 2026") || 
                fullDesc.includes("preparación indoor") ||
                fullDesc.includes("preparacion indoor") ||
                fullDesc.includes("offline mode active") ||
                fullDesc.includes("connect to the internet")) {
              await deleteLocalEvent(ev.id);
            } else {
              // Limpiar textos de enfoque e indicaciones inventados previamente
              let changed = false;
              if (ev.focusPoints && ev.focusPoints.length > 0) {
                const cleaned = ev.focusPoints.filter((pt) => {
                  const ptl = pt.toLowerCase();
                  return !(
                    ptl.includes("ejecución técnica") ||
                    ptl.includes("ejecucion tecnica") ||
                    ptl.includes("postura de tiro") ||
                    ptl.includes("ritmo y respiración") ||
                    ptl.includes("ritmo y respiracion") ||
                    ptl.includes("cumplimiento del objetivo asignado") ||
                    ptl.includes("descanso neuromuscular") ||
                    ptl.includes("estiramiento ligero") ||
                    ptl.includes("consistencia técnica") ||
                    ptl.includes("consistencia tecnica") ||
                    ptl.includes("postura olímpica") ||
                    ptl.includes("postura olimpica") ||
                    ptl.includes("ritmo constante por flecha")
                  );
                });
                if (cleaned.length !== ev.focusPoints.length) {
                  ev.focusPoints = cleaned;
                  changed = true;
                }
              }

              if (ev.coachNotes) {
                const cnl = ev.coachNotes.toLowerCase();
                if (
                  cnl.includes("postura olímpica y ritmo constante") ||
                  cnl.includes("postura olimpica y ritmo constante") ||
                  cnl.includes("asimilar las cargas de tiro") ||
                  (cnl.includes("cumplir las") && cnl.includes("flechas asignadas"))
                ) {
                  ev.coachNotes = "";
                  changed = true;
                }
              }

              if (ev.description) {
                const dsl = ev.description.toLowerCase();
                if (
                  dsl.includes("asignación del entrenador para la etapa") ||
                  dsl.includes("asignacion del entrenador para la etapa") ||
                  dsl.includes("día de recuperación física y neuromuscular") ||
                  dsl.includes("dia de recuperacion fisica y neuromuscular")
                ) {
                  ev.description = "";
                  changed = true;
                }
              }

              if (changed) {
                await saveLocalEvent(ev.id, ev);
              }
            }
          }
        } catch (e) {
          console.error("Error cleaning up local simulated users and legacy cycles:", e);
        }
      } catch (e) {
        console.error("Error reading authentication", e);
      } finally {
        setLoading(false);
        // Configure Native Capacitor StatusBar and hide SplashScreen
        if (typeof window !== "undefined") {
          import("@capacitor/core").then(async ({ Capacitor }) => {
            if (Capacitor.isNativePlatform()) {
              try {
                const { StatusBar, Style } = await import("@capacitor/status-bar");
                await StatusBar.setStyle({ style: Style.Dark });
                await StatusBar.setBackgroundColor({ color: "#050505" });
              } catch (_) {}
              try {
                const { SplashScreen } = await import("@capacitor/splash-screen");
                await SplashScreen.hide();
              } catch (_) {}
            }
          }).catch(() => {});
        }
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

  // Load persistent theme contrast from IndexedDB on mount
  useEffect(() => {
    async function loadTheme() {
      try {
        const { getLocalSetting } = await import("@/lib/db/indexedDB");
        const root = document.documentElement;
        root.style.fontSize = ""; // Reset custom font scaling to let OS/browser handle text naturally

        // Apply theme contrast
        const savedTheme = await getLocalSetting<string>("app_theme", "dark");
        if (savedTheme === "light") {
          root.classList.add("light-contrast");
        } else {
          root.classList.remove("light-contrast");
        }
      } catch (e) {
        console.error("Error loading theme settings", e);
      }
    }
    loadTheme();
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
    setDismissedProfileModal(false);
  };

  const handleRegisterSuccess = (registeredUser: UserProfile) => {
    setUser(registeredUser);
    setCurrentScreen("HOME");
    setDismissedProfileModal(false);
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
    try {
      const { logoutUser } = await import("@/lib/authService");
      await logoutUser();
    } catch (err) {
      console.warn("Failed to logout cleanly:", err);
    }
    setUser(null);
    setAuthScreen("LOGIN");
    setSessionConfig(null);
    setDismissedProfileModal(false);
  };

  const handleReturnToLoginFromProfile = async () => {
    await handleLogout();
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
    ? "calc(8.5rem + env(safe-area-inset-top))"
    : "calc(4.75rem + env(safe-area-inset-top))";

  const handleToggleCoachViewMode = (val: boolean) => {
    if (val) {
      // Show Coach PRO payment and subscription modal
      setShowCoachPaymentModal(true);
      return;
    }
    setCoachViewMode(false);
  };

  const handleCoachPaymentSuccess = (updatedUser: UserProfile) => {
    setUser(updatedUser);
    setCoachViewMode(true);
    setCurrentScreen("HOME");
    setShowCoachPaymentModal(false);
  };

  // Authenticated application flow
  return (
    <div className="flex-1 flex flex-col min-h-full w-full max-w-full overflow-x-hidden">
      {/* Top Header common to all screens */}
      <Header user={user} coachViewMode={coachViewMode} onToggleCoachViewMode={handleToggleCoachViewMode} />

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
        className="flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full pb-28 px-3.5 sm:px-5 transition-[padding-top] duration-300 ease-in-out relative" 
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
          <CalendarView
            user={user}
            onBack={() => setCurrentScreen("HOME")}
            onNavigate={(screen) => setCurrentScreen(screen)}
            coachViewMode={coachViewMode}
          />
        )}
        {currentScreen === "CHRONOGRAPH" && (
          <AcousticChronographView
            user={user}
            onBack={() => setCurrentScreen("HOME")}
          />
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
          // Block coaches from personal scoring sheets, chronograph, and duels while in coach mode
          if (coachViewMode && (screen === "TARGET" || screen === "CHRONOGRAPH" || screen === "MATCHPLAY_LOBBY" || screen === "MATCHPLAY_ARENA")) {
            setCurrentScreen("HOME");
            return;
          }
          setCurrentScreen(screen);
        }}
        user={user}
        coachViewMode={coachViewMode}
      />

      {/* Spotify Floating Player */}
      <SpotifyFloatingPlayer
        showSideTab={
          !coachViewMode &&
          (currentScreen === "HOME" ||
            currentScreen === "TARGET" ||
            currentScreen === "CALENDAR" ||
            currentScreen === "HISTORY" ||
            currentScreen === "CHRONOGRAPH")
        }
      />

      {/* Star Unlock Celebrate Overlay Modal */}
      <AnimatePresence>
        {unlockedStar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0B0E14] border border-yellow-gold/30 rounded-3xl p-6 w-full max-w-sm text-center relative shadow-2xl overflow-hidden"
            >
              <div className="relative z-10 flex flex-col items-center">
                <div
                  className="w-16 h-16 flex items-center justify-center rounded-2xl bg-[#111620] border border-white/10 text-3xl mb-4"
                  style={{ color: unlockedStar.star.color }}
                >
                  ★
                </div>

                <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase block mb-1">
                  NUEVA MARCA HISTÓRICA
                </span>
                <h3 className="text-white text-lg font-black uppercase tracking-wide">
                  {unlockedStar.star.name}
                </h3>
                
                <div className="my-4 bg-[#111620] border border-white/[0.07] rounded-2xl px-4 py-3 w-full">
                  <span className="text-[9px] text-white uppercase font-bold block">
                    Puntuación Registrada
                  </span>
                  <span className="text-2xl font-black text-white block mt-0.5 tabular-nums">
                    {unlockedStar.score} <span className="text-xs text-white">/ 720</span>
                  </span>
                  <span className="text-[9px] text-cyan-neon uppercase font-black tracking-wider block mt-1">
                    {unlockedStar.bowType === "Recurve" ? "Recurvo" : unlockedStar.bowType === "Compound" ? "Compuesto" : unlockedStar.bowType} · {unlockedStar.distance} m (72 flechas)
                  </span>
                </div>

                <p className="text-xs text-white leading-relaxed px-2 [text-wrap:pretty]">
                  Felicitaciones, {unlockedStar.userName}. Has superado la marca mínima de {unlockedStar.star.minScore} puntos y desbloqueado esta Estrella 101010.
                </p>

                <button
                  onClick={() => setUnlockedStar(null)}
                  className="mt-6 w-full h-11 bg-yellow-gold hover:brightness-105 text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition flex items-center justify-center"
                >
                  Continuar
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
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0B0E14] border border-white/[0.1] rounded-3xl p-6 w-full max-w-sm text-center relative shadow-2xl overflow-hidden"
            >
              <div className="relative z-10 flex flex-col items-center">
                {!showDiscardConfirm ? (
                  <>
                    <span className="text-[10px] text-cyan-neon font-black tracking-widest uppercase block mb-1">
                      SESIÓN EN PAUSA
                    </span>
                    <h3 className="text-white text-lg font-black uppercase tracking-wide">
                      ¿Reanudar Entrenamiento?
                    </h3>
                    
                    <div className="my-4 bg-[#111620] border border-white/[0.07] rounded-2xl px-4 py-3 w-full text-left">
                      <div className="flex justify-between items-center border-b border-white/[0.06] pb-2 mb-2">
                        <span className="text-[10px] text-white uppercase font-bold">Formato WA</span>
                        <span className="text-xs font-black text-white">{activeDraft.format} · {activeDraft.distance} m</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/[0.06] pb-2 mb-2">
                        <span className="text-[10px] text-white uppercase font-bold">Puntuación</span>
                        <span className="text-xs font-black text-cyan-neon tabular-nums">{activeDraft.score} pts</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/[0.06] pb-2 mb-2">
                        <span className="text-[10px] text-white uppercase font-bold">Progreso</span>
                        <span className="text-xs font-black text-white tabular-nums">
                          {(() => {
                            const shotCount = activeDraft.ends.reduce((sum: number, e: any) => sum + e.arrows.filter((a: string) => a !== "").length, 0);
                            const total = activeDraft.endsCount * activeDraft.arrowsPerEnd;
                            return `${shotCount} / ${total} flechas`;
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-white uppercase font-bold">Guardado</span>
                        <span className="text-[10px] text-white font-medium">
                          {activeDraft.timestamp ? (
                            (() => {
                              const date = new Date(activeDraft.timestamp);
                              return isNaN(date.getTime()) ? "Fecha N/A" : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                            })()
                          ) : "Fecha N/A"}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-white leading-relaxed px-2 [text-wrap:pretty]">
                      Tienes una sesión en curso guardada. ¿Deseas continuar registrando tus flechas donde lo dejaste?
                    </p>

                    <div className="mt-5 flex flex-col gap-2 w-full">
                      <button
                        onClick={() => resumeSession(activeDraft)}
                        className="w-full h-11 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition flex items-center justify-center"
                      >
                        Reanudar Entrenamiento
                      </button>
                      <button
                        onClick={() => setShowDiscardConfirm(true)}
                        className="w-full h-11 bg-[#111620] border border-white/[0.08] text-red-rival font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:bg-white/[0.05] transition flex items-center justify-center"
                      >
                        Descartar Borrador
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-[10px] text-red-rival font-black tracking-widest uppercase block mb-1">
                      CONFIRMACIÓN DE DESCARTE
                    </span>
                    <h3 className="text-white text-lg font-black uppercase tracking-wide">
                      ¿Descartar Borrador?
                    </h3>
                    
                    <p className="text-xs text-white leading-relaxed px-2 my-4 [text-wrap:pretty]">
                      Esta acción es irreversible y se perderán los tiros registrados en esta sesión en pausa. ¿Estás seguro de continuar?
                    </p>

                    <div className="mt-2 flex flex-col gap-2 w-full">
                      <button
                        onClick={handleDiscardDraft}
                        className="w-full h-11 bg-red-rival text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:bg-red-700 transition flex items-center justify-center"
                      >
                        Sí, Descartar Permanentemente
                      </button>
                      <button
                        onClick={() => setShowDiscardConfirm(false)}
                        className="w-full h-11 bg-[#111620] border border-white/[0.08] text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:text-white transition flex items-center justify-center"
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

      {/* Profile Completion Modal with X close and return to login support */}
      {user && !dismissedProfileModal && (!user.fullName?.trim() || !user.birthDate || !user.country || !user.gender) && (
        <ProfileCompletionModal
          user={user}
          onComplete={(updatedUser) => {
            setUser(updatedUser);
            setDismissedProfileModal(true);
          }}
          onClose={() => setDismissedProfileModal(true)}
          onReturnToLogin={handleReturnToLoginFromProfile}
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
              className="w-full max-w-[340px] bg-[#0B0E14] border border-white/[0.12] p-6 rounded-3xl flex flex-col gap-4 text-center shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] flex">
                <div className="flex-1 bg-cyan-neon" />
                <div className="flex-1 bg-red-rival" />
                <div className="flex-1 bg-yellow-gold" />
              </div>

              <div className="flex flex-col gap-1.5 mt-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  ELIMINATORIA ONLINE 1 VS 1
                </span>
                <h3 className="text-white text-base font-black uppercase tracking-wide">
                  Desafío en Vivo Recibido
                </h3>
                <p className="text-xs text-white leading-relaxed [text-wrap:pretty]">
                  <strong className="text-white">{pendingInvitation.senderName}</strong> te ha desafiado a una eliminatoria de <strong className="text-white">{pendingInvitation.bowType === "Recurve" ? "Recurvo" : pendingInvitation.bowType === "Compound" ? "Compuesto" : pendingInvitation.bowType}</strong> a <strong className="text-white">{pendingInvitation.distance} m</strong>.
                </p>
              </div>

              <div className="flex flex-col gap-2.5 mt-2">
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
                  className="w-full h-11 bg-cyan-neon hover:bg-[#19c8ff] text-black font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer active:scale-95 transition flex items-center justify-center"
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
                  className="w-full h-10 bg-[#111620] border border-white/[0.08] text-white font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer hover:text-white transition flex items-center justify-center"
                >
                  Rechazar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Coach PRO Subscription & Payment Modal */}
      {user && (
        <CoachPaymentModal
          isOpen={showCoachPaymentModal}
          onClose={() => setShowCoachPaymentModal(false)}
          user={user}
          onSuccess={handleCoachPaymentSuccess}
        />
      )}

      {/* Floating Back Navigation Toast (OLED Mobile HUD) */}
      <AnimatePresence>
        {backToast && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[999999] px-4 py-2 rounded-full bg-[#0D1017]/95 border border-white/15 text-white text-xs font-semibold shadow-2xl backdrop-blur-md pointer-events-none flex items-center justify-center"
          >
            <span>{backToast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
