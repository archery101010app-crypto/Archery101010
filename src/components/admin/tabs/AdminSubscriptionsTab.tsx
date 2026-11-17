"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  CreditCard,
  ToggleLeft,
  ToggleRight,
  Clock,
  RefreshCw,
  Search,
  ChevronDown,
  Loader2
} from "lucide-react";
import { UserProfile, updateProfile } from "@/lib/authService";
import {
  getLocalSetting,
  saveLocalSetting,
  generateResilientId,
  addToSyncQueue
} from "@/lib/db/indexedDB";
import {
  ADMIN_PAGE_SIZE,
  AdminGlobalCounts,
  fetchAdminGlobalCounts,
  fetchAdminUsersPage,
  searchAdminUsersInCloud
} from "@/lib/adminCloudPagination";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { getLocalISODate } from "@/lib/i18n/regionalUtils";

interface SubscriptionLog {
  id: string;
  userId?: string;
  userName: string;
  previousPlan: "FREE" | "PRO";
  newPlan: "FREE" | "PRO";
  sku?: string;
  expiresAt?: number;
  createdAt?: number;
  timestamp: string;
  reason: string;
}

export default function AdminSubscriptionsTab() {
  const { t, tx } = useLanguage();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<SubscriptionLog[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [syncingCloud, setSyncingCloud] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isSearchingCloud, setIsSearchingCloud] = useState<boolean>(false);
  const [hasMoreUsers, setHasMoreUsers] = useState<boolean>(false);
  const [globalCounts, setGlobalCounts] = useState<AdminGlobalCounts | null>(null);
  const nextCursorRef = useRef<any>(null);

  const loadData = useCallback(async () => {
    const localUsers = await getLocalSetting<UserProfile[]>("simulated_users", []);
    const savedLogs = await getLocalSetting<SubscriptionLog[]>("sub_audit_logs", []);
    const cleanLocalLogs = savedLogs.filter((l) => l.id !== "LOG-1" && l.id !== "LOG-2");

    setUsers(localUsers);
    setLogs(cleanLocalLogs);

    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    setSyncingCloud(true);
    try {
      const { collection, getDocs, query, orderBy, limit } = await import("firebase/firestore");
      const { db, auth } = await import("@/lib/firebase");
      if (!auth.currentUser) return;

      const fetchLogsBounded = async () => {
        try {
          return await getDocs(
            query(collection(db, "subscription_audit_logs"), orderBy("createdAt", "desc"), limit(50))
          );
        } catch {
          return await getDocs(query(collection(db, "subscription_audit_logs"), limit(50))).catch(
            () => null
          );
        }
      };

      const [pageRes, countsRes, logsSnap] = await Promise.all([
        fetchAdminUsersPage(null, ADMIN_PAGE_SIZE),
        fetchAdminGlobalCounts(),
        fetchLogsBounded()
      ]);

      nextCursorRef.current = pageRes.lastCursor;
      setHasMoreUsers(pageRes.hasMore);
      if (countsRes) {
        setGlobalCounts(countsRes);
      }

      if (pageRes.users.length > 0) {
        const mergedUsersMap = new Map<string, UserProfile>();
        for (const u of localUsers) {
          if (u?.uid && u.uid !== "USR-GUEST-OFFLINE") {
            mergedUsersMap.set(u.uid, u);
          }
        }
        pageRes.users.forEach((data) => {
          const uid = data?.uid;
          if (!uid || uid === "USR-GUEST-OFFLINE") return;
          const prev = mergedUsersMap.get(uid);
          const remoteTs = Number(data?.updatedAt || data?.createdAt || 0);
          const localTs = Number(prev?.updatedAt || prev?.createdAt || 0);
          if (!prev || remoteTs >= localTs) {
            mergedUsersMap.set(uid, { ...prev, ...data, uid });
          }
        });
        const mergedUsers = Array.from(mergedUsersMap.values()).sort(
          (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
        );
        setUsers(mergedUsers);
        await saveLocalSetting("simulated_users", mergedUsers);
      }

      if (logsSnap) {
        const mergedLogsMap = new Map<string, SubscriptionLog>();
        for (const l of cleanLocalLogs) {
          if (l?.id) mergedLogsMap.set(l.id, l);
        }
        logsSnap.forEach((d) => {
          const data = d.data() as SubscriptionLog;
          const id = data?.id || d.id;
          if (!id || id === "LOG-1" || id === "LOG-2") return;
          mergedLogsMap.set(id, { ...data, id });
        });
        const mergedLogs = Array.from(mergedLogsMap.values()).sort((a, b) => {
          const ta = Number(a.createdAt || Date.parse(a.timestamp || "") || 0);
          const tb = Number(b.createdAt || Date.parse(b.timestamp || "") || 0);
          return tb - ta;
        });
        setLogs(mergedLogs);
        await saveLocalSetting("sub_audit_logs", mergedLogs);
      }
    } catch (err) {
      console.warn("Could not fetch cloud subscriptions in AdminSubscriptionsTab:", err);
    } finally {
      setSyncingCloud(false);
    }
  }, []);

  const handleLoadMoreUsers = async () => {
    if (isLoadingMore || !hasMoreUsers) return;
    setIsLoadingMore(true);
    try {
      const pageRes = await fetchAdminUsersPage(nextCursorRef.current, ADMIN_PAGE_SIZE);
      nextCursorRef.current = pageRes.lastCursor;
      setHasMoreUsers(pageRes.hasMore);
      if (pageRes.users.length > 0) {
        setUsers((prev) => {
          const map = new Map<string, UserProfile>();
          prev.forEach((u) => {
            if (u.uid) map.set(u.uid, u);
          });
          pageRes.users.forEach((u) => {
            if (u.uid) map.set(u.uid, { ...map.get(u.uid), ...u });
          });
          const next = Array.from(map.values()).sort(
            (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
          );
          saveLocalSetting("simulated_users", next).catch(() => {});
          return next;
        });
      }
    } catch (err) {
      console.warn("Could not load more subscription users:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const clean = searchTerm.trim();
    if (clean.length < 2 || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setIsSearchingCloud(false);
      return;
    }
    let cancelled = false;
    setIsSearchingCloud(true);
    const timer = setTimeout(async () => {
      try {
        const cloudMatches = await searchAdminUsersInCloud(clean);
        if (cancelled || cloudMatches.length === 0) return;
        setUsers((prev) => {
          const map = new Map<string, UserProfile>();
          prev.forEach((u) => {
            if (u.uid) map.set(u.uid, u);
          });
          cloudMatches.forEach((u) => {
            if (u.uid) map.set(u.uid, { ...map.get(u.uid), ...u });
          });
          return Array.from(map.values()).sort(
            (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
          );
        });
      } catch (err) {
        console.warn("Cloud search error in AdminSubscriptionsTab:", err);
      } finally {
        if (!cancelled) setIsSearchingCloud(false);
      }
    }, 380);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    loadData();

    const handleRosterUpdate = () => {
      loadData();
    };
    window.addEventListener("users-roster-updated", handleRosterUpdate);
    return () => window.removeEventListener("users-roster-updated", handleRosterUpdate);
  }, [loadData]);

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
      u.uid === targetUid
        ? { ...u, plan: nextPlan, proExpiresAt: nextExpiresAt, updatedAt: now }
        : u
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
      createdAt: now,
      timestamp: getLocalISODate(now),
      reason: tx("Override manual por SuperAdmin", "Manual SuperAdmin override")
    };

    const updatedLogs = [newLog, ...logs];
    setLogs(updatedLogs);
    await saveLocalSetting("sub_audit_logs", updatedLogs);

    await addToSyncQueue({
      id: generateResilientId("TXN"),
      collection: "subscription_audit_logs",
      operation: "INSERT",
      payloadId: newLog.id,
      payload: newLog,
      timestamp: now
    }).catch(() => {});

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

        await setDoc(doc(db, "subscription_audit_logs", newLog.id), newLog).catch(() => {});
      }
    } catch (err) {
      console.warn("Could not sync SuperAdmin plan override directly to cloud:", err);
    }
  };

  const filteredUsers = users.filter((u) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    const cleanNick = term.replace(/^@/, "");
    return (
      (u.fullName || "").toLowerCase().includes(term) ||
      (u.email || "").toLowerCase().includes(term) ||
      (u.nickname || "").toLowerCase().includes(cleanNick) ||
      (u.uid || "").toLowerCase().includes(term)
    );
  });

  const displayTotalUsers = globalCounts
    ? Math.max(globalCounts.totalUsers, users.length)
    : users.length;
  const displayProUsers = globalCounts
    ? Math.max(globalCounts.proUsers, users.filter((u) => u.plan === "PRO").length)
    : users.filter((u) => u.plan === "PRO").length;

  return (
    <div className="flex flex-col gap-6 w-full p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] md:text-[26.4px] font-black text-white uppercase tracking-wider flex flex-wrap items-center gap-2">
            <span>{tx("Control de Suscripciones", "Subscriptions Control")}</span>
            <span className="text-[14px] bg-yellow-gold/10 text-yellow-gold border border-yellow-gold/25 px-2.5 py-0.5 rounded-full font-black tabular-nums">
              {displayProUsers.toLocaleString()} {t("proBadge")}
            </span>
          </h2>
          <p className="text-xs text-white">
            {tx(
              "Gestiona accesos premium y overrides de planes sincronizados en la nube.",
              "Manage premium access and cloud-synced subscription overrides."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={syncingCloud}
          className="px-3 py-2 rounded-xl bg-[#0D1017] border border-white/10 hover:border-cyan-neon/40 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw
            size={13}
            className={syncingCloud ? "animate-spin text-cyan-neon" : "text-cyan-neon"}
          />
          <span>{tx("Actualizar", "Refresh")}</span>
        </button>
      </div>

      {/* Grid: 2 sections (List + History Log) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        {/* User subscriptions list */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-white/5 pb-3">
            <h3 className="text-xs font-black text-white uppercase tracking-widest flex items-center gap-1.5">
              <CreditCard size={14} className="text-cyan-neon" />
              <span className="tabular-nums">
                {tx(
                  `Usuarios y Suscripciones (${users.length.toLocaleString()} de ${displayTotalUsers.toLocaleString()})`,
                  `Users & Subscriptions (${users.length.toLocaleString()} of ${displayTotalUsers.toLocaleString()})`
                )}
              </span>
            </h3>

            <div className="relative w-full sm:w-72">
              <Search
                size={14}
                className="absolute start-3 top-1/2 -translate-y-1/2 text-white pointer-events-none"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={tx(
                  "Buscar correo, nombre, @apodo o ID...",
                  "Search email, name, @handle or ID..."
                )}
                className="w-full ps-9 pe-8 py-2 rounded-xl bg-neutral-900/60 border border-white/10 text-white text-xs outline-none focus:border-cyan-neon transition"
              />
              {isSearchingCloud && (
                <Loader2
                  size={13}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-cyan-neon animate-spin"
                />
              )}
            </div>
          </div>

          {syncingCloud && users.length === 0 ? (
            <div className="flex flex-col gap-2.5" role="status" aria-label={t("loading")}>
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="bg-[#0D1017] border border-white/[0.08] rounded-2xl p-4 flex items-center justify-between gap-3 animate-pulse"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] shrink-0" />
                    <div className="flex flex-col gap-1.5">
                      <div className="h-3 w-28 bg-white/10 rounded" />
                      <div className="h-2.5 w-40 bg-white/[0.06] rounded" />
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-white/[0.06] rounded-full shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredUsers.map((user) => (
                <div
                  key={user.uid}
                  className="bg-neutral-900/40 border border-white/10 rounded-2xl md:rounded-xl p-4 md:px-5 md:py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-lg hover:border-white/15 transition-all duration-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                        user.plan === "PRO"
                          ? "bg-yellow-gold/10 text-yellow-gold border border-yellow-gold/20"
                          : "bg-white/5 text-white border border-white/5"
                      }`}
                    >
                      {user.plan === "PRO" ? "★" : "☆"}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white leading-tight truncate">
                        {user.fullName}
                      </h4>
                      <p className="text-[11.6px] text-white mt-0.5 truncate select-text">
                        {user.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-6 pt-2.5 md:pt-0 border-t border-white/5 md:border-t-0 shrink-0">
                    {/* Current Plan Display */}
                    <div className="text-start md:text-end">
                      <span className="text-[9.3px] text-white uppercase font-black tracking-widest block">
                        {tx("Plan Activo", "Active Plan")}
                      </span>
                      <span
                        className={`text-[11.6px] font-black ${
                          user.plan === "PRO" ? "text-yellow-gold" : "text-white"
                        }`}
                      >
                        {user.plan === "PRO"
                          ? "COACH PRO"
                          : tx("GRATUITO / FREE", "FREE")}
                      </span>
                    </div>

                    {/* Toggle Switch Override */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-white uppercase font-bold hidden sm:inline">
                        {tx("PRO Override", "PRO Override")}
                      </span>
                      <button
                        onClick={() => handleTogglePlan(user.uid)}
                        aria-label={tx(
                          `Alternar plan PRO para ${user.fullName}`,
                          `Toggle PRO plan for ${user.fullName}`
                        )}
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
          )}

          {hasMoreUsers && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={handleLoadMoreUsers}
                disabled={isLoadingMore}
                className="min-h-[40px] px-4 py-2 rounded-2xl bg-[#0D1017] hover:bg-neutral-900 border border-white/15 hover:border-cyan-neon/40 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-cyan-neon" />
                    <span>{tx("Cargando siguientes 50...", "Loading next 50...")}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={15} className="text-cyan-neon" />
                    <span className="tabular-nums">
                      {tx(
                        `Cargar 50 más (${users.length.toLocaleString()} de ${displayTotalUsers.toLocaleString()})`,
                        `Load 50 more (${users.length.toLocaleString()} of ${displayTotalUsers.toLocaleString()})`
                      )}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Change logs timeline audit */}
        <div className="bg-neutral-900/40 border border-white/10 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col gap-4 h-max">
          <h3 className="text-xs font-black text-white uppercase tracking-widest border-b border-white/5 pb-2.5 flex items-center gap-1.5">
            <Clock size={14} className="text-cyan-neon" />
            <span>{tx("Registro de Auditoría", "Audit Log")}</span>
          </h3>

          <div className="flex flex-col gap-4 mt-1.5 max-h-[40vh] overflow-y-auto pe-1">
            {logs.length === 0 ? (
              <p className="text-xs text-white italic py-4">
                {tx(
                  "No hay registros de cambios de suscripción.",
                  "No subscription change logs yet."
                )}
              </p>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="relative ps-4 border-s border-white/5 flex flex-col gap-1"
                >
                  <div className="absolute start-[-4.5px] top-1 h-2 w-2 rounded-full bg-cyan-neon" />
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[11.6px] font-bold text-white truncate">
                      {log.userName}
                    </span>
                    <span className="text-[9.3px] text-white font-semibold tabular-nums shrink-0">
                      {log.timestamp}
                    </span>
                  </div>
                  <p className="text-[11.6px] text-white leading-normal">
                    {tx("Cambió de", "Changed from")}{" "}
                    <span className="font-bold text-white">{log.previousPlan}</span>{" "}
                    {tx("a", "to")}{" "}
                    <span className="font-black text-yellow-gold">{log.newPlan}</span>
                  </p>
                  <span className="text-[10.5px] text-cyan-neon font-bold mt-0.5">
                    {log.reason}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
