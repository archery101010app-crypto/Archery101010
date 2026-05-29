"use client";

import React, { useState, useEffect } from "react";
import { CreditCard, Shield, Calendar, DollarSign, Activity, ToggleLeft, ToggleRight, ArrowUpDown, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { UserProfile } from "@/lib/authService";
import { getLocalSetting, saveLocalSetting, generateResilientId } from "@/lib/db/indexedDB";

interface SubscriptionLog {
  id: string;
  userName: string;
  previousPlan: "FREE" | "PRO";
  newPlan: "FREE" | "PRO";
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

      // Set default demo audit logs
      const savedLogs = await getLocalSetting<SubscriptionLog[]>("sub_audit_logs", [
        {
          id: "LOG-1",
          userName: "Carlos Mendoza",
          previousPlan: "FREE",
          newPlan: "PRO",
          timestamp: new Date(Date.now() - 3600000 * 24).toISOString().split("T")[0],
          reason: "Suscripción manual (SuperAdmin override)"
        },
        {
          id: "LOG-2",
          userName: "Daniela Rivas",
          previousPlan: "FREE",
          newPlan: "PRO",
          timestamp: new Date(Date.now() - 3600000 * 48).toISOString().split("T")[0],
          reason: "Pago procesado vía PayPal Standard"
        }
      ]);
      setLogs(savedLogs);
    }
    loadData();
  }, []);

  const handleTogglePlan = async (uid: string) => {
    const user = users.find((u) => u.uid === uid);
    if (!user) return;

    const previousPlan = user.plan;
    const newPlan = previousPlan === "FREE" ? "PRO" : "FREE";

    const updatedUsers = users.map((u) => {
      if (u.uid === uid) {
        return { ...u, plan: newPlan as "FREE" | "PRO" };
      }
      return u;
    });

    setUsers(updatedUsers);
    await saveLocalSetting("simulated_users", updatedUsers);

    // Save to logs
    const newLog: SubscriptionLog = {
      id: generateResilientId("LOG"),
      userName: user.fullName,
      previousPlan,
      newPlan,
      timestamp: new Date().toISOString().split("T")[0],
      reason: "Override manual por SuperAdmin"
    };

    const updatedLogs = [newLog, ...logs];
    setLogs(updatedLogs);
    await saveLocalSetting("sub_audit_logs", updatedLogs);

    // Also update logged user if it's the active one
    const currentLogged = await getLocalSetting<UserProfile | null>("current_user", null);
    if (currentLogged && currentLogged.uid === uid) {
      await saveLocalSetting("current_user", {
        ...currentLogged,
        plan: newPlan as "FREE" | "PRO"
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full p-4 md:p-6">
      {/* Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">Control de Suscripciones</h2>
        <p className="text-xs text-white/50">Gestiona accesos premium, métodos de pago simulados y overrides de planes.</p>
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
                      : "bg-white/5 text-white/40 border border-white/5"
                  }`}>
                    {user.plan === "PRO" ? "★" : "☆"}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white leading-tight">{user.fullName}</h4>
                    <p className="text-[10px] text-white/40 mt-0.5">{user.email}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-6 pt-2.5 md:pt-0 border-t border-white/5 md:border-t-0">
                  {/* Current Plan Display */}
                  <div className="text-left md:text-right">
                    <span className="text-[8px] text-white/30 uppercase font-black tracking-widest block">Plan Activo</span>
                    <span className={`text-[10px] font-black ${user.plan === "PRO" ? "text-yellow-gold" : "text-white/60"}`}>
                      {user.plan === "PRO" ? "👑 COACH PRO" : "⚡ GRATUITO / FREE"}
                    </span>
                  </div>

                  {/* Toggle Switch Override */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-white/30 uppercase font-bold hidden sm:inline">PRO Override</span>
                    <button
                      onClick={() => handleTogglePlan(user.uid)}
                      className="text-cyan-neon hover:text-white/80 transition cursor-pointer"
                    >
                      {user.plan === "PRO" ? (
                        <ToggleRight size={24} className="text-yellow-gold" />
                      ) : (
                        <ToggleLeft size={24} className="text-white/20" />
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
            <Clock size={14} className="text-purple-500" />
            <span>Registro de Auditoría</span>
          </h3>

          <div className="flex flex-col gap-4 mt-1.5 max-h-[40vh] overflow-y-auto pr-1">
            {logs.map((log) => (
              <div key={log.id} className="relative pl-4 border-l border-white/5 flex flex-col gap-1">
                <div className="absolute left-[-4.5px] top-1 h-2 w-2 rounded-full bg-cyan-neon" />
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-white">{log.userName}</span>
                  <span className="text-[8px] text-white/30 font-semibold">{log.timestamp}</span>
                </div>
                <p className="text-[10px] text-white/60 leading-normal">
                  Cambió de <span className="font-bold text-white/80">{log.previousPlan}</span> a{" "}
                  <span className="font-black text-yellow-gold">{log.newPlan}</span>
                </p>
                <span className="text-[9px] text-cyan-neon/80 font-bold mt-0.5">{log.reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
