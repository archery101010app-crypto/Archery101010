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
  Trophy, 
  Sparkles,
  ArrowRight,
  TrendingUp
} from "lucide-react";

// Sub-components / Tabs
import CoachOverviewTab from "./tabs/CoachOverviewTab";
import CoachAthletesTab from "./tabs/CoachAthletesTab";
import CoachSessionsTab from "./tabs/CoachSessionsTab";
import CoachDuelsTab from "./tabs/CoachDuelsTab";
import CoachMacrocycleTab from "./tabs/CoachMacrocycleTab";
import AthleteDetailSheet from "./AthleteDetailSheet";

interface CoachPortalViewProps {
  user: UserProfile;
  onNavigate: (screen: any) => void;
  onUserUpdate?: (updated: UserProfile) => void;
}

type Tab = "OVERVIEW" | "ATHLETES" | "SESSIONS" | "DUELS" | "MACROCYCLES";

export default function CoachPortalView({ user, onNavigate, onUserUpdate }: CoachPortalViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("OVERVIEW");
  const [athletes, setAthletes] = useState<UserProfile[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [selectedAthlete, setSelectedAthlete] = useState<UserProfile | null>(null);

  // Load roster and seed demo sessions
  useEffect(() => {
    async function loadCoachData() {
      if (!user.clubId) return;

      // 1. Get roster of athletes in this club
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      let clubArchers = allUsers.filter(u => u.clubId === user.clubId && u.role === "archer");
      
      // Fallback/Seed demo athletes if empty
      if (clubArchers.length === 0) {
        const demoArchers: UserProfile[] = [
          {
            uid: "USR-D-ATHLETE-1",
            email: "daniela.solano@club.com",
            fullName: "Daniela Solano",
            birthDate: "2002-08-12",
            country: user.country,
            gender: "F",
            bowConfig: { type: "Recurve", brand: "Hoyt", model: "Helix", poundage: 42, defaultDistance: 70 },
            physicalData: { height: 168, weight: 58, dominantEye: "R", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry,
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-D-ATHLETE-2",
            email: "carlos.ruiz@club.com",
            fullName: "Carlos Ruiz",
            birthDate: "1998-04-25",
            country: user.country,
            gender: "M",
            bowConfig: { type: "Compound", brand: "Mathews", model: "TRX", poundage: 58, defaultDistance: 50 },
            physicalData: { height: 178, weight: 76, dominantEye: "R", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry,
            role: "archer",
            plan: "FREE",
            isClubCreator: false
          },
          {
            uid: "USR-D-ATHLETE-3",
            email: "sebastian.castro@club.com",
            fullName: "Sebastián Castro",
            birthDate: "2005-11-03",
            country: user.country,
            gender: "M",
            bowConfig: { type: "Barebow", brand: "Gillo", model: "G1", poundage: 36, defaultDistance: 18 },
            physicalData: { height: 172, weight: 64, dominantEye: "L", dominantHand: "R" },
            clubId: user.clubId,
            clubName: user.clubName,
            clubLogo: user.clubLogo,
            clubCountry: user.clubCountry,
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
      const savedAttendance = await getLocalSetting<Record<string, boolean>>(`attendance_${user.clubId}_${dateKey}`, {});
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
            clubId: user.clubId,
            timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
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
            sessionNote: "Muy buena progresión, controlando respiración en cada tiro."
          },
          // Carlos Ruiz - Compound Practice
          {
            id: "SES-D-2",
            userId: "USR-D-ATHLETE-2",
            userName: "Carlos Ruiz",
            clubId: user.clubId,
            timestamp: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
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
            clubId: user.clubId,
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
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
          },
          // Duel 1
          {
            uid: "DUE-D-1",
            userUid: "USR-D-ATHLETE-1",
            userName: "Daniela Solano",
            timestamp: Date.now() - 18 * 60 * 60 * 1000,
            practiceType: "Control",
            bowConfig: { type: "Recurve" },
            endsCount: 5,
            arrowsPerEnd: 3,
            distance: 70,
            score: 114,
            maxScore: 150,
            isDuel: true,
            opponent: "Carlos Ruiz",
            opponentCountry: user.country,
            opponentClubName: user.clubName,
            outcome: "win"
          },
          // Duel 2
          {
            uid: "DUE-D-2",
            userUid: "USR-D-ATHLETE-2",
            userName: "Carlos Ruiz",
            timestamp: Date.now() - 18 * 60 * 60 * 1000,
            practiceType: "Control",
            bowConfig: { type: "Compound" },
            endsCount: 5,
            arrowsPerEnd: 3,
            distance: 50,
            score: 108,
            maxScore: 150,
            isDuel: true,
            opponent: "Daniela Solano",
            opponentCountry: user.country,
            opponentClubName: user.clubName,
            outcome: "loss"
          }
        ];

        for (const ds of demoSessions) {
          const id = ds.id || ds.uid;
          if (id) {
            await saveLocalSession(id, ds);
          }
        }
        allSessions = [...allSessions, ...demoSessions];
      }

      setSessions(allSessions);
    }
    loadCoachData();
  }, [user]);

  // Toggle Attendance
  const handleToggleAttendance = async (uid: string) => {
    const nextAttendance = {
      ...attendance,
      [uid]: !attendance[uid]
    };
    setAttendance(nextAttendance);

    const dateKey = new Date().toISOString().split("T")[0];
    await saveLocalSetting(`attendance_${user.clubId}_${dateKey}`, nextAttendance);
  };

  // Simulate Upgrade to PRO for demonstration
  const handleUpgradeToPro = async () => {
    try {
      const updated = await updateProfile(user.uid, { plan: "PRO" });
      if (onUserUpdate) onUserUpdate(updated);
      alert("¡Cuenta simulada actualizada a PRO con éxito!");
    } catch (e) {
      console.error(e);
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
      {/* Title Header */}
      <div className="flex flex-col mb-1">
        <h2 className="text-white text-xl font-black flex items-center gap-1.5 uppercase tracking-wide">
          <span>CONSOLA COACH</span>
          <span className="text-cyan-neon text-xs font-black bg-cyan-neon/10 px-2.5 py-0.5 rounded-full border border-cyan-neon/20 shadow-glow-cyan animate-pulse">
            {user.clubName || "Club"}
          </span>
        </h2>
        <p className="text-[10px] text-gray-dim mt-0.5 tracking-wider uppercase">
          Gestión del Equipo · Panel Administrativo
        </p>
      </div>

      {/* Tabs Panel Switcher */}
      <div className="flex bg-neutral-950/60 border border-white/5 rounded-2xl p-1 justify-between shrink-0">
        {[
          { id: "OVERVIEW", label: "Resumen", icon: LayoutDashboard },
          { id: "ATHLETES", label: "Atletas", icon: Users },
          { id: "SESSIONS", label: "Controles", icon: Award },
          { id: "DUELS", label: "Duelos", icon: Trophy },
          { id: "MACROCYCLES", label: "Planes", icon: Sparkles }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[8px] font-black uppercase tracking-wider transition-all duration-300 cursor-pointer ${
                active 
                  ? "bg-neutral-900 border border-white/10 text-cyan-neon shadow-[0_0_12px_rgba(0,229,255,0.05)]" 
                  : "text-gray-dim hover:text-white"
              }`}
            >
              <Icon size={14} className={active ? "text-cyan-neon" : "text-gray-dim"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Selected View Tab Body */}
      <div className="flex-1">
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

        {activeTab === "ATHLETES" && (
          <CoachAthletesTab
            athletes={athletes}
            onViewAthlete={setSelectedAthlete}
            sessions={sessions}
          />
        )}

        {activeTab === "SESSIONS" && (
          <CoachSessionsTab
            athletes={athletes}
            sessions={sessions}
          />
        )}

        {activeTab === "DUELS" && (
          <CoachDuelsTab
            athletes={athletes}
            sessions={sessions}
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
          />
        )}
      </AnimatePresence>
    </div>
  );
}
