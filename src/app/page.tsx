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

// Screens that the authenticated user can access
type Screen = "HOME" | "TARGET" | "HISTORY" | "CALENDAR" | "PROFILE" | "MATCHPLAY_LOBBY" | "MATCHPLAY_ARENA";


export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authScreen, setAuthScreen] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [currentScreen, setCurrentScreen] = useState<Screen>("HOME");
  const [coachViewMode, setCoachViewMode] = useState(false);
  const [sessionConfig, setSessionConfig] = useState<any | null>(null);
  const [duelConfig, setDuelConfig] = useState<any | null>(null);
  const [initialHistoryTab, setInitialHistoryTab] = useState<"SESSIONS" | "VOLUME">("SESSIONS");
  const [loading, setLoading] = useState(true);

  // Check authentication status on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const loggedUser = await getLoggedUser();
        setUser(loggedUser);
      } catch (e) {
        console.error("Error reading authentication", e);
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  // Load persistent font size from IndexedDB on mount
  useEffect(() => {
    async function loadFontSize() {
      if (!user) return;
      try {
        const { getLocalSetting } = await import("@/lib/db/indexedDB");
        const savedSize = await getLocalSetting<string>("user_font_size", "medium");
        const root = document.documentElement;
        if (savedSize === "small") {
          root.style.fontSize = "14px";
        } else if (savedSize === "large") {
          root.style.fontSize = "18px";
        } else {
          root.style.fontSize = "16px";
        }
      } catch (e) {
        console.error("Error loading font size settings", e);
      }
    }
    loadFontSize();
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

  // Authenticated application flow
  return (
    <div className="flex-1 flex flex-col min-h-full">
      {/* Top Header common to all screens */}
      <Header user={user} coachViewMode={coachViewMode} onToggleCoachViewMode={setCoachViewMode} />

      {/* Screen Render Router */}
      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-16">
        {currentScreen === "HOME" && (
          <DashboardView
            user={user}
            coachViewMode={coachViewMode}
            onNavigate={(screen, tab) => {
              if (tab) setInitialHistoryTab(tab);
              else setInitialHistoryTab("SESSIONS");
              setCurrentScreen(screen);
            }}
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
          />
        )}
      </main>

      {/* Floating Bottom Navigation */}
      <FloatingNav activeScreen={currentScreen} onScreenChange={setCurrentScreen} />

      {/* Spotify Floating Player */}
      <SpotifyFloatingPlayer />
    </div>
  );
}
