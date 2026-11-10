"use client";

import React, { useState, useEffect } from "react";
import { CreditCard, ToggleLeft, ToggleRight, Clock } from "lucide-react";
import { UserProfile, updateProfile } from "@/lib/authService";
import { getLocalSetting, saveLocalSetting, generateResilientId } from "@/lib/db/indexedDB";

interface SubscriptionLog {
  id: string;
  userId?: string;
  userName: string;
  previousPlan: "FREE" | "PRO";
  newPlan: "FREE" | "PRO";
  expiresAt?: number;
  timestamp: string;
  reason: string;
}

export default function AdminSubscriptionsTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<SubscriptionLog[]>([]);

  useEffect(() => {
    async function loadData() {
      const list = await getLocalSetting<UserProfile[]>("simulated_users", []);
      setUsers(list);

      // Load real audit logs from IndexedDB
      const savedLogs = await getLocalSetting<SubscriptionLog[]>("sub_audit_logs", []);
      const cleanLogs = savedLogs.filter((l) => l.id !== "LOG-1" && l.id !== "LOG-2");
      setLogs(cleanLogs);
    }
    loadData();

    const handleRosterUpdate = () => {
      loadData();
    };
    window.addEventListener("users-roster-updated", handleRosterUpdate);
    return () => window.removeEventListener("users-roster-updated", handleRosterUpdate);
  }, []);

  const handleTogglePlan = async (targetUid: string) => {
    const user = users.find((u) => u.uid === targetUid);
    if (!user) return;

    const previousPlan = user.plan || "FREE";
    const nextPlan: "FREE" | "PRO" = previousPlan === "PRO" ? "FREE" : "PRO";
    const now = Date.now();
    const nextExpiresAt = nextPlan === "PRO" ? now + 365 * 24 * 60 * 60 * 1000 : 0;

    // 1. Update local profile + sync queue via canonical updateProfile
    await updateProfile(targetUid, {
      plan: nextPlan,
      proExpiresAt: nextExpiresAt
    });

    const updatedUsers = users.map((u) =>
      u.uid === targetUid ? { ...u, plan: nextPlan, proExpiresAt: nextExpiresAt, updatedAt: now } : u
    );
    setUsers(updatedUsers);

    // 2. Build audit log entry
    const newLog: SubscriptionLog = {
      id: generateResilientId("SUB"),
      userId: targetUid,
      userName: user.fullName || user.email,
      previousPlan,
      newPlan: nextPlan,
      expiresAt: nextExpiresAt,
      timestamp: new Date(now).toISOString().split("T")[0],
      reason: "Override manual por SuperAdmin"
    };

    const updatedLogs = [newLog, ...logs];
    setLogs(updatedLogs);
    await saveLocalSetting("sub_audit_logs", updatedLogs);

    // 3. Persist directly to Firestore users/{targetUid} + subscription_audit_logs
    try {
      const { doc, updateDoc, setDoc } = await import("firebase/firestore");
      const { db, auth } = await import("@/lib/firebase");
      if (auth.currentUser) {
        await updateDoc(doc(db, "users", targetUid), {
          plan: nextPlan,
          proExpiresAt: nextExpiresAt,
          updatedAt: now
        }).catch(async () => {
          await setDoc(
            doc(db, "users", targetUid),
            {
              ...user,
              uid: targetUid,
              plan: nextPlan,
              proExpiresAt: nextExpiresAt,
              updatedAt: now
            },
            { merge: true }
          );
        });

        await setDoc(doc(db, "subscription_audit_logs", newLog.id), {
          ...newLog,
          createdAt: now
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("Could not sync SuperAdmin plan override directly to cloud:", err);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full p-4 md:p-6">
      {/* Header */}
      <div>
        <h2 className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider">Control de Suscripciones</h2>
        <p className="text-xs text-white">Gestiona accesos premium y overrides de planes.</p>
      </div>

      {/* Grid: 2 sections (List + History Log) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* User subscriptions list */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2.5 flex items-center gap-1.5">
            <CreditCard size={14} className="text-cyan-neon" />
            <span>Usuarios y Suscripciones ({users.length})</span>
          </h3>

          <div className="flex flex-col gap-2.5">
            {users.map((user) => (
              <div
                key={user.uid}
                className="bg-neutral-900/40 border border-white/10 rounded-2xl md:rounded-xl p-4 md:px-5 md:py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg hover:border-white/15 transition-all duration-200"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                    user.plan === "PRO" 
                      ? "bg-yellow-gold/10 text-yellow-gold border border-yellow-gold/20"
                      : "bg-white/5 text-white border border-white/5"
                  }`}>
                    {user.plan === "PRO" ? "★" : "☆"}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">{user.fullName}</h4>
                    <p className="text-[11.6px] text-white mt-0.5">{user.email}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-6 pt-2.5 md:pt-0 border-t border-white/5 md:border-t-0">
                  {/* Current Plan Display */}
                  <div className="text-left md:text-right">
                    <span className="text-[9.3px] text-white uppercase font-black tracking-widest block">Plan Activo</span>
                    <span className={`text-[11.6px] font-black ${user.plan === "PRO" ? "text-yellow-gold" : "text-white"}`}>
                      {user.plan === "PRO" ? "COACH PRO" : "GRATUITO / FREE"}
                    </span>
                  </div>

                  {/* Toggle Switch Override */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-white uppercase font-bold hidden sm:inline">PRO Override</span>
                    <button
                      onClick={() => handleTogglePlan(user.uid)}
                      className="text-cyan-neon hover:text-white transition cursor-pointer"
                    >
                      {user.plan === "PRO" ? (
                        <ToggleRight size={24} className="text-yellow-gold" />
                      ) : (
                        <ToggleLeft size={24} className="text-white" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Change logs timeline audit */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4 h-max">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2.5 flex items-center gap-1.5">
            <Clock size={14} className="text-cyan-neon" />
            <span>Registro de Auditoría</span>
          </h3>

          <div className="flex flex-col gap-4 mt-1.5 max-h-[40vh] overflow-y-auto pr-1">
            {logs.length === 0 ? (
              <p className="text-xs text-white italic py-4">No hay registros de cambios de suscripción.</p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="relative pl-4 border-l border-white/5 flex flex-col gap-1">
                  <div className="absolute left-[-4.5px] top-1 h-2 w-2 rounded-full bg-cyan-neon" />
                  <div className="flex justify-between items-center">
                    <span className="text-[11.6px] font-bold text-white">{log.userName}</span>
                    <span className="text-[9.3px] text-white font-semibold tabular-nums">{log.timestamp}</span>
                  </div>
                  <p className="text-[11.6px] text-white leading-normal">
                    Cambió de <span className="font-bold text-white">{log.previousPlan}</span> a{" "}
                    <span className="font-black text-yellow-gold">{log.newPlan}</span>
                  </p>
                  <span className="text-[10.5px] text-cyan-neon font-bold mt-0.5">{log.reason}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
