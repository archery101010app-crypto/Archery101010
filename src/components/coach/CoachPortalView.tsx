"use client";

import React, { useState, useEffect } from "react";
import { UserProfile, updateProfile, isLinkedToExternalCoach, getCanonicalCoachClubId } from "@/lib/authService";
import { 
  getLocalSessions, 
  getLocalSetting, 
  saveLocalSetting, 
  saveLocalSession,
  purgeAllFictitiousData,
  isFictitiousUser,
  isFictitiousSession
} from "@/lib/db/indexedDB";
import { motion, AnimatePresence } from "framer-motion";
import { 
  LayoutDashboard, 
  Users, 
  Award, 
  Calendar,
  ShieldCheck,
  Building2,
  Share2,
  RefreshCw
} from "lucide-react";

// Sub-components / Tabs
import CoachOverviewTab from "./tabs/CoachOverviewTab";
import CoachAthletesTab from "./tabs/CoachAthletesTab";
import CoachSessionsTab from "./tabs/CoachSessionsTab";
import CoachMacrocycleTab from "./tabs/CoachMacrocycleTab";
import AthleteDetailSheet from "./AthleteDetailSheet";
import PlanImporterModal from "@/components/planning/PlanImporterModal";
import { Macrocycle } from "@/lib/db/macrocycleTypes";
import { SyncCycleSummary } from "@/lib/cycleCalendarSync";

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
  const [showPlanImporter, setShowPlanImporter] = useState(false);
  const [importerPreselectedIds, setImporterPreselectedIds] = useState<string[]>([]);

  const handleOpenPlanImporter = (preselectedAthleteId?: string) => {
    setImporterPreselectedIds(preselectedAthleteId ? [preselectedAthleteId] : []);
    setShowPlanImporter(true);
  };

  const handlePlanImportSuccess = ({ macrocycle, summary }: { macrocycle: Macrocycle; summary: SyncCycleSummary }) => {
    const assignedIds = macrocycle.assignedAthleteIds || [];
    const recipientText = assignedIds.length > 0
      ? assignedIds.map((id) => athletes.find((a) => a.uid === id)?.fullName || id).join(", ")
      : "Todos los alumnos del Club";

    alert(
      `¡Plan "${macrocycle.name}" cargado en formato literal!\n\n` +
      `• Destinatario(s): ${recipientText}\n` +
      `• Días programados: ${summary.syncedDaysCount} (${summary.trainingDaysCount} entrenamientos, ${summary.restDaysCount} descansos)\n` +
      `• Flechas totales asignadas: ${summary.totalArrowsAssigned.toLocaleString()}\n\n` +
      `Ya está disponible en el calendario del alumno(s).`
    );
  };

  const canonicalCoachClubId = "CLB-" + (user.uid ? user.uid.replace("USR-", "") : "DIRECTOR");
  const activeClubId = getCanonicalCoachClubId(user);

  const isAthleteLinkedToCoach = (u: UserProfile, unlinkedIds: string[]): boolean => {
    if (!u || !u.uid || isFictitiousUser(u) || u.uid === user.uid) return false;
    // Explicit coachId link always wins (even if athlete was previously unlinked and re-joined)
    if (u.coachId === user.uid) return true;
    if (u.coachId && u.coachId !== user.uid) return false;
    if (unlinkedIds.includes(u.uid)) return false;
    return (
      u.clubId === activeClubId ||
      u.clubId === canonicalCoachClubId ||
      (!!user.clubId && !isLinkedToExternalCoach(user) && u.clubId === user.clubId) ||
      (!!user.clubInviteCode && u.clubInviteCode === user.clubInviteCode)
    );
  };

  // Load real linked roster and transfer real sessions from linked students (no demo/fictitious data)
  useEffect(() => {
    async function loadCoachData() {
      await purgeAllFictitiousData();

      // 1. Get roster of real athletes linked to this coach/club
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      let unlinkedIds = await getLocalSetting<string[]>(`unlinked_athletes_${activeClubId}`, []);

      let clubArchers = allUsers.filter((u) => isAthleteLinkedToCoach(u, unlinkedIds));

      // Pull any newly linked athletes directly from Firestore so Coach sees students immediately
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const { collection, query, where, getDocs } = await import("firebase/firestore");
          const { db } = await import("@/lib/firebase");
          const remoteAthletesMap = new Map<string, UserProfile>();

          const addRemoteDoc = (docSnap: any) => {
            const raw = docSnap.data();
            const uid = raw?.uid || docSnap.id;
            if (!raw || !uid || uid === user.uid) return;
            const data = { ...raw, uid } as UserProfile;
            if (!isFictitiousUser(data)) {
              remoteAthletesMap.set(uid, data);
            }
          };

          // Query 1: explicit coachId === user.uid
          try {
            const snapCoachId = await getDocs(query(collection(db, "users"), where("coachId", "==", user.uid)));
            snapCoachId.forEach(addRemoteDoc);
          } catch (e) {
            console.warn("Query users by coachId failed:", e);
          }

          // Query 2: clubId === activeClubId
          try {
            const snapClub = await getDocs(query(collection(db, "users"), where("clubId", "==", activeClubId)));
            snapClub.forEach(addRemoteDoc);
          } catch (e) {
            console.warn("Query users by activeClubId failed:", e);
          }

          // Query 3: canonicalCoachClubId if different from activeClubId
          if (canonicalCoachClubId !== activeClubId) {
            try {
              const snapCanonical = await getDocs(
                query(collection(db, "users"), where("clubId", "==", canonicalCoachClubId))
              );
              snapCanonical.forEach(addRemoteDoc);
            } catch (e) {
              console.warn("Query users by canonicalCoachClubId failed:", e);
            }
          }

          // Query 4: legacy clubInviteCode match
          if (user.clubInviteCode) {
            try {
              const snapCode = await getDocs(
                query(collection(db, "users"), where("clubInviteCode", "==", user.clubInviteCode))
              );
              snapCode.forEach(addRemoteDoc);
            } catch (e) {
              console.warn("Query users by clubInviteCode failed:", e);
            }
          }

          const remoteAthletes = Array.from(remoteAthletesMap.values());
          if (remoteAthletes.length > 0) {
            // If an athlete re-linked in the cloud (coachId === user.uid or clubId === activeClubId),
            // remove them from local unlinkedIds so they show up immediately.
            const relinkedUids = new Set(
              remoteAthletes
                .filter((r) => r.coachId === user.uid || r.clubId === activeClubId || r.clubId === canonicalCoachClubId)
                .map((r) => r.uid)
            );
            if (relinkedUids.size > 0 && unlinkedIds.some((id) => relinkedUids.has(id))) {
              unlinkedIds = unlinkedIds.filter((id) => !relinkedUids.has(id));
              await saveLocalSetting(`unlinked_athletes_${activeClubId}`, unlinkedIds);
            }

            const mergedMap = new Map<string, UserProfile>();
            for (const u of allUsers) {
              if (!isFictitiousUser(u)) mergedMap.set(u.uid, u);
            }
            for (const r of remoteAthletes) mergedMap.set(r.uid, r);
            const mergedUsers = Array.from(mergedMap.values());
            await saveLocalSetting("simulated_users", mergedUsers);
            clubArchers = mergedUsers.filter((u) => isAthleteLinkedToCoach(u, unlinkedIds));
          }
        } catch (err) {
          console.warn("Could not fetch club athletes from Firestore:", err);
        }
      }

      setAthletes(clubArchers);

      // 2. Load attendance for today
      const dateKey = new Date().toISOString().split("T")[0];
      const savedAttendance = await getLocalSetting<Record<string, boolean>>(`attendance_${activeClubId}_${dateKey}`, {});
      setAttendance(savedAttendance);

      // 3. Transfer all real sessions from linked athletes in Firestore + local DB
      if (typeof navigator !== "undefined" && navigator.onLine && clubArchers.length > 0) {
        try {
          const { collection, query, where, getDocs } = await import("firebase/firestore");
          const { db } = await import("@/lib/firebase");

          const qClubSess = query(collection(db, "sessions"), where("clubId", "==", activeClubId));
          const snapClubSess = await getDocs(qClubSess);
          for (const d of snapClubSess.docs) {
            const data = d.data();
            if (data && !isFictitiousSession(data, d.id)) {
              await saveLocalSession(d.id, { ...data, id: d.id });
            }
          }

          for (const ath of clubArchers) {
            const qAthSess = query(collection(db, "sessions"), where("userId", "==", ath.uid));
            const snapAthSess = await getDocs(qAthSess);
            for (const d of snapAthSess.docs) {
              const data = d.data();
              if (data && !isFictitiousSession(data, d.id)) {
                await saveLocalSession(d.id, { ...data, id: d.id });
              }
            }
          }
        } catch (err) {
          console.warn("Could not fetch linked athlete sessions from Firestore:", err);
        }
      }

      const allSessions = await getLocalSessions();
      const linkedUids = new Set(clubArchers.map((a) => a.uid));
      const realLinkedSessions = allSessions.filter(
        (s) =>
          !isFictitiousSession(s, s.id) &&
          !s.isDraft &&
          linkedUids.has(s.userId || s.userUid)
      );
      setSessions(realLinkedSessions);
    }
    loadCoachData();

    // Garantiza que el código de 6 dígitos y el clubId del Coach EXISTAN en Firestore
    // (si no están en la nube, el alumno recibe "Código no encontrado").
    // CRÍTICO: Si el usuario está vinculado como alumno a otro Coach, NUNCA sobrescribir su perfil.
    async function ensureClean6DigitCode() {
      if (isLinkedToExternalCoach(user)) return;

      const localCode = user.clubInviteCode ? user.clubInviteCode.trim() : "";
      const hasValidLocalCode = /^\d{6}$/.test(localCode);
      try {
        const { generateClubInviteCode, updateProfile } = await import("@/lib/authService");
        const { doc, getDoc, setDoc } = await import("firebase/firestore");
        const { db } = await import("@/lib/firebase");

        let cloudData: any = null;
        if (typeof navigator === "undefined" || navigator.onLine) {
          try {
            const snap = await getDoc(doc(db, "users", user.uid));
            cloudData = snap.exists() ? snap.data() : null;
          } catch {
            cloudData = null;
          }
        }

        // Si en la nube el usuario ya está vinculado como alumno a un Coach externo, no tocar su perfil
        if (cloudData && isLinkedToExternalCoach(cloudData)) {
          return;
        }

        const cloudCode = cloudData?.clubInviteCode ? String(cloudData.clubInviteCode).trim() : "";
        const hasValidCloudCode = /^\d{6}$/.test(cloudCode);

        const finalCode = hasValidLocalCode
          ? localCode
          : hasValidCloudCode
          ? cloudCode
          : generateClubInviteCode();
        const finalClubId = activeClubId;
        const cloudInSync =
          !!cloudData &&
          cloudData.clubInviteCode === finalCode &&
          cloudData.clubId === finalClubId &&
          cloudData.isClubCreator === true &&
          cloudData.role !== "archer";
        const localInSync =
          user.clubInviteCode === finalCode &&
          user.clubId === finalClubId &&
          user.isClubCreator === true &&
          user.role !== "archer";

        if (cloudInSync && localInSync) return;

        const updates: Partial<UserProfile> = {
          clubInviteCode: finalCode,
          clubId: finalClubId,
          isClubCreator: true
        };
        if (user.role === "archer") {
          updates.role = "coach";
        }
        const updated = await updateProfile(user.uid, updates);
        try {
          await setDoc(doc(db, "users", user.uid), updated, { merge: true });
        } catch (cloudErr) {
          console.warn("Código del Coach pendiente de subir a la nube:", cloudErr);
        }
        if (!localInSync && onUserUpdate) {
          onUserUpdate(updated);
        }
      } catch (err) {
        console.error("Error asegurando código de 6 dígitos:", err);
      }
    }
    ensureClean6DigitCode();

    // Listen for realtime database changes (new athlete sessions or roster updates synced from cloud)
    const handleDbChange = async (e: any) => {
      if (
        !e.detail ||
        e.detail.store === "sessions_local" ||
        e.detail.store === "settings_local" ||
        e.detail.store === "simulated_users"
      ) {
        const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
        const unlinkedIds = await getLocalSetting<string[]>(`unlinked_athletes_${activeClubId}`, []);
        const clubArchers = allUsers.filter((u) => isAthleteLinkedToCoach(u, unlinkedIds));
        setAthletes(clubArchers);

        const linkedUids = new Set(clubArchers.map((a) => a.uid));
        const freshSessions = await getLocalSessions();
        const realLinkedSessions = freshSessions.filter(
          (s) =>
            !isFictitiousSession(s, s.id) &&
            !s.isDraft &&
            linkedUids.has(s.userId || s.userUid)
        );
        setSessions(realLinkedSessions);
      }
    };

    window.addEventListener("local-db-change", handleDbChange);
    return () => window.removeEventListener("local-db-change", handleDbChange);
  }, [user, activeClubId]);

  // Unlink athlete from club callback
  const handleUnlinkAthlete = async (athleteToUnlink: UserProfile) => {
    try {
      const targetUid = athleteToUnlink.uid;

      // 1. Track unlinked UID locally for this club so realtime sync doesn't re-add stale cache
      const unlinkedKey = `unlinked_athletes_${activeClubId}`;
      const prevUnlinked = await getLocalSetting<string[]>(unlinkedKey, []);
      if (!prevUnlinked.includes(targetUid)) {
        await saveLocalSetting(unlinkedKey, [...prevUnlinked, targetUid]);
      }

      // 2. Update athlete in simulated_users (clear clubId & coachId without touching archer's optional clubName)
      const allUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
      let updatedAthleteRecord: UserProfile | null = null;
      const updatedUsers = allUsers.map((u) => {
        if (u.uid === targetUid) {
          updatedAthleteRecord = {
            ...u,
            clubId: null,
            coachId: null,
            coachName: null,
            coachEmail: null
          };
          return updatedAthleteRecord;
        }
        return u;
      });
      await saveLocalSetting("simulated_users", updatedUsers);

      // 3. Remove from active UI state and close detail sheet
      setAthletes((prev) => prev.filter((a) => a.uid !== targetUid));
      setSelectedAthlete(null);

      // 4. Write directly to Firestore and queue cloud sync UPDATE
      const payloadToSync: UserProfile = updatedAthleteRecord || {
        ...athleteToUnlink,
        clubId: null,
        coachId: null,
        coachName: null,
        coachEmail: null
      };
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const { doc, setDoc } = await import("firebase/firestore");
          const { db } = await import("@/lib/firebase");
          await setDoc(
            doc(db, "users", targetUid),
            { clubId: null, coachId: null, coachName: null, coachEmail: null },
            { merge: true }
          );
        }
      } catch (cloudErr) {
        console.warn("Direct cloud unlink write deferred to sync queue:", cloudErr);
      }

      try {
        const { addToSyncQueue, generateResilientId } = await import("@/lib/db/indexedDB");
        const { runSync } = await import("@/lib/db/syncManager");
        await addToSyncQueue({
          id: generateResilientId("TXN"),
          collection: "users",
          operation: "UPDATE",
          payloadId: targetUid,
          payload: payloadToSync,
          timestamp: Date.now()
        });
        runSync();
      } catch (syncErr) {
        console.warn("Cloud sync skipped on unlink:", syncErr);
      }
    } catch (err) {
      console.error("Error unlinking athlete:", err);
      alert("No se pudo desvincular al alumno. Inténtalo de nuevo.");
    }
  };

  // Create new athlete profile callback
  const handleCreateAthlete = async (newAthlete: UserProfile) => {
    try {
      const athleteWithClub: UserProfile = {
        ...newAthlete,
        clubId: activeClubId,
        coachId: user.uid,
        coachName: user.fullName || "Entrenador",
        coachEmail: user.email || ""
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

      alert(`¡Perfil de ${athleteWithClub.fullName} creado con éxito! Ya puedes ver su ficha y recibir sus resultados.`);
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
      const { COACH_PRO_PERIOD_MS } = await import("@/lib/billingService");
      const updated = await updateProfile(user.uid, { plan: "PRO", proExpiresAt: Date.now() + COACH_PRO_PERIOD_MS });
      if (onUserUpdate) onUserUpdate(updated);
      alert("¡Coach PRO activado gratis por 30 días! Renuévalo sin costo cada mes.");
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
        const linkedUids = new Set(athletes.map((a) => a.uid));
        setSessions(list.filter((s) => !isFictitiousSession(s, s.id) && !s.isDraft && linkedUids.has(s.userId || s.userUid)));
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
      <div className="bg-[#0D0F12] p-4 rounded-2xl border border-white/[0.08] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-12 h-12 rounded-xl bg-cyan-neon/10 border border-cyan-neon/25 flex items-center justify-center font-black text-cyan-neon text-lg shrink-0">
            {user.fullName ? user.fullName.substring(0, 2).toUpperCase() : "CH"}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-white text-[17.6px] font-black uppercase tracking-wide truncate max-w-full">
                Coach {user.fullName || "Director"}
              </h2>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("open-coach-payment"))}
                className="text-[9.5px] bg-yellow-gold/10 hover:bg-yellow-gold/20 text-yellow-gold font-black uppercase px-2 py-0.5 rounded-full border border-yellow-gold/25 flex items-center gap-1 shrink-0 whitespace-nowrap cursor-pointer transition"
              >
                <ShieldCheck size={10} />
                <span>PRO</span>
              </button>
            </div>
            <p className="text-[11.6px] text-white mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>Portal de Entrenador</span>
              <span>·</span>
              <span>Receptor y Director de Estadísticas</span>
            </p>
          </div>
        </div>

        {/* Quick Coach Code (Máximo 6 dígitos) */}
        <div className="flex items-center gap-2.5 self-stretch sm:self-auto justify-between sm:justify-end bg-black px-3 py-2 rounded-xl border border-white/[0.06]">
          <div className="flex flex-col">
            <span className="text-[9.3px] text-white uppercase font-bold tracking-wider">Código para Alumnos</span>
            <div className="flex items-baseline gap-1">
              <span className="text-sm tabular-nums font-black text-cyan-neon tracking-widest select-all">
                {user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode) 
                  ? user.clubInviteCode 
                  : "······"}
              </span>
              <span className="text-[8.1px] text-white font-bold uppercase tracking-wider">
                (6 dígitos)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const codeToCopy = (user.clubInviteCode && /^\d{6}$/.test(user.clubInviteCode))
                  ? user.clubInviteCode
                  : "";
                if (!codeToCopy) {
                  alert("Tu código se está generando. Espera unos segundos e inténtalo de nuevo.");
                  return;
                }
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(codeToCopy);
                  alert(`Código "${codeToCopy}" copiado al portapapeles. Compártelo con tus alumnos para que se vinculen contigo.`);
                }
              }}
              className="p-1.5 bg-neutral-900 border border-white/10 rounded-lg text-cyan-neon hover:text-white transition cursor-pointer"
              title="Copiar código para alumnos"
            >
              <Share2 size={13} />
            </button>
            <button
              onClick={async () => {
                if (confirm("¿Deseas borrar el código actual y generar uno nuevo de 6 dígitos para tus alumnos?")) {
                  try {
                    const { generateClubInviteCode, updateProfile } = await import("@/lib/authService");
                    const freshCode = generateClubInviteCode();
                    const updated = await updateProfile(user.uid, {
                      clubInviteCode: freshCode,
                      clubId: activeClubId,
                      isClubCreator: true
                    });
                    if (onUserUpdate) onUserUpdate(updated);
                    alert(`Nuevo código de 6 dígitos generado: ${freshCode}`);
                  } catch (err) {
                    console.error("Error al regenerar código:", err);
                  }
                }
              }}
              className="p-1.5 bg-neutral-900 border border-white/10 rounded-lg text-white hover:text-yellow-gold transition cursor-pointer"
              title="Borrar y generar nuevo código de 6 dígitos"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Panel Switcher: ALUMNOS | RESULTADOS | DIRECTOR | PLANES */}
      <div className="flex bg-[#0A0B0E] border border-white/[0.08] rounded-2xl p-1 justify-between shrink-0">
        {[
          { id: "ATHLETES", label: "Alumnos", icon: Users },
          { id: "SESSIONS", label: "Resultados", icon: Award },
          { id: "OVERVIEW", label: "Director", icon: LayoutDashboard },
          { id: "MACROCYCLES", label: "Planes", icon: Calendar }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-[11.6px] font-black uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                active 
                  ? "bg-white/[0.05] border border-white/[0.08] text-cyan-neon" 
                  : "text-white hover:text-white border border-transparent"
              }`}
            >
              <Icon size={14} className={active ? "text-cyan-neon" : "text-white"} />
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
            onOpenPlanImporter={handleOpenPlanImporter}
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
            athletes={athletes}
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
            onUnlinkAthlete={handleUnlinkAthlete}
            onOpenPlanImporter={(athleteId) => {
              setSelectedAthlete(null);
              handleOpenPlanImporter(athleteId);
            }}
          />
        )}
      </AnimatePresence>

      {/* Direct Plan Importer Modal (from Athletes tab or Athlete Detail Sheet) */}
      <PlanImporterModal
        isOpen={showPlanImporter}
        onClose={() => setShowPlanImporter(false)}
        user={user}
        coachViewMode={true}
        athletes={athletes}
        preselectedAthleteIds={importerPreselectedIds}
        onSuccess={handlePlanImportSuccess}
        titleOverride="Cargar Plan al Calendario del Alumno"
      />
    </div>
  );
}
