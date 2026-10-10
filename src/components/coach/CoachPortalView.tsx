"use client";

import React, { useState, useEffect } from "react";
import { UserProfile, updateProfile } from "@/lib/authService";
import { 
  getLocalSessions, 
  getLocalSetting, 
  saveLocalSetting, 
  saveLocalSession 
} from "@/lib/db/indexedDB";
import { motion, AnimatePresence } from "framer-motion";
import { 
  LayoutDashboard, 
  Users, 
  Award, 
  Sparkles,
  ShieldCheck,
  Building2,
  Share2
} from "lucide-react";

// Sub-components / Tabs
import CoachOverviewTab from "./tabs/CoachOverviewTab";
import CoachAthletesTab from "./tabs/CoachAthletesTab";
import CoachSessionsTab from "./tabs/CoachSessionsTab";
import CoachMacrocycleTab from "./tabs/CoachMacrocycleTab";
import AthleteDetailSheet from "./AthleteDetailSheet";

interface CoachPortalViewProps {
  user: UserProfile;
  onNavigate: (screen: any) => void;
  onUserUpdate?: (updated: UserProfile) => void;
}

type Tab = "ATHLETES" | "SESSIONS" | "OVERVIEW" | "MACROCYCLES";

export default function CoachPortalView({ user, onNavigate, onUserUpdate }: CoachPortalViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("ATHLETES");
  const [athletes, setAthletes] = useState<UserProfile[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [selectedAthlete, setSelectedAthlete] = useState<UserProfile | null>(null);

  const activeClubId = user.clubId || "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");

  // Load roster and seed demo sessions
  useEffect(() => {
    async function loadCoachData() {
      // 1. Get roster of athletes in this club
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      let clubArchers = allUsers.filter(u => (u.clubId === activeClubId || !u.clubId) && u.role === "archer");
      
      // Fallback/Seed demo athletes if empty so the coach has initial data to examine
      if (clubArchers.length === 0) {
        const demoArchers: UserProfile[] = [
          {
            uid: "USR-D-ATHLETE-1",
            email: "daniela.solano@club.com",
            fullName: "Daniela Solano",
            nickname: "daniela",
            birthDate: "2002-08-12",
            country: user.country || "CR",
            city: "San José",
            gender: "F",
            bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 42, defaultDistance: 70 },
            physicalData: { height: 168, weight: 58, dominantEye: "R", dominantHand: "R" },
            clubId: activeClubId,
            clubName: user.clubName || "Club Archery 101010",
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry || "CR",
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-D-ATHLETE-2",
            email: "carlos.ruiz@club.com",
            fullName: "Carlos Ruiz",
            nickname: "carlos",
            birthDate: "1998-04-25",
            country: user.country || "CR",
            city: "Cartago",
            gender: "M",
            bowConfig: { type: "Compound", brand: "Mathews", model: "TRX", poundage: 58, defaultDistance: 50 },
            physicalData: { height: 178, weight: 76, dominantEye: "R", dominantHand: "R" },
            clubId: activeClubId,
            clubName: user.clubName || "Club Archery 101010",
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry || "CR",
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-D-ATHLETE-3",
            email: "sebastian.castro@club.com",
            fullName: "Sebastián Castro",
            nickname: "sebas",
            birthDate: "2005-11-03",
            country: user.country || "CR",
            city: "Alajuela",
            gender: "M",
            bowConfig: { type: "Barebow", brand: "Gillo", model: "G1", poundage: 36, defaultDistance: 18 },
            physicalData: { height: 172, weight: 64, dominantEye: "L", dominantHand: "R" },
            clubId: activeClubId,
            clubName: user.clubName || "Club Archery 101010",
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry || "CR",
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          }
        ];

        const updatedList = [...allUsers, ...demoArchers];
        await saveLocalSetting("simulated_users", updatedList);
        clubArchers = demoArchers;
      }
      setAthletes(clubArchers);

      // 2. Load attendance for today
      const dateKey = new Date().toISOString().split("T")[0];
      const savedAttendance = await getLocalSetting<Record<string, boolean>>(`attendance_${activeClubId}_${dateKey}`, {});
      setAttendance(savedAttendance);

      // 3. Load sessions
      let allSessions = await getLocalSessions();

      // Seed sessions for demo roster if none exists
      const hasDemoSessions = allSessions.some(s => s.userId && s.userId.startsWith("USR-D-"));
      if (!hasDemoSessions) {
        const demoSessions = [
          // Daniela Solano - Recurve Control
          {
            id: "SES-D-1",
            userId: "USR-D-ATHLETE-1",
            userName: "Daniela Solano",
            clubId: activeClubId,
            timestamp: Date.now() - 2 * 60 * 60 * 1000,
            practiceType: "Control",
            bowType: "Recurve",
            distance: 70,
            format: "WA 720",
            endsCount: 12,
            arrowsPerEnd: 6,
            maxScore: 720,
            score: 638,
            isDraft: false,
            ends: Array.from({ length: 12 }, () => ({
              arrows: ["X", "10", "9", "9", "9", "8"],
              note: ""
            })),
            impacts: [
              { endIdx: 0, arrowIdx: 0, x: 50, y: 50, value: "X" },
              { endIdx: 0, arrowIdx: 1, x: 51.5, y: 49, value: "10" },
              { endIdx: 0, arrowIdx: 2, x: 54, y: 46, value: "9" },
              { endIdx: 0, arrowIdx: 3, x: 47, y: 53, value: "9" }
            ],
            sessionNote: "Excelente progresión técnica y soltura."
          },
          // Carlos Ruiz - Compound Practice
          {
            id: "SES-D-2",
            userId: "USR-D-ATHLETE-2",
            userName: "Carlos Ruiz",
            clubId: activeClubId,
            timestamp: Date.now() - 24 * 60 * 60 * 1000,
            practiceType: "Práctica",
            bowType: "Compound",
            distance: 50,
            format: "WA 720",
            endsCount: 12,
            arrowsPerEnd: 6,
            maxScore: 720,
            score: 684,
            isDraft: false,
            ends: Array.from({ length: 12 }, () => ({
              arrows: ["X", "X", "10", "10", "9", "9"],
              note: ""
            })),
            impacts: [
              { endIdx: 0, arrowIdx: 0, x: 50, y: 50, value: "X" },
              { endIdx: 0, arrowIdx: 1, x: 50.8, y: 49.2, value: "X" }
            ]
          },
          // Sebastián Castro - Barebow Volume
          {
            id: "SES-D-3",
            userId: "USR-D-ATHLETE-3",
            userName: "Sebastián Castro",
            clubId: activeClubId,
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
            practiceType: "Volumen",
            bowType: "Barebow",
            distance: 18,
            format: "WA 300",
            endsCount: 10,
            arrowsPerEnd: 3,
            maxScore: 300,
            score: 272,
            isDraft: false,
            ends: Array.from({ length: 10 }, () => ({
              arrows: ["10", "9", "9"],
              note: ""
            })),
            impacts: []
          }
        ];

        for (const ds of demoSessions) {
          const id = ds.id;
          if (id) {
            await saveLocalSession(id, ds);
          }
        }
        allSessions = [...allSessions, ...demoSessions];
      }

      setSessions(allSessions);
    }
    loadCoachData();
  }, [user, activeClubId]);

  // Create new athlete profile callback
  const handleCreateAthlete = async (newAthlete: UserProfile) => {
    try {
      const athleteWithClub: UserProfile = {
        ...newAthlete,
        clubId: activeClubId,
        clubName: user.clubName || "Club Archery 101010",
        clubCountry: user.clubCountry || user.country || "CR"
      };

      // 1. Save to local simulated_users
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      const updatedList = [athleteWithClub, ...allUsers];
      await saveLocalSetting("simulated_users", updatedList);

      // 2. Update state
      setAthletes((prev) => [athleteWithClub, ...prev]);

      // 3. Queue sync UPDATE for cloud sync
      try {
        const { addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
        const { runSync } = await import("@/lib/db/syncManager");
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "users",
          operation: "INSERT",
          payloadId: athleteWithClub.uid,
          payload: athleteWithClub,
          timestamp: Date.now()
        });
        runSync();
      } catch (syncErr) {
        console.warn("Cloud sync skipped:", syncErr);
      }

      alert(`✓ ¡Perfil de ${athleteWithClub.fullName} creado con éxito! Ya puedes ver su ficha y recibir sus resultados.`);
    } catch (err) {
      console.error("Error creating athlete:", err);
      alert("Error al guardar el perfil del alumno.");
    }
  };

  // Toggle Attendance
  const handleToggleAttendance = async (uid: string) => {
    const nextAttendance = {
      ...attendance,
      [uid]: !attendance[uid]
    };
    setAttendance(nextAttendance);

    const dateKey = new Date().toISOString().split("T")[0];
    await saveLocalSetting(`attendance_${activeClubId}_${dateKey}`, nextAttendance);
  };

  const handleUpgradeToPro = async () => {
    try {
      const updated = await updateProfile(user.uid, { plan: "PRO" });
      if (onUserUpdate) onUserUpdate(updated);
      alert("¡Cuenta de Coach PRO activada!");
    } catch (e) {
      console.error(e);
    }
  };

  const handleRestoreSession = async (sessionId: string) => {
    try {
      const { getLocalSession, saveLocalSession, addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
      const { runSync } = await import("@/lib/db/syncManager");
      
      const session = await getLocalSession(sessionId);
      if (session) {
        const restoredSession = {
          ...session,
          deletedByArcher: false,
          restoredByCoach: true
        };
        
        await saveLocalSession(sessionId, restoredSession);
        
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "sessions",
          operation: "UPDATE",
          payloadId: sessionId,
          payload: restoredSession,
          timestamp: Date.now()
        });
        
        const list = await getLocalSessions();
        setSessions(list);
        runSync();
        
        alert("Sesión restituida correctamente. Se ha notificado al arquero.");
      }
    } catch (err) {
      console.error("Error restoring session:", err);
    }
  };

  // Get active session list for Overview
  const getRecentActivities = () => {
    return sessions
      .filter(s => athletes.some(a => a.uid === s.userId || a.uid === s.userUid))
      .slice(0, 10);
  };

  return (
    <div className="flex flex-col gap-4 min-h-[500px]">
      {/* Director Identity Banner */}
      <div className="bg-gradient-to-r from-neutral-900 via-neutral-900/90 to-neutral-950 p-4 rounded-3xl border border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-brand/30 to-cyan-neon/10 border border-cyan-neon/30 flex items-center justify-center font-black text-cyan-neon text-lg shadow-glow-cyan shrink-0">
            {user.fullName ? user.fullName.substring(0, 2).toUpperCase() : "CH"}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-white text-base font-black uppercase tracking-wide">
                Coach {user.fullName || "Director"}
              </h2>
              <span className="text-[8px] bg-yellow-gold/15 text-yellow-gold font-black uppercase px-2 py-0.5 rounded-full border border-yellow-gold/30 shadow-glow-yellow flex items-center gap-1">
                <ShieldCheck size={10} />
                <span>Coach Suscrito</span>
              </span>
            </div>
            <p className="text-[10px] text-gray-dim mt-0.5 flex items-center gap-1.5">
              <Building2 size={11} className="text-cyan-neon" />
              <span>{user.clubName || "Club Archery 101010"}</span>
              <span>·</span>
              <span>Receptor y Director de Estadísticas</span>
            </p>
          </div>
        </div>

        {/* Quick Club Code */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end bg-neutral-950/80 px-3 py-1.5 rounded-xl border border-white/5">
          <div className="flex flex-col">
            <span className="text-[8px] text-gray-dim uppercase font-bold">Código de Club</span>
            <span className="text-xs font-mono font-black text-cyan-neon tracking-wider">
              {activeClubId}
            </span>
          </div>
          <button
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(activeClubId);
                alert("Código de club copiado al portapapeles. Compártelo con tus alumnos.");
              }
            }}
            className="p-1 text-gray-dim hover:text-white transition cursor-pointer"
            title="Copiar código"
          >
            <Share2 size={12} />
          </button>
        </div>
      </div>

      {/* Tabs Panel Switcher: ALUMNOS | RESULTADOS | DIRECTOR | PLANES */}
      <div className="flex bg-neutral-950/80 border border-white/5 rounded-2xl p-1 justify-between shrink-0">
        {[
          { id: "ATHLETES", label: "Alumnos", icon: Users },
          { id: "SESSIONS", label: "Resultados", icon: Award },
          { id: "OVERVIEW", label: "Director", icon: LayoutDashboard },
          { id: "MACROCYCLES", label: "Planes", icon: Sparkles }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 cursor-pointer ${
                active 
                  ? "bg-neutral-900 border border-white/10 text-cyan-neon shadow-[0_0_12px_rgba(0,229,255,0.08)]" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              <Icon size={14} className={active ? "text-cyan-neon" : "text-gray-dim"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="flex-1">
        {activeTab === "ATHLETES" && (
          <CoachAthletesTab
            athletes={athletes}
            onViewAthlete={setSelectedAthlete}
            sessions={sessions}
            onCreateAthlete={handleCreateAthlete}
          />
        )}

        {activeTab === "SESSIONS" && (
          <CoachSessionsTab
            athletes={athletes}
            sessions={sessions}
          />
        )}

        {activeTab === "OVERVIEW" && (
          <CoachOverviewTab
            user={user}
            athletes={athletes}
            attendance={attendance}
            onToggleAttendance={handleToggleAttendance}
            recentActivities={getRecentActivities()}
            onViewAthlete={setSelectedAthlete}
            onNavigate={onNavigate}
          />
        )}

        {activeTab === "MACROCYCLES" && (
          <CoachMacrocycleTab
            user={user}
            onUpgrade={handleUpgradeToPro}
          />
        )}
      </div>

      {/* Slide-up detail sheet drawer for athlete */}
      <AnimatePresence>
        {selectedAthlete && (
          <AthleteDetailSheet
            athlete={selectedAthlete}
            onClose={() => setSelectedAthlete(null)}
            sessions={sessions}
            onRestoreSession={handleRestoreSession}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
